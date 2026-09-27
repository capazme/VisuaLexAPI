import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { it } from 'date-fns/locale';
import { BookOpen, Check, ChevronDown, SkipForward, ThumbsUp, X } from 'lucide-react';
import type { SearchParams } from '../../../types';
import { cn } from '../../../lib/utils';
import { formatFonte, normRefToSearchParams, REJECT_REASONS } from './provenance';
import type { MerltVote } from './validateApi';

/**
 * One community proposal in the validation queue (Slice 3 §3.6 / D4). Because
 * junk is kept visible (D4), downvoting must be effortless: every card shows
 * provenance (which pipeline proposed it + when) and a link to the source norm,
 * and offers a one-tap "Rifiuta" (with optional quick-reasons) plus a "Salta"
 * that defers without voting.
 */

export interface ValidationCardModel {
  id: string;
  /** Primary label (entity name / relation type). */
  title: string;
  /** Optional body text (description / evidence). */
  body?: string;
  /** Provenance: which pipeline/source proposed it. */
  fonte?: string;
  /** Provenance: who contributed it. */
  contributedBy?: string;
  /** Provenance: ISO timestamp. */
  createdAt?: string;
  votes?: number;
  /** Norm reference (bare URN or Normattiva URL) for the "Apri la norma" link. */
  normRef?: string;
}

export interface ValidationCardProps {
  item: ValidationCardModel;
  /** Approve / reject vote (reject may carry an optional quick-reason). */
  onVote: (id: string, vote: MerltVote, reason?: string) => void;
  /** Defer without voting — removes the card locally, no server call. */
  onSkip: (id: string) => void;
  /** Open the source norm in the reading view (navigate + triggerSearch). */
  onOpenNorm: (params: SearchParams) => void;
}

function formatWhen(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDistanceToNow(d, { addSuffix: true, locale: it });
}

export function ValidationCard({ item, onVote, onSkip, onOpenNorm }: ValidationCardProps) {
  const [reasonsOpen, setReasonsOpen] = useState(false);

  const when = formatWhen(item.createdAt);
  const normParams = normRefToSearchParams(item.normRef);

  const reject = (reason?: string): void => {
    setReasonsOpen(false);
    onVote(item.id, 'reject', reason);
  };

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-slate-900 dark:text-white">{item.title}</p>
          {item.body && (
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{item.body}</p>
          )}

          {/* Provenance line: pipeline · contributor · when (D4 obligation). */}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-400">
            <span data-testid="provenance-fonte">{formatFonte(item.fonte)}</span>
            {item.contributedBy && item.contributedBy !== 'unknown' && (
              <span>· da {item.contributedBy}</span>
            )}
            {when && <span>· {when}</span>}
            {typeof item.votes === 'number' && <span>· {item.votes} voti</span>}
          </p>

          {/* Link to the source norm — opens the article in the reading view. */}
          {normParams && (
            <button
              type="button"
              onClick={() => onOpenNorm(normParams)}
              className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              <BookOpen size={13} /> Apri la norma
            </button>
          )}
        </div>

        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            aria-label={`Approva ${item.title}`}
            onClick={() => onVote(item.id, 'approve')}
            className="rounded-lg border border-emerald-200 p-2 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-900 dark:hover:bg-emerald-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <ThumbsUp size={16} />
          </button>
          <button
            type="button"
            aria-label={`Rifiuta ${item.title}`}
            onClick={() => reject()}
            className="rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <X size={16} />
          </button>
          <button
            type="button"
            aria-label={`Motivo del rifiuto per ${item.title}`}
            aria-expanded={reasonsOpen}
            onClick={() => setReasonsOpen((o) => !o)}
            className={cn(
              'rounded-lg border p-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
              reasonsOpen
                ? 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'
                : 'border-slate-200 text-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800',
            )}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            aria-label={`Salta ${item.title}`}
            onClick={() => onSkip(item.id)}
            className="rounded-lg border border-slate-200 p-2 text-slate-400 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          >
            <SkipForward size={16} />
          </button>
        </div>
      </div>

      {/* Optional quick-reasons for a documented reject — the effortless downvote. */}
      {reasonsOpen && (
        <div data-testid="reject-reasons" className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
          <span className="self-center text-xs text-slate-400">Rifiuta perché:</span>
          {REJECT_REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => reject(r.value)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:border-red-300 hover:bg-red-50 hover:text-red-600 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-red-950/40 dark:hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              <Check size={12} /> {r.label}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}
