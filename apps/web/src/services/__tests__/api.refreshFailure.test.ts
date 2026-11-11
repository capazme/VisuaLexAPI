/**
 * A refresh the server refuses ends the session and takes the person's data away; a refresh that fails on a
 * server or network error keeps the session and tells the reader (scan C).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios, { AxiosError, AxiosHeaders } from 'axios';

const notify = vi.fn();
vi.mock('../../components/ui/notifications/notifications', () => ({ notify: (...a: unknown[]) => notify(...a) }));

import { memoryStorage } from '../../test/memoryStorage';
import { apiClient, isRefreshRefused } from '../api';
import { onSessionEnd } from '../sessionEnd';

function axiosError(status: number | null): AxiosError {
  const config = { headers: new AxiosHeaders(), url: '/auth/refresh' };
  const response = status === null ? undefined : { status, data: {}, statusText: '', headers: {}, config };
  return new AxiosError('failed', status === null ? 'ERR_NETWORK' : undefined, config, null, response as never);
}

const realLocation = window.location;
let reset: ReturnType<typeof vi.fn<() => void>>;
let off: () => void;

beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  localStorage.clear();
  sessionStorage.clear();
  notify.mockClear();
  vi.stubGlobal('location', { pathname: '/dossier', search: '', hash: '', href: 'http://localhost/dossier' });
  localStorage.setItem('access_token', 'stale');
  localStorage.setItem('refresh_token', 'r1');
  localStorage.setItem('merlt-qa-thread-v1', 'questions');
  reset = vi.fn<() => void>();
  off = onSessionEnd(reset);
  // Every request answers 401: the response interceptor then tries a refresh.
  apiClient.defaults.adapter = (config) => Promise.reject(new AxiosError('unauthorized', undefined, config, null, {
    status: 401, data: {}, statusText: '', headers: {}, config,
  }));
});

afterEach(() => {
  off();
  vi.stubGlobal('location', realLocation);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('isRefreshRefused', () => {
  it('reads 401 and 403 as refused, 5xx, 429 and no answer as not', () => {
    expect(isRefreshRefused(axiosError(401))).toBe(true);
    expect(isRefreshRefused(axiosError(403))).toBe(true);
    expect(isRefreshRefused(axiosError(500))).toBe(false);
    expect(isRefreshRefused(axiosError(503))).toBe(false);
    expect(isRefreshRefused(axiosError(429))).toBe(false);
    expect(isRefreshRefused(axiosError(null))).toBe(false);
    expect(isRefreshRefused(new Error('No refresh token'))).toBe(true);
  });
});

describe('a request whose refresh fails', () => {
  it('refused (401): the session ends, the person’s data and the tokens go, the sign-in opens', async () => {
    vi.spyOn(axios, 'post').mockRejectedValue(axiosError(401));
    await expect(apiClient.get('/dossiers')).rejects.toBeTruthy();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(localStorage.getItem('refresh_token')).toBeNull();
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBeNull();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(window.location.href).toBe('/login');
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([[503], [500], [null]])('server or network error (%s): the session stays and the reader is told', async (status) => {
    vi.spyOn(axios, 'post').mockRejectedValue(axiosError(status));
    await expect(apiClient.get('/dossiers')).rejects.toMatchObject({
      message: 'Connessione al server non riuscita. La sessione resta aperta: riprova tra poco.',
    });
    expect(localStorage.getItem('refresh_token')).toBe('r1');
    expect(localStorage.getItem('merlt-qa-thread-v1')).toBe('questions');
    expect(reset).not.toHaveBeenCalled();
    expect(window.location.href).toBe('http://localhost/dossier');
  });

  it('tells the reader once, not once per failed request', async () => {
    // past the 10 s since the notices of the tests above
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 120_000);
    vi.spyOn(axios, 'post').mockRejectedValue(axiosError(502));
    await Promise.allSettled([apiClient.get('/a'), apiClient.get('/b'), apiClient.get('/c')]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'error' });
  });
});
