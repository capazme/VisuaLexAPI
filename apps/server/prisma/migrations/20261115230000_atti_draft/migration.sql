-- CreateEnum
CREATE TYPE "AttoStato" AS ENUM ('bozza', 'finale');

-- CreateTable
CREATE TABLE "atti" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dossier_id" TEXT,
    "titolo" TEXT NOT NULL,
    "tipo" TEXT,
    "testo" TEXT NOT NULL DEFAULT '',
    "stato" "AttoStato" NOT NULL DEFAULT 'bozza',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,

    CONSTRAINT "atti_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "atti_user_id_updated_at_idx" ON "atti"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "atti_dossier_id_idx" ON "atti"("dossier_id");

-- AddForeignKey
ALTER TABLE "atti" ADD CONSTRAINT "atti_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atti" ADD CONSTRAINT "atti_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

