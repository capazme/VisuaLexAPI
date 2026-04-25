-- MERLT/RLCF user consent and audit trail
CREATE TYPE "MerltConsentLevel" AS ENUM ('none', 'basic', 'full');

CREATE TABLE "merlt_user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "consent_level" "MerltConsentLevel" NOT NULL DEFAULT 'none',
    "contribution_enabled" BOOLEAN NOT NULL DEFAULT false,
    "validation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "graph_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merlt_user_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merlt_consent_audits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "previous_level" "MerltConsentLevel",
    "next_level" "MerltConsentLevel" NOT NULL,
    "source" VARCHAR(50) NOT NULL DEFAULT 'user',
    "reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merlt_consent_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "merlt_user_preferences_user_id_key" ON "merlt_user_preferences"("user_id");
CREATE INDEX "merlt_user_preferences_consent_level_idx" ON "merlt_user_preferences"("consent_level");
CREATE INDEX "merlt_consent_audits_user_id_created_at_idx" ON "merlt_consent_audits"("user_id", "created_at");

ALTER TABLE "merlt_user_preferences"
    ADD CONSTRAINT "merlt_user_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "merlt_consent_audits"
    ADD CONSTRAINT "merlt_consent_audits_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
