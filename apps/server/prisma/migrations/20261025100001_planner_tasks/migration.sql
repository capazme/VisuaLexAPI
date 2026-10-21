-- The planner of Opus, wave 1 (the task model of the answers on the planner; brief P1a): one new
-- table and two new enum types, nothing else. Existing tables get no column; only foreign keys
-- point at them. Undo: DROP TABLE "tasks"; DROP TYPE "TaskOrigin"; DROP TYPE "TaskRecurrenceFrom";
-- and remove this migration's row from "_prisma_migrations".

-- CreateEnum
CREATE TYPE "TaskOrigin" AS ENUM ('lavoro', 'studio', 'forum');

-- CreateEnum
CREATE TYPE "TaskRecurrenceFrom" AS ENUM ('pianificata', 'completamento');

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dossier_id" TEXT,
    "dossier_item_id" TEXT,
    "parent_id" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 4,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "planned_date" DATE,
    "planned_time" TIME(0),
    "due_date" DATE,
    "due_time" TIME(0),
    "recurrence" TEXT,
    "recurrence_from" "TaskRecurrenceFrom" NOT NULL DEFAULT 'pianificata',
    "recurrence_day" SMALLINT,
    "duration_minutes" INTEGER,
    "assignee_id" TEXT,
    "origin" "TaskOrigin" NOT NULL DEFAULT 'lavoro',
    "completed_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_dossier_item_id_fkey" FOREIGN KEY ("dossier_item_id") REFERENCES "dossier_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The ranges and pairings the model cannot say: a priority from 1 to 4; a time only with its date;
-- a positive duration; a repetition's day of the month from 1 to 31; a task is never its own
-- parent. (A longer cycle is refused by the routes.)
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_check" CHECK ("priority" BETWEEN 1 AND 4);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_planned_time_check" CHECK ("planned_time" IS NULL OR "planned_date" IS NOT NULL);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_due_time_check" CHECK ("due_time" IS NULL OR "due_date" IS NOT NULL);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_duration_minutes_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" > 0);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_day_check" CHECK ("recurrence_day" IS NULL OR "recurrence_day" BETWEEN 1 AND 31);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
