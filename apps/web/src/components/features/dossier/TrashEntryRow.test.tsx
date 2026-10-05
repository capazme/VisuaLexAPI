import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TrashEntryRow } from './TrashEntryRow';
import type { TrashEntry } from '../../../services/trashService';
import type { Dossier } from '../../../types';

const base = { clientName: 'Claude Code', deletedAt: '2026-10-04T10:00:00Z', expiresAt: '2026-11-03T10:00:00Z' };
const items: TrashEntry = {
  ...base, id: 't1', kind: 'DOSSIER_ITEMS', dossierId: 'd1', label: 'Ricorso Rossi', itemCount: 3,
  items: [
    { itemType: 'norm', citation: 'art. 3, l. 31 dicembre 2012, n. 247', actCitation: 'l. 31 dicembre 2012, n. 247' },
    { itemType: 'norm', citation: 'art. 25, l. 31 dicembre 2012, n. 247', actCitation: 'l. 31 dicembre 2012, n. 247' },
    { itemType: 'note', citation: null, actCitation: null },
  ],
};
// The agreed shape of a LingoLex entry: live cards come with the MCP round's card PR.
const cards: TrashEntry = {
  ...base, id: 't2', kind: 'LINGO_CARDS', dossierId: null, label: 'Schede LingoLex', itemCount: 4,
  cards: [
    { istituto: 'Contratto', domanda: 'Che cos’è la causa?' },
    { istituto: 'Contratto', domanda: 'Quando è nullo?' },
    { istituto: 'Contratto', domanda: 'Che cos’è la forma?' },
    { istituto: 'Contratto', domanda: 'Chi può annullarlo?' },
  ],
};
const dossierEntry: TrashEntry = { ...base, id: 't3', kind: 'DOSSIER', dossierId: 'd9', label: 'Vecchia pratica', itemCount: 7 };
const dossiers = [{ id: 'd2', title: 'Altra pratica', createdAt: '', items: [], tags: [] }] as Dossier[];

function renderRow(entry: TrashEntry, over: Partial<Parameters<typeof TrashEntryRow>[0]> = {}) {
  const props = {
    entry, showSource: true, dossiers,
    onRestore: vi.fn(async () => ({ kind: 'restored' as const })),
    onPurge: vi.fn(async () => true),
    showToast: vi.fn(),
    ...over,
  };
  render(<ul><TrashEntryRow {...props} /></ul>);
  return props;
}

describe('TrashEntryRow', () => {
  it("says which dossier entries came from, what they were and who removed them", () => {
    renderRow(items);
    expect(screen.getByText('Da «Ricorso Rossi»')).toBeInTheDocument();
    expect(screen.getByText('l. 31 dicembre 2012, n. 247: artt. 3, 25 · 1 nota')).toBeInTheDocument();
    expect(screen.getByText(/Rimosso da Claude Code il 4 ottobre 2026/)).toBeInTheDocument();
  });

  it('names a whole dossier and its size', () => {
    renderRow(dossierEntry);
    expect(screen.getByText('Dossier «Vecchia pratica»')).toBeInTheDocument();
    expect(screen.getByText('7 elementi')).toBeInTheDocument();
  });

  it('shows LingoLex cards by their first questions', () => {
    renderRow(cards);
    expect(screen.getByText('Schede LingoLex (4)')).toBeInTheDocument();
    expect(screen.getByText('«Che cos’è la causa?» · «Quando è nullo?» · «Che cos’è la forma?» e altre 1')).toBeInTheDocument();
  });

  it('asks where to restore when the dossier is gone, then restores there', async () => {
    const onRestore = vi.fn()
      .mockResolvedValueOnce({ kind: 'needs-target', message: 'Il dossier non esiste più: scegli dove ripristinare.' })
      .mockResolvedValueOnce({ kind: 'restored' });
    renderRow(items, { onRestore });
    fireEvent.click(screen.getByRole('button', { name: 'Ripristina Da «Ricorso Rossi»' }));
    await screen.findByText('Il dossier non esiste più: scegli dove ripristinare.');
    fireEvent.change(screen.getByLabelText('Dossier in cui ripristinare'), { target: { value: 'd2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ripristina qui' }));
    await waitFor(() => expect(onRestore).toHaveBeenLastCalledWith(items, 'd2'));
  });

  it('empties an entry only after a danger confirmation', async () => {
    const onPurge = vi.fn(async () => true);
    renderRow(items, { onPurge });
    fireEvent.click(screen.getByRole('button', { name: 'Elimina definitivamente Da «Ricorso Rossi»' }));
    expect(onPurge).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina definitivamente' }));
    await waitFor(() => expect(onPurge).toHaveBeenCalledWith(items));
  });
});
