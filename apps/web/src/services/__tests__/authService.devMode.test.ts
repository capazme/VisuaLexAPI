import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
}));

import { get, post, put } from '../api';
import { getCurrentUser, login, setDevMode } from '../authService';
import { subscribeToUser } from '../authEvents';

const alice = { id: 'u1', username: 'alice', email: 'a@test.local', is_admin: false, dev_mode_allowed: true, dev_mode: false };

// The module keeps the shared request between tests; a login resets it.
async function reset() {
  vi.mocked(post).mockResolvedValueOnce({ access_token: 'a', refresh_token: 'r' });
  await login({ email: 'a@test.local', password: 'x' });
  vi.mocked(get).mockReset();
  vi.mocked(put).mockReset();
}

describe('setDevMode', () => {
  beforeEach(reset);

  it('puts {enabled} to /auth/dev-mode and answers the user the server returns', async () => {
    const on = { ...alice, dev_mode: true };
    vi.mocked(put).mockResolvedValueOnce(on);
    await expect(setDevMode(true)).resolves.toEqual(on);
    expect(put).toHaveBeenCalledWith('/auth/dev-mode', { enabled: true });
  });

  it('makes the shared /auth/me answer the new user, without asking again', async () => {
    vi.mocked(get).mockResolvedValue(alice);
    await getCurrentUser();
    const on = { ...alice, dev_mode: true };
    vi.mocked(put).mockResolvedValueOnce(on);
    await setDevMode(true);
    await expect(getCurrentUser()).resolves.toEqual(on);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('tells every subscriber, until it unsubscribes', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeToUser(first);
    const stopSecond = subscribeToUser(second);
    const on = { ...alice, dev_mode: true };
    vi.mocked(put).mockResolvedValueOnce(on);
    await setDevMode(true);
    expect(first).toHaveBeenCalledWith(on);
    expect(second).toHaveBeenCalledWith(on);

    stopFirst();
    const off = { ...alice, dev_mode: false };
    vi.mocked(put).mockResolvedValueOnce(off);
    await setDevMode(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenLastCalledWith(off);
    stopSecond();
  });

  it('keeps the old user and tells nobody when the server refuses', async () => {
    const listener = vi.fn();
    const stop = subscribeToUser(listener);
    vi.mocked(get).mockResolvedValue(alice);
    await getCurrentUser();
    vi.mocked(put).mockRejectedValueOnce(new Error('403'));
    await expect(setDevMode(true)).rejects.toThrow('403');
    expect(listener).not.toHaveBeenCalled();
    await expect(getCurrentUser()).resolves.toEqual(alice);
    stop();
  });
});
