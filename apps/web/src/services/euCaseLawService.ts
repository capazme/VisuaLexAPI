/** POST /search_eu_case_law through legalFetch (case-law section spec, D1). */
import { legalFetch } from './legalFetch';
import type { EuCaseLawAnswer } from '../types/decisions';
import type { EuCaseLawQuery } from '../utils/euCaseLaw';

/** The five answers the route writes: a new one fails to compile here. */
const ESITI: Record<EuCaseLawAnswer['esito'], true> = {
  risultati: true,
  non_supportata: true,
  richiesta_non_valida: true,
  fonte_non_raggiungibile: true,
  errore_interno: true,
};

/** Only the handler's own answers count (see `isAnswer` in decisionService.ts). */
function isAnswer(body: unknown): body is EuCaseLawAnswer {
  if (typeof body !== 'object' || body === null) return false;
  const esito = (body as { esito?: unknown }).esito;
  return typeof esito === 'string' && Object.hasOwn(ESITI, esito);
}

/**
 * The decisions of the Court of Justice and the General Court that cite an article of a regulation
 * or a directive. Like `searchDecisions`, it answers a `fonte_non_raggiungibile` for a response that
 * is not the route's (the quota, the ingress, the login gate) and rejects when no response arrives.
 */
export async function searchEuCaseLaw({ celex, articolo }: EuCaseLawQuery): Promise<EuCaseLawAnswer> {
  const response = await legalFetch('/search_eu_case_law', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ celex, articolo }),
  });
  if (response.status === 429) return { esito: 'fonte_non_raggiungibile', fonte: 'quota' };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error('search_eu_case_law: the answer is not JSON', { status: response.status, error });
  }
  if (isAnswer(body)) return body;
  return { esito: 'fonte_non_raggiungibile', fonte: `risposta ${response.status}` };
}
