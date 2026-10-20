import { describe, expect, it } from 'vitest';
import {
  HALFTONE_TIMING,
  MAX_CANVAS_PIXELS,
  MAX_DOTS,
  canvasRatio,
  coverRadiusAt,
  dotCount,
  fullRadius,
  halftoneLattice,
  halftoneSpacing,
  openRadiusWhileRevealing,
  revealRadiusAt,
  solidRadiusWhileCovering,
  totalDuration,
} from './halftone';

describe('the section change halftone (S2)', () => {
  it('lasts between 600 and 750 ms, on a computer and on a phone, with room for the frames the new page takes', () => {
    const frames = 3 * (1000 / 60);
    for (const t of Object.values(HALFTONE_TIMING)) {
      expect(totalDuration(t)).toBeGreaterThanOrEqual(600);
      expect(totalDuration(t) + frames).toBeLessThanOrEqual(750);
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

  it('counts its dots as the lattice sets them', () => {
    for (const [w, h, s] of [[390, 844, 26], [1366, 768, 18], [1920, 1080, 18], [2560, 1440, 18]]) {
      expect(dotCount(w, h, s)).toBe(halftoneLattice(w, h, s).xs.length);
    }
  });

  it('keeps a 1366 × 768 screen at its spacing and makes a larger one sparser, never past the cap', () => {
    const base = HALFTONE_TIMING.desktop.spacing;
    expect(halftoneSpacing(1366, 768, base)).toBe(base);
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160]]) {
      const spacing = halftoneSpacing(w, h, base);
      expect(spacing).toBeGreaterThan(base);
      expect(dotCount(w, h, spacing)).toBeLessThanOrEqual(MAX_DOTS);
    }
  });

  it('draws the canvas no denser than 1.5 and no larger than the pixel cap', () => {
    expect(canvasRatio(390, 844, 3)).toBe(1.5);
    expect(canvasRatio(1366, 768, 1)).toBe(1);
    expect(canvasRatio(1920, 1080, 2)).toBeCloseTo(1, 1);
    for (const [w, h, dpr] of [[1920, 1080, 2], [2560, 1440, 2], [3840, 2160, 1]]) {
      const r = canvasRatio(w, h, dpr);
      expect(w * r * h * r).toBeLessThanOrEqual(MAX_CANVAS_PIXELS + 1);
    }
  });

  describe('the solid parts drawn in one stroke', () => {
    const t = HALFTONE_TIMING.desktop;
    const [width, height] = [1366, 768];
    const tap = { x: 300, y: 200 };
    const { xs, ys } = halftoneLattice(width, height, t.spacing);
    const farthest = Math.hypot(width - tap.x, height - tap.y);
    const full = fullRadius(t.spacing);
    /** Whether a full dot covers the point: the region is really solid, so filling it in one stroke changes nothing. */
    const coveredByFullDot = (x: number, y: number, radius: (share: number) => number) => {
      for (let k = 0; k < xs.length; k += 1) {
        const d = Math.hypot(xs[k] - tap.x, ys[k] - tap.y);
        if (radius(d / farthest) >= full - 1e-9 && Math.hypot(xs[k] - x, ys[k] - y) <= full) return true;
      }
      return false;
    };
    const points = Array.from({ length: 300 }, (_, i) => ({ x: (((i * 37) % 101) / 100) * width, y: (((i * 53) % 103) / 102) * height }));

    it('while printing: every point of the solid disc lies under a full dot', () => {
      for (const elapsed of [t.coverGrow + 40, t.coverGrow + 120, t.coverWave + t.coverGrow - 1]) {
        const solid = solidRadiusWhileCovering(elapsed, farthest, t);
        expect(solid).toBeGreaterThan(0);
        for (const p of points.filter((q) => Math.hypot(q.x - tap.x, q.y - tap.y) <= solid)) {
          expect(coveredByFullDot(p.x, p.y, (share) => coverRadiusAt(elapsed, share, t))).toBe(true);
        }
      }
      expect(solidRadiusWhileCovering(0, farthest, t)).toBeLessThan(0);
    });

    it('while opening: every point beyond the open disc lies under a dot that has not started to shrink', () => {
      for (const elapsed of [0, 40, t.revealWave - 20]) {
        const open = openRadiusWhileRevealing(elapsed, farthest, t);
        for (const p of points.filter((q) => Math.hypot(q.x - tap.x, q.y - tap.y) >= open)) {
          expect(coveredByFullDot(p.x, p.y, (share) => revealRadiusAt(elapsed, share, t))).toBe(true);
        }
      }
      expect(openRadiusWhileRevealing(t.revealWave, farthest, t)).toBeGreaterThan(farthest);
    });
  });
});
