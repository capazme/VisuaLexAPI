/**
 * HTTP client for MERL-T expert Q&A + confirm-source (FastAPI :8000).
 *
 * Loop β Phase F. Mirrors graphClient.ts: native fetch + AbortController,
 * reuses merltClient.ts's typed error hierarchy. Uses a LONG timeout
 * (MERLT_EXPERTS_TIMEOUT_MS, default 120s) because a multi-expert query takes
 * tens of seconds warm — never the 5s default.
 *
 * Real MERL-T paths (merlt/merlt/api/experts_router.py + enrichment_router.py):
 *  - POST /api/v1/experts/query
 *  - POST /api/v1/experts/feedback/{inline,detailed,source,preference,relation,refine}
 *  - POST /api/v1/enrichment/confirm-source
 */

import {
  MerltTimeoutError,
  MerltServerError,
  MerltBadRequestError,
} from './merltClient';

export interface ExpertsClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface ExpertSourceReference {
  article_urn: string;
  expert: string;
  relevance: number;
  excerpt?: string | null;
  provenance?: string | null;
  trust?: number | null;
  citation?: string | null;
}

export interface ExpertRetrievedSource {
  urn: string;
  provenance?: string | null;
  trust?: number | null;
  node_id?: string | null;
  source_url?: string | null;
  /** Human-readable identity (normative ref or text snippet) resolved at retrieval time; null when unknown. */
  title?: string | null;
}

/**
 * Slice 4 P2a "il dibattito visibile": deliberation the engine already computes
 * but historically dropped at the DTO. All three fields below are additive and
 * backward-compatible — old responses omit them, new ones surface the debate.
 *
 * Grounding (MERL-T experts_router.py DTOs + synthesizer.py / orchestrator.py):
 *  - disagreement_analysis ← SynthesisResult.disagreement_analysis.to_dict()
 *    (disagreement/types.py:249-260; null on convergent responses)
 *  - devils_advocate_flag ← SynthesisResult.devils_advocate_flag (synthesizer.py:345);
 *    `expert` now carries the dissenting canon (heuristic minority-canon derivation
 *    upstream); this client is a pure passthrough of whatever MERL-T sends
 *  - expert_contributions ← per-canon full thesis + confidence + routing weight
 *    (synthesizer.py:624-631,680-703); canon-node size ∝ weight, [] when degenerate
 */
export interface ExpertPairConflict {
  expert_a: string;
  expert_b: string;
  conflict_score: number;
  contention_point?: string | null;
  excerpt_a?: string | null;
  excerpt_b?: string | null;
}

export interface DisagreementAnalysis {
  has_disagreement: boolean;
  disagreement_type?: string | null;
  disagreement_level?: string | null;
  intensity: number;
  resolvability: number;
  confidence: number;
  conflicts: ExpertPairConflict[];
  pairwise_matrix?: number[][] | null;
  /**
   * Wave C: provenance of the disagreement numbers. MAY be absent (older
   * responses) — treat absence as authoritative/model-trained-equivalent.
   */
  source?: 'heuristic' | 'model-untrained' | 'model-trained' | null;
}

export interface DevilsAdvocateFlag {
  active: boolean;
  expert?: string | null;
}

export interface ExpertContribution {
  expert: string;
  thesis: string;
  confidence: number;
  weight: number;
}

/**
 * One ordered edge of the systemic reasoning walk over the graph
 * (SystemicExpert). `source_urn --[relation_type]--> target_urn`. Emitted by
 * MERL-T so the FE can replay the reasoning on the graph canvas.
 */
export interface GraphTraversalEdge {
  iteration: number;
  source_urn: string;
  relation_type: string;
  target_urn: string;
  target_type: string;
}

export interface ExpertQueryResponse {
  trace_id: string;
  synthesis: string;
  mode: string;
  alternatives?: Record<string, unknown>[] | null;
  sources: ExpertSourceReference[];
  retrieved_sources: ExpertRetrievedSource[];
  experts_used: string[];
  confidence: number;
  execution_time_ms: number;
  pipeline_trace?: Record<string, unknown> | null;
  pipeline_metrics?: Record<string, unknown> | null;
  /** Ordered node→relation→node walk of the systemic reasoning; empty when no graph-resolvable seed norms. */
  graph_traversal?: GraphTraversalEdge[];
  disagreement_analysis?: DisagreementAnalysis | null;
  /** NL explanation of the divergence + art. 12 preleggi criteria; null on convergent answers. */
  disagreement_explanation?: string | null;
  devils_advocate_flag?: DevilsAdvocateFlag | null;
  expert_contributions?: ExpertContribution[];
}

export interface ExpertFeedbackResponse {
  success: boolean;
  feedback_id?: number | null;
  message: string;
}

export interface ExpertHistoryItem {
  trace_id: string;
  query: string;
  synthesis: string;
  mode: string;
  confidence?: number | null;
  experts_used: string[];
  sources: ExpertSourceReference[];
  created_at?: string | null;
}

