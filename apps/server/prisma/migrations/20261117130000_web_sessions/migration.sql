-- The web's sessions (A.1, step 1 of spec 2026-11-16-web-session-cookies-design): one row per signed-in browser,
-- found by the SHA-256 of the cookie's secret. Additive: one new table, nothing existing changes; `users` cascades.
-- The rollback is in the pull request:
--   DROP TABLE "web_sessions";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261117130000_web_sessions';

-- CreateTable
CREATE TABLE "web_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_sessions_secret_hash_key" ON "web_sessions"("secret_hash");

-- CreateIndex
CREATE INDEX "web_sessions_user_id_idx" ON "web_sessions"("user_id");

-- CreateIndex
CREATE INDEX "web_sessions_expires_at_idx" ON "web_sessions"("expires_at");

-- AddForeignKey
ALTER TABLE "web_sessions" ADD CONSTRAINT "web_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
