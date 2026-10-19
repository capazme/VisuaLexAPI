import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

import { get, post, put } from '../api';
import { changePassword, getCurrentUser, login } from '../authService';

const alice = { id: 'u1', username: 'alice', email: 'a@test.local', is_admin: false };

// The module keeps the shared request between tests; a login resets it.
async function reset() {
  vi.mocked(post).mockResolvedValueOnce({ access_token: 'a', refresh_token: 'r' });
  await login({ email: 'a@test.local', password: 'x' });
  vi.mocked(get).mockReset();
}

describe('getCurrentUser', () => {
  beforeEach(reset);

  it('asks /auth/me once however many components ask at the same time', async () => {
    vi.mocked(get).mockResolvedValue(alice);
    const users = await Promise.all([getCurrentUser(), getCurrentUser(), getCurrentUser()]);
    expect(users).toEqual([alice, alice, alice]);
    await getCurrentUser();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not keep a failure: the next caller asks again', async () => {
    vi.mocked(get).mockRejectedValueOnce(new Error('503')).mockResolvedValueOnce(alice);
    await expect(getCurrentUser()).rejects.toThrow('503');
    await expect(getCurrentUser()).resolves.toEqual(alice);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('asks again after a login, and takes the user a password change returns', async () => {
    vi.mocked(get).mockResolvedValue(alice);
    await getCurrentUser();
    await reset();
    vi.mocked(get).mockResolvedValue(alice);
    await getCurrentUser();
    expect(get).toHaveBeenCalledTimes(1);

    const renamed = { ...alice, username: 'alice2' };
    vi.mocked(put).mockResolvedValueOnce(renamed);
    await changePassword({ current_password: 'x', new_password: 'y' });
    await expect(getCurrentUser()).resolves.toEqual(renamed);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
