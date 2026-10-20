import { Prisma } from '@prisma/client';
import { readPreferences } from './studyPreferences';
import { queueFinished } from './todayQueue';

/**
 * The stored study days (Studia progress spec §5.1): one `LingoGiornataStudio` row per user and Rome day.
 * A recorded grade counts into today's row, a finished queue marks it, and a day counts (`valido`) with
 * at least N reviews or the queue finished. A validation vote counts into `voti` (Gymnasium XP spec §3.5),
 * which changes nothing for the streak. Nothing else writes these rows: the trash never touches them,
 * so deleting a card never rewrites a past day; once the day is over its `valido` stays as it was.
 *
 * `giorno` is a DATE. Prisma reads and writes it as a Date at UTC midnight, so a day travels through
 * `dayToDate` and `dateToDay` and never through `romeDay`, which would read that instant in Rome.
 */

/** 'YYYY-MM-DD' → the Date Prisma maps to that DATE. */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** 00:00 in Rome of `day`, as the UTC TIMESTAMP the review columns hold (`lingo_revisioni_srs.data_revisione`). */
export const romeDayStartSql = (day: string) => Prisma.sql`((${day}::date)::timestamp AT TIME ZONE 'Europe/Rome') AT TIME ZONE 'UTC'`;

/** The inverse of `dayToDate`. */
export function dateToDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface GradeDay {
  ripassi: number;
  obiettivo: number;
  /** Whether the day counted before this grade, and after it. */
  before: boolean;
  after: boolean;
}

/**
 * Inside the grade's transaction, after the log row: counts the grade into today's row and says whether the
 * day counts now. The row is created if missing (two first grades racing: the second waits on the unique
 * key, then finds it), then locked, so a user's grades of the day are counted one at a time.
 */
export async function recordGradeDay(
  tx: Prisma.TransactionClient,
  userId: string,
  today: string,
  grade: { isNew: boolean; wrong: boolean },
): Promise<GradeDay> {
  await tx.$executeRaw`
    INSERT INTO lingo_giornate_studio (utente_id, giorno, updated_at)
    VALUES (${userId}, ${today}::date, CURRENT_TIMESTAMP)
    ON CONFLICT (utente_id, giorno) DO NOTHING`;
  const [locked] = await tx.$queryRaw<{ valido: boolean }[]>`
    SELECT valido FROM lingo_giornate_studio WHERE utente_id = ${userId} AND giorno = ${today}::date FOR UPDATE`;
  const { ripassiAlGiorno } = await readPreferences(tx, userId);
  const finished = await queueFinished(tx, userId, today);
  const [row] = await tx.$queryRaw<{ ripassi: number; valido: boolean }[]>`
    UPDATE lingo_giornate_studio SET
      ripassi = ripassi + 1,
      nuove = nuove + ${grade.isNew ? 1 : 0},
      sbagliate = sbagliate + ${grade.wrong ? 1 : 0},
      coda_finita = coda_finita OR ${finished},
      valido = (ripassi + 1 >= ${ripassiAlGiorno}) OR coda_finita OR ${finished},
      updated_at = CURRENT_TIMESTAMP
    WHERE utente_id = ${userId} AND giorno = ${today}::date
    RETURNING ripassi, valido`;
  return { ripassi: row.ripassi, obiettivo: ripassiAlGiorno, before: locked.valido, after: row.valido };
}

/**
 * Inside the vote's transaction, after the vote row: one more vote cast today (Gymnasium XP spec §3.5). The row
 * is created if missing (zero reviews, not counting), then updated, which locks it. Never decreased: a vote
 * deleted later (a withdrawal, an archive) stays counted.
 */
export async function countVoteDay(tx: Prisma.TransactionClient, userId: string, today: string): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO lingo_giornate_studio (utente_id, giorno, updated_at)
    VALUES (${userId}, ${today}::date, CURRENT_TIMESTAMP)
    ON CONFLICT (utente_id, giorno) DO NOTHING`;
  const [row] = await tx.$queryRaw<{ voti: number }[]>`
    UPDATE lingo_giornate_studio SET voti = voti + 1, updated_at = CURRENT_TIMESTAMP
    WHERE utente_id = ${userId} AND giorno = ${today}::date
    RETURNING voti`;
  return row.voti;
}

/**
 * Today's queue is finished (seen on a read of the session or the progress): today's row says so and
 * counts, created with zero reviews when the user had nothing to do (spec D7). Idempotent.
 */
export async function markQueueFinished(db: Prisma.TransactionClient, userId: string, today: string): Promise<void> {
  await db.$executeRaw`
    INSERT INTO lingo_giornate_studio (utente_id, giorno, coda_finita, valido, updated_at)
    VALUES (${userId}, ${today}::date, true, true, CURRENT_TIMESTAMP)
    ON CONFLICT (utente_id, giorno) DO UPDATE SET coda_finita = true, valido = true, updated_at = CURRENT_TIMESTAMP
    WHERE lingo_giornate_studio.valido = false OR lingo_giornate_studio.coda_finita = false`;
}

/** After the review goal changed: today's row counts again by the new goal. Past days stay as they were. */
export async function recountToday(db: Prisma.TransactionClient, userId: string, today: string, goal: number): Promise<void> {
  await db.$executeRaw`
    UPDATE lingo_giornate_studio SET valido = (ripassi >= ${goal}) OR coda_finita, updated_at = CURRENT_TIMESTAMP
    WHERE utente_id = ${userId} AND giorno = ${today}::date`;
}

/** The stored days that counted, as 'YYYY-MM-DD'. */
export async function countedDays(db: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const rows = await db.lingoGiornataStudio.findMany({ where: { utenteId: userId, valido: true }, select: { giorno: true } });
  return rows.map((row) => dateToDay(row.giorno));
}
