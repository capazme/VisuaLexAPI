import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/legalFetch', () => ({ legalFetch: vi.fn() }));

import { legalFetch } from '../services/legalFetch';
import { clearActStructureCache, fetchActRubriche, fetchActTree } from './actStructureCache';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('actStructureCache', () => {
  beforeEach(() => {
    clearActStructureCache();
    vi.mocked(legalFetch).mockReset();
  });

  it('asks the sources once per act for the tree, however many readers ask', async () => {
    vi.mocked(legalFetch).mockImplementation(async () => ok({ articles: [], metadata: {} }));
    await Promise.all([fetchActTree('urn:a'), fetchActTree('urn:a'), fetchActTree('urn:a')]);
    await fetchActTree('urn:a');
    expect(legalFetch).toHaveBeenCalledTimes(1);
    await fetchActTree('urn:b');
    expect(legalFetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the tree and the rubriche of the same act apart', async () => {
    vi.mocked(legalFetch).mockImplementation(async (path) =>
      ok(path === '/fetch_tree' ? { articles: [] } : { rubriche: { '1': 'Capacità giuridica' } }),
    );
    await expect(fetchActRubriche('urn:a')).resolves.toEqual({ rubriche: { '1': 'Capacità giuridica' } });
    await expect(fetchActTree('urn:a')).resolves.toEqual({ articles: [] });
    expect(legalFetch).toHaveBeenCalledTimes(2);
  });

  it('does not keep a failure: the next reader asks again', async () => {
    vi.mocked(legalFetch)
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(ok({ articles: [] }));
    await expect(fetchActTree('urn:a')).rejects.toThrow('HTTP 502');
    await expect(fetchActTree('urn:a')).resolves.toEqual({ articles: [] });
    expect(legalFetch).toHaveBeenCalledTimes(2);
  });
});
