-- AlterTable
ALTER TABLE "dossiers" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
