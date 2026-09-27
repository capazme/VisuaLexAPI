import { apiClient } from './api';
import type { HighlightResponse, HighlightCreate, HighlightUpdate } from '../types/api';

export const highlightService = {
  // Create highlight
  async create(data: HighlightCreate): Promise<HighlightResponse> {
    const response = await apiClient.post('/highlights', data);
    return response.data;
  },

  // Get highlights by normaKey
  async getByNormaKey(normaKey: string): Promise<HighlightResponse[]> {
    const response = await apiClient.get('/highlights', { params: { normaKey } });
    return response.data;
  },

  // Get highlights for every row whose normaKey startsWith the given prefix.
  // One round trip covers the article body + all its brocardi sub-sections.
  async getByNormaKeyPrefix(normaKeyPrefix: string): Promise<HighlightResponse[]> {
    const response = await apiClient.get('/highlights', { params: { normaKeyPrefix } });
    return response.data;
  },

  // Update highlight
  async update(id: string, data: HighlightUpdate): Promise<HighlightResponse> {
    const response = await apiClient.put(`/highlights/${id}`, data);
    return response.data;
  },

  // Delete highlight
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/highlights/${id}`);
  },

  // Delete every highlight owned by the current user. Returns the count
  // of rows deleted. Used by applyEnvironment(replace) to avoid server-side
  // orphans after a wipe.
  async deleteAll(): Promise<number> {
    const response = await apiClient.delete('/highlights');
    return response.data?.deleted ?? 0;
  },
};
