-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dev_mode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dev_mode_allowed" BOOLEAN NOT NULL DEFAULT false;
