import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/dossierService', () => ({
  dossierService: {
    getAll: vi.fn(async () => []),
    getById: vi.fn(async () => ({})),
    create: vi.fn(async () => ({ id: 'srv-1', name: 'Pratica', items: [], created_at: '2026-08-25T00:00:00Z', updated_at: '2026-08-25T00:00:00Z' })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => {}),
    addItem: vi.fn(async () => ({ id: 'item-srv-1' })),
    updateItem: vi.fn(async () => ({})),
    deleteItem: vi.fn(async () => {}),
    reorderItems: vi.fn(async () => {}),
  },
}));

// NOTE: `useAppStore` (default export target per the task brief) is a React-hook
// wrapper around the vanilla zustand store in this codebase — it has no
// `getState`/`setState` of its own. The vanilla store instance is the
// separately-exported `appStore` (see e.g. WorkspaceTabPanel.tsx, useAuth.ts),
// so tests that need direct state access use that instead.
import { appStore } from './useAppStore';
import { dossierService, type DossierItemApi } from '../services/dossierService';

const norma = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043' };

// Minimal but fully-typed DossierItemApi for deferred addItem() resolutions
// (vi.mocked(...).mockReturnValueOnce needs the real return type, unlike the
// loosely-typed inline vi.fn() factories in the vi.mock() block above).
function fakeDossierItemApi(id: string): DossierItemApi {
  return { id, item_type: 'norm', title: 'Nota', content: norma, position: 0, status: 'unread', created_at: '2026-08-25T00:00:00Z' };
}

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({ dossiers: [] });
});

describe('createDossier', () => {
  it('resolves to the server id and swaps it into the store', async () => {
    const id = await appStore.getState().createDossier('Pratica');
    expect(id).toBe('srv-1');
    expect(appStore.getState().dossiers[0].id).toBe('srv-1');
  });
  it('returns null and rolls back on failure', async () => {
    vi.mocked(dossierService.create).mockRejectedValueOnce(new Error('boom'));
    const id = await appStore.getState().createDossier('Pratica');
    expect(id).toBeNull();
    expect(appStore.getState().dossiers).toHaveLength(0);
  });
});

describe('updateDossierItemStatus', () => {
  it('persists the star via updateItem with the _dossierMeta envelope', async () => {
    appStore.setState({
      dossiers: [{ id: 'd1', title: 'P', createdAt: '2026-08-01', items: [
        { id: 'i1', type: 'norma', data: norma, addedAt: '2026-08-01' },
      ] }],
    });
    appStore.getState().updateDossierItemStatus('d1', 'i1', 'important');
    expect(appStore.getState().dossiers[0].items[0].status).toBe('important');
    await vi.waitFor(() => expect(dossierService.updateItem).toHaveBeenCalledWith(
      'd1', 'i1', { content: { ...norma, _dossierMeta: { important: true } } },
    ));
  });
  it('reverts the optimistic status when the server rejects', async () => {
    vi.mocked(dossierService.updateItem).mockRejectedValueOnce(new Error('boom'));
    appStore.setState({
      dossiers: [{ id: 'd1', title: 'P', createdAt: '2026-08-01', items: [
        { id: 'i1', type: 'norma', data: norma, addedAt: '2026-08-01', status: 'unread' },
      ] }],
    });
    appStore.getState().updateDossierItemStatus('d1', 'i1', 'important');
    await vi.waitFor(() =>
      expect(appStore.getState().dossiers[0].items[0].status).toBe('unread'));
  });
});

