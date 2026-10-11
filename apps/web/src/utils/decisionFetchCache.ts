/** A decision's answer for the session, by its path: one request per decision however many
 *  tabs, lists or reloads of a component ask; a failure is not kept, so «Riprova» asks again. */
import { fetchDecision } from '../services/decisionService';
import type { DecisionReference, FetchDecisionAnswer } from '../types/decisions';
import { decisionPath } from './decisionLinks';

/** Answers kept, least recently used out: a trovata holds the whole text. */
const MAX_KEPT_ANSWERS = 50;
const answers = new Map<string, Promise<FetchDecisionAnswer>>();
/** The same answers, already settled: `peekDecision` reads this, never the promise, so a caller
 *  (the find window, over a minimised tab) can look without awaiting and without starting a
 *  request of its own. Kept in step with `answers` by every place that mutates it. */
const settled = new Map<string, FetchDecisionAnswer>();
const KEPT: ReadonlySet<FetchDecisionAnswer['esito']> = new Set(['trovata', 'ambigua', 'non_trovata']);

function evictOverflow(): void {
  while (answers.size > MAX_KEPT_ANSWERS) {
    const oldest = answers.keys().next().value as string;
    answers.delete(oldest);
    settled.delete(oldest);
  }
}

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
      if (answers.get(key) === pending) {
        if (KEPT.has(answer.esito)) settled.set(key, answer);
        else answers.delete(key);
      }
      return answer;
    },
    (error: unknown) => {
      if (answers.get(key) === pending) answers.delete(key);
      throw error;
    },
  );
  answers.set(key, pending);
  evictOverflow();
  return pending;
}

/** An answer already in hand, kept under `ref`'s path unless something is kept there: a tab that
 *  learns the identity of the decision it fetched by a looser reference seeds the identity, so the
 *  tab's own re-render, its other copy and a later open find it without another request. */
export function rememberDecision(ref: DecisionReference, answer: FetchDecisionAnswer): void {
  const key = decisionPath(ref);
  if (answers.has(key) || !KEPT.has(answer.esito)) return;
  answers.set(key, Promise.resolve(answer));
  settled.set(key, answer);
  evictOverflow();
}

/** Everything kept, at logout: the next reader of this browser starts with nothing of the last one's. */
export function clearDecisionCache(): void {
  answers.clear();
  settled.clear();
}

export function forgetDecision(ref: DecisionReference): void {
  const key = decisionPath(ref);
  answers.delete(key);
  settled.delete(key);
}

/** The decision's answer already fetched this session, read synchronously and without starting a
 *  request: a minimised decision tab's text for the find window («Tutte le schede»), which must
 *  not wake every closed tab's fetch just because the window opened. Absent when nothing was kept
 *  for it yet, or when the last answer was not a `trovata`/`ambigua`/`non_trovata` (a transient
 *  network failure is never kept, by `fetchDecisionCached` itself). */
export function peekDecision(ref: DecisionReference): FetchDecisionAnswer | undefined {
  return settled.get(decisionPath(ref));
}
