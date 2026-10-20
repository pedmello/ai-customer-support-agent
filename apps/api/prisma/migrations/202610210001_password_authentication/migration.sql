BEGIN;
ALTER TABLE "customers"
  ADD COLUMN "password_hash" VARCHAR(255),
  ADD COLUMN "password_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "email_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "credential_version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sessions" ADD COLUMN "credential_version" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "password_reset_challenges" (
  "challenge_id" UUID NOT NULL PRIMARY KEY,
  "customer_id" UUID NOT NULL REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE,
  "verifier" CHAR(64) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "consumed_at" TIMESTAMPTZ(3)
);
CREATE INDEX "password_reset_challenges_customer_id_created_at_idx" ON "password_reset_challenges"("customer_id", "created_at");
CREATE INDEX "password_reset_challenges_expires_at_idx" ON "password_reset_challenges"("expires_at");
-- One active challenge per customer, including during concurrent requests.
CREATE UNIQUE INDEX "password_reset_challenges_active_customer_key" ON "password_reset_challenges"("customer_id") WHERE "consumed_at" IS NULL;
CREATE TABLE "auth_rate_limits" (
  "key" CHAR(64) NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 1,
  "expires_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "auth_rate_limits_expires_at_idx" ON "auth_rate_limits"("expires_at");
COMMIT;
