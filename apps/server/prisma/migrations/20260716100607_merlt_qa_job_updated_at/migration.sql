-- AlterTable
-- Backfill existing rows with CURRENT_TIMESTAMP; @updatedAt has no
-- schema-level default (Prisma stamps it explicitly on every update()), so
-- the column default is only needed for this one-time backfill.
ALTER TABLE "merlt_qa_jobs" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
