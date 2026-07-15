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
 * Read the FULL-graph degree of a node (Wave 1 payload: MERL-T stamps
 * `metadata.degree` = indegree+outdegree on every subgraph node). This is the
 * node's total connection count in the graph — NOT the count of edges present
 * in the current (possibly truncated) subgraph. Undefined when absent.
 */
export function readNodeDegree(node: Pick<GraphNode, 'properties' | 'metadata'>): number | undefined {
  const props = node.properties ?? {};
  const meta = node.metadata ?? {};
  const n = coerceTrust(meta.degree ?? props.degree);
  return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined;
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

/* ------------------------------------------------------------------ *
 * Slice 4 P2a — "il dibattito visibile" (deliberation overlay types)  *
 *                                                                     *
 * These mirror the widened BFF `ExpertQueryResponse` (backend agent's *
 * additive DTO): per-canon contributions + expert-pair disagreement + *
 * a devil's-advocate flag. Read defensively off `QaAnswer` (the fields*
 * are optional — a convergent answer carries no disagreement object). *
 * ------------------------------------------------------------------ */

/** The four interpretive canons MERL-T routes across (art. 12 preleggi order). */
export type CanonKey = 'literal' | 'systemic' | 'principles' | 'precedent';

export const CANON_KEYS: readonly CanonKey[] = ['literal', 'systemic', 'principles', 'precedent'];

/** Per-canon contribution — full thesis + self-confidence + routing weight. */
export interface ExpertContribution {
  /** Canon key (`literal`/`systemic`/`principles`/`precedent`, extras last). */
  expert: string;
  /** Full interpretation text (NOT the 300-char preview). */
  thesis: string;
  /** Expert self-confidence [0..1]. */
  confidence: number;
  /** Routing/gating weight [0..1] — drives canon-node size/opacity on canvas. */
  weight: number;
}

/** One expert-pair conflict — the contrast arc between two canon nodes. */
export interface DisagreementConflict {
  /** Canon key of the first expert in contrast. */
  expert_a: string;
  /** Canon key of the second expert in contrast. */
  expert_b: string;
  /** Conflict intensity [0..1] — drives contrast-arc thickness. */
  conflict_score: number;
  /** Human reason for the contrast (shown on hover); null when unavailable. */
  contention_point?: string | null;
  /** Excerpt of expert_a's reasoning at the point of contrast. */
  excerpt_a?: string | null;
  /** Excerpt of expert_b's reasoning at the point of contrast. */
  excerpt_b?: string | null;
}

/** Expert-pair disagreement analysis (null on a convergent answer). */
export interface DisagreementAnalysis {
  has_disagreement: boolean;
  disagreement_type?: string | null;
  disagreement_level?: string | null;
  intensity?: number;
  resolvability?: number;
  confidence?: number;
  conflicts: DisagreementConflict[];
  pairwise_matrix?: number[][] | null;
}

/** Devil's-advocate flag — a deliberate challenge, not an organic split. */
export interface DevilsAdvocateFlag {
  active: boolean;
  /**
   * Which canon played devil's advocate (heuristic minority-canon derivation
   * upstream); null when no attribution could be derived (or no dissent).
   */
  expert?: string | null;
}

/**
 * Deliberation fields as they land on the BFF Q&A answer. `QaAnswer` (owned by
 * the qa feature) does not type them yet, so we read them off the answer via a
 * structural subset — {@link readDeliberation} in graphDeliberation.ts.
 */
export interface DeliberationFields {
  expert_contributions?: ExpertContribution[] | null;
  disagreement_analysis?: DisagreementAnalysis | null;
  devils_advocate_flag?: DevilsAdvocateFlag | null;
}

/**
 * What the canvas emits on `edge:click`, threaded to the deliberation column.
 * A discriminated union so a click on a REAL relation opens the
 * EdgeDetailsDrawer while a click on a synthetic CONTRAST arc opens the
 * per-conflict view (built by FE-panel).
 */
export type GraphEdgeSelection =
  | { kind: 'relation'; edge: GraphEdge }
  | {
      kind: 'contrast';
      conflict: DisagreementConflict;
      /** Readable canon labels for the two experts in contrast. */
      expertALabel: string;
      expertBLabel: string;
      /** True when the devil's-advocate flag marks this a deliberate challenge. */
      isDevilsAdvocate: boolean;
      /**
       * Readable label of the specific canon that played devil's advocate,
       * when MERL-T derives one AND it is one of this conflict's two
       * endpoints. Undefined when no per-canon attribution is available —
       * the badge falls back to the generic (unscoped) wording.
       */
      devilsAdvocateExpertLabel?: string;
    };

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
