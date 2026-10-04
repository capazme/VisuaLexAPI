-- ====================================================
-- Migration 006: the Massimario's annual reviews (ingestion)
-- ====================================================
--
-- Same statements as alembic/versions/010_massimario_ingestion.py and
-- merlt/storage/enrichment/schema_additions.py (applied at every boot), for
-- databases bootstrapped by create_tables(). Idempotent: safe to re-run.
ALTER TABLE merlt_ingestion_batches ADD COLUMN IF NOT EXISTS extras JSON;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_batch_source'
               AND pg_get_constraintdef(oid) LIKE '%massimario%') THEN
    ALTER TABLE merlt_ingestion_batches DROP CONSTRAINT IF EXISTS check_batch_source;
    ALTER TABLE merlt_ingestion_batches ADD CONSTRAINT check_batch_source
        CHECK (source IN ('visualex_tree','italia_corpus','massimario'));
END IF;
END $$;
