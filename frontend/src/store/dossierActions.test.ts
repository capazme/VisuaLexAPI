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
import { dossierService } from '../services/dossierService';

const norma = { tipo_atto: 'codice civile', data: '1942-03-16', numero_atto: '262', numero_articolo: '2043' };

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
