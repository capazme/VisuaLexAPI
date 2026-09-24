CREATE TABLE "dossier_snapshots" (
  "id" TEXT NOT NULL,
  "dossier_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "label" TEXT,
  "content" JSONB NOT NULL,
  "fingerprint" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dossier_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "dossier_snapshots_dossier_id_version_key" ON "dossier_snapshots"("dossier_id", "version");
CREATE INDEX "dossier_snapshots_dossier_id_created_at_idx" ON "dossier_snapshots"("dossier_id", "created_at");
ALTER TABLE "dossier_snapshots" ADD CONSTRAINT "dossier_snapshots_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "article_threads" (
  "id" TEXT NOT NULL,
  "norma_key" TEXT NOT NULL,
  "article_id" TEXT NOT NULL,
  "article_label" TEXT,
  "version" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "is_hidden" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "article_threads_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "article_threads_norma_key_article_id_created_at_idx" ON "article_threads"("norma_key", "article_id", "created_at");
CREATE INDEX "article_threads_user_id_idx" ON "article_threads"("user_id");
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "article_comments" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "parent_id" TEXT,
  "body" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "is_hidden" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "article_comments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "article_comments_thread_id_created_at_idx" ON "article_comments"("thread_id", "created_at");
CREATE INDEX "article_comments_parent_id_idx" ON "article_comments"("parent_id");
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "article_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "article_thread_votes" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_thread_votes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "article_thread_votes_thread_id_user_id_key" ON "article_thread_votes"("thread_id", "user_id");
CREATE INDEX "article_thread_votes_user_id_idx" ON "article_thread_votes"("user_id");
ALTER TABLE "article_thread_votes" ADD CONSTRAINT "article_thread_votes_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_thread_votes" ADD CONSTRAINT "article_thread_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "article_comment_votes" (
  "id" TEXT NOT NULL,
  "comment_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_comment_votes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "article_comment_votes_comment_id_user_id_key" ON "article_comment_votes"("comment_id", "user_id");
CREATE INDEX "article_comment_votes_user_id_idx" ON "article_comment_votes"("user_id");
ALTER TABLE "article_comment_votes" ADD CONSTRAINT "article_comment_votes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "article_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_comment_votes" ADD CONSTRAINT "article_comment_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "article_thread_reports" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "article_thread_reports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "article_thread_reports_thread_id_user_id_key" ON "article_thread_reports"("thread_id", "user_id");
CREATE INDEX "article_thread_reports_status_idx" ON "article_thread_reports"("status");
ALTER TABLE "article_thread_reports" ADD CONSTRAINT "article_thread_reports_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "article_thread_reports" ADD CONSTRAINT "article_thread_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
