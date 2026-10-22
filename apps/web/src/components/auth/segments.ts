/**
 * The sign-in page's wordmark as a seven-segment display (A2): the letters of «VISUALEX» in seven segments, the one
 * wrong drawing each cell passes through, and the timeline. Pure: the component draws it.
 *
 *    a
 *  f   b
 *    g
 *  e   c
 *    d
 */

export type Segment = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';

export const SEGMENTS: readonly Segment[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

/** The name as the display spells it, one letter a cell. */
export const WORD = 'VISUALEX';

/**
 * The letters, as a seven-segment display can write them. The hard ones: V as a narrow U (`narrow` below), X as an H.
 */
export const LETTERS: Record<string, readonly Segment[]> = {
  V: ['b', 'c', 'd', 'e', 'f'],
  I: ['b', 'c'],
  S: ['a', 'f', 'g', 'c', 'd'],
  U: ['b', 'c', 'd', 'e', 'f'],
  A: ['a', 'b', 'c', 'e', 'f', 'g'],
  L: ['d', 'e', 'f'],
  E: ['a', 'd', 'e', 'f', 'g'],
  X: ['b', 'c', 'e', 'f', 'g'],
};

/** The cells drawn narrower: the V, so it is not read as the U beside it. */
export const NARROW = new Set([0]);

/**
 * The one wrong drawing each cell passes through before its letter (a digit or another letter the display can
 * write): fixed, so the sequence is the same at every opening.
 */
export const WRONG: readonly (readonly Segment[])[] = [
  ['a', 'b', 'c'], // 7
  ['e', 'f'], // a left 1
  ['a', 'b', 'g', 'e', 'd'], // 2
  ['a', 'b', 'c', 'd', 'g'], // 3
  ['a', 'b', 'c', 'd', 'e', 'f', 'g'], // 8
  ['a', 'f', 'g', 'c', 'd', 'e'], // 6
  ['a', 'b', 'c', 'd', 'f', 'g'], // 9
  ['b', 'c', 'f', 'g'], // 4
];

/** The timeline, in milliseconds from the opening; under 2.5 s in all. */
export const TIMING = {
  /** Each cell lights up this long after the one before it. */
  stagger: 70,
  /** A cell shows its wrong drawing this long, then its letter. */
  wrongFor: 140,
  /** The whole display lit: the last cell's letter (7 × 70 + 140 = 630) and a beat. */
  litAt: 900,
  /** The pause on the lit name. */
  holdFor: 400,
  /** The melt into the real wordmark. */
  meltFor: 800,
  /** The open book fades in once the name is there. */
  bookFor: 300,
} as const;

export const MELT_AT = TIMING.litAt + TIMING.holdFor;
export const DONE_AT = MELT_AT + TIMING.meltFor;
export const TOTAL_MS = DONE_AT + TIMING.bookFor;

/** What a cell shows at `t` ms: nothing lit, its wrong drawing, or its letter. */
export function cellAt(index: number, t: number): readonly Segment[] {
  const start = index * TIMING.stagger;
  if (t < start) return [];
  if (t < start + TIMING.wrongFor) return WRONG[index % WRONG.length];
  return LETTERS[WORD[index]] ?? [];
}

/** The moments the display changes, for the scheduler: each cell's wrong drawing and its letter. */
export function changeTimes(): number[] {
  return [...WORD].flatMap((_, i) => [i * TIMING.stagger, i * TIMING.stagger + TIMING.wrongFor]);
}

export interface SegmentLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The display's box, in viewBox units: 8 cells of `CELL_W`, `GAP` apart, `CELL_H` tall. */
export const CELL_W = 14;
export const CELL_H = 30;
export const GAP = 6;
export const PAD = 3;
export const VIEW_W = PAD * 2 + WORD.length * CELL_W + (WORD.length - 1) * GAP;
export const VIEW_H = PAD * 2 + CELL_H;

/** The seven segments of cell `index` as lines (their ends stopping short of the corners, as on a display). */
export function cellLines(index: number): Record<Segment, SegmentLine> {
  const inset = NARROW.has(index) ? 2.5 : 0;
  const x0 = PAD + index * (CELL_W + GAP) + inset;
  const w = CELL_W - inset * 2;
  const y0 = PAD;
  const half = CELL_H / 2;
  const m = 1.6; // the gap at each joint
  return {
    a: { x1: x0 + m, y1: y0, x2: x0 + w - m, y2: y0 },
    b: { x1: x0 + w, y1: y0 + m, x2: x0 + w, y2: y0 + half - m },
    c: { x1: x0 + w, y1: y0 + half + m, x2: x0 + w, y2: y0 + CELL_H - m },
    d: { x1: x0 + m, y1: y0 + CELL_H, x2: x0 + w - m, y2: y0 + CELL_H },
    e: { x1: x0, y1: y0 + half + m, x2: x0, y2: y0 + CELL_H - m },
    f: { x1: x0, y1: y0 + m, x2: x0, y2: y0 + half - m },
    g: { x1: x0 + m, y1: y0 + half, x2: x0 + w - m, y2: y0 + half },
  };
}
