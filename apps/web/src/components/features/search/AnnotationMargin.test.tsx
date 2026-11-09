import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AnnotationMargin, type AnnotationMarginHandle, type NoteDraft } from './AnnotationMargin';
import type { Annotation } from '../../../types';
import type { LocatedThread } from '../../../utils/articleAnnotations';
import { buildPassage } from '../../../utils/threadPassages';
// The scroll: its own tests (`scrollParent.test.ts`).
vi.mock('../../../utils/scrollParent', () => ({ scrollToMiddle: vi.fn() }));

const PLAIN = 'Nei contratti con prestazioni corrispettive, quando uno dei contraenti non adempie le sue obbligazioni.';
const at = (words: string) => PLAIN.indexOf(words);
const note = (id: string, words: string, text: string): Annotation => ({
  id, normaKey: 'k', articleId: '1', text, createdAt: '2026-11-09', anchorText: words, startOffset: at(words),
});
const thread: LocatedThread = {
  thread: {
    id: 't1', title: 'Sulla risoluzione', passage: buildPassage(PLAIN, at('contraenti'), 'contraenti')!, articleUrn: 'urn:x',
    textHash: 'h', commentCount: 2, createdAt: '2026-11-09', user: { id: 'u', username: 'marta' },
  },
  start: at('contraenti'),
  end: at('contraenti') + 'contraenti'.length,
};

/** The reader has room for the column (jsdom lays nothing out): the wrapper measures `width`. */
function room(width: number) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-annotation-margin')
      ? ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect)
      : original.call(this);
  });
}

interface HarnessProps {
  notes?: Annotation[];
  threads?: LocatedThread[];
  initialDraft?: NoteDraft | null;
  onSave?: (text: string) => void;
  onUpdate?: (id: string, text: string) => void;
  onRemove?: (id: string) => void;
  onOpenThread?: (id: string) => void;
  onWide?: (wide: boolean) => void;
}

let handle: AnnotationMarginHandle | null = null;
function Harness({ notes = [], threads = [], initialDraft = null, onSave = vi.fn(), onUpdate = vi.fn(), onRemove = vi.fn(), onOpenThread, onWide }: HarnessProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(initialDraft);
  return (
    <AnnotationMargin
      ref={(h) => { handle = h; }}
      plain={PLAIN}
      textRootRef={textRef}
      contentKey="v1"
      notes={notes}
      onUpdateNote={onUpdate}
      onRemoveNote={onRemove}
      draft={draft}
      onSaveDraft={(text) => { onSave(text); setDraft(null); }}
      onCancelDraft={() => setDraft(null)}
      threads={threads}
      onOpenThread={onOpenThread}
      textHash="h"
      onWideChange={onWide}
    >
      <div ref={textRef} className="vlx-art"><div className="vlx-b">{PLAIN}</div></div>
    </AnnotationMargin>
  );
}

const column = () => screen.findByRole('complementary', { name: 'A margine del testo' });
/** Waits for a card to have its place in the column. */
const placed = (card: HTMLElement) => waitFor(() => {
  if (card.parentElement?.classList.contains('opacity-0')) throw new Error('not placed yet');
  return card;
});

afterEach(() => {
  vi.restoreAllMocks();
  handle = null;
});

