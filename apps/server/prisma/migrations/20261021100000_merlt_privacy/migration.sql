-- MERL-T data protection (spec docs/superpowers/specs/2026-10-13-merlt-data-protection-design.md).

-- AlterEnum
ALTER TYPE "LingoTestoChiave" ADD VALUE 'INFORMATIVA_MERLT';

-- AlterTable
ALTER TABLE "merlt_user_preferences" ADD COLUMN     "informativa_testo_id" TEXT;

-- AlterTable
ALTER TABLE "merlt_consent_audits" ADD COLUMN     "informativa_testo_id" TEXT;

-- CreateTable
CREATE TABLE "merlt_erasure_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" VARCHAR(30) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" VARCHAR(100),

    CONSTRAINT "merlt_erasure_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merlt_erasure_requests_next_attempt_at_idx" ON "merlt_erasure_requests"("next_attempt_at");

-- AddForeignKey
ALTER TABLE "merlt_user_preferences" ADD CONSTRAINT "merlt_user_preferences_informativa_testo_id_fkey" FOREIGN KEY ("informativa_testo_id") REFERENCES "lingo_testi_versioni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merlt_consent_audits" ADD CONSTRAINT "merlt_consent_audits_informativa_testo_id_fkey" FOREIGN KEY ("informativa_testo_id") REFERENCES "lingo_testi_versioni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
