import { describe, expect, it } from 'vitest';
import { HALFTONE_TIMING, coverRadiusAt, fullRadius, halftoneLattice, revealRadiusAt, totalDuration } from './halftone';

describe('the section change halftone (S2)', () => {
  it('lasts between 600 and 750 ms, on a computer and on a phone', () => {
    for (const t of Object.values(HALFTONE_TIMING)) {
      expect(totalDuration(t)).toBeGreaterThanOrEqual(600);
      expect(totalDuration(t)).toBeLessThanOrEqual(750);
    }
  });

  it('is sparser and shorter on a phone', () => {
    const { desktop, phone } = HALFTONE_TIMING;
    expect(phone.spacing).toBeGreaterThan(desktop.spacing);
    expect(phone.coverWave).toBeLessThan(desktop.coverWave);
    expect(totalDuration(phone)).toBeLessThan(totalDuration(desktop));
  });

  it('sets its dots on a grid turned 45°, neighbours `spacing` apart', () => {
    const spacing = 20;
    const { xs, ys } = halftoneLattice(100, 80, spacing);
    let nearest = Infinity;
    for (let k = 1; k < xs.length; k += 1) nearest = Math.min(nearest, Math.hypot(xs[k] - xs[0], ys[k] - ys[0]));
    expect(nearest).toBeCloseTo(spacing, 5);
    // The nearest neighbours sit on the diagonals, not on the row.
    const diagonal = [...xs.keys()].find((k) => Math.abs(Math.hypot(xs[k] - xs[0], ys[k] - ys[0]) - spacing) < 1e-6)!;
    expect(Math.abs(xs[diagonal] - xs[0])).toBeCloseTo(Math.abs(ys[diagonal] - ys[0]), 5);
  });

  it('covers every point of the screen once the dots are full', () => {
    const spacing = 18;
    const width = 390;
    const height = 844;
    const { xs, ys } = halftoneLattice(width, height, spacing);
    const r = fullRadius(spacing);
    for (let i = 0; i < 400; i += 1) {
      // A fixed walk over the screen, edges included.
      const x = ((i * 37) % 101) / 100 * width;
      const y = ((i * 53) % 103) / 102 * height;
      let best = Infinity;
      for (let k = 0; k < xs.length; k += 1) best = Math.min(best, Math.hypot(xs[k] - x, ys[k] - y));
      expect(best).toBeLessThanOrEqual(r);
    }
  });

  it('prints from the tap: small dots at the wave front, touching ones behind it, full at the end', () => {
    const t = HALFTONE_TIMING.desktop;
    const elapsed = t.coverWave * 0.5;
    const behind = coverRadiusAt(elapsed, 0, t);
    const front = coverRadiusAt(elapsed, 0.45, t);
    const ahead = coverRadiusAt(elapsed, 0.9, t);
    expect(behind).toBeGreaterThanOrEqual(t.spacing / 2);
    expect(front).toBeGreaterThan(0);
    expect(front).toBeLessThan(behind);
    expect(ahead).toBe(0);
    expect(coverRadiusAt(t.coverWave + t.coverGrow, 1, t)).toBeCloseTo(fullRadius(t.spacing), 5);
  });

  it('lets the new page out through holes that open from the tap, until no dot is left', () => {
    const t = HALFTONE_TIMING.phone;
    expect(revealRadiusAt(0, 0, t)).toBeCloseTo(fullRadius(t.spacing), 5);
    expect(revealRadiusAt(t.revealShrink * 0.5, 0, t)).toBeLessThan(revealRadiusAt(t.revealShrink * 0.5, 1, t));
    expect(revealRadiusAt(t.revealWave + t.revealShrink, 1, t)).toBe(0);
  });
});
