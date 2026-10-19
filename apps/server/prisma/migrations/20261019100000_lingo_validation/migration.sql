-- CreateEnum
CREATE TYPE "LingoGiudizio" AS ENUM ('APPROVATA', 'MIGLIORABILE', 'ERRATA');

-- CreateEnum
CREATE TYPE "LingoTestoChiave" AS ENUM ('PROPOSTA_SCHEDA');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "lingo_validatore" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "lingo_cards" ADD COLUMN     "proposta_testo_id" TEXT;

-- CreateTable
CREATE TABLE "lingo_validazioni_card" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "utente_id" TEXT,
    "giudizio" "LingoGiudizio" NOT NULL,
    "motivazione" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_validazioni_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_testi_versioni" (
    "id" TEXT NOT NULL,
    "chiave" "LingoTestoChiave" NOT NULL,
    "versione" INTEGER NOT NULL,
    "titolo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "conferma" TEXT NOT NULL,
    "azione" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autore_id" TEXT,

    CONSTRAINT "lingo_testi_versioni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_accettazioni_testi" (
    "id" TEXT NOT NULL,
    "utente_id" TEXT NOT NULL,
    "testo_id" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_accettazioni_testi_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lingo_validazioni_card_utente_id_idx" ON "lingo_validazioni_card"("utente_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_validazioni_card_card_id_utente_id_key" ON "lingo_validazioni_card"("card_id", "utente_id");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_testi_versioni_chiave_versione_key" ON "lingo_testi_versioni"("chiave", "versione");

-- CreateIndex
CREATE UNIQUE INDEX "lingo_accettazioni_testi_utente_id_testo_id_key" ON "lingo_accettazioni_testi"("utente_id", "testo_id");

-- AddForeignKey
ALTER TABLE "lingo_cards" ADD CONSTRAINT "lingo_cards_proposta_testo_id_fkey" FOREIGN KEY ("proposta_testo_id") REFERENCES "lingo_testi_versioni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_validazioni_card" ADD CONSTRAINT "lingo_validazioni_card_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_validazioni_card" ADD CONSTRAINT "lingo_validazioni_card_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_testi_versioni" ADD CONSTRAINT "lingo_testi_versioni_autore_id_fkey" FOREIGN KEY ("autore_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_accettazioni_testi" ADD CONSTRAINT "lingo_accettazioni_testi_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_accettazioni_testi" ADD CONSTRAINT "lingo_accettazioni_testi_testo_id_fkey" FOREIGN KEY ("testo_id") REFERENCES "lingo_testi_versioni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Version 1 of the notice a user accepts before proposing a card to the community
-- (spec decision 13, approved by the owner on 7 October 2026). Written by the
-- migration, hence no author. A change is a new version, never an edit of this row.
INSERT INTO "lingo_testi_versioni" ("id", "chiave", "versione", "titolo", "corpo", "conferma", "azione", "autore_id")
VALUES (
    '6f1d2a54-8b3e-4c7a-9e21-5d0a7c3b1f48',
    'PROPOSTA_SCHEDA',
    1,
    'Proponi la scheda alla comunità',
    'La scheda sarà pubblicata con licenza Creative Commons Attribuzione – Condividi allo stesso modo 4.0 (CC BY-SA 4.0): chiunque potrà leggerla, riusarla e modificarla, citandone la fonte e alle stesse condizioni.

Se viene validata, la scheda resta anche se cancelli il tuo account: il tuo nome viene tolto, il testo no. Non scrivere nelle schede dati personali, tuoi o di altri.

Finché è in attesa di validazione puoi ritirarla e tornerà una tua bozza.',
    'Ho letto e accetto',
    'Proponi',
    NULL
);
