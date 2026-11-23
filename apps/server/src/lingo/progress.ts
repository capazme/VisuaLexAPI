import { LingoMateria, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { maturity } from './cardMaturity';
import { readMissions, settleMissions, type MissioneLetta, type XpCredito } from './missions';
import { courseDayFor, reviewedCardsQuery, reviewScope } from './reviewQueue';
import { computeStreak, type DayState } from './streak';
import { countedDays, dateToDay, dayToDate, markQueueFinished, romeDayStartSql } from './studyDays';
import { readPreferences } from './studyPreferences';
import { addDays, daysBetween, romeDay } from './studyDay';
import { dueWhere, introducedToday, newCardsWhere, queueFinished } from './todayQueue';
import { levelNow, type XpLivello } from './xpLedger';

/**
 * Everything the Studia dashboard draws, in one read (Studia progress spec §4, §5.2). `materia` narrows the
 * cards by state, the calendar's counts and the coming days; today's goal, the streak and whether a day
 * counted are always the whole day's, because the goal is. So are the level, the missions and the credits this
 * read wrote (Gymnasium XP spec §5.3): the read settles the missions first, in a transaction of its own.
 *
 * In SQL a review's Rome day is `(data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome'`: the
 * column is a TIMESTAMP without a zone holding UTC, and read straight as Rome time it would be off by one
 * or two hours. It agrees with `romeDay` (tests/lingoProgress.routes.test.ts). The log is read from the
 * start of a Rome day as an instant (`romeDayStartSql`), so the index `(utente_id, data_revisione)` bounds
 * the scan to the window asked for.
 */


export const CALENDAR_WEEKS = 26;
export const FORECAST_DAYS = 14;
export const RECENT_DAYS = 30;

const SUBJECTS = Object.values(LingoMateria);

interface StateCounts {
  nuove: number;
  apprendimento: number;
  consolidate: number;
}

export interface Progress {
  oggi: { giorno: string; ripassi: number; obiettivo: number; raggiunto: boolean; dovute: number; nuove: number };
  serie: { attuale: number; record: number; ultimiGiorni: { giorno: string; stato: DayState }[] };
  stati: StateCounts;
  materie: (StateCounts & { materia: LingoMateria; ripassi30: number })[];
  calendario: { giorno: string; ripassi: number; nuove: number; sbagliate: number; valido: boolean; riposo: boolean }[];
  prossimi: { giorno: string; schede: number }[];
  livello: XpLivello;
  missioni: MissioneLetta[];
  /** The credits this read wrote: a mission completed with no grade (the queue finished, a subject switched off). */
  crediti: XpCredito[];
}

/** The Monday that starts the calendar: the week `CALENDAR_WEEKS - 1` weeks before this one. */
export function calendarStart(today: string): string {
  const weekday = (dayToDate(today).getUTCDay() + 6) % 7; // Monday 0 … Sunday 6
  return addDays(today, -weekday - (CALENDAR_WEEKS - 1) * 7);
}

const zeroCounts = (): StateCounts => ({ nuove: 0, apprendimento: 0, consolidate: 0 });

export async function readProgress(userId: string, materia?: LingoMateria): Promise<Progress> {
  const today = romeDay(new Date());
  const { nuoveAlGiorno, ripassiAlGiorno, materieComunita } = await readPreferences(prisma, userId);
  const courseDay = await courseDayFor(prisma, today);
  const scopeAll = reviewScope(userId, materieComunita, courseDay);
  const scope = reviewScope(userId, materieComunita, courseDay, materia);

  // First, in one transaction: a finished queue makes today count, and the missions it or anything else completed
  // without a grade are credited (Gymnasium XP spec §5.1). The user row first, in key share: `markQueueFinished`
  // on an existing day row locks it without touching a foreign key, and the credit's insert would then wait on the
  // user row while an account deletion, holding it, waits on the day row. A deleted user settles nothing.
  const { finishedNow, crediti } = await prisma.$transaction(async (tx) => {
    const user = await tx.$queryRaw<unknown[]>`SELECT 1 FROM users WHERE id = ${userId} FOR KEY SHARE`;
    if (user.length !== 1) return { finishedNow: false, crediti: [] };
    const finished = await queueFinished(tx, userId, today);
    if (finished) await markQueueFinished(tx, userId, today);
    return { finishedNow: finished, crediti: (await settleMissions(tx, userId, today, { tipo: 'lettura' })).crediti };
  });

  // Today: the session's counts for the subject asked, and the goal over the whole day.
  const [dovute, introduced, available] = await Promise.all([
    prisma.lingoStatoRipasso.count({ where: dueWhere(userId, scope, today) }),
    introducedToday(prisma, userId, today),
    prisma.lingoCard.count({ where: newCardsWhere(userId, scope) }),
  ]);
  const todayRow = await prisma.lingoGiornataStudio.findUnique({ where: { utenteId_giorno: { utenteId: userId, giorno: dayToDate(today) } } });
  const ripassiOggi = todayRow?.ripassi ?? 0;
  const raggiunto = ripassiOggi >= ripassiAlGiorno || (todayRow?.codaFinita ?? false) || finishedNow;

  const streak = computeStreak(await countedDays(prisma, userId), today, raggiunto);

  // The cards by state, by subject, and the coming days, from the review states in scope.
  const [reviewedCards, fresh] = await Promise.all([
    prisma.lingoCard.findMany(reviewedCardsQuery(userId, scopeAll, { materia: true })),
    prisma.lingoCard.groupBy({ by: ['materia'], where: newCardsWhere(userId, scopeAll), _count: { _all: true } }),
  ]);
  const bySubject = new Map(SUBJECTS.map((s) => [s, zeroCounts()]));
  for (const group of fresh) bySubject.get(group.materia)!.nuove = group._count._all;
  const forecast = new Array<number>(FORECAST_DAYS).fill(0);
  for (const { materia: subject, statiRipasso } of reviewedCards) {
    for (const state of statiRipasso) {
      bySubject.get(subject)![maturity(state.lastReviewAt, state.dueAt)] += 1;
      if (materia && subject !== materia) continue;
      const ahead = Math.max(0, daysBetween(today, romeDay(state.dueAt))); // overdue counts today
      if (ahead < FORECAST_DAYS) forecast[ahead] += 1;
    }
  }
  const stati = zeroCounts();
  for (const [subject, counts] of bySubject) {
    if (materia && subject !== materia) continue;
    stati.nuove += counts.nuove;
    stati.apprendimento += counts.apprendimento;
    stati.consolidate += counts.consolidate;
  }

  const recentStart = addDays(today, -(RECENT_DAYS - 1));
  const recent = await prisma.$queryRaw<{ materia: LingoMateria; n: number }[]>`
    SELECT c.materia::text AS materia, COUNT(*)::int AS n
    FROM lingo_revisioni_srs r JOIN lingo_cards c ON c.id = r.card_id
    WHERE r.utente_id = ${userId} AND r.data_revisione >= ${romeDayStartSql(recentStart)}
    GROUP BY c.materia`;
  const recentBySubject = new Map(recent.map((row) => [row.materia, row.n]));

  // The calendar: whole days from the stored rows; narrowed to a subject, its counts from the log.
  const start = calendarStart(today);
  const rows = await prisma.lingoGiornataStudio.findMany({
    where: { utenteId: userId, giorno: { gte: dayToDate(start) } },
    orderBy: { giorno: 'asc' },
  });
  const narrowed = materia ? await subjectDays(userId, materia, start) : null;
  const days = new Map<string, Progress['calendario'][number]>();
  for (const row of rows) {
    const giorno = dateToDay(row.giorno);
    const counts = narrowed ? (narrowed.get(giorno) ?? { ripassi: 0, nuove: 0, sbagliate: 0 }) : row;
    const valido = giorno === today ? raggiunto : row.valido;
    // A row with no review that did not count is not a study day: one written only by validation votes.
    if (row.ripassi === 0 && !valido) continue;
    days.set(giorno, { giorno, ripassi: counts.ripassi, nuove: counts.nuove, sbagliate: counts.sbagliate, valido, riposo: false });
  }
  for (const giorno of streak.riposi) {
    if (giorno < start) continue;
    days.set(giorno, { ...(days.get(giorno) ?? { giorno, ripassi: 0, nuove: 0, sbagliate: 0, valido: false }), riposo: true });
  }

  const [livello, missioni] = await Promise.all([levelNow(prisma, userId, today), readMissions(prisma, userId, today)]);

  return {
    oggi: { giorno: today, ripassi: ripassiOggi, obiettivo: ripassiAlGiorno, raggiunto, dovute, nuove: Math.min(available, Math.max(0, nuoveAlGiorno - introduced)) },
    serie: { attuale: streak.attuale, record: streak.record, ultimiGiorni: streak.ultimiGiorni },
    stati,
    materie: SUBJECTS.map((subject) => ({ materia: subject, ...bySubject.get(subject)!, ripassi30: recentBySubject.get(subject) ?? 0 })),
    calendario: [...days.values()].sort((a, b) => (a.giorno < b.giorno ? -1 : 1)),
    prossimi: forecast.map((schede, ahead) => ({ giorno: addDays(today, ahead), schede })),
    livello,
    missioni,
    crediti,
  };
}

/** One subject's reviews per Rome day from `start`: «new» is the card's first review ever by the user (no earlier one). */
async function subjectDays(userId: string, materia: LingoMateria, start: string) {
  const rows = await prisma.$queryRaw<{ giorno: Date; ripassi: number; nuove: number; sbagliate: number }[]>(Prisma.sql`
    SELECT ((r.data_revisione AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Rome')::date AS giorno,
           COUNT(*)::int AS ripassi,
           (COUNT(*) FILTER (WHERE NOT EXISTS (
             SELECT 1 FROM lingo_revisioni_srs e
             WHERE e.utente_id = r.utente_id AND e.card_id = r.card_id
               AND (e.data_revisione < r.data_revisione OR (e.data_revisione = r.data_revisione AND e.id < r.id))
           )))::int AS nuove,
           (COUNT(*) FILTER (WHERE r.rating = 1))::int AS sbagliate
    FROM lingo_revisioni_srs r JOIN lingo_cards c ON c.id = r.card_id
    WHERE r.utente_id = ${userId} AND r.data_revisione >= ${romeDayStartSql(start)} AND c.materia::text = ${materia}
    GROUP BY 1`);
  return new Map(rows.map((row) => [dateToDay(row.giorno), { ripassi: row.ripassi, nuove: row.nuove, sbagliate: row.sbagliate }]));
}
