import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddPassageToPratica } from '../AddPassageToPratica';
import { passageNote } from '../passageNote';
import { appStore } from '../../../../store/useAppStore';
import type { Dossier } from '../../../../types';
import type { RassegnePasso } from '../types';

const notify = vi.fn();
vi.mock('../../../ui/notifications/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ui/notifications/notifications')>()),
  notify: (...args: unknown[]) => notify(...args),
}));

/** An invented passage: no text of the reviews enters the repository. */
const PASSO: RassegnePasso = {
  id: 'a', anno: 2024, archivio: 'civile',
  volume: { id: 1, numero: 1, titolo: 'Massimario 2024 CIVILE Vol. 1' },
  parte: null, capitolo: { nome: 'CAPITOLO I', titolo: 'LA RESPONSABILITÀ' },
  sezione: { id: 1, numero: '2', titolo: 'Il danno.' },
  autori: [], url: 'https://example.invalid/rassegne/a', testo: 'Il danno è risarcibile.',
  evidenziazioni: [], pronunce: [], fonte: 'Ufficio del Massimario',
};

const PRATICA: Dossier = { id: 'd1', title: 'Rossi c. ASL', createdAt: '2026-11-01T00:00:00Z', items: [] };

describe('AddPassageToPratica', () => {
  const addNoteToDossier = vi.fn();
  const addToDossier = vi.fn();
  beforeEach(() => {
    notify.mockReset();
    addNoteToDossier.mockReset();
    addToDossier.mockReset();
    appStore.setState({ dossiers: [PRATICA], addNoteToDossier, addToDossier });
  });

  it('puts the passage in the pratica chosen as a note, and says where with a link to it', async () => {
    addNoteToDossier.mockResolvedValue(true);
    render(<MemoryRouter><AddPassageToPratica passo={PASSO} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica' }));
    await userEvent.click(await screen.findByRole('button', { name: /Rossi c\. ASL/ }));
    expect(addNoteToDossier).toHaveBeenCalledWith('d1', passageNote(PASSO));
    expect(addToDossier).not.toHaveBeenCalled(); // a note, never an entry of a new kind
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'success',
      message: 'Passo aggiunto come nota a «Rossi c. ASL»',
      action: expect.objectContaining({ label: 'Apri la pratica' }),
    })));
  });

  it('says nothing of its own when the note was not saved: the store already said so', async () => {
    addNoteToDossier.mockResolvedValue(false);
    render(<MemoryRouter><AddPassageToPratica passo={PASSO} /></MemoryRouter>);
    await userEvent.click(screen.getByRole('button', { name: 'Aggiungi alla pratica' }));
    await userEvent.click(await screen.findByRole('button', { name: /Rossi c\. ASL/ }));
    await waitFor(() => expect(addNoteToDossier).toHaveBeenCalled());
    expect(notify).not.toHaveBeenCalled();
  });
});
