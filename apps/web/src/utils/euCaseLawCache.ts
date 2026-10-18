/** An article's Union case law for the session, by act and article: one request however many times the
 *  section is opened or remounted (the API keeps the answer for days, so a second look costs nothing
 *  there either). Only a `risultati` answer is kept; anything else, or a failure, is asked again by «Riprova».
 *  Tests: `src/test/setup.ts` clears it after each test. */
import { searchEuCaseLaw } from '../services/euCaseLawService';
import type { EuCaseLawAnswer } from '../types/decisions';
import type { EuCaseLawQuery } from './euCaseLaw';

/** Articles kept, least recently used out. */
const MAX_KEPT = 30;
const answers = new Map<string, Promise<EuCaseLawAnswer>>();

export function searchEuCaseLawCached(query: EuCaseLawQuery): Promise<EuCaseLawAnswer> {
  const key = `${query.celex}|${query.articolo}`;
  const held = answers.get(key);
  if (held) {
    answers.delete(key); // a hit is the most recent use
    answers.set(key, held);
    return held;
  }
  const pending = searchEuCaseLaw(query).then(
    (answer) => {
      if (answer.esito !== 'risultati' && answers.get(key) === pending) answers.delete(key);
      return answer;
    },
    (error: unknown) => {
      if (answers.get(key) === pending) answers.delete(key);
      throw error;
    },
  );
  answers.set(key, pending);
  while (answers.size > MAX_KEPT) answers.delete(answers.keys().next().value as string);
  return pending;
}

/** Everything kept, at logout: the next reader of this browser starts with nothing of the last one's. */
export function clearEuCaseLawCache(): void {
  answers.clear();
}
