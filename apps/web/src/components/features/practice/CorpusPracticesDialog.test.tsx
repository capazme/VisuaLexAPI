import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/trashService', () => ({ trashService: { purge: vi.fn(async () => {}) } }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    create: vi.fn(), addItem: vi.fn(), reorderItems: vi.fn(), delete: vi.fn(), updateItem: vi.fn(),
  },
}));

import { dossierService } from '../../../services/dossierService';
import { appStore } from '../../../store/useAppStore';
import { CorpusPracticesDialog } from './CorpusPracticesDialog';
import type { Dossier, DossierItem } from '../../../types';
import { isBoundPractice } from '../../../utils/practice';
import { L24, article } from '../../../utils/__fixtures__/savedWorkspaces';

/** LC60, §5 of the spec: the Corpus's practices left in the browser become pratiche, once, by the user's choice. */

const svc = vi.mocked(dossierService);
const s = () => appStore.getState();

let counter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  counter = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, dossiers: [], lastSyncError: null,
    pendingDossierItemIds: {}, pendingDossierOrders: {}, corpusPracticesPending: false, dossiersLoaded: true,
  });
  svc.create.mockImplementation((async (data: { name: string }) => ({ id: `srv-${data.name}`, name: data.name, created_at: '2026-11-16T00:00:00Z' })) as never);
  svc.addItem.mockImplementation((async () => ({
    id: `srv-i${++counter}`, item_type: 'norm', title: 't', content: {}, position: counter, status: 'unread', created_at: '2026-11-16T00:00:00Z',
  })) as never);
  svc.reorderItems.mockResolvedValue(undefined as never);
  svc.delete.mockResolvedValue({ trashId: 'trash-d', itemCount: 0 } as never);
});
afterEach(() => vi.restoreAllMocks());

/** A practice of the Corpus with articles 5 and 7 of the l. 24/2017, as a browser kept it. */
function corpus(label: string, articles: string[] = ['5', '7']) {
  const id = s().createPractice(label, { custom: true });
  if (articles.length) s().addArticlesToPractice(id, L24, articles.map((n) => article(L24, n)));
  return id;
}
const sameAsRossi: Dossier = {
  id: 'dos-rossi', title: 'Rossi', createdAt: '', kind: 'lavoro',
  items: ['5', '7'].map((n): DossierItem => ({ id: `i-${n}`, addedAt: '', type: 'norma', data: article(L24, n).norma_data })),
} as unknown as Dossier;

/** Three collections (an empty one, one identical to a pratica, a new one), waiting for the riquadro. */
function threeCollections() {
  corpus('Vuota', []);
  corpus('Rossi');
  corpus('IA Act', ['5']);
  appStore.setState({ dossiers: [sameAsRossi], corpusPracticesPending: true });
}

