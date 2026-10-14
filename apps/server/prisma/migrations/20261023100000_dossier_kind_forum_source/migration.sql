-- «Ambienti» into the Forum (docs/superpowers/specs/2026-10-13-environments-into-forum-design.md).
-- Additive only: no row is rewritten or deleted. Every existing dossier becomes a dossier di lavoro
-- (the cautious reading: nothing tells which ones hold a client's matter).

-- CreateEnum
CREATE TYPE "DossierKind" AS ENUM ('lavoro', 'studio');

-- AlterTable
ALTER TABLE "dossiers" ADD COLUMN "kind" "DossierKind" NOT NULL DEFAULT 'lavoro';

-- AlterTable
ALTER TABLE "shared_environments" ADD COLUMN "source_dossier_id" TEXT,
ADD COLUMN "withdrawn_by_admin_at" TIMESTAMP(3);

-- CreateIndex (NULLs are distinct: legacy items without a dossier are unaffected)
CREATE UNIQUE INDEX "shared_environments_source_dossier_id_key" ON "shared_environments"("source_dossier_id");

-- AddForeignKey
ALTER TABLE "shared_environments" ADD CONSTRAINT "shared_environments_source_dossier_id_fkey" FOREIGN KEY ("source_dossier_id") REFERENCES "dossiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
