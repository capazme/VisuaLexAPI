import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { SelectionPopup } from '../SelectionPopup';
import { BlockSpace } from '../BlockSpace';

const FIRST = 'Qualunque fatto doloso o colposo.';
const SECOND = 'Obbliga colui che ha commesso il fatto a risarcire il danno.';

interface HarnessProps {
  onCopy?: (text: string) => void;
  onHighlight?: () => void;
  /** The reader stops asking for the actions (a passage being moved). */
  bar?: boolean;
  /** A text drawn flat: no paragraph to open under. */
  flat?: boolean;
  /** The paragraph the other space opens under. */
  otherAt?: number;
}

function Harness({ onCopy = vi.fn(), onHighlight = vi.fn(), bar = true, flat = false, otherAt = 1 }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  // Another space of the same text (a block's annotations), for «one at a time».
  const [other, setOther] = useState<number | null>(null);
  return (
    <div ref={containerRef} data-testid="container">
      {bar && <SelectionPopup inPage containerRef={containerRef} textRootRef={textRef} onHighlight={onHighlight} onAddNote={vi.fn()} onCopy={onCopy} />}
      <div ref={textRef}>
        <div className={flat ? undefined : 'vlx-b vlx-comma'}>{FIRST}</div>
        <div className={flat ? undefined : 'vlx-b vlx-comma'}>{SECOND}</div>
      </div>
      <textarea aria-label="Una nota" />
      <BlockSpace
        value={other}
        rootRef={textRef}
        block={(root) => root.querySelectorAll<HTMLElement>('.vlx-b')[otherAt]}
        onClose={() => setOther(null)}
        title={() => 'Annotazioni'}
      >
        {() => <p>Le note del comma</p>}
      </BlockSpace>
      <button type="button" onClick={() => setOther(1)}>Apri le annotazioni</button>
    </div>
  );
}

async function select(needle: string, inText: string) {
  const node = screen.getByText(inText).firstChild as Text;
  const start = inText.indexOf(needle);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + needle.length);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(screen.getByTestId('container'));
  const space = await screen.findByRole('region', { name: 'Testo selezionato' });
  await act(async () => {});
  return space;
}

