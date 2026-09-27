-- CreateTable
CREATE TABLE "merlt_extraction_jobs" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "MerltJobStatus" NOT NULL DEFAULT 'pending',
    "task_id" TEXT,
    "candidates_created" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "merlt_extraction_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merlt_extraction_jobs_document_id_status_idx" ON "merlt_extraction_jobs"("document_id", "status");

-- CreateIndex
CREATE INDEX "merlt_extraction_jobs_user_id_idx" ON "merlt_extraction_jobs"("user_id");

-- AddForeignKey
ALTER TABLE "merlt_extraction_jobs" ADD CONSTRAINT "merlt_extraction_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
