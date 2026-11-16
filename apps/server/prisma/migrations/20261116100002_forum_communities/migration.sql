-- The Forum's communities by subject, their moderators and validators, validation, and the appeal to the
-- owners (spec docs/superpowers/specs/2026-11-14-forum-community-server-design.md §C; D-214, D-267, G-478).
-- Written by hand, applied with `prisma migrate deploy`.
--
-- - A community is one of Learn's five subjects; a glossa's `materia` places it.
-- - Moderators and validators per subject, appointed by the owners, on the record.
-- - One validation per validator per glossa or reply; an item is «validata» at a threshold the owners set
--   (Learn's settings table, a new key), and validation never hides or holds back anything (G-478).
-- - When an item was last hidden, so that an appeal belongs to one hiding; the appeals themselves.

-- The Forum's threshold in Learn's settings (G-478). Postgres takes a new enum value inside a transaction
-- but refuses to use it there: the CHECK below compares the key as text, so it does not use it.
ALTER TYPE "LingoImpostazioneChiave" ADD VALUE 'FORUM_SOGLIA_VALIDAZIONI';

ALTER TABLE "lingo_impostazioni" DROP CONSTRAINT "lingo_impostazioni_valore_check";
ALTER TABLE "lingo_impostazioni" ADD CONSTRAINT "lingo_impostazioni_valore_check" CHECK (
    ("chiave"::text = 'SOGLIA_APPROVAZIONI' AND "valore" BETWEEN 1 AND 5)
    OR ("chiave"::text = 'SOGLIA_ERRATE' AND "valore" BETWEEN 1 AND 3)
    OR ("chiave"::text = 'FORUM_SOGLIA_VALIDAZIONI' AND "valore" BETWEEN 1 AND 5)
);

-- AlterTable
ALTER TABLE "article_threads" ADD COLUMN "hidden_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "article_comments" ADD COLUMN "hidden_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "forum_moderation_log" ADD COLUMN "materia" "LingoMateria";

-- CreateTable
CREATE TABLE "forum_subject_roles" (
    "user_id" TEXT NOT NULL,
    "materia" "LingoMateria" NOT NULL,
    "role" TEXT NOT NULL,
    "appointed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_subject_roles_pkey" PRIMARY KEY ("user_id","materia","role")
);

-- CreateTable
CREATE TABLE "forum_validations" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT,
    "comment_id" TEXT,
    "validator_id" TEXT,
    "materia" "LingoMateria" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_validations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_appeals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    CONSTRAINT "forum_appeals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forum_subject_roles_materia_role_idx" ON "forum_subject_roles"("materia", "role");

-- CreateIndex
CREATE INDEX "forum_subject_roles_appointed_by_idx" ON "forum_subject_roles"("appointed_by");

-- CreateIndex
CREATE INDEX "forum_validations_validator_id_idx" ON "forum_validations"("validator_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_validations_thread_id_validator_id_key" ON "forum_validations"("thread_id", "validator_id");

-- CreateIndex
CREATE UNIQUE INDEX "forum_validations_comment_id_validator_id_key" ON "forum_validations"("comment_id", "validator_id");

-- CreateIndex
CREATE INDEX "forum_appeals_user_id_idx" ON "forum_appeals"("user_id");

-- CreateIndex
CREATE INDEX "forum_appeals_target_kind_target_id_idx" ON "forum_appeals"("target_kind", "target_id");

-- CreateIndex
CREATE INDEX "forum_appeals_status_idx" ON "forum_appeals"("status");

-- CreateIndex
CREATE INDEX "forum_appeals_thread_id_idx" ON "forum_appeals"("thread_id");

-- CreateIndex
CREATE INDEX "forum_appeals_decided_by_idx" ON "forum_appeals"("decided_by");

-- AddForeignKey
ALTER TABLE "forum_subject_roles" ADD CONSTRAINT "forum_subject_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_subject_roles" ADD CONSTRAINT "forum_subject_roles_appointed_by_fkey" FOREIGN KEY ("appointed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_validations" ADD CONSTRAINT "forum_validations_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_validations" ADD CONSTRAINT "forum_validations_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "article_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_validations" ADD CONSTRAINT "forum_validations_validator_id_fkey" FOREIGN KEY ("validator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_appeals" ADD CONSTRAINT "forum_appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_appeals" ADD CONSTRAINT "forum_appeals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: what is hidden today was hidden at its latest logged hiding, or at its last change.
UPDATE "article_threads" t
SET "hidden_at" = COALESCE(
    (SELECT MAX(l."created_at") FROM "forum_moderation_log" l
     WHERE l."action" = 'hide' AND l."target_kind" = 'thread' AND l."target_id" = t."id"),
    t."updated_at")
WHERE t."is_hidden";

UPDATE "article_comments" c
SET "hidden_at" = COALESCE(
    (SELECT MAX(l."created_at") FROM "forum_moderation_log" l
     WHERE l."action" = 'hide' AND l."target_kind" = 'comment' AND l."target_id" = c."id"),
    c."updated_at")
WHERE c."is_hidden";

-- Checks and indexes (not in Prisma's model).

ALTER TABLE "forum_subject_roles" ADD CONSTRAINT "forum_subject_roles_role_check"
  CHECK ("role" IN ('moderator', 'validator'));

-- A validation is of a glossa or of a reply, never both.
ALTER TABLE "forum_validations" ADD CONSTRAINT "forum_validations_target_check"
  CHECK (("thread_id" IS NULL) <> ("comment_id" IS NULL));

ALTER TABLE "forum_appeals" ADD CONSTRAINT "forum_appeals_target_kind_check"
  CHECK ("target_kind" IN ('thread', 'comment'));

ALTER TABLE "forum_appeals" ADD CONSTRAINT "forum_appeals_status_check"
  CHECK ("status" IN ('pending', 'upheld', 'rejected'));

ALTER TABLE "forum_appeals" ADD CONSTRAINT "forum_appeals_text_check"
  CHECK (char_length("text") BETWEEN 3 AND 2000);

-- A decision names its owner only together with its time.
ALTER TABLE "forum_appeals" ADD CONSTRAINT "forum_appeals_decision_check"
  CHECK ("decided_by" IS NULL OR "decided_at" IS NOT NULL);

-- At most one appeal pending on an item.
CREATE UNIQUE INDEX "forum_appeals_pending_key" ON "forum_appeals"("target_kind", "target_id") WHERE "status" = 'pending';

-- The moderation log: the validators' appointments and the rejected appeals.
ALTER TABLE "forum_moderation_log" DROP CONSTRAINT "forum_moderation_log_action_check";
ALTER TABLE "forum_moderation_log" ADD CONSTRAINT "forum_moderation_log_action_check"
  CHECK ("action" IN ('hide', 'unhide', 'lock', 'unlock', 'dismiss', 'release_passage', 'withhold_passage',
                      'appoint_moderator', 'revoke_moderator', 'empty', 'withdraw_name', 'restore_name',
                      'appoint_validator', 'revoke_validator', 'appeal_rejected'));

-- Notifications: an item validated, an appeal decided. A glossa's names no reply.
ALTER TABLE "forum_notifications" DROP CONSTRAINT "forum_notifications_kind_check";
ALTER TABLE "forum_notifications" ADD CONSTRAINT "forum_notifications_kind_check"
  CHECK ("kind" IN ('reply', 'comment', 'accepted', 'hidden', 'validated', 'appeal'));

ALTER TABLE "forum_notifications" DROP CONSTRAINT "forum_notifications_comment_check";
ALTER TABLE "forum_notifications" ADD CONSTRAINT "forum_notifications_comment_check"
  CHECK ("comment_id" IS NOT NULL OR "kind" IN ('hidden', 'validated', 'appeal'));
