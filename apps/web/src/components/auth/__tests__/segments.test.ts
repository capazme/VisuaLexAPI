import { describe, expect, it } from 'vitest';
import { cellAt, cellLines, LETTERS, MELT_AT, DONE_AT, TIMING, TOTAL_MS, WORD, WRONG } from '../segments';

describe('segments — «VISUALEX» on a seven-segment display (A2)', () => {
  it('has a letter for every cell, and the hard ones as the brief says: V a U, X an H', () => {
    expect([...WORD].every((letter) => LETTERS[letter]?.length)).toBe(true);
    expect(LETTERS.V).toEqual(LETTERS.U);
    expect([...LETTERS.X].sort()).toEqual(['b', 'c', 'e', 'f', 'g']);
  });

  it('draws the V narrower than the U, so the two are told apart', () => {
    const width = (i: number) => cellLines(i).a.x2 - cellLines(i).a.x1;
    expect(width(0)).toBeLessThan(width(3));
  });

  it('passes each cell through one wrong drawing, never its own letter, then stops on its letter', () => {
    [...WORD].forEach((letter, i) => {
      const start = i * TIMING.stagger;
      expect(cellAt(i, start - 1)).toEqual([]);
      const wrong = cellAt(i, start);
      expect(wrong).toEqual(WRONG[i]);
      expect([...wrong].sort()).not.toEqual([...LETTERS[letter]].sort());
      expect(cellAt(i, start + TIMING.wrongFor)).toEqual(LETTERS[letter]);
      expect(cellAt(i, MELT_AT)).toEqual(LETTERS[letter]);
    });
  });

  it('lights all, holds, melts, and ends under 2.5 s', () => {
    expect((WORD.length - 1) * TIMING.stagger + TIMING.wrongFor).toBeLessThanOrEqual(TIMING.litAt);
    expect(DONE_AT).toBe(TIMING.litAt + TIMING.holdFor + TIMING.meltFor);
    expect(TOTAL_MS).toBeLessThan(2500);
  });
});
