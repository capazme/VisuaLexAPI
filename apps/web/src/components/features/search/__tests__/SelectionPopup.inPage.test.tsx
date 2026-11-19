import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { SelectionPopup } from '../SelectionPopup';
import { BlockSpace } from '../BlockSpace';

const FIRST = 'Qualunque fatto doloso o colposo.';
const SECOND = 'Obbliga colui che ha commesso il fatto a risarcire il danno.';

function Harness({ onCopy = vi.fn(), onHighlight = vi.fn() }: { onCopy?: (text: string) => void; onHighlight?: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  // Another space of the same text (a block's annotations), for «one at a time».
  const [other, setOther] = useState<number | null>(null);
  return (
    <div ref={containerRef} data-testid="container">
      <SelectionPopup inPage containerRef={containerRef} textRootRef={textRef} onHighlight={onHighlight} onAddNote={vi.fn()} onCopy={onCopy} />
      <div ref={textRef}>
        <div className="vlx-b vlx-comma">{FIRST}</div>
        <div className="vlx-b vlx-comma">{SECOND}</div>
      </div>
      <BlockSpace
        value={other}
        rootRef={textRef}
        block={(root) => root.querySelectorAll<HTMLElement>('.vlx-b')[1]}
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
});
