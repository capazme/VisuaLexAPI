/**
 * HTTP client for the MERL-T contribution/extraction endpoints (Slice 2c).
 *
 * Mirrors graphClient.ts: native fetch + AbortController, same timeout/env
 * config, and REUSES merltClient's typed error hierarchy (do not redefine).
 *
 * MERL-T paths (merlt/merlt/api/document_router.py + enrichment_router.py):
 *  - POST /api/v1/documents/upload                  (multipart) → { document_id, duplicate? }
 *  - POST /api/v1/documents/{id}/extract-async      { user_id, options:{bff_job_id} } → { task_id }
 *  - GET  /api/v1/documents/{id}/candidates?contributor_id=<id>  → { candidates: [...] }
 *  - GET  /api/v1/candidates/{id}                   → ExtractionCandidate (incl. verbatim)
 *  - POST /api/v1/enrichment/propose-entity         → { pending_id, entity_id }
 *  - POST /api/v1/enrichment/propose-relation       → { pending_id, relation_id }
 *  - POST /api/v1/candidates/{id}/mark-promoted     → { ok }
 *
 * Error mapping is identical to graphClient (timeout/5xx → 503, 4xx → passthrough).
 */

import { MerltTimeoutError, MerltServerError, MerltBadRequestError } from './merltClient';

export interface ContribClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

export interface ExtractAsyncResponse {
  task_id: string;
}

export interface ExtractionCandidate {
  id: number;
  candidate_type: 'entity' | 'relation';
  entity_text?: string;
  relation_type?: string;
  source_node_urn?: string;
  target_entity_id?: string;
  descrizione?: string;
  verbatim_excerpt?: string;
  llm_confidence?: number;
  potential_duplicate_of?: string | null;
  status?: string;
}

export interface ListCandidatesResponse {
  candidates: ExtractionCandidate[];
}

export interface ProposeEntityPayload {
  article_urn: string;
  nome: string;
  tipo: string;
  descrizione: string;
  fonte: string;
  contributed_by: string;
  // MERL-T's Pydantic model requires `user_id` (the same VisuaLex id we already
  // send as `contributed_by`); omitting it returns 422 → BFF surfaces 503.
  user_id: string;
  source_document_id?: number;
}

export interface ProposeRelationPayload {
  article_urn: string;
  source_urn: string;
  target_entity_id: string;
  tipo_relazione: string;
  descrizione: string;
  fonte: string;
  contributed_by: string;
  user_id: string;
  source_document_id?: number;
}

export interface ProposeResponse {
  success?: boolean;
  message?: string;
  /** Entity proposals nest the new pending id under `pending_entity.id`. */
  pending_entity?: { id: string } | null;
  /** Relation proposals return a top-level `relation_id`. */
  relation_id?: string | null;
  /** Set when MERL-T defers on a possible duplicate (no pending_* row created). */
  has_duplicates?: boolean;
  duplicate_action_required?: boolean;
}

export type MerltVote = 'approve' | 'reject' | 'edit';

export interface PendingQueueResponse {
  pending_entities: unknown[];
  pending_relations: unknown[];
  total_entities: number;
  total_relations: number;
  user_can_vote: number;
}

export interface ValidateEntityPayload {
  entity_id: string;
  vote: MerltVote;
  user_id: string;
  reason?: string;
}

export interface ValidateRelationPayload {
  relation_id: string;
  vote: MerltVote;
  user_id: string;
  reason?: string;
}

export interface UploadDocumentInput {
  file: Buffer | Blob;
  filename: string;
  contentType: string;
  userId: string;
  documentType?: string;
  legalDomain?: string;
  title?: string;
}

export interface UploadDocumentResponse {
  document_id: number;
  duplicate?: boolean;
}

export class ContribClient {
  constructor(private readonly config: ContribClientConfig) {}

