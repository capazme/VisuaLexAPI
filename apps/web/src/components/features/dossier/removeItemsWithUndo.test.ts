import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/dossierService', () => ({
  dossierService: { trashItems: vi.fn(), getById: vi.fn(), reorderItems: vi.fn(async () => {}), writesInFlight: vi.fn(() => 0) },
}));
vi.mock('../../../services/trashService', () => ({ trashService: { restore: vi.fn() } }));

import { dossierService } from '../../../services/dossierService';
import { trashService } from '../../../services/trashService';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { appStore } from '../../../store/useAppStore';
import type { Dossier, DossierItem } from '../../../types';
import { removeItemsWithUndo } from './removeItemsWithUndo';

const svc = vi.mocked(dossierService);
const trash = vi.mocked(trashService);
const note = (id: string): DossierItem => ({ id, type: 'note', data: id, addedAt: '' });
const dossier = (): Dossier => ({ id: 'd1', title: 'Ricorso Rossi', createdAt: '2026-10-13T08:00:00Z', tags: [], items: [note('a'), note('b'), note('c')] });
const api = (items: string[]) => ({
  id: 'd1', name: 'Ricorso Rossi', is_pinned: false, created_at: '', updated_at: '', tags: [],
  items: items.map((id) => ({ id, item_type: 'note' as const, title: 'Nota', content: id, position: 0, status: 'unread' as const, created_at: '' })),
});
const ids = () => appStore.getState().dossiers[0].items.map((i) => i.id);

let toast: UndoToast | null = null;
let unregister = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  toast = null;
  unregister = registerUndoToastListener((t) => { toast = t; });
  appStore.setState({ dossiers: [dossier()], pendingDossierItemIds: {}, pendingDossierOrders: {}, lastSyncError: null });
});
afterEach(() => {
  unregister();
  vi.restoreAllMocks();
});

describe('entries removed from a dossier on the web app (question 181)', () => {
  it('go to the trash in one call, and the toast says what was removed with «Annulla»', async () => {
    svc.trashItems.mockResolvedValue({ trashId: 't1', moved: ['a', 'c'], notFound: [] });
    const trashChanged = vi.fn();
    removeItemsWithUndo('d1', ['a', 'c'], '2 elementi rimossi', trashChanged);
    expect(ids()).toEqual(['b']);
    await vi.waitFor(() => expect(toast?.message).toBe('2 elementi rimossi'));
    expect(svc.trashItems).toHaveBeenCalledTimes(1);
    expect(svc.trashItems).toHaveBeenCalledWith('d1', ['a', 'c']);
    expect(trashChanged).toHaveBeenCalledTimes(1);
    toast?.onDismiss();
  });

  it('«Annulla» restores the trash entry and reads the dossier back: the entries return with their own ids; the trash is read again', async () => {
    svc.trashItems.mockResolvedValue({ trashId: 't1', moved: ['a'], notFound: [] });
    trash.restore.mockResolvedValue({ dossierId: 'd1' });
    svc.getById.mockResolvedValue(api(['a', 'b', 'c']));
    const trashChanged = vi.fn();
    removeItemsWithUndo('d1', ['a'], 'Elemento rimosso', trashChanged);
    await vi.waitFor(() => expect(toast).not.toBeNull());
    await toast!.onUndo();
    expect(trash.restore).toHaveBeenCalledWith('t1');
    expect(svc.getById).toHaveBeenCalledWith('d1');
    expect(trashChanged).toHaveBeenCalledTimes(2);
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(appStore.getState().lastSyncError).toBeNull();
  });

  it('«Annulla» puts them back where they were: the server appends a restored entry at the end', async () => {
    svc.trashItems.mockResolvedValue({ trashId: 't1', moved: ['a'], notFound: [] });
    trash.restore.mockResolvedValue({ dossierId: 'd1' });
    // What the real server answers after the restore: the entry after the dossier's last.
    svc.getById.mockResolvedValue(api(['b', 'c', 'a']));
    removeItemsWithUndo('d1', ['a'], 'Elemento rimosso');
    await vi.waitFor(() => expect(toast).not.toBeNull());
    await toast!.onUndo();
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(svc.reorderItems).toHaveBeenCalledWith('d1', ['a', 'b', 'c']);
  });

  it('a restore that fails says the entries are in the Cestino', async () => {
    svc.trashItems.mockResolvedValue({ trashId: 't1', moved: ['a'], notFound: [] });
    trash.restore.mockRejectedValue(new Error('down'));
    removeItemsWithUndo('d1', ['a'], 'Elemento rimosso');
    await vi.waitFor(() => expect(toast).not.toBeNull());
    await toast!.onUndo();
    expect(appStore.getState().lastSyncError?.message).toBe('Impossibile ripristinare ora: gli elementi sono nel Cestino, ripristinali da lì.');
    expect(svc.getById).not.toHaveBeenCalled();
  });

  it('refused by the server: put back where they were, an error, no toast, the trash not read again', async () => {
    svc.trashItems.mockRejectedValue(new Error('down'));
    const trashChanged = vi.fn();
    removeItemsWithUndo('d1', ['a', 'c'], '2 elementi rimossi', trashChanged);
    await vi.waitFor(() => expect(appStore.getState().lastSyncError?.message).toBe('Impossibile rimuovere dal dossier. Riprova.'));
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(toast).toBeNull();
    expect(trashChanged).not.toHaveBeenCalled();
  });

  it('an entry still being saved refuses the removal: no call, no toast, a message', async () => {
    appStore.setState({ pendingDossierItemIds: { b: true } });
    removeItemsWithUndo('d1', ['a', 'b'], '2 elementi rimossi');
    await vi.waitFor(() => expect(appStore.getState().lastSyncError?.message).toMatch(/non sono ancora salvati/));
    expect(svc.trashItems).not.toHaveBeenCalled();
    expect(ids()).toEqual(['a', 'b', 'c']);
    expect(toast).toBeNull();
  });
});
