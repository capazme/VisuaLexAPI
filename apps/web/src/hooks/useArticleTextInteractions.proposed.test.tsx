import { describe, it, expect } from 'vitest';
import { useMemo, useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useArticleTextInteractions } from './useArticleTextInteractions';
import { useInlineNoteAnchors } from './useInlineNoteAnchors';
import type { Annotation } from '../types';

// An article's comma and a decision's paragraph as the renderers emit them: a proposed passage (D7b) under a note the
// reader anchored on the same words, an update reference inside another, the block's sign last.
const BODY =
  '<div class="vlx-b vlx-comma">Nei contratti ' +
  '<span class="note-anchor" data-note-id="n1"><mark class="highlight-mark vlx-proposed" data-highlight="p1" data-proposed="proposed">con prestazioni</mark></span>' +
  ' corrispettive <mark class="highlight-mark" data-highlight="h1">mie</mark> ' +
  '<mark class="highlight-mark vlx-proposed" data-highlight="p3" data-proposed="proposed">vedi <span class="vlx-ref" role="button" tabindex="0" data-note="119">(119)</span></mark>' +
  '<span class="vlx-sign" role="button" tabindex="0" data-block="0" data-notes="1" data-highlights="3" data-proposed="2"></span></div>' +
  '<p class="vlx-dec-para"><span class="vlx-dec-line">Il <mark class="highlight-mark vlx-proposed" data-highlight="p2" data-proposed="review">ricorso</mark></span>' +
  '<span class="vlx-sign" role="button" tabindex="0" data-block="1" data-notes="0" data-highlights="1" data-proposed="1"></span></p>' +
  // A block with no sign (a text drawn flat): no popover to open, so the note under the passage opens as before.
  '<div class="vlx-b vlx-comma"><span class="note-anchor" data-note-id="n1"><mark class="highlight-mark vlx-proposed" data-highlight="p4" data-proposed="proposed">senza segno</mark></span></div>';

const NOTES: Annotation[] = [{ id: 'n1', normaKey: 'k', articleId: '1', text: 'Mia nota', createdAt: '', anchorText: 'con prestazioni', startOffset: 13 }];

/** The hook with a reader's own note handler (`useInlineNoteAnchors`), and a way to redraw the text. */
function Harness({ hidden = false }: { hidden?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [version, setVersion] = useState(1);
  const { openBlock, openNote } = useArticleTextInteractions(ref, 'a', { contentKey: `v${version}` });
  const { inlineNote } = useInlineNoteAnchors(ref, NOTES);
  const html = useMemo(() => ({ __html: BODY }), []);
  return (
    <div>
      <div ref={ref} data-testid="body" className={hidden ? 'highlights-hidden' : undefined} dangerouslySetInnerHTML={html} />
      <output data-testid="block">{openBlock === null ? '' : String(openBlock)}</output>
      <output data-testid="note">{inlineNote?.note.id ?? ''}</output>
      <output data-testid="update">{openNote?.id ?? ''}</output>
      <button type="button" onClick={() => setVersion((v) => v + 1)}>ridisegna</button>
    </div>
  );
}

const mark = (id: string) => screen.getByTestId('body').querySelector<HTMLElement>(`[data-highlight="${id}"]`)!;
const out = (id: string) => screen.getByTestId(id).textContent;

describe('useArticleTextInteractions — a passage an application proposed (D7b)', () => {
  it('a click on it opens its block\'s popover, never the note under it', () => {
    render(<Harness />);
    fireEvent.click(mark('p1'));
    expect(out('block')).toBe('0');
    expect(out('note')).toBe('');
  });

  it('still so once the text has been redrawn (its listener added again, now last)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'ridisegna' }));
    fireEvent.click(mark('p1'));
    expect(out('block')).toBe('0');
    expect(out('note')).toBe('');
  });

  it('in a decision\'s paragraph too', () => {
    render(<Harness />);
    fireEvent.click(mark('p2'));
    expect(out('block')).toBe('1');
  });

  it('a reference inside it keeps its own click: the update note opens, not the popover', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('body').querySelector('.vlx-ref')!);
    expect(out('update')).toBe('119');
    expect(out('block')).toBe('');
  });

  it('with the highlights hidden it is the words again: the note under it opens; the reader\'s own highlight never opens a popover', () => {
    render(<Harness hidden />);
    fireEvent.click(mark('p1'));
    expect(out('block')).toBe('');
    expect(out('note')).toBe('n1');
    fireEvent.click(mark('h1'));
    expect(out('block')).toBe('');
  });

  it('in a block with no sign, the note under it opens as before', () => {
    render(<Harness />);
    fireEvent.click(mark('p4'));
    expect(out('block')).toBe('');
    expect(out('note')).toBe('n1');
  });

  it('a second click leaves it open', () => {
    render(<Harness />);
    fireEvent.click(mark('p1'));
    fireEvent.click(mark('p1'));
    expect(out('block')).toBe('0');
  });
});
