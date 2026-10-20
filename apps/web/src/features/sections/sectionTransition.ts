import { Z_INDEX } from '../../constants/zIndex';
import type { SectionId } from './sections';
import { HALFTONE_TIMING, coverRadiusAt, halftoneLattice, revealRadiusAt, type HalftoneTiming } from './halftone';

/** The heading a section's home marks as its title: the focus goes there, and its ink dries. */
export const SECTION_TITLE = '[data-section-title]';

/** How long the full colour waits for the new page's title (a lazy page's code on its way) before it lets go anyway. */
const HOLD_MAX = 400;
/** How long the focus waits for the new page's title once the screen is gone. */
const TITLE_WAIT = 1500;
/** The canvas is drawn at most at this density: soft dots in motion gain nothing from more, and the fill costs less. */
const MAX_PIXEL_RATIO = 1.5;
/** Below this width the screen is sparser and the wave shorter. */
const PHONE_WIDTH = 768;

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The section's hue as `index.css` declares it for the current theme (`--vlx-section-*`). */
export function sectionHue(id: SectionId): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--vlx-section-${id}`).trim() || 'rgb(30 41 82)';
}

/** The title of the page on screen, if it has one. */
function currentTitle(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SECTION_TITLE);
}

/**
 * Waits, frame by frame, for a title other than `previous` (the old page's) and calls `found` with it; gives up
 * after `TITLE_WAIT`. Returns the way to stop waiting.
 */
function watchTitle(previous: Element | null, found: (title: HTMLElement) => void): () => void {
  const start = performance.now();
  let request = 0;
  const look = (now: number) => {
    const title = currentTitle();
    if (title && title !== previous) found(title);
    else if (now - start < TITLE_WAIT) request = requestAnimationFrame(look);
  };
  request = requestAnimationFrame(look);
  return () => cancelAnimationFrame(request);
}

function focusTitle(title: HTMLElement) {
  title.focus({ preventScroll: true });
}

/** The ink of the title dries: wet, a little blurred and heavier, then as it is (`index.css`, `vlx-ink-drying`). */
function dryInk(title: HTMLElement, delay: number, duration: number): () => void {
  title.style.setProperty('--vlx-ink-delay', `${Math.max(0, Math.round(delay))}ms`);
  title.style.setProperty('--vlx-ink-dry', `${duration}ms`);
  title.classList.add('vlx-ink-drying');
  const clear = () => {
    title.classList.remove('vlx-ink-drying');
    title.style.removeProperty('--vlx-ink-delay');
    title.style.removeProperty('--vlx-ink-dry');
  };
  title.addEventListener('animationend', clear, { once: true });
  return clear;
}

export interface SectionTransition {
  /** Where the tap was, in the viewport; the screen prints from there (the middle of the screen without it). */
  origin: { x: number; y: number } | null;
  /** The new section's hue, a CSS colour (`sectionHue`). */
  color: string;
  /** Changes the page, synchronously: called once, under the full colour (at once without the screen). */
  swap: () => void;
}

/**
 * The section change (S2): a halftone prints the new section's colour from the tap, the new page comes out through
 * the holes of the same screen, and its title's ink dries — 600 to 750 ms (`halftone.ts`). The screen is a canvas over
 * everything that never takes a click, removed at the end; a tap or a key during it brings it to its end at once. The
 * focus goes to the new page's title. Under reduced motion the page changes at once and nothing moves; where a canvas
 * cannot be drawn, the browser's View Transition (`index.css`, `vlx-page`) or nothing. Returns the way to finish it.
 */
export function playSectionTransition({ origin, color, swap }: SectionTransition): () => void {
  const previous = currentTitle();
  const canvas = prefersReducedMotion() ? null : document.createElement('canvas');
  const context = canvas?.getContext('2d') ?? null;

  if (!canvas || !context) {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (canvas && doc.startViewTransition) doc.startViewTransition(swap);
    else swap();
    return watchTitle(previous, focusTitle);
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const t: HalftoneTiming = width < PHONE_WIDTH ? HALFTONE_TIMING.phone : HALFTONE_TIMING.desktop;
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = `pointer-events-none fixed inset-0 h-full w-full ${Z_INDEX.sectionTransition}`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = color;

  const from = origin ?? { x: width / 2, y: height / 2 };
  const { xs, ys } = halftoneLattice(width, height, t.spacing);
  const farthest = Math.max(Math.hypot(from.x, from.y), Math.hypot(width - from.x, from.y), Math.hypot(from.x, height - from.y), Math.hypot(width - from.x, height - from.y));
  const shares = new Float32Array(xs.length);
  for (let k = 0; k < xs.length; k += 1) shares[k] = Math.hypot(xs[k] - from.x, ys[k] - from.y) / farthest;
  const coverEnd = t.coverWave + t.coverGrow;
  const revealEnd = t.revealWave + t.revealShrink;

  const draw = (radius: (share: number) => number) => {
    context.clearRect(0, 0, width, height);
    context.beginPath();
    for (let k = 0; k < xs.length; k += 1) {
      const r = radius(shares[k]);
      if (r < 0.25) continue;
      context.moveTo(xs[k] + r, ys[k]);
      context.arc(xs[k], ys[k], r, 0, Math.PI * 2);
    }
    context.fill();
  };
  const fillAll = () => {
    context.clearRect(0, 0, width, height);
    context.fillRect(0, 0, width, height);
  };

  let phase: 'cover' | 'hold' | 'reveal' | 'done' = 'cover';
  let start = -1;
  let holdStart = 0;
  let revealStart = 0;
  let request = 0;
  let title: HTMLElement | null = null;
  let clearInk: (() => void) | null = null;
  let stopWatching: () => void = () => {};

  const swapPage = () => {
    swap();
    stopWatching = watchTitle(previous, (found) => {
      title = found;
      focusTitle(found);
      // The ink dries only while the screen is still playing: a title that comes late just takes the focus.
      if (phase === 'hold' || phase === 'reveal') {
        const into = phase === 'reveal' ? performance.now() - revealStart : 0;
        clearInk = dryInk(found, t.inkDelay - into, t.inkDry);
      }
    });
  };

  const end = () => {
    phase = 'done';
    cancelAnimationFrame(request);
    canvas.remove();
    window.removeEventListener('pointerdown', finish, true);
    window.removeEventListener('keydown', finish, true);
  };

  /** A tap or a key: the change is over at once (the page swapped if it was not, no ink drying). */
  function finish() {
    if (phase === 'done') return;
    if (phase === 'cover') swapPage();
    end();
    clearInk?.();
    clearInk = null;
  }

  const frame = (now: number) => {
    if (start < 0) start = now;
    if (phase === 'cover') {
      const elapsed = now - start;
      if (elapsed >= coverEnd) {
        fillAll();
        phase = 'hold';
        holdStart = now;
        swapPage();
      } else {
        draw((share) => coverRadiusAt(elapsed, share, t));
      }
    } else if (phase === 'hold') {
      // The new page is drawn under the colour; its title says it is there (a lazy page may take a moment).
      if (title !== null || now - holdStart >= HOLD_MAX) {
        phase = 'reveal';
        revealStart = now;
        if (title && !clearInk) clearInk = dryInk(title, t.inkDelay, t.inkDry);
      }
    }
    if (phase === 'reveal') {
      const elapsed = now - revealStart;
      if (elapsed >= revealEnd) {
        end();
        return;
      }
      draw((share) => revealRadiusAt(elapsed, share, t));
    }
    if (phase !== 'done') request = requestAnimationFrame(frame);
  };

  document.body.appendChild(canvas);
  window.addEventListener('pointerdown', finish, true);
  window.addEventListener('keydown', finish, true);
  request = requestAnimationFrame(frame);

  return () => {
    finish();
    stopWatching();
  };
}
