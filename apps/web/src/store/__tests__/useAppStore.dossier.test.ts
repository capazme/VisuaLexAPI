import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/dossierService', () => ({
    dossierService: {
        getAll: vi.fn(),
        getById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        addItem: vi.fn(),
        updateItem: vi.fn(),
        deleteItem: vi.fn(),
        moveItem: vi.fn(),
        reorderItems: vi.fn(),
    },
}));

import { appStore } from '../useAppStore';
import { dossierService, type DossierApi, type DossierItemApi } from '../../services/dossierService';

const serverDossier: DossierApi = {
    id: 'srv-dossier-1',
    name: 'Ricerca 2043',
    description: null,
    color: null,
    is_pinned: false,
    created_at: '2026-06-10T10:00:00.000Z',
    updated_at: '2026-06-10T10:00:00.000Z',
    items: [],
};

const serverItem: DossierItemApi = {
    id: 'srv-item-1',
    item_type: 'note',
    title: 'Nota',
    content: 'appunto',
    position: 0,
    status: 'unread',
    created_at: '2026-06-10T10:00:00.000Z',
};

describe('useAppStore dossier sync', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.clearAllMocks();
        appStore.setState({ dossiers: [], lastSyncError: null });
        consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    describe('createDossier', () => {
        it('returns the server id and stores the dossier with it', async () => {
            vi.mocked(dossierService.create).mockResolvedValue(serverDossier);

            const id = await appStore.getState().createDossier('Ricerca 2043', 'desc');

            expect(id).toBe('srv-dossier-1');
            expect(dossierService.create).toHaveBeenCalledWith({
                name: 'Ricerca 2043',
                description: 'desc',
            });
            const dossiers = appStore.getState().dossiers;
            expect(dossiers).toHaveLength(1);
            expect(dossiers[0].id).toBe('srv-dossier-1');
            expect(dossiers[0].title).toBe('Ricerca 2043');
            expect(dossiers[0].createdAt).toBe(serverDossier.created_at);
        });

        it('returns null, keeps the store clean and surfaces a sync error on failure', async () => {
            vi.mocked(dossierService.create).mockRejectedValue(new Error('boom'));

            const id = await appStore.getState().createDossier('Ricerca 2043');

            expect(id).toBeNull();
            expect(appStore.getState().dossiers).toHaveLength(0);
            expect(appStore.getState().lastSyncError?.message).toContain('dossier');
        });
    });

    describe('moveToDossier', () => {
        // The server moves the row itself: one call per item, no re-creation.
        // The old addItem+deleteItem pair re-created the row, which handed the
        // item a fresh server id (so a star or a delete on the moved row 404'd
        // against the target dossier until a reload) and reset its added-at
        // date, and left the item in both dossiers whenever the delete failed.
        beforeEach(() => {
            appStore.setState({
                dossiers: [
                    {
                        id: 'd-src',
                        title: 'Sorgente',
                        createdAt: '2026-06-01T00:00:00.000Z',
                        items: [
                            { id: 'item-1', type: 'note', data: 'appunto', addedAt: '2026-06-01T00:00:00.000Z' },
                            { id: 'item-2', type: 'note', data: 'secondo', addedAt: '2026-06-01T00:00:00.000Z' },
                            { id: 'item-3', type: 'note', data: 'terzo', addedAt: '2026-06-01T00:00:00.000Z' },
                        ],
                    },
                    {
                        id: 'd-dst',
                        title: 'Destinazione',
                        createdAt: '2026-06-01T00:00:00.000Z',
                        items: [],
                    },
                ],
                pendingDossierItemIds: {},
            });
        });

        it('moves optimistically and syncs with one in-place move, keeping the server id', async () => {
            vi.mocked(dossierService.moveItem).mockResolvedValue(serverItem);

            appStore.getState().moveToDossier('d-src', 'd-dst', ['item-1']);

            // Optimistic move is synchronous
            const afterMove = appStore.getState().dossiers;
            expect(afterMove.find(d => d.id === 'd-src')?.items.map(i => i.id)).toEqual(['item-2', 'item-3']);
            expect(afterMove.find(d => d.id === 'd-dst')?.items.map(i => i.id)).toEqual(['item-1']);

            await vi.waitFor(() => {
                expect(dossierService.moveItem).toHaveBeenCalledWith('d-src', 'item-1', 'd-dst');
            });
            // Same row on the server, so the id the store holds is still valid:
            // starring or deleting it in the target no longer 404s.
            expect(appStore.getState().dossiers.find(d => d.id === 'd-dst')?.items[0].id).toBe('item-1');
            expect(dossierService.addItem).not.toHaveBeenCalled();
            expect(dossierService.deleteItem).not.toHaveBeenCalled();
            expect(appStore.getState().lastSyncError).toBeNull();
        });

        it('puts the item back in the source, at its old index, when the server refuses the move', async () => {
            vi.mocked(dossierService.moveItem).mockRejectedValue(new Error('boom'));

            appStore.getState().moveToDossier('d-src', 'd-dst', ['item-2']);

            await vi.waitFor(() => {
                expect(appStore.getState().lastSyncError?.message).toContain('spostare');
            });
            // Reverted: the item is really still in the source, so leaving it in
            // the target would make every later star or delete there 404.
            const dossiers = appStore.getState().dossiers;
            expect(dossiers.find(d => d.id === 'd-src')?.items.map(i => i.id)).toEqual(['item-1', 'item-2', 'item-3']);
            expect(dossiers.find(d => d.id === 'd-dst')?.items).toHaveLength(0);
        });

        it('reverts only the items the server refused', async () => {
            vi.mocked(dossierService.moveItem).mockImplementation(async (_source, itemId) => {
                if (itemId === 'item-3') throw new Error('boom');
                return serverItem;
            });

            appStore.getState().moveToDossier('d-src', 'd-dst', ['item-2', 'item-3']);

            await vi.waitFor(() => {
                expect(appStore.getState().lastSyncError?.message).toContain('spostare');
            });
            const dossiers = appStore.getState().dossiers;
            expect(dossiers.find(d => d.id === 'd-src')?.items.map(i => i.id)).toEqual(['item-1', 'item-3']);
            expect(dossiers.find(d => d.id === 'd-dst')?.items.map(i => i.id)).toEqual(['item-2']);
        });

        it('refuses to move an item whose addToDossier POST is still in flight', async () => {
            appStore.setState((state) => {
                state.dossiers[0].items = [
                    ...state.dossiers[0].items,
                    { id: 'temp-1', type: 'note', data: 'in corso', addedAt: '2026-06-01T00:00:00.000Z' },
                ];
                state.pendingDossierItemIds['temp-1'] = true;
            });

            appStore.getState().moveToDossier('d-src', 'd-dst', ['temp-1']);

            // The server has never seen temp-1: a move call would 404, and
            // addToDossier's settle handler would then look for the temp id in a
            // dossier it has already left, leaving the item in both after reload.
            await Promise.resolve();
            expect(dossierService.moveItem).not.toHaveBeenCalled();
            const dossiers = appStore.getState().dossiers;
            expect(dossiers.find(d => d.id === 'd-src')?.items.map(i => i.id)).toContain('temp-1');
            expect(dossiers.find(d => d.id === 'd-dst')?.items).toHaveLength(0);
            expect(appStore.getState().lastSyncError?.message).toContain('ancora salvati');
        });

        it('moves the settled items and reports the ones still in flight', async () => {
            vi.mocked(dossierService.moveItem).mockResolvedValue(serverItem);
            appStore.setState((state) => {
                state.dossiers[0].items = [
                    ...state.dossiers[0].items,
                    { id: 'temp-1', type: 'note', data: 'in corso', addedAt: '2026-06-01T00:00:00.000Z' },
                ];
                state.pendingDossierItemIds['temp-1'] = true;
            });

            appStore.getState().moveToDossier('d-src', 'd-dst', ['item-1', 'temp-1']);

            await vi.waitFor(() => {
                expect(dossierService.moveItem).toHaveBeenCalledWith('d-src', 'item-1', 'd-dst');
            });
            expect(dossierService.moveItem).toHaveBeenCalledTimes(1);
            const dossiers = appStore.getState().dossiers;
            expect(dossiers.find(d => d.id === 'd-src')?.items.map(i => i.id)).toEqual(['item-2', 'item-3', 'temp-1']);
            expect(dossiers.find(d => d.id === 'd-dst')?.items.map(i => i.id)).toEqual(['item-1']);
            expect(appStore.getState().lastSyncError?.message).toContain('ancora salvati');
        });
    });
});
