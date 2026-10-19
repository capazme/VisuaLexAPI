// apps/web/src/features/merlt/rassegne/__tests__/useRassegne.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _clearRassegneCacheForTests, loadRassegne } from '../useRassegne';

const fetchRassegne = vi.fn();
vi.mock('../rassegneApi', () => ({ fetchRassegne: (...args: unknown[]) => fetchRassegne(...args) }));

describe('loadRassegne', () => {
  beforeEach(() => {
    _clearRassegneCacheForTests();
    fetchRassegne.mockReset();
  });

  it('dedupes concurrent loads of the same query', async () => {
    fetchRassegne.mockResolvedValue({ total: 0 });
    await Promise.all([loadRassegne({ urn: 'u' }), loadRassegne({ urn: 'u' })]);
    expect(fetchRassegne).toHaveBeenCalledTimes(1);
  });

  it('forgets a failed load so it can be retried', async () => {
    fetchRassegne.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ total: 0 });
    await expect(loadRassegne({ urn: 'u' })).rejects.toThrow('down');
    await expect(loadRassegne({ urn: 'u' })).resolves.toEqual({ total: 0 });
  });
});