// Regression coverage for the review finding: starring an item before its
// addToDossier() addItem POST has resolved must not fire a PUT against the
// client-generated tempId (the server has never seen it, so it would
// reject), and must not be silently dropped once the item settles.
describe('addToDossier pending window (star set before addItem settles)', () => {
  it('defers the PUT until the item settles, then persists with the server id', async () => {
    let resolveAddItem!: (v: DossierItemApi) => void;
    const deferred = new Promise<DossierItemApi>((resolve) => { resolveAddItem = resolve; });
    vi.mocked(dossierService.addItem).mockReturnValueOnce(deferred);

    appStore.setState({
      dossiers: [{ id: 'd1', title: 'P', createdAt: '2026-08-01', items: [] }],
    });

    appStore.getState().addToDossier('d1', norma, 'norma');
    const tempId = appStore.getState().dossiers[0].items[0].id;
    expect(tempId).toBeTruthy();

    // Star it while the addItem POST is still in flight.
    appStore.getState().updateDossierItemStatus('d1', tempId, 'important');
    expect(appStore.getState().dossiers[0].items[0].status).toBe('important');
    // No PUT should have fired yet, and never against the temp id.
    expect(dossierService.updateItem).not.toHaveBeenCalled();

    resolveAddItem(fakeDossierItemApi('item-srv-9'));
    await vi.waitFor(() =>
      expect(appStore.getState().dossiers[0].items[0].id).toBe('item-srv-9'));

    await vi.waitFor(() => expect(dossierService.updateItem).toHaveBeenCalledTimes(1));
    expect(dossierService.updateItem).toHaveBeenCalledWith(
      'd1', 'item-srv-9', { content: { ...norma, _dossierMeta: { important: true } } },
    );
    expect(dossierService.updateItem).not.toHaveBeenCalledWith(
      'd1', tempId, expect.anything(),
    );
  });

  it('reverts the star locally and logs when the deferred persistence PUT fails', async () => {
    let resolveAddItem!: (v: DossierItemApi) => void;
    const deferred = new Promise<DossierItemApi>((resolve) => { resolveAddItem = resolve; });
    vi.mocked(dossierService.addItem).mockReturnValueOnce(deferred);
    vi.mocked(dossierService.updateItem).mockRejectedValueOnce(new Error('boom'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    appStore.setState({
      dossiers: [{ id: 'd1', title: 'P', createdAt: '2026-08-01', items: [] }],
    });

    appStore.getState().addToDossier('d1', norma, 'norma');
    const tempId = appStore.getState().dossiers[0].items[0].id;
    appStore.getState().updateDossierItemStatus('d1', tempId, 'important');

    resolveAddItem(fakeDossierItemApi('item-srv-10'));
    await vi.waitFor(() =>
      expect(appStore.getState().dossiers[0].items[0].id).toBe('item-srv-10'));
    await vi.waitFor(() => expect(dossierService.updateItem).toHaveBeenCalledTimes(1));

    await vi.waitFor(() =>
      expect(appStore.getState().dossiers[0].items[0].status).not.toBe('important'));
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

// Regression coverage for the review finding: importDossier (JSON file /
// share-link import) forwarded the raw NormaVisitata as `content` instead of
// the packed `{ ...data, _dossierMeta }` envelope, so a starred item's
// importance silently vanished the next time fetchUserData rehydrated the
// store from the server.
describe('importDossier', () => {
  it('packs starred items with the _dossierMeta envelope before sending to the server', async () => {
    vi.mocked(dossierService.addItem).mockResolvedValueOnce(fakeDossierItemApi('item-srv-20'));

    const importedDossier = {
      id: 'local-tmp',
      title: 'Importata',
      createdAt: '2026-08-25T00:00:00Z',
      items: [
        { id: 'local-i1', type: 'norma' as const, data: norma, addedAt: '2026-08-25T00:00:00Z', status: 'important' as const },
      ],
    };

    const outcome = await appStore.getState().importDossier(importedDossier);

    expect(outcome).toEqual({ id: 'srv-1', imported: 1, failed: 0 });
    expect(dossierService.addItem).toHaveBeenCalledWith('srv-1', expect.objectContaining({
      content: { ...norma, _dossierMeta: { important: true } },
    }));
  });

  it('does not pack an envelope for non-starred items', async () => {
    vi.mocked(dossierService.addItem).mockResolvedValueOnce(fakeDossierItemApi('item-srv-21'));

    const importedDossier = {
      id: 'local-tmp-2',
      title: 'Importata 2',
      createdAt: '2026-08-25T00:00:00Z',
      items: [
        { id: 'local-i2', type: 'norma' as const, data: norma, addedAt: '2026-08-25T00:00:00Z' },
      ],
    };

    await appStore.getState().importDossier(importedDossier);

    expect(dossierService.addItem).toHaveBeenCalledWith('srv-1', expect.objectContaining({
      content: norma,
    }));
  });
});

describe('addToDossier reads the citations of the answer', () => {
  it('puts act_citation on the settled item', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '2026-10-04', items: [], tags: [] }] });
    vi.mocked(dossierService.addItem).mockResolvedValueOnce({
      ...fakeDossierItemApi('srv-9'),
      citation: 'art. 2043 c.c.', act_citation: 'c.c.',
    });
    appStore.getState().addToDossier('d1', norma, 'norma');
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items[0].id).toBe('srv-9'));
    expect(appStore.getState().dossiers[0].items[0]).toMatchObject({ citation: 'art. 2043 c.c.', actCitation: 'c.c.' });
  });
});

