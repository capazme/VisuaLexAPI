import { apiClient } from './api';

// API types matching backend response format
export type DossierItemStatus = 'unread' | 'reading' | 'important' | 'done';

export interface DossierItemApi {
  id: string;
  item_type: 'norm' | 'note' | 'section' | 'sentenza';
  title: string;
  // The server's names for a norm and its act; null for anything else.
  citation?: string | null;
  act_citation?: string | null;
  // The article a note is about, and the connected application that wrote it.
  about_item_id?: string | null;
  created_by?: { clientName: string | null } | null;
  content: unknown;
  position: number;
  status: DossierItemStatus;
  created_at: string;
}

export interface DossierApi {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  tags?: string[];
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  items: DossierItemApi[];
}

export interface DossierCreate {
  name: string;
  description?: string;
  color?: string;
  tags?: string[];
}

export interface DossierUpdate {
  name?: string;
  description?: string | null;
  color?: string | null;
  tags?: string[];
  isPinned?: boolean;
}

export interface DossierItemCreate {
  itemType: 'norm' | 'note' | 'section' | 'sentenza';
  title: string;
  content?: unknown;
  position?: number;
  status?: DossierItemStatus;
}

export interface DossierItemUpdate {
  title?: string;
  content?: unknown;
  position?: number;
  status?: DossierItemStatus;
  // A note's article, to reattach it to an article restored with a new id.
  aboutItemId?: string | null;
}

export interface DossierSnapshotApi {
  id: string;
  version: number;
  label?: string | null;
  createdAt: string;
  fingerprint?: string | null;
  unchanged?: boolean;
}

/**
 * Dossier writes still on their way. The page's background reads (`refreshDossier` quiet,
 * `refreshDossiers`) skip while one is: the server may answer the read before it has the
 * write, and an older answer would bring back what was just removed, or add twice what was
 * just added. Every write below goes through `tracked`.
 */
let writesInFlight = 0;
async function tracked<T>(write: () => Promise<T>): Promise<T> {
  writesInFlight += 1;
  try {
    return await write();
  } finally {
    writesInFlight -= 1;
  }
}

export const dossierService = {
  writesInFlight(): number {
    return writesInFlight;
  },

  // Get all dossiers
  async getAll(): Promise<DossierApi[]> {
    const response = await apiClient.get('/dossiers');
    return response.data;
  },

  // Get single dossier
  async getById(id: string): Promise<DossierApi> {
    const response = await apiClient.get(`/dossiers/${id}`);
    return response.data;
  },

  // Create dossier
  async create(data: DossierCreate): Promise<DossierApi> {
    return tracked(async () => (await apiClient.post('/dossiers', data)).data);
  },

  // Update dossier
  async update(id: string, data: DossierUpdate): Promise<DossierApi> {
    return tracked(async () => (await apiClient.put(`/dossiers/${id}`, data)).data);
  },

  /** Moves the dossier to the trash for 30 days (question 160): the entry's id is what «Annulla» restores. */
  async delete(id: string): Promise<{ trashId: string; itemCount: number }> {
    return tracked(async () => (await apiClient.delete(`/dossiers/${id}`)).data);
  },

  // Add item to dossier
  async addItem(dossierId: string, data: DossierItemCreate): Promise<DossierItemApi> {
    return tracked(async () => (await apiClient.post(`/dossiers/${dossierId}/items`, data)).data);
  },

  // Update dossier item
  async updateItem(dossierId: string, itemId: string, data: DossierItemUpdate): Promise<DossierItemApi> {
    return tracked(async () => (await apiClient.put(`/dossiers/${dossierId}/items/${itemId}`, data)).data);
  },

  /**
   * Moves entries of one dossier to the trash for 30 days, as ONE trash entry (question 181):
   * `trashId` is what «Annulla» restores, with the entries' own ids. `notFound` lists ids that
   * were not in the dossier any more; the call fails (404) when none was.
   */
  async trashItems(dossierId: string, itemIds: string[]): Promise<{ trashId: string; moved: string[]; notFound: string[] }> {
    return tracked(async () => (await apiClient.post(`/dossiers/${dossierId}/trash-items`, { itemIds })).data);
  },

  // A note, in the dossier or about one of its articles (the route Claude's notes take too).
  async addNote(dossierId: string, data: { text: string; aboutItemId?: string }): Promise<DossierItemApi> {
    return tracked(async () => (await apiClient.post(`/dossiers/${dossierId}/notes`, data)).data);
  },

  // Move an item to another dossier. The server moves the row itself, so the id
  // the store holds stays valid, and the item keeps its added-at date and its
  // content (the _dossierMeta envelope that carries the star).
  async moveItem(dossierId: string, itemId: string, targetDossierId: string): Promise<DossierItemApi> {
    return tracked(async () => (await apiClient.post(`/dossiers/${dossierId}/items/${itemId}/move`, { targetDossierId })).data);
  },

  // Reorder dossier items
  async reorderItems(dossierId: string, itemIds: string[]): Promise<void> {
    await tracked(() => apiClient.post(`/dossiers/${dossierId}/reorder`, { itemIds }));
  },

  async createSnapshot(dossierId: string, label?: string): Promise<DossierSnapshotApi> {
    const response = await apiClient.post(`/dossiers/${dossierId}/snapshots`, { label });
    return response.data;
  },

  async getSnapshots(dossierId: string): Promise<DossierSnapshotApi[]> {
    const response = await apiClient.get(`/dossiers/${dossierId}/snapshots`);
    return response.data;
  },
};
