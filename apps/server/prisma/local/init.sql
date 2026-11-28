-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "login_count" INTEGER NOT NULL DEFAULT 0,
    "last_login_at" DATETIME,
    "notification_last_seen_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    "lingo_validatore" BOOLEAN NOT NULL DEFAULT false,
    "forum_moderator" BOOLEAN NOT NULL DEFAULT false,
    "dev_mode_allowed" BOOLEAN NOT NULL DEFAULT false,
    "dev_mode" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "web_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "label" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "last_used_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "expires_at" DATETIME NOT NULL,
    CONSTRAINT "web_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "merlt_user_preferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "consent_level" TEXT NOT NULL DEFAULT 'none',
    "contribution_enabled" BOOLEAN NOT NULL DEFAULT false,
    "validation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "graph_enabled" BOOLEAN NOT NULL DEFAULT true,
    "informativa_testo_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "merlt_user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "merlt_user_preferences_informativa_testo_id_fkey" FOREIGN KEY ("informativa_testo_id") REFERENCES "lingo_testi_versioni" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "merlt_consent_audits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "previous_level" TEXT,
    "next_level" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "reason" TEXT,
    "informativa_testo_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "merlt_consent_audits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "merlt_consent_audits_informativa_testo_id_fkey" FOREIGN KEY ("informativa_testo_id") REFERENCES "lingo_testi_versioni" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "merlt_erasure_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "last_error" TEXT,
    "confirm_again_at" DATETIME
);

-- CreateTable
CREATE TABLE "merlt_user_authority_cache" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "authority_score" REAL NOT NULL,
    "baseline_qual" TEXT NOT NULL,
    "track_record" REAL NOT NULL DEFAULT 0,
    "performance" REAL NOT NULL DEFAULT 0,
    "total_contributions" INTEGER NOT NULL DEFAULT 0,
    "synced_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "merlt_user_authority_cache_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "merlt_ingestion_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "article_urn" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "task_id" TEXT,
    "nodes_created" INTEGER,
    "edges_created" INTEGER,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "started_at" DATETIME,
    "completed_at" DATETIME,
    CONSTRAINT "merlt_ingestion_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "merlt_extraction_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "task_id" TEXT,
    "candidates_created" INTEGER,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "started_at" DATETIME,
    "completed_at" DATETIME,
    CONSTRAINT "merlt_extraction_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "merlt_qa_jobs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "consent_level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trace_id" TEXT,
    "partials" JSONB,
    "result" JSONB,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "started_at" DATETIME,
    "completed_at" DATETIME,
    CONSTRAINT "merlt_qa_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "norma_watches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "norma_key" TEXT NOT NULL,
    "norma_data" JSONB NOT NULL,
    "last_seen_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "norma_watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "norma_change_notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "watch_id" TEXT NOT NULL,
    "norma_key" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "read_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "norma_change_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "norma_change_notifications_watch_id_fkey" FOREIGN KEY ("watch_id") REFERENCES "norma_watches" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "folders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "icon" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "parent_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "folders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "folders" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "norma_key" TEXT NOT NULL,
    "norma_data" JSONB NOT NULL,
    "title" TEXT,
    "notes" TEXT,
    "tags" JSONB NOT NULL,
    "folder_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bookmarks_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "annotations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "norma_key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "annotation_type" TEXT NOT NULL DEFAULT 'note',
    "text_context" TEXT,
    "position" INTEGER,
    "bookmark_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    "source_suggestion_id" TEXT,
    "original_author_id" TEXT,
    CONSTRAINT "annotations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "annotations_bookmark_id_fkey" FOREIGN KEY ("bookmark_id") REFERENCES "bookmarks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "annotations_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "annotations_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "highlights" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "norma_key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "color" TEXT DEFAULT 'yellow',
    "start_offset" INTEGER NOT NULL,
    "end_offset" INTEGER NOT NULL,
    "note" TEXT,
    "bookmark_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "source_suggestion_id" TEXT,
    "original_author_id" TEXT,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "dossier_item_id" TEXT,
    "assistant_text" TEXT,
    "assistant_start_offset" INTEGER,
    "range_edited_at" DATETIME,
    "range_edited_by" TEXT,
    "assistant_note" TEXT,
    "note_state" TEXT,
    "note_state_changed_at" DATETIME,
    "review_comment" TEXT,
    "note_edited_at" DATETIME,
    "note_edited_by" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'mark',
    CONSTRAINT "highlights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "highlights_bookmark_id_fkey" FOREIGN KEY ("bookmark_id") REFERENCES "bookmarks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "highlights_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "highlights_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "highlights_assistant_mark_check" CHECK ("created_by_client_id" IS NULL OR ("dossier_item_id" IS NOT NULL AND "assistant_text" IS NOT NULL AND "assistant_start_offset" IS NOT NULL)),
    CONSTRAINT "highlights_assistant_note_check" CHECK (("assistant_note" IS NULL OR "created_by_client_id" IS NOT NULL) AND (("note_state" IS NULL) = ("assistant_note" IS NULL))),
    CONSTRAINT "highlights_gloss_colour_check" CHECK (("kind" = 'gloss') = ("color" IS NULL)),
    CONSTRAINT "highlights_gloss_note_check" CHECK ("kind" <> 'gloss' OR ("created_by_client_id" IS NOT NULL AND "note_state" IS NOT NULL AND "note" IS NOT NULL AND length(trim("note")) > 0)),
    CONSTRAINT "highlights_review_comment_check" CHECK ("review_comment" IS NULL OR (length("review_comment") <= 500 AND instr("review_comment", char(0)) = 0))
);

