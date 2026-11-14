/**
 * How the results area is shared between the practice's table and the windows beside it
 * (spec §4.3; U2, the two views). Pure: the row measures the area and draws what this returns.
 */

/** The folded index's width: a rail with «Pratica» written along it. */
export const RAIL_WIDTH = 48;

/** The index's width in the reading view (U2 «Lettura»): the acts' headings and their articles, one a line. */
export const INDEX_WIDTH = 320;

/** The least width a window gets beside the index; below it the index folds into the rail. */
export const MIN_COLUMN_WIDTH = 420;

/**
 * The overview's grid (U2 «Panoramica»): one panel per act, tracks of at least 38.75rem a 1.5rem gap apart — one
 * column below about 1264 px of frame, two from there, three from about 1908 px; one act alone takes the width.
 */
export const OVERVIEW_GRID = 'grid grid-cols-[repeat(auto-fit,minmax(min(38.75rem,100%),1fr))] items-start gap-6';

export interface BesideLayout {
  /** The table's width (the whole area in the overview, the index beside windows), or `'rail'` when it is folded. */
  table: number | 'rail';
  /** One width per window, in the windows' order. */
  windows: number[];
}

/** `free` shared by `count` columns in whole pixels, the last taking the remainder. */
function share(free: number, count: number): number[] {
  const each = Math.floor(free / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? free - each * (count - 1) : each));
}

/**
 * No window: the table takes it all (the overview). Windows: the index takes `INDEX_WIDTH` and the windows share the
 * rest when each gets `MIN_COLUMN_WIDTH`; else the index folds into the rail and the windows share what it leaves.
 */
export function besideLayout(width: number, count: 0 | 1 | 2): BesideLayout {
  const free = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  if (count === 0) return { table: free, windows: [] };
  if ((free - INDEX_WIDTH) / count >= MIN_COLUMN_WIDTH) return { table: INDEX_WIDTH, windows: share(free - INDEX_WIDTH, count) };
  return { table: 'rail', windows: share(Math.max(0, free - RAIL_WIDTH), count) };
}
