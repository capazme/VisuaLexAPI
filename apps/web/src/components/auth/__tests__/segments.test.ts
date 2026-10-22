import { describe, expect, it } from 'vitest';
import { cellAt, cellLines, isWebKit, LETTERS, MELT_AT, DONE_AT, TIMING, TOTAL_MS, WORD, WRONG } from '../segments';

describe('segments — «VISUALEX» on a seven-segment display (A2)', () => {
  it('has a letter for every cell, and the hard ones as the brief says: V a U, X an H', () => {
    expect([...WORD].every((letter) => LETTERS[letter]?.length)).toBe(true);
    expect(LETTERS.V).toEqual(LETTERS.U);
    expect([...LETTERS.X].sort()).toEqual(['b', 'c', 'e', 'f', 'g']);
  });

  it('draws the V\'s cell narrower than the U\'s, so the two are told apart', () => {
    // The cell's width, read on its bottom segment (which both letters light).
    const width = (i: number) => cellLines(i).d.x2 - cellLines(i).d.x1;
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

describe('isWebKit — where the melt is the cross-fade alone (A2)', () => {
  const UA = {
    safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
    firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
    edgeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/129.0.2792.84 Mobile/15E148 Safari/605.1.15',
    chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    firefoxDesktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  };

  it('is every browser on an iPhone, Safari on a Mac, and an iPad that says it is a Mac', () => {
    expect(isWebKit(UA.safariMac)).toBe(true);
    expect(isWebKit(UA.safariIphone)).toBe(true);
    expect(isWebKit(UA.chromeIphone)).toBe(true);
    expect(isWebKit(UA.firefoxIphone)).toBe(true);
    expect(isWebKit(UA.edgeIphone)).toBe(true);
    // iPadOS's desktop user agent is a Mac's Safari, with touch points.
    expect(isWebKit(UA.safariMac, 5)).toBe(true);
  });

  it('is not Chrome or Edge on a computer, Chrome on Android, or Firefox on a computer', () => {
    expect(isWebKit(UA.chromeMac)).toBe(false);
    expect(isWebKit(UA.chromeMac, 0)).toBe(false);
    expect(isWebKit(UA.edgeWindows)).toBe(false);
    expect(isWebKit(UA.chromeAndroid)).toBe(false);
    expect(isWebKit(UA.firefoxDesktop)).toBe(false);
  });
});
