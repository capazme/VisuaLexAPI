import { apiClient } from './api';
import type { Bookmark, BookmarkCreate, BookmarkUpdate } from '../types/api';

export const bookmarkService = {
  // Create bookmark
  async create(data: BookmarkCreate): Promise<Bookmark> {
    const response = await apiClient.post('/bookmarks', data);
    return response.data;
  },

  // Get all bookmarks
  async getAll(params?: { folderId?: string; tags?: string }): Promise<Bookmark[]> {
    const response = await apiClient.get('/bookmarks', { params });
    return response.data;
  },

  // Get single bookmark
  async getById(id: string): Promise<Bookmark> {
    const response = await apiClient.get(`/bookmarks/${id}`);
    return response.data;
  },

  // Update bookmark
  async update(id: string, data: BookmarkUpdate): Promise<Bookmark> {
    const response = await apiClient.put(`/bookmarks/${id}`, data);
    return response.data;
  },

  // Move bookmark to folder
  async move(id: string, folderId: string | null): Promise<Bookmark> {
    const response = await apiClient.patch(`/bookmarks/${id}/move`, { folderId });
    return response.data;
  },

  // Delete bookmark
  async delete(id: string): Promise<void> {
    await apiClient.delete(`/bookmarks/${id}`);
  },

  // Bulk delete
  async bulkDelete(bookmarkIds: string[]): Promise<{ deleted_count: number }> {
    const response = await apiClient.post('/bookmarks/bulk/delete', { bookmarkIds });
    return response.data;
  },

  // Bulk move
  async bulkMove(bookmarkIds: string[], folderId: string | null): Promise<{ updated_count: number }> {
    const response = await apiClient.post('/bookmarks/bulk/move', { bookmarkIds, folderId });
    return response.data;
  },
};
