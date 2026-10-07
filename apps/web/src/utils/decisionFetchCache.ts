/** A decision's answer for the session, by its path: one request per decision however many
 *  tabs, lists or reloads of a component ask; a failure is not kept, so «Riprova» asks again. */
import { fetchDecision } from '../services/decisionService';
import type { DecisionReference, FetchDecisionAnswer } from '../types/decisions';
import { decisionPath } from './decisionLinks';

const answers = new Map<string, Promise<FetchDecisionAnswer>>();
const KEPT: ReadonlySet<FetchDecisionAnswer['esito']> = new Set(['trovata', 'ambigua', 'non_trovata']);

export function fetchDecisionCached(ref: DecisionReference): Promise<FetchDecisionAnswer> {
  const key = decisionPath(ref);
  const held = answers.get(key);
  if (held) return held;
  const pending = fetchDecision(ref).then(
    (answer) => {
      if (!KEPT.has(answer.esito)) answers.delete(key);
      return answer;
    },
    (error: unknown) => {
      answers.delete(key);
      throw error;
    },
  );
  answers.set(key, pending);
  return pending;
}

export function forgetDecision(ref: DecisionReference): void {
  answers.delete(decisionPath(ref));
}
