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

/**
 * Between 600 and 750 ms in all (the brief): an effect the first time, no weight the twentieth. Kept a few frames
 * under 750: the reveal starts once the new page's title is there, a frame or two after the colour covers.
 */
export const HALFTONE_TIMING = {
  desktop: { spacing: 22, coverWave: 200, coverGrow: 140, revealWave: 160, revealShrink: 140, inkDelay: 140, inkDry: 220 },
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

/**
 * At most this many dots a frame: on a large screen the grid grows sparser rather than the frame heavier. A frame's
 * cost follows the dots drawn and the pixels filled (measured headless, without a GPU: 541 dots on a phone hold
 * 60 fps, 6 500 on 1920 × 1080 do not). 1366 × 768 keeps its 22 px; 1920 × 1080 goes to about 26 px, the phone's.
 */
export const MAX_DOTS = 3200;
/** At most this many canvas pixels to fill a frame, a 1080p screen's: on a larger or denser one the density gives way. */
export const MAX_CANVAS_PIXELS = 2_100_000;

/** How many dots `halftoneLattice` sets over the screen. */
export function dotCount(width: number, height: number, spacing: number): number {
  const h = spacing / Math.SQRT2;
  const cols = Math.ceil(width / h) + 1;
  const rows = Math.ceil(height / h) + 1;
  return Math.ceil(rows / 2) * Math.ceil(cols / 2) + Math.floor(rows / 2) * Math.floor(cols / 2);
}

/** The spacing to draw with: the timing's own, or wider until the screen holds no more than `MAX_DOTS`. */
export function halftoneSpacing(width: number, height: number, base: number): number {
  let spacing = base;
  while (dotCount(width, height, spacing) > MAX_DOTS) spacing *= 1.02;
  return spacing;
}

/** The canvas's density: the screen's, at most 1.5, and lower when the canvas would pass `MAX_CANVAS_PIXELS`. */
export function canvasRatio(width: number, height: number, devicePixelRatio: number): number {
  return Math.min(devicePixelRatio || 1, 1.5, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
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

/**
 * While the colour prints, the radius of the disc around the tap that is already solid: every dot within
 * `solid + h` of the tap is full, and every point within `solid` of it lies within h of such a dot. The disc is filled
 * in one stroke and its dots are not drawn — the frame's cost is the wave's ring, not the whole screen's dots.
 * `farthest`: the distance from the tap to the farthest corner. Negative while nothing is solid yet.
 */
export function solidRadiusWhileCovering(elapsed: number, farthest: number, t: HalftoneTiming): number {
  return (farthest * (elapsed - t.coverGrow)) / t.coverWave - t.spacing / Math.SQRT2;
}

/**
 * While the page comes out, the radius beyond which the colour is still solid: the dots past `open - h` have not
 * started to shrink, so every point past `open` lies within h of a full dot. Filled in one stroke (the screen less
 * the disc); only the dots inside it are drawn.
 */
export function openRadiusWhileRevealing(elapsed: number, farthest: number, t: HalftoneTiming): number {
  return (farthest * elapsed) / t.revealWave + t.spacing / Math.SQRT2;
}

/** A dot's radius while the new page comes out: it shrinks from full cover to nothing, slow and then faster. */
export function revealRadiusAt(elapsed: number, share: number, t: HalftoneTiming): number {
  const p = clamp01((elapsed - share * t.revealWave) / t.revealShrink);
  return fullRadius(t.spacing) * (1 - p ** 3);
}
