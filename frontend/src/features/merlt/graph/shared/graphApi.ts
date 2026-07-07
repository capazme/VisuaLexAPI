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

/**
 * F2 (Wave 2) — depth-1 neighborhood around ANY graph node, for expand-in-place.
 *
 * Reuses the same BFF route as {@link fetchArticleGraph}: MERL-T's subgraph
 * root matcher accepts an article URN **or** an entity node id (graph_router.py
 * matches `root.URN | root.urn | root.node_id`), so the root can be whichever
 * handle the node carries (`node.urn ?? node.id`).
 */
export function fetchNodeNeighborhood(
  rootIdOrUrn: string,
  limit?: number
): Promise<SubgraphResponse> {
  return fetchArticleGraph(rootIdOrUrn, 1, limit);
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

/* ------------------------------------------------------------------ *
 * Wave 2 payload diet (F4) — fetch-size + depth defaults.             *
 *                                                                     *
 * URL-as-SoT note: `?depth=` in /grafo remains the override — these   *
 * defaults only apply when the param is absent. The side rail keeps   *
 * its own tighter budget (depth 1, limit 25) in ArticleGraphSideRail. *
 * ------------------------------------------------------------------ */

/** Default subgraph edge budget for the /grafo page fetch. */
export const PAGE_GRAPH_LIMIT_DEFAULT = 150;

/**
 * Max limit — aligned with the BFF clamp (`limit` ∈ [1,200] in
 * routes/merlt/graph.ts) and MERL-T's max_nodes hard cap. A higher value would
 * be silently clamped upstream, so the ladder must never exceed it.
 */
export const GRAPH_LIMIT_MAX = 200;

/** "Carica di più" ladder — each step is a new SWR cache key → a new fetch. */
export const GRAPH_LIMIT_STEPS: readonly number[] = [25, 50, 100, 200];

/** Next ladder step above `current`, or null when the ladder is exhausted. */
export function nextGraphLimit(current: number): number | null {
  for (const step of GRAPH_LIMIT_STEPS) {
    if (step > current) return step;
  }
  return null;
}

/**
 * Default traversal depth per center kind: 2 for articles (the useful legal
 * neighbourhood), 1 for concepts — a hub concept at depth 2 is a hairball.
 */
export function defaultGraphDepth(centerIsArticle: boolean): number {
  return centerIsArticle ? 2 : 1;
}