describe('AnnotationMargin — the notes beside the text, as a word processor\'s comments (A4 §6)', () => {
  it('with room, the reader\'s notes and the discussions are cards beside the text, in the order of their words', async () => {
    room(1200);
    const onWide = vi.fn();
    render(<Harness notes={[note('n2', 'obbligazioni', 'Quali?'), note('n1', 'prestazioni corrispettive', 'Vedi Cass. 2020')]} threads={[thread]} onOpenThread={vi.fn()} onWide={onWide} />);
    const aside = await column();
    const cards = within(aside).getAllByRole('article');
    expect(cards.map((c) => c.getAttribute('data-note') ?? c.getAttribute('data-thread'))).toEqual(['n1', 't1', 'n2']);
    expect(within(cards[0]).getByText('Vedi Cass. 2020')).toBeInTheDocument();
    expect(within(cards[0]).getByText('“prestazioni corrispettive”')).toBeInTheDocument();
    expect(within(cards[1]).getByText('@marta · 2 risposte')).toBeInTheDocument();
    await placed(cards[0]);
    await waitFor(() => expect(onWide).toHaveBeenLastCalledWith(true));
  });

  it('without room, no column: the reader is told, and the sign goes to the sheet', async () => {
    room(600);
    const onWide = vi.fn();
    render(<Harness notes={[note('n1', 'prestazioni corrispettive', 'Vedi Cass. 2020')]} onWide={onWide} />);
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(onWide).toHaveBeenLastCalledWith(false);
    expect(handle?.focus(['note:n1'])).toBe(false);
  });

  it('a note card is edited in place («Modifica», then «Salva») and removed («Rimuovi»), the focus to the next card', async () => {
    room(1200);
    const onUpdate = vi.fn();
    const onRemove = vi.fn();
    render(<Harness notes={[note('n1', 'prestazioni corrispettive', 'Vedi Cass. 2020'), note('n2', 'obbligazioni', 'Quali?')]} onUpdate={onUpdate} onRemove={onRemove} />);
    const aside = await column();
    const [first, second] = within(aside).getAllByRole('article');
    await placed(first);
    fireEvent.click(within(first).getByRole('button', { name: 'Modifica' }));
    const box = within(first).getByRole('textbox', { name: 'Testo della nota' });
    fireEvent.change(box, { target: { value: 'Vedi Cass. 2021' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Salva' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith('n1', 'Vedi Cass. 2021');
    // An emptied text is not sent: the bin removes a note.
    fireEvent.click(within(first).getByRole('button', { name: 'Modifica' }));
    fireEvent.change(within(first).getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Salva' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    fireEvent.click(within(first).getByRole('button', { name: 'Rimuovi' }));
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('n1');
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it('a new note\'s editor stands at its words beside the text, its field focused once placed; «Salva» saves it', async () => {
    room(1200);
    const onSave = vi.fn();
    render(<Harness initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} onSave={onSave} />);
    const aside = await column();
    const card = within(aside).getByRole('article', { name: 'Nuova nota' });
    await placed(card);
    const box = within(card).getByRole('textbox', { name: 'Testo della nota' });
    await waitFor(() => expect(box).toHaveFocus());
    fireEvent.change(box, { target: { value: 'Il debitore.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Il debitore.');
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Nuova nota' })).toBeNull());
  });

  it('a new note\'s editor asks before a text written is dropped; empty, «Annulla» just closes it', async () => {
    room(1200);
    render(<Harness initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} />);
    const card = await placed(within(await column()).getByRole('article', { name: 'Nuova nota' }));
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'Il debitore.' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Annulla' }));
    expect(within(card).getByRole('alert')).toHaveTextContent('Scartare la modifica?');
    fireEvent.click(within(card).getByRole('button', { name: 'Scarta' }));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Nuova nota' })).toBeNull());
  });

  it('without room, a new note\'s editor is a sheet from the bottom, its field focused', async () => {
    room(600);
    const onSave = vi.fn();
    render(<Harness initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} onSave={onSave} />);
    const sheet = await screen.findByRole('dialog', { name: 'Nuova nota' });
    expect(within(sheet).getByText('“contraenti”')).toBeInTheDocument();
    const box = within(sheet).getByRole('textbox', { name: 'Testo della nota' });
    await waitFor(() => expect(box).toHaveFocus());
    fireEvent.change(box, { target: { value: 'Il debitore.' } });
    // Its X asks, as «Annulla» does, before a text written is dropped.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Chiudi' }));
    expect(within(sheet).getByRole('alert')).toHaveTextContent('Scartare la modifica?');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Continua' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salva' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('Il debitore.');
  });

  it('a discussion\'s card opens it in its panel', async () => {
    room(1200);
    const onOpenThread = vi.fn();
    render(<Harness threads={[thread]} onOpenThread={onOpenThread} />);
    const card = within(await column()).getByRole('article', { name: 'Glossa: Sulla risoluzione' });
    fireEvent.click(within(card).getByRole('button', { name: 'Apri glossa' }));
    expect(onOpenThread).toHaveBeenCalledExactlyOnceWith('t1');
  });

  it('focuses the first card among those asked for, in the order of the text, once the cards are placed', async () => {
    room(1200);
    render(<Harness notes={[note('n2', 'obbligazioni', 'Quali?'), note('n1', 'prestazioni corrispettive', 'Vedi Cass. 2020')]} />);
    const aside = await column();
    const [first] = within(aside).getAllByRole('article');
    await placed(first);
    let took = false;
    act(() => { took = handle?.focus(['note:n2', 'note:n1']) ?? false; });
    expect(took).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('a note whose words are no longer in the text has no card (the lists under the text keep it)', async () => {
    room(1200);
    render(<Harness notes={[{ ...note('n1', 'prestazioni corrispettive', 'Persa'), anchorText: 'parole che non ci sono' }, note('n2', 'obbligazioni', 'Quali?')]} />);
    const aside = await column();
    expect(within(aside).getAllByRole('article').map((c) => c.getAttribute('data-note'))).toEqual(['n2']);
  });
});
