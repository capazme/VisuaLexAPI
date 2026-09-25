-- ====================================================
-- Migration 003: pending_* source_reference (promotion provenance)
-- ====================================================
--
-- Same statements as alembic/versions/007_add_pending_source_reference.py,
-- for databases bootstrapped by create_tables() (the live stack), where no
-- Alembic history exists. Idempotent: safe to run more than once.
--
-- MUST run before the rebuilt merlt-api serves traffic: the ORM selects the
-- new column, so every pending_* read fails until it exists.
--
--   docker exec -i <merlt-postgres> psql -U <user> -d <db> < 003_pending_source_reference.sql
--

-- The contributor's bibliographic citation, or the URL of a confirmed live
-- source. `fonte` stays the varchar(50) pipeline tag.
ALTER TABLE pending_entities ADD COLUMN IF NOT EXISTS source_reference TEXT;
ALTER TABLE pending_relations ADD COLUMN IF NOT EXISTS source_reference TEXT;

-- propose-relation never set `fonte`, so community relations carried the column
-- default 'llm_extraction'. Only propose-relation writes source_type='manual'.
UPDATE pending_relations
SET fonte = 'community'
WHERE source_type = 'manual' AND (fonte IS NULL OR fonte = 'llm_extraction');
