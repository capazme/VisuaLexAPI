import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/trashService', () => ({ trashService: { purge: vi.fn(async () => {}) } }));
vi.mock('../../../services/dossierService', () => ({
  dossierService: {
    create: vi.fn(), addItem: vi.fn(), reorderItems: vi.fn(), delete: vi.fn(), updateItem: vi.fn(), deleteItem: vi.fn(),
  },
}));

import { dossierService } from '../../../services/dossierService';
import { trashService } from '../../../services/trashService';
import { appStore } from '../../../store/useAppStore';
import { useSavePracticeAsDossier } from './useSavePracticeAsDossier';
import { searchesIntoOnePractice } from '../dossier/openInPractice';
import { computeNormaGroups } from '../dossier/dossierUtils';
import type { Dossier, DossierSentenzaData } from '../../../types';
import { CC_BARE, CC_RD, L24, L241, article } from '../../../utils/__fixtures__/savedWorkspaces';

const svc = vi.mocked(dossierService);
const s = () => appStore.getState();

let counter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  counter = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  appStore.setState({
    practices: [], activePracticeId: null, practiceRows: {}, dossiers: [], lastSyncError: null,
    pendingDossierItemIds: {}, pendingDossierOrders: {},
  });
  svc.create.mockResolvedValue({ id: 'srv-d', name: 'x', created_at: '2026-10-12T00:00:00Z' } as never);
  svc.addItem.mockImplementation((async () => ({
    id: `srv-${++counter}`, item_type: 'norm', title: 't', content: {}, position: counter, status: 'unread', created_at: '2026-10-12T00:00:00Z',
  })) as never);
  svc.reorderItems.mockResolvedValue(undefined as never);
  svc.delete.mockResolvedValue({ trashId: 'trash-d', itemCount: 0 } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function practiceWithWork() {
  const id = s().createPractice('Responsabilità medica');
  s().addArticlesToPractice(id, L241, [article(L241, '2'), article(L241, '3')]);
  s().addArticlesToPractice(id, L24, [article(L24, '5'), article(L24, '7', { versione: 'originale', data_versione: '2017-03-08' })]);
  s().openDecision({ corte: 'cassazione', numero: 100, anno: 2020 }, { practiceId: id, open: false });
  s().openDecision({ corte: 'cassazione', numero: 200, anno: 2021 }, { practiceId: id, open: false });
  appStore.setState((st) => {
    st.practices.find((p) => p.id === id)!.decisions.forEach((d) => { d.identified = true; });
  });
  return id;
}

describe('useSavePracticeAsDossier (spec §7)', () => {
  it('a new dossier: created first, every item added, the order written once, the toast counting them', async () => {
    const id = practiceWithWork();
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(id); });
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Responsabilità medica' }));
    expect(svc.addItem).toHaveBeenCalledTimes(6);
    expect(svc.reorderItems).toHaveBeenCalledTimes(1);
    expect(svc.reorderItems.mock.calls[0][1]).toHaveLength(6);
    expect(s().dossiers[0].items).toHaveLength(6);
    expect(result.current.notice?.message).toBe('Salvato nel dossier «Responsabilità medica»: 4 articoli, 2 sentenze');
    expect(result.current.notice?.type).toBe('success');
    // the practice is not linked and not touched
    expect(s().practices).toHaveLength(1);
  });

  it('a past text and the text in force are two items, the past one with its version', async () => {
    const id = s().createPractice('P');
    s().addArticlesToPractice(id, L24, [article(L24, '5'), article(L24, '5', { versione: 'originale', data_versione: '2017-03-08' })]);
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(id); });
    const items = s().dossiers[0].items;
    expect(items).toHaveLength(2);
    expect(items.some((i) => i.type === 'norma' && i.data.data_versione === '2017-03-08')).toBe(true);
  });

  it('a refused dossier adds nothing, keeps the practice and shows the sync error', async () => {
    const id = practiceWithWork();
    svc.create.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(id); });
    expect(svc.addItem).not.toHaveBeenCalled();
    expect(svc.reorderItems).not.toHaveBeenCalled();
    expect(s().dossiers).toHaveLength(0);
    expect(s().practices[0].acts).toHaveLength(2);
    expect(s().lastSyncError?.message).toBe('Impossibile creare il dossier. Riprova.');
  });

  it('every add refused: the empty dossier is removed again and an Italian sync error shown', async () => {
    const id = practiceWithWork();
    svc.addItem.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(id); });
    expect(svc.delete).toHaveBeenCalledWith('srv-d');
    // The user deleted nothing: the empty dossier does not stay in their trash.
    await vi.waitFor(() => expect(trashService.purge).toHaveBeenCalledWith('trash-d'));
    expect(s().dossiers).toHaveLength(0);
    expect(s().lastSyncError?.message).toContain('nessun elemento è stato salvato');
    expect(result.current.notice).toBeNull();
  });

  it('some adds refused: the dossier is kept, the error counts what is missing', async () => {
    const id = practiceWithWork();
    let n = 0;
    svc.addItem.mockImplementation((async () => {
      n += 1;
      if (n === 2) throw new Error('boom');
      return { id: `srv-${n}`, item_type: 'norm', title: 't', content: {}, position: n, status: 'unread', created_at: '2026-10-12T00:00:00Z' };
    }) as never);
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(id); });
    expect(svc.delete).not.toHaveBeenCalled();
    expect(s().dossiers[0].items).toHaveLength(5);
    expect(s().lastSyncError?.message).toContain('1 elemento non è stato salvato');
    expect(result.current.notice?.type).toBe('warning');
  });

  it('an unidentified decision is counted, not saved', async () => {
    const id = s().createPractice('P');
    s().addArticlesToPractice(id, L24, [article(L24, '5')]);
    s().openDecision({ corte: 'cassazione', numero: 9, anno: 2019 }, { practiceId: id, open: false });
    appStore.setState((st) => { st.practices[0].decisions[0].identified = false; });
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(id); });
    expect(svc.addItem).toHaveBeenCalledTimes(1);
    expect(result.current.notice?.message).toBe(
      'Salvato nel dossier «P»: 1 articolo. 1 sentenza non identificata non è stata salvata',
    );
  });

  it('nothing to save creates no dossier', async () => {
    const id = s().createPractice('Vuota');
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(id); });
    expect(svc.create).not.toHaveBeenCalled();
    expect(result.current.notice?.message).toBe('La pratica non ha nulla da salvare.');
  });

  it('an existing dossier: what it holds is skipped and counted, nothing is reordered', async () => {
    const id = practiceWithWork();
    appStore.setState({
      dossiers: [{
        id: 'd1', title: 'Esistente', createdAt: '2026-10-01T00:00:00Z',
        items: [
          { id: 'i1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'legge', numero_atto: '241', data: '1990-08-07', numero_articolo: '2', versione: 'vigente' } },
          { id: 'i2', type: 'sentenza', addedAt: 'x', data: { corte: 'cassazione', numero: 100, anno: 2020, etichetta: 'Cass. 100/2020' } },
        ],
      }] as never,
    });
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.addToExisting(id, 'd1'); });
    expect(svc.create).not.toHaveBeenCalled();
    expect(svc.addItem).toHaveBeenCalledTimes(4);
    expect(svc.reorderItems).not.toHaveBeenCalled();
    expect(result.current.notice?.message).toBe('Salvato nel dossier «Esistente»: 3 articoli, 1 sentenza. 2 già presenti');
  });

  it('an existing dossier refusing every add: the message says nothing was saved, not «in parte»', async () => {
    const id = s().createPractice('P');
    s().addArticlesToPractice(id, L24, [article(L24, '5'), article(L24, '7')]);
    appStore.setState({ dossiers: [{ id: 'd1', title: 'Esistente', createdAt: 'x', items: [] }] as never });
    svc.addItem.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.addToExisting(id, 'd1'); });
    expect(svc.delete).not.toHaveBeenCalled();
    expect(result.current.notice).toEqual({ message: 'Nessun elemento è stato salvato nel dossier «Esistente»', type: 'error' });
    expect(s().lastSyncError?.message).toContain('2 elementi non sono stati salvati');
  });

  it('a code article saved from a search is found again from its index copy, and a practice holding both saves one item', async () => {
    const id = s().createPractice('Codice');
    s().addArticlesToPractice(id, CC_BARE, [article(CC_BARE, '2043')]);
    s().addArticlesToPractice(id, CC_RD, [article(CC_RD, '2043', { allegato: '2' })]);
    expect(s().practices[0].acts).toHaveLength(1);
    expect(s().practices[0].acts[0].articles).toHaveLength(2);
    appStore.setState({
      dossiers: [{
        id: 'd1', title: 'Esistente', createdAt: 'x',
        items: [{ id: 'i1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'codice civile', numero_atto: '262', data: '1942-03-16', numero_articolo: '2043', allegato: '2', versione: 'vigente' } }],
      }] as never,
    });
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.addToExisting(id, 'd1'); });
    expect(svc.addItem).not.toHaveBeenCalled();
    expect(result.current.notice?.message).toBe('Il dossier «Esistente» ha già tutto: 1 già presente');

    await act(async () => { await result.current.saveAsNew(id); });
    expect(svc.addItem).toHaveBeenCalledTimes(1);
    expect(s().dossiers.find((d) => d.id !== 'd1')?.items.map((i) => i.data)).toEqual([
      expect.objectContaining({ numero_atto: '262', data: '1942-03-16', allegato: '2', numero_articolo: '2043' }),
    ]);
  });

  it('one save at a time per practice: a second start while the first runs does nothing', async () => {
    const id = practiceWithWork();
    const first = renderHook(() => useSavePracticeAsDossier());
    const second = renderHook(() => useSavePracticeAsDossier());
    await act(async () => {
      await Promise.all([first.result.current.saveAsNew(id), second.result.current.saveAsNew(id)]);
    });
    expect(svc.create).toHaveBeenCalledTimes(1);
    expect(s().dossiers).toHaveLength(1);
    expect(second.result.current.notice).toBeNull();
  });

  it('an existing dossier that holds everything says so and adds nothing', async () => {
    const id = s().createPractice('P');
    s().addArticlesToPractice(id, L24, [article(L24, '5')]);
    appStore.setState({
      dossiers: [{
        id: 'd1', title: 'Esistente', createdAt: 'x',
        items: [{ id: 'i1', type: 'norma', addedAt: 'x', data: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: '5', versione: 'vigente' } }],
      }] as never,
    });
    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.addToExisting(id, 'd1'); });
    expect(svc.addItem).not.toHaveBeenCalled();
    expect(result.current.notice?.message).toBe('Il dossier «Esistente» ha già tutto: 1 già presente');
  });
});

