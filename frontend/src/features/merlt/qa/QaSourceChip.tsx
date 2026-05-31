import { Link } from 'react-router-dom';
import { Check, Loader2, Sprout, ThumbsDown, ThumbsUp } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { formatRetrievedUrn } from './format';
import type { ConfirmState, QaRetrievedSource } from './types';

/**
 * One consulted source (Loop β F.0 Option A): readable label → /grafo, a
 * provenance badge + trust, optional per-source relevance feedback, and
 * "ricorda nel grafo" (confirm-source) only on provisional (live_unconfirmed)
 * nodes. Legal lexicon, no scores/bars/gamification.
 */

export interface QaSourceChipProps {
  source: QaRetrievedSource;
  confirmState?: ConfirmState;
  onConfirm: (s: QaRetrievedSource) => void;
  onRate?: (sourceId: string, relevant: boolean) => void;
}

const PROVENANCE_META: Record<string, { label: string; stripe: string; chip: string }> = {
  seed: { label: 'fondativa', stripe: 'bg-slate-400', chip: 'text-slate-500 dark:text-slate-400' },
  lazy_ingest: { label: 'acquisita', stripe: 'bg-sky-400', chip: 'text-sky-600 dark:text-sky-400' },
  community_validated: { label: 'validata dalla community', stripe: 'bg-emerald-500', chip: 'text-emerald-600 dark:text-emerald-400' },
  live_confirmed: { label: 'confermata', stripe: 'bg-emerald-500', chip: 'text-emerald-600 dark:text-emerald-400' },
  live_unconfirmed: { label: 'provvisoria', stripe: 'bg-amber-400', chip: 'text-amber-600 dark:text-amber-400' },
};

export function QaSourceChip({ source, confirmState, onConfirm, onRate }: QaSourceChipProps) {
  const meta = (source.provenance && PROVENANCE_META[source.provenance]) || {
    label: source.provenance ?? 'sconosciuta',
    stripe: 'bg-slate-300',
    chip: 'text-slate-400',
  };
  const label = formatRetrievedUrn(source.urn);
  const confirmable = source.provenance === 'live_unconfirmed' && !!source.node_id;

  return (
    <li className="relative flex items-start justify-between gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white py-2 pl-4 pr-3 dark:border-slate-700 dark:bg-slate-900">
      <span className={cn('absolute inset-y-0 left-0 w-1', meta.stripe)} aria-hidden="true" />
      <div className="min-w-0">
        <Link
          to={`/grafo?urn=${encodeURIComponent(source.urn)}`}
          className="truncate font-medium text-slate-800 hover:text-primary-600 dark:text-slate-200 dark:hover:text-primary-400"
          title={source.urn}
        >
          {label}
        </Link>
        <p className="mt-0.5 flex items-center gap-2 text-xs">
          <span className={meta.chip}>{meta.label}</span>
          {typeof source.trust === 'number' && (
            <span className="text-slate-400">· affidabilità {source.trust.toFixed(2)}</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onRate && (
          <>
            <button
              type="button"
              aria-label={`Segna ${label} come pertinente`}
              onClick={() => onRate(source.urn, true)}
              className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <ThumbsUp size={14} />
            </button>
            <button
              type="button"
              aria-label={`Segna ${label} come non pertinente`}
              onClick={() => onRate(source.urn, false)}
              className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <ThumbsDown size={14} />
            </button>
          </>
        )}
        {confirmable && (
          <button
            type="button"
            disabled={confirmState === 'pending' || confirmState === 'done'}
            onClick={() => onConfirm(source)}
            className={cn(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
              confirmState === 'done'
                ? 'border-emerald-200 text-emerald-600 dark:border-emerald-900'
                : 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950/40',
            )}
          >
            {confirmState === 'pending' && <Loader2 size={13} className="animate-spin" />}
            {confirmState === 'done' && <Check size={13} />}
            {confirmState !== 'pending' && confirmState !== 'done' && <Sprout size={13} />}
            {confirmState === 'done'
              ? 'Ricordata'
              : confirmState === 'pending'
                ? 'Salvataggio…'
                : confirmState === 'error'
                  ? 'Riprova'
                  : 'Ricorda nel grafo'}
          </button>
        )}
      </div>
    </li>
  );
}
