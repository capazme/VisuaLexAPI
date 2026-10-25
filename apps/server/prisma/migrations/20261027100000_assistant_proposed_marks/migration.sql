-- D7b, first cut: passages and notes written by an assistant, validated by hand (spec
-- docs/superpowers/specs/2026-10-23-mcp-next-tools-design.md §8, as the first cut revised it).
-- highlights: an assistant's mark (the connection, the dossier entry it was proposed on, where the model put it
-- and the user's move of its boundaries) and its note (the model's original, the state, the review comment,
-- the user's last edit). dossier_items: the same state for a note entry an assistant wrote.
-- assistant_note_versions: the versions an assistant replaced (second cut; nothing writes it yet).
-- app_switches: runtime switches, D7b's off by default (a missing row is off).
-- Every new column is nullable, so no existing highlight changes. Backfill: every note entry an assistant
-- wrote before starts as «da validare», with its text as the original (owner, 25 October 2026).
-- The CHECKs are here, not in the Prisma model.

-- CreateEnum
CREATE TYPE "AssistantNoteState" AS ENUM ('proposed', 'validated', 'review');

-- AlterTable
ALTER TABLE "highlights" ADD COLUMN     "assistant_note" TEXT,
ADD COLUMN     "assistant_start_offset" INTEGER,
ADD COLUMN     "assistant_text" TEXT,
ADD COLUMN     "created_by_client_id" TEXT,
ADD COLUMN     "created_by_client_name" TEXT,
ADD COLUMN     "dossier_item_id" TEXT,
ADD COLUMN     "note_edited_at" TIMESTAMP(3),
ADD COLUMN     "note_edited_by" TEXT,
ADD COLUMN     "note_state" "AssistantNoteState",
ADD COLUMN     "note_state_changed_at" TIMESTAMP(3),
ADD COLUMN     "range_edited_at" TIMESTAMP(3),
ADD COLUMN     "range_edited_by" TEXT,
ADD COLUMN     "review_comment" TEXT,
-- An assistant's mark names its entry and keeps where the model put it.
ADD CONSTRAINT "highlights_assistant_mark_check" CHECK (
    "created_by_client_id" IS NULL
    OR ("dossier_item_id" IS NOT NULL AND "assistant_text" IS NOT NULL AND "assistant_start_offset" IS NOT NULL)
),
-- Only an assistant's mark has an assistant's note, and every assistant's note has a state.
ADD CONSTRAINT "highlights_assistant_note_check" CHECK (
    ("assistant_note" IS NULL OR "created_by_client_id" IS NOT NULL)
    AND (("note_state" IS NULL) = ("assistant_note" IS NULL))
),
ADD CONSTRAINT "highlights_review_comment_check" CHECK ("review_comment" IS NULL OR char_length("review_comment") <= 500);

-- AlterTable
ALTER TABLE "dossier_items" ADD COLUMN     "assistant_note" TEXT,
ADD COLUMN     "note_edited_at" TIMESTAMP(3),
ADD COLUMN     "note_edited_by" TEXT,
ADD COLUMN     "note_state" "AssistantNoteState",
ADD COLUMN     "note_state_changed_at" TIMESTAMP(3),
ADD COLUMN     "review_comment" TEXT,
-- Only a note entry an assistant wrote has a state, and then it has its original text.
ADD CONSTRAINT "dossier_items_assistant_note_check" CHECK (
    ("note_state" IS NULL) = ("assistant_note" IS NULL)
    AND ("note_state" IS NULL OR ("item_type" = 'note' AND "created_by_client_id" IS NOT NULL))
),
ADD CONSTRAINT "dossier_items_review_comment_check" CHECK ("review_comment" IS NULL OR char_length("review_comment") <= 500);

-- Backfill: the note entries assistants wrote so far, «da validare» (their content is the note's text, a JSON string).
UPDATE "dossier_items"
SET "note_state" = 'proposed', "assistant_note" = "content" #>> '{}'
WHERE "item_type" = 'note' AND "created_by_client_id" IS NOT NULL AND jsonb_typeof("content") = 'string' AND "note_state" IS NULL;
-- The ones in the trash at this moment start «da validare» when they are restored (trash/trash.ts, `itemRow`).

-- CreateTable
CREATE TABLE "assistant_note_versions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "highlight_id" TEXT,
    "dossier_item_id" TEXT,
    "text" TEXT,
    "start_offset" INTEGER,
    "color" TEXT,
    "assistant_note" TEXT,
    "note" TEXT,
    "review_comment" TEXT,
    "client_name" TEXT,
    "replaced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_note_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "assistant_note_versions_target_check" CHECK (("highlight_id" IS NULL) <> ("dossier_item_id" IS NULL))
);

-- CreateTable
CREATE TABLE "app_switches" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,

    CONSTRAINT "app_switches_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "assistant_note_versions_user_id_highlight_id_idx" ON "assistant_note_versions"("user_id", "highlight_id");

-- CreateIndex
CREATE INDEX "assistant_note_versions_user_id_dossier_item_id_idx" ON "assistant_note_versions"("user_id", "dossier_item_id");

-- CreateIndex
CREATE INDEX "highlights_user_id_dossier_item_id_idx" ON "highlights"("user_id", "dossier_item_id");

-- AddForeignKey
ALTER TABLE "assistant_note_versions" ADD CONSTRAINT "assistant_note_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
