import { getMerlt, postMerlt } from '../../../../services/merltService';
import type { SubgraphResponse, JobStatusResponse } from './types';

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

/** GET /api/merlt/graph/jobs/:jobId/status — poll an ingestion job. */
export function fetchJobStatus(jobId: string): Promise<JobStatusResponse> {
  return getMerlt<JobStatusResponse>(`/merlt/graph/jobs/${encodeURIComponent(jobId)}/status`);
}
