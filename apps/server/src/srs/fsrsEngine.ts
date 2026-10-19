/**
 * The spaced-repetition engine of LingoLex: FSRS v4 (decision A3), as a pure
 * function. No database, no clock, no dependency: the caller says what the
 * card's state was, how the answer went and how many days have passed, and gets
 * the new state and the days to the next review. Persisting it is the session
 * routes' job (`LingoRevisioneSRS` keeps rating, days, stability, difficulty).
 *
 * The algorithm is the one of https://github.com/open-spaced-repetition/fsrs4anki
 * (wiki, "The Algorithm", FSRS v4). `tests/unit/srs/fsrsEngine.test.ts` pins the
 * formulas, and the engine was checked against `ts-fsrs@3.0.0`, which is FSRS
 * v4 proper, over thousands of random states (see the plan,
 * `docs/superpowers/plans/2026-09-30-lingolex-foundation.md`, Task 6). Note that
 * `ts-fsrs@3.5.x` is FSRS 4.5, another curve with other weights.
 *
 * What it leaves out on purpose: learning steps in minutes and the reordering
 * of the four options' intervals. Those belong to a scheduler; the specification's
 * review record keeps days, stability and difficulty and nothing else.
 */

/** 1 again, 2 hard, 3 good, 4 easy. */
export type Rating = 1 | 2 | 3 | 4;

/** What the algorithm remembers about a card after a review. */
export interface SrsState {
  stability: number;
  difficulty: number;
}

export interface SrsOptions {
  /** The 17 FSRS v4 weights. Defaults to `DEFAULT_WEIGHTS`; a fit to the users' own reviews would pass its own. */
  weights?: readonly number[];
  /** The chance of recall the next review is aimed at, strictly between 0 and 1. Default 0.9. */
  requestRetention?: number;
  /** No interval is ever longer than this many days. Default 36500. */
  maximumInterval?: number;
}

export interface ReviewResult extends SrsState {
  /** Days to the next review, at least 1. */
  scheduledDays: number;
  /** The chance of recall at the moment of this review; `null` for a card's first review. */
  retrievability: number | null;
}

/** The 17 default weights published for FSRS v4. */
export const DEFAULT_WEIGHTS: readonly number[] = [
  0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61,
];

const DEFAULT_REQUEST_RETENTION = 0.9;
const DEFAULT_MAXIMUM_INTERVAL = 36_500;
const MIN_DIFFICULTY = 1;
const MAX_DIFFICULTY = 10;
/**
 * A floor for a tiny positive result, so that the stability stays usable as a
 * divisor and an exponent base. It cannot repair a result that is not a number:
 * that is an error, raised in `review`.
 */
const MIN_STABILITY = 0.01;
const INITIAL_STABILITY_FLOOR = 0.1;

