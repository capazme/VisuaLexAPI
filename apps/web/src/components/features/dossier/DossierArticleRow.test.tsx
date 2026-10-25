import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// The reader fetches the article; the row's own behaviour is what is under test.
vi.mock('./DossierItemReader', () => ({
  DossierItemReader: () => <div data-testid="reader">testo</div>,
}));

import { DossierArticleRow, type DossierArticleRowProps } from './DossierArticleRow';
import { CurrentDossierContext } from './currentDossier';

const normaItem: DossierArticleRowProps['item'] = {
  id: 'i1', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z',
  data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043' },
};

function renderRow(item = normaItem, over: Partial<DossierArticleRowProps> = {}) {
  return render(
    <DossierArticleRow
      item={item} rubrica={null} isSelected={false} showCheckbox={false}
      onToggleSelect={() => {}} onRemove={() => {}} onToggleImportant={() => {}}
      isExpanded={false} onToggleExpand={() => {}} onOpenOnDashboard={() => {}} showToast={() => {}}
      {...over}
    />,
  );
}

describe('DossierArticleRow', () => {
  it('reads "art. N — rubrica", without the act, the date or «Aggiunto il»', () => {
    renderRow(normaItem, { rubrica: 'Risarcimento per fatto illecito' });
    expect(screen.getByText('art. 2043')).toBeInTheDocument();
    expect(screen.getByText('Risarcimento per fatto illecito')).toBeInTheDocument();
    expect(screen.queryByText(/Aggiunto il/)).toBeNull();
    expect(screen.queryByText(/codice civile/i)).toBeNull();
    expect(screen.queryByText(/1942/)).toBeNull();
  });

  it('names the act in its accessible name, from the server citation', () => {
    renderRow({ ...normaItem, citation: 'art. 2043 c.c.' });
    expect(screen.getByRole('button', { name: 'Espandi art. 2043 c.c.' })).toBeInTheDocument();
  });

  it('shows the annex as a chip', () => {
    renderRow({ ...normaItem, data: { tipo_atto: 'decreto legislativo', numero_atto: '36', data: '2023-03-31', allegato: 'I.1', numero_articolo: '1' } });
    expect(screen.getByText('All. I.1')).toBeInTheDocument();
    expect(screen.getByText('art. 1')).toBeInTheDocument();
  });

  it("shows no annex for a code's article", () => {
    renderRow({ ...normaItem, data: { ...normaItem.data, allegato: '2' } });
    expect(screen.queryByText('All. 2')).toBeNull();
  });

  it('has no drag handle', () => {
    renderRow();
    expect(document.querySelector('[aria-roledescription="sortable"]')).toBeNull();
  });

  it('opens the reader in place, in the region the toggle controls', () => {
    renderRow(normaItem, { isExpanded: true });
    const toggle = screen.getByRole('button', { name: /comprimi codice civile/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const region = document.getElementById(toggle.getAttribute('aria-controls') as string);
    expect(region).toContainElement(screen.getByTestId('reader'));
  });
});

describe('DossierArticleRow star', () => {
  it('renders an unpressed star and fires onToggleImportant', () => {
    const onToggleImportant = vi.fn();
    renderRow(normaItem, { onToggleImportant });
    const star = screen.getByRole('button', { name: /segna come importante/i });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    expect(onToggleImportant).toHaveBeenCalledTimes(1);
  });
  it('renders a pressed star for an important item', () => {
    renderRow({ ...normaItem, status: 'important' });
    expect(screen.getByRole('button', { name: /rimuovi da importanti/i })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('DossierArticleRow expansion', () => {
  it('keeps interactive controls out of the expand toggle subtree', () => {
    // ARIA makes descendants of a role="button" presentational, so the star
    // and the remove button must be siblings of the toggle, never children.
    renderRow(normaItem);
    const toggle = screen.getByRole('button', { name: /espandi codice civile/i });
    expect(within(toggle).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /segna come importante/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /rimuovi articolo dal dossier/i })).toBeInTheDocument();
  });

  it('fires onToggleExpand when the row is activated, by click and by keyboard', () => {
    const onToggleExpand = vi.fn();
    renderRow(normaItem, { onToggleExpand });
    const toggle = screen.getByRole('button', { name: /espandi codice civile/i });
    fireEvent.click(toggle);
    fireEvent.keyDown(toggle, { key: 'Enter' });
    expect(onToggleExpand).toHaveBeenCalledTimes(2);
  });
});

describe('DossierArticleRow notes', () => {
  const notes = [
    { id: 'n1', type: 'note' as const, data: 'Sul danno ingiusto.', addedAt: '2026-10-04T10:00:00Z', createdBy: { clientName: 'Claude Code' } },
    { id: 'n2', type: 'note' as const, data: 'Mia nota.', addedAt: '2026-10-04T11:00:00Z', createdBy: null },
  ];
  it('counts its notes on the closed row, without the mark of the application that wrote one (D7b)', () => {
    renderRow(normaItem, { notes });
    expect(screen.getByTitle('2 note')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Espandi codice civile 262 articolo 2043, 2 note' })).toBeInTheDocument();
    expect(screen.queryByText(/Claude Code/)).toBeNull();
    expect(screen.queryByText('Sul danno ingiusto.')).toBeNull();
  });
  it('shows the traffic light of what an application wrote, and says it in the row\'s name, open or closed (D7b)', () => {
    const reviewed = { ...normaItem, assistantNotes: { proposed: 2, validated: 0, review: 1 } };
    const { unmount } = renderRow(reviewed, { notes });
    expect(screen.getByRole('button', { name: 'Espandi codice civile 262 articolo 2043, 2 note, 2 da validare · 1 da rivedere' })).toBeInTheDocument();
    expect(screen.getByTitle('2 da validare · 1 da rivedere')).toHaveAttribute('data-ai-review', 'review');
    unmount();
    renderRow(reviewed, { notes, isExpanded: true });
    expect(screen.getByRole('button', { name: 'Comprimi codice civile 262 articolo 2043, 2 da validare · 1 da rivedere' })).toBeInTheDocument();
  });

  it('draws no light where the application wrote nothing', () => {
    renderRow({ ...normaItem, assistantNotes: null }, { notes });
    expect(document.querySelector('[data-ai-review]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Espandi codice civile 262 articolo 2043, 2 note' })).toBeInTheDocument();
  });

  it('a note an application wrote, open: its state and its own bin, not a second one (D7b)', () => {
    const onRemoveNote = vi.fn();
    const appNote = { ...notes[0], assistantNote: { state: 'proposed' as const, stateChangedAt: null, reviewComment: null, originalText: 'Sul danno ingiusto.', edited: false, editedAt: null, editedBy: null } };
    render(
      <CurrentDossierContext.Provider value="d1">
        <DossierArticleRow
          item={normaItem} rubrica={null} isSelected={false} showCheckbox={false} onToggleSelect={() => {}} onRemove={() => {}}
          onToggleImportant={() => {}} isExpanded onToggleExpand={() => {}} onOpenOnDashboard={() => {}} showToast={() => {}}
          notes={[appNote, notes[1]]} onRemoveNote={onRemoveNote}
        />
      </CurrentDossierContext.Provider>,
    );
    expect(screen.getByRole('checkbox', { name: "Proposto dall'IA, confermi?" })).toBeInTheDocument();
    const bins = screen.getAllByRole('button', { name: 'Rimuovi nota' });
    expect(bins).toHaveLength(2);
    fireEvent.click(bins[0]);
    expect(onRemoveNote).toHaveBeenCalledWith(appNote);
  });

  it('shows its notes above the text when open, and adds and removes one', () => {
    const onAddNote = vi.fn();
    const onRemoveNote = vi.fn();
    renderRow(normaItem, { notes, isExpanded: true, onAddNote, onRemoveNote });
    const text = screen.getByText('Sul danno ingiusto.');
    expect(text.compareDocumentPosition(screen.getByTestId('reader')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('scritta da Claude Code (applicazione collegata)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Aggiungi una nota all'articolo" }));
    expect(onAddNote).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: 'Rimuovi nota' })[1]);
    expect(onRemoveNote).toHaveBeenCalledWith(notes[1]);
  });
});
