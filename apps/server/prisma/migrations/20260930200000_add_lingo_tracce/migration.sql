-- LingoLex, first slice: the bank of exam traces. Purely additive — two enums,
-- one table, one index; no existing table is touched and nothing references
-- User yet. Generated with `prisma migrate diff` from the previous schema, not
-- with `migrate dev`.

-- CreateEnum
CREATE TYPE "LingoMateria" AS ENUM ('DIRITTO_CIVILE', 'DIRITTO_PENALE', 'DIRITTO_AMMINISTRATIVO', 'DIRITTO_PROCESSUALE_CIVILE', 'DIRITTO_PROCESSUALE_PENALE');

-- CreateEnum
CREATE TYPE "LingoTipoProva" AS ENUM ('ATTO_GIUDIZIARIO', 'PARERE_MOTIVATO');

-- CreateTable
CREATE TABLE "lingo_tracce" (
    "id" TEXT NOT NULL,
    "materia" "LingoMateria" NOT NULL,
    "tipo_prova" "LingoTipoProva" NOT NULL DEFAULT 'ATTO_GIUDIZIARIO',
    "sotto_tipo_atto" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "testo_traccia" TEXT NOT NULL,
    "norme_riferimento" JSONB NOT NULL,
    "questioni_forma" JSONB NOT NULL,
    "questioni_sostanza" JSONB NOT NULL,
    "fonte_traccia" TEXT NOT NULL,
    "attiva" BOOLEAN NOT NULL DEFAULT true,
    "difficolta" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_tracce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lingo_tracce_materia_tipo_prova_sotto_tipo_atto_idx" ON "lingo_tracce"("materia", "tipo_prova", "sotto_tipo_atto");
