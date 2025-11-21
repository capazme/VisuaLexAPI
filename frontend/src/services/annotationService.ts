import { apiClient } from './api';
import type { Annotation, AnnotationCreate, AnnotationUpdate } from '../types/api';

export const annotationService = {
  // Create annotation
  async create(data: AnnotationCreate): Promise<Annotation> {
    const response = await apiClient.post('/annotations', data);
    return response.data;
  },

  // Get annotations by normaKey
  async getByNormaKey(normaKey: string, type?: string): Promise<Annotation[]> {
    const params: any = { normaKey };
    if (type) params.type = type;
    const response = await apiClient.get('/annotations', { params });
    return response.data;
  },

  // Update annotation
  async update(id: string, data: AnnotationUpdate): Promise<Annotation> {
    const response = await apiClient.put(`/annotations/${id}`, data);
    return response.data;
  },

  // Delete annotation
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/annotations/${id}`);
  },
};
