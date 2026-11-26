-- The CHECK constraints of the tables the desktop app's local mode writes, for SQLite (G-612, spec §2).
-- Hand-written twins of the Postgres ones, which live in prisma/migrations: same names, same rules, in SQLite's
-- dialect (length for char_length, trim for btrim, enum values as text). SQLite's length() stops at a NUL, which
-- Postgres never stores in text: the length checks refuse a NUL outright. scripts/localSql.ts puts each inside
-- its table's CREATE TABLE; tests/local/checks.test.ts fails when a Postgres CHECK on these tables has no twin.
-- One "-- table: <name>" line per table, then one constraint per line.

-- table: tasks
CONSTRAINT "tasks_priority_check" CHECK ("priority" >= 1 AND "priority" <= 4)
CONSTRAINT "tasks_planned_time_check" CHECK ("planned_time" IS NULL OR "planned_date" IS NOT NULL)
CONSTRAINT "tasks_due_time_check" CHECK ("due_time" IS NULL OR "due_date" IS NOT NULL)
CONSTRAINT "tasks_duration_minutes_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" > 0)
CONSTRAINT "tasks_recurrence_day_check" CHECK ("recurrence_day" IS NULL OR ("recurrence_day" >= 1 AND "recurrence_day" <= 31))
CONSTRAINT "tasks_parent_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id")

-- table: highlights
CONSTRAINT "highlights_assistant_mark_check" CHECK ("created_by_client_id" IS NULL OR ("dossier_item_id" IS NOT NULL AND "assistant_text" IS NOT NULL AND "assistant_start_offset" IS NOT NULL))
CONSTRAINT "highlights_assistant_note_check" CHECK (("assistant_note" IS NULL OR "created_by_client_id" IS NOT NULL) AND (("note_state" IS NULL) = ("assistant_note" IS NULL)))
CONSTRAINT "highlights_gloss_colour_check" CHECK (("kind" = 'gloss') = ("color" IS NULL))
CONSTRAINT "highlights_gloss_note_check" CHECK ("kind" <> 'gloss' OR ("created_by_client_id" IS NOT NULL AND "note_state" IS NOT NULL AND "note" IS NOT NULL AND length(trim("note")) > 0))
CONSTRAINT "highlights_review_comment_check" CHECK ("review_comment" IS NULL OR (length("review_comment") <= 500 AND instr("review_comment", char(0)) = 0))

-- table: dossier_items
CONSTRAINT "dossier_items_assistant_note_check" CHECK ((("note_state" IS NULL) = ("assistant_note" IS NULL)) AND ("note_state" IS NULL OR ("item_type" = 'note' AND "created_by_client_id" IS NOT NULL)))
CONSTRAINT "dossier_items_review_comment_check" CHECK ("review_comment" IS NULL OR (length("review_comment") <= 500 AND instr("review_comment", char(0)) = 0))

-- table: search_history
CONSTRAINT "search_history_one_kind" CHECK (("act_type" IS NULL) <> ("decision_key" IS NULL))

-- table: assistant_note_versions
CONSTRAINT "assistant_note_versions_target_check" CHECK (("highlight_id" IS NULL) <> ("dossier_item_id" IS NULL))