describe('setDossierItemOrder', () => {
  const two = () => [
    { id: 'a', type: 'note' as const, data: 'a', addedAt: '' },
    { id: 'b', type: 'note' as const, data: 'b', addedAt: '' },
  ];

  it('reorders locally and saves the whole order', () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: two() }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    appStore.getState().setDossierItemOrder('d1', ['b', 'a']);
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(dossierService.reorderItems).toHaveBeenCalledWith('d1', ['b', 'a']);
  });

  it('never sends a temporary id: the save waits while an item is pending', () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: [
      { id: 'tmp', type: 'note', data: 'a', addedAt: '' }, { id: 'b', type: 'note', data: 'b', addedAt: '' },
    ] }], pendingDossierItemIds: { tmp: true }, pendingDossierOrders: {} });
    appStore.getState().setDossierItemOrder('d1', ['b', 'tmp']);
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['b', 'tmp']);
    expect(dossierService.reorderItems).not.toHaveBeenCalled();
    expect(appStore.getState().pendingDossierOrders).toEqual({ d1: true });
  });

  it('reverts and says so when the server refuses', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: two() }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    vi.mocked(dossierService.reorderItems).mockRejectedValueOnce(new Error('500'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    appStore.getState().setDossierItemOrder('d1', ['b', 'a']);
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['a', 'b']));
    error.mockRestore();
  });

  it('keeps the items the order does not name, after the named ones', () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: two() }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    appStore.getState().setDossierItemOrder('d1', ['b']);
    expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('replays a waiting order with the server ids once the pending item settles', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: [
      { id: 'b', type: 'note', data: 'b', addedAt: '' },
    ] }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    let settle: (value: DossierItemApi) => void = () => {};
    vi.mocked(dossierService.addItem).mockReturnValueOnce(new Promise((resolve) => { settle = resolve; }));
    appStore.getState().addToDossier('d1', norma, 'norma');
    const tempId = appStore.getState().dossiers[0].items[1].id;
    appStore.getState().setDossierItemOrder('d1', [tempId, 'b']);
    expect(dossierService.reorderItems).not.toHaveBeenCalled();
    settle(fakeDossierItemApi('srv-7'));
    await vi.waitFor(() => expect(dossierService.reorderItems).toHaveBeenCalledWith('d1', ['srv-7', 'b']));
    expect(appStore.getState().pendingDossierOrders).toEqual({});
  });
});

describe('the order after a refusal, and after a restore', () => {
  it('puts back the previous order on the items there are now, never an item removed meanwhile', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: [
      { id: 'a', type: 'note', data: 'a', addedAt: '' }, { id: 'b', type: 'note', data: 'b', addedAt: '' }, { id: 'c', type: 'note', data: 'c', addedAt: '' },
    ] }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    let refuse: (e: Error) => void = () => {};
    vi.mocked(dossierService.reorderItems).mockReturnValueOnce(new Promise((_, reject) => { refuse = reject; }));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    appStore.getState().setDossierItemOrder('d1', ['c', 'b', 'a']);
    appStore.getState().removeFromDossier('d1', 'b');
    refuse(new Error('404'));
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items.map((i) => i.id)).toEqual(['a', 'c']));
    error.mockRestore();
  });

  it('saves where a restored item was, once the server has it', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: [
      { id: 'b', type: 'note', data: 'b', addedAt: '' },
    ] }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    vi.mocked(dossierService.addItem).mockResolvedValueOnce({ ...fakeDossierItemApi('srv-a'), item_type: 'note', content: 'a' });
    appStore.getState().restoreDossierItem('d1', { id: 'a', type: 'note', data: 'a', addedAt: '' }, 0);
    await vi.waitFor(() => expect(dossierService.reorderItems).toHaveBeenCalledWith('d1', ['srv-a', 'b']));
  });

  it('takes a restored item off the page when the server refuses it', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'P', createdAt: '', tags: [], items: [] }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    vi.mocked(dossierService.addItem).mockRejectedValueOnce(new Error('500'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    appStore.getState().restoreDossierItem('d1', { id: 'a', type: 'note', data: 'a', addedAt: '' }, 0);
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items).toHaveLength(0));
    expect(appStore.getState().lastSyncError?.message).toMatch(/ripristinare/);
    error.mockRestore();
  });
});

