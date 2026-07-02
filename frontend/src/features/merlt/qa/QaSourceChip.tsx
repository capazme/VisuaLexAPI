import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Info, Loader2, Sprout, ThumbsDown, ThumbsUp } from 'lucide-react';
import {
  useFloating,
  useHover,
  useFocus,
  useDismiss,
  useRole,
  useInteractions,
  offset,
  flip,
  shift,
  autoUpdate,
  FloatingPortal,
} from '@floating-ui/react';
import { cn } from '../../../lib/utils';
import { formatRetrievedUrn, CANON_LABEL } from './format';
import type { ConfirmState, QaRetrievedSource, QaSource } from './types';

/**
 * One consulted source (Loop β F.0 Option A): readable label → /grafo, a
 * provenance badge + trust, optional per-source relevance feedback, and
 * "ricorda nel grafo" (confirm-source) only on provisional (live_unconfirmed)
 * nodes. Legal lexicon, no scores/bars/gamification.
 */

export interface QaSourceChipProps {
  source: QaRetrievedSource;
  confirmState?: ConfirmState;
  /** Teaching channel (full consent): omit to hide "ricorda nel grafo". */
  onConfirm?: (s: QaRetrievedSource) => void;
  onRate?: (sourceId: string, relevant: boolean) => void;
  /** Matching LLM-cited source (excerpt/citation/canon) to enrich the tooltip. */
  cited?: QaSource;
}

/**
 * Hover/focus tooltip with the full detail of one consulted source: provenance,
 * trust, URN, node_id, source_url, and — when matched — the cited excerpt and
 * the canon that used it. Tap-toggle on touch via useDismiss.
 */
function SourceInfo({ source, cited }: { source: QaRetrievedSource; cited?: QaSource }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-end',
    middleware: [offset(8), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });
  const hover = useHover(context, { move: false });
  const focus = useFocus(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'tooltip' });
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus, dismiss, role]);
  const excerpt = cited?.citation ?? cited?.excerpt ?? null;

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        aria-label="Dettagli della fonte consultata"
        className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      >
        <Info size={14} />
      </button>
      {open && (
        <FloatingPortal>
          <div
            // eslint-disable-next-line react-hooks/refs -- floating-ui exposes a stable setter, not a ref.current read
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 max-w-xs rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900"
          >
            <dl className="space-y-1.5">
              {cited?.expert && (
                <div>
                  <dt className="text-slate-400">Canone</dt>
                  <dd className="text-slate-700 dark:text-slate-200">{CANON_LABEL[cited.expert] ?? cited.expert}</dd>
                </div>
              )}
              <div>
                <dt className="text-slate-400">Provenienza</dt>
                <dd className="text-slate-700 dark:text-slate-200">
                  {source.provenance ?? 'sconosciuta'}
                  {typeof source.trust === 'number' ? ` · affidabilità ${source.trust.toFixed(2)}` : ''}
                </dd>
              </div>
              {excerpt && (
                <div>
                  <dt className="text-slate-400">Estratto</dt>
                  <dd className="text-slate-700 dark:text-slate-200">{excerpt}</dd>
                </div>
              )}
              <div>
                <dt className="text-slate-400">URN</dt>
                <dd className="break-all font-mono text-[11px] text-slate-600 dark:text-slate-300">{source.urn}</dd>
              </div>
              {source.node_id && (
                <div>
                  <dt className="text-slate-400">node_id</dt>
                  <dd className="break-all font-mono text-[11px] text-slate-500">{source.node_id}</dd>
                </div>
              )}
              {source.source_url && (
                <div>
                  <dt className="text-slate-400">Fonte</dt>
                  <dd>
                    <a
                      href={source.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-primary-600 hover:underline dark:text-primary-400"
                    >
                      {source.source_url}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

const PROVENANCE_META: Record<string, { label: string; stripe: string; chip: string }> = {
  seed: { label: 'fondativa', stripe: 'bg-slate-400', chip: 'text-slate-500 dark:text-slate-400' },
  lazy_ingest: { label: 'acquisita', stripe: 'bg-sky-400', chip: 'text-sky-600 dark:text-sky-400' },
  community_validated: { label: 'validata dalla community', stripe: 'bg-emerald-500', chip: 'text-emerald-600 dark:text-emerald-400' },
  live_confirmed: { label: 'confermata', stripe: 'bg-emerald-500', chip: 'text-emerald-600 dark:text-emerald-400' },
  live_unconfirmed: { label: 'provvisoria', stripe: 'bg-amber-400', chip: 'text-amber-600 dark:text-amber-400' },
};

export function QaSourceChip({ source, confirmState, onConfirm, onRate, cited }: QaSourceChipProps) {
  const meta = (source.provenance && PROVENANCE_META[source.provenance]) || {
    label: source.provenance ?? 'sconosciuta',
    stripe: 'bg-slate-300',
    chip: 'text-slate-400',
  };
  // For provisional (live:) nodes the URN is an opaque hash; prefer the
  // underlying Normattiva URL when known — it gives a readable label AND a
  // navigable /grafo target. A bare live: hash with no source_url isn't
  // navigable, so we render it as plain text (no broken link).
  const displayUrn = source.urn.startsWith('live:') && source.source_url ? source.source_url : source.urn;
  const label = formatRetrievedUrn(displayUrn);
  const navigable = !displayUrn.startsWith('live:');
  const confirmable = source.provenance === 'live_unconfirmed' && !!source.node_id;

  return (
    <li className="relative flex items-start justify-between gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white py-2 pl-4 pr-3 dark:border-slate-700 dark:bg-slate-900">
      <span className={cn('absolute inset-y-0 left-0 w-1', meta.stripe)} aria-hidden="true" />
      <div className="min-w-0">
        {navigable ? (
          <Link
            to={`/grafo?urn=${encodeURIComponent(displayUrn)}`}
            className="truncate font-medium text-slate-800 hover:text-primary-600 dark:text-slate-200 dark:hover:text-primary-400"
            title={displayUrn}
          >
            {label}
          </Link>
        ) : (
          <span className="truncate font-medium text-slate-800 dark:text-slate-200" title={source.urn}>
            {label}
          </span>
        )}
        <p className="mt-0.5 flex items-center gap-2 text-xs">
          <span className={meta.chip}>{meta.label}</span>
          {typeof source.trust === 'number' && (
            <span className="text-slate-400">· affidabilità {source.trust.toFixed(2)}</span>
          )}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <SourceInfo source={source} cited={cited} />
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
        {confirmable && onConfirm && (
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