describe('SelectionPopup in the page (LC142, L-73): the actions under the paragraph', () => {
  const originalRect = Range.prototype.getBoundingClientRect;
  // jsdom has no layout: the range's box, read for a note's place.
  beforeEach(() => { Range.prototype.getBoundingClientRect = () => new DOMRect(40, 120, 90, 18); });
  afterEach(() => {
    Range.prototype.getBoundingClientRect = originalRect;
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('open in the text, right after the paragraph the selection ends in, with no dialog and the focus in them', async () => {
    render(<Harness />);
    const space = await select('fatto doloso', FIRST);
    const block = screen.getByText(FIRST);
    expect(block.nextElementSibling?.contains(space)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(space.contains(document.activeElement)).toBe(true);
    expect(within(space).getByText('“fatto doloso”')).toBeInTheDocument();
    // The selection is still there, for the actions.
    expect(window.getSelection()?.toString()).toBe('fatto doloso');
  });

  it('say what they do in words, and act on the selection, then close', async () => {
    const onCopy = vi.fn();
    render(<Harness onCopy={onCopy} />);
    const space = await select('risarcire il danno', SECOND);
    expect(within(space).getByRole('button', { name: /Evidenzia in/ })).toBeInTheDocument();
    expect(within(space).getByRole('button', { name: 'Aggiungi nota' })).toBeInTheDocument();
    fireEvent.click(within(space).getByRole('button', { name: 'Copia' }));
    expect(onCopy).toHaveBeenCalledWith('risarcire il danno');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull());
  });

  it('Esc and «Chiudi» close them, the selection cleared and the focus on the paragraph', async () => {
    render(<Harness />);
    let space = await select('fatto doloso', FIRST);
    fireEvent.keyDown(space, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByText(FIRST));
    expect(window.getSelection()?.toString()).toBe('');
    space = await select('commesso', SECOND);
    fireEvent.click(within(space).getByRole('button', { name: 'Chiudi' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByText(SECOND));
  });

  it('one at a time in a text: another space opening closes them, and they close it', async () => {
    render(<Harness />);
    await select('fatto doloso', FIRST);
    fireEvent.click(screen.getByRole('button', { name: 'Apri le annotazioni' }));
    expect(await screen.findByRole('region', { name: 'Annotazioni' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull());
    await select('commesso', SECOND);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Annotazioni' })).toBeNull());
  });

  it('a press inside them is not a new selection of the text', async () => {
    const onHighlight = vi.fn();
    render(<Harness onHighlight={onHighlight} />);
    const space = await select('fatto doloso', FIRST);
    fireEvent.mouseUp(within(space).getByRole('button', { name: 'Copia' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.getByRole('region', { name: 'Testo selezionato' })).toBe(space);
  });

  it('H and N typed in a field are letters, not shortcuts', async () => {
    const onHighlight = vi.fn();
    render(<Harness onHighlight={onHighlight} />);
    await select('fatto doloso', FIRST);
    const field = screen.getByRole('textbox', { name: 'Una nota' });
    field.focus();
    fireEvent.keyDown(field, { key: 'h' });
    expect(onHighlight).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Testo selezionato' })).toBeInTheDocument();
  });

  it('a selection across another space open in the text copies the article\'s words alone', async () => {
    const onCopy = vi.fn();
    render(<Harness onCopy={onCopy} otherAt={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri le annotazioni' }));
    await screen.findByRole('region', { name: 'Annotazioni' });
    // From the first paragraph to the second, across the space open between them.
    const from = screen.getByText(FIRST).firstChild as Text;
    const to = screen.getByText(SECOND).firstChild as Text;
    const range = document.createRange();
    range.setStart(from, FIRST.indexOf('colposo'));
    range.setEnd(to, 'Obbliga'.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('container'));
    const space = await screen.findByRole('region', { name: 'Testo selezionato' });
    fireEvent.click(within(space).getByRole('button', { name: 'Copia' }));
    expect(onCopy).toHaveBeenCalledWith('colposo.Obbliga');
  });

  it('a selection ending inside a space is not the text\'s: nothing opens', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Apri le annotazioni' }));
    const other = await screen.findByRole('region', { name: 'Annotazioni' });
    const note = within(other).getByText('Le note del comma').firstChild as Text;
    const range = document.createRange();
    range.setStart(screen.getByText(SECOND).firstChild as Text, 0);
    range.setEnd(note, 3);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('container'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull();
  });

  it('a text drawn flat has no paragraph to open under: the actions grow from the words as an island', async () => {
    render(<Harness flat />);
    const node = screen.getByText(FIRST).firstChild as Text;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 10);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(screen.getByTestId('container'));
    const island = await screen.findByRole('region', { name: 'Testo selezionato' });
    expect(island.closest('[data-reader-slot]')).toBeNull();
    expect(within(island).getByRole('button', { name: 'Copia' })).toBeInTheDocument();
  });

  // Luca's option A (LC142): far from the paragraph's end, the actions do not open under it, where the page would have to
  // scroll the selected words away (a 55,572 px paragraph of a decision, at 390).
  describe('a paragraph that goes on far below the words', () => {
    const tall = () => vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const bottom = this.classList.contains('vlx-b') ? 30_000 : 0;
      return new DOMRect(0, 0, 0, bottom);
    });

    it('grows the actions from the words as an island, the page still, the focus in it', async () => {
      const spy = tall();
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        render(<Harness />);
        const island = await select('fatto doloso', FIRST);
        expect(island.closest('[data-reader-slot]')).toBeNull();
        expect(island.contains(document.activeElement)).toBe(true);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(window.getSelection()?.toString()).toBe('fatto doloso');
        expect(scrollBy).not.toHaveBeenCalled();
        expect(scrollIntoView).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
        scrollBy.mockRestore();
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it('Esc and «Chiudi» clear the selection and give the focus to the paragraph', async () => {
      const spy = tall();
      try {
        render(<Harness />);
        let island = await select('fatto doloso', FIRST);
        fireEvent.keyDown(island, { key: 'Escape' });
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull());
        expect(document.activeElement).toBe(screen.getByText(FIRST));
        expect(window.getSelection()?.toString()).toBe('');
        island = await select('commesso', SECOND);
        fireEvent.click(within(island).getByRole('button', { name: 'Chiudi' }));
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull());
        expect(document.activeElement).toBe(screen.getByText(SECOND));
      } finally {
        spy.mockRestore();
      }
    });

    it('one at a time with the spaces in the text', async () => {
      const spy = tall();
      try {
        render(<Harness />);
        await select('fatto doloso', FIRST);
        fireEvent.click(screen.getByRole('button', { name: 'Apri le annotazioni' }));
        expect(await screen.findByRole('region', { name: 'Annotazioni' })).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull());
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('in a low window under the reader\'s sticky toolbar, the words and the space cannot both be seen: an island', async () => {
    const height = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    const toolbar = document.createElement('div');
    toolbar.style.position = 'sticky';
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this === toolbar ? new DOMRect(0, 0, 390, 109) : this.classList.contains('vlx-b') ? new DOMRect(0, 110, 390, 50) : new DOMRect();
    });
    document.elementFromPoint = (_x: number, y: number) => (y < 109 ? toolbar : null);
    try {
      render(<Harness />);
      document.body.prepend(toolbar);
      const island = await select('fatto doloso', FIRST);
      expect(island.closest('[data-reader-slot]')).toBeNull();
    } finally {
      spy.mockRestore();
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }
  });

  it('drawn taller than its estimate and past the bars at the foot, the space gives way to the island, the words still (LC145)', async () => {
    // 390×450: the app's bar and the reader's toolbar down to 109, a fixed bar from 400; the space's commands wrap to 308 px.
    const height = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 450 });
    const toolbar = document.createElement('div');
    toolbar.style.position = 'sticky';
    const foot = document.createElement('div');
    foot.style.position = 'fixed';
    const spy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === toolbar) return new DOMRect(0, 0, 390, 109);
      if (this === foot) return new DOMRect(0, 400, 390, 50);
      if (this.classList.contains('vlx-b')) return new DOMRect(0, 110, 390, 30);
      if (this.getAttribute('role') === 'region' && this.closest('[data-reader-slot]')) return new DOMRect(0, 148, 390, 308);
      return new DOMRect();
    });
    document.elementFromPoint = (_x: number, y: number) => (y < 109 ? toolbar : y >= 400 ? foot : null);
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    try {
      render(<Harness />);
      document.body.prepend(toolbar);
      document.body.append(foot);
      await select('fatto doloso', FIRST);
      await waitFor(() => expect(screen.getByRole('region', { name: 'Testo selezionato' }).closest('[data-reader-slot]')).toBeNull());
      const island = screen.getByRole('region', { name: 'Testo selezionato' });
      expect(island.contains(document.activeElement)).toBe(true);
      expect(window.getSelection()?.toString()).toBe('fatto doloso');
      expect(scrollBy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      scrollBy.mockRestore();
      delete (document as { elementFromPoint?: unknown }).elementFromPoint;
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    }
  });

  it('under the paragraph, the space is not scrolled into view by itself: the selected words stay', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<Harness />);
      const space = await select('fatto doloso', FIRST);
      expect(space.closest('[data-reader-slot]')).not.toBeNull();
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('leaves the text when its reader stops asking for it', async () => {
    const { rerender } = render(<Harness />);
    await select('fatto doloso', FIRST);
    expect(document.querySelectorAll('[data-reader-slot]')).toHaveLength(1);
    rerender(<Harness bar={false} />);
    expect(document.querySelectorAll('[data-reader-slot]')).toHaveLength(0);
  });

  it('N and H are taken: their letter is not typed where the focus lands (a note\'s field)', async () => {
    render(<Harness />);
    await select('fatto doloso', FIRST);
    // `fireEvent` answers false when the event was prevented.
    expect(fireEvent.keyDown(document.body, { key: 'n' })).toBe(false);
    await select('commesso', SECOND);
    expect(fireEvent.keyDown(document.body, { key: 'h' })).toBe(false);
  });

  it('after «Evidenzia», the focus is on the paragraph, and on the one drawn again when the text is redrawn later', async () => {
    const { rerender } = render(<RedrawHarness version={1} />);
    const space = await select('fatto doloso', FIRST);
    fireEvent.click(within(space).getByRole('button', { name: /Evidenzia in/ }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Testo selezionato' })).toBeNull());
    const before = screen.getByText(FIRST);
    expect(document.activeElement).toBe(before);
    // The highlight saved: the text is drawn again, every node replaced.
    rerender(<RedrawHarness version={2} />);
    const after = screen.getByText(FIRST);
    expect(after).not.toBe(before);
    expect(document.activeElement).toBe(after);
  });
});

/** A text drawn as `SafeHTML` draws it: from a string, every node replaced when it changes. */
function RedrawHarness({ version }: { version: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const html = `<div class="vlx-b vlx-comma" data-v="${version}">${FIRST}</div><div class="vlx-b vlx-comma" data-v="${version}">${SECOND}</div>`;
  return (
    <div ref={containerRef} data-testid="container">
      <SelectionPopup inPage containerRef={containerRef} textRootRef={textRef} onHighlight={vi.fn()} onAddNote={vi.fn()} onCopy={vi.fn()} />
      <div ref={textRef}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
