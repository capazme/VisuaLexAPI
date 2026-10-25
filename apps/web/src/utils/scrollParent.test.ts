import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollParentOf, scrollToMiddle } from './scrollParent';

const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 0, width: 0, height, x: 0, y: top, toJSON: () => ({}) });

afterEach(() => { document.body.innerHTML = ''; });

// The page's scroller > a column that scrolls on its own > the text > the passage.
function setup() {
  document.body.innerHTML = '<div id="page" style="overflow-y: auto"><section id="column" style="overflow-y: auto"><p><mark id="passage">x</mark></p></section></div>';
  const page = document.getElementById('page')!;
  const column = document.getElementById('column')!;
  const passage = document.getElementById('passage')!;
  page.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo'];
  column.scrollTo = vi.fn() as unknown as HTMLElement['scrollTo'];
  passage.scrollIntoView = vi.fn();
  column.getBoundingClientRect = () => rect(100, 600);
  overflow(column, 600, 3000);
  overflow(page, 900, 4000);
  column.scrollTop = 300;
  return { page, column, passage };
}

/** jsdom lays nothing out: the box's height and its content's. */
function overflow(el: HTMLElement, clientHeight: number, scrollHeight: number) {
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
}

describe('scrollParentOf', () => {
  it('finds the nearest ancestor that scrolls, the column before the page', () => {
    const { column, passage } = setup();
    expect(scrollParentOf(passage)).toBe(column);
    expect(scrollParentOf(column)).toBe(document.getElementById('page'));
  });
});

describe('scrollToMiddle', () => {
  it('puts the element in the middle of its scroller, moving that scroller alone (D7d, gotcha 34)', () => {
    const { page, column, passage } = setup();
    passage.getBoundingClientRect = () => rect(1000, 20);
    scrollToMiddle(passage, 'smooth');
    // 300 + (1000 − 100) − (600 − 20) / 2
    expect(column.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 910, behavior: 'smooth' });
    expect(page.scrollTo).not.toHaveBeenCalled();
    expect(passage.scrollIntoView).not.toHaveBeenCalled();
  });

  it('brings an element taller than its scroller to its top', () => {
    const { column, passage } = setup();
    passage.getBoundingClientRect = () => rect(1000, 900);
    scrollToMiddle(passage);
    expect(column.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1200, behavior: 'auto' });
  });

  it('passes over an ancestor set to scroll whose content fits, and moves the one that overflows', () => {
    const { page, column, passage } = setup();
    // a panel with `overflow-y: auto` and nothing to scroll, inside the page that has
    overflow(column, 600, 600);
    page.getBoundingClientRect = () => rect(0, 900);
    page.scrollTop = 0;
    passage.getBoundingClientRect = () => rect(2000, 20);
    scrollToMiddle(passage, 'smooth');
    expect(column.scrollTo).not.toHaveBeenCalled();
    // 0 + 2000 − (900 − 20) / 2
    expect(page.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1560, behavior: 'smooth' });
    expect(passage.scrollIntoView).not.toHaveBeenCalled();
  });

  it('with no ancestor that scrolls, falls back on scrollIntoView, as every reader did before', () => {
    const { page, column, passage } = setup();
    overflow(column, 600, 600);
    overflow(page, 900, 900);
    scrollToMiddle(passage, 'smooth');
    expect(column.scrollTo).not.toHaveBeenCalled();
    expect(page.scrollTo).not.toHaveBeenCalled();
    expect(passage.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'center', behavior: 'smooth' });
  });
});
