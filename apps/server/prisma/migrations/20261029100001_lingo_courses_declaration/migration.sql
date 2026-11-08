-- Gymnasium's courses, «Percorsi» (A1), second part: what uses the enum values 20261029100000 declared, which
-- Postgres allows only once that migration has committed (as 20261024100000/…01 did for INFORMATIVA_MERLT).

-- The XP ledger's period (spec §10.8): «Completa un modulo» once per module (M:<module id>) and «Supera un
-- percorso» once per course (C:<course id>), both outside the daily branch. The ids are per person (a module's
-- state row, an enrolment), so the global unique (missione, fonte_id) still means once in a lifetime. Nothing
-- credits either before the study routes (S2); the CHECK is in place first.
ALTER TABLE "lingo_crediti_xp" DROP CONSTRAINT "lingo_crediti_xp_periodo_check";
ALTER TABLE "lingo_crediti_xp" ADD CONSTRAINT "lingo_crediti_xp_periodo_check" CHECK (
    ("missione" = 'SETTIMANA' AND "periodo" ~ '^S:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR ("missione" = 'CONSOLIDA' AND "periodo" = 'U')
    OR ("missione" = 'MODULO' AND "periodo" ~ '^M:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR ("missione" = 'PERCORSO' AND "periodo" ~ '^C:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR ("missione" NOT IN ('SETTIMANA', 'CONSOLIDA', 'MODULO', 'PERCORSO') AND "periodo" ~ '^G:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);

-- Version 1 of the declaration MATERIALE_STUDIO (spec §12, the words approved by the owners on 25 October 2026),
-- accepted once in the web before the first course. Written by the migration, hence no author; a change is a new
-- version saved from the admin screen, never an edit of this row.
INSERT INTO "lingo_testi_versioni" ("id", "chiave", "versione", "titolo", "corpo", "conferma", "azione", "autore_id")
VALUES (
    '6f0c2b7e-3d1a-4c55-9b8e-2a7d4e1f9c30',
    'MATERIALE_STUDIO',
    1,
    'Il tuo materiale di studio',
    'Per creare un percorso usi materiale tuo, o che hai il diritto di usare per studiare. I file che dai al tuo assistente non arrivano a VisuaLex: li legge il fornitore dell''assistente, alle sue condizioni. VisuaLex conserva solo ciò che l''assistente scrive nel percorso (lezioni, domande, schede), visibile solo a te. Un percorso tratto da lezioni o materiali di altri resta privato: per pubblicarlo serve il consenso del loro autore.',
    'Dichiaro di avere il diritto di usare il materiale da cui creo i miei percorsi',
    'Accetto',
    NULL
);
