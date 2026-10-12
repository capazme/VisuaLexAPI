import { useEffect, useState } from 'react';
import type { DecisionNotice, DecisionReference, FetchDecisionAnswer, FoundDecision } from '../../../types/decisions';
import { forgetDecision, fetchDecisionCached, rememberDecision } from '../../../utils/decisionFetchCache';
import { decisionPath, identityOf } from '../../../utils/decisionLinks';

/** Notices about what was cited (its section, the archive or a TAR's seat deduced from it), not about the decision:
 *  the place that cited keeps them, the answer seeded for the bare identity does not carry them. */
const ABOUT_THE_CITATION = {
  sezione_diversa: true,
  sezione_non_riconosciuta: true,
  archivio_dedotto: true,
  testo_non_disponibile: false,
  testo_da_archivio: false,
  causa_riunita: true,
  sede_dedotta: true,
} satisfies Record<DecisionNotice['tipo'], boolean>;
function withoutCitationNotices(answer: FoundDecision): FoundDecision {
  return { ...answer, avvisi: answer.avvisi.filter((n) => !ABOUT_THE_CITATION[n.tipo]) };
}

export interface DecisionAnswerState {
  /** What is shown: a candidate chosen here, else the reference given. */
  current: DecisionReference;
  /** The answer for `current`; null while it is asked for. */
  answer: FetchDecisionAnswer | null;
  /** «Riprova»: the cached answer is forgotten and asked for again. */
  retry: () => void;
  /** A candidate or a suggestion chosen here replaces the reference shown. */
  chooseCandidate: (identity: DecisionReference) => void;
}

/**
 * A decision as its reading place asks for it (a workspace tab, a practice's entry): fetched through
 * the session cache, its candidates chosen in place, a found answer seeded in the cache under the
 * bare identity. An answer for a reference that is no longer `current` never reaches the caller.
 */
export function useDecisionAnswer(reference: DecisionReference): DecisionAnswerState {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; answer: FetchDecisionAnswer } | null>(null);
  // A candidate the reader chose in this copy. It stands only while the reference given is the one
  // it was chosen from: once the store learns the identity, the reference changes and every copy of
  // the reading place, a hidden one too, follows it.
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
    if (answer?.esito === 'trovata') rememberDecision(identityOf(answer.identita), withoutCitationNotices(answer));
  }, [answer]);

  return {
    current,
    answer,
    retry: () => { forgetDecision(current); setAttempt((a) => a + 1); },
    chooseCandidate: (identity) => setChosen({ from: decisionPath(reference), reference: identity }),
  };
}
