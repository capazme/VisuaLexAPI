/**
 * HTTP client for MERL-T admin/ops endpoints (FastAPI on port 8000).
 *
 * Loop-closure A5: manual RLCF training. Mirrors graphClient.ts (native fetch +
 * AbortController, same MERLT_API_URL / MERLT_TIMEOUT_MS env, reuses the typed
 * error hierarchy). The training run itself is heavy and runs async on MERL-T;
 * this only kicks it off and surfaces the immediate ack.
 *
 * Real MERL-T path (merlt/merlt/api/rlcf_router.py:295):
 *  - POST /api/v1/rlcf/training/start  body: TrainingConfig (all optional, MERL-T
 *    fills defaults) → { success, training_id?, message }
 */

import {
  MerltTimeoutError,
  MerltServerError,
  MerltBadRequestError,
} from './merltClient';

export interface OpsClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
}

/** MERL-T training-start response (rlcf_router.py TrainingStartResponse). */
export interface TrainingStartResponse {
  success: boolean;
  training_id?: string;
  message?: string;
}

/** One tunable inference lever (merlt/api/admin_router.py ConfigItem). */
export interface RuntimeConfigItem {
  key: string;
  kind: 'float' | 'int' | 'bool' | string;
  value: number | boolean;
  default: number | boolean;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  description: string;
  requires_restart: boolean;
}

export class OpsClient {
  constructor(private readonly config: OpsClientConfig) {}

  /** Kick off an RLCF training run. `config` is forwarded verbatim (MERL-T defaults the rest). */
  async startTraining(config: Record<string, unknown> = {}): Promise<TrainingStartResponse> {
    return this.request('POST', '/api/v1/rlcf/training/start', config);
  }

  /** Read the runtime-tunable inference config (admin panel). */
  async getConfig(): Promise<{ params: RuntimeConfigItem[] }> {
    return this.request('GET', '/api/v1/admin/config');
  }

  /** Set one runtime config lever (validated + applied live by MERL-T). */
  async setConfig(key: string, value: number | boolean): Promise<RuntimeConfigItem> {
    return this.request('PUT', `/api/v1/admin/config/${encodeURIComponent(key)}`, { value });
  }

  /**
   * Rebuild the Expert System from the current config — applies construction-time
   * flags (tools / ReAct / neural routing) WITHOUT a container restart. Longer
   * timeout: the rebuild re-wires tools + checkpoints (models are already cached
   * singletons, so a few seconds, not a cold boot).
   */
  async reinitEngine(): Promise<{ reinitialized: boolean; engine: Record<string, unknown> }> {
    return this.request('POST', '/api/v1/admin/engine/reinitialize', undefined, 30000);
  }

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.config.timeoutMs);

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
export function createOpsClient(env: NodeJS.ProcessEnv = process.env): OpsClient {
  const baseUrl = env.MERLT_API_URL || 'http://localhost:8000';
  const apiKey = env.MERLT_API_KEY || undefined;
  const timeoutMs = Number(env.MERLT_TIMEOUT_MS) || 5000;
  return new OpsClient({ baseUrl, apiKey, timeoutMs });
}
