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
  document.querySelector('main')!.innerHTML = '<h1 data-section-title="gymnasium" tabindex="-1">Gymnasium: la tua palestra giuridica</h1>';
}

const canvas = () => document.querySelector('canvas');
const title = () => document.querySelector<HTMLElement>('[data-section-title]')!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  document.body.innerHTML = '<main><h2 data-section-title="opus" tabindex="-1">I tuoi dossier di lavoro</h2></main>';
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
    playSectionTransition({ section: 'gymnasium', origin: { x: 10, y: 10 }, color: 'red', swap });
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
    playSectionTransition({ section: 'gymnasium', origin: { x: 40, y: 60 }, color: 'red', swap });

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
    playSectionTransition({ section: 'gymnasium', origin: null, color: 'red', swap });
    vi.advanceTimersByTime(FRAME * 3);
    window.dispatchEvent(new Event('pointerdown'));
    expect(swap).toHaveBeenCalledOnce();
    expect(canvas()).toBeNull();
    vi.advanceTimersByTime(FRAME * 2);
    expect(title()).toHaveFocus();
    expect(title()).not.toHaveClass('vlx-ink-drying');
  });

  it('waits for the new section\'s title on the element already there (the dossier list from Gymnasium to Opus)', () => {
    reducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as unknown as CanvasRenderingContext2D);
    document.querySelector('main')!.innerHTML = '<h2 data-section-title="gymnasium" tabindex="-1">I tuoi dossier di studio</h2>';
    const heading = title();
    const t = HALFTONE_TIMING.desktop;
    // The router renders the new page a frame later: the same heading changes its section and its words.
    const swap = vi.fn(() => requestAnimationFrame(() => heading.setAttribute('data-section-title', 'opus')));
    playSectionTransition({ section: 'opus', origin: null, color: 'red', swap });
    vi.advanceTimersByTime(t.coverWave + t.coverGrow + FRAME * 4);
    expect(heading).toHaveFocus();
    expect(heading).toHaveClass('vlx-ink-drying');
    // The colour did not wait out its 400 ms: the whole change is over within the budget.
    vi.advanceTimersByTime(t.revealWave + t.revealShrink + FRAME * 2);
    expect(canvas()).toBeNull();
  });

  it('leaves the focus where the user moved it while the title was on its way', () => {
    reducedMotion(true);
    document.body.insertAdjacentHTML('beforeend', '<input aria-label="campo" />');
    const field = document.querySelector('input')!;
    let draw = () => {};
    playSectionTransition({ section: 'gymnasium', origin: null, color: 'red', swap: () => { draw = newPage; } });
    field.focus();
    draw();
    vi.advanceTimersByTime(FRAME * 2);
    expect(field).toHaveFocus();
  });

  it('takes the Enter that ends it, so the switcher it was typed on does not open again', () => {
    reducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as unknown as CanvasRenderingContext2D);
    playSectionTransition({ section: 'gymnasium', origin: null, color: 'red', swap: newPage });
    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    window.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(canvas()).toBeNull();
  });

  it('the returned function finishes it too, and a key does the same', () => {
    reducedMotion(false);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as unknown as CanvasRenderingContext2D);
    const first = vi.fn(newPage);
    const finish = playSectionTransition({ section: 'gymnasium', origin: null, color: 'red', swap: first });
    finish();
    expect(first).toHaveBeenCalledOnce();
    expect(canvas()).toBeNull();

    const second = vi.fn();
    playSectionTransition({ section: 'gymnasium', origin: null, color: 'red', swap: second });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(second).toHaveBeenCalledOnce();
    expect(canvas()).toBeNull();
  });
});