describe('CorpusPracticesDialog (LC60)', () => {
  it('lists only the new collections, all ticked; the empty and the identical ones go without asking', async () => {
    threeCollections();
    render(<CorpusPracticesDialog />);
    const dialog = await screen.findByRole('dialog', { name: 'Le raccolte della Ricerca diventano pratiche' });
    expect(within(dialog).getByText(/Nella Ricerca avevi 1 raccolta di norme e sentenze\./)).toBeInTheDocument();
    const box = within(dialog).getByRole('checkbox', { name: /IA Act/ });
    expect(box).toBeChecked();
    expect(within(dialog).getByText(/1 atto · 1 articolo/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Vuota/)).toBeNull();
    expect(within(dialog).queryByText(/Rossi/)).toBeNull();
    expect(s().practices.map((p) => p.label)).toEqual(['IA Act']);
  });

  it('«Salva come pratiche» saves each ticked collection as a pratica and empties the browser', async () => {
    threeCollections();
    render(<CorpusPracticesDialog />);
    await userEvent.click(await screen.findByRole('button', { name: 'Salva come pratiche' }));
    await waitFor(() => expect(s().corpusPracticesPending).toBe(false));
    expect(svc.create).toHaveBeenCalledTimes(1);
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'IA Act' }));
    expect(s().dossiers.map((d) => d.title).sort()).toEqual(['IA Act', 'Rossi']);
    expect(s().practices).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Non salvare» asks first; confirmed, nothing is saved and the collections go', async () => {
    threeCollections();
    render(<CorpusPracticesDialog />);
    await userEvent.click(await screen.findByRole('button', { name: 'Non salvare' }));
    expect(await screen.findByText('Le raccolte non si potranno recuperare.')).toBeInTheDocument();
    expect(s().practices).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Non salvarle' }));
    await waitFor(() => expect(s().corpusPracticesPending).toBe(false));
    expect(svc.create).not.toHaveBeenCalled();
    expect(s().practices).toEqual([]);
  });

  it('a save with a collection unticked asks first too; the ticked one is saved, the unticked one goes', async () => {
    corpus('Uno', ['5']);
    corpus('Due', ['7']);
    appStore.setState({ corpusPracticesPending: true });
    render(<CorpusPracticesDialog />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /Due/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Salva come pratiche' }));
    expect(await screen.findByText('Le raccolte non spuntate non si potranno recuperare.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Non salvarle' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Salva le spuntate' }));
    await waitFor(() => expect(s().corpusPracticesPending).toBe(false));
    expect(svc.create).toHaveBeenCalledTimes(1);
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Uno' }));
    expect(s().practices).toEqual([]);
  });

  it('a failed save takes nothing away: the riquadro stays, and a retry saves nothing twice', async () => {
    corpus('Uno', ['5']);
    corpus('Due', ['7']);
    appStore.setState({ corpusPracticesPending: true });
    svc.create.mockImplementation((async (data: { name: string }) => {
      if (data.name === 'Due') throw new Error('down');
      return { id: `srv-${data.name}`, name: data.name, created_at: '' };
    }) as never);
    render(<CorpusPracticesDialog />);
    await userEvent.click(await screen.findByRole('button', { name: 'Salva come pratiche' }));
    expect(await screen.findByText(/Non sono riuscito a salvare tutto/)).toBeInTheDocument();
    expect(s().corpusPracticesPending).toBe(true);
    // «Uno» is a pratica now and leaves the list; «Due» is still in the browser and in the riquadro
    expect(s().practices.map((p) => p.label)).toEqual(['Due']);
    expect(screen.getByRole('checkbox', { name: /Due/ })).toBeChecked();
    svc.create.mockImplementation((async (data: { name: string }) => ({ id: `srv-${data.name}`, name: data.name, created_at: '' })) as never);
    await userEvent.click(screen.getByRole('button', { name: 'Salva come pratiche' }));
    await waitFor(() => expect(s().corpusPracticesPending).toBe(false));
    expect(svc.create.mock.calls.map(([d]) => (d as { name: string }).name)).toEqual(['Uno', 'Due', 'Due']);
    expect(s().dossiers.map((d) => d.title).sort()).toEqual(['Due', 'Uno']);
  });

  it('a save still waiting for the server when the wait ends is not a save: the collection stays', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      corpus('Uno', ['5']);
      appStore.setState({ corpusPracticesPending: true });
      svc.addItem.mockImplementation((() => new Promise(() => {})) as never);
      render(<CorpusPracticesDialog />);
      await userEvent.click(await screen.findByRole('button', { name: 'Salva come pratiche' }));
      await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
      expect(await screen.findByText(/Non sono riuscito a salvare tutto/)).toBeInTheDocument();
      expect(s().corpusPracticesPending).toBe(true);
      expect(s().practices.map((p) => p.label)).toEqual(['Uno']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the pratiche to be read: with the list not known, nothing is compared and nothing goes', async () => {
    threeCollections();
    appStore.setState({ dossiersLoaded: false });
    render(<CorpusPracticesDialog />);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(s().practices).toHaveLength(3);
    act(() => appStore.setState({ dossiersLoaded: true }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('with nothing new, no riquadro: the collections go and the browser keeps none', async () => {
    corpus('Vuota', []);
    corpus('Rossi');
    appStore.setState({ dossiers: [sameAsRossi], corpusPracticesPending: true });
    render(<CorpusPracticesDialog />);
    await waitFor(() => expect(s().corpusPracticesPending).toBe(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(s().practices).toEqual([]);
  });

  it('Esc is not an answer, and a pratica\'s reading table is never touched', async () => {
    const bound = s().openDossierPractice(sameAsRossi);
    corpus('Uno', ['5']);
    appStore.setState({ corpusPracticesPending: true });
    render(<CorpusPracticesDialog />);
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Salva come pratiche' }));
    await waitFor(() => expect(s().corpusPracticesPending).toBe(false));
    expect(s().practices.map((p) => p.id)).toEqual([bound]);
    expect(s().practices.every(isBoundPractice)).toBe(true);
  });

  it('nothing waiting, no riquadro', async () => {
    corpus('Una ricerca', ['5']);
    render(<CorpusPracticesDialog />);
    await act(async () => {});
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(s().practices).toHaveLength(1);
  });
});
