import { describe, expect, it } from 'vitest';
import { INDEX_WIDTH, MIN_COLUMN_WIDTH, RAIL_WIDTH, besideLayout } from './besideLayout';

const total = (l: ReturnType<typeof besideLayout>) => (l.table === 'rail' ? RAIL_WIDTH : l.table) + l.windows.reduce((a, b) => a + b, 0);

describe('besideLayout (spec §4.3, U2)', () => {
  it.each([1280, 1440, 1920])('no window at %i px: the table takes it all (the overview)', (width) => {
    expect(besideLayout(width, 0)).toEqual({ table: width, windows: [] });
  });

  it.each([1078, 1600, 1824, 2400])('one window at %i px: the index, 320 px, and the window takes the rest', (width) => {
    expect(besideLayout(width, 1)).toEqual({ table: INDEX_WIDTH, windows: [width - INDEX_WIDTH] });
  });

  it.each([1160, 1600, 1824, 2400])('two windows at %i px: the index and two windows of at least 420 px', (width) => {
    const layout = besideLayout(width, 2);
    expect(layout.table).toBe(INDEX_WIDTH);
    expect(layout.windows).toHaveLength(2);
    for (const w of layout.windows) expect(w).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(total(layout)).toBe(width);
  });

  it('the windows share in whole pixels: the last takes the odd one', () => {
    expect(besideLayout(1601, 2)).toEqual({ table: 320, windows: [640, 641] });
  });

  it('the index stays exactly while each window gets 420 px', () => {
    expect(besideLayout(1160, 2)).toEqual({ table: 320, windows: [420, 420] });
    expect(besideLayout(1159, 2).table).toBe('rail');
    expect(besideLayout(740, 1)).toEqual({ table: 320, windows: [420] });
    expect(besideLayout(739, 1).table).toBe('rail');
  });

  it('below the thresholds the index folds into a 48 px rail and the windows share the rest', () => {
    expect(besideLayout(1100, 2)).toEqual({ table: 'rail', windows: [526, 526] });
    expect(besideLayout(1001, 2)).toEqual({ table: 'rail', windows: [476, 477] });
    expect(besideLayout(700, 1)).toEqual({ table: 'rail', windows: [652] });
    expect(total(besideLayout(1001, 2))).toBe(1001);
  });

  it('never returns a negative width, nor a width for a measure that is not a number', () => {
    expect(besideLayout(-5, 0)).toEqual({ table: 0, windows: [] });
    expect(besideLayout(Number.NaN, 1)).toEqual({ table: 'rail', windows: [0] });
    expect(besideLayout(20, 2)).toEqual({ table: 'rail', windows: [0, 0] });
  });
});
