-- CreateEnum
CREATE TYPE "DossierItemStatus" AS ENUM ('unread', 'reading', 'important', 'done');

-- AlterTable
ALTER TABLE "dossier_items" ADD COLUMN     "status" "DossierItemStatus" NOT NULL DEFAULT 'unread';

-- AlterTable
ALTER TABLE "dossiers" ADD COLUMN     "is_pinned" BOOLEAN NOT NULL DEFAULT false;
