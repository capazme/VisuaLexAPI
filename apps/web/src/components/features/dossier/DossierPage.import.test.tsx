import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';

// The toast is a stub that shows its type: what is pinned here is the message and the type DossierPage picks.
vi.mock('../../ui/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/Toast')>()),
  Toast: ({ message, type, isVisible }: { message: string; type: string; isVisible: boolean }) =>
    isVisible ? <div role="status" data-type={type}>{message}</div> : null,
}));
vi.mock('../../../hooks/useTour', () => ({ useTour: () => ({ tryStartTour: vi.fn() }) }));
vi.mock('../../../services/trashService', () => ({ trashService: { list: vi.fn(async () => []), restore: vi.fn(), purge: vi.fn() } }));

import { appStore } from '../../../store/useAppStore';
import { DossierPage } from './DossierPage';
import { encodeDossierShare } from './dossierUtils';
import type { Dossier } from '../../../types';

const SENTENZA = { corte: 'corte_costituzionale', numero: 1, anno: 2014, etichetta: 'x' };
const note = { id: 'n', type: 'note', data: 'appunto', addedAt: '' };
const badDecision = { id: 'b', type: 'sentenza', data: { ...SENTENZA, corte: 'tar' }, addedAt: '' };

function link(items: unknown[], title = 'Da link') {
  return `/dossier?import=${encodeDossierShare({ title, items } as unknown as Dossier)}`;
}

async function importWith(items: unknown[], outcome: { id: string; imported: number; failed: number } | null, url = link(items)) {
  const importDossier = vi.fn(async () => outcome);
  appStore.setState({ dossiers: [], importDossier });
  render(<MemoryRouter initialEntries={[url]}><DossierPage /></MemoryRouter>);
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

describe('DossierPage: share links', () => {
  it('imports a dossier whose title holds a typographic apostrophe', async () => {
    const { importDossier } = await importWith([note], { id: 'srv', imported: 1, failed: 0 }, link([note], 'L’azione revocatoria'));
    expect(vi.mocked(importDossier).mock.calls[0]).toMatchObject([{ title: 'L’azione revocatoria' }]);
  });

  it('still imports a link made before the UTF-8 links', async () => {
    const old = `/dossier?import=${encodeURIComponent(btoa(JSON.stringify({ title: 'Perché', items: [note] })))}`;
    const { importDossier } = await importWith([note], { id: 'srv', imported: 1, failed: 0 }, old);
    expect(vi.mocked(importDossier).mock.calls[0]).toMatchObject([{ title: 'Perché' }]);
  });
});

describe('DossierPage: «Importa» opens the file picker', () => {
  const picker = () => document.querySelector<HTMLInputElement>('[data-testid="dossier-import-input"]')!;
  const importButton = () => screen.findByRole('button', { name: 'Importa dossier da file JSON' });

  function renderList() {
    appStore.setState({ dossiers: [], importDossier: vi.fn(async () => ({ id: 'srv', imported: 1, failed: 0 })) });
    render(<MemoryRouter initialEntries={['/dossier']}><DossierPage /></MemoryRouter>);
  }

  it('starts the picker itself on a click, with Enter and with Space, from an input beside the button', async () => {
    renderList();
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    try {
      const button = await importButton();
      await userEvent.click(button);
      button.focus();
      await userEvent.keyboard('{Enter}');
      await userEvent.keyboard(' ');
      expect(click).toHaveBeenCalledTimes(3);
      expect(click.mock.contexts.every(context => context === picker())).toBe(true);
      // No dialog comes before the picker: the import's preview opens on the file read.
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button.contains(picker())).toBe(false);
      expect(picker()).toHaveClass('sr-only');
      expect(picker()).not.toHaveClass('hidden');
    } finally {
      click.mockRestore();
    }
  });

  it('opens the preview of the file chosen, and again for the same file chosen twice', async () => {
    renderList();
    await importButton();
    const json = JSON.stringify({ title: 'Dal file', items: [note] });
    // jsdom's File has no text().
    const file = Object.assign(new File([json], 'dossier.json', { type: 'application/json' }), { text: async () => json });
    await userEvent.upload(picker(), file);
    expect(await screen.findByRole('heading', { name: 'Dal file' })).toBeInTheDocument();
    expect(picker().value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Dal file' })).toBeNull());
    await userEvent.upload(picker(), file);
    expect(await screen.findByRole('heading', { name: 'Dal file' })).toBeInTheDocument();
  });
});
