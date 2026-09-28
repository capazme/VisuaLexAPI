-- A discussion can be attached to a passage of the article (the quotation
-- and its context), and records the article's URN and the SHA-256 of the
-- text it was opened on. All nullable: existing threads are untouched.
ALTER TABLE "article_threads"
  ADD COLUMN "passage_quote" TEXT,
  ADD COLUMN "passage_start" INTEGER,
  ADD COLUMN "passage_prefix" TEXT,
  ADD COLUMN "passage_suffix" TEXT,
  ADD COLUMN "article_urn" TEXT,
  ADD COLUMN "text_hash" TEXT;
