/**
 * Frontend types for the MERL-T graph shared layer (Slice 2a).
 *
 * These mirror the BFF subgraph contract (backend/src/schemas/merlt/graph.ts)
 * verbatim — the BFF proxies MERL-T's node/edge shape and the frontend owns
 * the rendering. Kept FE-local (no cross-package import from the backend).
 */

export interface GraphNode {
  id: string;
  urn?: string | null;
  type: string;
  label: string;
  properties?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  // Optional: MERL-T does not always emit an edge id; graphTransform synthesizes
  // a stable one from source/type/target when missing.
  id?: string;
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface SubgraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata?: Record<string, unknown>;
}

/** BFF GET /api/merlt/graph/jobs/:jobId/status response shape. */
export type IngestionJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

export interface JobStatusResponse {
  jobId: string;
  status: IngestionJobStatus;
  nodesCreated?: number | null;
  edgesCreated?: number | null;
  error?: string | null;
}

export const TERMINAL_JOB_STATUSES: ReadonlySet<IngestionJobStatus> = new Set([
  'completed',
  'failed',
  'timeout',
]);
