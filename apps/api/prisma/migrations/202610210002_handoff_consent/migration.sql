-- Optional consent state. Existing conversations and handoffs are preserved.
ALTER TABLE "conversations"
  ADD COLUMN "handoff_offer_id" UUID,
  ADD COLUMN "handoff_offer_reason" "HandoffReason",
  ADD COLUMN "handoff_offer_expires_at" TIMESTAMPTZ(3);

ALTER TABLE "conversations" ADD CONSTRAINT "handoff_offer_complete" CHECK (
  ("handoff_offer_id" IS NULL AND "handoff_offer_reason" IS NULL AND "handoff_offer_expires_at" IS NULL)
  OR
  ("handoff_offer_id" IS NOT NULL AND "handoff_offer_reason" IS NOT NULL AND "handoff_offer_expires_at" IS NOT NULL)
);
