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
  Object.defineProperty(column, 'clientHeight', { value: 600 });
  column.scrollTop = 300;
  return { page, column, passage };
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
});
