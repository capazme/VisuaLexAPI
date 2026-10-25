import { describe, it, expect, vi } from 'vitest';
import { useEffect, useMemo, useRef } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { useArticleTextInteractions } from './useArticleTextInteractions';

// An article's comma and a decision's paragraph as the renderers emit them: a proposed passage (D7b) under a note the
// reader anchored on the same words, the block's sign last.
const BODY =
  '<div class="vlx-b vlx-comma">Nei contratti ' +
  '<span class="note-anchor" data-note-id="n1"><mark class="highlight-mark vlx-proposed" data-highlight="p1" data-proposed="proposed">con prestazioni</mark></span>' +
  ' corrispettive <mark class="highlight-mark" data-highlight="h1">mie</mark>' +
  '<span class="vlx-sign" role="button" tabindex="0" data-block="0" data-notes="1" data-highlights="2" data-proposed="1"></span></div>' +
  '<p class="vlx-dec-para"><span class="vlx-dec-line">Il <mark class="highlight-mark vlx-proposed" data-highlight="p2" data-proposed="review">ricorso</mark></span>' +
  '<span class="vlx-sign" role="button" tabindex="0" data-block="1" data-notes="0" data-highlights="1" data-proposed="1"></span></p>';

function Harness({ onNote }: { onNote: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { openBlock } = useArticleTextInteractions(ref, 'a', { contentKey: 'v1' });
  // The reader's own note handler, attached after the hook's, as `DossierItemReader` attaches it.
  useEffect(() => {
    const container = ref.current!;
    const handler = (e: MouseEvent) => { if ((e.target as Element).closest('.note-anchor')) onNote(); };
    container.addEventListener('click', handler);
    return () => container.removeEventListener('click', handler);
  }, [onNote]);
  const html = useMemo(() => ({ __html: BODY }), []);
  return (
    <div>
      <div ref={ref} data-testid="body" dangerouslySetInnerHTML={html} />
      <output data-testid="block">{openBlock === null ? '' : String(openBlock)}</output>
    </div>
  );
}

const mark = (id: string) => screen.getByTestId('body').querySelector<HTMLElement>(`[data-highlight="${id}"]`)!;
const block = () => screen.getByTestId('block').textContent;

describe('useArticleTextInteractions — a passage an application proposed (D7b)', () => {
  it('a click on it opens its block\'s popover, never the note under it', () => {
    const onNote = vi.fn();
    render(<Harness onNote={onNote} />);
    fireEvent.click(mark('p1'));
    expect(block()).toBe('0');
    expect(onNote).not.toHaveBeenCalled();
  });

  it('in a decision\'s paragraph too', () => {
    render(<Harness onNote={vi.fn()} />);
    fireEvent.click(mark('p2'));
    expect(block()).toBe('1');
  });

  it('a second click leaves it open; the reader\'s own highlight opens nothing', () => {
    render(<Harness onNote={vi.fn()} />);
    fireEvent.click(mark('p1'));
    fireEvent.click(mark('p1'));
    expect(block()).toBe('0');
    render(<Harness onNote={vi.fn()} />);
    fireEvent.click(screen.getAllByTestId('body')[1].querySelector('[data-highlight="h1"]')!);
    expect(screen.getAllByTestId('block')[1].textContent).toBe('');
  });
});
