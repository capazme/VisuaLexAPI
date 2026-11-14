import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useRef, useState } from 'react';
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
let wrapperWidth = 0;
function room(width: number) {
  wrapperWidth = width;
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-annotation-margin')
      ? ({ x: 0, y: 0, top: 0, left: 0, right: wrapperWidth, bottom: 0, width: wrapperWidth, height: 0, toJSON: () => ({}) } as DOMRect)
      : original.call(this);
  });
}

/** jsdom has no ResizeObserver: one whose callbacks the test calls, as the reader is resized. */
const resized: (() => void)[] = [];
function observeResizes() {
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: () => void;
    constructor(callback: () => void) { this.callback = callback; resized.push(callback); }
    observe() {}
    disconnect() { resized.splice(resized.indexOf(this.callback), 1); }
  });
}
const resizeTo = (width: number) => act(() => { wrapperWidth = width; [...resized].forEach((run) => run()); });

interface HarnessProps {
  notes?: Annotation[];
  threads?: LocatedThread[];
  initialDraft?: NoteDraft | null;
  onSave?: (text: string) => void;
  onUpdate?: (id: string, text: string) => void;
  onRemove?: (id: string) => void;
  onOpenThread?: (id: string) => void;
  onWide?: (wide: boolean) => void;
  /** The block draws its sign once it holds a note, drawn again (a new element) with the text. */
  signs?: boolean;
}

