-- A Learn path's goal and exam date, the learner's (G-488; the web plan's item 26, D-250). Written by hand, applied
-- with `prisma migrate deploy`.
--
-- - On the enrolment, not on the course: from A3 several people can follow one course, each with their own exam.
-- - The goal is a kind from a closed list, with an optional sentence that needs a kind; the date is a Rome day.
-- - The route refuses a past date when it is set; a stored date stays once it passes, so it is not a CHECK here.

-- CreateEnum
CREATE TYPE "LingoCorsoObiettivo" AS ENUM ('ESAME_AVVOCATO', 'ESAME_MATERIA', 'AGGIORNAMENTO_NORMATIVO', 'ALTRO');

-- AlterTable
ALTER TABLE "lingo_corsi_iscrizioni" ADD COLUMN     "data_esame" DATE,
ADD COLUMN     "obiettivo" "LingoCorsoObiettivo",
ADD COLUMN     "obiettivo_nota" TEXT;

-- Checks (not in Prisma's model): the sentence, 1–200 characters, only with a kind.
ALTER TABLE "lingo_corsi_iscrizioni" ADD CONSTRAINT "lingo_corsi_iscrizioni_obiettivo_nota_check"
  CHECK ("obiettivo_nota" IS NULL OR ("obiettivo" IS NOT NULL AND char_length("obiettivo_nota") BETWEEN 1 AND 200));
