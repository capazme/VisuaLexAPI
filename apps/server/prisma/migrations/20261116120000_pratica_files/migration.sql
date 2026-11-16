-- A case's act files (LC50, server part; testing only, no real client files). Additive: three new tables and
-- two enums, nothing existing changes. No foreign key to `dossiers` on purpose (a dossier in the trash keeps its
-- files and comes back with the same id); `users` cascades. The rollback is in the pull request:
--   DROP TABLE "pratica_file_accessi"; DROP TABLE "pratica_istruzioni"; DROP TABLE "pratica_files";
--   DROP TYPE "PraticaFileAzione"; DROP TYPE "PraticaFileAutore";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261116120000_pratica_files';

-- CreateEnum
CREATE TYPE "PraticaFileAutore" AS ENUM ('utente', 'claude');

-- CreateEnum
CREATE TYPE "PraticaFileAzione" AS ENUM ('elenco', 'scaricamento', 'deposito', 'cestino', 'ripristino', 'cancellazione');

-- CreateTable
CREATE TABLE "pratica_files" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "peso" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "versione_di" TEXT,
    "versione" INTEGER NOT NULL DEFAULT 1,
    "autore" "PraticaFileAutore" NOT NULL DEFAULT 'utente',
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "pseudonimizzato" BOOLEAN NOT NULL DEFAULT false,
    "chiave_cifrata" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pratica_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pratica_istruzioni" (
    "dossier_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "testo" TEXT NOT NULL DEFAULT '',
    "updated_by_client_id" TEXT,
    "updated_by_client_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pratica_istruzioni_pkey" PRIMARY KEY ("dossier_id")
);

-- CreateTable
CREATE TABLE "pratica_file_accessi" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dossier_id" TEXT NOT NULL,
    "file_id" TEXT,
    "azione" "PraticaFileAzione" NOT NULL,
    "client_id" TEXT,
    "client_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pratica_file_accessi_pkey" PRIMARY KEY ("id")
);

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

-- AddForeignKey
ALTER TABLE "pratica_files" ADD CONSTRAINT "pratica_files_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pratica_istruzioni" ADD CONSTRAINT "pratica_istruzioni_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pratica_file_accessi" ADD CONSTRAINT "pratica_file_accessi_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

