import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();
vi.mock('../api', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), delete: (...a: unknown[]) => del(...a) } }));

import { trashService } from '../trashService';

beforeEach(() => { vi.clearAllMocks(); });

describe('trashService', () => {
  it('lists the trash', async () => {
    get.mockResolvedValue({ data: [{ id: 't1' }] });
    expect(await trashService.list()).toEqual([{ id: 't1' }]);
    expect(get).toHaveBeenCalledWith('/trash');
  });
  it('restores where it was, or into the dossier chosen', async () => {
    post.mockResolvedValue({ data: { dossierId: 'd1' } });
    expect(await trashService.restore('t1')).toEqual({ dossierId: 'd1' });
    expect(post).toHaveBeenLastCalledWith('/trash/t1/restore', {});
    await trashService.restore('t1', 'd2');
    expect(post).toHaveBeenLastCalledWith('/trash/t1/restore', { targetDossierId: 'd2' });
  });
  it('empties one entry', async () => {
    del.mockResolvedValue({});
    await trashService.purge('t1');
    expect(del).toHaveBeenCalledWith('/trash/t1');
  });
});
