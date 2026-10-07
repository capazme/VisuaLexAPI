import { beforeEach, describe, expect, it, vi } from 'vitest';

const legalFetch = vi.fn();
vi.mock('../legalFetch', () => ({ legalFetch: (...args: unknown[]) => legalFetch(...args) }));

import { searchDecisions } from '../decisionSearchService';

const json = (status: number, body: unknown) =>
  ({ status, ok: status < 400, json: async () => body }) as unknown as Response;
const NORMA = { tipo_atto: 'codice civile', numero_articolo: '2043' };

beforeEach(() => legalFetch.mockReset());

describe('searchDecisions', () => {
  it('posts norma, tema, archivio, pagina and modo, never the label, and hands back the answer', async () => {
    const answer = { esito: 'risultati', totale: 0, pagina: 2, modo: 'testo', archivio: 'civile', archivio_dal: null, decisioni: [] };
    legalFetch.mockResolvedValue(json(200, answer));
    expect(await searchDecisions({ norma: NORMA, normaLabel: 'art. 2043 c.c.', tema: 'danno', archivio: 'civile' }, 2, 'testo')).toEqual(answer);
    expect(legalFetch).toHaveBeenCalledWith('/search_decisions', expect.objectContaining({ method: 'POST' }));
    const sent = JSON.parse(legalFetch.mock.calls[0][1].body);
    expect(sent).toEqual({ norma: NORMA, tema: 'danno', archivio: 'civile', pagina: 2, modo: 'testo' });
    expect(legalFetch.mock.calls[0][1].body).not.toContain('normaLabel');
  });

  it('hands back the route\'s refusal and failures as they come, whatever the status', async () => {
    legalFetch.mockResolvedValueOnce(json(400, { esito: 'richiesta_non_valida', errori: { pagina: 'x' } }));
    expect(await searchDecisions({ tema: 'a' }, 11)).toEqual({ esito: 'richiesta_non_valida', errori: { pagina: 'x' } });
    legalFetch.mockResolvedValueOnce(json(503, { esito: 'fonte_non_raggiungibile', fonte: 'cassazione' }));
    expect(await searchDecisions({ tema: 'a' }, 1)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'cassazione' });
  });

  it('a quota refusal is a source that does not answer', async () => {
    legalFetch.mockResolvedValue(json(429, { error: 'too many' }));
    expect(await searchDecisions({ tema: 'a' }, 1)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'quota' });
  });

  it('a body without a known esito is a source problem, with the status', async () => {
    legalFetch.mockResolvedValue(json(502, { esito: 'trovata' }));
    expect(await searchDecisions({ tema: 'a' }, 1)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'risposta 502' });
  });

  it('an answer that is not JSON is logged and read the same way', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      legalFetch.mockResolvedValue({ status: 502, ok: false, json: async () => { throw new SyntaxError('html'); } } as unknown as Response);
      expect(await searchDecisions({ tema: 'a' }, 1)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'risposta 502' });
      expect(logged).toHaveBeenCalledWith('search_decisions: the answer is not JSON', expect.objectContaining({ status: 502 }));
    } finally {
      logged.mockRestore();
    }
  });
});
