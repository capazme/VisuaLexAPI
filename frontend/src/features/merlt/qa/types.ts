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
  /**
   * Human-readable identity resolved at retrieval time (e.g. "Art. 1618. (…)"
   * or "art. 1453 codice civile"), null when unknown. Takes priority over any
   * urn-humanization in the label helpers (`format.ts`'s `sourceLabel`).
   */
  title?: string | null;
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
  /**
   * Wave C: provenance of the disagreement numbers. MAY be absent (older
   * responses) — treat absence as authoritative. When present and NOT
   * 'model-trained', the numbers are a heuristic estimate and the UI must
   * caveat them rather than present them as ground truth.
   */
  source?: 'heuristic' | 'model-untrained' | 'model-trained' | null;
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

/**
 * One hop of the systemic expert's graph walk (node→relation→node), as emitted
 * verbatim by the BFF's `graph_traversal` field (mirrors
 * backend/src/services/merlt/expertsClient.ts `GraphTraversalEdge`). `iteration`
 * groups hops belonging to the same traversal round; `target_urn`/`source_urn`
 * are graph node identifiers (Normattiva URLs, `modalita:*` / `massima_*` concept
 * ids, or `live:*` provisional nodes) — NOT necessarily present in the currently
 * rendered subgraph.
 */
export interface GraphTraversalEdge {
  iteration: number;
  source_urn: string;
  relation_type: string;
  target_urn: string;
  target_type: string;
}

/** One tool invocation inside a canon's execution (parsed from `pipeline_trace`). */
export interface QaToolUsage {
  expert: string;
  toolName: string;
  success: boolean;
  resultCount: number | null;
  error: string | null;
  durationMs: number;
}

/**
 * One ReAct iteration inside a canon's execution (parsed from `pipeline_trace`).
 * MERL-T runs ReAct PER canon (typically 3 iterations each) — the steps live at
 * `stages.expert_executions[*].react_steps`, NOT at a top-level `react_steps`
 * (that field never existed on the wire; the earlier code read the wrong level
 * and always saw an empty array).
 */
export interface QaReactStep {
  expert: string;
  iteration: number;
  thought: string;
  action: string;
  success: boolean;
  resultsFound: number | null;
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
  /** Wave C: NL rationale of the divergence + art. 12 preleggi criteria; null on convergent answers. */
  disagreement_explanation?: string | null;
  /** Slice 4 P2a: devil's-advocate marker; `expert` null until P2b. */
  devils_advocate_flag?: QaDevilsAdvocateFlag | null;
  /** Slice 4 P2a: per-canon full theses; `[]` on the degenerate no-expert path. */
  expert_contributions?: ExpertContribution[];
  /**
   * The systemic expert's ordered graph walk. Optional/absent on turns built
   * before this field existed (e.g. hand-built test fixtures, the slim history
   * DTO before hydration) — treat absence as `[]`. `[]` also when the query
   * had no graph-resolvable seed norms. Drives "Segui il ragionamento sul grafo".
   */
  graphTraversal?: GraphTraversalEdge[];
  /**
   * Tool calls the canons fired, parsed from `pipeline_trace` (present only
   * when the request ran with `include_trace: true`). Optional/absent (treat
   * as `[]`) when the trace is missing or predates this field.
   */
  toolUsages?: QaToolUsage[];
  /**
   * Per-canon ReAct iterations, parsed from `pipeline_trace` (same conditions
   * as `toolUsages`). Optional/absent (treat as `[]`) when the trace is
   * missing, predates this field, or the canons ran single-step (no ReAct).
   */
  reactSteps?: QaReactStep[];
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

/**
 * The graph "context basket" carried by a question: the nodes the jurist chose
 * to reason WITH. Norma nodes → `normReferences` (graph urn), concept nodes →
 * `legalConcepts` (label). The BFF maps these onto MERL-T's `context.entities`.
 */
export interface GraphContext {
  normReferences?: string[];
  legalConcepts?: string[];
}

/** How the turn's answer was requested — kept so a failed turn can be re-run in place (Riprova).
 *  `context` (the graph context basket) is preserved so Riprova re-sends the SAME selected nodes. */
export type QaTurnRequest =
  | { kind: 'ask'; mode: QaMode; context?: GraphContext }
  | { kind: 'refine'; traceId: string };

export interface QaTurnModel {
  id: string;
  question: string;
  state: QaAnswerState;
  rating?: 1 | 5; // optimistic 👍/👎
  confirmed: Record<string, ConfirmState>; // by retrieved-source node_id
  request?: QaTurnRequest; // absent on history-loaded turns (nothing to retry)
  /**
   * Wave 2 (history completeness, review P2.6) — HISTORY-loaded turns only.
   * The history DTO is slim (no retrieved_sources / expert_contributions /
   * disagreement), so `loadHistoryTurn` re-fetches the full trace and patches
   * the answer: 'loading' while the trace fetch is in flight, 'hydrated' once
   * the details landed, 'unavailable' when the trace expired / was never stored
   * (the slim turn stays, with a "dettagli non più disponibili" note).
   * Absent on live turns.
   */
  historyDetail?: 'loading' | 'hydrated' | 'unavailable';
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
