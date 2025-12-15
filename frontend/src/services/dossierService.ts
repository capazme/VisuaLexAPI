import { apiClient } from './api';

// API types matching backend response format
export interface DossierItemApi {
  id: string;
  item_type: 'norm' | 'note' | 'section';
  title: string;
  content: any;
  position: number;
  created_at: string;
}

export interface DossierApi {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  created_at: string;
  updated_at: string;
  items: DossierItemApi[];
}

export interface DossierCreate {
  name: string;
  description?: string;
  color?: string;
}

export interface DossierUpdate {
  name?: string;
  description?: string | null;
  color?: string | null;
}

export interface DossierItemCreate {
  itemType: 'norm' | 'note' | 'section';
  title: string;
  content?: any;
  position?: number;
}

export interface DossierItemUpdate {
  title?: string;
  content?: any;
  position?: number;
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

  // Reorder dossier items
  async reorderItems(dossierId: string, itemIds: string[]): Promise<void> {
    await apiClient.post(`/dossiers/${dossierId}/reorder`, { itemIds });
  },
};