  async uploadDocument(input: UploadDocumentInput): Promise<UploadDocumentResponse> {
    const form = new FormData();
    const blob =
      input.file instanceof Blob
        ? input.file
        : new Blob([input.file], { type: input.contentType });
    form.append('file', blob, input.filename);
    form.append('user_id', input.userId);
    if (input.documentType) form.append('document_type', input.documentType);
    if (input.legalDomain) form.append('legal_domain', input.legalDomain);
    if (input.title) form.append('title', input.title);
    return this.send('POST', '/api/v1/documents/upload', form);
  }

  async extractAsync(
    documentId: number,
    userId: string,
    bffJobId: string,
  ): Promise<ExtractAsyncResponse> {
    return this.request('POST', `/api/v1/documents/${documentId}/extract-async`, {
      user_id: userId,
      options: { bff_job_id: bffJobId },
    });
  }

  async listCandidates(documentId: number, contributorId: string): Promise<ListCandidatesResponse> {
    const qs = new URLSearchParams({ contributor_id: contributorId }).toString();
    return this.request('GET', `/api/v1/documents/${documentId}/candidates?${qs}`);
  }

  async getCandidate(candidateId: number): Promise<ExtractionCandidate> {
    return this.request('GET', `/api/v1/candidates/${candidateId}`);
  }

  async proposeEntity(payload: ProposeEntityPayload): Promise<ProposeResponse> {
    return this.request('POST', '/api/v1/enrichment/propose-entity', payload);
  }

  async proposeRelation(payload: ProposeRelationPayload): Promise<ProposeResponse> {
    return this.request('POST', '/api/v1/enrichment/propose-relation', payload);
  }

  async markPromoted(candidateId: number): Promise<unknown> {
    return this.request('POST', `/api/v1/candidates/${candidateId}/mark-promoted`, {});
  }

  // ---- Validation (Slice 2c #8) -------------------------------------------

  async getPending(limit = 50, userId?: string): Promise<PendingQueueResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    // Forward the voter id so MERL-T excludes items this user already voted on
    // (it defaults to 'anonymous' otherwise → voted items reappear every reload).
    if (userId) params.set('user_id', userId);
    return this.request('GET', `/api/v1/enrichment/pending?${params.toString()}`);
  }

  async validateEntity(payload: ValidateEntityPayload): Promise<unknown> {
    return this.request('POST', '/api/v1/enrichment/validate-entity', payload);
  }

  async validateRelation(payload: ValidateRelationPayload): Promise<unknown> {
    return this.request('POST', '/api/v1/enrichment/validate-relation', payload);
  }

  /** JSON request/response. */
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    return this.dispatch<T>(method, path, {
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  /** Multipart request (FormData sets its own Content-Type boundary). */
  private async send<T>(method: 'POST', path: string, form: FormData): Promise<T> {
    return this.dispatch<T>(method, path, { body: form });
  }

  private async dispatch<T>(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: string | FormData },
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    // MERL-T auth scheme is X-API-Key, NOT Authorization: Bearer (verify_api_key
    // reads the X-API-Key header alias) — see graphClient/opsClient.
    if (this.config.apiKey) headers['X-API-Key'] = this.config.apiKey;

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body: init.body, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new MerltTimeoutError(`Timeout after ${this.config.timeoutMs}ms calling ${path}`);
      }
      throw new MerltTimeoutError(
        `Network error calling ${path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    clearTimeout(timer);

    if (response.status >= 500) {
      const text = await response.text().catch(() => '');
      throw new MerltServerError(`MERL-T ${response.status} on ${path}: ${text.slice(0, 200)}`, response.status);
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

/** Factory reading from process.env (same conventions as createGraphClient). */
export function createContribClient(env: NodeJS.ProcessEnv = process.env): ContribClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_CONTRIB_TIMEOUT_MS) || Number(env.MERLT_TIMEOUT_MS) || 30000;
  return new ContribClient({ baseUrl, apiKey, timeoutMs });
}
