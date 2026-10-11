-- CreateTable
CREATE TABLE "lingo_stato_ripasso" (
    "utente_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "last_review_at" TIMESTAMP(3) NOT NULL,
    "reps" INTEGER NOT NULL DEFAULT 1,
    "lapses" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lingo_stato_ripasso_pkey" PRIMARY KEY ("utente_id","card_id")
);

-- CreateTable
CREATE TABLE "lingo_revisioni_srs" (
    "id" TEXT NOT NULL,
    "utente_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "data_revisione" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rating" INTEGER NOT NULL,
    "scheduled_days" INTEGER NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "difficulty" DOUBLE PRECISION NOT NULL,
    "durata_ms" INTEGER,

    CONSTRAINT "lingo_revisioni_srs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lingo_preferenze_studio" (
    "utente_id" TEXT NOT NULL,
    "nuove_al_giorno" INTEGER NOT NULL DEFAULT 20,
    "materie_comunita" "LingoMateria"[] DEFAULT ARRAY[]::"LingoMateria"[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lingo_preferenze_studio_pkey" PRIMARY KEY ("utente_id")
);

-- CreateIndex
CREATE INDEX "lingo_stato_ripasso_utente_id_due_at_idx" ON "lingo_stato_ripasso"("utente_id", "due_at");

-- CreateIndex
CREATE INDEX "lingo_revisioni_srs_utente_id_card_id_data_revisione_idx" ON "lingo_revisioni_srs"("utente_id", "card_id", "data_revisione");

-- CreateIndex
CREATE INDEX "lingo_revisioni_srs_utente_id_data_revisione_idx" ON "lingo_revisioni_srs"("utente_id", "data_revisione");

-- AddForeignKey
ALTER TABLE "lingo_stato_ripasso" ADD CONSTRAINT "lingo_stato_ripasso_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_stato_ripasso" ADD CONSTRAINT "lingo_stato_ripasso_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_revisioni_srs" ADD CONSTRAINT "lingo_revisioni_srs_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_revisioni_srs" ADD CONSTRAINT "lingo_revisioni_srs_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "lingo_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lingo_preferenze_studio" ADD CONSTRAINT "lingo_preferenze_studio_utente_id_fkey" FOREIGN KEY ("utente_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

