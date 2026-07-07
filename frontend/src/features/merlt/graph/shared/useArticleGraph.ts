import { useCallback, useEffect, useState } from 'react';
import { fetchArticleGraph } from './graphApi';
import { transformSubgraphResponse, type GraphElements } from './graphTransform';
import type { SubgraphResponse } from './types';

/**
 * F1 (Wave 2): SWR async-state union.
 *
 *  - 'loading'      → very FIRST load: nothing was ever rendered for this hook,
 *                     the consumer may show a full skeleton.
 *  - 'revalidating' → a fetch is in flight but the PREVIOUS non-empty graph is
 *                     still available (`data`/`elements` are the previous
 *                     payload). Consumers must keep the canvas mounted and show
 *                     a subtle veil — never a skeleton swap between two graphs.
 *  - 'success'      → settled data for the current key. Also the state while a
 *                     cache-served entry silently revalidates in background.
 */
export type ArticleGraphState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'revalidating'; data: SubgraphResponse; elements: GraphElements }
  | { status: 'success'; data: SubgraphResponse; elements: GraphElements }
  | { status: 'error'; error: Error };

export type UseArticleGraphResult = ArticleGraphState & { refetch: () => void };

interface CacheEntry {
  data: SubgraphResponse;
  elements: GraphElements;
}

/**
 * Module-level LRU (stale-while-revalidate) cache. Keyed on the NORMALIZED urn
 * (version marker stripped, gotcha #6) + depth + limit, so `!vig=` variants of
 * the same article share an entry. Empty subgraphs are intentionally NOT
 * cached: an empty result is the lazy-ingestion trigger, and serving it from
 * cache as instant 'success' would re-enqueue spurious ingestion jobs.
 */
const CACHE_MAX = 30;
const cache = new Map<string, CacheEntry>();

/** Strip the NIR version/annex marker (`!vig=`, …) — mirrors the BFF's normalizeGraphUrn. */
function normalizeUrn(urn: string): string {
  const i = urn.indexOf('!');
  return i === -1 ? urn : urn.slice(0, i);
}

function cacheKey(urn: string, depth: number, limit?: number): string {
  return `${normalizeUrn(urn)}|${depth}|${limit ?? ''}`;
}

function cacheGet(key: string): CacheEntry | undefined {
  const hit = cache.get(key);
  if (hit) {
    // LRU touch: re-insert so iteration order tracks recency.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function cacheSet(key: string, entry: CacheEntry): void {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Test-only: wipe the module-level SWR cache so tests stay isolated. */
export function _clearArticleGraphCache(): void {
  cache.clear();
}

function hasGraphData(
  state: ArticleGraphState
): state is Extract<ArticleGraphState, { status: 'success' | 'revalidating' }> {
  return state.status === 'success' || state.status === 'revalidating';
}

/** State to show for a (new) key, derived during render — never in an effect. */
function stateForKey(
  key: string | null,
  prev: ArticleGraphState,
  forced: boolean
): ArticleGraphState {
  if (!key) return { status: 'idle' };
  if (!forced) {
    const hit = cacheGet(key);
    // SWR instant serve: cached entry shown as settled; background revalidation
    // (the effect below) updates it if the server payload changed.
    if (hit) return { status: 'success', data: hit.data, elements: hit.elements };
  }
  // Keep the previous NON-EMPTY graph rendered while the new key loads. An
  // empty previous payload has nothing on screen worth preserving → 'loading'.
  if (hasGraphData(prev) && prev.data.nodes.length > 0) {
    return { status: 'revalidating', data: prev.data, elements: prev.elements };
  }
  return { status: 'loading' };
}

/** Cheap deep-equality for the fetch payload — keeps references stable when a revalidation returns identical data. */
function sameResponse(a: SubgraphResponse, b: SubgraphResponse): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fetch the subgraph around an article URN and expose it as a discriminated
 * async-state union, with the G6-ready elements pre-transformed.
 *
 * F1: stale-while-revalidate — cached keys are served instantly ('success')
 * and revalidated in background; navigating to a NEW key keeps the previous
 * elements rendered ('revalidating') instead of swapping in a skeleton.
 *
 * Passing `null`/`undefined` keeps the hook idle (no request). A stale response
 * (key changed or component unmounted mid-flight) is discarded.
 */
export function useArticleGraph(
  articleUrn: string | null | undefined,
  depth = 2,
  limit?: number
): UseArticleGraphResult {
  const key = articleUrn ? cacheKey(articleUrn, depth, limit) : null;
  const [state, setState] = useState<ArticleGraphState>(() =>
    stateForKey(key, { status: 'idle' }, false)
  );
  // Bumped by refetch() to force the effect to re-run (bypassing the cache serve).
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // Transition state when the inputs change — during render, not in the effect,
  // so we never setState synchronously inside useEffect (react-hooks rule,
  // gotcha #11). The effect below only does async setState.
  const [tracked, setTracked] = useState({ key, nonce });
  if (tracked.key !== key || tracked.nonce !== nonce) {
    // Same key + nonce bump = explicit refetch → skip the cache serve (the user
    // asked for fresh data; the previous payload stays visible via 'revalidating').
    const forced = tracked.key === key;
    setTracked({ key, nonce });
    setState((prev) => stateForKey(key, prev, forced));
  }

  useEffect(() => {
    if (!articleUrn || !key) return;

    let cancelled = false;

    fetchArticleGraph(articleUrn, depth, limit)
      .then((data) => {
        if (cancelled) return;
        const elements = transformSubgraphResponse(data);
        if (data.nodes.length > 0) cacheSet(key, { data, elements });
        setState((prev) => {
          // Unchanged payload → keep the existing references so consumers'
          // memos (and the canvas data signature) see no spurious change.
          if (hasGraphData(prev) && sameResponse(prev.data, data)) {
            return prev.status === 'success'
              ? prev
              : { status: 'success', data: prev.data, elements: prev.elements };
          }
          return { status: 'success', data, elements };
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState((prev) => {
          // A failed BACKGROUND revalidation of a cache-served key keeps the
          // stale-but-valid graph (classic SWR). Log — never silent (gotcha #18).
          if (prev.status === 'success') {
            console.error('useArticleGraph: background revalidation failed, keeping cached graph:', err);
            return prev;
          }
          return { status: 'error', error: err instanceof Error ? err : new Error(String(err)) };
        });
      });

    return () => {
      cancelled = true;
    };
  }, [articleUrn, key, depth, limit, nonce]);

  return { ...state, refetch };
}
