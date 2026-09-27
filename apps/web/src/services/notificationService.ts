import { apiClient } from './api';

export interface ForumUnreadCount {
  pendingSuggestions: number;
  newLikes: number;
  normaChanges: number;
  total: number;
}

export interface NormaChangeNotification {
  id: string;
  normaKey: string;
  message: string;
  snapshot: Record<string, unknown>;
  readAt?: string | null;
  createdAt: string;
}

export const notificationService = {
  async getForumUnread(): Promise<ForumUnreadCount> {
    const response = await apiClient.get('/notifications/forum-unread-count');
    return response.data;
  },

  async markRead(): Promise<void> {
    await apiClient.post('/notifications/mark-read');
  },

  async checkNorma(normaKey: string, normaData: unknown): Promise<{ watched: boolean; changed: boolean }> {
    const response = await apiClient.post('/notifications/normas/check', { normaKey, normaData });
    return response.data;
  },

  async getNormaChanges(): Promise<NormaChangeNotification[]> {
    const response = await apiClient.get('/notifications/normas');
    return response.data;
  },
  async getUnreadNormaChangeCount(): Promise<number> {
    const response = await apiClient.get('/notifications/normas/unread-count');
    return response.data.count;
  },

  async markNormaChangesRead(): Promise<void> {
    await apiClient.post('/notifications/normas/mark-read');
  },
};
