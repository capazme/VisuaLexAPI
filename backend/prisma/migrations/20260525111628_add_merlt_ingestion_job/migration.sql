-- CreateEnum
CREATE TYPE "MerltJobStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'timeout');

-- CreateTable
CREATE TABLE "merlt_ingestion_jobs" (
    "id" TEXT NOT NULL,
    "article_urn" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "MerltJobStatus" NOT NULL DEFAULT 'pending',
    "task_id" TEXT,
    "nodes_created" INTEGER,
    "edges_created" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "merlt_ingestion_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merlt_ingestion_jobs_article_urn_status_idx" ON "merlt_ingestion_jobs"("article_urn", "status");

-- CreateIndex
CREATE INDEX "merlt_ingestion_jobs_user_id_idx" ON "merlt_ingestion_jobs"("user_id");

-- AddForeignKey
ALTER TABLE "merlt_ingestion_jobs" ADD CONSTRAINT "merlt_ingestion_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
