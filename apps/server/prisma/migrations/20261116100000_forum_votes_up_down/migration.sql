-- The Forum's votes up and down, and the personal score (spec
-- docs/superpowers/specs/2026-11-14-forum-community-server-design.md §A, D-248). Written by hand,
-- applied with `prisma migrate deploy`.
--
-- - A vote is +1 or -1. Every stored vote is an up vote: the default says so, nothing is rewritten.
-- - The votes on one's own glossa, reply or comment go: they are refused from now on, and they would
--   count in one's own public score.
-- - Each glossa and each reply keeps its score, the sum of its votes, by a trigger: votes also go by
--   cascade (an account deleted, an item deleted), where no route runs.

-- AlterTable
ALTER TABLE "article_thread_votes" ADD COLUMN "value" SMALLINT NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "article_comment_votes" ADD COLUMN "value" SMALLINT NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "article_threads" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "article_comments" ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "article_threads_is_hidden_score_idx" ON "article_threads"("is_hidden", "score");

-- Checks (not in Prisma's model).
ALTER TABLE "article_thread_votes" ADD CONSTRAINT "article_thread_votes_value_check" CHECK ("value" IN (-1, 1));

ALTER TABLE "article_comment_votes" ADD CONSTRAINT "article_comment_votes_value_check" CHECK ("value" IN (-1, 1));

-- Data: no vote on one's own contribution.
DELETE FROM "article_thread_votes" v
USING "article_threads" t
WHERE v."thread_id" = t."id" AND v."user_id" = t."user_id";

DELETE FROM "article_comment_votes" v
USING "article_comments" c
WHERE v."comment_id" = c."id" AND v."user_id" = c."user_id";

-- Data: each item's score from its stored votes, whole (not by increments).
UPDATE "article_threads" t
SET "score" = s."total"
FROM (SELECT "thread_id", SUM("value")::int AS "total" FROM "article_thread_votes" GROUP BY "thread_id") s
WHERE s."thread_id" = t."id";

UPDATE "article_comments" c
SET "score" = s."total"
FROM (SELECT "comment_id", SUM("value")::int AS "total" FROM "article_comment_votes" GROUP BY "comment_id") s
WHERE s."comment_id" = c."id";

-- The score follows every vote inserted, changed or deleted, one row at a time, after the change. An
-- item deleted with its votes is already gone when its votes' rows go: the update then touches no row.
-- `updated_at` is Prisma's to write and stays as it is: a vote is not a change of the item.
CREATE FUNCTION "forum_thread_vote_score"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "article_threads" SET "score" = "score" - OLD."value" WHERE "id" = OLD."thread_id";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE "article_threads" SET "score" = "score" + NEW."value" WHERE "id" = NEW."thread_id";
  END IF;
  RETURN NULL;
END;
$$;

CREATE FUNCTION "forum_comment_vote_score"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE "article_comments" SET "score" = "score" - OLD."value" WHERE "id" = OLD."comment_id";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE "article_comments" SET "score" = "score" + NEW."value" WHERE "id" = NEW."comment_id";
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "article_thread_votes_score"
AFTER INSERT OR DELETE OR UPDATE OF "value", "thread_id" ON "article_thread_votes"
FOR EACH ROW EXECUTE FUNCTION "forum_thread_vote_score"();

CREATE TRIGGER "article_comment_votes_score"
AFTER INSERT OR DELETE OR UPDATE OF "value", "comment_id" ON "article_comment_votes"
FOR EACH ROW EXECUTE FUNCTION "forum_comment_vote_score"();
