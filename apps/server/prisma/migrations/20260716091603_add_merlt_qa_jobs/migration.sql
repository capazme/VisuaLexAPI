-- CreateTable
CREATE TABLE "merlt_qa_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "consent_level" TEXT NOT NULL,
    "status" "MerltJobStatus" NOT NULL DEFAULT 'pending',
    "trace_id" TEXT,
    "partials" JSONB,
    "result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "merlt_qa_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merlt_qa_jobs_user_id_idx" ON "merlt_qa_jobs"("user_id");

-- AddForeignKey
ALTER TABLE "merlt_qa_jobs" ADD CONSTRAINT "merlt_qa_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
