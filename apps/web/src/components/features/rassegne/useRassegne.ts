import { useEffect, useState } from 'react';
import { fetchRassegne, RassegneError } from '../../../services/rassegneService';
import type { RassegneQuery, RassegneResponse } from './types';

/**
 * Session cache by query, with in-flight dedupe: the article view is mounted twice (mobile
 * accordion and desktop column), and each copy mounts the panel — one request, not two.
 * A failed load is forgotten so the next mount retries. It holds the words searched (in its
 * keys), so it is cleared at logout (`useAuth`), as the other readers' caches are.
 */
const cache = new Map<string, Promise<RassegneResponse>>();

export function clearRassegneCache(): void {
  cache.clear();
}

export function loadRassegne(query: RassegneQuery): Promise<RassegneResponse> {
  const key = [query.urn, query.archivio ?? '', query.anno ?? '', query.cursor ?? '', query.q ?? ''].join('|');
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchRassegne(query).catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

/**
 * Whether a failed load means there is no route to ask (404: an API older than the web, during a
 * deploy): nothing to offer, as with no store. Anything else — 503 `rassegne_non_disponibili`, a
 * network failure — is a quiet notice in the panel's own row.
 */
export function isAbsent(err: unknown): boolean {
  return err instanceof RassegneError && err.status === 404;
}

/** What the browser's console may hear of a failure: never the words searched. */
export function failureOf(err: unknown): string {
  return err instanceof RassegneError ? err.message : 'rassegne: unexpected failure';
}

type Archivio = 'civile' | 'penale';

export type RassegneState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      data: RassegneResponse;
      /** the archive `data` was loaded for (the filter may already ask for another) */
      archivio?: Archivio;
      /** the words `data` was loaded for (the filter may already ask for others) */
      q?: string;
      /** another archive or search is loading: `data` is the last answer for this norm */
      pending?: boolean;
      /** another archive or search failed to load: `data` is the last answer for this norm */
      failed?: boolean;
    }
  /** `absent`: no route to ask (404), so there is nothing to offer */
  | { status: 'error'; absent: boolean };

/**
 * A norm's summary for an archive filter and a keyword search. While another archive or search
 * loads, or after it fails, the last answer for the same norm stays: the panel never blanks under
 * the reader's hand (nor loses the focus of the control they used).
 */
export function useRassegneSummary(urn: string | undefined, archivio?: Archivio, q?: string): RassegneState {
  const key = urn ? `${urn}|${archivio ?? ''}|${q ?? ''}` : null;
  const initial: RassegneState = key ? { status: 'loading' } : { status: 'idle' };
  const [state, setState] = useState<{ key: string | null; value: RassegneState }>({ key, value: initial });
  const [shown, setShown] = useState<{ urn: string; archivio?: Archivio; q?: string; data: RassegneResponse } | null>(null);
  if (state.key !== key) setState({ key, value: initial }); // reset during render (set-state-in-effect rule)

  useEffect(() => {
    if (!urn) return;
    let cancelled = false;
    loadRassegne({ urn, ...(archivio ? { archivio } : {}), ...(q ? { q } : {}) }).then(
      (data) => {
        if (cancelled) return;
        setState({ key, value: { status: 'ready', data, archivio, q } });
        setShown({ urn, archivio, q, data });
      },
      (err: unknown) => {
        const absent = isAbsent(err);
        // no route is a configuration, not a failure; the words searched stay out of the log
        if (!absent) console.error('[rassegne] load failed', { urn, archivio, searched: Boolean(q), error: failureOf(err) });
        if (!cancelled) setState({ key, value: { status: 'error', absent } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [urn, archivio, q, key]);

  const value = state.key === key ? state.value : initial;
  if (value.status === 'ready' || !urn || !shown || shown.urn !== urn) return value;
  return {
    status: 'ready', data: shown.data, archivio: shown.archivio, q: shown.q,
    pending: value.status === 'loading', failed: value.status === 'error',
  };
}
