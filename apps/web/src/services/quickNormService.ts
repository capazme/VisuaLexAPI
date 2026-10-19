import { apiClient } from './api';
import type { SearchParams } from '../types';

export interface QuickNormApi {
  id: string;
  label: string;
  searchParams: SearchParams;
  sourceUrl: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface QuickNormCreatePayload {
  label: string;
  searchParams: SearchParams;
  sourceUrl?: string | null;
}

export interface QuickNormUpdatePayload {
  label?: string;
  searchParams?: SearchParams;
  sourceUrl?: string | null;
  usageCount?: number;
  lastUsedAt?: string | null;
}

export const quickNormService = {
  async getAll(): Promise<QuickNormApi[]> {
    const response = await apiClient.get('/quick-norms');
    return response.data;
  },

  async create(data: QuickNormCreatePayload): Promise<QuickNormApi> {
    const response = await apiClient.post('/quick-norms', data);
    return response.data;
  },

  async update(id: string, data: QuickNormUpdatePayload): Promise<QuickNormApi> {
    const response = await apiClient.put(`/quick-norms/${id}`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/quick-norms/${id}`);
  },

  // Atomic usage bump: hit on every pick from the panel. Client fires-and-
  // forgets; the store increments locally first for instant feedback.
  async use(id: string): Promise<QuickNormApi> {
    const response = await apiClient.post(`/quick-norms/${id}/use`);
    return response.data;
  },
};
