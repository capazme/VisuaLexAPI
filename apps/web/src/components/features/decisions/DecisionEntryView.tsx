import { useCallback, useEffect, useRef } from 'react';
import { appStore, useAppStore } from '../../../store/useAppStore';
import type { DecisionReference, FoundDecision } from '../../../types/decisions';
import { addDecisionToHistory } from '../../../services/historyService';
import { decisionKey, formatDecisionShort, identityOf } from '../../../utils/decisionLinks';
import { DecisionReadingSurface } from './DecisionReadingSurface';
import { DecisionDiscussionsWithoutText } from './DecisionDiscussionsWithoutText';
import { DecisionView } from './DecisionView';
import { useDecisionAnswer } from './useDecisionAnswer';

export interface DecisionAnswerBodyProps {
  reference: DecisionReference;
  /** The reading place: a practice (its row), a window, or an old workspace tab. */
  hostId: string;
  /** Where the way back returns to inside the host (`DecisionReadingSurface.hostBlockId`). */
  hostBlockId?: string;
  /** The id `decisionFocusRequest` names when this reading place is asked to take focus. */
  focusId: string;
  /** A found answer: the holder learns the identity. Stable (it is an effect's dependency). */
  onFound: (answer: FoundDecision) => void;
  /** Should the Cronologia be told `key`? False once told, and when the holder is gone. Stable. */
  needsRecord: (key: string) => boolean;
  /** The Cronologia was told `key`: kept on the holder. Stable. */
  onRecorded: (key: string) => void;
}

/**
 * A decision read where it is held (spec §6.1), whatever holds it: fetched by `useDecisionAnswer`,
 * drawn by `DecisionView` on the reading surface. The holder learns the identity through `onFound`;
 * the Cronologia is told once per opening, the key kept on the holder (`needsRecord`, `onRecorded`),
 * so a remount or a reload never records again, while a new holder of the decision does. Two copies
 * of one holder may be mounted, one hidden: only the copy on screen records and takes focus.
 */
export function DecisionAnswerBody({
  reference, hostId, hostBlockId, focusId, onFound, needsRecord, onRecorded,
}: DecisionAnswerBodyProps) {
  const openPaletteWith = useAppStore((s) => s.openCommandPaletteWith);
  const takeFocusRequest = useAppStore((s) => s.takeDecisionFocusRequest);
  const focusRequested = useAppStore((s) => s.decisionFocusRequest === focusId);
  const panelRef = useRef<HTMLDivElement>(null);
  const { current, answer, retry, chooseCandidate } = useDecisionAnswer(reference);

  useEffect(() => {
    if (answer?.esito === 'trovata') onFound(answer);
  }, [answer, onFound]);

  useEffect(() => {
    if (answer?.esito !== 'trovata') return;
    const panel = panelRef.current;
    if (!panel || panel.getClientRects().length === 0) return;
    const key = decisionKey(identityOf(answer.identita));
    if (!needsRecord(key)) return;
    onRecorded(key);
    // the history is a convenience: the reading never fails for it
    addDecisionToHistory(key).catch((error: unknown) => {
      console.error('addDecisionToHistory failed', { decisionKey: key, error });
    });
  }, [answer, needsRecord, onRecorded]);

  // The reader chose a candidate in another place that turned out to be this decision: that place is
  // gone, so keyboard focus comes here rather than falling to the page. Only the copy on screen takes
  // the request (a hidden element cannot be focused).
  useEffect(() => {
    const panel = panelRef.current;
    if (focusRequested && panel && panel.getClientRects().length > 0 && takeFocusRequest(focusId)) {
      (panel.querySelector<HTMLElement>('[data-decision-heading]') ?? panel)?.focus();
    }
  }, [focusRequested, takeFocusRequest, focusId]);

  return (
    <div ref={panelRef} tabIndex={-1} className="focus:outline-none">
      <DecisionView
        answer={answer}
        reference={current}
        onRetry={retry}
        onChooseCandidate={chooseCandidate}
        onOpenPalette={() => openPaletteWith(formatDecisionShort(current))}
        textSlot={answer?.esito === 'trovata' ? (
          <DecisionReadingSurface
            identity={answer.identita}
            testo={answer.testo}
            attributi={answer.attributi}
            hostTabId={hostId}
            hostBlockId={hostBlockId}
          />
        ) : undefined}
        noTextSlot={answer?.esito === 'trovata' ? (
          <DecisionDiscussionsWithoutText identity={answer.identita} attributi={answer.attributi} />
        ) : undefined}
      />
    </div>
  );
}

export interface DecisionEntryViewProps {
  practiceId: string;
  decisionId: string;
  /** The entry's reference as the store holds it: the identity once found. */
  reference: DecisionReference;
  /** The reading place: the practice for its row, the window's id for a window. */
  hostId: string;
}

/**
 * A decision of a practice's «Giurisprudenza», read in its row, a window or the phone's reader
 * (spec §6.1). On a found answer the entry learns its identity, label, date of deposit and type
 * (`setDecisionEntryIdentity`; another entry already holding the decision absorbs this one and takes
 * focus); the Cronologia is told once per opening, the key kept on the entry (carry-over ruling 13).
 * The way back from a norm it cites names this entry, so it reveals the row or reopens the window.
 */
export function DecisionEntryView({ practiceId, decisionId, reference, hostId }: DecisionEntryViewProps) {
  const setIdentity = useAppStore((s) => s.setDecisionEntryIdentity);
  const markRecorded = useAppStore((s) => s.markDecisionEntryRecorded);

  const onFound = useCallback((answer: FoundDecision) => {
    const { sezione, tipo, data_deposito } = answer.attributi;
    setIdentity(practiceId, decisionId, answer.identita, { sezione, tipo, data_deposito },
      formatDecisionShort({ ...answer.identita, sezione }));
  }, [setIdentity, practiceId, decisionId]);
  const needsRecord = useCallback((key: string) => {
    const entry = appStore.getState().practices.find((p) => p.id === practiceId)?.decisions.find((d) => d.id === decisionId);
    return Boolean(entry) && entry?.historyRecordedKey !== key;
  }, [practiceId, decisionId]);
  const onRecorded = useCallback((key: string) => markRecorded(practiceId, decisionId, key), [markRecorded, practiceId, decisionId]);

  return (
    <DecisionAnswerBody
      reference={reference}
      hostId={hostId}
      hostBlockId={decisionId}
      focusId={decisionId}
      onFound={onFound}
      needsRecord={needsRecord}
      onRecorded={onRecorded}
    />
  );
}
