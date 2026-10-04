import { beforeEach, describe, expect, it, vi } from 'vitest';

const legalFetch = vi.fn();
vi.mock('../legalFetch', () => ({ legalFetch: (...args: unknown[]) => legalFetch(...args) }));

import { fetchDecision } from '../decisionService';

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
    legalFetch.mockResolvedValue({ status: 502, ok: false, json: async () => { throw new SyntaxError('html'); } } as unknown as Response);
    expect(await fetchDecision(REF)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'risposta 502' });
  });

  // what comes before the handler (the rate limit, the login gate) or is not its answer
  it.each<[number, unknown]>([
    [401, { error: 'Unauthorized' }],
    [404, { esito: 'sconosciuto' }],
    [200, { esito: 42 }],
    [200, null],
  ])('a %i whose body is not one of the six answers is a source problem too', async (status, body) => {
    legalFetch.mockResolvedValue(json(status, body));
    expect(await fetchDecision(REF)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: `risposta ${status}` });
  });
});
