-- Gymnasium's experience points (spec docs/superpowers/specs/2026-10-20-gymnasium-xp-levels-design.md §5.2, §7).
-- The ledger lingo_crediti_xp: one credit per mission per period, append-only, removed only with the account
-- (cascade). The counter lingo_giornate_studio.voti: validation votes cast that day, for the mission «convalida».
-- The counter lingo_giornate_studio.ripassi_dovuti: that day's grades of a card already due, for «dovute» (G-334).
-- No backfill (G-317): the past cannot say which missions were done, so XP and both counters start at zero for everyone.
-- The CHECKs are here, not in the Prisma model, as for the other Studia tables.

-- CreateEnum
CREATE TYPE "LingoMissione" AS ENUM ('DOVUTE', 'NUOVE', 'OBIETTIVO', 'MATERIA_FERMA', 'SCRIVI', 'CONVALIDA', 'SETTIMANA', 'CONSOLIDA');

-- CreateEnum
CREATE TYPE "LingoFonteXp" AS ENUM ('REVISIONE', 'PROPOSTA', 'VOTO', 'LETTURA');

-- AlterTable
ALTER TABLE "lingo_giornate_studio" ADD COLUMN     "ripassi_dovuti" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voti" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "lingo_crediti_xp" (
    "id" TEXT NOT NULL,
    "utente_id" TEXT NOT NULL,
    "missione" "LingoMissione" NOT NULL,
    "periodo" TEXT NOT NULL,
    "giorno" DATE NOT NULL,
    "punti" INTEGER NOT NULL,
    "fonte" "LingoFonteXp" NOT NULL,
    "fonte_id" TEXT,
    "materia" "LingoMateria",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_crediti_xp_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lingo_crediti_xp_punti_check" CHECK ("punti" BETWEEN 1 AND 1000),
    -- A day for the daily missions (a later one, added with ALTER TYPE … ADD VALUE, is daily too), the Monday
    -- of a week for «settimana», once for «consolida».
    CONSTRAINT "lingo_crediti_xp_periodo_check" CHECK (
        ("missione" = 'SETTIMANA' AND "periodo" ~ '^S:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
        OR ("missione" = 'CONSOLIDA' AND "periodo" = 'U')
        OR ("missione" NOT IN ('SETTIMANA', 'CONSOLIDA') AND "periodo" ~ '^G:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    ),
    -- Every event but a read names its row (the review log row, the card, the vote).
    CONSTRAINT "lingo_crediti_xp_fonte_check" CHECK (("fonte" = 'LETTURA') = ("fonte_id" IS NULL))
);

-- CreateIndex
CREATE INDEX "lingo_crediti_xp_utente_id_giorno_idx" ON "lingo_crediti_xp"("utente_id", "giorno");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_crediti_xp_utente_id_missione_periodo_key" ON "lingo_crediti_xp"("utente_id", "missione", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_crediti_xp_missione_fonte_id_key" ON "lingo_crediti_xp"("missione", "fonte_id");

-- AddForeignKey
ALTER TABLE "lingo_crediti_xp" ADD CONSTRAINT "lingo_crediti_xp_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
