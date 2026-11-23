-- D8: glosses on a passage, and (G-381 (b)) the version of the consent words a grant of `dossier:text` was approved with.
--
-- Glosses. A gloss is an assistant's note anchored to a passage of a dossier entry, as a D7b
-- proposal is, with no colour: the coloured mark stays the user's gesture. Same anchoring (root rule 23), same
-- original position (`assistant_start_offset`, `assistant_text`), same boundary move, same note states.
-- Additive only: every existing highlight becomes a `mark`, keeps its colour, and is not otherwise rewritten.
-- The CHECKs are here, not in the Prisma model.

-- CreateEnum
CREATE TYPE "HighlightKind" AS ENUM ('mark', 'gloss');

-- AlterTable
ALTER TABLE "highlights" ADD COLUMN     "kind" "HighlightKind" NOT NULL DEFAULT 'mark',
ALTER COLUMN "color" DROP NOT NULL,
-- A mark has a colour, a gloss has none.
ADD CONSTRAINT "highlights_gloss_colour_check" CHECK (("kind" = 'gloss') = ("color" IS NULL)),
-- A gloss is an assistant's note with a state, and its shown text is never empty.
ADD CONSTRAINT "highlights_gloss_note_check" CHECK (
    "kind" <> 'gloss'
    OR ("created_by_client_id" IS NOT NULL AND "note_state" IS NOT NULL AND "note" IS NOT NULL AND char_length(btrim("note")) > 0)
);

-- G-381 (b): the text of the user's notes leaves under `dossier:text` only for a grant approved with the words that name
-- them («… e le tue note», version 1). The column serves the next change of those words.
-- AlterTable
ALTER TABLE "oauth_grants" ADD COLUMN     "text_consent_version" INTEGER;

-- G-385 (owners, 29 October 2026): there are no active users yet, so the grants that already hold `dossier:text` are
-- given version 1 and read the notes without connecting again. Only the new column is written.
UPDATE "oauth_grants" SET "text_consent_version" = 1 WHERE 'dossier:text' = ANY("scopes");
