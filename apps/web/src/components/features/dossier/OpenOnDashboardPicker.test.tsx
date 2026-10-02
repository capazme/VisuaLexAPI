import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { OpenOnDashboardPicker } from './OpenOnDashboardPicker';
import type { NormaGroup } from './dossierUtils';

const group = (over: Partial<NormaGroup>): NormaGroup => ({
  key: 'k', tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16',
  articles: ['1284'], versione: '', data_versione: '', ...over,
});

function renderPicker(groups: NormaGroup[]) {
  return render(<OpenOnDashboardPicker groups={groups} onPick={vi.fn()} onPickAll={vi.fn()} onClose={vi.fn()} />);
}

describe('OpenOnDashboardPicker — two versions of one act', () => {
  const groups = [
    group({ key: 'now' }),
    group({ key: 'past', versione: 'vigente', data_versione: '2007-12-29' }),
  ];

  it('names the version on the row of a past group, and only there', () => {
    renderPicker(groups);
    const rows = screen.getAllByRole('button').filter((b) => /1284/.test(b.textContent ?? ''));
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).queryByText(/Testo al|Testo originale/)).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('Testo al 29/12/2007')).toBeInTheDocument();
  });

  it('says the original text on a group that holds it', () => {
    renderPicker([group({ versione: 'originale' }), group({ key: 'now' })]);
    expect(screen.getByText('Testo originale')).toBeInTheDocument();
  });

  it('does not say that everything opens in one tab, nor that the norms are all different', () => {
    renderPicker(groups);
    expect(screen.queryByText(/in una sola tab/)).not.toBeInTheDocument();
    expect(screen.queryByText(/norme diverse/)).not.toBeInTheDocument();
  });
});
