import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HALFTONE_TIMING } from './halftone';
import { playSectionTransition } from './sectionTransition';

const FRAME = 16;

/** A 2D context that draws nothing: jsdom has no canvas. */
function stubContext() {
  return { setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '' };
}

function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

/** The page the swap draws: a title of the new section, as a section's home marks it. */
function newPage() {
  document.querySelector('main')!.innerHTML = '<h1 data-section-title tabindex="-1">Gymnasium: la tua palestra giuridica</h1>';
}

const canvas = () => document.querySelector('canvas');
const title = () => document.querySelector<HTMLElement>('[data-section-title]')!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  document.body.innerHTML = '<main><h2 data-section-title tabindex="-1">I tuoi dossier di lavoro</h2></main>';
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('playSectionTransition (S2)', () => {
  it('under reduced motion changes the page at once, draws nothing and moves the focus to the new title', () => {
    reducedMotion(true);
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
    const swap = vi.fn(newPage);
    playSectionTransition({ origin: { x: 10, y: 10 }, color: 'red', swap });
    expect(swap).toHaveBeenCalledOnce();
    expect(getContext).not.toHaveBeenCalled();
    expect(canvas()).toBeNull();
    vi.advanceTimersByTime(FRAME * 2);
    expect(title()).toHaveFocus();
    expect(title()).not.toHaveClass('vlx-ink-drying');
  });

  it('prints the colour over a canvas that takes no click, swaps under the full colour, then lets the page out and dries the title', () => {
    reducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as unknown as CanvasRenderingContext2D);
    const swap = vi.fn(newPage);
    const t = HALFTONE_TIMING.desktop;
    playSectionTransition({ origin: { x: 40, y: 60 }, color: 'red', swap });

    expect(canvas()).toHaveClass('pointer-events-none', 'fixed', 'inset-0');
    expect(canvas()).toHaveAttribute('aria-hidden', 'true');
    vi.advanceTimersByTime(t.coverWave);
    expect(swap).not.toHaveBeenCalled();

    vi.advanceTimersByTime(t.coverGrow + FRAME * 3);
    expect(swap).toHaveBeenCalledOnce();
    expect(title()).toHaveFocus();
    expect(title()).toHaveClass('vlx-ink-drying');
    expect(canvas()).not.toBeNull();

    vi.advanceTimersByTime(t.revealWave + t.revealShrink + FRAME * 3);
    expect(canvas()).toBeNull();
  });

  it('is brought to its end by a tap: the page swapped at once, the canvas gone, the title dry', () => {
    reducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as unknown as CanvasRenderingContext2D);
    const swap = vi.fn(newPage);
    playSectionTransition({ origin: null, color: 'red', swap });
    vi.advanceTimersByTime(FRAME * 3);
    window.dispatchEvent(new Event('pointerdown'));
    expect(swap).toHaveBeenCalledOnce();
    expect(canvas()).toBeNull();
    vi.advanceTimersByTime(FRAME * 2);
    expect(title()).toHaveFocus();
    expect(title()).not.toHaveClass('vlx-ink-drying');
  });

  it('the returned function finishes it too, and a key does the same', () => {
    reducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as unknown as CanvasRenderingContext2D);
    const first = vi.fn(newPage);
    const finish = playSectionTransition({ origin: null, color: 'red', swap: first });
    finish();
    expect(first).toHaveBeenCalledOnce();
    expect(canvas()).toBeNull();

    const second = vi.fn();
    playSectionTransition({ origin: null, color: 'red', swap: second });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(second).toHaveBeenCalledOnce();
    expect(canvas()).toBeNull();
  });
});
