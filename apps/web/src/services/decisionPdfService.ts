/** POST /fetch_decision_pdf through legalFetch (design 2026-10-05 §12.2): the court's own PDF. */
import { legalFetch } from './legalFetch';
import type { DecisionIdentity } from '../types/decisions';

/**
 * The court's PDF as a Blob, or the route's own answer (`non_disponibile`, `fonte_non_raggiungibile`,
 * `richiesta_non_valida`) as `{ esito }`. A limit of requests (429) or a response that is neither a
 * PDF nor the route's JSON is `fonte_non_raggiungibile`, never `non_disponibile`. It rejects when no
 * response arrives at all (the network).
 */
export async function fetchOriginalPdf(identity: DecisionIdentity): Promise<Blob | { esito: string }> {
  const response = await legalFetch('/fetch_decision_pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      corte: identity.corte,
      archivio: identity.archivio,
      numero: identity.numero,
      anno: identity.anno,
    }),
  });
  if (response.status === 429) return { esito: 'fonte_non_raggiungibile' };
  const type = response.headers.get('Content-Type') ?? '';
  if (response.ok && type.startsWith('application/pdf')) return await response.blob();
  try {
    const body: unknown = await response.json();
    const esito = typeof body === 'object' && body !== null ? (body as { esito?: unknown }).esito : undefined;
    if (typeof esito === 'string') return { esito };
  } catch (error) {
    console.error('fetch_decision_pdf: the answer is neither a PDF nor JSON', { status: response.status, error });
  }
  return { esito: 'fonte_non_raggiungibile' };
}
