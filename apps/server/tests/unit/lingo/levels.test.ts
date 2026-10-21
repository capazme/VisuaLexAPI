import { describe, expect, it } from 'vitest';
import { levelOf, totalFor } from '../../../src/lingo/levels';

// The level curve (Gymnasium XP spec §4, L-27 choice 2): from level n to n + 1 costs 100 + 25·(n − 1), no ceiling.

describe('totalFor', () => {
  it('matches the table of the spec', () => {
    const table: [number, number][] = [[1, 0], [2, 100], [3, 225], [5, 550], [10, 1800], [20, 6175], [50, 34300]];
    for (const [level, total] of table) expect(totalFor(level)).toBe(total);
  });

  it('refuses what is not a level', () => {
    expect(() => totalFor(0)).toThrow(RangeError);
    expect(() => totalFor(1.5)).toThrow(RangeError);
  });
});

describe('levelOf', () => {
  it('places a total inside its level', () => {
    expect(levelOf(0)).toEqual({ livello: 1, nelLivello: 0, perIlProssimo: 100 });
    expect(levelOf(99)).toEqual({ livello: 1, nelLivello: 99, perIlProssimo: 100 });
    expect(levelOf(100)).toEqual({ livello: 2, nelLivello: 0, perIlProssimo: 125 });
    expect(levelOf(412)).toEqual({ livello: 4, nelLivello: 37, perIlProssimo: 175 });
    expect(levelOf(1799)).toEqual({ livello: 9, nelLivello: 299, perIlProssimo: 300 });
    expect(levelOf(1800)).toEqual({ livello: 10, nelLivello: 0, perIlProssimo: 325 });
  });

  it('has no highest level and stays in integers', () => {
    const total = 10_000_000;
    const { livello, nelLivello, perIlProssimo } = levelOf(total);
    expect(Number.isInteger(livello) && Number.isInteger(nelLivello) && Number.isInteger(perIlProssimo)).toBe(true);
    expect(totalFor(livello)).toBeLessThanOrEqual(total);
    expect(totalFor(livello + 1)).toBeGreaterThan(total);
    expect(totalFor(livello) + nelLivello).toBe(total);
    expect(perIlProssimo).toBe(totalFor(livello + 1) - totalFor(livello));
  });

  it('agrees with totalFor at every boundary of the first hundred levels', () => {
    for (let level = 1; level <= 100; level++) {
      expect(levelOf(totalFor(level)).livello).toBe(level);
      if (level > 1) expect(levelOf(totalFor(level) - 1).livello).toBe(level - 1);
    }
  });

  it('refuses what is not a total', () => {
    expect(() => levelOf(-1)).toThrow(RangeError);
    expect(() => levelOf(1.5)).toThrow(RangeError);
    expect(() => levelOf(Number.NaN)).toThrow(RangeError);
    expect(() => levelOf(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