describe('decision items in the store', () => {
  // As stored before a change of style: the store writes the citation recomputed (source convention, Q9).
  const sentenza = { corte: 'corte_costituzionale' as const, numero: 1, anno: 2014, tipo: 'sentenza',
    data_deposito: '2014-01-13', etichetta: 'Corte cost. 1/2014' };
  const current = { ...sentenza, etichetta: 'Corte cost., sent. 13 gennaio 2014, n. 1' };

  it('addToDossier sends a sentenza item titled by its citation', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'D', createdAt: '', items: [] }] });
    appStore.getState().addToDossier('d1', sentenza, 'sentenza');
    expect(dossierService.addItem).toHaveBeenCalledWith('d1', { itemType: 'sentenza', title: current.etichetta, content: current });
    expect(appStore.getState().dossiers[0].items[0]).toMatchObject({ type: 'sentenza', data: sentenza });
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items[0].id).toBe('item-srv-1'));
  });

  it('a decision can be starred, and the star is written with the citation recomputed', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'D', createdAt: '', items: [
      { id: 's1', type: 'sentenza', data: sentenza, addedAt: '' },
    ] }] });
    appStore.getState().updateDossierItemStatus('d1', 's1', 'important');
    await vi.waitFor(() => expect(dossierService.updateItem).toHaveBeenCalledWith(
      'd1', 's1', { content: { ...current, _dossierMeta: { important: true } } },
    ));
  });

  it('importDossier says how many items the server refused', async () => {
    vi.mocked(dossierService.addItem).mockResolvedValueOnce(fakeDossierItemApi('ok')).mockRejectedValueOnce(new Error('400'));
    const outcome = await appStore.getState().importDossier({ id: 'x', title: 'I', createdAt: '', items: [
      { id: 'a', type: 'sentenza', data: sentenza, addedAt: '' },
      { id: 'b', type: 'note', data: 'n', addedAt: '' },
    ] });
    expect(outcome).toEqual({ id: 'srv-1', imported: 1, failed: 1 });
    expect(dossierService.addItem).toHaveBeenCalledWith('srv-1', { itemType: 'sentenza', title: current.etichetta, content: current });
  });

  it('restoreDossierItem puts a decision back as a decision, its citation recomputed', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'D', createdAt: '', items: [] }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    appStore.getState().restoreDossierItem('d1', { id: 'x', type: 'sentenza', data: sentenza, addedAt: '' }, 0);
    expect(dossierService.addItem).toHaveBeenCalledWith('d1', { itemType: 'sentenza', title: current.etichetta, content: current });
    expect(appStore.getState().dossiers[0].items[0]).toMatchObject({ type: 'sentenza', data: sentenza });
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items[0].id).toBe('item-srv-1'));
    expect(appStore.getState().dossiers[0].items[0].type).toBe('sentenza');
  });

  it('restoreDossierItem carries the star of a decision in its content', async () => {
    appStore.setState({ dossiers: [{ id: 'd1', title: 'D', createdAt: '', items: [] }], pendingDossierItemIds: {}, pendingDossierOrders: {} });
    appStore.getState().restoreDossierItem('d1', { id: 'x', type: 'sentenza', data: sentenza, addedAt: '', status: 'important' }, 0);
    expect(dossierService.addItem).toHaveBeenCalledWith('d1', {
      itemType: 'sentenza', title: current.etichetta, content: { ...current, _dossierMeta: { important: true } },
    });
    await vi.waitFor(() => expect(appStore.getState().dossiers[0].items[0].id).toBe('item-srv-1'));
  });
});
