import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchDecisionAnswer } from '../../types/decisions';

vi.mock('../../services/decisionService', () => ({ fetchDecision: vi.fn() }));
import { fetchDecision } from '../../services/decisionService';
import { clearDecisionCache, fetchDecisionCached, forgetDecision, rememberDecision } from '../decisionFetchCache';

const REF = { corte: 'cassazione' as const, archivio: 'civile' as const, numero: 10787, anno: 2024 };
const mocked = vi.mocked(fetchDecision);
const answer = (esito: string) => ({ esito }) as unknown as FetchDecisionAnswer;

beforeEach(() => {
  mocked.mockReset();
  forgetDecision(REF);
});

describe('fetchDecisionCached', () => {
  it('asks once however many callers', async () => {
    mocked.mockResolvedValue(answer('trovata'));
    const [a, b] = await Promise.all([fetchDecisionCached(REF), fetchDecisionCached(REF)]);
    await fetchDecisionCached(REF);
    expect(a).toBe(b);
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it('does not keep an unreachable source', async () => {
    mocked.mockResolvedValue(answer('fonte_non_raggiungibile'));
    await fetchDecisionCached(REF);
    await fetchDecisionCached(REF);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('does not keep a rejection', async () => {
    mocked.mockRejectedValueOnce(new Error('network'));
    await expect(fetchDecisionCached(REF)).rejects.toThrow('network');
    mocked.mockResolvedValue(answer('trovata'));
    await fetchDecisionCached(REF);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('asks again after forgetDecision', async () => {
    mocked.mockResolvedValue(answer('non_trovata'));
    await fetchDecisionCached(REF);
    forgetDecision(REF);
    await fetchDecisionCached(REF);
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('keeps at most 50 answers, least recently used out, a hit refreshing recency', async () => {
    mocked.mockResolvedValue(answer('trovata'));
    const ref = (n: number) => ({ ...REF, numero: n });
    for (let n = 1; n <= 50; n++) await fetchDecisionCached(ref(n));
    await fetchDecisionCached(ref(1)); // refresh the oldest
    await fetchDecisionCached(ref(51)); // evicts 2, not 1
    expect(mocked).toHaveBeenCalledTimes(51);
    await fetchDecisionCached(ref(1));
    expect(mocked).toHaveBeenCalledTimes(51);
    await fetchDecisionCached(ref(2));
    expect(mocked).toHaveBeenCalledTimes(52);
    for (let n = 1; n <= 51; n++) forgetDecision(ref(n));
  });

  it('an old failing request does not delete a newer entry under the same key', async () => {
    let reject!: (e: Error) => void;
    mocked.mockImplementationOnce(() => new Promise((_, r) => { reject = r; }));
    const old = fetchDecisionCached(REF);
    forgetDecision(REF);
    mocked.mockResolvedValue(answer('trovata'));
    await fetchDecisionCached(REF);
    reject(new Error('late'));
    await expect(old).rejects.toThrow('late');
    await fetchDecisionCached(REF);
    expect(mocked).toHaveBeenCalledTimes(2);
  });
});

describe('clearDecisionCache', () => {
  it('forgets every answer, so the next caller asks again', async () => {
    mocked.mockResolvedValue(answer('trovata'));
    await fetchDecisionCached(REF);
    clearDecisionCache();
    await fetchDecisionCached(REF);
    expect(mocked).toHaveBeenCalledTimes(2);
  });
});

describe('rememberDecision', () => {
  it('serves a seeded answer without a request, and never replaces one that is kept', async () => {
    const seeded = answer('trovata');
    rememberDecision(REF, seeded);
    expect(await fetchDecisionCached(REF)).toBe(seeded);
    expect(mocked).not.toHaveBeenCalled();
    rememberDecision(REF, answer('trovata'));
    expect(await fetchDecisionCached(REF)).toBe(seeded);
  });

  it('does not keep an answer that would not be kept anyway', async () => {
    rememberDecision(REF, answer('fonte_non_raggiungibile'));
    mocked.mockResolvedValue(answer('trovata'));
    await fetchDecisionCached(REF);
    expect(mocked).toHaveBeenCalledTimes(1);
  });
});
