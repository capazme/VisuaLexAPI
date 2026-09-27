-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_login_at" TIMESTAMP(3),
ADD COLUMN     "login_count" INTEGER NOT NULL DEFAULT 0;
