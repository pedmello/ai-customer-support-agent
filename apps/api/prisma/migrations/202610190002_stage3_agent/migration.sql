BEGIN;

-- CreateEnum
CREATE TYPE "ConversationState" AS ENUM ('ACTIVE', 'AWAITING_CONFIRMATION', 'HUMAN_REQUESTED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "HandoffReason" AS ENUM ('CUSTOMER_REQUEST', 'OUT_OF_SCOPE', 'AI_UNAVAILABLE', 'INSUFFICIENT_INFORMATION', 'SAFETY_FAILURE');

-- CreateEnum
CREATE TYPE "HandoffStatus" AS ENUM ('OPEN');

-- CreateTable
CREATE TABLE "conversations" (
    "conversation_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "state" "ConversationState" NOT NULL DEFAULT 'ACTIVE',
    "last_order_id" UUID,
    "pending_order_id" UUID,
    "confirmation_id" UUID,
    "confirmation_expires_at" TIMESTAMPTZ(3),
    "lease_id" UUID,
    "busy_until" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("conversation_id")
);

-- CreateTable
CREATE TABLE "conversation_turns" (
    "turn_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "client_message_id" UUID NOT NULL,
    "input_hash" CHAR(64) NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("turn_id")
);

-- CreateTable
CREATE TABLE "messages" (
    "message_id" UUID NOT NULL,
    "turn_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" VARCHAR(4000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateTable
CREATE TABLE "human_handoffs" (
    "handoff_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "conversation_id" UUID,
    "reason" "HandoffReason" NOT NULL,
    "status" "HandoffStatus" NOT NULL DEFAULT 'OPEN',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "human_handoffs_pkey" PRIMARY KEY ("handoff_id")
);

-- CreateIndex
CREATE INDEX "conversations_customer_id_created_at_conversation_id_idx" ON "conversations"("customer_id", "created_at", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_conversation_id_customer_id_key" ON "conversations"("conversation_id", "customer_id");

-- CreateIndex
CREATE INDEX "conversation_turns_conversation_id_created_at_turn_id_idx" ON "conversation_turns"("conversation_id", "created_at", "turn_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_turns_conversation_id_client_message_id_key" ON "conversation_turns"("conversation_id", "client_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_turn_id_role_key" ON "messages"("turn_id", "role");

-- CreateIndex
CREATE INDEX "human_handoffs_customer_id_created_at_idx" ON "human_handoffs"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "human_handoffs_conversation_id_key" ON "human_handoffs"("conversation_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("conversation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_turn_id_fkey" FOREIGN KEY ("turn_id") REFERENCES "conversation_turns"("turn_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_handoffs" ADD CONSTRAINT "human_handoffs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "human_handoffs" ADD CONSTRAINT "human_handoffs_conversation_id_customer_id_fkey" FOREIGN KEY ("conversation_id", "customer_id") REFERENCES "conversations"("conversation_id", "customer_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversations" ADD CONSTRAINT "conversation_pending_consistency" CHECK (
  ("state" = 'AWAITING_CONFIRMATION' AND "pending_order_id" IS NOT NULL AND "confirmation_id" IS NOT NULL AND "confirmation_expires_at" IS NOT NULL)
  OR ("state" <> 'AWAITING_CONFIRMATION' AND "pending_order_id" IS NULL AND "confirmation_id" IS NULL AND "confirmation_expires_at" IS NULL)
);
ALTER TABLE "conversations" ADD CONSTRAINT "conversation_lease_consistency" CHECK (
  ("lease_id" IS NULL) = ("busy_until" IS NULL)
);

COMMIT;
