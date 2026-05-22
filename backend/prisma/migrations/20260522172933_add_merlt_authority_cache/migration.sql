-- CreateTable
CREATE TABLE "merlt_user_authority_cache" (
    "user_id" TEXT NOT NULL,
    "authority_score" DOUBLE PRECISION NOT NULL,
    "baseline_qual" VARCHAR(50) NOT NULL,
    "track_record" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "performance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_contributions" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merlt_user_authority_cache_pkey" PRIMARY KEY ("user_id")
);

-- AddForeignKey
ALTER TABLE "merlt_user_authority_cache" ADD CONSTRAINT "merlt_user_authority_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
