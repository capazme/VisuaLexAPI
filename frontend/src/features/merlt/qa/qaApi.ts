import { apiClient } from '../../../services/api';
import type { QaAnswer, QaHistoryItem, QaMode } from './types';

/**
 * Typed BFF clients for the MERL-T expert Q&A routes (Loop β Phase F).
 * Mirrors validate/validateApi.ts (direct apiClient). The query/refine calls
 * are long-running (multi-expert) — give them a generous client timeout.
 */

// P1.10: FE timeout = the BFF experts timeout (MERLT_EXPERTS_TIMEOUT_MS,
// default 120s in expertsClient.ts) + 10s of headroom, so the BFF's own
// 502/504 reaches the client with real status copy instead of the FE aborting
// first with a generic "nessuna risposta dal server".
const QA_TIMEOUT_MS = 130000;

export async function askQuestion(
  query: string,
  mode: QaMode,
  maxExperts?: number,
  signal?: AbortSignal,
): Promise<QaAnswer> {
  const res = await apiClient.post<QaAnswer>(
    '/merlt/experts/query',
    { query, mode, maxExperts },
    { timeout: QA_TIMEOUT_MS, signal },
  );
  return res.data;
}

export async function refineQuestion(
  traceId: string,
  followUpQuery: string,
  signal?: AbortSignal,
): Promise<QaAnswer> {
  const res = await apiClient.post<QaAnswer>(
    '/merlt/experts/refine',
    { traceId, followUpQuery },
    { timeout: QA_TIMEOUT_MS, signal },
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

/**
 * Slice 4 L3 — "privilegia questa relazione". NEW feedback channel: the jurist
 * steers the traversal head toward a graph relation type (the systemic expert's
 * walk), keyed on the deliberation's `trace_id` like every other channel. The
 * BFF contract is `{ traceId, relationType }` → POST /experts/feedback/relation.
 */
export async function sendRelationFeedback(traceId: string, relationType: string): Promise<void> {
  await apiClient.post('/merlt/experts/feedback/relation', { traceId, relationType });
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
