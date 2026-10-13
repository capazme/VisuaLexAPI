import { describe, expect, it } from 'vitest';
import { MIN_COLUMN_WIDTH, RAIL_WIDTH, besideLayout } from './besideLayout';

const total = (l: ReturnType<typeof besideLayout>) => (l.table === 'rail' ? RAIL_WIDTH : l.table) + l.windows.reduce((a, b) => a + b, 0);

describe('besideLayout (spec §4.3)', () => {
  it.each([1280, 1440, 1920])('no window at %i px: the table takes it all', (width) => {
    expect(besideLayout(width, 0)).toEqual({ table: width, windows: [] });
  });

  it.each([1280, 1440, 1920])('one window at %i px: half and half', (width) => {
    expect(besideLayout(width, 1)).toEqual({ table: width / 2, windows: [width / 2] });
  });

  it('half and half keeps whole pixels: the window takes the odd one', () => {
    expect(besideLayout(1001, 1)).toEqual({ table: 500, windows: [501] });
  });

  it.each([1280, 1440, 1920])('two windows at %i px: three columns, each at least 420 px', (width) => {
    const layout = besideLayout(width, 2);
    expect(layout.table).not.toBe('rail');
    expect(layout.windows).toHaveLength(2);
    for (const w of layout.windows) expect(w).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(layout.table as number).toBeGreaterThanOrEqual(MIN_COLUMN_WIDTH);
    expect(total(layout)).toBe(width);
  });

  it('thirds exactly when each gets 420 px', () => {
    expect(besideLayout(1260, 2)).toEqual({ table: 420, windows: [420, 420] });
    expect(besideLayout(1259, 2).table).toBe('rail');
  });

  it('below the thresholds the table folds into a 48 px rail and the windows share the rest', () => {
    expect(besideLayout(1200, 2)).toEqual({ table: 'rail', windows: [576, 576] });
    expect(besideLayout(1001, 2)).toEqual({ table: 'rail', windows: [476, 477] });
    expect(total(besideLayout(1001, 2))).toBe(1001);
  });

  it('never returns a negative width, nor a width for a measure that is not a number', () => {
    expect(besideLayout(-5, 0)).toEqual({ table: 0, windows: [] });
    expect(besideLayout(Number.NaN, 1)).toEqual({ table: 0, windows: [0] });
    expect(besideLayout(20, 2)).toEqual({ table: 'rail', windows: [0, 0] });
  });
});
