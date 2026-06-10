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
        beforeEach(() => {
            appStore.setState({
                dossiers: [
                    {
                        id: 'd-src',
                        title: 'Sorgente',
                        createdAt: '2026-06-01T00:00:00.000Z',
                        items: [
                            { id: 'item-1', type: 'note', data: 'appunto', addedAt: '2026-06-01T00:00:00.000Z' },
                        ],
                    },
                    {
                        id: 'd-dst',
                        title: 'Destinazione',
                        createdAt: '2026-06-01T00:00:00.000Z',
                        items: [],
                    },
                ],
            });
        });

        it('moves optimistically and syncs as addItem on target + deleteItem on source', async () => {
            vi.mocked(dossierService.addItem).mockResolvedValue(serverItem);
            vi.mocked(dossierService.deleteItem).mockResolvedValue(undefined);

            appStore.getState().moveToDossier('d-src', 'd-dst', ['item-1']);

            // Optimistic move is synchronous
            const afterMove = appStore.getState().dossiers;
            expect(afterMove.find(d => d.id === 'd-src')?.items).toHaveLength(0);
            expect(afterMove.find(d => d.id === 'd-dst')?.items).toHaveLength(1);

            await vi.waitFor(() => {
                expect(dossierService.addItem).toHaveBeenCalledWith('d-dst', {
                    itemType: 'note',
                    title: 'Nota',
                    content: 'appunto',
                });
                expect(dossierService.deleteItem).toHaveBeenCalledWith('d-src', 'item-1');
                // The moved item carries the fresh server id
                expect(appStore.getState().dossiers.find(d => d.id === 'd-dst')?.items[0].id).toBe('srv-item-1');
            });
            expect(appStore.getState().lastSyncError).toBeNull();
        });

        it('keeps the optimistic move but surfaces a sync error when the server rejects', async () => {
            vi.mocked(dossierService.addItem).mockRejectedValue(new Error('boom'));

            appStore.getState().moveToDossier('d-src', 'd-dst', ['item-1']);

            await vi.waitFor(() => {
                expect(appStore.getState().lastSyncError?.message).toContain('dossier');
            });
            expect(dossierService.deleteItem).not.toHaveBeenCalled();
        });
    });
});
