/*
  Warnings:

  - You are about to drop the column `content` on the `environment_suggestions` table. All the data in the column will be lost.
  - You are about to drop the column `review_note` on the `environment_suggestions` table. All the data in the column will be lost.
  - You are about to drop the column `reviewed_at` on the `environment_suggestions` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `environment_suggestions` table. All the data in the column will be lost.
  - You are about to alter the column `message` on the `environment_suggestions` table. The data in that column could be lost. The data in that column will be cast from `Text` to `VarChar(1000)`.
  - You are about to drop the column `suggestion_id` on the `shared_environment_versions` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "SuggestionItemType" AS ENUM ('annotation', 'highlight', 'dossier', 'quickNorm', 'alias');

-- CreateEnum
CREATE TYPE "SuggestionItemStatus" AS ENUM ('pending', 'taken', 'declined');

-- DropForeignKey
ALTER TABLE "shared_environment_versions" DROP CONSTRAINT "shared_environment_versions_suggestion_id_fkey";

-- DropIndex
DROP INDEX "environment_suggestions_status_idx";

-- DropIndex
DROP INDEX "shared_environment_versions_suggestion_id_key";

-- AlterTable
ALTER TABLE "annotations" ADD COLUMN     "original_author_id" TEXT,
ADD COLUMN     "source_suggestion_id" TEXT;

-- AlterTable
ALTER TABLE "custom_aliases" ADD COLUMN     "original_author_id" TEXT,
ADD COLUMN     "source_suggestion_id" TEXT;

-- AlterTable
ALTER TABLE "dossiers" ADD COLUMN     "original_author_id" TEXT,
ADD COLUMN     "source_suggestion_id" TEXT;

-- AlterTable
ALTER TABLE "environment_suggestions" DROP COLUMN "content",
DROP COLUMN "review_note",
DROP COLUMN "reviewed_at",
DROP COLUMN "status",
ALTER COLUMN "message" SET DATA TYPE VARCHAR(1000);

-- AlterTable
ALTER TABLE "highlights" ADD COLUMN     "original_author_id" TEXT,
ADD COLUMN     "source_suggestion_id" TEXT;

-- AlterTable
ALTER TABLE "quick_norms" ADD COLUMN     "original_author_id" TEXT,
ADD COLUMN     "source_suggestion_id" TEXT;

-- AlterTable
ALTER TABLE "shared_environment_versions" DROP COLUMN "suggestion_id";

-- DropEnum
DROP TYPE "SuggestionStatus";

-- CreateTable
CREATE TABLE "suggestion_items" (
    "id" TEXT NOT NULL,
    "suggestion_id" TEXT NOT NULL,
    "item_type" "SuggestionItemType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SuggestionItemStatus" NOT NULL DEFAULT 'pending',
    "review_note" VARCHAR(500),
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestion_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestion_items_suggestion_id_status_idx" ON "suggestion_items"("suggestion_id", "status");

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dossiers" ADD CONSTRAINT "dossiers_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_norms" ADD CONSTRAINT "quick_norms_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quick_norms" ADD CONSTRAINT "quick_norms_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_aliases" ADD CONSTRAINT "custom_aliases_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_aliases" ADD CONSTRAINT "custom_aliases_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_items" ADD CONSTRAINT "suggestion_items_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "environment_suggestions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
