/** POST /search_corte_cost_massime through legalFetch (G-281). */
import { legalFetch } from './legalFetch';
import type { CorteCostMassimeAnswer } from '../types/decisions';

/** The four answers the route writes: a new one fails to compile here. */
const ESITI: Record<CorteCostMassimeAnswer['esito'], true> = {
  risultati: true,
  richiesta_non_valida: true,
  fonte_non_raggiungibile: true,
  errore_interno: true,
};

/** Only the handler's own answers count (see `isAnswer` in decisionService.ts). */
function isAnswer(body: unknown): body is CorteCostMassimeAnswer {
  if (typeof body !== 'object' || body === null) return false;
  const esito = (body as { esito?: unknown }).esito;
  return typeof esito === 'string' && Object.hasOwn(ESITI, esito);
}

/**
 * A page of the Corte costituzionale's massime that name an article (`urn`: the article's `norma_data.urn`).
 * Like `searchEuCaseLaw`, it answers a `fonte_non_raggiungibile` for a response that is not the route's
 * (the quota, the ingress, the login gate) and rejects when no response arrives.
 */
export async function searchCorteCostMassime(urn: string, pagina = 1): Promise<CorteCostMassimeAnswer> {
  const response = await legalFetch('/search_corte_cost_massime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urn, pagina }),
  });
  if (response.status === 429) return { esito: 'fonte_non_raggiungibile', fonte: 'quota' };
  let body: unknown = null;
  try {
    body = await response.json();
  } catch (error) {
    console.error('search_corte_cost_massime: the answer is not JSON', { status: response.status, error });
  }
  if (isAnswer(body)) return body;
  return { esito: 'fonte_non_raggiungibile', fonte: `risposta ${response.status}` };
}
