import { beforeEach, describe, expect, it, vi } from 'vitest';

const getFreshAccessToken = vi.fn();
const refreshAccessToken = vi.fn();
const handleUnauthenticated = vi.fn();
vi.mock('../api', () => ({
  getFreshAccessToken: () => getFreshAccessToken(),
  refreshAccessToken: () => refreshAccessToken(),
  handleUnauthenticated: () => handleUnauthenticated(),
}));

import { legalFetch } from '../legalFetch';

const fetchMock = vi.fn();
const answer = (status: number) => ({ ok: status < 400, status }) as Response;

beforeEach(() => {
  fetchMock.mockReset();
  getFreshAccessToken.mockReset();
  refreshAccessToken.mockReset();
  handleUnauthenticated.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('legalFetch — the token', () => {
  it('sends the caller’s own init untouched when there is no token', async () => {
    getFreshAccessToken.mockResolvedValue(null);
    fetchMock.mockResolvedValue(answer(200));
    const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' };

    await legalFetch('/fetch_article_text', init);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/fetch_article_text');
    expect(fetchMock.mock.calls[0][1]).toBe(init);
  });

  it('adds the bearer token and keeps everything else of the init', async () => {
    getFreshAccessToken.mockResolvedValue('tok');
    fetchMock.mockResolvedValue(answer(200));
    const signal = new AbortController().signal;

    await legalFetch('/fetch_tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal,
    });

    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
      body: '{}',
      signal,
    });
  });

  it('adds the token when there were no headers at all', async () => {
    getFreshAccessToken.mockResolvedValue('tok');
    fetchMock.mockResolvedValue(answer(200));

    await legalFetch('/fetch_alias_catalog');

    expect(fetchMock.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer tok' } });
  });

  it('adds it to headers given as a Headers object or as pairs', async () => {
    getFreshAccessToken.mockResolvedValue('tok');
    fetchMock.mockResolvedValue(answer(200));

    await legalFetch('/a', { headers: new Headers({ 'X-One': '1' }) });
    await legalFetch('/b', { headers: [['X-Two', '2'], ['authorization', 'old']] });

    const first = fetchMock.mock.calls[0][1].headers as Headers;
    expect(first.get('X-One')).toBe('1');
    expect(first.get('Authorization')).toBe('Bearer tok');
    expect(fetchMock.mock.calls[1][1].headers).toEqual([
      ['X-Two', '2'],
      ['Authorization', 'Bearer tok'],
    ]);
  });
});

describe('legalFetch — a 401', () => {
  const body = JSON.stringify({ act_type: 'codice civile' });

  it('refreshes once and sends the same request again with the new token', async () => {
    getFreshAccessToken.mockResolvedValue('old');
    refreshAccessToken.mockResolvedValue('new');
    fetchMock.mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200));

    const response = await legalFetch('/fetch_article_text', { method: 'POST', body });

    expect(response.status).toBe(200);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer old' });
    expect(fetchMock.mock.calls[1][1]).toEqual({
      method: 'POST',
      body,
      headers: { Authorization: 'Bearer new' },
    });
    expect(handleUnauthenticated).not.toHaveBeenCalled();
  });

  it('ends the session when the second answer is a 401 too, without a third try', async () => {
    getFreshAccessToken.mockResolvedValue('old');
    refreshAccessToken.mockResolvedValue('new');
    fetchMock.mockResolvedValue(answer(401));

    const response = await legalFetch('/fetch_tree', { method: 'POST', body });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handleUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('ends the session and returns the 401 when the refresh fails, or there is no refresh token', async () => {
    getFreshAccessToken.mockResolvedValue(null);
    refreshAccessToken.mockRejectedValue(new Error('No refresh token'));
    fetchMock.mockResolvedValue(answer(401));

    const response = await legalFetch('/fetch_tree', { method: 'POST', body });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(handleUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('does not send a body it cannot replay a second time', async () => {
    getFreshAccessToken.mockResolvedValue('old');
    fetchMock.mockResolvedValue(answer(401));

    const response = await legalFetch('/export_pdf', { method: 'POST', body: new Blob(['x']) });

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});

describe('legalFetch — everything else is the caller’s to handle', () => {
  it.each([403, 404, 429, 500, 502])('hands a %i back untouched, with no refresh', async (status) => {
    getFreshAccessToken.mockResolvedValue('tok');
    fetchMock.mockResolvedValue(answer(status));

    const response = await legalFetch('/fetch_tree', { method: 'POST', body: '{}' });

    expect(response.status).toBe(status);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(handleUnauthenticated).not.toHaveBeenCalled();
  });

  it('lets an abort through as fetch raises it, without ending the session', async () => {
    getFreshAccessToken.mockResolvedValue('tok');
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'));

    await expect(legalFetch('/fetch_tree', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(handleUnauthenticated).not.toHaveBeenCalled();
  });
});
