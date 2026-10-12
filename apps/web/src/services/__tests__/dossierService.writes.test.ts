import { describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));

import { apiClient } from '../api';
import { dossierService } from '../dossierService';

const later = () => {
  let settle!: (value: unknown) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  return { promise, settle, fail };
};

describe('dossierService.writesInFlight', () => {
  it('counts every write while it travels, failed ones included, and never a read', async () => {
    const add = later();
    const remove = later();
    vi.mocked(apiClient.post).mockReturnValueOnce(add.promise as never);
    vi.mocked(apiClient.delete).mockReturnValueOnce(remove.promise as never);
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });
    expect(dossierService.writesInFlight()).toBe(0);
    const adding = dossierService.addItem('d1', { itemType: 'note', title: 'x' } as never);
    const removing = dossierService.deleteItem('d1', 'i1');
    expect(dossierService.writesInFlight()).toBe(2);
    await dossierService.getAll();
    expect(dossierService.writesInFlight()).toBe(2);
    add.settle({ data: { id: 'i2' } });
    await expect(adding).resolves.toEqual({ id: 'i2' });
    expect(dossierService.writesInFlight()).toBe(1);
    remove.fail(new Error('down'));
    await expect(removing).rejects.toThrow('down');
    expect(dossierService.writesInFlight()).toBe(0);
  });
});
