import { apiClient } from './api';
import type { ArticleDiscussionResponse, ArticleDiscussionThread, ArticleDiscussionComment } from '../types';

export interface DiscussionAnchor {
  normaKey: string;
  articleId: string;
  articleLabel?: string;
  version?: string;
}

export const articleDiscussionService = {
  async list(anchor: DiscussionAnchor, sort: 'recent' | 'active' | 'popular' = 'recent'): Promise<ArticleDiscussionResponse> {
    const response = await apiClient.get('/article-discussions', { params: { ...anchor, sort } });
    return response.data;
  },
  async create(anchor: DiscussionAnchor, title: string, body: string): Promise<ArticleDiscussionThread> {
    const response = await apiClient.post('/article-discussions', { ...anchor, title, body });
    return response.data;
  },
  async comment(threadId: string, body: string, parentId?: string | null): Promise<ArticleDiscussionComment> {
    const response = await apiClient.post(`/article-discussions/${threadId}/comments`, { body, parentId });
    return response.data;
  },
  async voteThread(threadId: string): Promise<{ voted: boolean; voteCount: number }> {
    const response = await apiClient.post(`/article-discussions/${threadId}/vote`);
    return response.data;
  },
  async voteComment(commentId: string): Promise<{ voted: boolean; voteCount: number }> {
    const response = await apiClient.post(`/article-discussion-comments/${commentId}/vote`);
    return response.data;
  },
  async report(threadId: string, reason: string, details?: string): Promise<void> {
    await apiClient.post(`/article-discussions/${threadId}/report`, { reason, details });
  },
};