describe('«Apri tutto» of a dossier, then «Salva come dossier» (spec §5.1, §7, T17)', () => {
  it('the dossier\'s decisions, entered closed and unread, are saved back with what the dossier kept', async () => {
    const kept: DossierSentenzaData = {
      corte: 'cassazione', archivio: 'civile', numero: 28994, anno: 2019, sezione: '3', tipo: 'sentenza', data_deposito: '2019-11-11',
      etichetta: 'Cass. civ., sez. III, 11 novembre 2019, n. 28994',
    };
    const dossier: Dossier = {
      id: 'd0', title: 'Ricorso Rossi', createdAt: '2026-10-04T08:00:00Z', tags: [],
      items: [
        { id: 'a', type: 'norma', addedAt: '', data: { tipo_atto: 'legge', numero_atto: '24', data: '2017-03-08', numero_articolo: '5' } },
        { id: 's1', type: 'sentenza', addedAt: '', data: kept },
        { id: 's2', type: 'sentenza', addedAt: '', data: { corte: 'corte_costituzionale', numero: 1, anno: 2020, etichetta: 'Corte cost., n. 1/2020' } },
      ],
    };
    const writes: number[] = [];
    const unsubscribe = appStore.subscribe((state) => writes.push(state.practices.length));
    searchesIntoOnePractice(dossier, computeNormaGroups(dossier.items), true);
    unsubscribe();
    // the practice, then every decision in one more write
    expect(writes).toEqual([1, 1]);
    const [practice] = s().practices;
    expect(practice.decisions.every((d) => d.identified)).toBe(true);

    const { result } = renderHook(() => useSavePracticeAsDossier());
    await act(async () => { await result.current.saveAsNew(practice.id); });
    const saved = s().dossiers[0].items.filter((i) => i.type === 'sentenza').map((i) => i.data);
    expect(saved).toHaveLength(2);
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ corte: 'cassazione', archivio: 'civile', numero: 28994, anno: 2019, sezione: '3', tipo: 'sentenza', data_deposito: '2019-11-11' }),
      expect.objectContaining({ corte: 'corte_costituzionale', numero: 1, anno: 2020 }),
    ]));
    expect(result.current.notice?.message).toBe('Salvato nel dossier «Ricorso Rossi»: 2 sentenze');
  });
});
