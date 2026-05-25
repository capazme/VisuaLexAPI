import { useCallback, useEffect, useState } from 'react';
import { fetchArticleGraph } from './graphApi';
import { transformSubgraphResponse, type GraphElements } from './graphTransform';
import type { SubgraphResponse } from './types';

export type ArticleGraphState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: SubgraphResponse; elements: GraphElements }
  | { status: 'error'; error: Error };

export type UseArticleGraphResult = ArticleGraphState & { refetch: () => void };

/**
 * Fetch the subgraph around an article URN and expose it as a discriminated
 * async-state union, with the cytoscape-ready elements pre-transformed.
 *
 * Passing `null`/`undefined` keeps the hook idle (no request). A stale response
 * (urn changed or component unmounted mid-flight) is discarded.
 */
export function useArticleGraph(
  articleUrn: string | null | undefined,
  depth = 2,
  limit?: number
): UseArticleGraphResult {
  const [state, setState] = useState<ArticleGraphState>(
    articleUrn ? { status: 'loading' } : { status: 'idle' }
  );
  // Bumped by refetch() to force the effect to re-run for the same urn/depth.
  const [nonce, setNonce] = useState(0);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  // Reset to loading/idle when the inputs change — during render, not in the
  // effect, so we never setState synchronously inside useEffect (react-hooks
  // rule, gotcha #11). The effect below only does async setState.
  const [tracked, setTracked] = useState({ articleUrn, depth, limit, nonce });
  if (
    tracked.articleUrn !== articleUrn ||
    tracked.depth !== depth ||
    tracked.limit !== limit ||
    tracked.nonce !== nonce
  ) {
    setTracked({ articleUrn, depth, limit, nonce });
    setState(articleUrn ? { status: 'loading' } : { status: 'idle' });
  }

  useEffect(() => {
    if (!articleUrn) return;

    let cancelled = false;

    fetchArticleGraph(articleUrn, depth, limit)
      .then((data) => {
        if (cancelled) return;
        setState({ status: 'success', data, elements: transformSubgraphResponse(data) });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ status: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      });

    return () => {
      cancelled = true;
    };
  }, [articleUrn, depth, limit, nonce]);

  return { ...state, refetch };
}
