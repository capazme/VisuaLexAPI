import { afterEach, describe, it, expect, vi } from 'vitest';
import { revealAnnotation } from './revealAnnotation';

describe('revealAnnotation', () => {
  afterEach(() => vi.useRealTimers());

  it('scrolls to the piece inside the block it came from and flashes every piece for 1.6 s', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="vlx-b" id="b1"><mark data-highlight="h">fine del primo</mark></div>' +
      '<div class="vlx-b" id="b2"><mark data-highlight="h">inizio del secondo</mark></div>';
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
    expect(revealAnnotation(root, { kind: 'highlight', id: 'h' }, root.querySelector('#b2'))).toBe(true);
    const pieces = [...root.querySelectorAll('mark')];
    expect(scroll.mock.contexts[0]).toBe(pieces[1]);
    expect(pieces.every((p) => p.classList.contains('vlx-flash'))).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(pieces.some((p) => p.classList.contains('vlx-flash'))).toBe(false);
    scroll.mockRestore();
  });

  it('answers false when the annotation is not in the text, whatever its id', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span data-note-id="n1">x</span>';
    expect(revealAnnotation(root, { kind: 'note', id: 'n"]x' })).toBe(false);
    expect(revealAnnotation(root, { kind: 'highlight', id: 'n1' })).toBe(false);
  });
});
