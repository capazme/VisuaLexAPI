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
    // A section of the page as an act is (R3): its title in the reader's serif and a hairline, no card.
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="border-b border-slate-200 py-2 font-serif text-[22px] font-medium leading-tight text-slate-900 dark:border-slate-800 dark:text-white">
        Giurisprudenza <span className="font-sans text-sm font-normal text-slate-600 dark:text-slate-400">({ordered.length})</span>
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
  const openPhoneReader = useAppStore((s) => s.openPhoneReader);
  const closePhoneReader = useAppStore((s) => s.closePhoneReader);
  const windowId = decisionWindowId(entry.id);
  const shownBeside = useAppStore((s) => s.practices.find((p) => p.id === practiceId)?.beside.some((b) => b.id === windowId) === true);
  const isDesktop = useIsDesktop();
  const beside = useMemo<RowBeside>(() => isDesktop ? {
    shown: shownBeside,
    onOpen: () => openBeside(practiceId, besideRefFor({ kind: 'decision', decisionId: entry.id })),
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
