/**
 * A 401 from the sign-in or the sign-up is the answer to the credentials, not an expired session: it reaches the
 * form without a refresh and without a reload (LC14, A1). A 401 on any other route still starts the refresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError } from 'axios';

vi.mock('../../components/ui/notifications/notifications', () => ({ notify: vi.fn() }));

import { memoryStorage } from '../../test/memoryStorage';
import { apiClient, TOO_MANY_REQUESTS_MESSAGE } from '../api';

const realLocation = window.location;

function answer(status: number, detail?: string) {
  apiClient.defaults.adapter = (config) => Promise.reject(new AxiosError('failed', undefined, config, null, {
    status, data: detail ? { detail } : {}, statusText: '', headers: {}, config,
  }));
}

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  vi.stubGlobal('location', { pathname: '/login', search: '', hash: '', href: 'http://localhost/login' });
});

afterEach(() => {
  vi.stubGlobal('location', realLocation);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a 401 from /auth/login or /auth/register', () => {
  it.each(['/auth/login', '/auth/register'])('%s: no refresh, no reload, the Italian words reach the caller', async (url) => {
    const refresh = vi.spyOn(axios, 'post');
    answer(401, 'Invalid credentials');
    await expect(apiClient.post(url, { email: 'a@b.it', password: 'wrong' })).rejects.toMatchObject({
      status: 401,
      message: 'Email o password non corrette.',
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(window.location.href).toBe('http://localhost/login');
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('a 429 at sign-in says to retry in a while, in Italian', async () => {
    answer(429, 'Too many requests, please try again later');
    await expect(apiClient.post('/auth/login', {})).rejects.toMatchObject({ status: 429, message: TOO_MANY_REQUESTS_MESSAGE });
  });
});

describe('a 401 on any other route', () => {
  it('still starts the refresh, and a refused one still ends the session', async () => {
    localStorage.setItem('access_token', 'stale');
    localStorage.setItem('refresh_token', 'r1');
    const refresh = vi.spyOn(axios, 'post').mockRejectedValue(new AxiosError('refused', undefined, undefined, null, {
      status: 401, data: {}, statusText: '', headers: {}, config: {} as never,
    }));
    answer(401);
    await expect(apiClient.get('/auth/me')).rejects.toBeTruthy();
    expect(refresh).toHaveBeenCalledWith('/api/auth/refresh', { refresh_token: 'r1' });
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(window.location.href).toBe('/login');
  });
});
