/**
 * HTTP client for MERL-T sidecar (FastAPI on port 8000).
 *
 * Slice 1 usage: BFF event routes call sendEvent() after Zod validation +
 * consentGuard. Profile sync (authorityCache) calls getProfile().
 *
 * Errors:
 *  - MerltTimeoutError    → BFF responds 503 (network/timeout)
 *  - MerltServerError     → BFF responds 503 (5xx from MERL-T)
 *  - MerltBadRequestError → BFF passes status through (4xx from MERL-T)
 *  - generic Error        → unexpected (logged, BFF responds 500)
 */

export class MerltClientError extends Error {
  constructor(message: string, public readonly status: number | null) {
    super(message);
    this.name = 'MerltClientError';
  }
}

export class MerltTimeoutError extends MerltClientError {
  constructor(message = 'MERL-T request timed out') {
    super(message, null);
    this.name = 'MerltTimeoutError';
  }
}

export class MerltServerError extends MerltClientError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = 'MerltServerError';
  }
}

export class MerltBadRequestError extends MerltClientError {
  constructor(message: string, status: number, public readonly body: unknown) {
    super(message, status);
    this.name = 'MerltBadRequestError';
  }
}

export interface MerltClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

/**
 * MERL-T tracking event payload after eventMapper translation.
 * Matches the shape MERL-T's POST /api/v1/tracking/events expects:
 *   { events: [{ type, data, timestamp }] }
 * The flat fields from eventMapper become `data`, the `type` is lifted out,
 * and `timestamp` is millis-since-epoch.
 */
export interface MerltTrackingEvent {
  type: string;
  user_id: string;
  user_authority?: number;
  [k: string]: unknown;
}

/**
 * MERL-T profile response shape (from /api/v1/profile/full).
 * Real schema, not the simplified guess of MERLT-1.3.
 */
export interface MerltProfileResponse {
  user_id: string;
  display_name?: string | null;
  authority: {
    score: number;
    tier: string;
    breakdown: {
      baseline: number;
      track_record: number;
      level_authority: number;
    };
    next_tier_threshold?: number;
    progress_to_next?: number;
  };
  domains?: Record<string, { authority: number; contributions: number; success_rate: number }>;
  stats?: {
    total_contributions: number;
    approved: number;
    rejected: number;
    pending: number;
    vote_weight: number;
  };
  recent_activity?: unknown[];
  joined_at?: string | null;
  last_updated?: string | null;
  [k: string]: unknown;
}

export interface MerltHealthResponse {
  status: string;
  [k: string]: unknown;
}

export interface MerltTrackingResponse {
  received: number;
  timestamp: string;
}

export class MerltClient {
  constructor(private readonly config: MerltClientConfig) {}

  /**
   * Send a single tracking event to MERL-T. Internally wraps as batch
   * because MERL-T's endpoint is POST /api/v1/tracking/events (plural)
   * and expects { events: [{ type, data, timestamp }] }.
   */
  async sendEvent(event: MerltTrackingEvent): Promise<MerltTrackingResponse> {
    const { type, ...data } = event;
    const batch = {
      events: [
        {
          type,
          data,
          timestamp: Date.now(),
        },
      ],
    };
    return this.request('POST', '/api/v1/tracking/events', batch);
  }

  async getProfile(userId: string): Promise<MerltProfileResponse> {
    const qs = new URLSearchParams({ user_id: userId }).toString();
    return this.request('GET', `/api/v1/profile/full?${qs}`);
  }

  async healthCheck(): Promise<MerltHealthResponse> {
    return this.request('GET', '/health');
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
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = await response.text().catch(() => '');
      }
      throw new MerltBadRequestError(
        `MERL-T ${response.status} on ${path}`,
        response.status,
        body
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

/** Factory reading from process.env. Honors backend/.env conventions. */
export function createMerltClient(env: NodeJS.ProcessEnv = process.env): MerltClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_TIMEOUT_MS) || 5000;
  return new MerltClient({ baseUrl, apiKey, timeoutMs });
}
