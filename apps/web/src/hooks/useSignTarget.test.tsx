import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { cardKeys, useNoteOpener, useSignTarget, type SignTargetOptions } from './useSignTarget';
import type { BlockAnnotations } from '../utils/articleAnnotations';
import type { Annotation, Highlight } from '../types';

const note = { id: 'n1' } as Annotation;
const highlight = { id: 'h1' } as Highlight;
const block = (over: Partial<BlockAnnotations> = {}): BlockAnnotations => ({ notes: [], highlights: [], threads: [], glosses: [], ...over });

function sign(over: Partial<SignTargetOptions>) {
  const focus = vi.fn(() => true);
  const options: SignTargetOptions = {
    openBlock: 2, blockAll: false, group: block({ notes: [note], highlights: [highlight] }), marginShown: true,
    marginRef: { current: { focus } }, closeBlock: vi.fn(), openBlockAt: vi.fn(), ...over,
  };
  const { result } = renderHook(() => useSignTarget(options));
  return { sheet: result.current, focus, options };
}

describe('useSignTarget — where a block\'s sign takes the reader (A4 §6, no popover)', () => {
  it('the column shown and the block holding a card: its first card, the block closed again, no sheet', () => {
    const { sheet, focus, options } = sign({});
    expect(sheet).toBe(false);
    expect(focus).toHaveBeenCalledExactlyOnceWith(['note:n1']);
    expect(options.closeBlock).toHaveBeenCalledOnce();
  });

  it('with Shift, the sheet, the column or not', () => {
    const { sheet, focus } = sign({ blockAll: true });
    expect(sheet).toBe(true);
    expect(focus).not.toHaveBeenCalled();
  });

  it('no column (a phone, a narrow reader), or a block with no card there (its highlights alone): the sheet', () => {
    expect(sign({ marginShown: false }).sheet).toBe(true);
    const onlyHighlights = sign({ group: block({ highlights: [highlight] }) });
    expect(onlyHighlights.sheet).toBe(true);
    expect(onlyHighlights.focus).not.toHaveBeenCalled();
  });

  it('a card that could not take the focus (the reader narrowed meanwhile): everything of the block in its sheet', () => {
    const focus = vi.fn(() => false);
    const { options } = sign({ marginRef: { current: { focus } } });
    expect(options.openBlockAt).toHaveBeenCalledExactlyOnceWith(2, true);
    expect(options.closeBlock).not.toHaveBeenCalled();
  });

  it('nothing open, nothing drawn', () => {
    expect(sign({ openBlock: null }).sheet).toBe(false);
  });

  it('a block\'s cards: its notes, discussions and an application\'s glosses', () => {
    expect(cardKeys(block({
      notes: [note],
      threads: [{ id: 't1' } as BlockAnnotations['threads'][number]],
      glosses: [{ id: 'g1', startOffset: 0, text: 'x', state: 'proposed' }],
      highlights: [highlight],
    }))).toEqual(['note:n1', 'thread:t1', 'gloss:g1']);
  });
});

describe('useNoteOpener — a note\'s wavy words clicked', () => {
  const words = () => {
    const blockEl = document.createElement('div');
    blockEl.className = 'vlx-b';
    blockEl.innerHTML = '<span class="note-anchor" data-note-id="n1">parole</span><span class="vlx-sign" data-block="3"></span>';
    return blockEl.querySelector<HTMLElement>('.note-anchor')!;
  };

  it('its card beside the text, where the column is shown', () => {
    const focus = vi.fn(() => true);
    const openBlockAt = vi.fn();
    renderHook(() => useNoteOpener({ current: { focus } }, openBlockAt)).result.current(note, words());
    expect(focus).toHaveBeenCalledExactlyOnceWith(['note:n1']);
    expect(openBlockAt).not.toHaveBeenCalled();
  });

  it('else everything of its block, in the block\'s sheet', () => {
    const openBlockAt = vi.fn();
    renderHook(() => useNoteOpener({ current: { focus: () => false } }, openBlockAt)).result.current(note, words());
    expect(openBlockAt).toHaveBeenCalledExactlyOnceWith(3, true);
  });
});
