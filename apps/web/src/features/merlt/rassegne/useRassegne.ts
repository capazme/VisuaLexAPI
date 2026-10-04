// apps/web/src/features/merlt/rassegne/useRassegne.ts
import { useEffect, useState } from 'react';
import { fetchRassegne } from './rassegneApi';
import type { RassegneQuery, RassegneResponse } from './types';

/**
 * Session cache by query, with in-flight dedupe: the article view is mounted twice (mobile
 * accordion and desktop column), and each copy mounts the panel — one request, not two.
 * A failed load is forgotten so the next mount retries.
 */
const cache = new Map<string, Promise<RassegneResponse>>();

export function _clearRassegneCacheForTests(): void {
  cache.clear();
}

export function loadRassegne(query: RassegneQuery): Promise<RassegneResponse> {
  const key = [query.urn, query.archivio ?? '', query.anno ?? '', query.cursor ?? ''].join('|');
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

type Archivio = 'civile' | 'penale';

export type RassegneState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      data: RassegneResponse;
      /** the archive `data` was loaded for (the filter may already ask for another) */
      archivio?: Archivio;
      /** another archive is loading: `data` is the last summary of this article */
      pending?: boolean;
      /** another archive failed to load: `data` is the last summary of this article */
      failed?: boolean;
    }
  | { status: 'error' };

/**
 * The article's summary for an archive filter. While another archive loads, or after it
 * fails, the last summary of the same article stays: the panel never blanks under the
 * reader's hand (nor loses the focus of the filter button they pressed).
 */
export function useRassegneSummary(urn: string | undefined, archivio?: Archivio): RassegneState {
  const key = urn ? `${urn}|${archivio ?? ''}` : null;
  const initial: RassegneState = key ? { status: 'loading' } : { status: 'idle' };
  const [state, setState] = useState<{ key: string | null; value: RassegneState }>({ key, value: initial });
  const [shown, setShown] = useState<{ urn: string; archivio?: Archivio; data: RassegneResponse } | null>(null);
  if (state.key !== key) setState({ key, value: initial }); // reset during render (set-state-in-effect rule)

  useEffect(() => {
    if (!urn) return;
    let cancelled = false;
    loadRassegne(archivio ? { urn, archivio } : { urn }).then(
      (data) => {
        if (cancelled) return;
        setState({ key, value: { status: 'ready', data, archivio } });
        setShown({ urn, archivio, data });
      },
      (err: unknown) => {
        console.error('[rassegne] load failed', { urn, archivio, err });
        if (!cancelled) setState({ key, value: { status: 'error' } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [urn, archivio, key]);

  const value = state.key === key ? state.value : initial;
  if (value.status === 'ready' || !urn || !shown || shown.urn !== urn) return value;
  return {
    status: 'ready', data: shown.data, archivio: shown.archivio,
    pending: value.status === 'loading', failed: value.status === 'error',
  };
}
