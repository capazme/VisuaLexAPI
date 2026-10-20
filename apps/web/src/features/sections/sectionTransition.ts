import { Z_INDEX } from '../../constants/zIndex';
import type { SectionId } from './sections';
import {
  HALFTONE_TIMING,
  canvasRatio,
  coverRadiusAt,
  fullRadius,
  halftoneLattice,
  halftoneSpacing,
  openRadiusWhileRevealing,
  revealRadiusAt,
  solidRadiusWhileCovering,
  type HalftoneTiming,
} from './halftone';

/**
 * A section's home marks its heading `data-section-title="<section id>"` (with `tabIndex={-1}`): the focus goes there
 * and its ink dries. The id says whose title it is: the dossier list stays mounted from Gymnasium to Opus, and its
 * heading changes section without changing element.
 */
const titleOf = (section: SectionId) => `[data-section-title="${section}"]`;

/** How long the full colour waits for the new page's title (the router renders it in a transition; a lazy page's code may be on its way). */
const HOLD_MAX = 400;
/** How long the focus waits for the new page's title once the screen is gone. */
const TITLE_WAIT = 1500;
/** Below this width the screen is sparser and the wave shorter. */
const PHONE_WIDTH = 768;
/** The keys that end the change are the change's: they do not also press the switcher they were typed on. */
const KEYS_TAKEN = new Set(['Enter', ' ', 'Escape']);

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The section's hue as `index.css` declares it for the current theme (`--vlx-section-*`). */
export function sectionHue(id: SectionId): string {
  return getComputedStyle(document.documentElement).getPropertyValue(`--vlx-section-${id}`).trim() || 'rgb(30 41 82)';
}

/** Waits, frame by frame, for `section`'s title and calls `found` with it; gives up after `TITLE_WAIT`. Returns the way to stop. */
function watchTitle(section: SectionId, found: (title: HTMLElement) => void): () => void {
  const start = performance.now();
  let request = 0;
  const look = (now: number) => {
    const title = document.querySelector<HTMLElement>(titleOf(section));
    if (title) found(title);
    else if (now - start < TITLE_WAIT) request = requestAnimationFrame(look);
  };
  request = requestAnimationFrame(look);
  return () => cancelAnimationFrame(request);
}

/**
 * The focus goes to the title only if nobody moved it meanwhile: it is still where the choice left it (the switcher)
 * or nowhere. A click into a field, or a Tab, while a lazy page's title was on its way keeps its focus.
 */
function focusTitleUnlessMoved(title: HTMLElement, leftOn: Element | null) {
  const active = document.activeElement;
  if (active === leftOn || active === null || active === document.body) title.focus({ preventScroll: true });
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
  /** The section chosen: its home's title is what the screen waits for, and what takes the focus. */
  section: SectionId;
  /** Where the tap was, in the viewport; the screen prints from there (the middle of the screen without it). */
  origin: { x: number; y: number } | null;
  /** The new section's hue, a CSS colour (`sectionHue`). */
  color: string;
  /**
   * Changes the page: called once, under the full colour (at once without the screen). The router renders the new
   * page in a transition, so it may come a frame or more later: its title says when it is there.
   */
  swap: () => void;
}

/**
 * The section change (S2): a halftone prints the new section's colour from the tap, the page changes under the full
 * colour and comes out through the holes of the same screen once its title is there (at most `HOLD_MAX` later), and
 * the title's ink dries — about 700 ms (`halftone.ts`). The screen is a canvas over everything that never takes a
 * click, removed at the end; a tap or a key during it brings it to its end at once. The focus goes to the new page's
 * title. Under reduced motion the page changes at once and nothing moves; where a canvas cannot be drawn, the
 * browser's View Transition (`index.css`, `vlx-page`), held until the title is there, or nothing. Returns the way to
 * finish it.
 */
