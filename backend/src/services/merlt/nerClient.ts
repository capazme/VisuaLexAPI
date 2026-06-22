/**
 * HTTP client for MERL-T NER feedback (FastAPI :8000).
 *
 * Loop β #2 (NER via RLCF). Mirrors expertsClient.ts: native fetch +
 * AbortController, reuses merltClient.ts's typed error hierarchy. Feedback is a
 * fast insert, so a short timeout (MERLT_NER_TIMEOUT_MS, default 10s) is fine —
 * never the long expert-query timeout.
 *
 * Real MERL-T paths (merlt/merlt/api/ner_router.py):
 *  - POST /api/v1/ner/feedback
 *  - GET  /api/v1/ner/feedback/stats
 */

import {
  MerltTimeoutError,
  MerltServerError,
  MerltBadRequestError,
} from './merltClient';

export interface NerClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

export type NerSurface = 'article_xref' | 'qa_chip' | 'implicit' | 'search_mining';
export type NerFeedbackType = 'confirmation' | 'correction' | 'false_positive' | 'missed';

/** Payload toward MERL-T — snake_case, user_id injected by the route. */
export interface NerFeedbackArgs {
  user_id: string;
  source_surface: NerSurface;
  feedback_type: NerFeedbackType;
  article_urn?: string;
  selected_text?: string;
  start_offset?: number;
  end_offset?: number;
  context_window?: string;
  original_parsed?: Record<string, unknown>;
  correct_reference?: Record<string, unknown>;
  confidence_before?: number;
}

export interface NerFeedbackResponse {
  received: boolean;
  feedback_id: string;
  sample_weight: number;
}

export interface NerFeedbackStats {
  total: number;
  untrained: number;
  by_type: Record<string, number>;
  by_surface: Record<string, number>;
}

export interface NerTrainingStartArgs {
  n_iter?: number;
  only_untrained?: boolean;
}

export interface NerTrainingStartResponse {
  task_id: string;
  status: string;
}

export interface NerTrainingJobStatus {
  task_id: string;
  status: string;
  result?: Record<string, unknown> | null;
  error?: string;
}

export class NerClient {
  constructor(private readonly config: NerClientConfig) {}

  submitFeedback(a: NerFeedbackArgs): Promise<NerFeedbackResponse> {
    return this.request('POST', '/api/v1/ner/feedback', a);
  }

  stats(): Promise<NerFeedbackStats> {
    return this.request('GET', '/api/v1/ner/feedback/stats');
  }

  startTraining(a: NerTrainingStartArgs): Promise<NerTrainingStartResponse> {
    return this.request('POST', '/api/v1/ner/training/start', a);
  }

  trainingStatus(jobId: string): Promise<NerTrainingJobStatus> {
    return this.request('GET', `/api/v1/ner/training/jobs/${encodeURIComponent(jobId)}`);
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
    // MERL-T auth scheme is X-API-Key, NOT Authorization: Bearer (verify_api_key
    // reads the X-API-Key header alias) — see graphClient/opsClient.
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

let cached: NerClient | null = null;

/** Factory reading from process.env. Honors backend/.env conventions. */
export function createNerClient(env: NodeJS.ProcessEnv = process.env): NerClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_NER_TIMEOUT_MS) || 10000;
  return new NerClient({ baseUrl, apiKey, timeoutMs });
}

export function getNerClient(): NerClient {
  if (!cached) cached = createNerClient();
  return cached;
}

export function _resetNerClientForTests(): void {
  cached = null;
}
