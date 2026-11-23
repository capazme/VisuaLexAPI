-- Gymnasium's courses, «Percorsi» (A1; spec docs/superpowers/specs/2026-10-23-gymnasium-courses-design.md §10.2):
-- a course's content (the author's: lingo_corsi and the tables under it) apart from one person's progress
-- (lingo_corsi_iscrizioni and the tables under it), the two columns that tie a card to a module, and its
-- competences. Thirteen tables, all new; no existing row changes. The new enum values are only declared here:
-- Postgres refuses a value in the transaction that adds it, so their first use (the ledger's CHECK, the
-- declaration's version 1) is 20261029100001. Rollback, before any course exists: drop what this adds.
-- The ranges and every «exactly one of» are CHECKs here, not in the Prisma model, as for the other Studia tables.

-- CreateEnum
CREATE TYPE "LingoCorsoTipoDomanda" AS ENUM ('RICHIAMO', 'QUIZ', 'APERTA', 'ESAME', 'ESAME_APERTA');

-- AlterEnum
ALTER TYPE "LingoTestoChiave" ADD VALUE 'MATERIALE_STUDIO';

-- AlterEnum
ALTER TYPE "LingoMissione" ADD VALUE 'MODULO';
ALTER TYPE "LingoMissione" ADD VALUE 'PERCORSO';

-- AlterEnum
ALTER TYPE "LingoFonteXp" ADD VALUE 'MODULO';
ALTER TYPE "LingoFonteXp" ADD VALUE 'ESAME';

-- AlterEnum
ALTER TYPE "TrashKind" ADD VALUE 'LINGO_CORSO';
ALTER TYPE "TrashKind" ADD VALUE 'LINGO_CORSO_MODULO';

-- AlterTable
ALTER TABLE "lingo_cards" ADD COLUMN     "da_percorso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "modulo_id" TEXT;

-- CreateTable
CREATE TABLE "lingo_corsi" (
    "id" TEXT NOT NULL,
    "autore_id" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "materia" "LingoMateria" NOT NULL,
    "descrizione" TEXT,
    "moduli_previsti" INTEGER NOT NULL,
    "dichiarazione_testo_id" TEXT NOT NULL,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lingo_corsi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_competenze" (
    "id" TEXT NOT NULL,
    "corso_id" TEXT NOT NULL,
    "codice" TEXT NOT NULL,
    "ordine" INTEGER NOT NULL,
    "testo" TEXT NOT NULL,

    CONSTRAINT "lingo_corsi_competenze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_moduli" (
    "id" TEXT NOT NULL,
    "corso_id" TEXT NOT NULL,
    "ordine" INTEGER NOT NULL,
    "titolo" TEXT NOT NULL,
    "minuti" INTEGER,
    "domande_prima" JSONB NOT NULL,
    "sostituisce_id" TEXT,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_corsi_moduli_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_moduli_competenze" (
    "modulo_id" TEXT NOT NULL,
    "competenza_id" TEXT NOT NULL,

    CONSTRAINT "lingo_corsi_moduli_competenze_pkey" PRIMARY KEY ("modulo_id","competenza_id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_blocchi" (
    "id" TEXT NOT NULL,
    "modulo_id" TEXT NOT NULL,
    "ordine" INTEGER NOT NULL,
    "titolo" TEXT,
    "testo" TEXT NOT NULL,
    "parole" INTEGER NOT NULL,
    "citazioni" JSONB NOT NULL,

    CONSTRAINT "lingo_corsi_blocchi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_esami" (
    "id" TEXT NOT NULL,
    "corso_id" TEXT NOT NULL,
    "iscrizione_id" TEXT,
    "created_by_client_id" TEXT,
    "created_by_client_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_corsi_esami_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_domande" (
    "id" TEXT NOT NULL,
    "modulo_id" TEXT,
    "esame_id" TEXT,
    "blocco_id" TEXT,
    "tipo" "LingoCorsoTipoDomanda" NOT NULL,
    "applicazione" BOOLEAN NOT NULL DEFAULT false,
    "ordine" INTEGER NOT NULL,
    "testo" TEXT NOT NULL,
    "opzioni" JSONB,
    "corretta" TEXT,
    "risposta_modello" TEXT,
    "rubrica" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_corsi_domande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_domande_competenze" (
    "domanda_id" TEXT NOT NULL,
    "competenza_id" TEXT NOT NULL,

    CONSTRAINT "lingo_corsi_domande_competenze_pkey" PRIMARY KEY ("domanda_id","competenza_id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_iscrizioni" (
    "id" TEXT NOT NULL,
    "corso_id" TEXT NOT NULL,
    "utente_id" TEXT NOT NULL,
    "dossier_id" TEXT,
    "superato_il" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lingo_corsi_iscrizioni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_moduli_stati" (
    "id" TEXT NOT NULL,
    "iscrizione_id" TEXT NOT NULL,
    "modulo_id" TEXT NOT NULL,
    "aperto_il" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fatto_il" TIMESTAMP(3),
    "fatto_giorno" DATE,
    "quiz_percentuale" INTEGER,
    "giudizio" INTEGER,
    "giudizio_nota" TEXT,
    "ritirato_il" TIMESTAMP(3),

    CONSTRAINT "lingo_corsi_moduli_stati_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_esiti" (
    "id" TEXT NOT NULL,
    "iscrizione_id" TEXT NOT NULL,
    "domanda_id" TEXT NOT NULL,
    "tentativo_id" TEXT,
    "scelta" TEXT,
    "corretto" BOOLEAN,
    "spuntate" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "giorno" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "segnalato_il" TIMESTAMP(3),
    "segnalazione" TEXT,

    CONSTRAINT "lingo_corsi_esiti_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_corsi_tentativi" (
    "id" TEXT NOT NULL,
    "iscrizione_id" TEXT NOT NULL,
    "esame_id" TEXT NOT NULL,
    "aperto_il" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consegnato_il" TIMESTAMP(3),
    "giorno" DATE,
    "percentuale" INTEGER,
    "superato" BOOLEAN,
    "per_competenza" JSONB,

    CONSTRAINT "lingo_corsi_tentativi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_card_competenze" (
    "card_id" TEXT NOT NULL,
    "competenza_id" TEXT NOT NULL,

    CONSTRAINT "lingo_card_competenze_pkey" PRIMARY KEY ("card_id","competenza_id")
);

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
CREATE INDEX "lingo_cards_modulo_id_idx" ON "lingo_cards"("modulo_id");

-- AddForeignKey
ALTER TABLE "lingo_cards" ADD CONSTRAINT "lingo_cards_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi" ADD CONSTRAINT "lingo_corsi_autore_id_fkey" FOREIGN KEY ("autore_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi" ADD CONSTRAINT "lingo_corsi_dichiarazione_testo_id_fkey" FOREIGN KEY ("dichiarazione_testo_id") REFERENCES "lingo_testi_versioni"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_competenze" ADD CONSTRAINT "lingo_corsi_competenze_corso_id_fkey" FOREIGN KEY ("corso_id") REFERENCES "lingo_corsi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_moduli" ADD CONSTRAINT "lingo_corsi_moduli_corso_id_fkey" FOREIGN KEY ("corso_id") REFERENCES "lingo_corsi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_moduli" ADD CONSTRAINT "lingo_corsi_moduli_sostituisce_id_fkey" FOREIGN KEY ("sostituisce_id") REFERENCES "lingo_corsi_moduli"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_moduli_competenze" ADD CONSTRAINT "lingo_corsi_moduli_competenze_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_moduli_competenze" ADD CONSTRAINT "lingo_corsi_moduli_competenze_competenza_id_fkey" FOREIGN KEY ("competenza_id") REFERENCES "lingo_corsi_competenze"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_blocchi" ADD CONSTRAINT "lingo_corsi_blocchi_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_esami" ADD CONSTRAINT "lingo_corsi_esami_corso_id_fkey" FOREIGN KEY ("corso_id") REFERENCES "lingo_corsi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_esami" ADD CONSTRAINT "lingo_corsi_esami_iscrizione_id_fkey" FOREIGN KEY ("iscrizione_id") REFERENCES "lingo_corsi_iscrizioni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_domande" ADD CONSTRAINT "lingo_corsi_domande_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_domande" ADD CONSTRAINT "lingo_corsi_domande_esame_id_fkey" FOREIGN KEY ("esame_id") REFERENCES "lingo_corsi_esami"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_domande" ADD CONSTRAINT "lingo_corsi_domande_blocco_id_fkey" FOREIGN KEY ("blocco_id") REFERENCES "lingo_corsi_blocchi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_domande_competenze" ADD CONSTRAINT "lingo_corsi_domande_competenze_domanda_id_fkey" FOREIGN KEY ("domanda_id") REFERENCES "lingo_corsi_domande"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_domande_competenze" ADD CONSTRAINT "lingo_corsi_domande_competenze_competenza_id_fkey" FOREIGN KEY ("competenza_id") REFERENCES "lingo_corsi_competenze"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_iscrizioni" ADD CONSTRAINT "lingo_corsi_iscrizioni_corso_id_fkey" FOREIGN KEY ("corso_id") REFERENCES "lingo_corsi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_iscrizioni" ADD CONSTRAINT "lingo_corsi_iscrizioni_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_iscrizioni" ADD CONSTRAINT "lingo_corsi_iscrizioni_dossier_id_fkey" FOREIGN KEY ("dossier_id") REFERENCES "dossiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_moduli_stati" ADD CONSTRAINT "lingo_corsi_moduli_stati_iscrizione_id_fkey" FOREIGN KEY ("iscrizione_id") REFERENCES "lingo_corsi_iscrizioni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_moduli_stati" ADD CONSTRAINT "lingo_corsi_moduli_stati_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "lingo_corsi_moduli"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_esiti" ADD CONSTRAINT "lingo_corsi_esiti_iscrizione_id_fkey" FOREIGN KEY ("iscrizione_id") REFERENCES "lingo_corsi_iscrizioni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_esiti" ADD CONSTRAINT "lingo_corsi_esiti_domanda_id_fkey" FOREIGN KEY ("domanda_id") REFERENCES "lingo_corsi_domande"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_esiti" ADD CONSTRAINT "lingo_corsi_esiti_tentativo_id_fkey" FOREIGN KEY ("tentativo_id") REFERENCES "lingo_corsi_tentativi"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_tentativi" ADD CONSTRAINT "lingo_corsi_tentativi_iscrizione_id_fkey" FOREIGN KEY ("iscrizione_id") REFERENCES "lingo_corsi_iscrizioni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_corsi_tentativi" ADD CONSTRAINT "lingo_corsi_tentativi_esame_id_fkey" FOREIGN KEY ("esame_id") REFERENCES "lingo_corsi_esami"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_card_competenze" ADD CONSTRAINT "lingo_card_competenze_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_card_competenze" ADD CONSTRAINT "lingo_card_competenze_competenza_id_fkey" FOREIGN KEY ("competenza_id") REFERENCES "lingo_corsi_competenze"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The ranges (spec §10.2, §10.12), as for the other Studia tables.
ALTER TABLE "lingo_corsi"
    ADD CONSTRAINT "lingo_corsi_titolo_check" CHECK (char_length("titolo") BETWEEN 1 AND 200),
    ADD CONSTRAINT "lingo_corsi_descrizione_check" CHECK ("descrizione" IS NULL OR char_length("descrizione") <= 2000),
    ADD CONSTRAINT "lingo_corsi_moduli_previsti_check" CHECK ("moduli_previsti" BETWEEN 1 AND 40);

ALTER TABLE "lingo_corsi_competenze"
    ADD CONSTRAINT "lingo_corsi_competenze_codice_check" CHECK ("codice" ~ '^C[1-9][0-9]?$'),
    ADD CONSTRAINT "lingo_corsi_competenze_ordine_check" CHECK ("ordine" BETWEEN 1 AND 15),
    ADD CONSTRAINT "lingo_corsi_competenze_testo_check" CHECK (char_length("testo") BETWEEN 10 AND 300);

ALTER TABLE "lingo_corsi_moduli"
    ADD CONSTRAINT "lingo_corsi_moduli_ordine_check" CHECK ("ordine" BETWEEN 1 AND 200),
    ADD CONSTRAINT "lingo_corsi_moduli_titolo_check" CHECK (char_length("titolo") BETWEEN 1 AND 200),
    ADD CONSTRAINT "lingo_corsi_moduli_minuti_check" CHECK ("minuti" IS NULL OR "minuti" BETWEEN 5 AND 120),
    ADD CONSTRAINT "lingo_corsi_moduli_domande_prima_check" CHECK (jsonb_typeof("domande_prima") = 'array' AND jsonb_array_length("domande_prima") <= 3),
    ADD CONSTRAINT "lingo_corsi_moduli_sostituisce_check" CHECK ("sostituisce_id" IS NULL OR "sostituisce_id" <> "id");

ALTER TABLE "lingo_corsi_blocchi"
    ADD CONSTRAINT "lingo_corsi_blocchi_ordine_check" CHECK ("ordine" BETWEEN 1 AND 12),
    ADD CONSTRAINT "lingo_corsi_blocchi_titolo_check" CHECK ("titolo" IS NULL OR char_length("titolo") BETWEEN 1 AND 200),
    ADD CONSTRAINT "lingo_corsi_blocchi_testo_check" CHECK (char_length("testo") BETWEEN 1 AND 12000),
    ADD CONSTRAINT "lingo_corsi_blocchi_parole_check" CHECK ("parole" >= 0),
    ADD CONSTRAINT "lingo_corsi_blocchi_citazioni_check" CHECK (jsonb_typeof("citazioni") = 'array');

-- An item belongs to a module or to an exam, never both; a recall question to one of its module's blocks; an
-- exam's kinds to an exam only. Every kind with options has its key; the exam's open question has neither (it is
-- self-assessed only, G-377 Q6); the open kinds alone have a model answer and a rubric.
ALTER TABLE "lingo_corsi_domande"
    ADD CONSTRAINT "lingo_corsi_domande_parent_check" CHECK (("modulo_id" IS NULL) <> ("esame_id" IS NULL)),
    ADD CONSTRAINT "lingo_corsi_domande_blocco_check" CHECK (("tipo" = 'RICHIAMO') = ("blocco_id" IS NOT NULL)),
    ADD CONSTRAINT "lingo_corsi_domande_esame_check" CHECK (("tipo" IN ('ESAME', 'ESAME_APERTA')) = ("esame_id" IS NOT NULL)),
    ADD CONSTRAINT "lingo_corsi_domande_opzioni_check" CHECK (
        CASE WHEN "tipo" = 'ESAME_APERTA' THEN "opzioni" IS NULL AND "corretta" IS NULL
             ELSE "opzioni" IS NOT NULL AND "corretta" IS NOT NULL
                  AND jsonb_typeof("opzioni") = 'array' AND jsonb_array_length("opzioni") BETWEEN 2 AND 6 END
    ),
    ADD CONSTRAINT "lingo_corsi_domande_aperta_check" CHECK (
        CASE WHEN "tipo" IN ('APERTA', 'ESAME_APERTA')
             THEN "risposta_modello" IS NOT NULL AND "rubrica" IS NOT NULL
                  AND jsonb_typeof("rubrica") = 'array' AND jsonb_array_length("rubrica") BETWEEN 3 AND 5
             ELSE "risposta_modello" IS NULL AND "rubrica" IS NULL END
    ),
    ADD CONSTRAINT "lingo_corsi_domande_corretta_check" CHECK ("corretta" IS NULL OR "corretta" ~ '^[a-f]$'),
    ADD CONSTRAINT "lingo_corsi_domande_testo_check" CHECK (char_length("testo") BETWEEN 1 AND 2000),
    ADD CONSTRAINT "lingo_corsi_domande_risposta_modello_check" CHECK ("risposta_modello" IS NULL OR char_length("risposta_modello") BETWEEN 1 AND 3000),
    ADD CONSTRAINT "lingo_corsi_domande_ordine_check" CHECK ("ordine" BETWEEN 1 AND 100);

ALTER TABLE "lingo_corsi_moduli_stati"
    ADD CONSTRAINT "lingo_corsi_moduli_stati_fatto_check" CHECK (("fatto_il" IS NULL) = ("fatto_giorno" IS NULL)),
    ADD CONSTRAINT "lingo_corsi_moduli_stati_quiz_check" CHECK ("quiz_percentuale" IS NULL OR "quiz_percentuale" BETWEEN 0 AND 100),
    ADD CONSTRAINT "lingo_corsi_moduli_stati_giudizio_check" CHECK ("giudizio" IS NULL OR "giudizio" BETWEEN 1 AND 5),
    ADD CONSTRAINT "lingo_corsi_moduli_stati_nota_check" CHECK ("giudizio_nota" IS NULL OR char_length("giudizio_nota") <= 1000);

ALTER TABLE "lingo_corsi_esiti"
    ADD CONSTRAINT "lingo_corsi_esiti_scelta_check" CHECK ("scelta" IS NULL OR "scelta" ~ '^[a-f]$'),
    ADD CONSTRAINT "lingo_corsi_esiti_segnalazione_check" CHECK ("segnalazione" IS NULL OR char_length("segnalazione") <= 500);

ALTER TABLE "lingo_corsi_tentativi"
    ADD CONSTRAINT "lingo_corsi_tentativi_percentuale_check" CHECK ("percentuale" IS NULL OR "percentuale" BETWEEN 0 AND 100),
    ADD CONSTRAINT "lingo_corsi_tentativi_consegna_check" CHECK (("consegnato_il" IS NULL) = ("giorno" IS NULL));
