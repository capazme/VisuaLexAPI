import { beforeEach, describe, expect, it, vi } from 'vitest';

const legalFetch = vi.fn();
vi.mock('../legalFetch', () => ({ legalFetch: (...args: unknown[]) => legalFetch(...args) }));

import { fetchDecision } from '../decisionService';
import type { FetchDecisionAnswer } from '../../types/decisions';

const json = (status: number, body: unknown) =>
  ({ status, ok: status < 400, json: async () => body }) as unknown as Response;
const REF = { corte: 'cassazione', numero: 1, anno: 2024 } as const;

beforeEach(() => legalFetch.mockReset());

describe('fetchDecision', () => {
  it('posts the reference and hands back the route\'s answer, 404 included', async () => {
    legalFetch.mockResolvedValue(json(404, { esito: 'non_trovata', motivo: 'inesistente' }));
    const answer = await fetchDecision(REF);
    expect(answer).toEqual({ esito: 'non_trovata', motivo: 'inesistente' });
    expect(legalFetch).toHaveBeenCalledWith('/fetch_decision', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ corte: 'cassazione', numero: 1, anno: 2024 }) }));
  });

  it('an unexpected failure of the route is its own answer, never "not found"', async () => {
    legalFetch.mockResolvedValue(json(500, { esito: 'errore_interno' }));
    expect(await fetchDecision(REF)).toEqual({ esito: 'errore_interno' });
  });

  it('a quota refusal is not a missing decision', async () => {
    legalFetch.mockResolvedValue(json(429, { error: 'too many' }));
    expect(await fetchDecision(REF)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'quota' });
  });

  it('an answer without the route\'s JSON is a source problem, never "not found"', async () => {
    // the service logs it: the test takes the log over, asserts it and gives the console back
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      legalFetch.mockResolvedValue({ status: 502, ok: false, json: async () => { throw new SyntaxError('html'); } } as unknown as Response);
      expect(await fetchDecision(REF)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'risposta 502' });
      expect(logged).toHaveBeenCalledWith('fetch_decision: the answer is not JSON', expect.objectContaining({ status: 502 }));
    } finally {
      logged.mockRestore();
    }
  });

  // what comes before the handler (the rate limit, the login gate) or is not its answer
  it.each<[number, unknown]>([
    [401, { error: 'Unauthorized' }],
    [404, { esito: 'sconosciuto' }],
    [200, { esito: 42 }],
    [200, null],
    // a name every object has is not one of the six answers
    [200, { esito: 'constructor' }],
    [404, { esito: 'toString' }],
  ])('a %i whose body is not one of the six answers is a source problem too', async (status, body) => {
    legalFetch.mockResolvedValue(json(status, body));
    expect(await fetchDecision(REF)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: `risposta ${status}` });
  });

  // with the 404 `non_trovata` and the 500 `errore_interno` above, all six answers come back as they are
  it.each<[number, FetchDecisionAnswer]>([
    [200, {
      esito: 'trovata',
      identita: { corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2024 },
      attributi: { sezione: '3', tipo: 'ordinanza' },
      testo: { motivazione: 'Svolgimento del processo' },
      fonte: { nome: 'Corte suprema di cassazione' },
      avvisi: [],
    }],
    [200, {
      esito: 'ambigua',
      candidati: [
        { identita: { corte: 'cassazione', archivio: 'civile', numero: 1, anno: 2024 }, attributi: { sezione: '3' } },
        { identita: { corte: 'cassazione', archivio: 'penale', numero: 1, anno: 2024 }, attributi: { sezione: '7' } },
      ],
    }],
    [400, { esito: 'richiesta_non_valida', errori: { numero: 'atteso un numero da 1 a 999999' } }],
    [503, { esito: 'fonte_non_raggiungibile', fonte: 'cassazione' }],
  ])('a %i with one of the route\'s own answers is handed back as it is', async (status, body) => {
    legalFetch.mockResolvedValue(json(status, body));
    expect(await fetchDecision(REF)).toEqual(body);
  });
});
