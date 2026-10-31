-- The Forum's Community: discussion on someone's glossa (spec
-- docs/superpowers/specs/2026-10-20-forum-community-glosse-design.md §5.1, §7, §9). Written by hand,
-- applied with `prisma migrate deploy`.
--
-- - A glossa, a reply or a comment outlives its author's account, without an author (G-307): the
--   authors' foreign keys become SET NULL instead of CASCADE.
-- - A report names its item by a plain id (no foreign key), so it outlives the item, and keeps a copy
--   of the reported text for the moderators (G-308); the reporter becomes null with their account.
-- - Accepted answer, edit and deletion marks, a moderator's lock, the subject, the licence version each
--   contribution was written under, an explicit last activity for the feed.
-- - Notifications, the moderation log, the moderators' flag.
-- - Version 1 of the text CONTRIBUTO_COMMUNITY (CC BY-SA 4.0, G-310).

-- DropForeignKey
ALTER TABLE "article_comments" DROP CONSTRAINT "article_comments_user_id_fkey";

-- DropForeignKey
ALTER TABLE "article_thread_reports" DROP CONSTRAINT "article_thread_reports_thread_id_fkey";

-- DropForeignKey
ALTER TABLE "article_thread_reports" DROP CONSTRAINT "article_thread_reports_user_id_fkey";

-- DropForeignKey
ALTER TABLE "article_threads" DROP CONSTRAINT "article_threads_user_id_fkey";

-- AlterTable
ALTER TABLE "article_comments" ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "hidden_reason" TEXT,
ADD COLUMN     "licence_text_id" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "article_thread_reports" ADD COLUMN     "reported_text" TEXT,
ADD COLUMN     "resolution_note" TEXT,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "resolved_by" TEXT,
ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "article_threads" ADD COLUMN     "accepted_comment_id" TEXT,
ADD COLUMN     "deleted_at" TIMESTAMP(3),
ADD COLUMN     "edited_at" TIMESTAMP(3),
ADD COLUMN     "hidden_reason" TEXT,
ADD COLUMN     "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "licence_text_id" TEXT,
ADD COLUMN     "locked_at" TIMESTAMP(3),
ADD COLUMN     "locked_by" TEXT,
ADD COLUMN     "materia" "LingoMateria",
ALTER COLUMN "user_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "forum_moderator" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "article_comment_reports" (
    "id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reported_text" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,

    CONSTRAINT "article_comment_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "comment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "forum_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_moderation_log" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_moderation_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_comment_reports_status_idx" ON "article_comment_reports"("status");

-- CreateIndex
CREATE INDEX "article_comment_reports_user_id_idx" ON "article_comment_reports"("user_id");

-- CreateIndex
CREATE INDEX "article_comment_reports_resolved_by_idx" ON "article_comment_reports"("resolved_by");

