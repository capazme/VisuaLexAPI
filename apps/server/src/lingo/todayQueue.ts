import type { Prisma } from '@prisma/client';
import { courseDayFor, reviewScope } from './reviewQueue';
import { readPreferences } from './studyPreferences';
import { startOfRomeDay } from './studyDay';

/**
 * Today's review queue, counted (Studia spec §5; Studia progress spec D7): what is due, how many new cards
 * were introduced today, and whether the day's queue is finished. Shared by the session, the grade and
 * the progress read, so the three agree on what «today's queue» is.
 */

/** The user's cards in scope that are due by the end of `today`. */
export function dueWhere(userId: string, scope: Prisma.LingoCardWhereInput, today: string): Prisma.LingoStatoRipassoWhereInput {
  return { utenteId: userId, dueAt: { lt: startOfRomeDay(today, 1) }, card: scope };
}

/** New cards introduced today, across subjects and devices: only a day's first grade is recorded, so a state with one review made today is one. */
export function introducedToday(db: Prisma.TransactionClient, userId: string, today: string): Promise<number> {
  return db.lingoStatoRipasso.count({ where: { utenteId: userId, reps: 1, lastReviewAt: { gte: startOfRomeDay(today) } } });
}

/** The cards in scope the user has never reviewed. */
export function newCardsWhere(userId: string, scope: Prisma.LingoCardWhereInput): Prisma.LingoCardWhereInput {
  return { AND: [scope, { statiRipasso: { none: { utenteId: userId } } }] };
}

/**
 * Whether the whole day's queue is finished, in every subject: nothing in scope due by the end of today,
 * and no new card left to introduce today (the daily number of new cards reached, or none left in scope).
 * Someone who has never reviewed a card in scope has no queue to finish: an empty account never makes a
 * day count.
 */
export async function queueFinished(db: Prisma.TransactionClient, userId: string, today: string): Promise<boolean> {
  const { nuoveAlGiorno, materieComunita } = await readPreferences(db, userId);
  const scope = reviewScope(userId, materieComunita, await courseDayFor(db, today));
  const studied = await db.lingoStatoRipasso.findFirst({ where: { utenteId: userId, card: scope }, select: { cardId: true } });
  if (studied === null) return false;
  const due = await db.lingoStatoRipasso.count({ where: dueWhere(userId, scope, today) });
  if (due > 0) return false;
  if (nuoveAlGiorno - (await introducedToday(db, userId, today)) <= 0) return true;
  const fresh = await db.lingoCard.findFirst({ where: newCardsWhere(userId, scope), select: { id: true } });
  return fresh === null;
}

