import type { LingoFonteXp, LingoMateria, LingoMissione, Prisma } from '@prisma/client';
import { levelOf } from './levels';
import { mondayOf } from './studyDay';

/**
 * The XP ledger, `lingo_crediti_xp` (Gymnasium XP spec §5.2): reading it and writing one credit. Append-only:
 * nothing here updates or deletes a row, and only an account deletion's cascade removes one. The one caller
 * that writes is `settleMissions` (`lingo/missions.ts`), under the user's XP lock.
 *
 * `giorno` is a DATE and travels as 'YYYY-MM-DD' cast in SQL (`::date`), never through `romeDay`.
 */

/** The level, as every answer carries it (spec §5.3). */
export interface XpLivello {
  livello: number;
  totale: number;
  nelLivello: number;
  perIlProssimo: number;
  /** The points credited on today's Rome day. */
  oggi: number;
}

export type XpPeriodKind = 'giornaliera' | 'settimanale' | 'lungo';

/** The period a mission of that kind credits in on `today`: the day, the Monday of the week, or once. */
export function periodOf(kind: XpPeriodKind, today: string): string {
  if (kind === 'giornaliera') return `G:${today}`;
  if (kind === 'settimanale') return `S:${mondayOf(today)}`;
  return 'U';
}

export async function levelNow(db: Prisma.TransactionClient, userId: string, today: string): Promise<XpLivello> {
  const [row] = await db.$queryRaw<{ totale: number; oggi: number }[]>`
    SELECT COALESCE(SUM(punti), 0)::int AS totale,
           COALESCE(SUM(punti) FILTER (WHERE giorno = ${today}::date), 0)::int AS oggi
    FROM lingo_crediti_xp WHERE utente_id = ${userId}`;
  return { ...levelOf(row.totale), totale: row.totale, oggi: row.oggi };
}

/**
 * The missions credited for the period they are in on `today`, with the subject a credit names. The CHECK on
 * `periodo` ties each mission to its kind of period, so a row whose period is today's, this week's or `U` is the
 * current credit of its mission.
 */
export async function creditedNow(db: Prisma.TransactionClient, userId: string, today: string): Promise<Map<LingoMissione, { materia: LingoMateria | null }>> {
  const rows = await db.lingoCreditoXp.findMany({
    where: { utenteId: userId, periodo: { in: [periodOf('giornaliera', today), periodOf('settimanale', today), periodOf('lungo', today)] } },
    select: { missione: true, materia: true },
  });
  return new Map(rows.map((row) => [row.missione, { materia: row.materia }]));
}

export interface CreditRow {
  userId: string;
  missione: LingoMissione;
  periodo: string;
  today: string;
  punti: number;
  fonte: LingoFonteXp;
  fonteId: string | null;
  materia: LingoMateria | null;
}

/**
 * Writes one credit, or nothing when either unique key already holds one (the period's, or the event's: a card
 * earns «scrivi» once in its life). Returns whether the row was written.
 */
export async function insertCredit(tx: Prisma.TransactionClient, row: CreditRow): Promise<boolean> {
  const written = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO lingo_crediti_xp (id, utente_id, missione, periodo, giorno, punti, fonte, fonte_id, materia)
    VALUES (gen_random_uuid()::text, ${row.userId}, ${row.missione}::"LingoMissione", ${row.periodo}, ${row.today}::date,
            ${row.punti}, ${row.fonte}::"LingoFonteXp", ${row.fonteId}, ${row.materia}::"LingoMateria")
    ON CONFLICT DO NOTHING
    RETURNING id`;
  return written.length === 1;
}