-- CreateIndex
CREATE INDEX "article_comment_reports_resolved_at_idx" ON "article_comment_reports"("resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "article_comment_reports_comment_id_user_id_key" ON "article_comment_reports"("comment_id", "user_id");

-- CreateIndex
CREATE INDEX "forum_notifications_user_id_read_at_idx" ON "forum_notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "forum_notifications_thread_id_idx" ON "forum_notifications"("thread_id");

-- CreateIndex
CREATE INDEX "forum_notifications_comment_id_idx" ON "forum_notifications"("comment_id");

-- CreateIndex
CREATE INDEX "forum_notifications_read_at_idx" ON "forum_notifications"("read_at");

-- CreateIndex
CREATE INDEX "forum_moderation_log_actor_id_idx" ON "forum_moderation_log"("actor_id");

-- CreateIndex
CREATE INDEX "forum_moderation_log_target_kind_target_id_idx" ON "forum_moderation_log"("target_kind", "target_id");

-- CreateIndex
CREATE INDEX "forum_moderation_log_created_at_idx" ON "forum_moderation_log"("created_at");

-- CreateIndex
CREATE INDEX "article_comments_user_id_idx" ON "article_comments"("user_id");

-- CreateIndex
CREATE INDEX "article_comments_licence_text_id_idx" ON "article_comments"("licence_text_id");

-- CreateIndex
CREATE INDEX "article_thread_reports_user_id_idx" ON "article_thread_reports"("user_id");

-- CreateIndex
CREATE INDEX "article_thread_reports_resolved_by_idx" ON "article_thread_reports"("resolved_by");

-- CreateIndex
CREATE INDEX "article_thread_reports_resolved_at_idx" ON "article_thread_reports"("resolved_at");

-- CreateIndex
CREATE INDEX "article_threads_locked_by_idx" ON "article_threads"("locked_by");

-- CreateIndex
CREATE INDEX "article_threads_accepted_comment_id_idx" ON "article_threads"("accepted_comment_id");

-- CreateIndex
CREATE INDEX "article_threads_licence_text_id_idx" ON "article_threads"("licence_text_id");

-- CreateIndex
CREATE INDEX "article_threads_is_hidden_created_at_idx" ON "article_threads"("is_hidden", "created_at");

-- CreateIndex
CREATE INDEX "article_threads_is_hidden_last_activity_at_idx" ON "article_threads"("is_hidden", "last_activity_at");

-- AddForeignKey
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_accepted_comment_id_fkey" FOREIGN KEY ("accepted_comment_id") REFERENCES "article_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_licence_text_id_fkey" FOREIGN KEY ("licence_text_id") REFERENCES "lingo_testi_versioni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_licence_text_id_fkey" FOREIGN KEY ("licence_text_id") REFERENCES "lingo_testi_versioni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_thread_reports" ADD CONSTRAINT "article_thread_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_thread_reports" ADD CONSTRAINT "article_thread_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comment_reports" ADD CONSTRAINT "article_comment_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_comment_reports" ADD CONSTRAINT "article_comment_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_notifications" ADD CONSTRAINT "forum_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_notifications" ADD CONSTRAINT "forum_notifications_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_notifications" ADD CONSTRAINT "forum_notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "article_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_moderation_log" ADD CONSTRAINT "forum_moderation_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: the last activity of an existing glossa is its creation or its latest reply or comment.
-- (`updated_at` also moved on an administrator's hiding or release.)
UPDATE "article_threads" t
SET "last_activity_at" = GREATEST(
    t."created_at",
    COALESCE((SELECT MAX(c."created_at") FROM "article_comments" c WHERE c."thread_id" = t."id"), t."created_at")
);

-- Data: a report's free reason (the reader's panel sends «segnalazione») becomes «altro», its text
-- moved into the details; a status outside the closed list becomes pending again.
UPDATE "article_thread_reports"
SET "details" = LEFT(CASE WHEN "details" IS NULL OR "details" = '' THEN "reason" ELSE "reason" || ': ' || "details" END, 1000),
    "reason" = 'altro'
WHERE "reason" NOT IN ('offensivo', 'dati_personali', 'spam', 'fuori_tema', 'diritti', 'altro');

UPDATE "article_thread_reports" SET "status" = 'pending'
WHERE "status" NOT IN ('pending', 'resolved', 'dismissed');

-- Checks (not in Prisma's model). The closed lists of §5.7.
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_hidden_reason_check"
  CHECK ("hidden_reason" IS NULL OR "hidden_reason" IN ('offensivo', 'dati_personali', 'spam', 'fuori_tema', 'diritti', 'altro'));

ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_hidden_reason_check"
  CHECK ("hidden_reason" IS NULL OR "hidden_reason" IN ('offensivo', 'dati_personali', 'spam', 'fuori_tema', 'diritti', 'altro'));

-- What its author deleted is emptied, never kept (§5.5).
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_deleted_empty_check"
  CHECK ("deleted_at" IS NULL OR ("title" = '' AND "body" = ''));

ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_deleted_empty_check"
  CHECK ("deleted_at" IS NULL OR "body" = '');

-- A lock names its moderator only together with its time; the moderator may be deleted later.
ALTER TABLE "article_threads" ADD CONSTRAINT "article_threads_lock_check"
  CHECK ("locked_by" IS NULL OR "locked_at" IS NOT NULL);

ALTER TABLE "article_thread_reports" ADD CONSTRAINT "article_thread_reports_reason_check"
  CHECK ("reason" IN ('offensivo', 'dati_personali', 'spam', 'fuori_tema', 'diritti', 'altro'));

ALTER TABLE "article_thread_reports" ADD CONSTRAINT "article_thread_reports_status_check"
  CHECK ("status" IN ('pending', 'resolved', 'dismissed'));

ALTER TABLE "article_thread_reports" ADD CONSTRAINT "article_thread_reports_details_check"
  CHECK ("details" IS NULL OR char_length("details") <= 1000);

-- A closing names its moderator only together with its time.
ALTER TABLE "article_thread_reports" ADD CONSTRAINT "article_thread_reports_resolution_check"
  CHECK ("resolved_by" IS NULL OR "resolved_at" IS NOT NULL);

ALTER TABLE "article_comment_reports" ADD CONSTRAINT "article_comment_reports_reason_check"
  CHECK ("reason" IN ('offensivo', 'dati_personali', 'spam', 'fuori_tema', 'diritti', 'altro'));

ALTER TABLE "article_comment_reports" ADD CONSTRAINT "article_comment_reports_status_check"
  CHECK ("status" IN ('pending', 'resolved', 'dismissed'));

ALTER TABLE "article_comment_reports" ADD CONSTRAINT "article_comment_reports_details_check"
  CHECK ("details" IS NULL OR char_length("details") <= 1000);

ALTER TABLE "article_comment_reports" ADD CONSTRAINT "article_comment_reports_resolution_check"
  CHECK ("resolved_by" IS NULL OR "resolved_at" IS NOT NULL);

ALTER TABLE "forum_notifications" ADD CONSTRAINT "forum_notifications_kind_check"
  CHECK ("kind" IN ('reply', 'comment', 'accepted', 'hidden'));

-- A notification about a reply names it; one about a hidden glossa may not.
ALTER TABLE "forum_notifications" ADD CONSTRAINT "forum_notifications_comment_check"
  CHECK ("comment_id" IS NOT NULL OR "kind" = 'hidden');

ALTER TABLE "forum_moderation_log" ADD CONSTRAINT "forum_moderation_log_action_check"
  CHECK ("action" IN ('hide', 'unhide', 'lock', 'unlock', 'dismiss', 'release_passage', 'withhold_passage',
                      'appoint_moderator', 'revoke_moderator', 'empty'));

ALTER TABLE "forum_moderation_log" ADD CONSTRAINT "forum_moderation_log_target_kind_check"
  CHECK ("target_kind" IN ('thread', 'comment', 'report', 'user'));

-- Every act has its reason, 3 to 1000 characters. Releasing or withholding a decision's quotation may
-- still come without one while the reader's panel sends none (the spec's «pending PR2c»).
ALTER TABLE "forum_moderation_log" ADD CONSTRAINT "forum_moderation_log_reason_check"
  CHECK (
    ("reason" IS NOT NULL AND char_length("reason") BETWEEN 3 AND 1000)
    OR ("reason" IS NULL AND "action" IN ('release_passage', 'withhold_passage'))
  );

-- Version 1 of the text a contributor accepts before their first glossa, reply or comment (§7.2,
-- G-310). Written by the migration, hence no author; a change is a new version saved from the admin
-- screen, never an edit of this row.
INSERT INTO "lingo_testi_versioni" ("id", "chiave", "versione", "titolo", "corpo", "conferma", "azione", "autore_id")
VALUES (
    '513029f0-99c5-4e8d-b74f-81f5a8dd836a',
    'CONTRIBUTO_COMMUNITY',
    1,
    'Scrivere nella Community',
    'Le glosse, le risposte e i commenti che scrivi nella Community sono pubblici: li leggono tutti gli utenti di VisuaLex, con il tuo nome utente.

Pubblicandoli li metti a disposizione con la licenza Creative Commons Attribuzione – Condividi allo stesso modo 4.0 Internazionale (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/deed.it): chiunque può riprodurli, citarli e rielaborarli, indicando te come autore e condividendo ciò che ne ricava con la stessa licenza. La licenza vale per quello che scrivi da quando la accetti. Se questo testo cambia, ti chiediamo di nuovo di accettarlo.

Scrivi solo ciò che puoi pubblicare. Non inserire dati personali di altre persone (nomi di clienti o di controparti, codici fiscali, recapiti) né testi di altri oltre la citazione.

Puoi modificare o cancellare i tuoi contributi quando vuoi. Se altri hanno già risposto a una tua glossa, cancellandola ne resta il posto senza il tuo testo, perché le risposte appartengono ai loro autori. La licenza non si revoca per le copie che altri hanno già fatto.

Se elimini l''account, i contributi che non hai cancellato prima restano visibili, senza il tuo nome, come «utente cancellato». Cancella quindi, prima di eliminarlo, ciò che non vuoi lasciare; dopo, puoi ancora chiederne la cancellazione ai responsabili di VisuaLex.

I moderatori possono nascondere un contributo contrario alle regole della Community. Ogni loro intervento è registrato, con il motivo.',
    'Ho letto e accetto',
    'Pubblica',
    NULL
);
