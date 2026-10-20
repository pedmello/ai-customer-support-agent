import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { testDatabaseUrl } from "../helpers/test-database.js";

const { Client } = createRequire(import.meta.url)("pg") as {
  Client: new (options: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query(
      sql: string,
      values?: unknown[],
    ): Promise<{ rows: Record<string, unknown>[] }>;
  };
};

it("migrates a legacy USD fixture without changing identity, prices, history or timestamps", async () => {
  const client = new Client({ connectionString: testDatabaseUrl() });
  const schema = `improvement_${randomUUID().replaceAll("-", "")}`;
  const customerId = randomUUID();
  const orderId = randomUUID();
  const conversationId = randomUUID();
  const turnId = randomUUID();
  const timestamp = new Date("2026-10-01T12:00:00Z");
  await client.connect();
  try {
    await client.query(
      `CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";`,
    );
    for (const name of [
      "202610190001_stage2_customers_sessions_orders",
      "202610190002_stage3_agent",
    ]) {
      await client.query(
        readFileSync(
          new URL(
            `../../prisma/migrations/${name}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    }
    await client.query(
      "INSERT INTO customers(customer_id,name,email) VALUES ($1,$2,$3)",
      [customerId, "Legacy fixture", "legacy@example.test"],
    );
    await client.query(
      "INSERT INTO orders(order_id,customer_id,status,currency,created_at,updated_at) VALUES ($1,$2,'PROCESSING','USD',$3,$3)",
      [orderId, customerId, timestamp],
    );
    await client.query(
      "INSERT INTO order_items(order_item_id,order_id,product_id,title,quantity,unit_price_cents) VALUES ($1,$2,1,'Original title',2,2500)",
      [randomUUID(), orderId],
    );
    await client.query(
      "INSERT INTO conversations(conversation_id,customer_id,last_order_id,updated_at) VALUES ($1,$2,$3,$4)",
      [conversationId, customerId, orderId, timestamp],
    );
    const snapshot = JSON.stringify({
      data: {
        code: "ORDER_STATUS",
        reply: `Pedido ${orderId} em USD`,
        order: { orderId, currency: "USD" },
      },
    });
    await client.query(
      "INSERT INTO conversation_turns(turn_id,conversation_id,client_message_id,input_hash,result) VALUES ($1,$2,$3,$4,$5)",
      [turnId, conversationId, randomUUID(), "a".repeat(64), snapshot],
    );
    await client.query(
      "INSERT INTO messages(message_id,turn_id,role,content) VALUES ($1,$2,'USER',$3)",
      [randomUUID(), turnId, `Consultar ${orderId}`],
    );
    await client.query(
      readFileSync(
        new URL(
          "../../prisma/migrations/202610200001_public_orders_catalog_views/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const legacy = (
      await client.query("SELECT * FROM orders WHERE order_id=$1", [orderId])
    ).rows[0]!;
    expect(legacy).toMatchObject({
      order_id: orderId,
      customer_id: customerId,
      order_number: 10000,
      currency: "USD",
      created_at: timestamp,
      updated_at: timestamp,
    });
    expect(
      (await client.query("SELECT * FROM order_items")).rows[0],
    ).toMatchObject({
      title: "Original title",
      quantity: 2,
      unit_price_cents: 2500,
      image_url: null,
      description: null,
    });
    expect(
      (await client.query("SELECT input_hash,result FROM conversation_turns"))
        .rows[0],
    ).toEqual({ input_hash: "a".repeat(64), result: JSON.parse(snapshot) });
    expect(
      (await client.query("SELECT content FROM messages")).rows[0]!.content,
    ).toBe(`Consultar ${orderId}`);
    expect(
      (await client.query("SELECT * FROM v_support_orders")).rows[0],
    ).toMatchObject({
      customer_name: "Legacy fixture",
      order_number: 10000,
      currency: "USD",
      total_cents: "5000",
    });
    expect(
      (await client.query("SELECT * FROM v_support_conversations")).rows[0]!
        .last_order_number,
    ).toBe(10000);
    expect(
      (await client.query("SELECT * FROM v_support_order_items")).rows[0]!
        .subtotal_cents,
    ).toBe("5000");
    const next = await client.query(
      "INSERT INTO orders(order_id,customer_id,status,created_at,updated_at) VALUES ($1,$2,'PROCESSING',$3,$3) RETURNING order_number,currency",
      [randomUUID(), customerId, timestamp],
    );
    expect(next.rows[0]).toEqual({ order_number: 10001, currency: "BRL" });
  } finally {
    // Only this uniquely named fixture schema in the protected *_test database is removed.
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    if (!/^improvement_[a-f0-9]{32}$/.test(schema))
      throw new Error("Unexpected fixture schema");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
