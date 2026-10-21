/**
 * Gymnasium's levels (Gymnasium XP spec §4): the one definition of the curve. Going from level n to n + 1
 * costs `LEVEL_BASE + LEVEL_STEP·(n − 1)` XP; a new user is at level 1 with 0 XP and there is no highest level.
 *
 * The level is never stored: every read computes it from the ledger's total (`lingo/xpLedger.ts`), so it
 * cannot drift from the credits. The curve is fixed before 1.10 and, once released, may only become gentler
 * (L-27 choice 2): a steeper one would lower some users' levels. Integers only, no floating point.
 */

export const LEVEL_BASE = 100;
export const LEVEL_STEP = 25;

export interface LevelPosition {
  livello: number;
  /** The points earned inside the current level. */
  nelLivello: number;
  /** What the next level costs in all. */
  perIlProssimo: number;
}

/** What going from `level` to `level + 1` costs. */
function stepCost(level: number): number {
  return LEVEL_BASE + LEVEL_STEP * (level - 1);
}

/** The total needed to reach `level`: 100·(L − 1) + 12.5·(L − 1)·(L − 2), exact in integers ((L − 1)·(L − 2) is even). */
export function totalFor(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) throw new RangeError('a level is a whole number from 1');
  return LEVEL_BASE * (level - 1) + (LEVEL_STEP * (level - 1) * (level - 2)) / 2;
}

export function levelOf(total: number): LevelPosition {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('a total of XP is a whole number from 0');
  let livello = 1;
  let rest = total;
  while (rest >= stepCost(livello)) {
    rest -= stepCost(livello);
    livello += 1;
  }
  return { livello, nelLivello: rest, perIlProssimo: stepCost(livello) };
}
