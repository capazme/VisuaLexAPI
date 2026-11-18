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
  const importDossier = vi.fn<(dossier: Dossier, options?: unknown) => Promise<unknown>>(async () => outcome);
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
    expect(vi.mocked(importDossier).mock.calls[0][0]).toMatchObject({ items: [{ id: 'n' }] });
    expect((vi.mocked(importDossier).mock.calls[0] as unknown as [{ items: unknown[] }])[0].items).toHaveLength(1);
  });

  it('says in the page when nothing came in, and still offers the dossier made', async () => {
    const { region } = await importWith([badDecision], { id: 'srv', imported: 0, failed: 0 });
    await waitFor(() => expect(said(region)).toHaveTextContent('Pratica importata in parte: 0 voci importate, 1 scartata'));
    // The pressed «Importa» is gone: the focus is on what comes next.
    expect(within(region).getByRole('button', { name: 'Apri la pratica' })).toHaveFocus();
  });

  it('does not close on Esc while the server works, so its outcome is still said', async () => {
    let answer: (value: unknown) => void = () => {};
    const importDossier = vi.fn(() => new Promise((resolve) => { answer = resolve; }));
    appStore.setState({ dossiers: [], importDossier } as never);
    render(<MemoryRouter initialEntries={[link([note])]}><DossierPage /></MemoryRouter>);
    const region = await screen.findByRole('region', { name: 'Importa una pratica' });
    fireEvent.click(within(region).getByRole('button', { name: 'Importa' }));
    expect(said(region)).toHaveTextContent('Importo la pratica: 0 voci entrate su 1…');
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Importa una pratica' })).toBe(region);
    answer({ id: 'srv', imported: 0, failed: 1 });
    await waitFor(() => expect(said(region)).toHaveTextContent('Pratica importata in parte: 0 voci importate, 1 scartata'));
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

describe('DossierPage: an import stopped by the server\'s write limit (429)', () => {
  it('says why it stopped and «Riprendi» goes on from the items left, into the same dossier', async () => {
    const { importDossier, region } = await importWith([note, note, note], { id: 'srv', imported: 1, failed: 0, next: 1 });
    await waitFor(() => expect(said(region)).toHaveTextContent(
      'Import interrotto, il server ha chiesto di rallentare: 1 voce entrata su 3, 2 non ancora importate. «Riprendi» continua dalle voci rimaste, nella stessa pratica.',
    ));
    const resume = within(region).getByRole('button', { name: 'Riprendi: 2 voci' });
    expect(resume).toHaveFocus();
    vi.mocked(importDossier).mockResolvedValueOnce({ id: 'srv', imported: 2, failed: 0 });
    fireEvent.click(resume);
    // All in now: the dossier opens, as a whole import does.
    expect(await screen.findByText('Pratica importata')).toHaveAttribute('data-type', 'success');
    expect(vi.mocked(importDossier).mock.calls[1]).toMatchObject([expect.anything(), { resume: { id: 'srv', from: 1 } }]);
  });
});

describe('DossierPage: an import stopped by a lost connection', () => {
  it('says «Connessione persa», counts nothing as scartate, offers «Riprendi», and asks before the page is left', async () => {
    let answer: (value: unknown) => void = () => {};
    const importDossier = vi.fn<(dossier: Dossier, options?: unknown) => Promise<unknown>>(() => new Promise((resolve) => { answer = resolve; }));
    appStore.setState({ dossiers: [], importDossier } as never);
    render(<MemoryRouter initialEntries={[link([note, note, note])]}><DossierPage /></MemoryRouter>);
    const region = await screen.findByRole('region', { name: 'Importa una pratica' });
    fireEvent.click(within(region).getByRole('button', { name: 'Importa' }));
    expect(within(region).getByText('Se lasci la pagina l’importazione si ferma.')).toBeInTheDocument();
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    answer({ id: 'srv', imported: 1, failed: 0, next: 1, stopped: 'network' });
    await waitFor(() => expect(said(region)).toHaveTextContent(
      'Connessione persa: 1 voce entrata su 3, 2 non ancora importate. «Riprendi» continua dalle voci rimaste, nella stessa pratica.',
    ));
    expect(said(region)).not.toHaveTextContent('scartat');
    expect(within(region).getByRole('button', { name: 'Riprendi: 2 voci' })).toHaveFocus();
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

describe('DossierPage: the import in the page (LC107, L-73)', () => {
  it('says «Qualcuno ha condiviso una pratica con te» for a link only, not for a file the user chose', async () => {
    appStore.setState({ dossiers: [], importDossier: vi.fn() } as never);
    const { unmount } = render(<MemoryRouter initialEntries={[link([note])]}><DossierPage /></MemoryRouter>);
    expect(await screen.findByText('Qualcuno ha condiviso una pratica con te')).toBeInTheDocument();
    unmount();
    const { container } = render(<MemoryRouter initialEntries={['/pratiche']}><DossierPage /></MemoryRouter>);
    const json = JSON.stringify({ title: 'Da file', items: [note] });
    const file = new File([json], 'pratica.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => json });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await screen.findByRole('region', { name: 'Importa una pratica' });
    expect(screen.queryByText('Qualcuno ha condiviso una pratica con te')).toBeNull();
  });

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
    expect(vi.mocked(importDossier).mock.calls[0][0]).toMatchObject({ title: 'L’azione revocatoria' });
  });

  it('still imports a link made before the UTF-8 links', async () => {
    const old = `/pratiche?import=${encodeURIComponent(btoa(JSON.stringify({ title: 'Perché', items: [note] })))}`;
    const { importDossier } = await importWith([note], { id: 'srv', imported: 1, failed: 0 }, old);
    expect(vi.mocked(importDossier).mock.calls[0][0]).toMatchObject({ title: 'Perché' });
  });
});
