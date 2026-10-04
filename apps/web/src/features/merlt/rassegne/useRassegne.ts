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

export type RassegneState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: RassegneResponse }
  | { status: 'error' };

export function useRassegneSummary(urn: string | undefined, archivio?: 'civile' | 'penale'): RassegneState {
  const key = urn ? `${urn}|${archivio ?? ''}` : null;
  const initial: RassegneState = key ? { status: 'loading' } : { status: 'idle' };
  const [state, setState] = useState<{ key: string | null; value: RassegneState }>({ key, value: initial });
  if (state.key !== key) setState({ key, value: initial }); // reset during render (set-state-in-effect rule)

  useEffect(() => {
    if (!urn) return;
    let cancelled = false;
    loadRassegne(archivio ? { urn, archivio } : { urn }).then(
      (data) => {
        if (!cancelled) setState({ key, value: { status: 'ready', data } });
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

  return state.key === key ? state.value : initial;
}
