import { afterEach, describe, it, expect, vi } from 'vitest';
// The scroll: its own tests (`scrollParent.test.ts`); here, which piece it is asked for.
vi.mock('./scrollParent', () => ({ scrollToMiddle: vi.fn() }));
import { scrollToMiddle } from './scrollParent';
import { revealAnnotation } from './revealAnnotation';

describe('revealAnnotation', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(scrollToMiddle).mockClear();
  });

  it('scrolls to the piece inside the block it came from and flashes every piece for 1.6 s', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="vlx-b" id="b1"><mark data-highlight="h">fine del primo</mark></div>' +
      '<div class="vlx-b" id="b2"><mark data-highlight="h">inizio del secondo</mark></div>';
    expect(revealAnnotation(root, { kind: 'highlight', id: 'h' }, root.querySelector('#b2'))).toBe(true);
    const pieces = [...root.querySelectorAll('mark')];
    expect(scrollToMiddle).toHaveBeenCalledExactlyOnceWith(pieces[1], 'smooth');
    expect(pieces.every((p) => p.classList.contains('vlx-flash'))).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(pieces.some((p) => p.classList.contains('vlx-flash'))).toBe(false);
  });

  it('answers false when the annotation is not in the text, whatever its id', () => {
    const root = document.createElement('div');
    root.innerHTML = '<span data-note-id="n1">x</span>';
    expect(revealAnnotation(root, { kind: 'note', id: 'n"]x' })).toBe(false);
    expect(revealAnnotation(root, { kind: 'highlight', id: 'n1' })).toBe(false);
    expect(revealAnnotation(root, { kind: 'thread', id: 't1' })).toBe(false);
  });

  it('scrolls to and flashes a thread focus mark', () => {
    vi.useFakeTimers();
    const root = document.createElement('div');
    root.innerHTML =
      '<div class="vlx-b" id="b1"><span class="vlx-thread-focus" data-thread-focus="t1">testo discusso</span></div>';
    expect(revealAnnotation(root, { kind: 'thread', id: 't1' })).toBe(true);
    const piece = root.querySelector<HTMLElement>('.vlx-thread-focus')!;
    expect(scrollToMiddle).toHaveBeenCalledExactlyOnceWith(piece, 'smooth');
    expect(piece.classList.contains('vlx-flash')).toBe(true);
    vi.advanceTimersByTime(1600);
    expect(piece.classList.contains('vlx-flash')).toBe(false);
  });
});
