import type { LingoMateria } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { maturity } from './cardMaturity';
import { reviewedCardsQuery, reviewScope } from './reviewQueue';
import { readPreferences } from './studyPreferences';
import { newCardsWhere } from './todayQueue';
import { romeDay, startOfRomeDay } from './studyDay';

/**
 * The cards in the user's review scope, counted by institute (Gymnasium restyle spec §6, phase G5): what
 * the «road» of a subject draws. The scope is the session's own (`reviewScope`: one's own drafts, proposed
 * and validated cards, plus the community's validated ones in the subjects switched on in the preferences,
 * optionally narrowed to one subject), so a card is counted here exactly when the session may offer it.
 *
 * A card falls in exactly one of the first three buckets, the same split the progress read draws by subject
 * (`stati` in `lingo/progress.ts`):
 * - `nuove`: the user never reviewed it (no `LingoStatoRipasso` row of theirs);
 * - `apprendimento`: reviewed, and its current interval is under `CONSOLIDATED_DAYS` Rome days;
 * - `consolidate`: reviewed, and its interval is at least that long (`maturity`).
 * `dovute` is not a fourth share of the same cards: it counts the reviewed cards whose `dueAt` is before the
 * end of today in Rome (overdue ones included), as `dueWhere` does for the session, so it is a subset of
 * `apprendimento + consolidate`. It is not capped by the daily goal of new cards or by the session's limit.
 */

export interface InstituteStop {
  materia: LingoMateria;
  istituto: string;
  nuove: number;
  apprendimento: number;
  consolidate: number;
  dovute: number;
}

export async function readPercorso(userId: string, materia?: LingoMateria): Promise<InstituteStop[]> {
  const endOfToday = startOfRomeDay(romeDay(new Date()), 1);
  const { materieComunita } = await readPreferences(prisma, userId);
  const scope = reviewScope(userId, materieComunita, materia);
  // New cards are counted in the database (the community's corpus can be large); only the cards the user
  // has reviewed come into memory, as in the progress read.
  const [fresh, reviewed] = await Promise.all([
    prisma.lingoCard.groupBy({ by: ['materia', 'istituto'], where: newCardsWhere(userId, scope), _count: { _all: true } }),
    prisma.lingoCard.findMany(reviewedCardsQuery(userId, scope, { materia: true, istituto: true })),
  ]);

  const stops = new Map<string, InstituteStop>();
  const stopOf = (m: LingoMateria, istituto: string) => {
    const key = `${m}\u0000${istituto}`;
    let stop = stops.get(key);
    if (!stop) {
      stop = { materia: m, istituto, nuove: 0, apprendimento: 0, consolidate: 0, dovute: 0 };
      stops.set(key, stop);
    }
    return stop;
  };
  for (const group of fresh) stopOf(group.materia, group.istituto).nuove = group._count._all;
  for (const { materia: subject, istituto, statiRipasso } of reviewed) {
    for (const state of statiRipasso) {
      const stop = stopOf(subject, istituto);
      stop[maturity(state.lastReviewAt, state.dueAt)] += 1;
      if (state.dueAt < endOfToday) stop.dovute += 1;
    }
  }
  return [...stops.values()].sort((a, b) => a.materia.localeCompare(b.materia) || a.istituto.localeCompare(b.istituto, 'it'));
}
