/**
 * How the results area is shared between the practice's table and the windows beside it
 * (spec §4.3). Pure: the row measures the area and draws what this returns.
 */

/** The folded table's width: a rail with «Pratica» written along it. */
export const RAIL_WIDTH = 48;

/** The least width a column gets when the table and two windows share the area in thirds. */
export const MIN_COLUMN_WIDTH = 420;

export interface BesideLayout {
  /** The table's width, or `'rail'` when it is folded into the rail. */
  table: number | 'rail';
  /** One width per window, in the windows' order. */
  windows: number[];
}

/**
 * No window: the table takes it all. One: table and window half and half. Two: three equal
 * columns when each gets `MIN_COLUMN_WIDTH`, else the table folds into the rail and the windows
 * share the rest. Whole pixels; the table (or the last window) takes the remainder.
 */
export function besideLayout(width: number, count: 0 | 1 | 2): BesideLayout {
  const free = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0;
  if (count === 0) return { table: free, windows: [] };
  if (count === 1) {
    const table = Math.floor(free / 2);
    return { table, windows: [free - table] };
  }
  const third = Math.floor(free / 3);
  if (third >= MIN_COLUMN_WIDTH) return { table: free - 2 * third, windows: [third, third] };
  const rest = Math.max(0, free - RAIL_WIDTH);
  const first = Math.floor(rest / 2);
  return { table: 'rail', windows: [first, rest - first] };
}
