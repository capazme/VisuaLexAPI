import { apiClient } from './api';
import type { AnnotationResponse, AnnotationCreate, AnnotationUpdate } from '../types/api';

export const annotationService = {
  // Create annotation
  async create(data: AnnotationCreate): Promise<AnnotationResponse> {
    const response = await apiClient.post('/annotations', data);
    return response.data;
  },

  // Get annotations by normaKey
  async getByNormaKey(normaKey: string, type?: string): Promise<AnnotationResponse[]> {
    const params: Record<string, string> = { normaKey };
    if (type) params.type = type;
    const response = await apiClient.get('/annotations', { params });
    return response.data;
  },

  // Get annotations for every row whose normaKey startsWith the given prefix.
  // One round trip covers the article body + all its brocardi sub-sections.
  async getByNormaKeyPrefix(normaKeyPrefix: string, type?: string): Promise<AnnotationResponse[]> {
    const params: Record<string, string> = { normaKeyPrefix };
    if (type) params.type = type;
    const response = await apiClient.get('/annotations', { params });
    return response.data;
  },

  // Update annotation
  async update(id: string, data: AnnotationUpdate): Promise<AnnotationResponse> {
    const response = await apiClient.put(`/annotations/${id}`, data);
    return response.data;
  },

  // Delete annotation
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/annotations/${id}`);
  },

  // Delete every annotation owned by the current user. Returns the count
  // of rows deleted. Used by applyEnvironment(replace) to avoid server-side
  // orphans after a wipe.
  async deleteAll(): Promise<number> {
    const response = await apiClient.delete('/annotations');
    return response.data?.deleted ?? 0;
  },
};
