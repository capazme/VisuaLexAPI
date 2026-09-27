-- CreateEnum
CREATE TYPE "EnvironmentCategory" AS ENUM ('compliance', 'civil', 'penal', 'administrative', 'eu', 'other');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('spam', 'inappropriate', 'copyright', 'other');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'reviewed', 'dismissed');

-- CreateTable
CREATE TABLE "shared_environments" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" JSONB NOT NULL,
    "include_notes" BOOLEAN NOT NULL DEFAULT true,
    "include_highlights" BOOLEAN NOT NULL DEFAULT true,
    "category" "EnvironmentCategory" NOT NULL,
    "tags" TEXT[],
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_environment_likes" (
    "id" TEXT NOT NULL,
    "env_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_environment_likes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_environment_reports" (
    "id" TEXT NOT NULL,
    "env_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" "ReportReason" NOT NULL,
    "details" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_environment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shared_environments_user_id_idx" ON "shared_environments"("user_id");

-- CreateIndex
CREATE INDEX "shared_environments_category_idx" ON "shared_environments"("category");

-- CreateIndex
CREATE INDEX "shared_environments_created_at_idx" ON "shared_environments"("created_at");

-- CreateIndex
CREATE INDEX "shared_environment_likes_env_id_idx" ON "shared_environment_likes"("env_id");

-- CreateIndex
CREATE INDEX "shared_environment_likes_user_id_idx" ON "shared_environment_likes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shared_environment_likes_env_id_user_id_key" ON "shared_environment_likes"("env_id", "user_id");

-- CreateIndex
CREATE INDEX "shared_environment_reports_env_id_idx" ON "shared_environment_reports"("env_id");

-- CreateIndex
CREATE INDEX "shared_environment_reports_status_idx" ON "shared_environment_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shared_environment_reports_env_id_user_id_key" ON "shared_environment_reports"("env_id", "user_id");

-- AddForeignKey
ALTER TABLE "shared_environments" ADD CONSTRAINT "shared_environments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_environment_likes" ADD CONSTRAINT "shared_environment_likes_env_id_fkey" FOREIGN KEY ("env_id") REFERENCES "shared_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_environment_likes" ADD CONSTRAINT "shared_environment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_environment_reports" ADD CONSTRAINT "shared_environment_reports_env_id_fkey" FOREIGN KEY ("env_id") REFERENCES "shared_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_environment_reports" ADD CONSTRAINT "shared_environment_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
