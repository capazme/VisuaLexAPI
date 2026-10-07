/** POST /search_decisions through legalFetch (design 2026-10-05 §5). */
import { legalFetch } from './legalFetch';
import type { DecisionSearchQuery, SearchDecisionsAnswer } from '../types/decisions';

/** The five answers the route writes: a new one fails to compile here. */
const ESITI: Record<SearchDecisionsAnswer['esito'], true> = {
  risultati: true,
  non_supportata: true,
  richiesta_non_valida: true,
  fonte_non_raggiungibile: true,
  errore_interno: true,
};

/** Only the handler's own answers count (see `isAnswer` in decisionService.ts). */
function isAnswer(body: unknown): body is SearchDecisionsAnswer {
  if (typeof body !== 'object' || body === null) return false;
  const esito = (body as { esito?: unknown }).esito;
  return typeof esito === 'string' && Object.hasOwn(ESITI, esito);
}

/**
 * One page (1 to 10, twenty decisions each) of the decisions that cite an article or match a
 * topic. `modo` asks for the Cassazione's index (the default) or the text; the answer's `modo`
 * says which one was used. The query's label is presentation and never travels. Like
 * `fetchDecision`, it answers a `fonte_non_raggiungibile` for a response that is not the
 * route's and rejects when no response arrives.
 */
export async function searchDecisions(
  query: DecisionSearchQuery,
  pagina: number,
  modo?: 'indice' | 'testo',
): Promise<SearchDecisionsAnswer> {
  const { norma, tema, archivio } = query;
  const response = await legalFetch('/search_decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ norma, tema, archivio, pagina, modo }),
  });
  if (response.status === 429) return { esito: 'fonte_non_raggiungibile', fonte: 'quota' };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error('search_decisions: the answer is not JSON', { status: response.status, error });
  }
  if (isAnswer(body)) return body;
  return { esito: 'fonte_non_raggiungibile', fonte: `risposta ${response.status}` };
}
