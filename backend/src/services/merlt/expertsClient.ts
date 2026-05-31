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
 *  - POST /api/v1/experts/feedback/{inline,detailed,source,preference,refine}
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
}

export interface ExpertFeedbackResponse {
  success: boolean;
  feedback_id?: number | null;
  message: string;
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
  refine(a: RefineArgs): Promise<ExpertQueryResponse> {
    return this.request('POST', '/api/v1/experts/feedback/refine', a);
  }
  confirmSource(a: ConfirmSourceArgs): Promise<Record<string, unknown>> {
    return this.request('POST', '/api/v1/enrichment/confirm-source', a);
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
    if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;

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
