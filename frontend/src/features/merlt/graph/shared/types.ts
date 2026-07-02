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

/**
 * Canonical provenance of a graph node (Slice 4 P1).
 *
 * MERL-T seeds/entity-writer nodes carry `community_validated: true` (trust≈1.0);
 * the live provisional writer stamps `provenance: 'live_unconfirmed'`, trust≈0.6.
 * The three states drive both the canvas node styling and the drawer badge:
 *  - `seed`               → solid (default corpus, no explicit community vote)
 *  - `community_validated`→ ring / emphasized border (peer-reviewed)
 *  - `live_unconfirmed`   → dashed amber (provisional, cleared no consensus)
 */
export type NodeProvenance = 'seed' | 'community_validated' | 'live_unconfirmed';

/**
 * Transformed node data carried on the G6 item (`node.data`) after
 * `transformSubgraphResponse`. Widened in Slice 4 P1 so the CANVAS (not just the
 * drawer) can colour nodes by provenance/trust — the shared contract every
 * deliberation consumer reads.
 */
export interface GraphNodeData {
  label: string;
  type: string;
  urn?: string;
  /** Canonical provenance derived from raw node props/metadata. */
  provenance?: NodeProvenance;
  /** Numeric trust score [0..1] when MERL-T supplies one. */
  trust?: number;
  /** Raw node properties passthrough (drawer reads `massima`, `rubrica`, …). */
  properties?: Record<string, unknown>;
  // Index signature so the object stays assignable to G6's `NodeData['data']`
  // (Record<string, unknown>). The named fields above keep their strong types.
  [key: string]: unknown;
}

const PROVENANCE_VALUES: ReadonlySet<string> = new Set<NodeProvenance>([
  'seed',
  'community_validated',
  'live_unconfirmed',
]);

function coerceTrust(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Read `trust` from a node's props/metadata, coercing numeric strings. */
export function readNodeTrust(node: Pick<GraphNode, 'properties' | 'metadata'>): number | undefined {
  const props = node.properties ?? {};
  const meta = node.metadata ?? {};
  return coerceTrust(props.trust ?? meta.trust);
}

/**
 * Derive the canonical provenance of a node from its raw props/metadata.
 *
 * Precedence (highest trust wins so a validated node is never dimmed to
 * provisional): an explicit `provenance` field is honoured only for the
 * provisional state; `community_validated` truthiness promotes to
 * `community_validated`; everything else is `seed`. Returns `undefined` when no
 * provenance signal exists so the canvas keeps the plain type styling.
 */
export function deriveProvenance(
  node: Pick<GraphNode, 'properties' | 'metadata'>
): NodeProvenance | undefined {
  const props = node.properties ?? {};
  const meta = node.metadata ?? {};
  const raw = props.provenance ?? meta.provenance;
  const validated = props.community_validated ?? meta.community_validated;

  if (validated === true || validated === 'true') return 'community_validated';
  if (typeof raw === 'string' && PROVENANCE_VALUES.has(raw)) return raw as NodeProvenance;
  // A recognised non-provenance signal (e.g. a trust score) still implies seed.
  if (raw !== undefined || validated !== undefined || readNodeTrust(node) !== undefined) {
    return 'seed';
  }
  return undefined;
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

/** BFF GET /api/merlt/graph/search item (proxied from MERL-T entity search). */
export interface GraphSearchItem {
  id: string;
  nome?: string;
  tipo?: string;
  urn?: string;
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
