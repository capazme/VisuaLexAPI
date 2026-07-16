/**
 * HTTP client for the MERL-T graph endpoints (FastAPI on port 8000).
 *
 * Slice 2a usage: the BFF graph routes call this client after authenticate +
 * (where relevant) consentGuard + Zod. It mirrors merltClient.ts exactly:
 * native fetch + AbortController, the same timeout pattern, the same
 * MERLT_API_URL / MERLT_TIMEOUT_MS env config, and it REUSES merltClient's
 * typed error hierarchy (do not redefine).
 *
 * Real MERL-T paths (from merlt/merlt/api/graph_router.py):
 *  - GET  /api/v1/graph/check-article?article_urn=<urn>
 *  - GET  /api/v1/graph/subgraph?root_urn=<urn>&depth=<n>&max_nodes=<n>
 *  - POST /api/v1/graph/ingest-article  body { urn, options: { bff_job_id } } → 202
 *  - GET  /api/v1/graph/entities/search?q=<q>&limit=<n>   (param is `q`, not `query`)
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
import type {
  SubgraphResponse,
  EntitySearchResponse,
} from '../../schemas/merlt/graph';

export interface GraphClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

/** MERL-T check-article response (graph_router.py:check_article_in_graph). */
export interface CheckArticleResponse {
  exists: boolean;
  node_id?: string;
  pending_validation?: boolean;
}

/** MERL-T ingest-article response (graph_router.py:ingest_article). */
export interface IngestArticleResponse {
  task_id: string;
  status: string;
  urn: string;
}

/** One provisional node flagged for human review (Slice C wave 2). */
export interface ProvisionalReviewItem {
  node_id: string;
  source_url: string | null;
  trust: number | null;
  usage_count: number | null;
  positive_feedback_count: number | null;
  has_confirmed_citation: boolean | null;
  review_reason: string | null;
  review_flagged_at: string | null;
  labels: string[];
  text_preview: string;
}

export interface ProvisionalReviewResponse {
  items: ProvisionalReviewItem[];
  count: number;
}

/** Result of adjudicating a flagged provisional node. */
export interface AdjudicateProvisionalResponse {
  applied: boolean;
  decision?: 'approve' | 'reject';
  node_id: string;
  reason?: string;
}

/**
 * Normalize a VisuaLex URN to the form indexed in the graph.
 *
 * **Anti-regression (vedi CLAUDE.md "URN version-marker mismatch"):**
 * la chiave del grafo è la forma URL Normattiva COMPLETA — `URN`/`node_id`
 * memorizzano "https://www.normattiva.it/uri-res/N2Ls?urn:nir:…~art2043"
 * (wrapper URL **INCLUSO**). VisuaLex e MERL-T producono la stessa forma e
 * fanno match esatto. Quindi qui si strippa SOLO il marker `!vig=`/`!orig=…`
 * (la versione NIR), MAI il prefisso URL. Strippare il wrapper rende il seed
 * Libro IV completamente irreperibile via check-article → /grafo vuoto.
 *
 * Trasforma "…~art2043!vig=" → "…~art2043" e lascia tutto il resto invariato.
 */
export function normalizeGraphUrn(urn: string): string {
  const bang = urn.indexOf('!');
  return bang === -1 ? urn : urn.slice(0, bang);
}

export class GraphClient {
  constructor(private readonly config: GraphClientConfig) {}

  /**
   * Verify whether an article URN is present in the knowledge graph.
   * Query param is `article_urn` (NOT `urn`).
   */
  async checkArticle(urn: string): Promise<CheckArticleResponse> {
    const qs = new URLSearchParams({ article_urn: normalizeGraphUrn(urn) }).toString();
    return this.request('GET', `/api/v1/graph/check-article?${qs}`);
  }

  /**
   * Fetch the subgraph around a root URN for visualization.
   * Query param is `root_urn` (NOT `urn`). The maxNodes default mirrors the
   * MERL-T hard cap (graph_router.py clamps max_nodes to 200) — anything
   * higher would be silently truncated upstream.
   */
  async getSubgraph(urn: string, depth = 2, maxNodes = 200): Promise<SubgraphResponse> {
    const qs = new URLSearchParams({
      root_urn: normalizeGraphUrn(urn),
      depth: String(depth),
      max_nodes: String(maxNodes),
    }).toString();
    return this.request('GET', `/api/v1/graph/subgraph?${qs}`);
  }

  /**
   * Enqueue an article-ingestion job. `bffJobId` is threaded through so the
   * worker can call back POST /api/merlt/internal/job-callback on completion.
   */
  async ingestArticle(urn: string, bffJobId: string): Promise<IngestArticleResponse> {
    return this.request('POST', '/api/v1/graph/ingest-article', {
      urn: normalizeGraphUrn(urn),
      options: { bff_job_id: bffJobId },
    });
  }

  /**
   * Fuzzy entity search for autocomplete. MERL-T's query param is `q`.
   */
  async searchEntities(query: string, limit = 10): Promise<EntitySearchResponse> {
    const qs = new URLSearchParams({ q: query, limit: String(limit) }).toString();
    return this.request('GET', `/api/v1/graph/entities/search?${qs}`);
  }

  /**
   * Slice C wave 2: provisional nodes the hygiene sweep flagged for human review
   * (faded but with accumulated human signal). Surfaced in /merlt/valida.
   */
  async listProvisionalReview(limit = 100): Promise<ProvisionalReviewResponse> {
    const qs = new URLSearchParams({ limit: String(limit) }).toString();
    return this.request('GET', `/api/v1/graph/provisional-review?${qs}`);
  }

  /**
   * Slice C wave 2: apply a human decision to a flagged provisional node —
   * `approve` promotes it in place, `reject` deletes it.
   */
  async adjudicateProvisional(
    nodeId: string,
    decision: 'approve' | 'reject'
  ): Promise<AdjudicateProvisionalResponse> {
    return this.request(
      'POST',
      `/api/v1/graph/provisional-review/${encodeURIComponent(nodeId)}`,
      { decision }
    );
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
export function createGraphClient(env: NodeJS.ProcessEnv = process.env): GraphClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_TIMEOUT_MS) || 5000;
  return new GraphClient({ baseUrl, apiKey, timeoutMs });
}
