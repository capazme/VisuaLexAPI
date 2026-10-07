/** POST /fetch_decision through legalFetch (design 2026-10-01 §3). */
import { legalFetch } from './legalFetch';
import type { DecisionReference, FetchDecisionAnswer } from '../types/decisions';

/** The six answers the route's handler writes (design 2026-10-01 §3): a new one fails to compile here. */
const ESITI: Record<FetchDecisionAnswer['esito'], true> = {
  trovata: true,
  ambigua: true,
  non_trovata: true,
  fonte_non_raggiungibile: true,
  richiesta_non_valida: true,
  errore_interno: true,
};

/** Only the handler's own answers count. A body without one of the six `esito` values (the rate
 *  limit's `{"error": …}`, the login gate's answer, a page of the framework or of the ingress) is
 *  not the route's answer, whatever its status. */
function isAnswer(body: unknown): body is FetchDecisionAnswer {
  if (typeof body !== 'object' || body === null) return false;
  const esito = (body as { esito?: unknown }).esito;
  return typeof esito === 'string' && Object.hasOwn(ESITI, esito);
}

/**
 * The route's answer to a reference, whatever the status: one of the six answers as it comes, or
 * a `fonte_non_raggiungibile` for a response that is not the route's. It rejects when no response
 * arrives at all, on a network failure or an abort: the decision's tab maps that rejection to `rete`.
 */
export async function fetchDecision(reference: DecisionReference): Promise<FetchDecisionAnswer> {
  const response = await legalFetch('/fetch_decision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reference),
  });
  // the quota of the login gate or the per-IP rate limit: no `esito`, and never "not found"
  if (response.status === 429) return { esito: 'fonte_non_raggiungibile', fonte: 'quota' };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error('fetch_decision: the answer is not JSON', { status: response.status, error });
  }
  if (isAnswer(body)) return body;
  // Not the route's answer (the ingress, the login gate, a page of the framework): never read
  // as "not found".
  return { esito: 'fonte_non_raggiungibile', fonte: `risposta ${response.status}` };
}
