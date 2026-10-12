import { useId, useMemo } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { formatDecisionDeposit } from '../../../utils/decisionLinks';
import { besideRefFor, decisionOrder, decisionRowKey, decisionWindowId, type PracticeDecision } from '../../../utils/practice';
import { useIsDesktop } from '../../../hooks/useIsDesktop';
import { PracticeRowShell, type RowBeside } from './PracticeRowShell';
import { DecisionEntryView } from '../decisions/DecisionEntryView';

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
  const openBeside = useAppStore((s) => s.openBeside);
  const closeBeside = useAppStore((s) => s.closeBeside);
  const windowId = decisionWindowId(entry.id);
  const shownBeside = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === windowId) === true);
  const isDesktop = useIsDesktop();
  const beside = useMemo<RowBeside | undefined>(() => isDesktop ? {
    shown: shownBeside,
    onOpen: () => openBeside(practiceId, besideRefFor({ kind: 'decision', decisionId: entry.id })),
    onClose: () => closeBeside(practiceId, windowId),
  } : undefined, [isDesktop, shownBeside, openBeside, closeBeside, practiceId, entry.id, windowId]);
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
