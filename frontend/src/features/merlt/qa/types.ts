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
}

export type QaAnswerState =
  | { status: 'loading' }
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

export interface QaTurnModel {
  id: string;
  question: string;
  state: QaAnswerState;
  rating?: 1 | 5; // optimistic 👍/👎
  confirmed: Record<string, ConfirmState>; // by retrieved-source node_id
}
