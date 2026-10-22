import { describe, expect, it } from 'vitest';
import { attachPoint, outlinePoints, wirePaths } from '../wirePath';

const CARD = { left: 100, top: 200, width: 400, height: 200 };
const points = (d: string) => d.split(/[ML]/).filter(Boolean).map((p) => p.trim().split(' ').map(Number));

describe('wirePath — the wire from the button to the card (K1b)', () => {
  it('goes round the card with its rounded corners, inside its box', () => {
    const outline = outlinePoints(CARD, 16);
    expect(outline.every(([x, y]) => x >= 100 && x <= 500 && y >= 200 && y <= 400)).toBe(true);
    // The corners are rounded: no point sits on a corner of the box.
    expect(outline.some(([x, y]) => x === 100 && y === 200)).toBe(false);
  });

  it('meets the card on the edge that faces the button, kept off the corners', () => {
    expect(attachPoint(CARD, [300, 600], 16)).toEqual({ point: [300, 400], edge: 'bottom' });
    expect(attachPoint(CARD, [20, 600], 16).point).toEqual([116, 400]);
    expect(attachPoint(CARD, [300, 50], 16).edge).toBe('top');
    expect(attachPoint(CARD, [40, 300], 16)).toEqual({ point: [100, 300], edge: 'left' });
    expect(attachPoint(CARD, [700, 300], 16).edge).toBe('right');
  });

  it('leaves the button from its side that faces the card, and draws the outline both ways from the same point', () => {
    const button = { left: 280, top: 600, width: 40, height: 36 };
    const paths = wirePaths(button, CARD, 16);
    expect(paths.start).toEqual([300, 600]);
    expect(paths.attach).toEqual([300, 400]);
    const cw = points(paths.clockwise);
    const ccw = points(paths.counter);
    // Each a closed round from the attach point; the other one the same round reversed, so their halves meet.
    expect(cw[0]).toEqual([300, 400]);
    expect(cw.at(-1)).toEqual([300, 400]);
    expect(ccw).toEqual([...cw].reverse());
    // Clockwise from the bottom edge goes left first (y down).
    expect(cw[1][0]).toBeLessThan(300);
  });

  it('works from every side', () => {
    for (const button of [
      { left: 280, top: 20, width: 40, height: 36 },
      { left: 10, top: 280, width: 40, height: 36 },
      { left: 600, top: 280, width: 40, height: 36 },
    ]) {
      const { clockwise, counter, attach } = wirePaths(button, CARD, 16);
      expect(points(clockwise)[0]).toEqual(attach);
      expect(points(counter)[0]).toEqual(attach);
    }
  });
});
