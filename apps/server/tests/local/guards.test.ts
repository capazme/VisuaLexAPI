import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import express from 'express';
import { SESSION_PATH, WINDOW_COOKIE, portGuard, readCookie, sameSecret, sessionExchange, windowGuard } from '../../src/local/guards';
import { derivedSecrets, parseLaunchLine } from '../../src/local/main';
import { call } from './http';

/**
 * The port's checks one by one (spec §6), on a small server built from the same guards as the local entry point:
 * the exact Host, no request another site starts, the shell's exchange by the launch secret only, the window's cookie.
 */
const launchSecret = randomBytes(32).toString('base64url');
const windowToken = randomBytes(32).toString('base64url');
let server: http.Server;
let port: number;
let opened = 0;

beforeAll(async () => {
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  const local = express();
  local.use(portGuard(port));
  local.post(SESSION_PATH, sessionExchange(launchSecret, async () => {
    opened += 1;
    return { cookies: [{ name: WINDOW_COOKIE, value: windowToken }] };
  }));
  local.use(windowGuard(windowToken));
  local.get('/api/health', (_req, res) => void res.json({ status: 'ok' }));
  server.on('request', local);
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const withWindow = { cookie: `${WINDOW_COOKIE}=${windowToken}` };

describe('the Host', () => {
  it('passes 127.0.0.1:<port> and refuses anything else with 421, the window cookie notwithstanding', async () => {
    expect((await call(port, { path: '/api/health', headers: withWindow })).status).toBe(200);
    for (const host of [`localhost:${port}`, 'evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, '127.0.0.1', `[::1]:${port}`]) {
      const answer = await call(port, { path: '/api/health', headers: { ...withWindow, host } });
      expect({ host, status: answer.status }).toEqual({ host, status: 421 });
    }
    // No Host at all: Node's own HTTP server refuses an HTTP/1.1 request without one (400) before the guard would.
    expect([400, 421]).toContain((await call(port, { path: '/api/health', headers: { ...withWindow, host: null } })).status);
  });
});

describe('requests another site starts', () => {
  it('refuses a foreign Origin, or the null one, with 403', async () => {
    for (const origin of ['http://evil.example', `http://localhost:${port}`, `http://127.0.0.1:${port + 1}`, `https://127.0.0.1:${port}`, 'null']) {
      const answer = await call(port, { path: '/api/health', headers: { ...withWindow, origin } });
      expect({ origin, status: answer.status }).toEqual({ origin, status: 403 });
    }
    expect((await call(port, { path: '/api/health', headers: { ...withWindow, origin: `http://127.0.0.1:${port}` } })).status).toBe(200);
  });

  it('refuses Sec-Fetch-Site cross-site and same-site, passes same-origin and none', async () => {
    for (const [site, status] of [['cross-site', 403], ['same-site', 403], ['same-origin', 200], ['none', 200]] as const) {
      const answer = await call(port, { path: '/api/health', headers: { ...withWindow, 'sec-fetch-site': site } });
      expect({ site, status: answer.status }).toEqual({ site, status });
    }
  });

  it('refuses a preflight from another site, and never sends a CORS header', async () => {
    const preflight = await call(port, {
      method: 'OPTIONS',
      path: '/api/health',
      headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    const own = await call(port, { path: '/api/health', headers: withWindow });
    expect(Object.keys(own.headers).filter((name) => name.startsWith('access-control-'))).toEqual([]);
  });
});

describe("the shell's exchange", () => {
  it('opens the window only for the launch secret, in the Authorization header', async () => {
    const before = opened;
    expect((await call(port, { method: 'POST', path: SESSION_PATH })).status).toBe(403);
    expect((await call(port, { method: 'POST', path: SESSION_PATH, headers: { authorization: `Bearer ${randomBytes(32).toString('base64url')}` } })).status).toBe(403);
    expect((await call(port, { method: 'POST', path: SESSION_PATH, headers: { authorization: `Bearer ${launchSecret}x` } })).status).toBe(403);
    expect((await call(port, { method: 'POST', path: SESSION_PATH, headers: { authorization: launchSecret } })).status).toBe(403);
    expect(opened).toBe(before);
    const answer = await call(port, { method: 'POST', path: SESSION_PATH, headers: { authorization: `Bearer ${launchSecret}` } });
    expect(answer.status).toBe(200);
    expect(answer.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(answer.text)).toEqual({
      cookies: [{ name: WINDOW_COOKIE, value: windowToken }],
      attributes: { path: '/', httpOnly: true, sameSite: 'Strict' },
    });
  });

  it('never takes the secret from the URL', async () => {
    for (const path of [`${SESSION_PATH}?k=${launchSecret}`, `${SESSION_PATH}?authorization=Bearer%20${launchSecret}`]) {
      expect((await call(port, { method: 'POST', path })).status).toBe(403);
      expect((await call(port, { method: 'GET', path })).status).toBe(403);
    }
    expect((await call(port, { path: `/api/health?k=${launchSecret}` })).status).toBe(403);
    expect((await call(port, { path: `/api/health?${WINDOW_COOKIE}=${windowToken}` })).status).toBe(403);
  });

  it('refuses a request that looks like a browser, even with the secret', async () => {
    const auth = { authorization: `Bearer ${launchSecret}` };
    for (const extra of [{ origin: `http://127.0.0.1:${port}` }, { 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-mode': 'cors' }, { 'sec-fetch-dest': 'empty' }]) {
      expect((await call(port, { method: 'POST', path: SESSION_PATH, headers: { ...auth, ...extra } })).status).toBe(403);
    }
  });
});

describe("the window's cookie", () => {
  it("is needed on every request, and must be exactly this launch's", async () => {
    expect((await call(port, { path: '/api/health' })).status).toBe(403);
    expect((await call(port, { path: '/api/health', headers: { cookie: `${WINDOW_COOKIE}=${randomBytes(32).toString('base64url')}` } })).status).toBe(403);
    expect((await call(port, { path: '/api/health', headers: { cookie: `x${WINDOW_COOKIE}=${windowToken}` } })).status).toBe(403);
    expect((await call(port, { path: '/api/health', headers: { cookie: `${WINDOW_COOKIE}=${windowToken}x` } })).status).toBe(403);
    expect((await call(port, { path: '/nowhere', headers: {} })).status).toBe(403);
    expect((await call(port, { path: '/api/health', headers: { cookie: `other=1; ${WINDOW_COOKIE}=${windowToken}` } })).status).toBe(200);
  });
});

describe('the helpers', () => {
  it('parses only `key=<64 hex> launch=<secret>`', () => {
    const key = randomBytes(32).toString('hex');
    expect(parseLaunchLine(`key=${key} launch=${launchSecret}\n`)).toEqual({ keyHex: key, launchSecret });
    expect(parseLaunchLine(`key=${key.toUpperCase()} launch=${launchSecret}`)).toBeNull();
    expect(parseLaunchLine(`key=${key.slice(1)} launch=${launchSecret}`)).toBeNull();
    expect(parseLaunchLine(`key=${key} launch=short`)).toBeNull();
    expect(parseLaunchLine(`launch=${launchSecret} key=${key}`)).toBeNull();
    expect(parseLaunchLine(`key=${key} launch=${launchSecret} extra=1`)).toBeNull();
  });

  it("derives the server's secrets from the key: stable, distinct, never the key", () => {
    const key = randomBytes(32).toString('hex');
    const first = derivedSecrets(key);
    expect(derivedSecrets(key)).toEqual(first);
    expect(derivedSecrets(randomBytes(32).toString('hex'))).not.toEqual(first);
    expect(Buffer.from(first.filesKey, 'base64')).toHaveLength(32);
    expect(first.jwtSecret).not.toContain(key);
    expect(Buffer.from(first.filesKey, 'base64').toString('hex')).not.toBe(key);
  });

  it('compares secrets whatever their lengths, and reads only the named cookie', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abcd')).toBe(false);
    expect(sameSecret('', 'abc')).toBe(false);
    expect(readCookie({ headers: { cookie: 'a=1; b=2=3' } }, 'b')).toBe('2=3');
    expect(readCookie({ headers: { cookie: 'ab=1' } }, 'b')).toBeNull();
    expect(readCookie({ headers: {} }, 'b')).toBeNull();
  });
});