export function playSectionTransition({ section, origin, color, swap }: SectionTransition): () => void {
  const leftOn = document.activeElement;
  const canvas = prefersReducedMotion() ? null : document.createElement('canvas');
  const context = canvas?.getContext('2d') ?? null;

  if (!canvas || !context) {
    const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
    let stop = () => {};
    if (canvas && doc.startViewTransition) {
      // The browser keeps the old page's picture until the callback settles: settle it when the new title is there.
      doc.startViewTransition(
        () =>
          new Promise<void>((resolve) => {
            swap();
            const timer = window.setTimeout(resolve, HOLD_MAX);
            stop = watchTitle(section, (title) => {
              window.clearTimeout(timer);
              resolve();
              focusTitleUnlessMoved(title, leftOn);
            });
          }),
      );
    } else {
      swap();
      stop = watchTitle(section, (title) => focusTitleUnlessMoved(title, leftOn));
    }
    return () => stop();
  }

  const width = window.innerWidth;
  const height = window.innerHeight;
  const timing: HalftoneTiming = width < PHONE_WIDTH ? HALFTONE_TIMING.phone : HALFTONE_TIMING.desktop;
  // A large screen draws a sparser grid on a canvas no denser than it needs: the frame's cost stays a 1080p one.
  const t: HalftoneTiming = { ...timing, spacing: halftoneSpacing(width, height, timing.spacing) };
  const ratio = canvasRatio(width, height, window.devicePixelRatio);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = `pointer-events-none fixed inset-0 h-full w-full ${Z_INDEX.sectionTransition}`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.fillStyle = color;

  const from = origin ?? { x: width / 2, y: height / 2 };
  const { xs, ys } = halftoneLattice(width, height, t.spacing);
  const farthest = Math.max(Math.hypot(from.x, from.y), Math.hypot(width - from.x, from.y), Math.hypot(from.x, height - from.y), Math.hypot(width - from.x, height - from.y));
  const distances = new Float32Array(xs.length);
  for (let k = 0; k < xs.length; k += 1) distances[k] = Math.hypot(xs[k] - from.x, ys[k] - from.y);
  const full = fullRadius(t.spacing);
  const coverEnd = t.coverWave + t.coverGrow;
  const revealEnd = t.revealWave + t.revealShrink;

  /**
   * One frame: the solid part in one stroke (`solid`, filled before the dots), then only the dots that are not
   * wholly inside it (`skip`). Many small overlapping arcs cost far more to fill than one shape over the same area.
   */
  const draw = (solid: () => void, skip: (distance: number) => boolean, radius: (share: number) => number) => {
    context.clearRect(0, 0, width, height);
    solid();
    context.beginPath();
    for (let k = 0; k < xs.length; k += 1) {
      if (skip(distances[k])) continue;
      const r = radius(distances[k] / farthest);
      if (r < 0.25) continue;
      context.moveTo(xs[k] + r, ys[k]);
      context.arc(xs[k], ys[k], r, 0, Math.PI * 2);
    }
    context.fill();
  };
  const drawCover = (elapsed: number) => {
    const solid = solidRadiusWhileCovering(elapsed, farthest, t);
    draw(
      () => {
        if (solid <= 0) return;
        context.beginPath();
        context.arc(from.x, from.y, solid, 0, Math.PI * 2);
        context.fill();
      },
      (d) => d + full <= solid,
      (share) => coverRadiusAt(elapsed, share, t),
    );
  };
  const drawReveal = (elapsed: number) => {
    const open = openRadiusWhileRevealing(elapsed, farthest, t);
    draw(
      () => {
        if (open >= farthest) return;
        context.beginPath();
        context.rect(0, 0, width, height);
        context.arc(from.x, from.y, open, 0, Math.PI * 2);
        context.fill('evenodd');
      },
      (d) => d - full >= open,
      (share) => revealRadiusAt(elapsed, share, t),
    );
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
    stopWatching = watchTitle(section, (found) => {
      title = found;
      focusTitleUnlessMoved(found, leftOn);
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
    window.removeEventListener('popstate', abandon);
  };

  /**
   * The browser's Back (or Forward) while the colour prints: the user went elsewhere, so the change is dropped — no
   * swap, which would navigate over where they went. After the swap it only ends the screen.
   */
  function abandon() {
    if (phase === 'done') return;
    end();
    stopWatching();
    clearInk?.();
    clearInk = null;
  }

  /** A tap or a key: the change is over at once (the page asked for if it was not, no ink drying). */
  function finish(event?: Event) {
    if (phase === 'done') return;
    if (event instanceof KeyboardEvent && KEYS_TAKEN.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
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
        drawCover(elapsed);
      }
    } else if (phase === 'hold') {
      // The new page comes under the colour; its title says it is there.
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
      drawReveal(elapsed);
    }
    if (phase !== 'done') request = requestAnimationFrame(frame);
  };

  document.body.appendChild(canvas);
  window.addEventListener('pointerdown', finish, true);
  window.addEventListener('keydown', finish, true);
  window.addEventListener('popstate', abandon);
  request = requestAnimationFrame(frame);

  return () => {
    finish();
    stopWatching();
  };
}
