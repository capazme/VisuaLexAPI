-- A dossier can keep a court decision (design 2026-10-01 §6). The item stores the decision's
-- identity and a label, never its text. Postgres 16 accepts ADD VALUE inside the migration's
-- transaction; the new value is not used in this migration.
ALTER TYPE "DossierItemType" ADD VALUE IF NOT EXISTS 'sentenza';
