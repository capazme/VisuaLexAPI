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

export const dossierService = {
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
    const response = await apiClient.post('/dossiers', data);
    return response.data;
  },

  // Update dossier
  async update(id: string, data: DossierUpdate): Promise<DossierApi> {
    const response = await apiClient.put(`/dossiers/${id}`, data);
    return response.data;
  },

  // Delete dossier
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/dossiers/${id}`);
  },

  // Add item to dossier
  async addItem(dossierId: string, data: DossierItemCreate): Promise<DossierItemApi> {
    const response = await apiClient.post(`/dossiers/${dossierId}/items`, data);
    return response.data;
  },

  // Update dossier item
  async updateItem(dossierId: string, itemId: string, data: DossierItemUpdate): Promise<DossierItemApi> {
    const response = await apiClient.put(`/dossiers/${dossierId}/items/${itemId}`, data);
    return response.data;
  },

  // Delete dossier item
  async deleteItem(dossierId: string, itemId: string): Promise<void> {
    await apiClient.delete(`/dossiers/${dossierId}/items/${itemId}`);
  },

  // Move an item to another dossier. The server moves the row itself, so the id
  // the store holds stays valid, and the item keeps its added-at date and its
  // content (the _dossierMeta envelope that carries the star).
  // A note, in the dossier or about one of its articles (the route Claude's notes take too).
  async addNote(dossierId: string, data: { text: string; aboutItemId?: string }): Promise<DossierItemApi> {
    const response = await apiClient.post(`/dossiers/${dossierId}/notes`, data);
    return response.data;
  },

  async moveItem(dossierId: string, itemId: string, targetDossierId: string): Promise<DossierItemApi> {
    const response = await apiClient.post(`/dossiers/${dossierId}/items/${itemId}/move`, { targetDossierId });
    return response.data;
  },

  // Reorder dossier items
  async reorderItems(dossierId: string, itemIds: string[]): Promise<void> {
    await apiClient.post(`/dossiers/${dossierId}/reorder`, { itemIds });
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