function isRating(value: unknown): value is Rating {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function checkWeights(weights: readonly number[]): readonly number[] {
  if (weights.length !== 17 || !weights.every(Number.isFinite)) {
    throw new RangeError('weights must be seventeen finite numbers');
  }
  return weights;
}

function checkRetention(requestRetention: number): number {
  if (!(requestRetention > 0 && requestRetention < 1)) {
    throw new RangeError('requestRetention must be strictly between 0 and 1');
  }
  return requestRetention;
}

function checkMaximumInterval(maximumInterval: number): number {
  if (!(Number.isFinite(maximumInterval) && maximumInterval >= 1)) {
    throw new RangeError('maximumInterval must be a finite number of days, at least 1');
  }
  return maximumInterval;
}

function clampDifficulty(difficulty: number): number {
  // Two decimals at every step, as the reference implementations do.
  const rounded = Number(difficulty.toFixed(2));
  return Math.min(Math.max(rounded, MIN_DIFFICULTY), MAX_DIFFICULTY);
}

/** The chance of recalling a card `elapsedDays` after its last review: R = (1 + t / 9S)^-1. */
export function retrievability(elapsedDays: number, stability: number): number {
  if (!(Number.isFinite(elapsedDays) && elapsedDays >= 0)) {
    throw new RangeError('elapsedDays must be a finite number, zero or more');
  }
  if (!(Number.isFinite(stability) && stability > 0)) {
    throw new RangeError('stability must be a finite number above zero');
  }
  return Math.pow(1 + elapsedDays / (9 * stability), -1);
}

/** Days until the chance of recall falls to the requested retention: I = 9·S·(1/r − 1), rounded, within 1 and the maximum. */
export function nextIntervalDays(stability: number, options: SrsOptions = {}): number {
  const retention = checkRetention(options.requestRetention ?? DEFAULT_REQUEST_RETENTION);
  const maximum = checkMaximumInterval(options.maximumInterval ?? DEFAULT_MAXIMUM_INTERVAL);
  if (!(Number.isFinite(stability) && stability > 0)) {
    throw new RangeError('stability must be a finite number above zero');
  }
  const interval = Math.round(stability * 9 * (1 / retention - 1));
  return Math.min(Math.max(interval, 1), maximum);
}

/**
 * One review. `previous` is the card's state after its last review, or `null`
 * for the first one; `elapsedDays` is the time since that last review (ignored
 * for a first review, but still checked).
 */
export function review(
  previous: SrsState | null,
  rating: Rating,
  elapsedDays: number,
  options: SrsOptions = {}
): ReviewResult {
  if (!isRating(rating)) throw new RangeError('rating must be 1, 2, 3 or 4');
  if (!(Number.isFinite(elapsedDays) && elapsedDays >= 0)) {
    throw new RangeError('elapsedDays must be a finite number, zero or more');
  }
  const weights = checkWeights(options.weights ?? DEFAULT_WEIGHTS);
  checkRetention(options.requestRetention ?? DEFAULT_REQUEST_RETENTION);
  checkMaximumInterval(options.maximumInterval ?? DEFAULT_MAXIMUM_INTERVAL);
  const w = weights;

  if (previous === null) {
    const stability = Math.max(w[rating - 1], INITIAL_STABILITY_FLOOR);
    const difficulty = Math.min(Math.max(w[4] - (rating - 3) * w[5], MIN_DIFFICULTY), MAX_DIFFICULTY);
    return { stability, difficulty, scheduledDays: nextIntervalDays(stability, options), retrievability: null };
  }

  const { stability, difficulty } = previous;
  if (!(Number.isFinite(stability) && stability > 0)) {
    throw new RangeError('stored stability must be a finite number above zero');
  }
  if (!(Number.isFinite(difficulty) && difficulty >= MIN_DIFFICULTY && difficulty <= MAX_DIFFICULTY)) {
    throw new RangeError('stored difficulty must be a finite number from 1 to 10');
  }

  const recall = retrievability(elapsedDays, stability);

  // Difficulty first: the stability update uses the new value, as the reference does.
  const drifted = difficulty - w[6] * (rating - 3);
  const nextDifficulty = clampDifficulty(w[7] * w[4] + (1 - w[7]) * drifted);

  let nextStability: number;
  if (rating === 1) {
    nextStability =
      w[11] * Math.pow(nextDifficulty, -w[12]) * (Math.pow(stability + 1, w[13]) - 1) * Math.exp((1 - recall) * w[14]);
  } else {
    const hardPenalty = rating === 2 ? w[15] : 1;
    const easyBonus = rating === 4 ? w[16] : 1;
    nextStability =
      stability *
      (1 +
        Math.exp(w[8]) *
          (11 - nextDifficulty) *
          Math.pow(stability, -w[9]) *
          (Math.exp((1 - recall) * w[10]) - 1) *
          hardPenalty *
          easyBonus);
  }
  // Not reachable with the default weights. A custom set can overflow (e^w8 with a huge w8,
  // times a zero), and a NaN must not travel on into a stored row.
  if (!Number.isFinite(nextStability)) {
    throw new RangeError('these weights give a stability that is not a finite number');
  }
  nextStability = Math.max(nextStability, MIN_STABILITY);

  return {
    stability: nextStability,
    difficulty: nextDifficulty,
    scheduledDays: nextIntervalDays(nextStability, options),
    retrievability: recall,
  };
}