-- CreateTable
CREATE TABLE "dossiers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT,
    "tags" JSONB NOT NULL DEFAULT [],
    "kind" TEXT NOT NULL DEFAULT 'lavoro',
    "forum_blocked_at" DATETIME,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "source_suggestion_id" TEXT,
    "original_author_id" TEXT,
    CONSTRAINT "dossiers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "dossiers_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "dossiers_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dossier_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dossier_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "content" JSONB NOT NULL,
    "fingerprint" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "dossier_snapshots_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "dossier_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dossier_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'unread',
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "about_item_id" TEXT,
    "assistant_note" TEXT,
    "note_state" TEXT,
    "note_state_changed_at" DATETIME,
    "review_comment" TEXT,
    "note_edited_at" DATETIME,
    "note_edited_by" TEXT,
    CONSTRAINT "dossier_items_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "dossier_items_assistant_note_check" CHECK ((("note_state" IS NULL) = ("assistant_note" IS NULL)) AND ("note_state" IS NULL OR ("item_type" = 'note' AND "created_by_client_id" IS NOT NULL))),
    CONSTRAINT "dossier_items_review_comment_check" CHECK ("review_comment" IS NULL OR (length("review_comment") <= 500 AND instr("review_comment", char(0)) = 0))
);

-- CreateTable
CREATE TABLE "article_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "norma_key" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "article_label" TEXT,
    "version" TEXT,
    "passage_quote" TEXT,
    "passage_start" INTEGER,
    "passage_prefix" TEXT,
    "passage_suffix" TEXT,
    "article_urn" TEXT,
    "text_hash" TEXT,
    "target_kind" TEXT NOT NULL DEFAULT 'article',
    "decision_key" TEXT,
    "passage_released_at" DATETIME,
    "passage_released_by" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "user_id" TEXT,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "hidden_reason" TEXT,
    "hidden_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    "last_activity_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "accepted_comment_id" TEXT,
    "edited_at" DATETIME,
    "deleted_at" DATETIME,
    "locked_at" DATETIME,
    "locked_by" TEXT,
    "materia" TEXT,
    "licence_text_id" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "article_threads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "article_threads_passage_released_by_fkey" FOREIGN KEY ("passage_released_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "article_threads_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "article_threads_accepted_comment_id_fkey" FOREIGN KEY ("accepted_comment_id") REFERENCES "article_comments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "article_threads_licence_text_id_fkey" FOREIGN KEY ("licence_text_id") REFERENCES "lingo_testi_versioni" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "article_comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "body" TEXT NOT NULL,
    "user_id" TEXT,
    "is_hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    "hidden_reason" TEXT,
    "hidden_at" DATETIME,
    "edited_at" DATETIME,
    "deleted_at" DATETIME,
    "licence_text_id" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "article_comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "article_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "article_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "article_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "article_comments_licence_text_id_fkey" FOREIGN KEY ("licence_text_id") REFERENCES "lingo_testi_versioni" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "article_thread_votes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "article_thread_votes_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "article_thread_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "article_comment_votes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comment_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "article_comment_votes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "article_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "article_comment_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "article_thread_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "reported_text" TEXT,
    "resolved_by" TEXT,
    "resolved_at" DATETIME,
    "resolution_note" TEXT,
    CONSTRAINT "article_thread_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "article_thread_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "article_comment_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "comment_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "reported_text" TEXT,
    "resolved_by" TEXT,
    "resolved_at" DATETIME,
    "resolution_note" TEXT,
    CONSTRAINT "article_comment_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "article_comment_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "comment_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "read_at" DATETIME,
    CONSTRAINT "forum_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "forum_notifications_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "forum_notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "article_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_moderation_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "materia" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "forum_moderation_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_profiles" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "real_name" TEXT,
    "pseudonym" TEXT,
    "qualification" TEXT NOT NULL,
    "materie" JSONB NOT NULL DEFAULT [],
    "name_withdrawn_at" DATETIME,
    "name_withdrawn_reason" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "forum_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_subject_roles" (
    "user_id" TEXT NOT NULL,
    "materia" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "appointed_by" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),

    PRIMARY KEY ("user_id", "materia", "role"),
    CONSTRAINT "forum_subject_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "forum_subject_roles_appointed_by_fkey" FOREIGN KEY ("appointed_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_validations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT,
    "comment_id" TEXT,
    "validator_id" TEXT,
    "materia" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "forum_validations_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "article_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "forum_validations_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "article_comments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "forum_validations_validator_id_fkey" FOREIGN KEY ("validator_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_appeals" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "target_kind" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "decided_by" TEXT,
    "decided_at" DATETIME,
    "decision_note" TEXT,
    CONSTRAINT "forum_appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "forum_appeals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "forum_profile_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profile_id" TEXT NOT NULL,
    "user_id" TEXT,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "resolved_by" TEXT,
    "resolved_at" DATETIME,
    "resolution_note" TEXT,
    CONSTRAINT "forum_profile_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "forum_profile_reports_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "search_history" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "act_type" TEXT,
    "act_number" TEXT,
    "article" TEXT,
    "date" TEXT,
    "version" TEXT DEFAULT 'vigente',
    "decision_key" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "search_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "search_history_one_kind" CHECK (("act_type" IS NULL) <> ("decision_key" IS NULL))
);

