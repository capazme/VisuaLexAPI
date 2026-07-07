import { Loader2, Scissors } from 'lucide-react';
import type { SubgraphResponse } from '../shared/types';
import { readNodeDegree } from '../shared/types';
import { nextGraphLimit } from '../shared/graphApi';

/**
 * F4 honest truncation (Wave 2): a small chip over the canvas that tells the
 * jurist the rendered neighbourhood is CUT — "Mostro N di M relazioni" — with a
 * "Carica di più" that bumps the fetch limit one ladder step (25→50→100→200,
 * see GRAPH_LIMIT_STEPS) and refetches (the SWR cache keys by limit, so a bump
 * is always a fresh fetch).
 *
 * Reads the Wave-1 subgraph metadata: `metadata.truncated` is the honest
 * signal that the edge query hit its LIMIT. M is best-effort: the CENTER
 * node's full-graph degree (`metadata.degree`) when it is a meaningful upper
 * bound (> shown); otherwise the copy falls back to "molte" — at depth ≥ 2 the
 * cut can land on deeper hops, where the center degree understates the total.
 *
 * Positions itself bottom-center of the canvas (the bottom corners are taken
 * by the "Evidenza fonti" chip and "Adatta alla vista"). Renders null when the
 * subgraph is not truncated, so the page can mount it unconditionally.
 */
export interface GraphTruncationChipProps {
  /** Current subgraph payload (undefined outside the data-bearing states). */
  data: SubgraphResponse | undefined;
  /** Rendered center node id — the degree lookup target for M. */
  centerNodeId: string | null;
  /** Current fetch limit (the ladder position). */
  limit: number;
  /** True while a bigger fetch is in flight (revalidating) — disables the CTA. */
  loading?: boolean;
  /** Called with the NEXT ladder step; the page sets it as the new limit. */
  onLoadMore: (nextLimit: number) => void;
}

export function GraphTruncationChip({
  data,
  centerNodeId,
  limit,
  loading = false,
  onLoadMore,
}: GraphTruncationChipProps): React.ReactElement | null {
  if (!data || data.metadata?.truncated !== true) return null;

  const shown = data.edges.length;
  const centerNode = centerNodeId ? data.nodes.find((n) => n.id === centerNodeId) : undefined;
  const centerDegree = centerNode ? readNodeDegree(centerNode) : undefined;
  // Honest M: only trust the center degree when it actually exceeds what we
  // show — otherwise the cut hit deeper hops and the degree would understate.
  const total = centerDegree !== undefined && centerDegree > shown ? centerDegree : undefined;
  const next = nextGraphLimit(limit);

  return (
    <div
      role="status"
      className="absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 shadow-sm dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300"
    >
      <Scissors size={12} aria-hidden="true" className="shrink-0" />
      <span>
        Mostro {shown} di {total ?? 'molte'} relazioni
      </span>
      {next !== null && (
        <button
          type="button"
          onClick={() => onLoadMore(next)}
          disabled={loading}
          aria-label="Carica più relazioni"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:bg-amber-500 dark:hover:bg-amber-400 dark:text-amber-950"
        >
          {loading ? <Loader2 size={11} className="animate-spin" /> : null}
          Carica di più
        </button>
      )}
    </div>
  );
}
