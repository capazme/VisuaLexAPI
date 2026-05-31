import { apiClient } from '../../../services/api';
import type { QaAnswer, QaHistoryItem, QaMode } from './types';

/**
 * Typed BFF clients for the MERL-T expert Q&A routes (Loop β Phase F).
 * Mirrors validate/validateApi.ts (direct apiClient). The query/refine calls
 * are long-running (multi-expert) — give them a generous client timeout.
 */

const QA_TIMEOUT_MS = 120000;

export async function askQuestion(query: string, mode: QaMode, maxExperts?: number): Promise<QaAnswer> {
  const res = await apiClient.post<QaAnswer>(
    '/merlt/experts/query',
    { query, mode, maxExperts },
    { timeout: QA_TIMEOUT_MS },
  );
  return res.data;
}

export async function refineQuestion(traceId: string, followUpQuery: string): Promise<QaAnswer> {
  const res = await apiClient.post<QaAnswer>(
    '/merlt/experts/refine',
    { traceId, followUpQuery },
    { timeout: QA_TIMEOUT_MS },
  );
  return res.data;
}

export async function rateAnswer(traceId: string, rating: 1 | 5): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/inline', { traceId, rating });
}

export async function rateSource(traceId: string, sourceId: string, relevant: boolean): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/source', {
    traceId,
    sourceId,
    relevance: relevant ? 5 : 1,
  });
}

export async function preferExpert(traceId: string, preferredExpert: string): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/preference', { traceId, preferredExpert });
}

export async function rateDetailed(
  traceId: string,
  scores: { retrievalScore: number; reasoningScore: number; synthesisScore: number },
  comment?: string,
): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/detailed', { traceId, ...scores, comment });
}

export async function confirmSource(nodeId: string, entityText?: string): Promise<void> {
  await apiClient.post('/merlt/experts/confirm-source', { nodeId, entityText });
}

export async function fetchHistory(limit = 20): Promise<QaHistoryItem[]> {
  const res = await apiClient.get<QaHistoryItem[]>('/merlt/experts/history', { params: { limit } });
  return res.data;
}