-- CreateTable
CREATE TABLE "quick_norms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "search_params" JSONB NOT NULL,
    "source_url" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" DATETIME,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "source_suggestion_id" TEXT,
    "original_author_id" TEXT,
    CONSTRAINT "quick_norms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "quick_norms_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "quick_norms_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "custom_aliases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trigger" TEXT NOT NULL,
    "alias_type" TEXT NOT NULL,
    "expand_to" TEXT NOT NULL,
    "search_params" JSONB,
    "description" TEXT,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" DATETIME,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "source_suggestion_id" TEXT,
    "original_author_id" TEXT,
    CONSTRAINT "custom_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "custom_aliases_source_suggestion_id_fkey" FOREIGN KEY ("source_suggestion_id") REFERENCES "environment_suggestions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "custom_aliases_original_author_id_fkey" FOREIGN KEY ("original_author_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "environments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "author" TEXT,
    "version" TEXT,
    "category" TEXT,
    "color" TEXT,
    "tags" JSONB NOT NULL,
    "content" JSONB NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "environments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shared_environments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" JSONB NOT NULL,
    "include_notes" BOOLEAN NOT NULL DEFAULT true,
    "include_highlights" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT NOT NULL,
    "tags" JSONB NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "replaced_by_id" TEXT,
    "withdrawn_by_admin_at" DATETIME,
    "source_dossier_id" TEXT,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "shared_environments_source_dossier_id_fkey" FOREIGN KEY ("source_dossier_id") REFERENCES "dossiers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "shared_environments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shared_environment_likes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "env_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "shared_environment_likes_env_id_fkey" FOREIGN KEY ("env_id") REFERENCES "shared_environments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shared_environment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shared_environment_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "env_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "shared_environment_reports_env_id_fkey" FOREIGN KEY ("env_id") REFERENCES "shared_environments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shared_environment_reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "environment_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shared_environment_id" TEXT NOT NULL,
    "suggester_id" TEXT NOT NULL,
    "message" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "environment_suggestions_shared_environment_id_fkey" FOREIGN KEY ("shared_environment_id") REFERENCES "shared_environments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "environment_suggestions_suggester_id_fkey" FOREIGN KEY ("suggester_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suggestion_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "suggestion_id" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "review_note" TEXT,
    "reviewed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "suggestion_items_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "environment_suggestions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shared_environment_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shared_environment_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "changelog" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "shared_environment_versions_shared_environment_id_fkey" FOREIGN KEY ("shared_environment_id") REFERENCES "shared_environments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_tracce" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "materia" TEXT NOT NULL,
    "tipo_prova" TEXT NOT NULL DEFAULT 'ATTO_GIUDIZIARIO',
    "sotto_tipo_atto" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "testo_traccia" TEXT NOT NULL,
    "norme_riferimento" JSONB NOT NULL,
    "questioni_forma" JSONB NOT NULL,
    "questioni_sostanza" JSONB NOT NULL,
    "fonte_traccia" TEXT NOT NULL,
    "attiva" BOOLEAN NOT NULL DEFAULT true,
    "difficolta" INTEGER NOT NULL DEFAULT 3,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
);

