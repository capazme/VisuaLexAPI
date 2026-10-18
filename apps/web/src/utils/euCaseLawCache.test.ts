import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EuCaseLawAnswer } from '../types/decisions';

vi.mock('../services/euCaseLawService');
import { searchEuCaseLaw } from '../services/euCaseLawService';
import { clearEuCaseLawCache, searchEuCaseLawCached } from './euCaseLawCache';

const service = vi.mocked(searchEuCaseLaw);
const QUERY = { celex: '32016R0679', articolo: '6' };
const FOUND: EuCaseLawAnswer = { esito: 'risultati', celex: QUERY.celex, articolo: '6', totale: 0, troncato: false, decisioni: [] };

beforeEach(() => { service.mockReset(); clearEuCaseLawCache(); });

describe('searchEuCaseLawCached', () => {
  it('asks once per act and article, however many ask', async () => {
    service.mockResolvedValue(FOUND);
    const [a, b] = await Promise.all([searchEuCaseLawCached(QUERY), searchEuCaseLawCached(QUERY)]);
    expect(a).toBe(FOUND);
    expect(b).toBe(FOUND);
    await searchEuCaseLawCached({ ...QUERY });
    expect(service).toHaveBeenCalledTimes(1);
    await searchEuCaseLawCached({ ...QUERY, articolo: '7' });
    expect(service).toHaveBeenCalledTimes(2);
  });

  it('does not keep what is not an answer, nor a failure, so «Riprova» asks again', async () => {
    service.mockResolvedValueOnce({ esito: 'fonte_non_raggiungibile', fonte: 'curia' });
    await searchEuCaseLawCached(QUERY);
    service.mockRejectedValueOnce(new TypeError('network'));
    await expect(searchEuCaseLawCached(QUERY)).rejects.toThrow('network');
    service.mockResolvedValueOnce(FOUND);
    expect(await searchEuCaseLawCached(QUERY)).toBe(FOUND);
    expect(service).toHaveBeenCalledTimes(3);
  });

  it('forgets everything when cleared', async () => {
    service.mockResolvedValue(FOUND);
    await searchEuCaseLawCached(QUERY);
    clearEuCaseLawCache();
    await searchEuCaseLawCached(QUERY);
    expect(service).toHaveBeenCalledTimes(2);
  });
});
