-- Learn's short lesson (LC63), second part: the ledger's period for «Lezione», once per lesson (L:<lesson id>), outside
-- the daily branch; at most three a Rome day is the application's rule (`lingo/missions.ts`, LESSON_MISSION). The
-- lesson's id is the event's (`fonte_id`), so the global unique (missione, fonte_id) also means once per lesson.
ALTER TABLE "lingo_crediti_xp" DROP CONSTRAINT "lingo_crediti_xp_periodo_check";
ALTER TABLE "lingo_crediti_xp" ADD CONSTRAINT "lingo_crediti_xp_periodo_check" CHECK (
    ("missione" = 'SETTIMANA' AND "periodo" ~ '^S:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
    OR ("missione" = 'CONSOLIDA' AND "periodo" = 'U')
    OR ("missione" = 'MODULO' AND "periodo" ~ '^M:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR ("missione" = 'PERCORSO' AND "periodo" ~ '^C:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR ("missione" = 'LEZIONE' AND "periodo" ~ '^L:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    OR ("missione" NOT IN ('SETTIMANA', 'CONSOLIDA', 'MODULO', 'PERCORSO', 'LEZIONE') AND "periodo" ~ '^G:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
