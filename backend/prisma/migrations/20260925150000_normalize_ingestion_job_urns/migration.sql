-- lazyIngest now keys MerltIngestionJob on the normalized article urn (no
-- `!vig=` / `@originale` version marker), the same key MERL-T dedupes on.
-- Legacy rows stored the raw VisuaLex urn: fold them onto the new key so the
-- in-flight lookup and the callback fan-out see one article, not two.
UPDATE "merlt_ingestion_jobs"
SET "article_urn" = split_part(split_part("article_urn", '!', 1), '@', 1)
WHERE "article_urn" LIKE '%!%' OR "article_urn" LIKE '%@%';
