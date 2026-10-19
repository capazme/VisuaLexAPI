-- CreateEnum
CREATE TYPE "TrashKind" AS ENUM ('DOSSIER', 'DOSSIER_ITEMS', 'LINGO_CARDS');

-- CreateTable
CREATE TABLE "trash_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "TrashKind" NOT NULL,
    "dossier_id" TEXT,
    "label" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "grant_id" TEXT,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trash_entries_user_id_deleted_at_idx" ON "trash_entries"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "trash_entries_expires_at_idx" ON "trash_entries"("expires_at");

-- AddForeignKey
ALTER TABLE "trash_entries" ADD CONSTRAINT "trash_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

