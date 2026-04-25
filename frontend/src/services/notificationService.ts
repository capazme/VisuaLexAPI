import { apiClient } from './api';

export interface ForumUnreadCount {
  pendingSuggestions: number;
  newLikes: number;
  total: number;
}

export const notificationService = {
  async getForumUnread(): Promise<ForumUnreadCount> {
    const response = await apiClient.get('/notifications/forum-unread-count');
    return response.data;
  },

  async markRead(): Promise<void> {
    await apiClient.post('/notifications/mark-read');
  },
};
