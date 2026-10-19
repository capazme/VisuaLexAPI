CREATE TABLE "norma_watches" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "norma_key" TEXT NOT NULL,
  "norma_data" JSONB NOT NULL,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "norma_watches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "norma_change_notifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "watch_id" TEXT NOT NULL,
  "norma_key" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "norma_change_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "norma_watches_user_id_norma_key_key" ON "norma_watches"("user_id", "norma_key");
CREATE INDEX "norma_watches_user_id_idx" ON "norma_watches"("user_id");
CREATE INDEX "norma_change_notifications_user_id_read_at_idx" ON "norma_change_notifications"("user_id", "read_at");
CREATE INDEX "norma_change_notifications_watch_id_idx" ON "norma_change_notifications"("watch_id");

ALTER TABLE "norma_watches" ADD CONSTRAINT "norma_watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "norma_change_notifications" ADD CONSTRAINT "norma_change_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "norma_change_notifications" ADD CONSTRAINT "norma_change_notifications_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "norma_watches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
