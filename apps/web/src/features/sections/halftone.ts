/**
 * The section change's halftone (S2, «la stampa a mezzatinta»): a printer's screen of dots on a grid turned 45°,
 * which prints the new section's colour from the point of the tap and then lets the new page out through its holes.
 * Inspired by Animorio's «La transizione a mezzatinta», written from scratch. Pure geometry and timing here;
 * `sectionTransition.ts` draws it.
 */

export interface HalftoneTiming {
  /** The distance between neighbouring dots, in CSS pixels: wider on a phone, so fewer dots. */
  spacing: number;
  /** How long the printing wave takes to cross the screen, and how long one dot takes to grow to full cover (ms). */
  coverWave: number;
  coverGrow: number;
  /** The same for the reveal: the wave of shrinking dots, and one dot's shrinking. */
  revealWave: number;
  revealShrink: number;
  /** When the title's ink starts drying, from the start of the reveal, and how long it takes to dry. */
  inkDelay: number;
  inkDry: number;
}

/** Between 600 and 750 ms in all (the brief): an effect the first time, no weight the twentieth. */
export const HALFTONE_TIMING = {
  desktop: { spacing: 18, coverWave: 200, coverGrow: 140, revealWave: 160, revealShrink: 140, inkDelay: 140, inkDry: 260 },
  phone: { spacing: 26, coverWave: 150, coverGrow: 130, revealWave: 120, revealShrink: 120, inkDelay: 110, inkDry: 240 },
} as const satisfies Record<'desktop' | 'phone', HalftoneTiming>;

/** The whole change, from the tap to the dry title, when the new page is there as soon as the colour covers. */
export function totalDuration(t: HalftoneTiming): number {
  return t.coverWave + t.coverGrow + Math.max(t.revealWave + t.revealShrink, t.inkDelay + t.inkDry);
}

/**
 * The dots' centres over a `width` × `height` screen: the points (i·h, j·h) with i + j even, h = spacing / √2 —
 * a square grid turned 45° whose nearest neighbours are `spacing` apart. Every point of the screen lies within h
 * of a centre, so dots of radius h cover it.
 */
export function halftoneLattice(width: number, height: number, spacing: number): { xs: Float32Array; ys: Float32Array } {
  const h = spacing / Math.SQRT2;
  const cols = Math.ceil(width / h) + 1;
  const rows = Math.ceil(height / h) + 1;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = j % 2; i < cols; i += 2) {
      xs.push(i * h);
      ys.push(j * h);
    }
  }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys) };
}

/** The radius at which the dots leave no hole (a hair over h, so their antialiased edges leave no seam). */
export function fullRadius(spacing: number): number {
  return (spacing / Math.SQRT2) * 1.04;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * A dot's radius while the colour prints: it starts when the wave reaches it (`share`, its distance from the tap
 * over the farthest corner's) and grows, fast and then slower, to full cover — so the wave's front is small dots
 * and the dots behind it touch.
 */
export function coverRadiusAt(elapsed: number, share: number, t: HalftoneTiming): number {
  const p = clamp01((elapsed - share * t.coverWave) / t.coverGrow);
  return fullRadius(t.spacing) * (1 - (1 - p) ** 3);
}

/** A dot's radius while the new page comes out: it shrinks from full cover to nothing, slow and then faster. */
export function revealRadiusAt(elapsed: number, share: number, t: HalftoneTiming): number {
  const p = clamp01((elapsed - share * t.revealWave) / t.revealShrink);
  return fullRadius(t.spacing) * (1 - p ** 3);
}