export interface QueryArgs {
  query: string;
  user_id: string;
  consent_level: 'anonymous' | 'basic' | 'full';
  max_experts?: number;
  include_trace?: boolean;
  context?: Record<string, unknown>;
}
export interface InlineFeedbackArgs {
  trace_id: string;
  user_id: string;
  rating: number;
}
export interface SourceFeedbackArgs {
  trace_id: string;
  user_id: string;
  source_id: string;
  relevance: number;
}
export interface DetailedFeedbackArgs {
  trace_id: string;
  user_id: string;
  retrieval_score: number;
  reasoning_score: number;
  synthesis_score: number;
  comment?: string;
}
export interface PreferenceFeedbackArgs {
  trace_id: string;
  user_id: string;
  preferred_expert: string;
  comment?: string;
}
/** Slice 4 L3: per-relation traversal steer ("privilegia questa relazione"). */
export interface RelationFeedbackArgs {
  trace_id: string;
  user_id: string;
  relation_type: string;
  comment?: string;
}
export interface RefineArgs {
  trace_id: string;
  user_id: string;
  follow_up_query: string;
}
export interface ConfirmSourceArgs {
  node_id: string;
  user_id: string;
  entity_text?: string;
  entity_type?: string;
  ambito?: string;
}

export class ExpertsClient {
  constructor(private readonly config: ExpertsClientConfig) {}

  query(a: QueryArgs): Promise<ExpertQueryResponse> {
    return this.request('POST', '/api/v1/experts/query', {
      include_trace: true,
      max_experts: 4,
      ...a,
    });
  }
  feedbackInline(a: InlineFeedbackArgs): Promise<ExpertFeedbackResponse> {
    return this.request('POST', '/api/v1/experts/feedback/inline', a);
  }
  feedbackSource(a: SourceFeedbackArgs): Promise<ExpertFeedbackResponse> {
    return this.request('POST', '/api/v1/experts/feedback/source', a);
  }
  feedbackDetailed(a: DetailedFeedbackArgs): Promise<ExpertFeedbackResponse> {
    return this.request('POST', '/api/v1/experts/feedback/detailed', a);
  }
  feedbackPreference(a: PreferenceFeedbackArgs): Promise<ExpertFeedbackResponse> {
    return this.request('POST', '/api/v1/experts/feedback/preference', a);
  }
  feedbackRelation(a: RelationFeedbackArgs): Promise<ExpertFeedbackResponse> {
    return this.request('POST', '/api/v1/experts/feedback/relation', a);
  }
  refine(a: RefineArgs): Promise<ExpertQueryResponse> {
    return this.request('POST', '/api/v1/experts/feedback/refine', a);
  }
  confirmSource(a: ConfirmSourceArgs): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/v1/enrichment/confirm-source', a);
  }
  history(userId: string, limit = 20): Promise<ExpertHistoryItem[]> {
    const qs = new URLSearchParams({ user_id: userId, limit: String(limit) }).toString();
    return this.request('GET', `/api/v1/experts/history?${qs}`);
  }
  /**
   * Wave 2 (history completeness): fetch the FULL pipeline trace of a past
   * deliberation (MERL-T GET /api/v1/experts/trace/{trace_id}). The upstream
   * applies consent-based redaction from `caller_consent` (min with the
   * ask-time stored level). MERL-T already strips the nested RLCF
   * `execution_trace`; we ALSO drop `query_embedding` (PipelineTrace.to_dict
   * can carry it) and re-drop `execution_trace` here as defence in depth —
   * embeddings are server-internal and bloat the payload. 404 (unknown/expired
   * trace) surfaces as MerltBadRequestError for the route to pass through.
   */
  async getTrace(
    traceId: string,
    callerConsent?: 'anonymous' | 'basic' | 'full'
  ): Promise<Record<string, unknown>> {
    const qs = callerConsent
      ? `?${new URLSearchParams({ caller_consent: callerConsent }).toString()}`
      : '';
    const raw = await this.request<Record<string, unknown>>(
      'GET',
      `/api/v1/experts/trace/${encodeURIComponent(traceId)}${qs}`
    );
    if (raw && typeof raw === 'object') {
      delete raw.query_embedding;
      delete raw.execution_trace;
    }
    return raw;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.config.apiKey) headers['X-API-Key'] = this.config.apiKey;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new MerltTimeoutError(`Timeout after ${this.config.timeoutMs}ms calling ${path}`);
      }
      throw new MerltTimeoutError(
        `Network error calling ${path}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    clearTimeout(timer);

    if (response.status >= 500) {
      const text = await response.text().catch(() => '');
      throw new MerltServerError(
        `MERL-T ${response.status} on ${path}: ${text.slice(0, 200)}`,
        response.status
      );
    }

    if (response.status >= 400) {
      let errBody: unknown = null;
      try {
        errBody = await response.json();
      } catch {
        errBody = await response.text().catch(() => '');
      }
      throw new MerltBadRequestError(`MERL-T ${response.status} on ${path}`, response.status, errBody);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

let cached: ExpertsClient | null = null;

/** Factory reading from process.env. Honors backend/.env conventions. */
export function createExpertsClient(env: NodeJS.ProcessEnv = process.env): ExpertsClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_EXPERTS_TIMEOUT_MS) || 120000;
  return new ExpertsClient({ baseUrl, apiKey, timeoutMs });
}

export function getExpertsClient(): ExpertsClient {
  if (!cached) cached = createExpertsClient();
  return cached;
}

export function _resetExpertsClientForTests(): void {
  cached = null;
}
