-- AlterTable
ALTER TABLE "dossiers" ADD COLUMN     "created_by_client_id" TEXT,
ADD COLUMN     "created_by_client_name" TEXT;

-- AlterTable
ALTER TABLE "dossier_items" ADD COLUMN     "about_item_id" TEXT,
ADD COLUMN     "created_by_client_id" TEXT,
ADD COLUMN     "created_by_client_name" TEXT;

