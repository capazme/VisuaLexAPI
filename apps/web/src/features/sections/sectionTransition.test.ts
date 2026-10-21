import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { HOLD_MAX, playSectionTransition } from './sectionTransition';

function reducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({ matches: reduce && query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
}

/**
 * A View Transition as the browser runs it, for what the change asks of it: the update is called, `finished` settles
 * when the test says (`end`), `skipTransition` settles it at once. `updated` is the update's own promise.
 */
function stubViewTransition() {
  const state = { updated: null as Promise<void> | null, skip: vi.fn(), end: () => {} };
  const start = vi.fn((update: () => Promise<void>) => {
    state.updated = update();
    const finished = new Promise<void>((resolve) => {
      state.end = resolve;
      state.skip.mockImplementation(() => resolve());
    });
    return { finished, skipTransition: state.skip };
  });
  // jsdom has no View Transitions: the stub is the document's own, removed after each test.
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  return { start, state };
}

/** The page the swap draws: a title of the new section, as a section's home marks it. */
function newPage() {
  document.querySelector('main')!.innerHTML = '<h1 data-section-title="gymnasium" tabindex="-1">Gymnasium: la tua palestra giuridica</h1>';
}

const title = () => document.querySelector<HTMLElement>('[data-section-title]')!;

beforeEach(() => {
  document.body.innerHTML = '<main><h2 data-section-title="opus" tabindex="-1">I tuoi dossier di lavoro</h2></main>';
});

afterEach(() => {
  Reflect.deleteProperty(document, 'startViewTransition');
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('playSectionTransition (T1)', () => {
  it('under reduced motion changes the page at once, with no View Transition, and moves the focus to the new title', async () => {
    reducedMotion(true);
    const { start } = stubViewTransition();
    const swap = vi.fn(newPage);
    playSectionTransition({ section: 'gymnasium', swap });
    expect(swap).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    await waitFor(() => expect(title()).toHaveFocus());
  });

  it('changes the page at once where the browser has no View Transition', async () => {
    reducedMotion(false);
    const swap = vi.fn(newPage);
    playSectionTransition({ section: 'gymnasium', swap });
    expect(swap).toHaveBeenCalledOnce();
    await waitFor(() => expect(title()).toHaveFocus());
  });

  it('swaps inside a View Transition, which plays as soon as the new title is there, and focuses it', async () => {
    reducedMotion(false);
    const { start, state } = stubViewTransition();
    let draw = () => {};
    const swap = vi.fn(() => { draw = newPage; });
    playSectionTransition({ section: 'gymnasium', swap });
    expect(start).toHaveBeenCalledOnce();
    expect(swap).toHaveBeenCalledOnce();

    let settled = false;
    void state.updated!.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    // The router renders the new page a moment later.
    draw();
    await waitFor(() => expect(settled).toBe(true));
    expect(title()).toHaveFocus();
  });

  it('waits for the new section\'s title on the element already there (the dossier list from Gymnasium to Opus)', async () => {
    reducedMotion(false);
    stubViewTransition();
    document.querySelector('main')!.innerHTML = '<h2 data-section-title="gymnasium" tabindex="-1">I tuoi dossier di studio</h2>';
    const heading = title();
    playSectionTransition({ section: 'opus', swap: () => queueMicrotask(() => heading.setAttribute('data-section-title', 'opus')) });
    expect(heading).not.toHaveFocus();
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('plays with what is there once its hold is over, and the title takes the focus when it comes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    reducedMotion(false);
    const { state } = stubViewTransition();
    let draw = () => {};
    playSectionTransition({ section: 'gymnasium', swap: () => { draw = newPage; } });
    let settled = false;
    void state.updated!.then(() => { settled = true; });
    vi.advanceTimersByTime(HOLD_MAX);
    await Promise.resolve();
    expect(settled).toBe(true);
    draw();
    await Promise.resolve();
    expect(title()).toHaveFocus();
  });

  it('is brought to its end by a tap or a key, and stops listening once it is over', async () => {
    reducedMotion(false);
    const { state } = stubViewTransition();
    playSectionTransition({ section: 'gymnasium', swap: newPage });
    window.dispatchEvent(new Event('pointerdown'));
    expect(state.skip).toHaveBeenCalledOnce();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(state.skip).toHaveBeenCalledTimes(2);

    await new Promise((resolve) => setTimeout(resolve, 0));
    window.dispatchEvent(new Event('pointerdown'));
    expect(state.skip).toHaveBeenCalledTimes(2);
  });

  it('the returned function finishes it too', () => {
    reducedMotion(false);
    const { state } = stubViewTransition();
    const swap = vi.fn(newPage);
    const finish = playSectionTransition({ section: 'gymnasium', swap });
    finish();
    expect(state.skip).toHaveBeenCalledOnce();
    expect(swap).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event('pointerdown'));
    expect(state.skip).toHaveBeenCalledOnce();
  });

  it('leaves the focus where the user moved it while the title was on its way', async () => {
    reducedMotion(true);
    document.body.insertAdjacentHTML('beforeend', '<input aria-label="campo" />');
    const field = document.querySelector('input')!;
    let draw = () => {};
    playSectionTransition({ section: 'gymnasium', swap: () => { draw = newPage; } });
    field.focus();
    draw();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(field).toHaveFocus();
  });
});
