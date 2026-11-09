import { useId, useMemo } from 'react';
import { Gavel } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { formatDecisionDeposit } from '../../../utils/decisionLinks';
import { besideRefFor, decisionOrder, decisionRowKey, decisionWindowId, type PracticeDecision } from '../../../utils/practice';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { PracticeRowShell, type RowBeside } from './PracticeRowShell';
import { PracticeDecisionEntry } from './PracticeIndexEntry';
import type { PracticeLayout } from './PracticeColumn';
import { DecisionEntryView } from '../decisions/DecisionEntryView';

/**
 * The decisions' tint (U2): the emerald the search menu gives a decision (its gavel), as a quiet wash and a hairline;
 * the text stays ink. No colour of its own.
 */
const DECISIONS_STRIP = 'rounded-xl border border-emerald-200/70 bg-emerald-50/40 px-3 pb-2 dark:border-emerald-900/50 dark:bg-emerald-950/20';
const DECISIONS_MARK = 'text-emerald-700 dark:text-emerald-400';

/**
 * «Giurisprudenza (n)» at the bottom of the practice's column (spec §3.3), only when the practice
 * holds a decision: one row per entry, newest first (`decisionOrder`, T7). A row opens in place on
 * the decision's reading surface (`DecisionEntryView`, hosted by the practice); closed, it mounts
 * nothing, so a decision «Apri tutto» added is not asked for until it is opened (T17). In the overview (U2) a strip of
 * the frame's width under the acts' panels, in the decisions' tint, its closed rows in columns and an open one across
 * the strip; in the reading view's index, its decisions one entry a line, each opening beside.
 */
export function PracticeDecisionsSection({ practiceId, layout }: { practiceId: string; layout: PracticeLayout }) {
  const decisions = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.decisions);
  const ordered = useMemo(() => decisionOrder(decisions ?? []), [decisions]);
  const headingId = useId();

  if (ordered.length === 0) return null;

  const isIndex = layout === 'index';
  const tinted = layout !== 'phone';
  return (
    // A section of the page as an act is (R3): its title in the reader's serif and a hairline, no card; on the desktop
    // in the decisions' tint.
    <section aria-labelledby={headingId} data-testid="practice-decisions" className={cn(layout === 'overview' && DECISIONS_STRIP)}>
      <h3
        id={headingId}
        className={cn(
          'flex items-center gap-2 border-b font-serif font-medium leading-tight text-slate-900 dark:text-white',
          tinted ? 'border-emerald-200/70 dark:border-emerald-900/50' : 'border-slate-200 dark:border-slate-800',
          isIndex ? 'py-1.5 text-[17px]' : 'py-2 text-[22px]',
        )}
      >
        {tinted && <Gavel size={isIndex ? 15 : 18} aria-hidden className={cn('flex-shrink-0', DECISIONS_MARK)} />}
        <span>
          Giurisprudenza <span className="font-sans text-sm font-normal text-slate-600 dark:text-slate-400">({ordered.length})</span>
        </span>
      </h3>
      {isIndex ? (
        <ul aria-label="Sentenze sul tavolo" className="space-y-0.5 py-1">
          {ordered.map((entry) => (
            <PracticeDecisionEntry key={entry.id} practiceId={practiceId} entry={entry} />
          ))}
        </ul>
      ) : (
        // In the overview the closed rows flow in columns of at least 26rem; an open row takes the strip's width, its
        // text at the reading measure.
        <div className={cn(layout === 'overview' && 'grid grid-cols-[repeat(auto-fill,minmax(min(26rem,100%),1fr))] gap-x-6 [&>[data-row-open]]:col-span-full')}>
          {ordered.map((entry) => (
            <PracticeDecisionRow key={entry.id} practiceId={practiceId} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function PracticeDecisionRow({ practiceId, entry }: { practiceId: string; entry: PracticeDecision }) {
  const rowKey = decisionRowKey(practiceId, entry.id);
  const isOpen = useAppStore((s) => s.practiceRows[rowKey] === true);
  const setRowOpen = useAppStore((s) => s.setRowOpen);
  const removePracticeDecision = useAppStore((s) => s.removePracticeDecision);
  const openBeside = useAppStore((s) => s.openBeside);
  const closeBeside = useAppStore((s) => s.closeBeside);
  const openPhoneReader = useAppStore((s) => s.openPhoneReader);
  const closePhoneReader = useAppStore((s) => s.closePhoneReader);
  const windowId = decisionWindowId(entry.id);
  const shownBeside = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === windowId) === true);
  const isDesktop = useIsDesktop();
  const beside = useMemo<RowBeside>(() => isDesktop ? {
    shown: shownBeside,
    // The overview gives way to the reading view, this row with it: the window takes the focus (U2).
    onOpen: () => openBeside(practiceId, besideRefFor({ kind: 'decision', decisionId: entry.id }), undefined, { focus: true }),
    onClose: () => closeBeside(practiceId, windowId),
  } : {
    shown: false,
    onOpen: () => openPhoneReader(practiceId, besideRefFor({ kind: 'decision', decisionId: entry.id })),
    onClose: closePhoneReader,
  }, [isDesktop, shownBeside, openBeside, closeBeside, openPhoneReader, closePhoneReader, practiceId, entry.id, windowId]);
  // «Sentenza depositata il …», once the decision was found: beside the label, never guessed.
  const deposit = formatDecisionDeposit({ tipo: entry.tipo, data_deposito: entry.depositDate });

  return (
    <PracticeRowShell
      rowKey={rowKey}
      isOpen={isOpen}
      onToggle={() => setRowOpen(rowKey, !isOpen)}
      // The name holds the visible text, so «Sentenza depositata il …» is announced.
      name={entry.label + (deposit ? `, ${deposit}` : '')}
      removeName={entry.label}
      onRemove={() => removePracticeDecision(practiceId, entry.id)}
      beside={beside}
      header={(
        <span className="min-w-0 flex-1 truncate text-sm md:text-[15px]">
          <span className="font-medium text-slate-900 dark:text-white">{entry.label}</span>
          {deposit && <span className="text-slate-500 dark:text-slate-400">{' · '}<span>{deposit}</span></span>}
        </span>
      )}
      regionStyle={{ ['--reading-toolbar-top' as string]: 'var(--practice-head, 0px)' }}
    >
      <DecisionEntryView practiceId={practiceId} decisionId={entry.id} reference={entry.reference} hostId={practiceId} />
    </PracticeRowShell>
  );
}
