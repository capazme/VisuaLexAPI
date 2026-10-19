import type { LingoCardStato, LingoMateria, Prisma } from '@prisma/client';
import { review, type Rating, type SrsState } from '../srs/fsrsEngine';

/** The daily goal of new cards until the user changes it (spec decision 9). */
export const DEFAULT_NUOVE_AL_GIORNO = 20;

const RATINGS: readonly Rating[] = [1, 2, 3, 4];

/**
 * The states in which one's own card is reviewed. A card that leaves them (archived, «da rivedere») keeps
 * its review state row but is not offered, graded or listed as due.
 */
export const REVIEWABLE_OWN_STATES: LingoCardStato[] = ['BOZZA_PERSONALE', 'PROPOSTA_COMMUNITY', 'VALIDATA'];

/**
 * The cards a user may review (spec decision 8): their own that are drafts,
 * proposed or validated, and the community's validated ones in the subjects
 * they switched on, optionally narrowed to one subject and, within it, to one institute. Never «da rivedere»
 * or archived.
 *
 * The community branch does not say `autoreId != me`: in SQL that drops a card
 * with no author (its author's account is gone), which is still the community's.
 * A card of one's own that is validated is matched by the first branch already.
 * With no subjects on, `in: []` matches nothing.
 */
export function reviewScope(userId: string, materieComunita: LingoMateria[], materia?: LingoMateria, istituto?: string): Prisma.LingoCardWhereInput {
  const scope: Prisma.LingoCardWhereInput = {
    OR: [
      { autoreId: userId, stato: { in: REVIEWABLE_OWN_STATES } },
      { stato: 'VALIDATA', materia: { in: materieComunita } },
    ],
  };
  if (!materia) return scope;
  // An institute only exists within a subject, and is matched exactly as `/percorso` returns it.
  return { AND: [scope, { materia }, ...(istituto === undefined ? [] : [{ istituto }])] };
}

/** The days to the next review that each grade would give: what the four buttons show. `state` is null for a new card. */
export function previewIntervals(state: SrsState | null, elapsedDays: number): Record<Rating, number> {
  const days = {} as Record<Rating, number>;
  for (const rating of RATINGS) days[rating] = review(state, rating, elapsedDays).scheduledDays;
  return days;
}
