/** A decision's answer for the session, by its path: one request per decision however many
 *  tabs, lists or reloads of a component ask; a failure is not kept, so «Riprova» asks again. */
import { fetchDecision } from '../services/decisionService';
import type { DecisionReference, FetchDecisionAnswer } from '../types/decisions';
import { decisionPath } from './decisionLinks';

/** Answers kept, least recently used out: a trovata holds the whole text. */
const MAX_KEPT_ANSWERS = 50;
const answers = new Map<string, Promise<FetchDecisionAnswer>>();
const KEPT: ReadonlySet<FetchDecisionAnswer['esito']> = new Set(['trovata', 'ambigua', 'non_trovata']);

export function fetchDecisionCached(ref: DecisionReference): Promise<FetchDecisionAnswer> {
  const key = decisionPath(ref);
  const held = answers.get(key);
  if (held) {
    answers.delete(key); // a hit is the most recent use
    answers.set(key, held);
    return held;
  }
  const pending = fetchDecision(ref).then(
    (answer) => {
      if (!KEPT.has(answer.esito) && answers.get(key) === pending) answers.delete(key);
      return answer;
    },
    (error: unknown) => {
      if (answers.get(key) === pending) answers.delete(key);
      throw error;
    },
  );
  answers.set(key, pending);
  while (answers.size > MAX_KEPT_ANSWERS) answers.delete(answers.keys().next().value as string);
  return pending;
}

/** Everything kept, at logout: the next reader of this browser starts with nothing of the last one's. */
export function clearDecisionCache(): void {
  answers.clear();
}

export function forgetDecision(ref: DecisionReference): void {
  answers.delete(decisionPath(ref));
}
