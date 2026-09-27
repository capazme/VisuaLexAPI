-- ====================================================
-- Migration 004: relation endpoints (B1, note-derived relations)
-- ====================================================
--
-- Same statements as alembic/versions/008_relation_endpoints.py and
-- merlt/storage/enrichment/schema_additions.py (applied at every boot), for
-- databases bootstrapped by create_tables(). Idempotent: safe to re-run.
--
--   docker exec -i <merlt-postgres> psql -U <user> -d <db> < 004_relation_endpoints.sql
--

-- The endpoint names the LLM wrote. source_node_urn / target_entity_id now
-- hold the identifier the parser resolved (or the name when it could not).
ALTER TABLE extraction_candidates ADD COLUMN IF NOT EXISTS source_text TEXT;
ALTER TABLE extraction_candidates ADD COLUMN IF NOT EXISTS target_text TEXT;

-- A Normattiva URL as a relation target overflowed varchar(100).
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'extraction_candidates'
             AND column_name = 'target_entity_id' AND character_maximum_length < 300) THEN
    ALTER TABLE extraction_candidates ALTER COLUMN target_entity_id TYPE VARCHAR(300);
END IF;
END $$;

DO $$ BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'pending_relations'
             AND column_name = 'target_entity_id' AND character_maximum_length < 300) THEN
    ALTER TABLE pending_relations ALTER COLUMN target_entity_id TYPE VARCHAR(300);
END IF;
END $$;
