import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { DecisionReference, FetchDecisionAnswer } from '../../../types/decisions';
import { forgetDecision, fetchDecisionCached } from '../../../utils/decisionFetchCache';
import { decisionPath, formatDecisionShort } from '../../../utils/decisionLinks';
import { DecisionView } from './DecisionView';

/**
 * A decision in its workspace tab: fetched through the session cache, drawn by `DecisionView`.
 * `current` is what this tab shows (a candidate or a suggestion chosen in it replaces the tab's
 * reference); once the decision is found the store learns its identity and the tab's label. An
 * answer for a reference that is no longer `current` never reaches the view or the store.
 */
export function DecisionTabView({ tabId, reference }: { tabId: string; reference: DecisionReference }) {
  const setIdentity = useAppStore((s) => s.setDecisionTabIdentity);
  const openPalette = useAppStore((s) => s.openCommandPalette);
  const takeFocusRequest = useAppStore((s) => s.takeDecisionFocusRequest);
  const focusRequested = useAppStore((s) => s.decisionFocusRequest === tabId);
  const panelRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; answer: FetchDecisionAnswer } | null>(null);
  const [current, setCurrent] = useState(reference);
  const key = `${decisionPath(current)}#${attempt}`;

  useEffect(() => {
    let cancelled = false;
    fetchDecisionCached(current).then(
      (answer) => { if (!cancelled) setResult({ key, answer }); },
      (error: unknown) => {
        console.error('fetch_decision failed', { reference: current, error });
        if (!cancelled) setResult({ key, answer: { esito: 'fonte_non_raggiungibile', fonte: 'rete' } });
      },
    );
    return () => { cancelled = true; };
  }, [current, key]);

  const answer = result?.key === key ? result.answer : null;

  useEffect(() => {
    if (answer?.esito === 'trovata') {
      setIdentity(tabId, answer.identita, formatDecisionShort({ ...answer.identita, sezione: answer.attributi.sezione }));
    }
  }, [answer, setIdentity, tabId]);

  // The reader chose a candidate in another tab that turned out to be this one: the tab they were
  // in is gone, so keyboard focus comes here rather than falling to the page.
  useEffect(() => {
    if (focusRequested && takeFocusRequest(tabId)) panelRef.current?.focus();
  }, [focusRequested, takeFocusRequest, tabId]);

  return (
    <div ref={panelRef} tabIndex={-1} data-decision-tab={tabId} className="outline-none">
      <DecisionView
        answer={answer}
        reference={current}
        onRetry={() => { forgetDecision(current); setAttempt((a) => a + 1); }}
        onChooseCandidate={(identity) => setCurrent(identity)}
        onOpenPalette={openPalette}
      />
    </div>
  );
}
