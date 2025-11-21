import { apiClient } from './api';
import type { Highlight, HighlightCreate, HighlightUpdate } from '../types/api';

export const highlightService = {
  // Create highlight
  async create(data: HighlightCreate): Promise<Highlight> {
    const response = await apiClient.post('/highlights', data);
    return response.data;
  },

  // Get highlights by normaKey
  async getByNormaKey(normaKey: string): Promise<Highlight[]> {
    const response = await apiClient.get('/highlights', { params: { normaKey } });
    return response.data;
  },

  // Update highlight
  async update(id: string, data: HighlightUpdate): Promise<Highlight> {
    const response = await apiClient.put(`/highlights/${id}`, data);
    return response.data;
  },

  // Delete highlight
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/highlights/${id}`);
  },
};
