/** A search page for the session, by query, archive, page and mode: one request per search however
 *  many tabs, lists or remounts ask (the desktop panel and the phone tree draw the same tab at
 *  once). Only a `risultati` answer is kept; anything else, or a failure, is asked again by «Riprova». */
import { searchDecisions } from '../services/decisionSearchService';
import type { DecisionSearchQuery, SearchDecisionsAnswer } from '../types/decisions';
import { topicKey } from './decisionSearchNorma';

/** Pages kept, least recently used out. */
const MAX_KEPT_PAGES = 50;
const pages = new Map<string, Promise<SearchDecisionsAnswer>>();

function keyOf(query: DecisionSearchQuery, pagina: number, modo?: 'indice' | 'testo'): string {
  const { norma, tema, archivio } = query;
  const sortedNorma = norma ? Object.fromEntries(Object.entries(norma).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) : undefined;
  return JSON.stringify([sortedNorma, tema === undefined ? undefined : topicKey(tema), archivio, pagina, modo]);
}

export function searchDecisionsCached(query: DecisionSearchQuery, pagina: number, modo?: 'indice' | 'testo'): Promise<SearchDecisionsAnswer> {
  const key = keyOf(query, pagina, modo);
  const held = pages.get(key);
  if (held) {
    pages.delete(key); // a hit is the most recent use
    pages.set(key, held);
    return held;
  }
  const pending = searchDecisions(query, pagina, modo).then(
    (answer) => {
      if (answer.esito !== 'risultati' && pages.get(key) === pending) pages.delete(key);
      return answer;
    },
    (error: unknown) => {
      if (pages.get(key) === pending) pages.delete(key);
      throw error;
    },
  );
  pages.set(key, pending);
  while (pages.size > MAX_KEPT_PAGES) pages.delete(pages.keys().next().value as string);
  return pending;
}

/** Everything kept, at logout: the next reader of this browser starts with nothing of the last one's. */
export function clearDecisionSearchCache(): void {
  pages.clear();
}
