BEGIN;

-- Serialize this short backfill against writes. Existing UUIDs, money and timestamps stay unchanged.
LOCK TABLE "orders" IN ACCESS EXCLUSIVE MODE;
CREATE SEQUENCE "orders_order_number_seq" AS INTEGER START WITH 10000;
ALTER TABLE "orders" ADD COLUMN "order_number" INTEGER;
ALTER SEQUENCE "orders_order_number_seq" OWNED BY "orders"."order_number";
WITH numbered AS (
  SELECT "order_id", (9999 + row_number() OVER (ORDER BY "created_at", "order_id"))::integer AS number FROM "orders"
)
UPDATE "orders" AS target SET "order_number" = numbered.number FROM numbered WHERE target."order_id" = numbered."order_id";
SELECT setval('"orders_order_number_seq"', COALESCE((SELECT MAX("order_number") + 1 FROM "orders"), 10000), false);
ALTER TABLE "orders" ALTER COLUMN "order_number" SET DEFAULT nextval('"orders_order_number_seq"');
ALTER TABLE "orders" ALTER COLUMN "order_number" SET NOT NULL;
ALTER TABLE "orders" ADD CONSTRAINT "orders_order_number_positive" CHECK ("order_number" >= 10000);
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");
-- Changing a default does not convert existing USD orders.
ALTER TABLE "orders" ALTER COLUMN "currency" SET DEFAULT 'BRL';
ALTER TABLE "order_items" ADD COLUMN "image_url" VARCHAR(300), ADD COLUMN "catalog_version" VARCHAR(40),
 ADD COLUMN "description" VARCHAR(3000), ADD COLUMN "category" VARCHAR(120);

CREATE VIEW "v_support_orders" AS
SELECT c."name" AS customer_name, o."order_number", o."status", o."currency",
       COALESCE(SUM(i."quantity"::bigint * i."unit_price_cents"), 0) AS total_cents,
       o."created_at", o."updated_at", o."cancelled_at"
FROM "orders" o JOIN "customers" c ON c."customer_id" = o."customer_id"
LEFT JOIN "order_items" i ON i."order_id" = o."order_id"
GROUP BY o."order_id", c."name";

CREATE VIEW "v_support_order_items" AS
SELECT c."name" AS customer_name, o."order_number", o."status", o."currency",
       i."product_id", i."title" AS product_name, i."image_url", i."catalog_version", i."category", i."quantity",
       i."unit_price_cents", i."quantity"::bigint * i."unit_price_cents" AS subtotal_cents
FROM "orders" o JOIN "customers" c ON c."customer_id" = o."customer_id"
JOIN "order_items" i ON i."order_id" = o."order_id";

CREATE VIEW "v_support_conversations" AS
SELECT c."name" AS customer_name, cv."conversation_id", cv."state",
       last_order."order_number" AS last_order_number, pending_order."order_number" AS pending_order_number,
       cv."confirmation_expires_at", cv."created_at", cv."updated_at"
FROM "conversations" cv JOIN "customers" c ON c."customer_id" = cv."customer_id"
LEFT JOIN "orders" last_order ON last_order."order_id" = cv."last_order_id" AND last_order."customer_id" = cv."customer_id"
LEFT JOIN "orders" pending_order ON pending_order."order_id" = cv."pending_order_id" AND pending_order."customer_id" = cv."customer_id";

COMMIT;
