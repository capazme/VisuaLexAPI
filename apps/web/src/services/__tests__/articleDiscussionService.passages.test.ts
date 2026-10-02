import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ apiClient: { get: vi.fn(), post: vi.fn() } }));

import { apiClient } from '../api';
import { articleDiscussionService } from '../articleDiscussionService';

const anchor = { normaKey: 'codice-civile::2043', articleId: '2043' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('articleDiscussionService.listPassages', () => {
  beforeEach(() => {
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.post).mockReset();
  });

  it('shares one request among readers of the same article asking at once', async () => {
    const answer = deferred<{ data: { data: [] } }>();
    vi.mocked(apiClient.get).mockReturnValue(answer.promise as never);
    const calls = [articleDiscussionService.listPassages(anchor), articleDiscussionService.listPassages(anchor)];
    answer.resolve({ data: { data: [] } });
    await Promise.all(calls);
    expect(apiClient.get).toHaveBeenCalledTimes(1);
  });

  it('asks again once the answer is in: nothing is cached', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [] } } as never);
    await articleDiscussionService.listPassages(anchor);
    await articleDiscussionService.listPassages(anchor);
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('does not hand a reload the list from before a new discussion', async () => {
    const before = deferred<{ data: { data: [] } }>();
    vi.mocked(apiClient.get)
      .mockReturnValueOnce(before.promise as never)
      .mockResolvedValueOnce({ data: { data: [{ id: 'new' }] } } as never);
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 'new' } } as never);

    const stale = articleDiscussionService.listPassages(anchor);
    await articleDiscussionService.create(anchor, '', 'body');
    await expect(articleDiscussionService.listPassages(anchor)).resolves.toEqual([{ id: 'new' }]);
    before.resolve({ data: { data: [] } });
    await stale;
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });
});