let handle: AnnotationMarginHandle | null = null;
let openDraft: (draft: NoteDraft) => void = () => {};
/** The server's answer to the new note: its id in place of the temporary one, and the text drawn again. */
let savedOnServer: (id: string) => void = () => {};
function Harness({ notes = [], threads = [], initialDraft = null, onSave = vi.fn(), onUpdate = vi.fn(), onRemove = vi.fn(), onOpenThread, onWide, signs = false }: HarnessProps) {
  const textRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<NoteDraft | null>(initialDraft);
  const [list, setList] = useState(notes);
  const [drawn, setDrawn] = useState(1);
  // A reader's selection bar: a new note, unless one being written keeps its words.
  useEffect(() => {
    openDraft = (next) => { if (!handle?.keepDraft()) setDraft(next); };
    savedOnServer = (id) => {
      setList((l) => l.map((n) => (n.id === 'nuova' ? { ...n, id } : n)));
      setDrawn((d) => d + 1);
    };
  });
  return (
    <AnnotationMargin
      ref={(h) => { handle = h; }}
      plain={PLAIN}
      textRootRef={textRef}
      contentKey={`v${drawn}`}
      notes={list}
      onUpdateNote={onUpdate}
      onRemoveNote={onRemove}
      draft={draft}
      onSaveDraft={(text) => {
        onSave(text);
        if (draft) setList((l) => [...l, note('nuova', draft.text, text)]);
        setDraft(null);
      }}
      onCancelDraft={() => setDraft(null)}
      threads={threads}
      onOpenThread={onOpenThread}
      textHash="h"
      onWideChange={onWide}
    >
      <div ref={textRef} className="vlx-art">
        <div className="vlx-b">
          {PLAIN}
          {signs && list.length > 0 && <span key={drawn} className="vlx-sign" role="button" tabIndex={0} aria-label="Annotazioni del comma" />}
        </div>
      </div>
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
  vi.unstubAllGlobals();
  resized.length = 0;
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

  it('a new note saved: the focus goes to its card, never to the page', async () => {
    room(1200);
    render(<Harness initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} />);
    const card = await placed(within(await column()).getByRole('article', { name: 'Nuova nota' }));
    const box = within(card).getByRole('textbox');
    await waitFor(() => expect(box).toHaveFocus());
    fireEvent.change(box, { target: { value: 'Il debitore.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note')).toBe('nuova'));
  });

  it('a new note saved keeps the focus when the server gives it its id: the card drawn in its place takes it', async () => {
    room(1200);
    render(<Harness initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} />);
    const card = await placed(within(await column()).getByRole('article', { name: 'Nuova nota' }));
    const box = within(card).getByRole('textbox');
    await waitFor(() => expect(box).toHaveFocus());
    fireEvent.change(box, { target: { value: 'Il debitore.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note')).toBe('nuova'));
    act(() => savedOnServer('s1'));
    expect(document.activeElement?.getAttribute('data-note')).toBe('s1');
  });

  it('without room, a new note saved from the sheet gives the focus to its block\'s sign, and to the sign drawn again', async () => {
    room(600);
    render(<Harness signs initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} />);
    const sheet = await screen.findByRole('dialog', { name: 'Nuova nota' });
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'Il debitore.' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salva' }));
    const sign = await screen.findByRole('button', { name: 'Annotazioni del comma' });
    await waitFor(() => expect(sign).toHaveFocus());
    act(() => savedOnServer('s1'));
    const again = screen.getByRole('button', { name: 'Annotazioni del comma' });
    expect(again).not.toBe(sign);
    expect(again).toHaveFocus();
  });

  /** A new note written on «contraenti» and saved with Enter, its card focused. */
  async function saveNote() {
    room(1200);
    render(<Harness initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} />);
    const card = await placed(within(await column()).getByRole('article', { name: 'Nuova nota' }));
    const box = within(card).getByRole('textbox');
    await waitFor(() => expect(box).toHaveFocus());
    fireEvent.change(box, { target: { value: 'Il debitore.' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-note')).toBe('nuova'));
    // The frame the hold starts listening in (after the editor's sheet, if any, gave the focus back).
    await act(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
    return document.activeElement as HTMLElement;
  }

  it('a new note saved: Tab to its card\'s «Modifica» keeps the hold; the focus taken out of the card lets it go', async () => {
    const card = await saveNote();
    within(card).getByRole('button', { name: 'Modifica' }).focus();
    act(() => savedOnServer('s1'));
    expect(document.activeElement?.getAttribute('data-note')).toBe('s1');
    const elsewhere = document.body.appendChild(document.createElement('button'));
    elsewhere.focus();
    elsewhere.remove();
    act(() => savedOnServer('s2'));
    expect(document.activeElement).toBe(document.body);
  });

  it('a new note saved: the hold ends after its time, and a redraw then takes no focus back', async () => {
    const timers = vi.spyOn(window, 'setTimeout');
    await saveNote();
    const expire = timers.mock.calls.find(([, ms]) => ms === 10_000)?.[0];
    expect(expire).toBeTypeOf('function');
    act(() => (expire as () => void)());
    act(() => savedOnServer('s1'));
    expect(document.activeElement).toBe(document.body);
  });

  it('a new note saved: once the reader presses elsewhere, a redraw takes no focus back', async () => {
    await saveNote();
    fireEvent.pointerDown(document.body);
    act(() => savedOnServer('s1'));
    expect(document.activeElement).toBe(document.body);
  });

  it('a new selection while a note is written keeps it on its words and gives its field the focus again; empty, it moves', async () => {
    room(1200);
    render(<Harness initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} />);
    const card = await placed(within(await column()).getByRole('article', { name: 'Nuova nota' }));
    // Nothing written: the editor goes to the new words.
    act(() => openDraft({ text: 'obbligazioni', startOffset: at('obbligazioni') }));
    await waitFor(() => expect(within(screen.getByRole('article', { name: 'Nuova nota' })).getByText('“obbligazioni”')).toBeInTheDocument());
    const box = within(screen.getByRole('article', { name: 'Nuova nota' })).getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Quali?' } });
    (document.activeElement as HTMLElement | null)?.blur();
    // Written: the new words are not taken, the text stays on its own, and its field has the focus.
    act(() => openDraft({ text: 'contraenti', startOffset: at('contraenti') }));
    const now = screen.getByRole('article', { name: 'Nuova nota' });
    expect(within(now).getByText('“obbligazioni”')).toBeInTheDocument();
    expect(within(now).getByRole('textbox')).toHaveValue('Quali?');
    expect(within(now).getByRole('textbox')).toHaveFocus();
    expect(card).toBeDefined();
  });

  it('a note being written keeps its text when the reader loses the room for the column: the sheet takes it, and back', async () => {
    observeResizes();
    room(1200);
    render(<Harness initialDraft={{ text: 'contraenti', startOffset: at('contraenti') }} />);
    const card = await placed(within(await column()).getByRole('article', { name: 'Nuova nota' }));
    fireEvent.change(within(card).getByRole('textbox'), { target: { value: 'Il debitore.' } });
    resizeTo(600);
    const sheet = await screen.findByRole('dialog', { name: 'Nuova nota' });
    expect(within(sheet).getByRole('textbox')).toHaveValue('Il debitore.');
    // A scrollbar's width less does not take the column away again (a rem of slack); well under the room, it goes.
    resizeTo(1200);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nuova nota' })).toBeNull());
    expect(within(await column()).getByRole('textbox')).toHaveValue('Il debitore.');
    resizeTo(52 * 16 - 10);
    expect(screen.queryByRole('dialog', { name: 'Nuova nota' })).toBeNull();
  });
});
