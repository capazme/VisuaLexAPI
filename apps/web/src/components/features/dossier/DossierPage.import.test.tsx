import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The toast is a stub that shows its type: what is pinned here is the message and the type DossierPage picks.
vi.mock('../../ui/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/Toast')>()),
  Toast: ({ message, type, isVisible }: { message: string; type: string; isVisible: boolean }) =>
    isVisible ? <div role="status" data-type={type}>{message}</div> : null,
}));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));

import { appStore } from '../../../store/useAppStore';
import { DossierPage } from './DossierPage';

const SENTENZA = { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'x' };
const note = { id: 'n', type: 'note', data: 'appunto', addedAt: '' };
const badDecision = { id: 'b', type: 'sentenza', data: { ...SENTENZA, corte: 'tar' }, addedAt: '' };

function link(items: unknown[]) {
  return `/dossier?import=${encodeURIComponent(btoa(JSON.stringify({ title: 'Da link', items })))}`;
}

async function importWith(items: unknown[], outcome: { id: string; imported: number; failed: number } | null) {
  const importDossier = vi.fn(async () => outcome);
  appStore.setState({ dossiers: [], importDossier });
  render(<MemoryRouter initialEntries={[link(items)]}><DossierPage /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Importa' }));
  const status = await screen.findByRole('status');
  return { importDossier, status };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('DossierPage: the toast after an import', () => {
  it('says "Dossier importato" as a success when nothing was lost', async () => {
    const { importDossier, status } = await importWith([note], { id: 'srv', imported: 1, failed: 0 });
    expect(status).toHaveTextContent('Dossier importato');
    expect(status).toHaveAttribute('data-type', 'success');
    expect(importDossier).toHaveBeenCalledOnce();
  });

  it('counts what the check left out together with what the server refused', async () => {
    const { importDossier, status } = await importWith([note, badDecision], { id: 'srv', imported: 1, failed: 1 });
    expect(status).toHaveTextContent('Dossier importato in parte: 1 voce importata, 2 scartate');
    expect(status).toHaveAttribute('data-type', 'info');
    // the dossier sent to the store holds only what passed the check
    expect(vi.mocked(importDossier).mock.calls[0]).toMatchObject([{ items: [{ id: 'n' }] }]);
    expect((vi.mocked(importDossier).mock.calls[0] as unknown as [{ items: unknown[] }])[0].items).toHaveLength(1);
  });

  it('is a warning when nothing came in', async () => {
    const { status } = await importWith([badDecision], { id: 'srv', imported: 0, failed: 0 });
    expect(status).toHaveTextContent('Dossier importato in parte: 0 voci importate, 1 scartata');
    expect(status).toHaveAttribute('data-type', 'warning');
  });

  it('says the server failed when the dossier itself could not be created', async () => {
    const { status } = await importWith([note], null);
    await waitFor(() => expect(status).toHaveTextContent('Impossibile importare il dossier: errore server'));
    expect(status).toHaveAttribute('data-type', 'error');
  });
});
