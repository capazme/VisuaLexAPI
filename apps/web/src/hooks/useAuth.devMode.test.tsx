import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../services/api', () => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));

import { get, put } from '../services/api';
import * as authService from '../services/authService';
import { useAuth } from './useAuth';
import { appStore } from '../store/useAppStore';

const user = (allowed: boolean, on: boolean) => ({
  id: 'u1', username: 'alice', email: 'a@test.local', is_active: true, is_verified: true, is_admin: false,
  dev_mode_allowed: allowed, dev_mode: on, created_at: '2026-10-01T10:00:00Z',
});

async function signIn(me: ReturnType<typeof user>) {
  // A login resets the shared /auth/me request the module keeps between tests.
  const { post } = await import('../services/api');
  vi.mocked(post).mockResolvedValueOnce({ access_token: 'a', refresh_token: 'r' });
  await authService.login({ email: 'a@test.local', password: 'x' });
  vi.mocked(get).mockReset().mockResolvedValue(me);
}

beforeEach(() => {
  vi.mocked(put).mockReset();
  appStore.setState({ isDataLoaded: true });
});

describe('useAuth — development mode', () => {
  it('is off for an account the administrator has not enabled, whatever its stored choice', async () => {
    await signIn(user(false, true));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canUseDevMode).toBe(false);
    expect(result.current.devMode).toBe(false);
  });

  it('is off for an enabled account that has not switched it on, and on once it has', async () => {
    await signIn(user(true, false));
    const off = renderHook(() => useAuth());
    await waitFor(() => expect(off.result.current.loading).toBe(false));
    expect(off.result.current.canUseDevMode).toBe(true);
    expect(off.result.current.devMode).toBe(false);
    off.unmount();

    await signIn(user(true, true));
    const on = renderHook(() => useAuth());
    await waitFor(() => expect(on.result.current.loading).toBe(false));
    expect(on.result.current.devMode).toBe(true);
  });

  it('is off while the user is not known yet', async () => {
    await signIn(user(true, true));
    const { result } = renderHook(() => useAuth());
    expect(result.current.loading).toBe(true);
    expect(result.current.devMode).toBe(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('reaches every mounted instance at once when one of them switches it, with no reload', async () => {
    await signIn(user(true, false));
    const sidebar = renderHook(() => useAuth());
    const article = renderHook(() => useAuth());
    await waitFor(() => expect(sidebar.result.current.loading || article.result.current.loading).toBe(false));
    expect(article.result.current.devMode).toBe(false);

    vi.mocked(put).mockResolvedValueOnce(user(true, true));
    await act(async () => { await sidebar.result.current.setDevMode(true); });

    expect(put).toHaveBeenCalledWith('/auth/dev-mode', { enabled: true });
    expect(sidebar.result.current.devMode).toBe(true);
    expect(article.result.current.devMode).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);

    vi.mocked(put).mockResolvedValueOnce(user(true, false));
    await act(async () => { await article.result.current.setDevMode(false); });
    expect(sidebar.result.current.devMode).toBe(false);
  });

  it('stops listening when the component goes away', async () => {
    await signIn(user(true, false));
    const gone = renderHook(() => useAuth());
    const kept = renderHook(() => useAuth());
    await waitFor(() => expect(gone.result.current.loading || kept.result.current.loading).toBe(false));
    gone.unmount();
    vi.mocked(put).mockResolvedValueOnce(user(true, true));
    await act(async () => { await kept.result.current.setDevMode(true); });
    expect(kept.result.current.devMode).toBe(true);
  });

  it('lets a refusal through and leaves the mode as it was', async () => {
    await signIn(user(true, false));
    const { result } = renderHook(() => useAuth());
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(put).mockRejectedValueOnce(new Error('403'));
    await act(async () => {
      await expect(result.current.setDevMode(true)).rejects.toThrow('403');
    });
    expect(result.current.devMode).toBe(false);
  });
});
