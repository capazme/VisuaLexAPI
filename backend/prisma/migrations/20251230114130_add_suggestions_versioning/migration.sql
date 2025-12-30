-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "shared_environments" ADD COLUMN     "current_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "replaced_by_id" TEXT;

-- CreateTable
CREATE TABLE "environment_suggestions" (
    "id" TEXT NOT NULL,
    "shared_environment_id" TEXT NOT NULL,
    "suggester_id" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "message" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'pending',
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environment_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_environment_versions" (
    "id" TEXT NOT NULL,
    "shared_environment_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "changelog" TEXT,
    "suggestion_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_environment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "environment_suggestions_shared_environment_id_idx" ON "environment_suggestions"("shared_environment_id");

-- CreateIndex
CREATE INDEX "environment_suggestions_suggester_id_idx" ON "environment_suggestions"("suggester_id");

-- CreateIndex
CREATE INDEX "environment_suggestions_status_idx" ON "environment_suggestions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shared_environment_versions_suggestion_id_key" ON "shared_environment_versions"("suggestion_id");

-- CreateIndex
CREATE INDEX "shared_environment_versions_shared_environment_id_idx" ON "shared_environment_versions"("shared_environment_id");

-- CreateIndex
CREATE UNIQUE INDEX "shared_environment_versions_shared_environment_id_version_key" ON "shared_environment_versions"("shared_environment_id", "version");

-- CreateIndex
CREATE INDEX "shared_environments_is_active_idx" ON "shared_environments"("is_active");

-- AddForeignKey
ALTER TABLE "environment_suggestions" ADD CONSTRAINT "environment_suggestions_shared_environment_id_fkey" FOREIGN KEY ("shared_environment_id") REFERENCES "shared_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environment_suggestions" ADD CONSTRAINT "environment_suggestions_suggester_id_fkey" FOREIGN KEY ("suggester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_environment_versions" ADD CONSTRAINT "shared_environment_versions_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "environment_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_environment_versions" ADD CONSTRAINT "shared_environment_versions_shared_environment_id_fkey" FOREIGN KEY ("shared_environment_id") REFERENCES "shared_environments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
