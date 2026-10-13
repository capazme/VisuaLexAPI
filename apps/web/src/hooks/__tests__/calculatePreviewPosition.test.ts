import { afterEach, describe, expect, it } from 'vitest';
import { calculatePreviewPosition } from '../useCitationPreview';

function anchorAt(top: number, height = 20): HTMLElement {
  const el = document.createElement('a');
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 100, right: 200, width: 100, height, x: 100, y: top, toJSON: () => ({}) });
  return el;
}

const innerHeight = window.innerHeight;
function windowHeight(h: number) {
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}
afterEach(() => windowHeight(innerHeight));

describe('calculatePreviewPosition', () => {
  it('sits under the anchor when it fits', () => {
    windowHeight(800);
    expect(calculatePreviewPosition(anchorAt(100)).top).toBe(132);
  });

  it('goes over the anchor, by its measured height, when there is no room under it', () => {
    windowHeight(800);
    expect(calculatePreviewPosition(anchorAt(700), 400).top).toBe(700 - 400 - 12);
  });

  it('stays under an anchor scrolled out over the top edge, with it', () => {
    windowHeight(900);
    expect(calculatePreviewPosition(anchorAt(-30), 250).top).toBe(-30 + 20 + 12);
  });

  it('never leaves the window when there is room neither under nor over', () => {
    windowHeight(600);
    expect(calculatePreviewPosition(anchorAt(250), 420).top).toBe(600 - 420 - 12);
    // taller than the window: from its top edge
    expect(calculatePreviewPosition(anchorAt(250), 700).top).toBe(12);
  });
});
