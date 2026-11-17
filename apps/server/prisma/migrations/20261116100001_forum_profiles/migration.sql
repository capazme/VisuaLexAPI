-- The Forum's minimal profile (spec docs/superpowers/specs/2026-11-14-forum-community-server-design.md §B,
-- D-246, D-247, D-249, G-477, G-479). Written by hand, applied with `prisma migrate deploy`.
--
-- - One profile per person, under the real name or under a pseudonym, never both (G-477): nothing links
--   the two. Its id is the person's public id in the Forum, never the account's. Deleted with the account.
-- - The qualification is declared (D-247), and so is the real name (G-479): nothing records a check.
-- - «Non è chi dice di essere» (G-479): reports on a profile, read by the owners alone; confirming one
--   withdraws the name, on the record.

-- CreateTable
CREATE TABLE "forum_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "real_name" TEXT,
    "pseudonym" TEXT,
    "qualification" TEXT NOT NULL,
    "materie" "LingoMateria"[] NOT NULL DEFAULT ARRAY[]::"LingoMateria"[],
    "name_withdrawn_at" TIMESTAMP(3),
    "name_withdrawn_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_profile_reports" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "user_id" TEXT,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,

    CONSTRAINT "forum_profile_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "forum_profiles_user_id_key" ON "forum_profiles"("user_id");

-- CreateIndex
CREATE INDEX "forum_profile_reports_profile_id_idx" ON "forum_profile_reports"("profile_id");

-- CreateIndex
CREATE INDEX "forum_profile_reports_status_idx" ON "forum_profile_reports"("status");

-- CreateIndex
CREATE INDEX "forum_profile_reports_user_id_idx" ON "forum_profile_reports"("user_id");

-- CreateIndex
CREATE INDEX "forum_profile_reports_resolved_by_idx" ON "forum_profile_reports"("resolved_by");

-- CreateIndex
CREATE INDEX "forum_profile_reports_resolved_at_idx" ON "forum_profile_reports"("resolved_at");

-- AddForeignKey
ALTER TABLE "forum_profiles" ADD CONSTRAINT "forum_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_profile_reports" ADD CONSTRAINT "forum_profile_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forum_profile_reports" ADD CONSTRAINT "forum_profile_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes and checks (not in Prisma's model).

-- A pseudonym is one person's, without regard to case.
CREATE UNIQUE INDEX "forum_profiles_pseudonym_lower_key" ON "forum_profiles"(lower("pseudonym"));

-- One pending report per person per profile.
CREATE UNIQUE INDEX "forum_profile_reports_pending_key" ON "forum_profile_reports"("profile_id", "user_id") WHERE "status" = 'pending';

ALTER TABLE "forum_profiles" ADD CONSTRAINT "forum_profiles_identity_check"
  CHECK ("identity" IN ('real_name', 'pseudonym'));

-- The name matches the identity: a real name and no pseudonym, or the reverse. The forms (letters, and
-- which signs) are the server's; the database keeps the lengths.
ALTER TABLE "forum_profiles" ADD CONSTRAINT "forum_profiles_name_check"
  CHECK (
    ("identity" = 'real_name' AND "pseudonym" IS NULL AND "real_name" IS NOT NULL AND char_length("real_name") BETWEEN 3 AND 80)
    OR ("identity" = 'pseudonym' AND "real_name" IS NULL AND "pseudonym" IS NOT NULL AND char_length("pseudonym") BETWEEN 3 AND 30)
  );

ALTER TABLE "forum_profiles" ADD CONSTRAINT "forum_profiles_qualification_check"
  CHECK ("qualification" IN ('avvocato', 'praticante', 'magistrato', 'notaio', 'docente', 'dottore', 'studente', 'altro'));

-- A withdrawn name always says why, 3 to 1000 characters.
ALTER TABLE "forum_profiles" ADD CONSTRAINT "forum_profiles_name_withdrawn_check"
  CHECK (
    ("name_withdrawn_at" IS NULL AND "name_withdrawn_reason" IS NULL)
    OR ("name_withdrawn_at" IS NOT NULL AND "name_withdrawn_reason" IS NOT NULL
        AND char_length("name_withdrawn_reason") BETWEEN 3 AND 1000)
  );

ALTER TABLE "forum_profile_reports" ADD CONSTRAINT "forum_profile_reports_status_check"
  CHECK ("status" IN ('pending', 'confirmed', 'dismissed'));

ALTER TABLE "forum_profile_reports" ADD CONSTRAINT "forum_profile_reports_details_check"
  CHECK ("details" IS NULL OR char_length("details") <= 1000);

-- A closing names its owner only together with its time.
ALTER TABLE "forum_profile_reports" ADD CONSTRAINT "forum_profile_reports_resolution_check"
  CHECK ("resolved_by" IS NULL OR "resolved_at" IS NOT NULL);

-- The moderation log: withdrawing and giving back a name, on a profile.
ALTER TABLE "forum_moderation_log" DROP CONSTRAINT "forum_moderation_log_action_check";
ALTER TABLE "forum_moderation_log" ADD CONSTRAINT "forum_moderation_log_action_check"
  CHECK ("action" IN ('hide', 'unhide', 'lock', 'unlock', 'dismiss', 'release_passage', 'withhold_passage',
                      'appoint_moderator', 'revoke_moderator', 'empty', 'withdraw_name', 'restore_name'));

ALTER TABLE "forum_moderation_log" DROP CONSTRAINT "forum_moderation_log_target_kind_check";
ALTER TABLE "forum_moderation_log" ADD CONSTRAINT "forum_moderation_log_target_kind_check"
  CHECK ("target_kind" IN ('thread', 'comment', 'report', 'user', 'profile'));
