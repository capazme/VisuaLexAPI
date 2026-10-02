import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  nextIntervalDays,
  retrievability,
  review,
  type Rating,
  type SrsState,
} from '../../../src/srs/fsrsEngine';

const w = DEFAULT_WEIGHTS;

describe('DEFAULT_WEIGHTS', () => {
  it('are the 17 published FSRS v4 defaults', () => {
    expect(w).toEqual([0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61]);
  });
});

describe('retrievability', () => {
  it('is 1 when no time has passed', () => {
    expect(retrievability(0, 5)).toBe(1);
  });

  it('is exactly 0.9 when the elapsed time equals the stability', () => {
    expect(retrievability(5, 5)).toBeCloseTo(0.9, 12);
  });

  it('falls as time passes', () => {
    expect(retrievability(1, 5)).toBeGreaterThan(retrievability(10, 5));
    expect(retrievability(10, 5)).toBeGreaterThan(retrievability(100, 5));
  });

  it('rises with stability for the same elapsed time', () => {
    expect(retrievability(10, 20)).toBeGreaterThan(retrievability(10, 5));
  });
});

describe('nextIntervalDays', () => {
  it('is the stability, rounded, at the default 90% retention', () => {
    expect(nextIntervalDays(10)).toBe(10);
    expect(nextIntervalDays(2.4)).toBe(2);
  });

  it('shortens as the requested retention rises and lengthens as it falls', () => {
    expect(nextIntervalDays(10, { requestRetention: 0.95 })).toBe(5);
    expect(nextIntervalDays(10, { requestRetention: 0.8 })).toBe(23);
  });

  it('is never below one day', () => {
    expect(nextIntervalDays(0.01)).toBe(1);
  });

  it('never exceeds the maximum interval', () => {
    expect(nextIntervalDays(1_000_000)).toBe(36_500);
    expect(nextIntervalDays(500, { maximumInterval: 180 })).toBe(180);
  });
});

describe('first review', () => {
  it.each([
    [1, 0.4, 6.81, 1],
    [2, 0.6, 5.87, 1],
    [3, 2.4, 4.93, 2],
    [4, 5.8, 3.99, 6],
  ] as const)('rating %i gives stability %f, difficulty %f, interval %i day(s)', (rating, stability, difficulty, days) => {
    const result = review(null, rating, 0);
    expect(result.stability).toBeCloseTo(stability, 10);
    expect(result.difficulty).toBeCloseTo(difficulty, 10);
    expect(result.scheduledDays).toBe(days);
  });

  it('has no retrievability, since there was nothing to recall yet', () => {
    expect(review(null, 3, 0).retrievability).toBeNull();
  });

  it('takes the weights it is given', () => {
    const custom = [...w];
    custom[0] = 1.5;
    expect(review(null, 1, 0, { weights: custom }).stability).toBe(1.5);
  });
});

describe('later reviews', () => {
  const afterGood: SrsState = { stability: 2.4, difficulty: 4.93 };

  it('a Good review after two days matches the formula written out by hand', () => {
    const r = 1 / (1 + 2 / (9 * 2.4));
    const expected = 2.4 * (1 + Math.exp(1.49) * (11 - 4.93) * Math.pow(2.4, -0.14) * (Math.exp((1 - r) * 0.94) - 1));
    const result = review(afterGood, 3, 2);
    expect(result.retrievability).toBeCloseTo(r, 12);
    expect(result.stability).toBeCloseTo(expected, 10);
    expect(result.stability).toBeCloseTo(7.14, 1);
    expect(result.difficulty).toBe(4.93);
    expect(result.scheduledDays).toBe(7);
  });

  it('forgetting matches the formula written out by hand, with the new difficulty', () => {
    const state: SrsState = { stability: 10, difficulty: 5 };
    const r = 1 / (1 + 12 / (9 * 10));
    const newDifficulty = Math.round((0.01 * 4.93 + 0.99 * (5 - 0.86 * (1 - 3))) * 100) / 100;
    const expected = 2.18 * Math.pow(newDifficulty, -0.05) * (Math.pow(10 + 1, 0.34) - 1) * Math.exp((1 - r) * 1.26);
    const result = review(state, 1, 12);
    expect(result.difficulty).toBe(newDifficulty);
    expect(result.stability).toBeCloseTo(expected, 10);
  });

  it.each([
    [1, 1],
    [10, 10],
    [100, 60],
  ])('forgetting shrinks stability (S=%f, after %f days)', (stability, days) => {
    for (const difficulty of [2, 5, 9]) {
      expect(review({ stability, difficulty }, 1, days).stability).toBeLessThan(stability);
    }
  });

  it('a better answer never earns a shorter stability: Hard < Good < Easy', () => {
    const state: SrsState = { stability: 12, difficulty: 6 };
    const hard = review(state, 2, 12).stability;
    const good = review(state, 3, 12).stability;
    const easy = review(state, 4, 12).stability;
    expect(hard).toBeLessThan(good);
    expect(good).toBeLessThan(easy);
  });

  it('a harder answer raises the difficulty and an easier one lowers it', () => {
    const state: SrsState = { stability: 12, difficulty: 6 };
    expect(review(state, 1, 12).difficulty).toBeGreaterThan(6);
    expect(review(state, 2, 12).difficulty).toBeGreaterThan(6);
    expect(review(state, 4, 12).difficulty).toBeLessThan(6);
  });

  it('keeps the difficulty inside 1 to 10 over a long run of the same answer', () => {
    let again: SrsState = { stability: 5, difficulty: 5 };
    let easy: SrsState = { stability: 5, difficulty: 5 };
    for (let i = 0; i < 200; i++) {
      again = review(again, 1, 3);
      easy = review(easy, 4, 3);
      expect(again.difficulty).toBeLessThanOrEqual(10);
      expect(easy.difficulty).toBeGreaterThanOrEqual(1);
    }
  });

  it('rounds the difficulty to two decimals', () => {
    const result = review({ stability: 3, difficulty: 4.567 }, 3, 3);
    expect(result.difficulty).toBe(Math.round(result.difficulty * 100) / 100);
  });

  it('an early review changes little, a late one gains more', () => {
    const state: SrsState = { stability: 10, difficulty: 5 };
    const early = review(state, 3, 1).stability;
    const late = review(state, 3, 30).stability;
    expect(late).toBeGreaterThan(early);
  });
});

