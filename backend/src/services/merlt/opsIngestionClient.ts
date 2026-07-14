/**
 * HTTP client for MERL-T's governed MECHANICAL ingestion admin endpoints
 * (FastAPI on port 8000, prefix /api/v1/ingestion/mechanical).
 *
 * Mirrors opsClient.ts exactly: native fetch + AbortController, the same
 * MERLT_API_URL / MERLT_API_KEY / MERLT_TIMEOUT_MS env config, X-API-Key auth
 * (NOT Authorization: Bearer), and REUSES merltClient's typed error hierarchy
 * (do not redefine).
 *
 * Do not confuse with ingestionClient.ts — that one proxies the INTERPRETIVE
 * community ingestion pipeline (consent-gated, non-admin). This client proxies
 * the deterministic, admin-governed batch pipeline that turns a corpus source
 * (VisuaLex article tree / italia-corpus) into staged graph batches subject to
 * admin review before promotion.
 */

import {
  MerltTimeoutError,
  MerltServerError,
  MerltBadRequestError,
} from './merltClient';

export interface OpsIngestionClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

/** POST /api/v1/ingestion/mechanical/run request body (created_by injected server-side). */
export interface RunIngestionRequest {
  source: 'visualex_tree' | 'italia_corpus';
  source_ref: string;
  scope_label: string;
  created_by: string;
}

/** POST /api/v1/ingestion/mechanical/run response — job accepted, runs async. */
export interface RunIngestionResponse {
  batch_id: string;
  job_id: string;
}

/** GET /api/v1/ingestion/mechanical/batches response. */
export interface ListBatchesResponse {
  batches: Array<Record<string, unknown>>;
}

/** GET /api/v1/ingestion/mechanical/batches/{batchId} query. */
export interface GetBatchQuery {
  node_limit?: number;
  edge_limit?: number;
  [k: string]: string | number | undefined;
}

/** POST /api/v1/ingestion/mechanical/batches/{batchId}/promote request body (reviewed_by injected server-side). */
export interface PromoteBatchRequest {
  force: boolean;
  reason?: string;
  reviewed_by: string;
}

/** POST /api/v1/ingestion/mechanical/batches/{batchId}/promote response — async, job queued. */
export interface PromoteBatchResponse {
  batch_id: string;
  job_id: string;
  status: 'promoting';
}

/** POST /api/v1/ingestion/mechanical/batches/{batchId}/reject request body (reviewed_by injected server-side). */
export interface RejectBatchRequest {
  reason: string;
  reviewed_by: string;
}

/** POST /api/v1/ingestion/mechanical/batches/{batchId}/reject response. */
export interface RejectBatchResponse {
  batch_id: string;
  status: 'rejected';
}

export class OpsIngestionClient {
  constructor(private readonly config: OpsIngestionClientConfig) {}

  /** Kick off a mechanical ingestion run. Returns immediately; MERL-T runs the batch async. */
  async run(payload: RunIngestionRequest): Promise<RunIngestionResponse> {
    return this.request('POST', '/api/v1/ingestion/mechanical/run', payload);
  }

  /** List ingestion batches, optionally filtered by status, with pagination. */
  async listBatches(query: { status?: string; limit?: number; offset?: number } = {}): Promise<ListBatchesResponse> {
    return this.request('GET', '/api/v1/ingestion/mechanical/batches', undefined, query);
  }

  /** Read a single batch's detail — conflict report + node/edge sample. */
  async getBatch(batchId: string, query: GetBatchQuery = {}): Promise<Record<string, unknown>> {
    return this.request(
      'GET',
      `/api/v1/ingestion/mechanical/batches/${encodeURIComponent(batchId)}`,
      undefined,
      query
    );
  }

  /** Promote a pending-review batch into the graph. Async: 200 means the job was queued. */
  async promoteBatch(batchId: string, payload: PromoteBatchRequest): Promise<PromoteBatchResponse> {
    return this.request(
      'POST',
      `/api/v1/ingestion/mechanical/batches/${encodeURIComponent(batchId)}/promote`,
      payload
    );
  }

  /** Reject a pending-review batch. */
  async rejectBatch(batchId: string, payload: RejectBatchRequest): Promise<RejectBatchResponse> {
    return this.request(
      'POST',
      `/api/v1/ingestion/mechanical/batches/${encodeURIComponent(batchId)}/reject`,
      payload
    );
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>
  ): Promise<T> {
    let url = `${this.config.baseUrl}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) params.set(key, String(value));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }

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

/** Factory reading from process.env. Honors backend/.env conventions. */
export function createOpsIngestionClient(env: NodeJS.ProcessEnv = process.env): OpsIngestionClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_TIMEOUT_MS) || 5000;
  return new OpsIngestionClient({ baseUrl, apiKey, timeoutMs });
}
