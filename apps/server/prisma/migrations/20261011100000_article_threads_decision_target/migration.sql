-- A discussion may be anchored on a court decision, in columns of its own.
-- Existing rows stay 'article' by the default. For a decision, norma_key carries the decision's
-- key, article_id is '' and version / article_urn are null (spec 2026-10-05 §8.7).

-- AlterTable
ALTER TABLE "article_threads" ADD COLUMN     "decision_key" TEXT,
ADD COLUMN     "passage_released_at" TIMESTAMPTZ(6),
ADD COLUMN     "passage_released_by" TEXT,
ADD COLUMN     "target_kind" TEXT NOT NULL DEFAULT 'article';

-- AddForeignKey
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_passage_released_by_fkey" FOREIGN KEY ("passage_released_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Checks (not in Prisma's model)
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_target_kind_check"
  CHECK ("target_kind" IN ('article', 'decision'));

ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_target_shape_check"
  CHECK (
    ("target_kind" = 'article' AND "decision_key" IS NULL)
    OR ("target_kind" = 'decision' AND "decision_key" IS NOT NULL AND "norma_key" = "decision_key"
        AND "article_id" = '' AND "version" IS NULL AND "article_urn" IS NULL)
  );

-- Both release columns set, or both null. The user reference may become null later (SET NULL on
-- the admin's deletion), so the pair is only required while the user exists: released_at set with
-- released_by null is allowed, released_by set without released_at is not.
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_passage_release_check"
  CHECK ("passage_released_by" IS NULL OR "passage_released_at" IS NOT NULL);
