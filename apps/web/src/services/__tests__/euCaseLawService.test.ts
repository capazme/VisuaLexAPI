import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../legalFetch');
import { legalFetch as legalFetchReal } from '../legalFetch';
import { searchEuCaseLaw } from '../euCaseLawService';

const legalFetch = vi.mocked(legalFetchReal);

const json = (status: number, body: unknown) =>
  ({ status, ok: status < 400, json: async () => body }) as unknown as Response;
const QUERY = { celex: '32016R0679', articolo: '6' };

beforeEach(() => legalFetch.mockReset());

describe('searchEuCaseLaw', () => {
  it('posts the act and the article through legalFetch and hands back the answer', async () => {
    const answer = {
      esito: 'risultati', celex: '32016R0679', articolo: '6', totale: 1, troncato: false,
      decisioni: [{ corte: 'corte_giustizia_ue', causa: 'C-97/23', ecli: 'ECLI:EU:C:2024:1', data: '2024-12-05', tipo: 'JUDG', celex: '62023CJ0097', identita: { corte: 'corte_giustizia_ue', numero: 97, anno: 2023 } }],
    };
    legalFetch.mockResolvedValue(json(200, answer));
    expect(await searchEuCaseLaw(QUERY)).toEqual(answer);
    expect(legalFetch).toHaveBeenCalledWith('/search_eu_case_law', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(legalFetch.mock.calls[0][1]?.body as string)).toEqual(QUERY);
  });

  it('hands back the route\'s own answers as they come, whatever the status', async () => {
    legalFetch.mockResolvedValueOnce(json(200, { esito: 'non_supportata' }));
    expect(await searchEuCaseLaw(QUERY)).toEqual({ esito: 'non_supportata' });
    legalFetch.mockResolvedValueOnce(json(503, { esito: 'fonte_non_raggiungibile', fonte: 'curia' }));
    expect(await searchEuCaseLaw(QUERY)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'curia' });
    legalFetch.mockResolvedValueOnce(json(400, { esito: 'richiesta_non_valida', errori: { articolo: 'x' } }));
    expect(await searchEuCaseLaw(QUERY)).toEqual({ esito: 'richiesta_non_valida', errori: { articolo: 'x' } });
  });

  it('a quota refusal is a source that does not answer', async () => {
    legalFetch.mockResolvedValue(json(429, { error: 'too many' }));
    expect(await searchEuCaseLaw(QUERY)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'quota' });
  });

  it('a body without a known esito is a source problem, with the status', async () => {
    legalFetch.mockResolvedValue(json(502, { esito: 'trovata' }));
    expect(await searchEuCaseLaw(QUERY)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'risposta 502' });
  });

  it('an answer that is not JSON is logged and read the same way', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      legalFetch.mockResolvedValue({ status: 502, ok: false, json: async () => { throw new SyntaxError('html'); } } as unknown as Response);
      expect(await searchEuCaseLaw(QUERY)).toEqual({ esito: 'fonte_non_raggiungibile', fonte: 'risposta 502' });
      expect(logged).toHaveBeenCalledWith('search_eu_case_law: the answer is not JSON', expect.objectContaining({ status: 502 }));
    } finally {
      logged.mockRestore();
    }
  });

  it('rejects when no response arrives at all', async () => {
    legalFetch.mockRejectedValueOnce(new TypeError('network'));
    await expect(searchEuCaseLaw(QUERY)).rejects.toThrow('network');
  });
});
