import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// The toast is a stub that shows its type: what is pinned here is the message and the type the import picks.
vi.mock('../../ui/Toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ui/Toast')>()),
  Toast: ({ message, type, isVisible }: { message: string; type: string; isVisible: boolean }) =>
    isVisible ? <div data-type={type}>{message}</div> : null,
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
  return `/pratiche?import=${encodeDossierShare({ title, items } as unknown as Dossier)}`;
}

async function importWith(items: unknown[], outcome: unknown, url = link(items)) {
  const importDossier = vi.fn(async () => outcome);
  appStore.setState({ dossiers: [], importDossier } as never);
  render(<MemoryRouter initialEntries={[url]}><DossierPage /></MemoryRouter>);
  const region = await screen.findByRole('region', { name: 'Importa una pratica' });
  fireEvent.click(within(region).getByRole('button', { name: 'Importa' }));
  return { importDossier, region };
}

/** What the import says in its own space (its status line), not in a notification. */
const said = (region: HTMLElement) => within(region).getByRole('status');

beforeEach(() => { vi.clearAllMocks(); });

describe('DossierPage: after an import', () => {
  it('opens the dossier and says "Pratica importata" as a success when nothing was lost', async () => {
    const { importDossier } = await importWith([note], { id: 'srv', imported: 1, failed: 0 });
    const toast = await screen.findByText('Pratica importata');
    expect(toast).toHaveAttribute('data-type', 'success');
    expect(importDossier).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region', { name: 'Importa una pratica' })).toBeNull();
  });

  it('says in the page what the check left out together with what the server refused', async () => {
    const { importDossier, region } = await importWith([note, badDecision], { id: 'srv', imported: 1, failed: 1 });
    await waitFor(() => expect(said(region)).toHaveTextContent('Pratica importata in parte: 1 voce importata, 2 scartate'));
    expect(within(region).getByRole('button', { name: 'Apri la pratica' })).toBeInTheDocument();
    // the dossier sent to the store holds only what passed the check
    expect(vi.mocked(importDossier).mock.calls[0]).toMatchObject([{ items: [{ id: 'n' }] }]);
    expect((vi.mocked(importDossier).mock.calls[0] as unknown as [{ items: unknown[] }])[0].items).toHaveLength(1);
  });

  it('says how many items came in when the server refused the rest at its cap (409, G-576), in its words', async () => {
    const words = 'Una pratica può contenere al massimo 2.000 voci. Questa ne ha già 2.000.';
    const { region } = await importWith([note, note, note], { id: 'srv', imported: 1, failed: 2, refusals: [words] });
    await waitFor(() => expect(said(region)).toHaveTextContent(`Pratica importata in parte: 1 voce importata, 2 scartate. ${words}`));
  });

  it('says the server\'s words when the dossier itself was refused at the cap', async () => {
    const words = 'Hai raggiunto il limite di 500 pratiche: eliminane qualcuna per crearne di nuove.';
    const { region } = await importWith([note], { refused: words });
    await waitFor(() => expect(said(region)).toHaveTextContent(`Pratica non importata. ${words}`));
    expect(within(region).queryByRole('button', { name: 'Apri la pratica' })).toBeNull();
  });

  it('says the server failed when the dossier itself could not be created', async () => {
    const { region } = await importWith([note], null);
    await waitFor(() => expect(said(region)).toHaveTextContent('Impossibile importare la pratica: errore server'));
  });
});

describe('DossierPage: the import in the page (LC107, L-73)', () => {
  it('opens at the top of the list, with no dialog, and Esc closes it', async () => {
    appStore.setState({ dossiers: [], importDossier: vi.fn() } as never);
    render(<MemoryRouter initialEntries={[link([note])]}><DossierPage /></MemoryRouter>);
    const region = await screen.findByRole('region', { name: 'Importa una pratica' });
    expect(region.compareDocumentPosition(screen.getByRole('textbox', { name: 'Cerca nelle pratiche' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(within(region).getByRole('button', { name: 'Importa' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Importa una pratica' })).toBeNull();
  });

  it('gives the focus back to the command that chose the file', async () => {
    appStore.setState({ dossiers: [], importDossier: vi.fn() } as never);
    const { container } = render(<MemoryRouter initialEntries={['/pratiche']}><DossierPage /></MemoryRouter>);
    // On a phone (jsdom's width) «Importa da file JSON» is in «⋯»: the menu gives the focus back to «⋯».
    const more = screen.getByRole('button', { name: 'Altre azioni sulle pratiche' });
    fireEvent.click(more);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Importa da file JSON' }));
    expect(more).toHaveFocus();
    const json = JSON.stringify({ title: 'Da file', items: [note] });
    const file = new File([json], 'pratica.json', { type: 'application/json' });
    // jsdom's File has no `text()`.
    Object.defineProperty(file, 'text', { value: async () => json });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    const region = await screen.findByRole('region', { name: 'Importa una pratica' });
    expect(region).toHaveFocus();
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(more).toHaveFocus();
  });
});

describe('DossierPage: share links', () => {
  it('imports a dossier whose title holds a typographic apostrophe', async () => {
    const { importDossier } = await importWith([note], { id: 'srv', imported: 1, failed: 0 }, link([note], 'L’azione revocatoria'));
    expect(vi.mocked(importDossier).mock.calls[0]).toMatchObject([{ title: 'L’azione revocatoria' }]);
  });

  it('still imports a link made before the UTF-8 links', async () => {
    const old = `/pratiche?import=${encodeURIComponent(btoa(JSON.stringify({ title: 'Perché', items: [note] })))}`;
    const { importDossier } = await importWith([note], { id: 'srv', imported: 1, failed: 0 }, old);
    expect(vi.mocked(importDossier).mock.calls[0]).toMatchObject([{ title: 'Perché' }]);
  });
});
