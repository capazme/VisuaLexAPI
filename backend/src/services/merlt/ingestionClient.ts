/**
 * HTTP client for the MERL-T ExternalIngestionPipeline endpoints (FastAPI on
 * port 8000). Wires VisuaLex user knowledge (annotations, dossier groupings,
 * manual submissions, search-miss follow-ups) into the central graph.
 *
 * Mirrors graphClient.ts exactly: native fetch + AbortController, the same
 * timeout pattern, the same MERLT_API_URL / MERLT_TIMEOUT_MS env config, and
 * it REUSES merltClient's typed error hierarchy (do not redefine).
 *
 * Real MERL-T paths (from merlt/merlt/api/ingestion_api.py, prefix
 * /api/v1/ingestion, mounted in merlt/app.py):
 *  - POST /api/v1/ingestion/process   body IngestionRequestModel
 *  - POST /api/v1/ingestion/preview   body IngestionRequestModel (dry-run)
 *  - GET  /api/v1/ingestion/pending?limit=<n>
 *  - POST /api/v1/ingestion/validate  body ValidationVoteModel
 *
 * Errors:
 *  - MerltTimeoutError    → BFF responds 503 (network/timeout)
 *  - MerltServerError     → BFF responds 503 (5xx from MERL-T)
 *  - MerltBadRequestError → BFF passes status through (4xx from MERL-T)
 */

import {
  MerltTimeoutError,
  MerltServerError,
  MerltBadRequestError,
} from './merltClient';

export interface IngestionClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

/** SuggestedRelationModel (ingestion_api.py). */
export interface SuggestedRelation {
  source_urn: string;
  target_urn: string;
  relation_type: string;
  evidence: string;
  /** Defaults to 0.7 on the MERL-T side when omitted. */
  confidence?: number;
}

/**
 * IngestionRequestModel (ingestion_api.py). `user_id` and `user_authority`
 * are always injected server-side by the BFF route — never trust a
 * client-supplied authority.
 */
export interface IngestionRequest {
  source: string;
  user_id: string;
  user_authority: number;
  tipo_atto: string;
  articolo: string;
  trigger: 'annotation' | 'dossier_grouping' | 'manual' | 'search_not_found';
  suggested_relations: SuggestedRelation[];
  metadata?: Record<string, unknown>;
}

/** IngestionResponseModel (ingestion_api.py). */
export interface IngestionResponse {
  success: boolean;
  status: 'auto_approved' | 'pending_validation' | 'completed' | 'failed';
  reason: string;
  preview: Record<string, unknown>;
  pending_id?: string | null;
  required_approvals: number;
  article_urn?: string | null;
  nodes_created: string[];
  relations_created: string[];
  errors: string[];
  processed_at: string;
}

/** PendingValidationModel (ingestion_api.py). */
export interface PendingValidation {
  id: string;
  type: string;
  target_urn: string;
  contributor_id: string;
  contributor_authority: number;
  source: string;
  trigger: string;
  created_at: string;
  expires_at: string;
  approvals: number;
  rejections: number;
  required_approvals: number;
  status: string;
}

/**
 * ValidationVoteModel (ingestion_api.py). `voter_id` and `voter_authority`
 * are injected server-side by the BFF route, same rule as user_authority.
 */
export interface ValidationVoteRequest {
  pending_id: string;
  voter_id: string;
  voter_authority: number;
  vote: boolean;
  reason?: string;
}

/**
 * The /validate endpoint returns a loose Dict[str, Any] on the MERL-T side
 * (not a Pydantic response_model) — these are the fields the pipeline
 * actually populates (see validate_pending in ingestion_api.py).
 */
export interface ValidationVoteResponse {
  success: boolean;
  vote_recorded: boolean;
  pending_status: 'pending' | 'approved' | 'rejected';
  message: string;
}

export class IngestionClient {
  constructor(private readonly config: IngestionClientConfig) {}

  /** POST /api/v1/ingestion/process — the real write. */
  async processIngestion(payload: IngestionRequest): Promise<IngestionResponse> {
    return this.request('POST', '/api/v1/ingestion/process', payload);
  }

  /** POST /api/v1/ingestion/preview — dry-run, no graph mutation. */
  async previewIngestion(payload: IngestionRequest): Promise<IngestionResponse> {
    return this.request('POST', '/api/v1/ingestion/preview', payload);
  }

  /** GET /api/v1/ingestion/pending?limit=<n> */
  async listPending(limit = 20): Promise<PendingValidation[]> {
    const qs = new URLSearchParams({ limit: String(limit) }).toString();
    return this.request('GET', `/api/v1/ingestion/pending?${qs}`);
  }

  /** POST /api/v1/ingestion/validate */
  async validatePending(payload: ValidationVoteRequest): Promise<ValidationVoteResponse> {
    return this.request('POST', '/api/v1/ingestion/validate', payload);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    // MERL-T auth scheme is X-API-Key, NOT Authorization: Bearer — verify_api_key
    // rejects Bearer with 401 "API key required" (same regression as opsClient.ts).
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
      throw new MerltBadRequestError(
        `MERL-T ${response.status} on ${path}`,
        response.status,
        errBody
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/** Factory reading from process.env. Honors backend/.env conventions. */
export function createIngestionClient(env: NodeJS.ProcessEnv = process.env): IngestionClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_TIMEOUT_MS) || 5000;
  return new IngestionClient({ baseUrl, apiKey, timeoutMs });
}
