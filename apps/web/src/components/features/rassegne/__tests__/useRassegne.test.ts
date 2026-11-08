import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRassegneCache, loadRassegne } from '../useRassegne';

const fetchRassegne = vi.fn();
vi.mock('../../../../services/rassegneService', () => ({ fetchRassegne: (...args: unknown[]) => fetchRassegne(...args), RassegneError: class extends Error {} }));

describe('loadRassegne', () => {
  beforeEach(() => {
    clearRassegneCache();
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

  it('keeps a search apart from the plain list, and forgets both at logout', async () => {
    fetchRassegne.mockResolvedValue({ total: 0 });
    await loadRassegne({ urn: 'u' });
    await loadRassegne({ urn: 'u', q: 'danno' });
    expect(fetchRassegne).toHaveBeenCalledTimes(2);
    clearRassegneCache();
    await loadRassegne({ urn: 'u', q: 'danno' });
    expect(fetchRassegne).toHaveBeenCalledTimes(3);
  });
});
