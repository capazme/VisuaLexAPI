-- Studia progress (spec docs/superpowers/specs/2026-10-13-studia-progress-design.md §5.1): the review goal
-- that makes a day count for the streak, and one row per user and Europe/Rome day of review.

-- AlterTable
ALTER TABLE "lingo_preferenze_studio" ADD COLUMN     "ripassi_al_giorno" INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "lingo_preferenze_studio" ADD CONSTRAINT "lingo_preferenze_studio_ripassi_al_giorno_check" CHECK ("ripassi_al_giorno" BETWEEN 1 AND 200);

-- CreateTable
CREATE TABLE "lingo_giornate_studio" (
    "utente_id" TEXT NOT NULL,
    "giorno" DATE NOT NULL,
    "ripassi" INTEGER NOT NULL DEFAULT 0,
    "nuove" INTEGER NOT NULL DEFAULT 0,
    "sbagliate" INTEGER NOT NULL DEFAULT 0,
    "coda_finita" BOOLEAN NOT NULL DEFAULT false,
    "valido" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lingo_giornate_studio_pkey" PRIMARY KEY ("utente_id","giorno")
);

-- AddForeignKey
ALTER TABLE "lingo_giornate_studio" ADD CONSTRAINT "lingo_giornate_studio_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: the past, from the review log. The log's columns are TIMESTAMP without a zone holding UTC, so
-- the instant is read as UTC first and then turned into Rome's calendar day (reading it straight as Rome
-- time would be off by one or two hours). «New» is a card's first review by that user. Whether a past
-- day's queue was finished cannot be known, so `coda_finita` stays false and a day counts with the
-- default goal of 10 reviews.
INSERT INTO "lingo_giornate_studio" ("utente_id", "giorno", "ripassi", "nuove", "sbagliate", "coda_finita", "valido", "updated_at")
SELECT "utente_id", "giorno", COUNT(*), COUNT(*) FILTER (WHERE "n" = 1), COUNT(*) FILTER (WHERE "rating" = 1), false, COUNT(*) >= 10, CURRENT_TIMESTAMP
FROM (
    SELECT "utente_id", "rating",
           (("data_revisione" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date AS "giorno",
           ROW_NUMBER() OVER (PARTITION BY "utente_id", "card_id" ORDER BY "data_revisione", "id") AS "n"
    FROM "lingo_revisioni_srs"
) AS "r"
GROUP BY "utente_id", "giorno";
