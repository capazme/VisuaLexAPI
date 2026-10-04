import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DossierArticleRow, type DossierArticleRowProps } from './DossierArticleRow';

type NormaItem = DossierArticleRowProps['item'];

const item = (data: Partial<NormaItem['data']> = {}): NormaItem => ({
  id: 'i1', type: 'norma', addedAt: '2026-08-01T10:00:00.000Z',
  data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '1284', ...data },
});

function renderRow(row: NormaItem) {
  return render(
    <DossierArticleRow
      item={row} rubrica={null} isSelected={false} showCheckbox={false}
      onToggleSelect={() => {}} onRemove={() => {}} onToggleImportant={() => {}}
      isExpanded={false} onToggleExpand={() => {}}
      onOpenOnDashboard={() => {}} showToast={() => {}}
    />,
  );
}

describe('DossierArticleRow — a past text', () => {
  it('says which day an item that holds a past text was asked for', () => {
    renderRow(item({ versione: 'vigente', data_versione: '2007-12-29' }));
    expect(screen.getByText('Testo al 29/12/2007')).toBeInTheDocument();
  });

  it('names the version in the row\'s accessible name, so two versions of one article read differently', () => {
    renderRow(item({ versione: 'vigente', data_versione: '2007-12-29' }));
    expect(screen.getByLabelText(/^Espandi codice civile 262 articolo 1284, testo al 29\/12\/2007$/)).toBeInTheDocument();
  });

  it('leaves the accessible name of the text in force as it was', () => {
    renderRow(item({}));
    expect(screen.getByLabelText('Espandi codice civile 262 articolo 1284')).toBeInTheDocument();
  });

  it('says it holds the original text', () => {
    renderRow(item({ versione: 'originale' }));
    expect(screen.getByText('Testo originale')).toBeInTheDocument();
  });

  it.each([
    ['an item saved before versions were kept', {}],
    ['the text in force', { versione: 'vigente', data_versione: '' }],
  ])('says nothing on %s', (_name, data) => {
    renderRow(item(data));
    expect(screen.queryByText(/Testo al|Testo originale/)).not.toBeInTheDocument();
  });
});
