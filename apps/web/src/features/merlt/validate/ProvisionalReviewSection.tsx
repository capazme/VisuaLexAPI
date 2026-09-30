import { Check, Loader2, ShieldQuestion, ThumbsUp, Trash2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { ProvisionalReviewItem } from './validateApi';

export interface ProvisionalReviewSectionProps {
  items: ProvisionalReviewItem[];
  /** node ids currently being adjudicated (buttons disabled + spinner). */
  pending: Set<string>;
  onAdjudicate: (nodeId: string, decision: 'approve' | 'reject') => void;
}

/**
 * Slice C wave 2: the "doubtful provisional nodes" review section of
 * /merlt/valida. These are graph nodes the hygiene sweep quarantined (faded but
 * with human signal) instead of auto-pruning; a reviewer promotes (approve) or
 * discards (reject) the EXISTING node — there is no consensus queue here, the
 * decision applies immediately.
 */
export function ProvisionalReviewSection({
  items,
  pending,
  onAdjudicate,
}: ProvisionalReviewSectionProps) {
  return (
    <section data-testid="provisional-review">
      <h2 className="mb-1 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
        <ShieldQuestion size={18} className="text-amber-500" />
        Nodi provvisori in revisione
        <span className="text-sm font-normal text-slate-400">({items.length})</span>
      </h2>
      <p className="mb-3 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
        Norme aggiunte automaticamente dalle risposte che stanno svanendo ma hanno ricevuto qualche
        segnale d'uso. Conferma per renderle stabili nel grafo, oppure rimuovile.
      </p>

      {items.length === 0 ? (
        <p className="flex items-center gap-1 text-sm text-slate-400">
          <Check size={14} /> Nessun nodo in attesa di revisione.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ProvisionalReviewCard
              key={item.node_id}
              item={item}
              busy={pending.has(item.node_id)}
              onAdjudicate={onAdjudicate}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ProvisionalReviewCard({
  item,
  busy,
  onAdjudicate,
}: {
  item: ProvisionalReviewItem;
  busy: boolean;
  onAdjudicate: (nodeId: string, decision: 'approve' | 'reject') => void;
}) {
  const label = item.labels.find((l) => l !== 'LiveSource') ?? 'Norma';
  return (
    <li className="relative overflow-hidden rounded-lg border border-slate-200 bg-white pl-4 dark:border-slate-700 dark:bg-slate-800">
      <span className="absolute inset-y-0 left-0 w-1 bg-amber-400" aria-hidden />
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{label}</p>
            {item.source_url && (
              <p className="mt-0.5 truncate text-xs text-slate-400" title={item.source_url}>
                {item.source_url}
              </p>
            )}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onAdjudicate(item.node_id, 'approve')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium',
                'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                'dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50',
                'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
              )}
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <ThumbsUp size={13} />}
              Conferma
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAdjudicate(item.node_id, 'reject')}
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium',
                'bg-rose-50 text-rose-700 hover:bg-rose-100',
                'dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50',
                'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2',
              )}
            >
              <Trash2 size={13} />
              Rimuovi
            </button>
          </div>
        </div>

        {item.text_preview && (
          <p className="mt-2 line-clamp-2 text-xs text-slate-600 dark:text-slate-300">
            {item.text_preview}
          </p>
        )}

        <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
          <Chip>usi: {item.usage_count ?? 0}</Chip>
          <Chip>feedback+: {item.positive_feedback_count ?? 0}</Chip>
          {item.has_confirmed_citation && <Chip>citato da confermati</Chip>}
          <Chip>fiducia: {typeof item.trust === 'number' ? item.trust.toFixed(2) : '—'}</Chip>
        </div>
      </div>
    </li>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
      {children}
    </span>
  );
}
