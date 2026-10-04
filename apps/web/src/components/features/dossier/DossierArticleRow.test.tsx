import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// The reader fetches the article; the row's own behaviour is what is under test.
vi.mock('./DossierItemReader', () => ({
  DossierItemReader: () => <div data-testid="reader">testo</div>,
}));

import { DossierArticleRow, type DossierArticleRowProps } from './DossierArticleRow';

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
    renderRow({ ...normaItem, data: { ...normaItem.data, allegato: 'A', numero_articolo: '1' } });
    expect(screen.getByText('All. A')).toBeInTheDocument();
    expect(screen.getByText('art. 1')).toBeInTheDocument();
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
