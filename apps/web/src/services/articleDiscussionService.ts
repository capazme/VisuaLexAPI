import { apiClient } from './api';
import type {
  ArticleDiscussionResponse,
  ArticleDiscussionThread,
  ArticleDiscussionComment,
  ArticleDiscussionPassageSummary,
  ThreadPassage,
} from '../types';

export interface DiscussionAnchor {
  normaKey: string;
  articleId: string;
  articleLabel?: string;
  version?: string;
}

// Readers of one article mounting together (a block remounting, React's double
// effect in development) asked for the same passage list up to eight times at
// once. Shared only while in flight, and dropped when a discussion is created:
// the reload that follows must reach the server.
const passagesInFlight = new Map<string, Promise<ArticleDiscussionPassageSummary[]>>();
const passagesKey = (anchor: Pick<DiscussionAnchor, 'normaKey' | 'articleId'>) =>
  JSON.stringify([anchor.normaKey, anchor.articleId]);

export const articleDiscussionService = {
  async list(anchor: DiscussionAnchor, sort: 'recent' | 'active' | 'popular' = 'recent'): Promise<ArticleDiscussionResponse> {
    const response = await apiClient.get('/article-discussions', { params: { ...anchor, sort } });
    return response.data;
  },
  listPassages(anchor: Pick<DiscussionAnchor, 'normaKey' | 'articleId'>): Promise<ArticleDiscussionPassageSummary[]> {
    const key = passagesKey(anchor);
    const pending = passagesInFlight.get(key);
    if (pending) return pending;
    const request = apiClient
      .get('/article-discussions/passages', { params: { normaKey: anchor.normaKey, articleId: anchor.articleId } })
      .then((response) => response.data.data as ArticleDiscussionPassageSummary[])
      .finally(() => {
        if (passagesInFlight.get(key) === request) passagesInFlight.delete(key);
      });
    passagesInFlight.set(key, request);
    return request;
  },
  async create(
    anchor: DiscussionAnchor,
    title: string,
    body: string,
    extras: { passage?: ThreadPassage; articleUrn?: string; textHash?: string } = {}
  ): Promise<ArticleDiscussionThread> {
    passagesInFlight.delete(passagesKey(anchor));
    const response = await apiClient.post('/article-discussions', { ...anchor, title, body, ...extras });
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
