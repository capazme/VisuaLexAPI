import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchDecisionsAnswer } from '../../types/decisions';

vi.mock('../../services/decisionSearchService');
import { searchDecisions } from '../../services/decisionSearchService';
import { clearDecisionSearchCache, searchDecisionsCached } from '../decisionSearchCache';

const OK: SearchDecisionsAnswer = { esito: 'risultati', totale: 0, pagina: 1, modo: 'testo', archivio: 'civile', archivio_dal: null, decisioni: [] };
const DOWN: SearchDecisionsAnswer = { esito: 'fonte_non_raggiungibile', fonte: 'cassazione' };
const mock = vi.mocked(searchDecisions);

beforeEach(() => { mock.mockReset(); clearDecisionSearchCache(); });

describe('searchDecisionsCached', () => {
  it('sends one request for two concurrent asks, topics spelled alike', async () => {
    mock.mockResolvedValue(OK);
    const [a, b] = await Promise.all([
      searchDecisionsCached({ tema: 'Perdita di chance' }, 1),
      searchDecisionsCached({ tema: ' perdita  di chance ', normaLabel: 'x' }, 1),
    ]);
    expect(a).toBe(b);
    expect(mock).toHaveBeenCalledTimes(1);
    await searchDecisionsCached({ tema: 'perdita di chance' }, 2);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does not keep an answer that is not results, nor a rejection', async () => {
    mock.mockResolvedValueOnce(DOWN).mockRejectedValueOnce(new Error('net')).mockResolvedValue(OK);
    expect(await searchDecisionsCached({ tema: 'colpa' }, 1)).toEqual(DOWN);
    await expect(searchDecisionsCached({ tema: 'colpa' }, 1)).rejects.toThrow('net');
    expect(await searchDecisionsCached({ tema: 'colpa' }, 1)).toEqual(OK);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('keeps 50 pages, least recently used out', async () => {
    mock.mockResolvedValue(OK);
    for (let i = 0; i < 50; i++) await searchDecisionsCached({ tema: `t${i}` }, 1);
    await searchDecisionsCached({ tema: 't0' }, 1); // t0 is the most recent now
    await searchDecisionsCached({ tema: 'nuovo' }, 1); // t1 goes out
    mock.mockClear();
    await searchDecisionsCached({ tema: 't0' }, 1);
    expect(mock).not.toHaveBeenCalled();
    await searchDecisionsCached({ tema: 't1' }, 1);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('forgets everything on clear', async () => {
    mock.mockResolvedValue(OK);
    await searchDecisionsCached({ tema: 'colpa' }, 1);
    clearDecisionSearchCache();
    await searchDecisionsCached({ tema: 'colpa' }, 1);
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
