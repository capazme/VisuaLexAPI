-- Decisions in the history (design 2026-10-05 §9): a row is a norm (act_type) or a decision
-- (decision_key), never both, never neither. Existing rows all have act_type (it was NOT NULL),
-- so they satisfy the check.
ALTER TABLE "search_history" ADD COLUMN "decision_key" TEXT;
ALTER TABLE "search_history" ALTER COLUMN "act_type" DROP NOT NULL;
ALTER TABLE "search_history" ADD CONSTRAINT "search_history_one_kind"
  CHECK (("act_type" IS NULL) <> ("decision_key" IS NULL));
