-- Learn's short lesson (LC63; vault spec «Learn alla Duolingo - specifica (17-11)», §L2): 5–8 exercises the server
-- builds from the cards of the review scope and grades itself. One row per lesson, the person's (cascade with the
-- account): the exercises with their keys (copied, so a card trashed mid-lesson does not break it), the outcomes, the
-- moment it ended. The mission «Lezione» credits a finished lesson; its values are used by 20261117100001, since
-- Postgres refuses an enum value in the transaction that adds it.

ALTER TYPE "LingoMissione" ADD VALUE 'LEZIONE';
ALTER TYPE "LingoFonteXp" ADD VALUE 'LEZIONE';

-- CreateTable
CREATE TABLE "lingo_lezioni" (
    "id" TEXT NOT NULL,
    "utente_id" TEXT NOT NULL,
    "giorno" DATE NOT NULL,
    "materia" "LingoMateria" NOT NULL,
    "esercizi" JSONB NOT NULL,
    "esiti" JSONB NOT NULL DEFAULT '[]',
    "finita_il" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_lezioni_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "lingo_lezioni_esercizi_check" CHECK (jsonb_typeof("esercizi") = 'array' AND jsonb_array_length("esercizi") BETWEEN 5 AND 8),
    CONSTRAINT "lingo_lezioni_esiti_check" CHECK (jsonb_typeof("esiti") = 'array' AND jsonb_array_length("esiti") <= jsonb_array_length("esercizi"))
);

-- CreateIndex
CREATE INDEX "lingo_lezioni_utente_id_giorno_idx" ON "lingo_lezioni"("utente_id", "giorno");

-- AddForeignKey
ALTER TABLE "lingo_lezioni" ADD CONSTRAINT "lingo_lezioni_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
