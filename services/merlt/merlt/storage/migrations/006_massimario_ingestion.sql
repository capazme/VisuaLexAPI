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

-- The bridge lives in the same database; guarded because a fresh database gets it
-- from the seed DDL. The DDL and the ORM already declare UNIQUE (chunk_id,
-- graph_node_urn), which ON CONFLICT needs: a unique index is added only to a
-- table that lacks one. expert_affinity is in the ORM model but not in the seed DDL.
DO $$ BEGIN
IF to_regclass('bridge_table') IS NOT NULL THEN
    ALTER TABLE bridge_table ADD COLUMN IF NOT EXISTS expert_affinity JSONB;
    IF NOT EXISTS (SELECT 1 FROM pg_index WHERE indrelid = 'bridge_table'::regclass AND indisunique
                   AND pg_get_indexdef(indexrelid) LIKE '%(chunk_id, graph_node_urn)') THEN
        CREATE UNIQUE INDEX uq_bridge_chunk_node ON bridge_table (chunk_id, graph_node_urn);
    END IF;
    CREATE INDEX IF NOT EXISTS idx_bridge_source ON bridge_table (source);
END IF;
END $$;
