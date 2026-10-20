import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { env } from "../src/config/env.js";
import { createDatabase } from "../src/integrations/database/prisma.js";

// Compare pre-existing fields only. Never print row content, credentials or session hashes.
const database = createDatabase(env.DATABASE_URL);
const queries: Record<string, string> = {
  customers: "SELECT to_jsonb(t) AS row FROM customers t ORDER BY customer_id",
  orders:
    "SELECT to_jsonb(t) - 'order_number' AS row FROM orders t ORDER BY order_id",
  items:
    "SELECT to_jsonb(t) - 'image_url' - 'catalog_version' - 'description' - 'category' AS row FROM order_items t ORDER BY order_item_id",
  conversations:
    "SELECT to_jsonb(t) AS row FROM conversations t ORDER BY conversation_id",
  turns: "SELECT to_jsonb(t) AS row FROM conversation_turns t ORDER BY turn_id",
  messages: "SELECT to_jsonb(t) AS row FROM messages t ORDER BY message_id",
  sessions: "SELECT to_jsonb(t) AS row FROM sessions t ORDER BY session_id",
  handoffs:
    "SELECT to_jsonb(t) AS row FROM human_handoffs t ORDER BY handoff_id",
};
const folder = fileURLToPath(new URL("../../../.temp/", import.meta.url));
const path = `${folder}/improvement-1-baseline.json`;
try {
  const fingerprints: Record<string, { count: number; sha256: string }> = {};
  for (const [table, query] of Object.entries(queries)) {
    const rows = await database.$queryRawUnsafe<unknown[]>(query);
    fingerprints[table] = {
      count: rows.length,
      sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    };
  }
  if (process.argv[2] === "before") {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path, JSON.stringify(fingerprints, null, 2));
    console.log(
      "Pre-migration fingerprints saved under ignored .temp; no row data exported.",
    );
  } else if (process.argv[2] === "after") {
    const expected = JSON.parse(
      readFileSync(path, "utf8"),
    ) as typeof fingerprints;
    if (JSON.stringify(expected) !== JSON.stringify(fingerprints))
      throw new Error("Pre-existing data changed; inspect before proceeding");
    console.log("All pre-existing fields preserved across 8 tables.");
  } else
    throw new Error(
      "Use before or after; run with the API stopped and no other writers.",
    );
} finally {
  await database.$disconnect();
}
