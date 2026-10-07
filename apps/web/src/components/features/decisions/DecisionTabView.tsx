import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { DecisionReference, FetchDecisionAnswer, FoundDecision } from '../../../types/decisions';
import { forgetDecision, fetchDecisionCached, rememberDecision } from '../../../utils/decisionFetchCache';
import { decisionPath, formatDecisionShort, identityOf } from '../../../utils/decisionLinks';
import { DecisionView } from './DecisionView';

/** Notices about what was cited (its section, the archive deduced from it), not about the decision:
 *  the tab that cited keeps them, the answer seeded for the bare identity does not carry them. */
const ABOUT_THE_CITATION: ReadonlySet<string> = new Set(['sezione_diversa', 'sezione_non_riconosciuta', 'archivio_dedotto']);
function withoutCitationNotices(answer: FoundDecision): FoundDecision {
  return { ...answer, avvisi: answer.avvisi.filter((n) => !ABOUT_THE_CITATION.has(n.tipo)) };
}

/**
 * A decision in its workspace tab: fetched through the session cache, drawn by `DecisionView`.
 * `current` is what this tab shows (a candidate or a suggestion chosen in it replaces the tab's
 * reference); once the decision is found the store learns its identity and the tab's label. An
 * answer for a reference that is no longer `current` never reaches the view or the store.
 */
export function DecisionTabView({ tabId, reference }: { tabId: string; reference: DecisionReference }) {
  const setIdentity = useAppStore((s) => s.setDecisionTabIdentity);
  const openPaletteWith = useAppStore((s) => s.openCommandPaletteWith);
  const takeFocusRequest = useAppStore((s) => s.takeDecisionFocusRequest);
  const focusRequested = useAppStore((s) => s.decisionFocusRequest === tabId);
  const panelRef = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; answer: FetchDecisionAnswer } | null>(null);
  // A candidate the reader chose in this copy. It stands only while the tab's own reference is the
  // one it was chosen from: once the store learns the identity (`setDecisionTabIdentity`), the
  // reference changes and every copy of this tab, the hidden one too, follows it.
  const [chosen, setChosen] = useState<{ from: string; reference: DecisionReference } | null>(null);
  const current = chosen && chosen.from === decisionPath(reference) ? chosen.reference : reference;
  const key = `${decisionPath(current)}#${attempt}`;

  // The store replaces a looser reference (no archive, a cited section) with the identity once the
  // decision is found. The answer on screen is then already the one for the new reference: it stays,
  // notices included, instead of falling back to the skeleton while the same text is asked for again.
  const held = result?.answer.esito === 'trovata' && decisionPath(identityOf(result.answer.identita)) === decisionPath(current)
    ? result.answer : null;
  useEffect(() => {
    // the answer on screen already is this reference's: nothing to ask
    if (held) return;
    let cancelled = false;
    fetchDecisionCached(current).then(
      (answer) => { if (!cancelled) setResult({ key, answer }); },
      (error: unknown) => {
        console.error('fetch_decision failed', { reference: current, error });
        if (!cancelled) setResult({ key, answer: { esito: 'fonte_non_raggiungibile', fonte: 'rete' } });
      },
    );
    return () => { cancelled = true; };
  }, [current, key, held]);

  const answer = result?.key === key ? result.answer : held;

  useEffect(() => {
    if (answer?.esito === 'trovata') {
      rememberDecision(identityOf(answer.identita), withoutCitationNotices(answer));
      setIdentity(tabId, answer.identita, formatDecisionShort({ ...answer.identita, sezione: answer.attributi.sezione }));
    }
  }, [answer, setIdentity, tabId]);

  // The reader chose a candidate in another tab that turned out to be this one: the tab they were
  // in is gone, so keyboard focus comes here rather than falling to the page.
  // The desktop panel and the phone view are both mounted at every width and one of them is hidden:
  // only the copy that is on screen takes the request (a hidden element cannot be focused).
  useEffect(() => {
    const panel = panelRef.current;
    if (focusRequested && panel && panel.getClientRects().length > 0 && takeFocusRequest(tabId)) {
      (panel.querySelector<HTMLElement>('[data-decision-heading]') ?? panel)?.focus();
    }
  }, [focusRequested, takeFocusRequest, tabId]);

  return (
    <div ref={panelRef} tabIndex={-1} data-decision-tab={tabId} className="focus:outline-none">
      <DecisionView
        answer={answer}
        reference={current}
        onRetry={() => { forgetDecision(current); setAttempt((a) => a + 1); }}
        onChooseCandidate={(identity) => setChosen({ from: decisionPath(reference), reference: identity })}
        onOpenPalette={() => openPaletteWith(formatDecisionShort(current))}
      />
    </div>
  );
}