describe('numeric safety (nothing the database could hold may blow the engine up)', () => {
  it('a ten-year gap still gives a finite, bounded result', () => {
    for (const rating of [1, 2, 3, 4] as Rating[]) {
      const result = review({ stability: 10, difficulty: 5 }, rating, 3650);
      expect(Number.isFinite(result.stability)).toBe(true);
      expect(result.stability).toBeGreaterThan(0);
      expect(result.scheduledDays).toBeGreaterThanOrEqual(1);
      expect(result.scheduledDays).toBeLessThanOrEqual(36_500);
    }
  });

  it('a long run of Easy answers after long gaps stays finite', () => {
    let state: SrsState = { stability: 1, difficulty: 5 };
    for (let i = 0; i < 100; i++) {
      state = review(state, 4, 365);
      expect(Number.isFinite(state.stability)).toBe(true);
    }
  });

  it('never lets the stability fall below the floor', () => {
    const result = review({ stability: 0.01, difficulty: 10 }, 1, 100);
    expect(result.stability).toBeGreaterThanOrEqual(0.01);
  });

  it.each([0, 5, 2.5, NaN])('refuses the rating %s', (rating) => {
    expect(() => review(null, rating as Rating, 0)).toThrow(RangeError);
  });

  it.each([-1, NaN, Infinity])('refuses elapsed days of %s', (days) => {
    expect(() => review({ stability: 3, difficulty: 5 }, 3, days)).toThrow(RangeError);
  });

  it.each([0, -2, NaN, Infinity])('refuses a stored stability of %s', (stability) => {
    expect(() => review({ stability, difficulty: 5 }, 3, 3)).toThrow(RangeError);
  });

  it.each([0, 11, NaN])('refuses a stored difficulty of %s', (difficulty) => {
    expect(() => review({ stability: 3, difficulty }, 3, 3)).toThrow(RangeError);
  });

  it.each([0, 1, 1.5, -0.2, NaN])('refuses a requested retention of %s', (requestRetention) => {
    expect(() => review(null, 3, 0, { requestRetention })).toThrow(RangeError);
    expect(() => nextIntervalDays(5, { requestRetention })).toThrow(RangeError);
  });

  it.each([0, -1, NaN])('refuses a maximum interval of %s', (maximumInterval) => {
    expect(() => nextIntervalDays(5, { maximumInterval })).toThrow(RangeError);
  });

  it('a stored stability of 1e300 still gives a finite result, capped at the maximum interval', () => {
    const result = review({ stability: 1e300, difficulty: 5 }, 3, 10);
    expect(Number.isFinite(result.stability)).toBe(true);
    expect(result.scheduledDays).toBe(36_500);
  });

  it('refuses weights that make the stability blow up, instead of handing back a NaN', () => {
    const extreme = [...w];
    extreme[8] = 1000; // e^1000 is Infinity, and Infinity times a zero is NaN
    expect(() => review({ stability: 3, difficulty: 5 }, 3, 0, { weights: extreme })).toThrow(RangeError);
  });

  it.each([NaN, 0, -1, Infinity])('nextIntervalDays refuses a stability of %s', (stability) => {
    expect(() => nextIntervalDays(stability)).toThrow(RangeError);
  });

  it.each([
    [0, 0],
    [-1, 5],
    [NaN, 5],
    [3, NaN],
    [3, -2],
    [Infinity, 5],
  ])('retrievability refuses elapsed days %s with stability %s', (elapsedDays, stability) => {
    expect(() => retrievability(elapsedDays, stability)).toThrow(RangeError);
  });

  it('refuses weights that are not seventeen finite numbers', () => {
    expect(() => review(null, 3, 0, { weights: [1, 2, 3] })).toThrow(RangeError);
    expect(() => review(null, 3, 0, { weights: [...w.slice(0, 16), NaN] })).toThrow(RangeError);
  });
});
