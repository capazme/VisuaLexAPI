-- ====================================================
-- Migration 005: upload dedup per user (contrib ownership)
-- ====================================================
--
-- Same statements as alembic/versions/009_user_documents_owner_dedup.py and
-- merlt/storage/enrichment/schema_additions.py (applied at every boot), for
-- databases bootstrapped by create_tables(). Idempotent: safe to re-run.
--
-- The global UNIQUE on user_documents.file_hash handed user B user A's
-- document id for a byte-identical file (and let B probe which files A had
-- uploaded). Uniqueness is now (file_hash, uploaded_by).
-- unique=True + index=True made SQLAlchemy emit a UNIQUE INDEX named
-- ix_user_documents_file_hash: demote it to a plain index.
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname = current_schema() AND indexname = 'ix_user_documents_file_hash'
             AND indexdef LIKE 'CREATE UNIQUE INDEX%') THEN
    DROP INDEX ix_user_documents_file_hash;
    CREATE INDEX ix_user_documents_file_hash ON user_documents (file_hash);
END IF;
END $$;
ALTER TABLE user_documents DROP CONSTRAINT IF EXISTS user_documents_file_hash_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_documents_hash_owner
    ON user_documents (file_hash, uploaded_by);
