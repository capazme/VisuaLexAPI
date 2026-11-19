import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import type { Annotation } from '../../../types';
import { NotesPeekPanel } from './NotesPeekPanel';
import { HighlightsActionsPicker } from './HighlightsActionsPicker';
import { CopyModal } from '../../ui/CopyModal';

// LC139 (L-73): the reading toolbar's «Note», «Evidenziazioni» and «Copia» open in the page under it, not over the text.
function Host({ label, children }: { label: string; children: (open: boolean, close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)}>{label}</button>
      {children(open, () => setOpen(false))}
    </>
  );
}

/** Opens the space from its command; the focus lands on the space, never in a field; Esc and «Chiudi» give it back. */
function checkSpace(command: string, name: string | RegExp) {
  const button = screen.getByRole('button', { name: command });
  button.focus();
  fireEvent.click(button);
  const region = screen.getByRole('region', { name });
  expect(region).toHaveFocus();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(region, { key: 'Escape' });
  expect(screen.queryByRole('region')).toBeNull();
  expect(button).toHaveFocus();
  fireEvent.click(button);
  fireEvent.click(within(screen.getByRole('region', { name })).getByRole('button', { name: 'Chiudi' }));
  expect(screen.queryByRole('region')).toBeNull();
  expect(button).toHaveFocus();
}

const note = (id: string, text: string): Annotation => ({ id, text, articleId: '2043', normaKey: 'cc', createdAt: '2026-11-01T10:00:00Z' } as Annotation);

describe('the reader\'s spaces under the toolbar', () => {
  it('«Note»: a region with the notes and a new one, the field not focused', () => {
    const onAddNote = vi.fn();
    render(
      <Host label="Note">
        {(open, close) => (
          <NotesPeekPanel
            isOpen={open} onClose={close} annotations={[note('n1', 'Vedi Cass. 2019')]} articleLabel="art. 2043 c.c."
            noteAnchor={null} onAddNote={onAddNote} onUpdateNote={() => {}} onRemoveNote={() => {}} onClearAnchor={() => {}} onExportTxt={() => {}}
          />
        )}
      </Host>,
    );
    checkSpace('Note', 'Note su art. 2043 c.c.');
    fireEvent.click(screen.getByRole('button', { name: 'Note' }));
    const region = screen.getByRole('region', { name: 'Note su art. 2043 c.c.' });
    expect(region).toHaveTextContent('Vedi Cass. 2019');
    fireEvent.change(within(region).getByRole('textbox', { name: 'Nuova nota' }), { target: { value: 'Una nota' } });
    fireEvent.click(within(region).getByRole('button', { name: 'Salva' }));
    expect(onAddNote).toHaveBeenCalledWith('Una nota');
  });

  it('«Evidenziazioni»: hide, show and export, in words', () => {
    const onToggle = vi.fn();
    const onExport = vi.fn();
    render(
      <Host label="Evidenziazioni">
        {(open, close) => (
          <HighlightsActionsPicker isOpen={open} onClose={close} highlightsCount={2} highlightsHidden={false} onToggleVisibility={onToggle} onExportTxt={onExport} />
        )}
      </Host>,
    );
    checkSpace('Evidenziazioni', 'Evidenziazioni');
    const command = screen.getByRole('button', { name: 'Evidenziazioni' });
    fireEvent.click(command);
    fireEvent.click(screen.getByRole('button', { name: 'Nascondi' }));
    expect(onToggle).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Esporta in .txt' }));
    expect(onExport).toHaveBeenCalled();
    // The export done, the space closes and the focus goes back to the toolbar.
    expect(screen.queryByRole('region')).toBeNull();
    expect(command).toHaveFocus();
  });

  it('«Copia»: the options in the page, and «Copia» copies and closes', () => {
    const onCopy = vi.fn();
    render(
      <Host label="Copia…">
        {(open, close) => <CopyModal isOpen={open} onClose={close} onCopy={onCopy} hasNotes={false} hasHighlights={false} />}
      </Host>,
    );
    checkSpace('Copia…', 'Copia contenuto');
    fireEvent.click(screen.getByRole('button', { name: 'Copia…' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Copia contenuto' })).getByRole('button', { name: 'Copia' }));
    expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ includeText: true, includeCitation: true }));
    expect(screen.queryByRole('region')).toBeNull();
  });
});
