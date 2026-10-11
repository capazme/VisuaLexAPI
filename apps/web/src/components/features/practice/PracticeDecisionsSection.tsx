import { useId, useMemo } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { formatDecisionDeposit } from '../../../utils/decisionLinks';
import { decisionOrder, decisionRowKey, type PracticeDecision } from '../../../utils/practice';
import { DecisionEntryView } from '../decisions/DecisionEntryView';

const ICON_BUTTON =
  'flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 md:min-h-0 md:min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:hover:bg-red-900/20';

/**
 * «Giurisprudenza (n)» at the bottom of the practice's column (spec §3.3), only when the practice
 * holds a decision: one row per entry, newest first (`decisionOrder`, T7). A row opens in place on
 * the decision's reading surface (`DecisionEntryView`, hosted by the practice); closed, it mounts
 * nothing, so a decision «Apri tutto» added is not asked for until it is opened (T17).
 */
export function PracticeDecisionsSection({ practiceId }: { practiceId: string }) {
  const decisions = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.decisions);
  const ordered = useMemo(() => decisionOrder(decisions ?? []), [decisions]);
  const headingId = useId();

  if (ordered.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
      <h3 id={headingId} className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Giurisprudenza ({ordered.length})
      </h3>
      <div>
        {ordered.map((entry) => (
          <PracticeDecisionRow key={entry.id} practiceId={practiceId} entry={entry} />
        ))}
      </div>
    </section>
  );
}

function PracticeDecisionRow({ practiceId, entry }: { practiceId: string; entry: PracticeDecision }) {
  const rowKey = decisionRowKey(practiceId, entry.id);
  const isOpen = useAppStore((s) => s.practiceRows[rowKey] === true);
  const setRowOpen = useAppStore((s) => s.setRowOpen);
  const removePracticeDecision = useAppStore((s) => s.removePracticeDecision);
  // «Sentenza depositata il …», once the decision was found: beside the label, never guessed.
  const deposit = formatDecisionDeposit({ tipo: entry.tipo, data_deposito: entry.depositDate });
  const regionId = `practice-row-${rowKey}`;
  const toggle = () => setRowOpen(rowKey, !isOpen);

  return (
    <div
      data-practice-row={rowKey}
      className="group scroll-mt-20 rounded-lg py-1 pl-2 pr-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
    >
      <div className="flex items-center gap-1 md:gap-2">
        {/* The toggle wraps only text: the remove button stays outside it (gotcha 22). */}
        <div
          role="button"
          tabIndex={0}
          aria-label={`${isOpen ? 'Comprimi' : 'Espandi'} ${entry.label}`}
          aria-expanded={isOpen}
          aria-controls={isOpen ? regionId : undefined}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
          className="flex min-h-[44px] min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-1 md:min-h-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ChevronDown
            size={16}
            aria-hidden
            className={cn('flex-shrink-0 text-slate-400 transition-transform', !isOpen && '-rotate-90')}
          />
          <span className="min-w-0 flex-1 truncate text-sm md:text-[15px]">
            <span className="font-medium text-slate-900 dark:text-white">{entry.label}</span>
            {deposit && <span className="text-slate-500 dark:text-slate-400">{' · '}<span>{deposit}</span></span>}
          </span>
        </div>
        {/* No confirmation: the decision stays one search away, its notes and highlights untouched. */}
        <button
          type="button"
          onClick={() => removePracticeDecision(practiceId, entry.id)}
          aria-label={`Togli dal tavolo ${entry.label}`}
          title="Togli dal tavolo"
          className={cn(ICON_BUTTON, 'md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100')}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      {isOpen && (
        <div id={regionId} className="pb-3 pl-2 pr-1 pt-1 md:pl-6 md:pr-2">
          <DecisionEntryView practiceId={practiceId} decisionId={entry.id} reference={entry.reference} hostId={practiceId} />
        </div>
      )}
    </div>
  );
}
