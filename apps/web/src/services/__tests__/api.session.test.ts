import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { getFreshAccessToken } from '../api';

// A token the app can read the expiry of; the signature is never checked in the browser.
function jwtExpiringIn(seconds: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `header.${payload}.signature`;
}

// The browser's localStorage, in memory: on recent Node versions (26.5 measured) the bare global
// is Node's own unfinished one, and a test must not depend on which Node runs it.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key);
    },
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getFreshAccessToken', () => {
  it('is null without a session', async () => {
    expect(await getFreshAccessToken()).toBeNull();
  });

  it('returns a token that is still valid as it is, without asking the server', async () => {
    const token = jwtExpiringIn(600);
    localStorage.setItem('access_token', token);
    localStorage.setItem('refresh_token', 'r1');
    const post = vi.spyOn(axios, 'post');

    expect(await getFreshAccessToken()).toBe(token);
    expect(post).not.toHaveBeenCalled();
  });

  it('refreshes an expired token first, and stores the new pair', async () => {
    localStorage.setItem('access_token', jwtExpiringIn(-60));
    localStorage.setItem('refresh_token', 'r1');
    const fresh = jwtExpiringIn(600);
    vi.spyOn(axios, 'post').mockResolvedValue({ data: { access_token: fresh, refresh_token: 'r2' } });

    expect(await getFreshAccessToken()).toBe(fresh);
    expect(localStorage.getItem('access_token')).toBe(fresh);
    expect(localStorage.getItem('refresh_token')).toBe('r2');
  });

  it('makes one refresh for several callers at once', async () => {
    localStorage.setItem('access_token', jwtExpiringIn(-60));
    localStorage.setItem('refresh_token', 'r1');
    const fresh = jwtExpiringIn(600);
    const post = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { access_token: fresh, refresh_token: 'r2' } });

    const tokens = await Promise.all([getFreshAccessToken(), getFreshAccessToken(), getFreshAccessToken()]);

    expect(tokens).toEqual([fresh, fresh, fresh]);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('falls back to the stale token when the refresh fails, and lets the 401 decide', async () => {
    const stale = jwtExpiringIn(-60);
    localStorage.setItem('access_token', stale);
    localStorage.setItem('refresh_token', 'r1');
    vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh refused'));

    expect(await getFreshAccessToken()).toBe(stale);
  });

  it('does not try to refresh an expired token when there is no refresh token', async () => {
    const stale = jwtExpiringIn(-60);
    localStorage.setItem('access_token', stale);
    const post = vi.spyOn(axios, 'post');

    expect(await getFreshAccessToken()).toBe(stale);
    expect(post).not.toHaveBeenCalled();
  });
});
