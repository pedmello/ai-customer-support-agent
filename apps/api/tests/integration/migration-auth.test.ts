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
it("adds nullable legacy credentials and reset tables while preserving all existing fields and views", async () => {
  const client = new Client({ connectionString: testDatabaseUrl() });
  const schema = `auth_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(
      `CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`,
    );
    for (const name of [
      "202610190001_stage2_customers_sessions_orders",
      "202610190002_stage3_agent",
      "202610200001_public_orders_catalog_views",
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
    const id = randomUUID();
    await client.query(
      "INSERT INTO customers(customer_id,name,email) VALUES ($1,$2,$3)",
      [id, "Legacy", "legacy@example.test"],
    );
    await client.query(
      "INSERT INTO sessions(session_id,customer_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval '1 day')",
      [randomUUID(), id, "f".repeat(64)],
    );
    await client.query(
      "INSERT INTO orders(order_id,customer_id,status,currency,updated_at) VALUES ($1,$2,'SHIPPED','USD',now())",
      [randomUUID(), id],
    );
    const before = (await client.query("SELECT * FROM customers")).rows[0]!;
    const sessionBefore = (await client.query("SELECT * FROM sessions"))
      .rows[0]!;
    const ordersBefore = (await client.query("SELECT * FROM orders")).rows;
    const viewBefore = (await client.query("SELECT * FROM v_support_orders"))
      .rows;
    await client.query(
      readFileSync(
        new URL(
          "../../prisma/migrations/202610210001_password_authentication/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect((await client.query("SELECT * FROM customers")).rows[0]).toEqual({
      ...before,
      password_hash: null,
      password_changed_at: null,
      email_verified_at: null,
      credential_version: 0,
    });
    expect((await client.query("SELECT * FROM sessions")).rows[0]).toEqual({
      ...sessionBefore,
      credential_version: 0,
    });
    expect((await client.query("SELECT * FROM orders")).rows).toEqual(
      ordersBefore,
    );
    expect((await client.query("SELECT * FROM v_support_orders")).rows).toEqual(
      viewBefore,
    );
    expect(
      (await client.query("SELECT * FROM password_reset_challenges")).rows,
    ).toEqual([]);
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    if (!/^auth_[a-f0-9]{32}$/.test(schema))
      throw new Error("Unexpected fixture schema");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
