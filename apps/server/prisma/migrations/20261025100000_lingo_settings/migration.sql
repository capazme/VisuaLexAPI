-- Studia validation thresholds set by an administrator (spec docs/superpowers/specs/2026-10-18-studia-validation-threshold-design.md).
-- Two keys, one row each, seeded with today's values (2 approvals, 1 «errata»), so nothing changes until an administrator
-- changes one. The range of each value is a CHECK here, not in the Prisma model. Every change is logged in
-- lingo_impostazioni_log, append-only.

-- CreateEnum
CREATE TYPE "LingoImpostazioneChiave" AS ENUM ('SOGLIA_APPROVAZIONI', 'SOGLIA_ERRATE');

-- CreateTable
CREATE TABLE "lingo_impostazioni" (
    "chiave" "LingoImpostazioneChiave" NOT NULL,
    "valore" INTEGER NOT NULL,
    "aggiornata_il" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornata_da" TEXT,

    CONSTRAINT "lingo_impostazioni_pkey" PRIMARY KEY ("chiave"),
    CONSTRAINT "lingo_impostazioni_valore_check" CHECK (
        ("chiave" = 'SOGLIA_APPROVAZIONI' AND "valore" BETWEEN 1 AND 5)
        OR ("chiave" = 'SOGLIA_ERRATE' AND "valore" BETWEEN 1 AND 3)
    )
);

-- CreateTable
CREATE TABLE "lingo_impostazioni_log" (
    "id" TEXT NOT NULL,
    "chiave" "LingoImpostazioneChiave" NOT NULL,
    "valore_precedente" INTEGER NOT NULL,
    "valore_nuovo" INTEGER NOT NULL,
    "utente_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_impostazioni_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lingo_impostazioni_log_chiave_created_at_idx" ON "lingo_impostazioni_log"("chiave", "created_at");

-- AddForeignKey
ALTER TABLE "lingo_impostazioni" ADD CONSTRAINT "lingo_impostazioni_aggiornata_da_fkey" FOREIGN KEY ("aggiornata_da") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_impostazioni_log" ADD CONSTRAINT "lingo_impostazioni_log_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed: today's values, as the defaults of lingo/validationRule.ts.
INSERT INTO "lingo_impostazioni" ("chiave", "valore") VALUES
    ('SOGLIA_APPROVAZIONI', 2),
    ('SOGLIA_ERRATE', 1);
