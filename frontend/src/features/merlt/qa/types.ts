/** Loop β Phase F — Q&A types. Mirrors the BFF ExpertQueryResponse. */

export type QaMode = 'convergent' | 'divergent';

/** An LLM-cited source (readable citation/excerpt; ids are LLM output). */
export interface QaSource {
  article_urn: string;
  expert: string;
  relevance: number;
  excerpt?: string | null;
  provenance?: string | null;
  trust?: number | null;
  citation?: string | null;
}

/** A source the engine consulted, with REAL FalkorDB provenance (F.0 Option A). */
export interface QaRetrievedSource {
  urn: string;
  provenance?: string | null;
  trust?: number | null;
  node_id?: string | null;
  source_url?: string | null;
}

/** A divergent-mode per-canon interpretation (synthesizer shape). */
export interface QaAlternative {
  expert: string;
  position: string;
  confidence: number;
  legal_basis: string[];
  reasoning_type?: string;
}

/**
 * Slice 4 P2a "il dibattito visibile" — deliberation the engine already computes
 * but historically dropped at the DTO. Mirror the BFF ExpertQueryResponse widening
 * (backend/src/services/merlt/expertsClient.ts) VERBATIM. All three fields are
 * additive/backward-compatible: old responses omit them.
 */

/** One expert pair in conflict (thickness ∝ conflict_score on the contrast arc). */
export interface QaExpertPairConflict {
  expert_a: string;
  expert_b: string;
  conflict_score: number;
  contention_point?: string | null;
  excerpt_a?: string | null;
  excerpt_b?: string | null;
}

/** Full disagreement analysis; `null` on convergent responses (no conflict object). */
export interface QaDisagreementAnalysis {
  has_disagreement: boolean;
  disagreement_type?: string | null;
  disagreement_level?: string | null;
  intensity: number;
  resolvability: number;
  confidence: number;
  conflicts: QaExpertPairConflict[];
  pairwise_matrix?: number[][] | null;
}

/**
 * Devil's-advocate marker — `active` says a deliberate challenge occurred;
 * `expert` (WHICH canon) is always null today (per-canon attribution is P2b).
 */
export interface QaDevilsAdvocateFlag {
  active: boolean;
  expert?: string | null;
}

/**
 * A per-canon FULL thesis (not the 300-char divergent preview): the canon's own
 * interpretation + self-confidence + routing/gating weight. `weight` drives the
 * canon-node size on the canvas; a canon that errored carries an error string in
 * `thesis` with `confidence === 0` (see `isErroredThesis`).
 */
export interface ExpertContribution {
  expert: string;
  thesis: string;
  confidence: number;
  weight: number;
}

export interface QaAnswer {
  trace_id: string;
  synthesis: string;
  mode: string;
  alternatives?: QaAlternative[] | null;
  sources: QaSource[];
  retrieved_sources: QaRetrievedSource[];
  experts_used: string[];
  confidence: number;
  execution_time_ms: number;
  /** Present when the query ran with include_trace (always, via the BFF). */
  pipeline_trace?: Record<string, unknown> | null;
  pipeline_metrics?: Record<string, unknown> | null;
  /** Slice 4 P2a: full disagreement object; null when the canons converge. */
  disagreement_analysis?: QaDisagreementAnalysis | null;
  /** Slice 4 P2a: devil's-advocate marker; `expert` null until P2b. */
  devils_advocate_flag?: QaDevilsAdvocateFlag | null;
  /** Slice 4 P2a: per-canon full theses; `[]` on the degenerate no-expert path. */
  expert_contributions?: ExpertContribution[];
}

export type QaAnswerState =
  // `startedAt` (epoch ms) drives the elapsed-time indicator during the wait
  // (queries can take up to 120s). Absent on turns restored from localStorage.
  | { status: 'loading'; startedAt?: number }
  | { status: 'success'; answer: QaAnswer }
  | { status: 'error'; error: string };

/** A past Q&A turn from the server-backed history (Loop β #1 option B). */
export interface QaHistoryItem {
  trace_id: string;
  query: string;
  synthesis: string;
  mode: string;
  confidence?: number | null;
  experts_used: string[];
  sources: QaSource[];
  created_at?: string | null;
}

export type ConfirmState = 'pending' | 'done' | 'error';

/** How the turn's answer was requested — kept so a failed turn can be re-run in place (Riprova). */
export type QaTurnRequest = { kind: 'ask'; mode: QaMode } | { kind: 'refine'; traceId: string };

export interface QaTurnModel {
  id: string;
  question: string;
  state: QaAnswerState;
  rating?: 1 | 5; // optimistic 👍/👎
  confirmed: Record<string, ConfirmState>; // by retrieved-source node_id
  request?: QaTurnRequest; // absent on history-loaded turns (nothing to retry)
}

/**
 * QA-PREFILL CONTRACT (Slice 3 §3.5, Slice 4 absorb): the in-article "Chiedi su
 * questo articolo" button navigates to `/grafo` with this in `location.state`
 * (plus `?urn=` to center the graph). GraphExplorerPage reads it once on mount
 * to prefill the ask field, then clears it so a manual reload does not re-prefill.
 */
export interface QaPrefillState {
  prefillQuery: string;
  articleUrn: string;
  articleHeading?: string;
}
