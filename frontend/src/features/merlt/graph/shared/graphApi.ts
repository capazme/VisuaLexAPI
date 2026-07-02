import { getMerlt, postMerlt } from '../../../../services/merltService';
import type { SubgraphResponse, JobStatusResponse, GraphSearchItem } from './types';

/**
 * Thin typed clients for the Slice 2a BFF graph endpoints. The hooks call these
 * (and tests mock this module). The BFF mounts everything under /api/merlt; the
 * merltService helpers prepend /api via the shared axios baseURL.
 */

/** GET /api/merlt/graph/article/:urn — subgraph for visualization. */
export function fetchArticleGraph(
  urn: string,
  depth = 2,
  limit?: number
): Promise<SubgraphResponse> {
  const params: Record<string, number> = { depth };
  if (limit !== undefined) params.limit = limit;
  return getMerlt<SubgraphResponse>(`/merlt/graph/article/${encodeURIComponent(urn)}`, params);
}

/** POST /api/merlt/graph/ingest — enqueue a lazy ingestion job. */
export function triggerIngestion(urn: string): Promise<{ jobId: string; status: string }> {
  return postMerlt<{ jobId: string; status: string }>('/merlt/graph/ingest', { urn });
}

/** UI-facing failure kinds for a rejected ingestion trigger (design §3.4). */
export type IngestionTriggerErrorKind = 'consent' | 'unavailable';

/**
 * Map a failed POST /graph/ingest to the UI error kind: 403 (the BFF consent
 * guard) → 'consent'; anything else (5xx / network / timeout) → 'unavailable'.
 */
export function classifyIngestionTriggerError(err: unknown): IngestionTriggerErrorKind {
  // apiClient's response interceptor rejects with a plain { status, message,
  // data } object (services/api.ts), NOT the raw AxiosError — read `status`
  // first and keep `response.status` only as a fallback for un-intercepted
  // errors (same shape friendlyQaError relies on in useQaThread).
  const status =
    typeof err === 'object' && err !== null
      ? ((err as { status?: number }).status ??
         (err as { response?: { status?: number } }).response?.status)
      : undefined;
  return status === 403 ? 'consent' : 'unavailable';
}

/** GET /api/merlt/graph/jobs/:jobId/status — poll an ingestion job. */
export function fetchJobStatus(jobId: string): Promise<JobStatusResponse> {
  return getMerlt<JobStatusResponse>(`/merlt/graph/jobs/${encodeURIComponent(jobId)}/status`);
}

/** GET /api/merlt/graph/search — entity autocomplete for the explorer. */
export function searchGraph(q: string, limit = 10): Promise<GraphSearchItem[]> {
  return getMerlt<GraphSearchItem[]>('/merlt/graph/search', { q, limit });
}
