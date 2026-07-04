/**
 * In-memory TTL + LRU cache for MERL-T subgraph responses (P1.12).
 *
 * Used by GET /api/merlt/graph/article/:urn. The subgraph is the same for
 * every user (the route is authenticate-only, no per-user data), so entries
 * are keyed on (normalizedUrn, depth, limit) with no user dimension.
 *
 * Design notes:
 *  - Single-instance in-memory state is a deliberate tradeoff — the deployment
 *    is single-instance, same rationale as circuit_breaker.py's in-memory
 *    registry. A Redis backend is deferred tech debt if scaling is ever needed.
 *  - Request coalescing: concurrent identical requests share ONE upstream call
 *    via the `pending` promise map. Rejections are propagated to every waiter
 *    and are never cached.
 *  - LRU-ish eviction: Map preserves insertion order; a cache hit re-inserts
 *    the entry so the first key is always the least-recently-used one.
 *  - Invalidation: the internal job-callback route calls `invalidateUrn()` when
 *    an ingestion completes, dropping every (depth, limit) combo for that URN
 *    so the next read sees the freshly ingested nodes instead of a stale-empty
 *    subgraph for up to a full TTL.
 *
 * Env config (read by createSubgraphCache):
 *  - MERLT_SUBGRAPH_CACHE_TTL_MS: entry TTL, clamped to [60000, 300000], default 120000.
 *  - MERLT_SUBGRAPH_CACHE_MAX_ENTRIES: LRU bound, default 200.
 */

import type { SubgraphResponse } from '../../schemas/merlt/graph';

interface CacheEntry {
  value: SubgraphResponse;
  expiresAt: number;
}

// NUL cannot appear in a URN / query param, so it is a collision-safe separator.
const KEY_SEPARATOR = '\u0000';

/** Build the cache key. `normalizedUrn` MUST already be normalizeGraphUrn()-ed. */
export function subgraphCacheKey(normalizedUrn: string, depth: number, limit: number): string {
  return `${normalizedUrn}${KEY_SEPARATOR}${depth}${KEY_SEPARATOR}${limit}`;
}

export class SubgraphCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<SubgraphResponse>>();

  constructor(
    readonly ttlMs: number,
    readonly maxEntries: number
  ) {}

  /**
   * Return the cached subgraph for `key`, or run `fetcher` (once, shared by
   * concurrent callers) and cache its result. Errors are never cached: every
   * coalesced waiter receives the same rejection and the next call retries.
   */
  async getOrFetch(
    key: string,
    fetcher: () => Promise<SubgraphResponse>
  ): Promise<SubgraphResponse> {
    const hit = this.entries.get(key);
    if (hit) {
      if (hit.expiresAt > Date.now()) {
        // LRU touch: re-insert so Map iteration order reflects recency.
        this.entries.delete(key);
        this.entries.set(key, hit);
        return hit.value;
      }
      this.entries.delete(key);
    }

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const fetchPromise = fetcher().then(
      (value) => {
        this.pending.delete(key);
        this.store(key, value);
        return value;
      },
      (err: unknown) => {
        this.pending.delete(key);
        throw err;
      }
    );
    this.pending.set(key, fetchPromise);
    return fetchPromise;
  }

  /** Drop every cached (depth, limit) combo for a normalized URN. */
  invalidateUrn(normalizedUrn: string): number {
    const prefix = `${normalizedUrn}${KEY_SEPARATOR}`;
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private store(key: string, value: SubgraphResponse): void {
    // Delete-then-set so a refreshed key moves to the most-recent position.
    this.entries.delete(key);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Factory reading from process.env. Honors backend/.env conventions. */
export function createSubgraphCache(env: NodeJS.ProcessEnv = process.env): SubgraphCache {
  const rawTtl = Number(env.MERLT_SUBGRAPH_CACHE_TTL_MS);
  const ttlMs =
    Number.isFinite(rawTtl) && rawTtl > 0 ? clampNumber(rawTtl, 60_000, 300_000) : 120_000;

  const rawMax = Number(env.MERLT_SUBGRAPH_CACHE_MAX_ENTRIES);
  const maxEntries = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 200;

  return new SubgraphCache(ttlMs, maxEntries);
}
