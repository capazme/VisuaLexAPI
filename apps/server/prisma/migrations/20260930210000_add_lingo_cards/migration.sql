-- LingoLex: the study cards and their anchors in the norm text. Additive — two
-- enums, two tables, their indexes and two foreign keys; the only contact with
-- an existing table is the foreign key from lingo_cards to users (ON DELETE
-- CASCADE, like every other relation to User). No existing table is altered.
-- Generated with `prisma migrate diff` from the previous schema, not with
-- `migrate dev`.

-- CreateEnum
CREATE TYPE "LingoCardStato" AS ENUM ('BOZZA_PERSONALE', 'PROPOSTA_COMMUNITY', 'VALIDATA', 'DA_RIVEDERE', 'ARCHIVIATA');

-- CreateEnum
CREATE TYPE "LingoCardTipo" AS ENUM ('ISTITUTO_DEFINIZIONE', 'DISTINZIONE_CONCETTUALE', 'CASO_APPLICATIVO', 'REQUISITO_FORMA_ATTO');

-- CreateTable
CREATE TABLE "lingo_cards" (
    "id" TEXT NOT NULL,
    "autore_id" TEXT NOT NULL,
    "materia" "LingoMateria" NOT NULL,
    "istituto" TEXT NOT NULL,
    "tipo" "LingoCardTipo" NOT NULL DEFAULT 'ISTITUTO_DEFINIZIONE',
    "domanda" TEXT NOT NULL,
    "risposta" TEXT NOT NULL,
    "spiegazione" TEXT,
    "stato" "LingoCardStato" NOT NULL DEFAULT 'BOZZA_PERSONALE',
    "authority_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_controversa" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lingo_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_card_ancore" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "norma_key" TEXT NOT NULL,
    "article_id" TEXT NOT NULL,
    "urn" TEXT NOT NULL,
    "akn_fingerprint" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "ultima_verifica" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_card_ancore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lingo_cards_materia_istituto_stato_idx" ON "lingo_cards"("materia", "istituto", "stato");

-- CreateIndex
CREATE INDEX "lingo_cards_stato_idx" ON "lingo_cards"("stato");

-- CreateIndex
CREATE INDEX "lingo_cards_autore_id_idx" ON "lingo_cards"("autore_id");

-- CreateIndex
CREATE INDEX "lingo_card_ancore_norma_key_article_id_akn_fingerprint_idx" ON "lingo_card_ancore"("norma_key", "article_id", "akn_fingerprint");

-- CreateIndex
CREATE INDEX "lingo_card_ancore_card_id_idx" ON "lingo_card_ancore"("card_id");

-- AddForeignKey
ALTER TABLE "lingo_cards" ADD CONSTRAINT "lingo_cards_autore_id_fkey" FOREIGN KEY ("autore_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_card_ancore" ADD CONSTRAINT "lingo_card_ancore_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