-- CreateTable
CREATE TABLE "lingo_cards" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "autore_id" TEXT,
    "materia" TEXT NOT NULL,
    "istituto" TEXT NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'ISTITUTO_DEFINIZIONE',
    "domanda" TEXT NOT NULL,
    "risposta" TEXT NOT NULL,
    "spiegazione" TEXT,
    "stato" TEXT NOT NULL DEFAULT 'BOZZA_PERSONALE',
    "authority_score" REAL NOT NULL DEFAULT 0,
    "is_controversa" BOOLEAN NOT NULL DEFAULT false,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "proposta_testo_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    "modulo_id" TEXT,
    "da_percorso" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "lingo_cards_autore_id_fkey" FOREIGN KEY ("autore_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "lingo_cards_proposta_testo_id_fkey" FOREIGN KEY ("proposta_testo_id") REFERENCES "lingo_testi_versioni" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "lingo_cards_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_card_ancore" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "card_id" TEXT NOT NULL,
    "norma_key" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "urn" TEXT NOT NULL,
    "akn_fingerprint" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "ultima_verifica" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_card_ancore_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_validazioni_card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "card_id" TEXT NOT NULL,
    "utente_id" TEXT,
    "giudizio" TEXT NOT NULL,
    "motivazione" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_validazioni_card_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_validazioni_card_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_testi_versioni" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chiave" TEXT NOT NULL,
    "versione" INTEGER NOT NULL,
    "titolo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "conferma" TEXT NOT NULL,
    "azione" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "autore_id" TEXT,
    CONSTRAINT "lingo_testi_versioni_autore_id_fkey" FOREIGN KEY ("autore_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_accettazioni_testi" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "utente_id" TEXT NOT NULL,
    "testo_id" TEXT NOT NULL,
    "accepted_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_accettazioni_testi_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_accettazioni_testi_testo_id_fkey" FOREIGN KEY ("testo_id") REFERENCES "lingo_testi_versioni" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_stato_ripasso" (
    "utente_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "stability" REAL NOT NULL,
    "difficulty" REAL NOT NULL,
    "due_at" DATETIME NOT NULL,
    "last_review_at" DATETIME NOT NULL,
    "reps" INTEGER NOT NULL DEFAULT 1,
    "lapses" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("utente_id", "card_id"),
    CONSTRAINT "lingo_stato_ripasso_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_stato_ripasso_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_revisioni_srs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "utente_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "data_revisione" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "rating" INTEGER NOT NULL,
    "scheduled_days" INTEGER NOT NULL,
    "stability" REAL NOT NULL,
    "difficulty" REAL NOT NULL,
    "durata_ms" INTEGER,
    CONSTRAINT "lingo_revisioni_srs_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_revisioni_srs_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_preferenze_studio" (
    "utente_id" TEXT NOT NULL PRIMARY KEY,
    "nuove_al_giorno" INTEGER NOT NULL DEFAULT 20,
    "ripassi_al_giorno" INTEGER NOT NULL DEFAULT 10,
    "materie_comunita" JSONB NOT NULL DEFAULT [],
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "lingo_preferenze_studio_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_giornate_studio" (
    "utente_id" TEXT NOT NULL,
    "giorno" DATETIME NOT NULL,
    "ripassi" INTEGER NOT NULL DEFAULT 0,
    "ripassi_dovuti" INTEGER NOT NULL DEFAULT 0,
    "nuove" INTEGER NOT NULL DEFAULT 0,
    "sbagliate" INTEGER NOT NULL DEFAULT 0,
    "coda_finita" BOOLEAN NOT NULL DEFAULT false,
    "valido" BOOLEAN NOT NULL DEFAULT false,
    "voti" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,

    PRIMARY KEY ("utente_id", "giorno"),
    CONSTRAINT "lingo_giornate_studio_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_crediti_xp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "utente_id" TEXT NOT NULL,
    "missione" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "giorno" DATETIME NOT NULL,
    "punti" INTEGER NOT NULL,
    "fonte" TEXT NOT NULL,
    "fonte_id" TEXT,
    "materia" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_crediti_xp_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_lezioni" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "utente_id" TEXT NOT NULL,
    "giorno" DATETIME NOT NULL,
    "materia" TEXT NOT NULL,
    "esercizi" JSONB NOT NULL,
    "esiti" JSONB NOT NULL DEFAULT [],
    "finita_il" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_lezioni_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_impostazioni" (
    "chiave" TEXT NOT NULL PRIMARY KEY,
    "valore" INTEGER NOT NULL,
    "aggiornata_il" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "aggiornata_da" TEXT,
    CONSTRAINT "lingo_impostazioni_aggiornata_da_fkey" FOREIGN KEY ("aggiornata_da") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_impostazioni_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chiave" TEXT NOT NULL,
    "valore_precedente" INTEGER NOT NULL,
    "valore_nuovo" INTEGER NOT NULL,
    "utente_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_impostazioni_log_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "autore_id" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "materia" TEXT NOT NULL,
    "descrizione" TEXT,
    "moduli_previsti" INTEGER NOT NULL,
    "dichiarazione_testo_id" TEXT NOT NULL,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "lingo_corsi_autore_id_fkey" FOREIGN KEY ("autore_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_dichiarazione_testo_id_fkey" FOREIGN KEY ("dichiarazione_testo_id") REFERENCES "lingo_testi_versioni" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_competenze" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "corso_id" TEXT NOT NULL,
    "codice" TEXT NOT NULL,
    "ordine" INTEGER NOT NULL,
    "testo" TEXT NOT NULL,
    CONSTRAINT "lingo_corsi_competenze_corso_id_fkey" FOREIGN KEY ("corso_id") REFERENCES "lingo_corsi" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_moduli" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "corso_id" TEXT NOT NULL,
    "ordine" INTEGER NOT NULL,
    "titolo" TEXT NOT NULL,
    "minuti" INTEGER,
    "domande_prima" JSONB NOT NULL,
    "sostituisce_id" TEXT,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_corsi_moduli_corso_id_fkey" FOREIGN KEY ("corso_id") REFERENCES "lingo_corsi" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_moduli_sostituisce_id_fkey" FOREIGN KEY ("sostituisce_id") REFERENCES "lingo_corsi_moduli" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_moduli_competenze" (
    "modulo_id" TEXT NOT NULL,
    "competenza_id" TEXT NOT NULL,

    PRIMARY KEY ("modulo_id", "competenza_id"),
    CONSTRAINT "lingo_corsi_moduli_competenze_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_moduli_competenze_competenza_id_fkey" FOREIGN KEY ("competenza_id") REFERENCES "lingo_corsi_competenze" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_blocchi" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modulo_id" TEXT NOT NULL,
    "ordine" INTEGER NOT NULL,
    "titolo" TEXT,
    "testo" TEXT NOT NULL,
    "parole" INTEGER NOT NULL,
    "citazioni" JSONB NOT NULL,
    CONSTRAINT "lingo_corsi_blocchi_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_esami" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "corso_id" TEXT NOT NULL,
    "iscrizione_id" TEXT,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_corsi_esami_corso_id_fkey" FOREIGN KEY ("corso_id") REFERENCES "lingo_corsi" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_esami_iscrizione_id_fkey" FOREIGN KEY ("iscrizione_id") REFERENCES "lingo_corsi_iscrizioni" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_domande" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modulo_id" TEXT,
    "esame_id" TEXT,
    "blocco_id" TEXT,
    "tipo" TEXT NOT NULL,
    "applicazione" BOOLEAN NOT NULL DEFAULT false,
    "ordine" INTEGER NOT NULL,
    "testo" TEXT NOT NULL,
    "opzioni" JSONB,
    "corretta" TEXT,
    "risposta_modello" TEXT,
    "rubrica" JSONB,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_corsi_domande_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_domande_esame_id_fkey" FOREIGN KEY ("esame_id") REFERENCES "lingo_corsi_esami" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_domande_blocco_id_fkey" FOREIGN KEY ("blocco_id") REFERENCES "lingo_corsi_blocchi" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_domande_competenze" (
    "domanda_id" TEXT NOT NULL,
    "competenza_id" TEXT NOT NULL,

    PRIMARY KEY ("domanda_id", "competenza_id"),
    CONSTRAINT "lingo_corsi_domande_competenze_domanda_id_fkey" FOREIGN KEY ("domanda_id") REFERENCES "lingo_corsi_domande" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_domande_competenze_competenza_id_fkey" FOREIGN KEY ("competenza_id") REFERENCES "lingo_corsi_competenze" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_iscrizioni" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "corso_id" TEXT NOT NULL,
    "utente_id" TEXT NOT NULL,
    "dossier_id" TEXT,
    "superato_il" DATETIME,
    "obiettivo" TEXT,
    "obiettivo_nota" TEXT,
    "data_esame" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "lingo_corsi_iscrizioni_corso_id_fkey" FOREIGN KEY ("corso_id") REFERENCES "lingo_corsi" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_iscrizioni_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_iscrizioni_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_moduli_stati" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "iscrizione_id" TEXT NOT NULL,
    "modulo_id" TEXT NOT NULL,
    "aperto_il" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "fatto_il" DATETIME,
    "fatto_giorno" DATETIME,
    "quiz_percentuale" INTEGER,
    "giudizio" INTEGER,
    "giudizio_nota" TEXT,
    "ritirato_il" DATETIME,
    CONSTRAINT "lingo_corsi_moduli_stati_iscrizione_id_fkey" FOREIGN KEY ("iscrizione_id") REFERENCES "lingo_corsi_iscrizioni" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_moduli_stati_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_esiti" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "iscrizione_id" TEXT NOT NULL,
    "domanda_id" TEXT NOT NULL,
    "tentativo_id" TEXT,
    "scelta" TEXT,
    "corretto" BOOLEAN,
    "spuntate" JSONB NOT NULL DEFAULT [],
    "giorno" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "segnalato_il" DATETIME,
    "segnalazione" TEXT,
    CONSTRAINT "lingo_corsi_esiti_iscrizione_id_fkey" FOREIGN KEY ("iscrizione_id") REFERENCES "lingo_corsi_iscrizioni" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_esiti_domanda_id_fkey" FOREIGN KEY ("domanda_id") REFERENCES "lingo_corsi_domande" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_esiti_tentativo_id_fkey" FOREIGN KEY ("tentativo_id") REFERENCES "lingo_corsi_tentativi" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_corsi_tentativi" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "iscrizione_id" TEXT NOT NULL,
    "esame_id" TEXT NOT NULL,
    "aperto_il" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "consegnato_il" DATETIME,
    "giorno" DATETIME,
    "percentuale" INTEGER,
    "superato" BOOLEAN,
    "per_competenza" JSONB,
    CONSTRAINT "lingo_corsi_tentativi_iscrizione_id_fkey" FOREIGN KEY ("iscrizione_id") REFERENCES "lingo_corsi_iscrizioni" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_corsi_tentativi_esame_id_fkey" FOREIGN KEY ("esame_id") REFERENCES "lingo_corsi_esami" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lingo_card_competenze" (
    "card_id" TEXT NOT NULL,
    "competenza_id" TEXT NOT NULL,

    PRIMARY KEY ("card_id", "competenza_id"),
    CONSTRAINT "lingo_card_competenze_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "lingo_card_competenze_competenza_id_fkey" FOREIGN KEY ("competenza_id") REFERENCES "lingo_corsi_competenze" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_clients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_name" TEXT,
    "redirect_uris" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))
);

-- CreateTable
CREATE TABLE "oauth_authorization_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "state" TEXT,
    "scopes" JSONB NOT NULL,
    "resource" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "decided_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "oauth_authorization_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_authorization_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "oauth_authorization_codes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_authorization_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_authorization_codes_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_grants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "resource" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "last_used_at" DATETIME,
    "revoked_at" DATETIME,
    "text_consent_version" INTEGER,
    CONSTRAINT "oauth_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_grants_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "oauth_clients" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token_hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "grant_id" TEXT NOT NULL,
    "chain_id" TEXT NOT NULL,
    "scopes" JSONB NOT NULL,
    "resource" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "rotated_at" DATETIME,
    "revoked_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "oauth_tokens_grant_id_fkey" FOREIGN KEY ("grant_id") REFERENCES "oauth_grants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "trash_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dossier_id" TEXT,
    "label" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "grant_id" TEXT,
    "deleted_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "expires_at" DATETIME NOT NULL,
    CONSTRAINT "trash_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "assistant_note_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "replaced_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "assistant_note_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "assistant_note_versions_target_check" CHECK (("highlight_id" IS NULL) <> ("dossier_item_id" IS NULL))
);

-- CreateTable
CREATE TABLE "app_switches" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_by" TEXT
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "dossier_id" TEXT,
    "dossier_item_id" TEXT,
    "parent_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 4,
    "labels" JSONB NOT NULL DEFAULT [],
    "planned_date" DATETIME,
    "planned_time" DATETIME,
    "due_date" DATETIME,
    "due_time" DATETIME,
    "recurrence" TEXT,
    "recurrence_from" TEXT NOT NULL DEFAULT 'pianificata',
    "recurrence_day" INTEGER,
    "duration_minutes" INTEGER,
    "assignee_id" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'lavoro',
    "completed_at" DATETIME,
    "deleted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_dossier_item_id_fkey" FOREIGN KEY ("dossier_item_id") REFERENCES "dossier_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "tasks_priority_check" CHECK ("priority" >= 1 AND "priority" <= 4),
    CONSTRAINT "tasks_planned_time_check" CHECK ("planned_time" IS NULL OR "planned_date" IS NOT NULL),
    CONSTRAINT "tasks_due_time_check" CHECK ("due_time" IS NULL OR "due_date" IS NOT NULL),
    CONSTRAINT "tasks_duration_minutes_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" > 0),
    CONSTRAINT "tasks_recurrence_day_check" CHECK ("recurrence_day" IS NULL OR ("recurrence_day" >= 1 AND "recurrence_day" <= 31)),
    CONSTRAINT "tasks_parent_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

-- CreateTable
CREATE TABLE "atti" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "dossier_id" TEXT,
    "titolo" TEXT NOT NULL,
    "tipo" TEXT,
    "testo" TEXT NOT NULL DEFAULT '',
    "stato" TEXT NOT NULL DEFAULT 'bozza',
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    CONSTRAINT "atti_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "atti_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pratica_files" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "peso" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "versione_di" TEXT,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "autore" TEXT NOT NULL DEFAULT 'utente',
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "pseudonimizzato" BOOLEAN NOT NULL DEFAULT false,
    "chiave_cifrata" BLOB NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    "deleted_at" DATETIME,
    CONSTRAINT "pratica_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pratica_istruzioni" (
    "dossier_id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "testo" TEXT NOT NULL DEFAULT '',
    "updated_by_client_id" TEXT,
    "updated_by_client_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "pratica_istruzioni_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "pratica_file_accessi" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "file_id" TEXT,
    "azione" TEXT NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f+00:00','now')),
    CONSTRAINT "pratica_file_accessi_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "web_sessions_secret_hash_key" ON "web_sessions"("secret_hash");

-- CreateIndex
CREATE INDEX "web_sessions_user_id_idx" ON "web_sessions"("user_id");

-- CreateIndex
CREATE INDEX "web_sessions_expires_at_idx" ON "web_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "merlt_user_preferences_user_id_key" ON "merlt_user_preferences"("user_id");

-- CreateIndex
CREATE INDEX "merlt_user_preferences_consent_level_idx" ON "merlt_user_preferences"("consent_level");

-- CreateIndex
CREATE INDEX "merlt_consent_audits_user_id_created_at_idx" ON "merlt_consent_audits"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "merlt_erasure_requests_next_attempt_at_idx" ON "merlt_erasure_requests"("next_attempt_at");

-- CreateIndex
CREATE INDEX "merlt_ingestion_jobs_article_urn_status_idx" ON "merlt_ingestion_jobs"("article_urn", "status");

-- CreateIndex
CREATE INDEX "merlt_ingestion_jobs_user_id_idx" ON "merlt_ingestion_jobs"("user_id");

-- CreateIndex
CREATE INDEX "merlt_extraction_jobs_document_id_status_idx" ON "merlt_extraction_jobs"("document_id", "status");

-- CreateIndex
CREATE INDEX "merlt_extraction_jobs_user_id_idx" ON "merlt_extraction_jobs"("user_id");

-- CreateIndex
CREATE INDEX "merlt_qa_jobs_user_id_idx" ON "merlt_qa_jobs"("user_id");

-- CreateIndex
CREATE INDEX "norma_watches_user_id_idx" ON "norma_watches"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "norma_watches_user_id_norma_key_key" ON "norma_watches"("user_id", "norma_key");

-- CreateIndex
CREATE INDEX "norma_change_notifications_user_id_read_at_idx" ON "norma_change_notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "norma_change_notifications_watch_id_idx" ON "norma_change_notifications"("watch_id");

-- CreateIndex
CREATE INDEX "folders_user_id_idx" ON "folders"("user_id");

-- CreateIndex
CREATE INDEX "folders_parent_id_idx" ON "folders"("parent_id");

-- CreateIndex
CREATE INDEX "bookmarks_user_id_idx" ON "bookmarks"("user_id");

-- CreateIndex
CREATE INDEX "bookmarks_folder_id_idx" ON "bookmarks"("folder_id");

-- CreateIndex
CREATE INDEX "bookmarks_norma_key_idx" ON "bookmarks"("norma_key");

-- CreateIndex
CREATE INDEX "annotations_user_id_idx" ON "annotations"("user_id");

-- CreateIndex
CREATE INDEX "annotations_bookmark_id_idx" ON "annotations"("bookmark_id");

-- CreateIndex
CREATE INDEX "annotations_norma_key_idx" ON "annotations"("norma_key");

-- CreateIndex
CREATE INDEX "highlights_user_id_idx" ON "highlights"("user_id");

-- CreateIndex
CREATE INDEX "highlights_bookmark_id_idx" ON "highlights"("bookmark_id");

-- CreateIndex
CREATE INDEX "highlights_norma_key_idx" ON "highlights"("norma_key");

-- CreateIndex
CREATE INDEX "highlights_user_id_dossier_item_id_idx" ON "highlights"("user_id", "dossier_item_id");

-- CreateIndex
CREATE INDEX "dossiers_user_id_idx" ON "dossiers"("user_id");

-- CreateIndex
CREATE INDEX "dossier_snapshots_dossier_id_created_at_idx" ON "dossier_snapshots"("dossier_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "dossier_snapshots_dossier_id_version_key" ON "dossier_snapshots"("dossier_id", "version");

-- CreateIndex
CREATE INDEX "dossier_items_dossier_id_idx" ON "dossier_items"("dossier_id");

-- CreateIndex
CREATE INDEX "article_threads_norma_key_article_id_created_at_idx" ON "article_threads"("norma_key", "article_id", "created_at");

-- CreateIndex
CREATE INDEX "article_threads_user_id_idx" ON "article_threads"("user_id");

-- CreateIndex
CREATE INDEX "article_threads_passage_released_by_idx" ON "article_threads"("passage_released_by");

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

-- CreateIndex
CREATE INDEX "article_threads_is_hidden_score_idx" ON "article_threads"("is_hidden", "score");

-- CreateIndex
CREATE INDEX "article_comments_thread_id_created_at_idx" ON "article_comments"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "article_comments_parent_id_idx" ON "article_comments"("parent_id");

-- CreateIndex
CREATE INDEX "article_comments_user_id_idx" ON "article_comments"("user_id");

-- CreateIndex
CREATE INDEX "article_comments_licence_text_id_idx" ON "article_comments"("licence_text_id");

-- CreateIndex
CREATE INDEX "article_thread_votes_user_id_idx" ON "article_thread_votes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_thread_votes_thread_id_user_id_key" ON "article_thread_votes"("thread_id", "user_id");

-- CreateIndex
CREATE INDEX "article_comment_votes_user_id_idx" ON "article_comment_votes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "article_comment_votes_comment_id_user_id_key" ON "article_comment_votes"("comment_id", "user_id");

-- CreateIndex
CREATE INDEX "article_thread_reports_status_idx" ON "article_thread_reports"("status");

-- CreateIndex
CREATE INDEX "article_thread_reports_user_id_idx" ON "article_thread_reports"("user_id");

-- CreateIndex
CREATE INDEX "article_thread_reports_resolved_by_idx" ON "article_thread_reports"("resolved_by");

-- CreateIndex
CREATE INDEX "article_thread_reports_resolved_at_idx" ON "article_thread_reports"("resolved_at");

-- CreateIndex
CREATE UNIQUE INDEX "article_thread_reports_thread_id_user_id_key" ON "article_thread_reports"("thread_id", "user_id");

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
CREATE UNIQUE INDEX "forum_profiles_user_id_key" ON "forum_profiles"("user_id");

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

-- CreateIndex
CREATE INDEX "feedbacks_user_id_idx" ON "feedbacks"("user_id");

-- CreateIndex
CREATE INDEX "feedbacks_status_idx" ON "feedbacks"("status");

-- CreateIndex
CREATE INDEX "feedbacks_type_idx" ON "feedbacks"("type");

-- CreateIndex
CREATE INDEX "search_history_user_id_idx" ON "search_history"("user_id");

-- CreateIndex
CREATE INDEX "search_history_created_at_idx" ON "search_history"("created_at");

-- CreateIndex
CREATE INDEX "quick_norms_user_id_idx" ON "quick_norms"("user_id");

-- CreateIndex
CREATE INDEX "custom_aliases_user_id_idx" ON "custom_aliases"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_aliases_user_id_trigger_key" ON "custom_aliases"("user_id", "trigger");

-- CreateIndex
CREATE INDEX "environments_user_id_idx" ON "environments"("user_id");

-- CreateIndex
CREATE INDEX "environments_category_idx" ON "environments"("category");

-- CreateIndex
CREATE INDEX "environments_created_at_idx" ON "environments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "shared_environments_source_dossier_id_key" ON "shared_environments"("source_dossier_id");

-- CreateIndex
CREATE INDEX "shared_environments_user_id_idx" ON "shared_environments"("user_id");

-- CreateIndex
CREATE INDEX "shared_environments_category_idx" ON "shared_environments"("category");

-- CreateIndex
CREATE INDEX "shared_environments_created_at_idx" ON "shared_environments"("created_at");

-- CreateIndex
CREATE INDEX "shared_environments_is_active_idx" ON "shared_environments"("is_active");

-- CreateIndex
CREATE INDEX "shared_environment_likes_env_id_idx" ON "shared_environment_likes"("env_id");

-- CreateIndex
CREATE INDEX "shared_environment_likes_user_id_idx" ON "shared_environment_likes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shared_environment_likes_env_id_user_id_key" ON "shared_environment_likes"("env_id", "user_id");

-- CreateIndex
CREATE INDEX "shared_environment_reports_env_id_idx" ON "shared_environment_reports"("env_id");

-- CreateIndex
CREATE INDEX "shared_environment_reports_status_idx" ON "shared_environment_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "shared_environment_reports_env_id_user_id_key" ON "shared_environment_reports"("env_id", "user_id");

-- CreateIndex
CREATE INDEX "environment_suggestions_shared_environment_id_idx" ON "environment_suggestions"("shared_environment_id");

-- CreateIndex
CREATE INDEX "environment_suggestions_suggester_id_idx" ON "environment_suggestions"("suggester_id");

-- CreateIndex
CREATE INDEX "suggestion_items_suggestion_id_status_idx" ON "suggestion_items"("suggestion_id", "status");

-- CreateIndex
CREATE INDEX "shared_environment_versions_shared_environment_id_idx" ON "shared_environment_versions"("shared_environment_id");

-- CreateIndex
CREATE UNIQUE INDEX "shared_environment_versions_shared_environment_id_version_key" ON "shared_environment_versions"("shared_environment_id", "version");

-- CreateIndex
CREATE INDEX "lingo_tracce_materia_tipo_prova_sotto_tipo_atto_idx" ON "lingo_tracce"("materia", "tipo_prova", "sotto_tipo_atto");

-- CreateIndex
CREATE INDEX "lingo_cards_materia_istituto_stato_idx" ON "lingo_cards"("materia", "istituto", "stato");

-- CreateIndex
CREATE INDEX "lingo_cards_stato_idx" ON "lingo_cards"("stato");

-- CreateIndex
CREATE INDEX "lingo_cards_autore_id_idx" ON "lingo_cards"("autore_id");

-- CreateIndex
CREATE INDEX "lingo_cards_modulo_id_idx" ON "lingo_cards"("modulo_id");

-- CreateIndex
CREATE INDEX "lingo_card_ancore_norma_key_article_id_akn_fingerprint_idx" ON "lingo_card_ancore"("norma_key", "article_id", "akn_fingerprint");

-- CreateIndex
CREATE INDEX "lingo_card_ancore_card_id_idx" ON "lingo_card_ancore"("card_id");

-- CreateIndex
CREATE INDEX "lingo_validazioni_card_utente_id_idx" ON "lingo_validazioni_card"("utente_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_validazioni_card_card_id_utente_id_key" ON "lingo_validazioni_card"("card_id", "utente_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_testi_versioni_chiave_versione_key" ON "lingo_testi_versioni"("chiave", "versione");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_accettazioni_testi_utente_id_testo_id_key" ON "lingo_accettazioni_testi"("utente_id", "testo_id");

-- CreateIndex
CREATE INDEX "lingo_stato_ripasso_utente_id_due_at_idx" ON "lingo_stato_ripasso"("utente_id", "due_at");

-- CreateIndex
CREATE INDEX "lingo_revisioni_srs_utente_id_card_id_data_revisione_idx" ON "lingo_revisioni_srs"("utente_id", "card_id", "data_revisione");

-- CreateIndex
CREATE INDEX "lingo_revisioni_srs_utente_id_data_revisione_idx" ON "lingo_revisioni_srs"("utente_id", "data_revisione");

-- CreateIndex
CREATE INDEX "lingo_crediti_xp_utente_id_giorno_idx" ON "lingo_crediti_xp"("utente_id", "giorno");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_crediti_xp_utente_id_missione_periodo_key" ON "lingo_crediti_xp"("utente_id", "missione", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_crediti_xp_missione_fonte_id_key" ON "lingo_crediti_xp"("missione", "fonte_id");

-- CreateIndex
CREATE INDEX "lingo_lezioni_utente_id_giorno_idx" ON "lingo_lezioni"("utente_id", "giorno");

-- CreateIndex
CREATE INDEX "lingo_impostazioni_log_chiave_created_at_idx" ON "lingo_impostazioni_log"("chiave", "created_at");

-- CreateIndex
CREATE INDEX "lingo_corsi_autore_id_idx" ON "lingo_corsi"("autore_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_corsi_competenze_corso_id_codice_key" ON "lingo_corsi_competenze"("corso_id", "codice");

-- CreateIndex
CREATE INDEX "lingo_corsi_moduli_corso_id_ordine_idx" ON "lingo_corsi_moduli"("corso_id", "ordine");

-- CreateIndex
CREATE INDEX "lingo_corsi_moduli_sostituisce_id_idx" ON "lingo_corsi_moduli"("sostituisce_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_moduli_competenze_competenza_id_idx" ON "lingo_corsi_moduli_competenze"("competenza_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_corsi_blocchi_modulo_id_ordine_key" ON "lingo_corsi_blocchi"("modulo_id", "ordine");

-- CreateIndex
CREATE INDEX "lingo_corsi_esami_corso_id_idx" ON "lingo_corsi_esami"("corso_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_esami_iscrizione_id_idx" ON "lingo_corsi_esami"("iscrizione_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_domande_modulo_id_idx" ON "lingo_corsi_domande"("modulo_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_domande_esame_id_idx" ON "lingo_corsi_domande"("esame_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_domande_blocco_id_idx" ON "lingo_corsi_domande"("blocco_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_domande_competenze_competenza_id_idx" ON "lingo_corsi_domande_competenze"("competenza_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_iscrizioni_utente_id_idx" ON "lingo_corsi_iscrizioni"("utente_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_iscrizioni_dossier_id_idx" ON "lingo_corsi_iscrizioni"("dossier_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_corsi_iscrizioni_corso_id_utente_id_key" ON "lingo_corsi_iscrizioni"("corso_id", "utente_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_moduli_stati_modulo_id_idx" ON "lingo_corsi_moduli_stati"("modulo_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_corsi_moduli_stati_iscrizione_id_modulo_id_key" ON "lingo_corsi_moduli_stati"("iscrizione_id", "modulo_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_esiti_iscrizione_id_giorno_idx" ON "lingo_corsi_esiti"("iscrizione_id", "giorno");

-- CreateIndex
CREATE INDEX "lingo_corsi_esiti_domanda_id_idx" ON "lingo_corsi_esiti"("domanda_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_esiti_tentativo_id_idx" ON "lingo_corsi_esiti"("tentativo_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_corsi_esiti_iscrizione_id_domanda_id_key" ON "lingo_corsi_esiti"("iscrizione_id", "domanda_id");

-- CreateIndex
CREATE INDEX "lingo_corsi_tentativi_esame_id_idx" ON "lingo_corsi_tentativi"("esame_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_corsi_tentativi_iscrizione_id_esame_id_key" ON "lingo_corsi_tentativi"("iscrizione_id", "esame_id");

-- CreateIndex
CREATE INDEX "lingo_card_competenze_competenza_id_idx" ON "lingo_card_competenze"("competenza_id");

-- CreateIndex
CREATE INDEX "oauth_clients_created_at_idx" ON "oauth_clients"("created_at");

-- CreateIndex
CREATE INDEX "oauth_authorization_requests_client_id_idx" ON "oauth_authorization_requests"("client_id");

-- CreateIndex
CREATE INDEX "oauth_authorization_requests_user_id_idx" ON "oauth_authorization_requests"("user_id");

-- CreateIndex
CREATE INDEX "oauth_authorization_requests_expires_at_idx" ON "oauth_authorization_requests"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_key" ON "oauth_authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_grant_id_idx" ON "oauth_authorization_codes"("grant_id");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_user_id_idx" ON "oauth_authorization_codes"("user_id");

-- CreateIndex
CREATE INDEX "oauth_grants_user_id_idx" ON "oauth_grants"("user_id");

-- CreateIndex
CREATE INDEX "oauth_grants_client_id_idx" ON "oauth_grants"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_token_hash_key" ON "oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_tokens_grant_id_idx" ON "oauth_tokens"("grant_id");

-- CreateIndex
CREATE INDEX "oauth_tokens_chain_id_idx" ON "oauth_tokens"("chain_id");

-- CreateIndex
CREATE INDEX "trash_entries_user_id_deleted_at_idx" ON "trash_entries"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "trash_entries_expires_at_idx" ON "trash_entries"("expires_at");

-- CreateIndex
CREATE INDEX "assistant_note_versions_user_id_highlight_id_idx" ON "assistant_note_versions"("user_id", "highlight_id");

-- CreateIndex
CREATE INDEX "assistant_note_versions_user_id_dossier_item_id_idx" ON "assistant_note_versions"("user_id", "dossier_item_id");

-- CreateIndex
CREATE INDEX "tasks_user_id_planned_date_idx" ON "tasks"("user_id", "planned_date");

-- CreateIndex
CREATE INDEX "tasks_user_id_due_date_idx" ON "tasks"("user_id", "due_date");

-- CreateIndex
CREATE INDEX "tasks_dossier_id_idx" ON "tasks"("dossier_id");

-- CreateIndex
CREATE INDEX "tasks_dossier_item_id_idx" ON "tasks"("dossier_item_id");

-- CreateIndex
CREATE INDEX "tasks_parent_id_idx" ON "tasks"("parent_id");

-- CreateIndex
CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");

-- CreateIndex
CREATE INDEX "tasks_deleted_at_idx" ON "tasks"("deleted_at");

-- CreateIndex
CREATE INDEX "atti_user_id_updated_at_idx" ON "atti"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "atti_dossier_id_idx" ON "atti"("dossier_id");

-- CreateIndex
CREATE INDEX "pratica_files_user_id_dossier_id_idx" ON "pratica_files"("user_id", "dossier_id");

-- CreateIndex
CREATE INDEX "pratica_files_versione_di_idx" ON "pratica_files"("versione_di");

-- CreateIndex
CREATE INDEX "pratica_istruzioni_user_id_idx" ON "pratica_istruzioni"("user_id");

-- CreateIndex
CREATE INDEX "pratica_file_accessi_user_id_created_at_idx" ON "pratica_file_accessi"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "pratica_file_accessi_file_id_idx" ON "pratica_file_accessi"("file_id");

