import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/dossierService', () => ({
  dossierService: { delete: vi.fn(), getById: vi.fn(), writesInFlight: vi.fn(() => 0) },
}));
vi.mock('../../../services/trashService', () => ({ trashService: { restore: vi.fn(), purge: vi.fn() } }));

import { dossierService } from '../../../services/dossierService';
import { trashService } from '../../../services/trashService';
import { registerUndoToastListener, type UndoToast } from '../../../hooks/useUndoableAction';
import { appStore } from '../../../store/useAppStore';
import type { Dossier } from '../../../types';
import { deleteDossierWithUndo, discardEmptyDossier } from './deleteDossierWithUndo';

const svc = vi.mocked(dossierService);
const trash = vi.mocked(trashService);
const dossier = (id: string, title: string): Dossier => ({ id, title, createdAt: '2026-10-13T08:00:00Z', items: [], tags: [] });

let toast: UndoToast | null = null;
let unregister = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  toast = null;
  unregister = registerUndoToastListener((t) => { toast = t; });
  appStore.setState({ dossiers: [dossier('a', 'Ricorso Rossi'), dossier('b', 'Parere Bianchi')], lastSyncError: null });
});
afterEach(() => {
  unregister();
  vi.restoreAllMocks();
});

describe('a dossier deleted from the web app (question 160)', () => {
  it('goes to the trash, and the toast says so with «Annulla»', async () => {
    svc.delete.mockResolvedValue({ trashId: 't1', itemCount: 3 });
    deleteDossierWithUndo({ id: 'a', title: 'Ricorso Rossi' });
    expect(appStore.getState().dossiers.map((d) => d.id)).toEqual(['b']);
    await vi.waitFor(() => expect(toast?.message).toBe('Dossier «Ricorso Rossi» spostato nel cestino'));
    expect(svc.delete).toHaveBeenCalledWith('a');
    toast?.onDismiss();
  });

  it('«Annulla» restores it from the trash and reads it back from the server; the trash is read again each time', async () => {
    svc.delete.mockResolvedValue({ trashId: 't1', itemCount: 3 });
    trash.restore.mockResolvedValue({ dossierId: 'a' });
    svc.getById.mockResolvedValue({ id: 'a', name: 'Ricorso Rossi', created_at: '2026-10-13T08:00:00Z', items: [] } as never);
    const trashChanged = vi.fn();
    deleteDossierWithUndo({ id: 'a', title: 'Ricorso Rossi' }, trashChanged);
    await vi.waitFor(() => expect(toast).not.toBeNull());
    expect(trashChanged).toHaveBeenCalledTimes(1);
    await toast!.onUndo();
    expect(trash.restore).toHaveBeenCalledWith('t1');
    expect(trashChanged).toHaveBeenCalledTimes(2);
    expect(appStore.getState().dossiers.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('a restore that fails says where the dossier is', async () => {
    svc.delete.mockResolvedValue({ trashId: 't1', itemCount: 3 });
    trash.restore.mockRejectedValue(new Error('down'));
    deleteDossierWithUndo({ id: 'a', title: 'Ricorso Rossi' });
    await vi.waitFor(() => expect(toast).not.toBeNull());
    await toast!.onUndo();
    expect(appStore.getState().lastSyncError?.message).toBe('Impossibile ripristinare «Ricorso Rossi» ora: è nel Cestino, ripristinalo da lì.');
  });

  it('refused by the server: put back where it was, an error, and no toast', async () => {
    svc.delete.mockRejectedValue(new Error('down'));
    deleteDossierWithUndo({ id: 'a', title: 'Ricorso Rossi' });
    await vi.waitFor(() => expect(appStore.getState().lastSyncError?.message).toBe('Impossibile eliminare il dossier. Riprova.'));
    expect(appStore.getState().dossiers.map((d) => d.id)).toEqual(['a', 'b']);
    expect(toast).toBeNull();
  });
});

describe('an empty dossier the app could not fill', () => {
  it('is removed from the trash at once: the user deleted nothing', async () => {
    svc.delete.mockResolvedValue({ trashId: 't9', itemCount: 0 });
    trash.purge.mockResolvedValue(undefined);
    await discardEmptyDossier('a');
    expect(trash.purge).toHaveBeenCalledWith('t9');
    expect(toast).toBeNull();
  });

  it('stays in the trash when the server says it held something (an answer lost on the way)', async () => {
    svc.delete.mockResolvedValue({ trashId: 't9', itemCount: 1 });
    await discardEmptyDossier('a');
    expect(trash.purge).not.toHaveBeenCalled();
  });
});
