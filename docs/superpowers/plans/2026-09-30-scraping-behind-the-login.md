# Scraping behind the login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In production only a signed-in user can reach the scraping API (the Python routes), inside a per-user quota. In development nothing changes.

**Architecture:** The web app gets one authenticated `fetch`, `legalFetch`, for all 15 places that call the Python routes (and the health probe). The server gets `GET /api/auth/verify`: the same `authenticate` as every other route, plus a per-user quota. The ingress asks that endpoint through Caddy's `forward_auth` before it passes a scraping request to the scrapers, keeps `/version` and `/health` open, and never hands the scrapers the login token. Three pull requests, in this order; the third turns the gate on.

**Tech Stack:** React 19 + Vitest (jsdom); Express + `rate-limiter-flexible` + Vitest/supertest; Caddy 2 (`forward_auth`); a Node test for the Caddyfile; Docker for the live proof.

**Spec:** `docs/superpowers/specs/2026-09-29-modular-deployment-design.md`, section 5 (phase 2, steps 2 and 3), decision D7 and question Q7, settled here in favour of `forward_auth`. The analysis of the exposure that led to it: `docs/superpowers/plans/2026-09-29-auth-self-service-v2.md`, section 5, P2.

**Measured on develop `69eca58` (30 September 2026):** the browser calls the gated Python routes with a bare `fetch` from 15 places in 11 files (`useAnnexNavigation` 4, `SearchPanel` 2, and one each in `CompareView`, `TreeNavigatorModal`, `CommandPalette`, `NormaPicker`, `useAliasCatalog`, `useAutoSwitch`, `useCitationPreview`, `actUrn`, `articleFetchCache`), plus the health probe in `healthService.ts`, which takes its URL as a variable. `services/legalApi.ts`, which promised to consolidate them, has no importer. Nothing else reaches those routes: no `href`, no `window.open`, no `EventSource`. Web suite: 1475 tests in 128 files; the server type-checks clean (`tsc --noEmit`).

## Global Constraints

Copied from `CLAUDE.md` and the spec; every task's requirements include them.

- **Git flow:** "Branch from `develop` (`feat/`, `fix/`, `refactor/`, `chore/`, `docs/`), open a pull request into `develop`, merge it yourself with a merge commit titled `merge: <branch> — <what changes>` once CI is green." A hook refuses commits and pushes on `main` and `develop`.
- **The other developer's review is not a gate.** `CLAUDE.md` and `docs/git-workflow.md` say changes to authentication, the Prisma schema, `infra/`, `.github/` and the data scripts need his approval. Nothing enforces it (checked 30 September: `develop` and `main` have no branch protection, `.github/CODEOWNERS` does not exist, the owner is the only collaborator), and the owner decides. PRs 2 and 3 merge on green CI and say in their description that they touch authentication and `infra/`, so that he can read them afterwards.
- **Gates:** "The suites of every area you touched, green." Web: `npm --prefix apps/web run test -- --run`, `run build` (a bare `tsc --noEmit` reports a false green), `run lint`. Server: `npm --prefix apps/server run build` and `npm --prefix apps/server test` (only this way: the setup refuses a non-test database). Ingress: `node --test infra/ingress/paths.test.mjs`.
- **Nothing private enters the repository** (public repo): no address of the home network, no key, no personal path. `.env` files are never committed and are never read; set values through `scripts/prod/lib.sh` (`env_set`) inside a script.
- **Commits, pushes, pull requests and merges wait for the owner's go-ahead**, asked once per PR, with the commit message proposed.
- **Errors you surface in files you touch are fixed**, pre-existing ones too.
- **Web code:** no `any`; the `services/api.ts` file is a critical file (`apps/web/CLAUDE.md`); relative imports as the surrounding files do.
- **Tests must not depend on the Node that runs them.** On recent Node versions (26.5 measured on the development Mac) the bare `localStorage` global is Node's own unfinished one (`localStorage.getItem is not a function` under Vitest+jsdom); CI runs Node 24. A test that needs storage stubs it, as `api.session.test.ts` does below.
- **The contract of the gate:** every prefix Vite proxies to port 5000 is gated except `/version` and `/health`, matched exactly. `/health/detailed` reaches Normattiva, EUR-Lex and Brocardi for real and is **not** open.
- **Development is unchanged:** Vite proxies straight to port 5000, there is no ingress, and the `Authorization` header the web app now sends is ignored by the Python API.

## Review Focus

The failure modes the spec implies and no obvious test would name, most likely first. Each has its test in the task that owns the code.

1. **A token that expires while several articles load at once** (a dossier opened whole). Exactly one refresh, every request answered. Task 1 (`makes one refresh for several callers at once`), Task 2 (the 401 tests), Task 7 (a 20-second token in a real browser).
2. **The stream and the PDF.** `stream_article_text` must keep arriving line by line through the login check, and `export_pdf` must still hand back a file: `legalFetch` returns fetch's own `Response`, untouched. Task 2 (returns what fetch gives), Task 6 (first byte before the last line), Task 7 (a PDF export in the browser).
3. **A signed-out or revoked user.** They are sent to the login page once, with no request loop: a second 401 ends the session and is not retried a third time. Task 2.
4. **A heavy but legitimate day.** Opening a 40-article dossier and hovering citations must stay well inside 300 points a minute; past it the user gets a `429` with `Retry-After` that the existing error paths show as an error, not a blank reader. Task 4 (quota, cost by route), Task 7 (a small quota, a real 429).
5. **The server not answering.** The scraping paths fail (502/503), never open. Task 6.

---

## Order and pull requests

| PR | Branch | Tasks | Tree | Merged on green CI; worth a later look from the other developer |
|---|---|---|---|---|
| 1 | `feat/legal-fetch` | 1, 2, 3 | `apps/web` | no |
| 2 | `feat/scrape-gate-verify` | 4 | `apps/server` | yes: authentication |
| 3 | `feat/ingress-login-gate` | 5, 6, 7 | `infra/ingress`, docs | yes: `infra/` |

Merge order 1 → 2 → 3. Until PR 3 nothing changes for anyone: PR 1 only adds a header the Python API ignores, PR 2 adds an endpoint nobody calls. PR 3 switches the gate on, and is the only one that must be tried against a real stack (Task 7). Cut each branch from `develop` after the previous one has merged.

## Before you start

From the main checkout, one worktree per PR, cut from `develop` (a hook refuses commits on `develop` itself):

```bash
git worktree add ../VisuaLexAPI-legal-fetch -b feat/legal-fetch develop
ln -s "$PWD/apps/web/node_modules" ../VisuaLexAPI-legal-fetch/apps/web/node_modules
```

A worktree has no `node_modules`: link the main checkout's, and `unlink` the links before `git worktree remove`. The server worktree also needs `apps/server/node_modules` the same way, and the gitignored `apps/server/.env.test` (link it; it is never read or printed).

Commit with `git -C <worktree> …` if the shared hook, which reads the branch of the session's own directory, refuses. The server suite needs the development stores running, started **from the main checkout**, whose `infra/.env` they were created with (`./start.sh` there starts them, or `docker compose -f infra/compose.yml up -d --wait postgres redis`); it resets only a database whose name contains `test`.

## File map

| | File | Responsibility |
|---|---|---|
| create | `apps/web/src/services/legalFetch.ts` | `fetch` for the Python routes: token, one refresh, one retry |
| create | `apps/web/src/services/__tests__/api.session.test.ts` | `getFreshAccessToken` |
| create | `apps/web/src/services/__tests__/legalFetch.test.ts` | `legalFetch` |
| create | `apps/web/src/services/__tests__/legalFetch.guard.test.ts` | no bare fetch to a gated route, ever |
| modify | `apps/web/src/services/api.ts` | export the session helpers; one `getFreshAccessToken` for axios and fetch |
| modify | 11 call-site files and `healthService.ts` | `fetch(` → `legalFetch(` (table in Task 3) |
| delete | `apps/web/src/services/legalApi.ts` | dead, unauthenticated duplicate |
| create | `apps/server/src/middleware/scrapeGate.ts` | the handlers behind `GET /api/auth/verify` |
| create | `apps/server/tests/scrapeGate.test.ts` | the gate: 401, 204, quota, cost, address cap, mounting |
| modify | `apps/server/src/middleware/rateLimiter.ts`, `config.ts`, `app.ts` | share the limiter factory; `config.scrape`; mount before the general limiter |
| modify | `infra/ingress/Caddyfile`, `infra/ingress/paths.test.mjs` | `forward_auth`, the two open paths, the token kept from the scrapers |
| create | `infra/ingress/checks/gate.sh`, `stub_upstream.py` | the gate proved against stand-in upstreams |
| modify | `apps/web/CLAUDE.md`, `apps/server/CLAUDE.md`, `apps/server/.env.example`, `services/visualex/CLAUDE.md` | the contract, written where it will be read |

---

## PR 1 — the web app carries the login token

### Task 1: The session helpers of `api.ts`

**Files:**
- Modify: `apps/web/src/services/api.ts`
- Test: `apps/web/src/services/__tests__/api.session.test.ts` (create)

**Interfaces:**
- Consumes: `isAccessTokenExpired()` from `./authService`; the existing single in-flight `refreshInFlight`.
- Produces: `getFreshAccessToken(): Promise<string | null>` (the token to send now; refreshes an expired one first; a failed refresh returns the stale token); `refreshAccessToken(): Promise<string>` (now exported: throws when there is no refresh token or the refresh fails); `handleUnauthenticated(): void` (now exported: clears both tokens and goes to `/login`).

- [ ] **Step 1: Write the failing test**

`apps/web/src/services/__tests__/api.session.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm --prefix apps/web run test -- --run src/services/__tests__/api.session.test.ts`
Expected: FAIL, `getFreshAccessToken is not a function` (the export does not exist yet).

- [ ] **Step 3: Implement**

Apply to `apps/web/src/services/api.ts` (three edits: export the two functions, add `getFreshAccessToken`, make the axios request interceptor use it, so there is one refresh policy for axios and for fetch):

```diff
diff --git a/apps/web/src/services/api.ts b/apps/web/src/services/api.ts
index b42a5ef..033d170 100644
--- a/apps/web/src/services/api.ts
+++ b/apps/web/src/services/api.ts
@@ -31,5 +31,5 @@ const apiClient: AxiosInstance = axios.create({
 let refreshInFlight: Promise<string> | null = null;
 
-function handleUnauthenticated(): void {
+export function handleUnauthenticated(): void {
   localStorage.removeItem('access_token');
   localStorage.removeItem('refresh_token');
@@ -37,5 +37,5 @@ function handleUnauthenticated(): void {
 }
 
-async function refreshAccessToken(): Promise<string> {
+export async function refreshAccessToken(): Promise<string> {
   if (refreshInFlight) return refreshInFlight;
 
@@ -63,4 +63,22 @@ async function refreshAccessToken(): Promise<string> {
 }
 
+/**
+ * The access token to send now, for a request that does not go through axios (the
+ * scraping calls use fetch: see legalFetch.ts). A token past its expiry is refreshed
+ * first, through the same single in-flight promise as every other refresh; when the
+ * refresh fails the stale token is returned, and the 401 that follows decides.
+ */
+export async function getFreshAccessToken(): Promise<string | null> {
+  const token = localStorage.getItem('access_token');
+  if (token && isAccessTokenExpired() && localStorage.getItem('refresh_token')) {
+    try {
+      return await refreshAccessToken();
+    } catch {
+      // Fall through with the stale token.
+    }
+  }
+  return token;
+}
+
 /**
  * Request interceptor: attach access token. If the token is expired and
@@ -70,14 +88,7 @@ async function refreshAccessToken(): Promise<string> {
 apiClient.interceptors.request.use(
   async (config: InternalAxiosRequestConfig) => {
-    let token = localStorage.getItem('access_token');
-
-    if (token && isAccessTokenExpired() && localStorage.getItem('refresh_token')) {
-      try {
-        token = await refreshAccessToken();
-      } catch {
-        // Fall through with the stale token: the response interceptor
-        // will catch the resulting 401 and perform the final redirect.
-      }
-    }
+    // A stale token still goes out when the refresh fails: the response
+    // interceptor catches the resulting 401 and performs the final redirect.
+    const token = await getFreshAccessToken();
 
     if (token && config.headers) {
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npm --prefix apps/web run test -- --run src/services/__tests__/api.session.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm --prefix apps/web exec -- eslint src/services
git add apps/web/src/services/api.ts apps/web/src/services/__tests__/api.session.test.ts
git commit -m "refactor(web): one refresh policy for axios and fetch (getFreshAccessToken)"
```

### Task 2: `legalFetch`

**Files:**
- Create: `apps/web/src/services/legalFetch.ts`
- Test: `apps/web/src/services/__tests__/legalFetch.test.ts` (create)

**Interfaces:**
- Consumes: `getFreshAccessToken`, `refreshAccessToken`, `handleUnauthenticated` from `./api` (Task 1).
- Produces: `legalFetch(input: string, init?: RequestInit): Promise<Response>`. It returns fetch's own `Response`. With no token, the caller's `init` reaches `fetch` as the same object. On a 401 it refreshes once and sends the same request again (only when the body is `undefined`, `null` or a string); a refresh that fails, or a second 401, calls `handleUnauthenticated()`. Every other status, and an abort, pass through untouched.

- [ ] **Step 1: Write the failing test**

`apps/web/src/services/__tests__/legalFetch.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm --prefix apps/web run test -- --run src/services/__tests__/legalFetch.test.ts`
Expected: FAIL, `Failed to resolve import "../legalFetch"`.

- [ ] **Step 3: Implement**

`apps/web/src/services/legalFetch.ts`:

```ts
/**
 * `fetch` for the scraping API: the Python routes (/fetch_*, /stream_article_text,
 * /export_pdf, /parse_query, /health/detailed …).
 *
 * In production the ingress asks the server whether the caller is signed in before it
 * lets such a request through, so every call carries the access token. This is the one
 * place that knows it: it refreshes an expired token first (through the same single
 * in-flight refresh as services/api.ts), and on a 401 refreshes once and sends the
 * request again. It hands back fetch's own Response, so a caller reading a stream
 * (`stream_article_text`) or a file (`export_pdf`) gets exactly what fetch gives.
 *
 * Every call to those routes goes through here. `/version` and `/health` are the two the
 * ingress leaves open and need nothing. legalFetch.guard.test.ts fails on a bare fetch
 * to any other, which would work in development and be refused in production.
 */
import { getFreshAccessToken, handleUnauthenticated, refreshAccessToken } from './api';

function withAuthorization(
  headers: HeadersInit | undefined,
  token: string | null,
): HeadersInit | undefined {
  if (!token) return headers;
  const value = `Bearer ${token}`;
  if (!headers) return { Authorization: value };
  if (headers instanceof Headers) {
    const copy = new Headers(headers);
    copy.set('Authorization', value);
    return copy;
  }
  if (Array.isArray(headers)) {
    return [...headers.filter(([name]) => name.toLowerCase() !== 'authorization'), ['Authorization', value]];
  }
  return { ...headers, Authorization: value };
}

// A request can be sent a second time only while its body is still in hand.
function canBeSentAgain(init: RequestInit): boolean {
  return init.body === undefined || init.body === null || typeof init.body === 'string';
}

export async function legalFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | null): Promise<Response> => {
    const headers = withAuthorization(init.headers, token);
    // Without a token the caller's own init goes through untouched.
    return fetch(input, headers === init.headers ? init : { ...init, headers });
  };

  const response = await send(await getFreshAccessToken());
  if (response.status !== 401 || !canBeSentAgain(init)) return response;

  // The token was refused: it expired between the check and the request, or the session
  // ended. Refresh once and send again; a refresh that fails ends the session, as in api.ts.
  let token: string;
  try {
    token = await refreshAccessToken();
  } catch {
    handleUnauthenticated();
    return response;
  }
  const retry = await send(token);
  if (retry.status === 401) handleUnauthenticated();
  return retry;
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npm --prefix apps/web run test -- --run src/services/__tests__/legalFetch.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm --prefix apps/web exec -- eslint src/services
git add apps/web/src/services/legalFetch.ts apps/web/src/services/__tests__/legalFetch.test.ts
git commit -m "feat(web): legalFetch — fetch for the scraping routes, with the login token"
```

### Task 3: Every call to a scraping route goes through `legalFetch`

**Files:**
- Modify: the 11 files and `healthService.ts` in the table below; `apps/web/CLAUDE.md`
- Delete: `apps/web/src/services/legalApi.ts`
- Test: `apps/web/src/services/__tests__/legalFetch.guard.test.ts` (create)

**Interfaces:**
- Consumes: `legalFetch` (Task 2).
- Produces: the invariant "no source file calls a gated route with a bare `fetch`", enforced by the guard test.

- [ ] **Step 1: Write the failing guard test**

`apps/web/src/services/__tests__/legalFetch.guard.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// In production the ingress refuses a scraping call that carries no login token, so a bare
// fetch to one of those routes works in development and fails once deployed. This keeps
// every such call on legalFetch, the way infra/ingress/paths.test.mjs keeps the ingress
// in step with Vite.
const src = join(__dirname, '..', '..'); // apps/web/src
const vite = readFileSync(join(src, '..', 'vite.config.ts'), 'utf8');

// The Python routes are what Vite proxies to port 5000 (and what the ingress gates)…
const pythonRoutes = [...vite.matchAll(/'(\/[\w-]+)'\s*:\s*'http:\/\/localhost:5000'/g)].map((m) => m[1]);
// …except the two the ingress leaves open. /health/detailed is not one of them.
const open = new Set(['/version', '/health']);
const gated = [...pythonRoutes.filter((route) => !open.has(route)), '/health/detailed'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name === '__tests__' ? [] : sources(path);
    }
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const escape = (route: string) => route.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const bareFetch = new RegExp('\\bfetch\\(\\s*[`\'"](' + gated.map(escape).join('|') + ')');

describe('the scraping routes are called through legalFetch', () => {
  it('reads the route list from the Vite config', () => {
    expect(pythonRoutes.length).toBeGreaterThanOrEqual(10);
    expect(gated).not.toContain('/version');
    expect(gated).toContain('/fetch_article_text');
  });

  it('no source file calls a gated route with a bare fetch', () => {
    const offenders = sources(src)
      .filter((file) => !file.endsWith(join('services', 'legalFetch.ts')))
      .filter((file) => bareFetch.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(src.length + 1));
    expect(offenders).toEqual([]);
  });

  it('the health probe, which takes its URL as a variable, goes through legalFetch too', () => {
    const health = readFileSync(join(src, 'services', 'healthService.ts'), 'utf8');
    expect(health).toMatch(/legalFetch\(/);
    expect(health).not.toMatch(/[^A-Za-z.]fetch\(/);
  });

  it('the unauthenticated duplicate client is gone', () => {
    expect(existsSync(join(src, 'services', 'legalApi.ts'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm --prefix apps/web run test -- --run src/services/__tests__/legalFetch.guard.test.ts`
Expected: FAIL on three of the four tests: the 11 offending files are listed (`components/features/compare/CompareView.tsx`, `components/features/dossier/TreeNavigatorModal.tsx`, `components/features/search/CommandPalette.tsx`, `components/features/search/SearchPanel.tsx`, `features/merlt/contrib/NormaPicker.tsx`, `hooks/useAliasCatalog.ts`, `hooks/useAnnexNavigation.ts`, `hooks/useAutoSwitch.ts`, `hooks/useCitationPreview.ts`, `utils/actUrn.ts`, `utils/articleFetchCache.ts`), `healthService.ts` has no `legalFetch(`, and `legalApi.ts` still exists.

- [ ] **Step 3: Migrate the call sites**

In each file, change every `fetch('<route>'` to `legalFetch('<route>'` for the routes named, and add `import { legalFetch } from '<import path>';` after the file's last import. Change nothing else: the arguments, the `await`, the error handling and the abort handling stay as they are.

| File (under `apps/web/src/`) | Calls | Routes | Import path |
|---|---|---|---|
| `components/features/compare/CompareView.tsx` | 1 | `/fetch_article_text` | `../../../services/legalFetch` |
| `components/features/dossier/TreeNavigatorModal.tsx` | 1 | `/fetch_tree` | `../../../services/legalFetch` |
| `components/features/search/CommandPalette.tsx` | 1 | `/parse_query` | `../../../services/legalFetch` |
| `components/features/search/SearchPanel.tsx` | 2 | `/stream_article_text`, `/export_pdf` | `../../../services/legalFetch` |
| `features/merlt/contrib/NormaPicker.tsx` | 1 | `/parse_query` | `../../../services/legalFetch` |
| `hooks/useAliasCatalog.ts` | 1 | `/fetch_alias_catalog` | `../services/legalFetch` |
| `hooks/useAnnexNavigation.ts` | 4 | `/fetch_tree`, `/fetch_rubriche`, `/fetch_all_data` (twice) | `../services/legalFetch` |
| `hooks/useAutoSwitch.ts` | 1 | `/fetch_tree` | `../services/legalFetch` |
| `hooks/useCitationPreview.ts` | 1 | `/fetch_article_text` | `../services/legalFetch` |
| `utils/actUrn.ts` | 1 | `/fetch_norma_data` | `../services/legalFetch` |
| `utils/articleFetchCache.ts` | 1 | `/fetch_article_text` | `../services/legalFetch` |

`services/healthService.ts` is the exception. It has no imports and takes its URL as a variable: add `import { legalFetch } from './legalFetch';` and a blank line at the very top, and change `await fetch(url, { signal })` in `probe()` to `await legalFetch(url, { signal })` (both probes: the Node one is open and ignores the header; the Python one is gated).

Leave alone: `components/ui/SettingsModal.tsx` and `hooks/useVersionCheck.ts` (`/version`, open by design) and `features/merlt/contrib/contribApi.ts` (Node routes, own auth).

- [ ] **Step 4: Delete the dead client**

```bash
git rm apps/web/src/services/legalApi.ts
grep -rn "legalApi" apps/web/src docs --include='*.ts' --include='*.tsx' --include='*.md' | grep -v "docs/superpowers/plans/2026-09-29-auth-self-service-v2.md" | grep -v docs/archive
```
Expected: no output (the auth plan of 29 September names it as a record of how the question arose; leave it).

- [ ] **Step 5: Run the guard and the service tests and see them pass**

Run: `npm --prefix apps/web run test -- --run src/services`
Expected: PASS, 4 files and 29 tests (the 24 of this plan and the 5 of `merltService`).

- [ ] **Step 6: Run the gates**

```bash
npm --prefix apps/web run test -- --run     # expected: all green; 131 files / 1499 tests when this plan's 24 are counted
npm --prefix apps/web run build             # tsc -b + vite: the real type-check
npm --prefix apps/web run lint
```
If an existing test fails because the wrapper added a header, that test had put a token in storage: assert with `expect.objectContaining` instead of an exact `headers`. With no token the wrapper hands `fetch` the caller's own `init`, so the five tests that mock `fetch` (`actUrn`, `articleFetchCache`, `CommandPalette`, `AliasManager`, `CandidateCard`) are unaffected.

- [ ] **Step 7: Write the rule where it will be read**

In `apps/web/CLAUDE.md`:

1. Under **Critical Files → Frontend core**, add `services/legalFetch.ts` after `services/api.ts`.
2. Under **Shared utilities**, add:

```markdown
- `services/legalFetch.ts` — `legalFetch(path, init)`: `fetch` for the Python routes
  (`/fetch_*`, `/stream_article_text`, `/export_pdf`, `/parse_query`, `/health/detailed`…).
  It sends the login token (refreshing it first when expired, once more on a 401, through
  `api.ts`'s single in-flight refresh) because the production ingress refuses those calls
  without one, and it returns fetch's own `Response`, so the NDJSON stream and the PDF
  work as before. `/version` and `/health` are the two that stay open.
```

3. Add a gotcha after 29:

```markdown
30. **A bare `fetch` to a scraping route works in development and answers 401 in
    production.** Vite proxies those routes to the Python API with no login; the ingress
    does not. Call them through `legalFetch`. `services/__tests__/legalFetch.guard.test.ts`
    reads the route list from `vite.config.ts` and fails on a bare `fetch('/fetch_…'`,
    the way `infra/ingress/paths.test.mjs` keeps the ingress in step with the same list.
```

- [ ] **Step 8: Commit, open PR 1, merge when CI is green**

```bash
git add -A apps/web
git commit -m "refactor(web): every call to a scraping route goes through legalFetch

Fifteen call sites in eleven files and the health probe now send the login token, so
the production ingress can refuse a caller who is not signed in. A test reads the route
list from vite.config.ts and fails on a bare fetch to any gated route. services/legalApi.ts,
an unauthenticated client nobody imported, is deleted."
git push -u origin feat/legal-fetch
gh pr create --base develop --title "refactor(web): every call to a scraping route goes through legalFetch" --body "$(cat <<'EOF'
## Summary
- `legalFetch` (new): `fetch` for the Python routes. It sends the login token, refreshes an expired one first, and on a 401 refreshes once and sends the request again.
- 15 call sites in 11 files, and the health probe, use it. `services/legalApi.ts`, an unauthenticated client nobody imported, is deleted.
- A test reads the route list from `vite.config.ts` and fails on a bare `fetch` to any gated route.
- `api.ts`: one `getFreshAccessToken` for axios and fetch.

## Why
In production the ingress will refuse a scraping call that carries no login (PR 3 of `docs/superpowers/plans/2026-09-30-scraping-behind-the-login.md`). Until then the Python API ignores the header, so this changes nothing for anyone.

## Checked
Web suite 1499 tests green (24 new), `npm run build`, `npm run lint`.
EOF
)"
# once CI is green:
gh pr merge --merge --subject "merge: feat/legal-fetch — every scraping call carries the login token" --body ""
```

---

## PR 2 — the server answers the ingress's question

### Task 4: `GET /api/auth/verify` and the scraping quota

**Files:**
- Create: `apps/server/src/middleware/scrapeGate.ts`
- Create: `apps/server/tests/scrapeGate.test.ts`
- Modify: `apps/server/src/middleware/rateLimiter.ts`, `apps/server/src/config.ts`, `apps/server/src/app.ts`, `apps/server/.env.example`, `apps/server/CLAUDE.md`

**Interfaces:**
- Consumes: `authenticate` (`middleware/auth.ts`, unchanged); from `rateLimiter.ts`: `createLimiter(prefix, points, windowSeconds?)`, `getClientIp(req)`, `sendTooManyRequests(res, limiterRes)` (now exported).
- Produces: `createScrapeGate(options: ScrapeGateOptions): RequestHandler[]`, `scrapeCost(uri, costs?)`, `DEFAULT_SCRAPE_COSTS`; `config.scrape = { userPoints, windowSeconds, ipPoints }` (env `SCRAPE_QUOTA_POINTS` 300, `SCRAPE_QUOTA_WINDOW_SECONDS` 60, `SCRAPE_IP_POINTS` 1200); the route `GET /api/auth/verify` answering `204` / `401` / `429` (+ `Retry-After`). The ingress (Task 5) sends the original route in `X-Forwarded-Uri`.

- [ ] **Step 1: Write the failing tests**

`apps/server/tests/scrapeGate.test.ts`:

```ts
import express from 'express';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { app, authHeader, createTestUser, prisma, request } from './helpers';
import { createScrapeGate, scrapeCost, type ScrapeGateOptions } from '../src/middleware/scrapeGate';

// A small app around the gate alone, with the limits a test needs. One persistent listening
// server, for the reason tests/helpers.ts gives for the real app.
function gateApp(options: ScrapeGateOptions): Server {
  const gate = express();
  gate.set('trust proxy', 1);
  gate.get('/verify', ...createScrapeGate(options));
  const server = gate.listen(0, '127.0.0.1');
  server.unref();
  return server;
}

const roomy: ScrapeGateOptions = { userPoints: 1000, windowSeconds: 60, ipPoints: 1000 };

describe('scrapeCost', () => {
  it('prices a route by its path, whatever the query string', () => {
    expect(scrapeCost('/export_pdf')).toBe(20);
    expect(scrapeCost('/export_pdf?x=1')).toBe(20);
    expect(scrapeCost('/stream_article_text')).toBe(3);
    expect(scrapeCost('/fetch_all_data')).toBe(5);
    expect(scrapeCost('/health/detailed')).toBe(5);
    expect(scrapeCost('/fetch_article_text')).toBe(1);
  });

  it('costs 1 when the ingress did not say what was asked', () => {
    expect(scrapeCost(undefined)).toBe(1);
    expect(scrapeCost('')).toBe(1);
  });
});

describe('the scrape gate', () => {
  it('answers 401 without a token, and with something that is not a token', async () => {
    const server = gateApp(roomy);

    expect((await request(server).get('/verify')).status).toBe(401);
    expect((await request(server).get('/verify').set('Authorization', 'Bearer nonsense')).status).toBe(401);
  });

  it('answers 401 for an account that is no longer active', async () => {
    const user = await createTestUser('gate-inactive');
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });

    expect((await request(gateApp(roomy)).get('/verify').set(authHeader(user))).status).toBe(401);
  });

  it('answers 204 with no body to a signed-in user', async () => {
    const user = await createTestUser('gate-ok');

    const response = await request(gateApp(roomy)).get('/verify').set(authHeader(user));

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
  });

  it('gives each user a quota of their own, and answers 429 with Retry-After beyond it', async () => {
    const server = gateApp({ ...roomy, userPoints: 3 });
    const a = await createTestUser('gate-a');
    const b = await createTestUser('gate-b');

    for (let i = 0; i < 3; i += 1) {
      expect((await request(server).get('/verify').set(authHeader(a))).status).toBe(204);
    }
    const over = await request(server).get('/verify').set(authHeader(a));

    expect(over.status).toBe(429);
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect((await request(server).get('/verify').set(authHeader(b))).status).toBe(204);
  });

  it('charges a request by the route the ingress says it is for', async () => {
    const server = gateApp({ ...roomy, userPoints: 30 });
    const user = await createTestUser('gate-cost');
    const pdf = () =>
      request(server).get('/verify').set(authHeader(user)).set('X-Forwarded-Uri', '/export_pdf');

    expect((await pdf()).status).toBe(204); // 20 points of 30
    expect((await pdf()).status).toBe(429); // 20 more do not fit
  });

  it('caps one address, so a flood without a token stops at the door', async () => {
    const server = gateApp({ ...roomy, ipPoints: 3 });
    const statuses: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      statuses.push((await request(server).get('/verify')).status);
    }

    expect(statuses).toEqual([401, 401, 401, 429, 429]);
  });
});

describe('GET /api/auth/verify on the real app', () => {
  it('answers 401 without a token', async () => {
    expect((await request(app).get('/api/auth/verify')).status).toBe(401);
  });

  it('is counted by its own quota, not by the API’s general one', async () => {
    const user = await createTestUser('gate-real');

    for (let i = 0; i < 5; i += 1) {
      const verify = await request(app).get('/api/auth/verify').set(authHeader(user));
      expect(verify.status).toBe(204);
      expect(verify.headers['ratelimit-limit']).toBeUndefined(); // the general limiter never saw it
    }
    const me = await request(app).get('/api/auth/me').set(authHeader(user));

    expect(me.status).toBe(200);
    // 300 a minute for a signed-in user, and this is the first call the general limiter counts.
    expect(me.headers['ratelimit-remaining']).toBe('299');
  });
});
```

- [ ] **Step 2: Run them and see them fail**

With the development stores running (see *Before you start*):

```bash
npm --prefix apps/server test -- tests/scrapeGate.test.ts
```
Expected: FAIL, `Failed to resolve import "../src/middleware/scrapeGate"`.

- [ ] **Step 3: Implement**

Apply these edits (share the limiter factory, add `config.scrape`, mount the route **before** the general limiter, so that reading many articles does not spend the quota of every other call):

```diff
--- a/apps/server/src/middleware/rateLimiter.ts	2026-09-30 03:22:42
+++ b/apps/server/src/middleware/rateLimiter.ts	2026-09-30 03:22:42
@@ -15,5 +15,5 @@
 const WINDOW_SECONDS = 60; // 1 minute
 
-function createLimiter(keyPrefix: string, points: number): RateLimiterAbstract {
+export function createLimiter(keyPrefix: string, points: number, windowSeconds = WINDOW_SECONDS): RateLimiterAbstract {
   const redis = getRedisClient();
   if (redis) {
@@ -22,5 +22,5 @@
       keyPrefix,
       points,
-      duration: WINDOW_SECONDS,
+      duration: windowSeconds,
     });
   }
@@ -28,5 +28,5 @@
     keyPrefix,
     points,
-    duration: WINDOW_SECONDS,
+    duration: windowSeconds,
   });
 }
@@ -59,5 +59,5 @@
 }
 
-function getClientIp(req: Request): string {
+export function getClientIp(req: Request): string {
   // Relies on Express trust proxy setting for safe IP extraction.
   // Never read X-Forwarded-For directly — it's spoofable.
@@ -72,5 +72,5 @@
 }
 
-function sendTooManyRequests(res: Response, limiterRes: RateLimiterRes): void {
+export function sendTooManyRequests(res: Response, limiterRes: RateLimiterRes): void {
   const retryAfter = Math.ceil(limiterRes.msBeforeNext / 1000);
   res.set('Retry-After', String(retryAfter));
--- a/apps/server/src/config.ts	2026-09-30 03:22:42
+++ b/apps/server/src/config.ts	2026-09-30 03:22:42
@@ -42,4 +42,11 @@
   },
 
+  // The ingress asks GET /api/auth/verify before a scraping request (middleware/scrapeGate.ts).
+  scrape: {
+    userPoints: parseInt(process.env.SCRAPE_QUOTA_POINTS || '300', 10),
+    windowSeconds: parseInt(process.env.SCRAPE_QUOTA_WINDOW_SECONDS || '60', 10),
+    ipPoints: parseInt(process.env.SCRAPE_IP_POINTS || '1200', 10),
+  },
+
   merlt: {
     // `enabled` and `flags.*` are getters, not frozen booleans: they are
--- a/apps/server/src/app.ts	2026-09-30 03:22:42
+++ b/apps/server/src/app.ts	2026-09-30 03:22:42
@@ -6,4 +6,5 @@
 import { errorHandler } from './middleware/errorHandler';
 import { globalRateLimiter, writeRateLimiter } from './middleware/rateLimiter';
+import { createScrapeGate } from './middleware/scrapeGate';
 import authRoutes from './routes/auth';
 import adminRoutes from './routes/admin';
@@ -46,4 +47,9 @@
 }));
 
+// The ingress asks here before it lets a scraping request through. The gate has its own limits
+// (per user and per address), so it comes before the general limiter: reading many articles must
+// not use up the quota of every other call.
+app.get('/api/auth/verify', ...createScrapeGate(config.scrape));
+
 // Rate limiting: anonymous 100/min, authenticated 300/min, writes 20/min
 // Uses Redis if REDIS_ENABLED=true, otherwise in-memory
```

Create `apps/server/src/middleware/scrapeGate.ts`:

```ts
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { RateLimiterRes } from 'rate-limiter-flexible';
import { authenticate } from './auth';
import { createLimiter, getClientIp, sendTooManyRequests } from './rateLimiter';

/**
 * What one scraping request costs against a user's quota, by route. Anything not listed
 * costs 1. The export starts a Chromium; the stream and the whole-act fetch carry many
 * articles in one request; the detailed health page reaches the three sources for real.
 */
export const DEFAULT_SCRAPE_COSTS: Record<string, number> = {
  '/export_pdf': 20,
  '/stream_article_text': 3,
  '/fetch_all_data': 5,
  '/health/detailed': 5,
};

/** The cost of the request the ingress is asking about, from the URI it forwards. */
export function scrapeCost(
  uri: string | undefined,
  costs: Record<string, number> = DEFAULT_SCRAPE_COSTS,
): number {
  const path = (uri ?? '').split('?')[0];
  return costs[path] ?? 1;
}

export interface ScrapeGateOptions {
  /** Points a user may spend per window. */
  userPoints: number;
  windowSeconds: number;
  /** Requests per window from one address, whatever they carry: the cap on a flood without a token. */
  ipPoints: number;
  costs?: Record<string, number>;
}

/**
 * The handlers behind GET /api/auth/verify, the question the ingress (Caddy forward_auth)
 * puts to the server before it passes a scraping request to the scrapers. In order: a cap
 * per address, the same authentication as every other route, the user's quota (charged by
 * the route named in X-Forwarded-Uri), then 204. A non-2xx answer goes back to the caller
 * as it is, so the 401 and the 429 with its Retry-After reach the browser.
 */
export function createScrapeGate(options: ScrapeGateOptions): RequestHandler[] {
  const ipLimiter = createLimiter('rl:scrape-ip', options.ipPoints, options.windowSeconds);
  const userLimiter = createLimiter('rl:scrape-user', options.userPoints, options.windowSeconds);

  const perAddress: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await ipLimiter.consume(getClientIp(req));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        sendTooManyRequests(res, err);
        return;
      }
      console.error('[scrapeGate] address limiter error (fail-open):', err);
      next();
    }
  };

  const perUser: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ detail: 'Authentication failed' });
      return;
    }
    const uri = req.header('x-forwarded-uri');
    try {
      await userLimiter.consume(user.id, scrapeCost(uri, options.costs));
      next();
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        console.warn(`[scrapeGate] user ${user.id} is over the scraping quota (${uri ?? 'unknown route'})`);
        sendTooManyRequests(res, err);
        return;
      }
      console.error('[scrapeGate] user limiter error (fail-open):', err);
      next();
    }
  };

  const allow: RequestHandler = (_req: Request, res: Response) => {
    res.status(204).end();
  };

  return [perAddress, authenticate, perUser, allow];
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `npm --prefix apps/server test -- tests/scrapeGate.test.ts`
Expected: PASS, 10 tests (2 for `scrapeCost`, 6 for the gate, 2 on the real app).

- [ ] **Step 5: Run the gates**

```bash
npm --prefix apps/server run build
npm --prefix apps/server test
```
Expected: both green.

- [ ] **Step 6: Write the contract where it will be read**

`apps/server/.env.example`, after the `REDIS_ENABLED` line:

```
# The production ingress asks GET /api/auth/verify before it lets a scraping request through.
# A user's quota is in points per window (a plain request costs 1, a PDF export 20); the
# address cap counts every call to the endpoint, with or without a token.
# SCRAPE_QUOTA_POINTS=300
# SCRAPE_QUOTA_WINDOW_SECONDS=60
# SCRAPE_IP_POINTS=1200
```

`apps/server/CLAUDE.md`: after the `src/utils/redis.ts` bullet in the Node backend list, add

```markdown
- `src/middleware/scrapeGate.ts` — the handlers behind `GET /api/auth/verify`, the question
  the production ingress (Caddy `forward_auth`) puts to the server before it lets a scraping
  request through to the Python API. In order: a cap per address (`SCRAPE_IP_POINTS`, 1200 a
  minute: a flood with no token stops here), `authenticate`, the user's quota
  (`SCRAPE_QUOTA_POINTS`, 300 points per `SCRAPE_QUOTA_WINDOW_SECONDS`, charged by the route
  the ingress names in `X-Forwarded-Uri`: an export 20, a stream 3, a whole act 5, the
  detailed health page 5, anything else 1), then `204`. A `401` or `429` (with `Retry-After`)
  goes back to the browser as it is. Mounted **before** the general limiter in `app.ts` on
  purpose: it has limits of its own, and reading many articles must not spend the quota of
  every other call. Limiter errors fail open, authentication never does.
```

and add `SCRAPE_QUOTA_POINTS`, `SCRAPE_QUOTA_WINDOW_SECONDS` and `SCRAPE_IP_POINTS` (defaults 300, 60, 1200) to the **Environment Variables** paragraph.

- [ ] **Step 7: Commit, open PR 2, merge when CI is green**

```bash
git add apps/server
git commit -m "feat(server): GET /api/auth/verify — the login check and scraping quota the ingress asks for"
git push -u origin feat/scrape-gate-verify
gh pr create --base develop --title "feat(server): GET /api/auth/verify — the login check and scraping quota the ingress asks for" --body "$(cat <<'EOF'
## Summary
`GET /api/auth/verify`: the question the production ingress will put to the server before it passes a scraping request on. A cap per address, then `authenticate`, then a per-user quota charged by the route named in `X-Forwarded-Uri`, then 204. A 401 or a 429 (with `Retry-After`) goes back to the caller as it is. It is mounted before the general limiter so that reading many articles does not spend the quota of every other call.

## For the other developer, after the merge
Touches authentication: a new route in `apps/server` that reuses `authenticate`.

## Checked
10 new tests; the server suite and `npm run build` green. Nothing calls the endpoint until PR 3.
EOF
)"
gh pr merge --merge --subject "merge: feat/scrape-gate-verify — the endpoint the ingress asks before a scraping call" --body ""
```

---

## PR 3 — the ingress asks, and the gate is proved

### Task 5: The Caddyfile asks the server, and the test that keeps it honest

**Files:**
- Modify: `infra/ingress/Caddyfile`, `infra/ingress/paths.test.mjs`, `services/visualex/CLAUDE.md`

**Interfaces:**
- Consumes: `GET /api/auth/verify` (Task 4) at `{$SERVER_UPSTREAM:server:3001}`; the `@legal` prefix list, which stays equal to Vite's.
- Produces: the matcher `@open` (`/version`, `/health`, exact, proxied with no `Authorization`); the block matcher `@legal` (the Vite list minus those two); `forward_auth` on `@legal`; `header_up -Authorization` towards the scrapers.

- [ ] **Step 1: Write the failing tests**

Apply to `infra/ingress/paths.test.mjs` (the matcher becomes a block, so the parsing changes; three tests are added):

```diff
--- a/infra/ingress/paths.test.mjs
+++ b/infra/ingress/paths.test.mjs
@@ -20,7 +20,25 @@
 }
 
+function legalBlock() {
+  const block = caddyfile.match(/@legal\s*\{([^}]*)\}/);
+  assert.ok(block, 'the Caddyfile has no "@legal { … }" matcher block');
+  return block[1];
+}
+
 function caddyLegalTokens() {
-  const line = caddyfile.match(/^\s*@legal\s+path\s+(.+)$/m);
-  assert.ok(line, 'the Caddyfile has no "@legal path …" matcher');
+  const line = legalBlock().match(/^\s*path\s+(.+)$/m);
+  assert.ok(line, 'the @legal block has no "path …" line');
+  return line[1].trim().split(/\s+/);
+}
+
+function caddyOpenPaths() {
+  const line = caddyfile.match(/^\s*@open\s+path\s+(.+)$/m);
+  assert.ok(line, 'the Caddyfile has no "@open path …" matcher');
+  return line[1].trim().split(/\s+/);
+}
+
+function caddyExcludedPaths() {
+  const line = legalBlock().match(/^\s*not\s+path\s+(.+)$/m);
+  assert.ok(line, 'the @legal block does not exclude the open paths');
   return line[1].trim().split(/\s+/);
 }
@@ -55,2 +73,22 @@
   }
 });
+
+test('only /version and /health stay open, and each exactly', () => {
+  assert.deepEqual([...caddyOpenPaths()].sort(), ['/health', '/version']);
+  for (const token of caddyOpenPaths()) {
+    // /health/detailed reaches Normattiva, EUR-Lex and Brocardi for real: it is not open.
+    assert.ok(!token.includes('*'), `${token} must match exactly, not by prefix`);
+  }
+});
+
+test('the @legal block leaves out exactly the open paths', () => {
+  assert.deepEqual([...caddyExcludedPaths()].sort(), [...caddyOpenPaths()].sort());
+});
+
+test('the scraping handle asks the server before it proxies, and keeps the login token from the scrapers', () => {
+  const handle = caddyfile.match(/handle @legal \{([\s\S]*?)\n\t\}/);
+  assert.ok(handle, 'the Caddyfile has no "handle @legal" block');
+  assert.match(handle[1], /forward_auth\s+\{\$SERVER_UPSTREAM:server:3001\}\s*\{\s*uri \/api\/auth\/verify\s*\}/);
+  assert.match(handle[1], /header_up -Authorization/);
+  assert.match(handle[1], /flush_interval -1/);
+});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test infra/ingress/paths.test.mjs`
Expected: FAIL, `the Caddyfile has no "@legal { … }" matcher block` (the Caddyfile still has the single-line matcher).

- [ ] **Step 3: Change the Caddyfile**

In `infra/ingress/Caddyfile`, replace everything from the comment `# The scrapers. This is the same list Vite proxies…` down to and including the closing `}` of `handle @legal`, and keep the blank line and the `# Hashed assets never change…` block that follows, with:

```
	# The scrapers. The list below is the one Vite proxies to port 5000 in development,
	# prefix for prefix; infra/ingress/paths.test.mjs keeps the two in step.
	#
	# Two of them stay open: /version and /health, exactly. Everything else asks the server
	# first (forward_auth to GET /api/auth/verify, which answers 2xx for a signed-in user
	# inside their quota and 401 or 429 otherwise; a non-2xx answer goes back to the caller
	# as it is). If the server does not answer, the request fails: the gate is closed by default.
	@open path /version /health
	handle @open {
		reverse_proxy {$SCRAPERS_UPSTREAM:scrapers:5000} {
			header_up -Authorization
		}
	}
	@legal {
		path /fetch_norma_data* /fetch_article_text* /stream_article_text* /fetch_brocardi_info* /fetch_all_data* /fetch_tree* /fetch_rubriche* /fetch_alias_catalog* /parse_query* /extract_citations* /export_pdf* /version* /health*
		not path /version /health
	}
	handle @legal {
		request_body {
			max_size 1MB
		}
		forward_auth {$SERVER_UPSTREAM:server:3001} {
			uri /api/auth/verify
		}
		# /stream_article_text answers NDJSON, one line per article: no buffering.
		# The scrapers never see the login token.
		reverse_proxy {$SCRAPERS_UPSTREAM:scrapers:5000} {
			flush_interval -1
			header_up -Authorization
		}
	}
```

- [ ] **Step 4: Run the test and see it pass, then validate the syntax with Caddy itself**

```bash
node --test infra/ingress/paths.test.mjs
docker run --rm -v "$PWD/infra/ingress/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -1
```
Expected: 7 tests pass; `Valid configuration`. (The image build also runs `caddy validate`.)

- [ ] **Step 5: Write the rule where it will be read**

In `services/visualex/CLAUDE.md`, after the `TRUSTED_PROXIES` bullet, add:

```markdown
- **Behind the ingress the scraping routes need a login.** The Caddyfile asks the server
  (`GET /api/auth/verify`) before it passes a request on, except `/version` and `/health`.
  The Python API itself stays unauthenticated inside the network (the ingress is its only
  door) and never sees the login token (`header_up -Authorization`).
```

- [ ] **Step 6: Commit**

```bash
git add infra/ingress services/visualex/CLAUDE.md
git commit -m "feat(ingress): the scraping routes ask the server before they pass a request on"
```

### Task 6: The gate, proved against stand-in upstreams

**Files:**
- Create: `infra/ingress/checks/stub_upstream.py`, `infra/ingress/checks/gate.sh`

**Interfaces:**
- Consumes: the real `infra/ingress/Caddyfile`, run by the `caddy:2-alpine` image; Docker; `python3`.
- Produces: `sh infra/ingress/checks/gate.sh` — 15 checks, exit 0 when the gate behaves. It is written to be lifted into the CI job of the deployment plan (Task 7 there) unchanged.

- [ ] **Step 1: Write the stand-in upstreams**

`infra/ingress/checks/stub_upstream.py`:

```python
#!/usr/bin/env python3
"""Two stand-in upstreams for the ingress gate check (infra/ingress/checks/gate.sh).

    stub_upstream.py server   PORT   the server: GET /api/auth/verify
    stub_upstream.py scrapers PORT   the scrapers: anything else

server:   answers 204 to "Bearer good-token", 429 with Retry-After: 7 to "Bearer slow-down",
          401 to everything else, and remembers the X-Forwarded-Uri and X-Forwarded-Method
          the ingress sent with the question.
scrapers: answers 200 "scrapers <METHOD> <path>", remembers the Authorization header it
          received, and streams three NDJSON lines a second apart on /stream_article_text.
Both answer GET /__seen with what they have recorded, as JSON. Standard library only.
"""
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

role, port = sys.argv[1], int(sys.argv[2])
seen = {"calls": 0, "last": {}}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):  # quiet
        pass

    def reply(self, status, body=b"", headers=None):
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def handle_any(self):
        # Read the body even though nothing uses it: the connection is reused, and unread
        # bytes would be taken for the next request line.
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        if self.path == "/__seen":
            return self.reply(200, json.dumps(seen).encode(), {"Content-Type": "application/json"})
        seen["calls"] += 1
        if role == "server":
            seen["last"] = {
                "uri": self.headers.get("X-Forwarded-Uri"),
                "method": self.headers.get("X-Forwarded-Method"),
                "path": self.path,
            }
            token = self.headers.get("Authorization", "")
            if token == "Bearer good-token":
                return self.reply(204)
            if token == "Bearer slow-down":
                return self.reply(429, b'{"detail":"Too many requests"}', {"Retry-After": "7", "Content-Type": "application/json"})
            return self.reply(401, b'{"detail":"Missing or invalid authorization header"}', {"Content-Type": "application/json"})
        seen["last"] = {"authorization": self.headers.get("Authorization"), "path": self.path}
        if self.path.startswith("/stream_article_text"):
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            for n in range(3):
                line = json.dumps({"n": n}).encode() + b"\n"
                self.wfile.write(b"%x\r\n%s\r\n" % (len(line), line))
                self.wfile.flush()
                time.sleep(1)
            self.wfile.write(b"0\r\n\r\n")
            return
        self.reply(200, f"scrapers {self.command} {self.path}".encode(), {"Content-Type": "text/plain"})

    do_GET = do_POST = do_HEAD = handle_any


ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
```

- [ ] **Step 2: Write the check script**

`infra/ingress/checks/gate.sh`:

```sh
#!/bin/sh
# The login gate at the ingress, proved against stand-in upstreams: the real Caddyfile, run by
# the caddy image, in front of infra/ingress/checks/stub_upstream.py. Needs Docker and python3.
#
#   sh infra/ingress/checks/gate.sh
#
# Ports: the ingress on 18081, the stand-in server on 13001, the stand-in scrapers on 15000.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
B=http://127.0.0.1:18081
name="vlx-gate-check-$$"
pids=""
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1
  for p in $pids; do kill "$p" 2>/dev/null; done
}
trap cleanup EXIT INT TERM

python3 "$here/stub_upstream.py" server 13001 & server_pid=$!; pids="$server_pid"
python3 "$here/stub_upstream.py" scrapers 15000 & scrapers_pid=$!; pids="$pids $scrapers_pid"
docker run -d --rm --name "$name" -p 127.0.0.1:18081:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e SERVER_UPSTREAM=host.docker.internal:13001 -e SCRAPERS_UPSTREAM=host.docker.internal:15000 \
  -v "$root/infra/ingress/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null || { echo "cannot start caddy"; exit 1; }

# wait until the ingress answers (any status)
i=0; until curl -s -o /dev/null -m 2 "$B/version"; do i=$((i + 1)); [ "$i" -gt 30 ] && { echo "the ingress did not start"; exit 1; }; sleep 1; done

code()   { curl -s -o /dev/null -m 10 -w '%{http_code}' "$@"; }
seen()   { curl -s -m 5 "http://127.0.0.1:$1/__seen" | python3 -c "import json,sys; d=json.load(sys.stdin); print($2)"; }
scraper_calls() { seen 15000 'd["calls"]'; }
verify_calls()  { seen 13001 'd["calls"]'; }
expect() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted '$2', got '$3')"; fi; }

# 1. no token: refused at the door, and the scrapers never hear of it
before="$(scraper_calls)"
expect "a scraping call without a token is refused" 401 "$(code -X POST -d '{}' "$B/fetch_article_text")"
expect "and the scrapers were not called" "$before" "$(scraper_calls)"

# 2. a good token: let through, with the question the server needs, and no token for the scrapers
body="$(curl -s -m 10 -X POST -H 'Authorization: Bearer good-token' -d '{}' "$B/fetch_article_text?x=1")"
expect "a signed-in call reaches the scrapers" "scrapers POST /fetch_article_text?x=1" "$body"
expect "the server was asked what the call was" "/fetch_article_text?x=1 POST" "$(seen 13001 'd["last"]["uri"] + " " + d["last"]["method"]')"
expect "and the scrapers never saw the login token" "None" "$(seen 15000 'd["last"]["authorization"]')"

# 3. over the quota: the server's 429 reaches the caller with its Retry-After, the scrapers are spared
before="$(scraper_calls)"
expect "over the quota the caller gets 429" 429 "$(code -H 'Authorization: Bearer slow-down' "$B/fetch_tree")"
expect "with the server's Retry-After" "7" "$(curl -s -m 10 -D - -o /dev/null -H 'Authorization: Bearer slow-down' "$B/fetch_tree" | tr -d '\r' | sed -n 's/^[Rr]etry-[Aa]fter: //p')"
expect "and the scrapers were not called" "$before" "$(scraper_calls)"

# 4. /version and /health stay open and do not ask the server
before="$(verify_calls)"
expect "/version is open" 200 "$(code "$B/version")"
expect "/health is open" 200 "$(code "$B/health")"
expect "and the server was not asked" "$before" "$(verify_calls)"

# 5. /health/detailed reaches the sources: not open
expect "/health/detailed needs a login" 401 "$(code "$B/health/detailed")"
expect "/health/detailed answers a signed-in caller" 200 "$(code -H 'Authorization: Bearer good-token' "$B/health/detailed")"

# 6. the stream still comes line by line through the gate
timing="$(curl -s -m 20 -o /dev/null -H 'Authorization: Bearer good-token' -w '%{time_starttransfer} %{time_total}' -X POST -d '{}' "$B/stream_article_text")"
first="${timing% *}"; total="${timing#* }"
if python3 -c "import sys; sys.exit(0 if float('$first') < 1.0 and float('$total') >= 2.0 else 1)"; then
  ok "the stream flushes line by line (first byte at ${first}s, done at ${total}s)"
else
  bad "the stream flushes line by line (first byte at ${first}s, done at ${total}s)"
fi

# 7. the server does not answer: the gate stays shut
kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null; sleep 1
status="$(code -H 'Authorization: Bearer good-token' -X POST -d '{}' "$B/fetch_article_text")"
case "$status" in 502|503|504) ok "with no server behind it the gate is closed ($status)" ;; *) bad "with no server behind it the gate is closed (got $status)" ;; esac

exit "$fail"
```

- [ ] **Step 3: Run it and see every check pass**

Run: `sh infra/ingress/checks/gate.sh`
Expected: 15 `ok` lines, no `FAIL`, exit 0, no container or listener left behind (`docker ps -a | grep vlx-gate` and `lsof -iTCP:18081 -iTCP:13001 -iTCP:15000` print nothing).

- [ ] **Step 4: Prove the script bites**

Remove the `forward_auth …` block from the Caddyfile (a temporary edit), run the script again, and see `FAIL a scraping call without a token is refused (wanted '401', got '200')` and the two checks that depend on it; restore the file with `git checkout infra/ingress/Caddyfile` and see it pass again. Do the same with the line `header_up -Authorization` in the `@legal` block: `FAIL and the scrapers never saw the login token`.

- [ ] **Step 5: Commit**

```bash
git add infra/ingress/checks
git commit -m "test(ingress): prove the login gate against stand-in upstreams"
```

### Task 7: The gate on a throwaway production stack, with a real browser

**Files:**
- Modify: `docs/superpowers/specs/2026-09-29-modular-deployment-design.md` (section 5, steps 2 and 3: mark them done, with the PR numbers)

**Interfaces:**
- Consumes: PRs 1 and 2 merged (the branch of PR 3 is cut after them); `./start.sh --prod` and `scripts/prod/lib.sh`.
- Produces: the evidence the earlier tasks cannot give: the real server, the real ingress and the built web app together, with a token that expires.

- [ ] **Step 1: Build a throwaway stack** (its own name, ports and subnet; the real development stack is not touched)

Write this as a script **outside the repository** so that no command line carries an `.env` path, and run it with the worktree of PR 3 and a scratch directory as arguments:

```bash
#!/bin/bash
# gate-trial-setup.sh <worktree> <scratch dir>
set -eu
W="$1"; SCR="$2"
rm -rf "$SCR"; mkdir -p "$SCR"
( cd "$W" && git ls-files -co --exclude-standard -z | tar --null -T - -cf - ) | tar -xf - -C "$SCR"
git -C "$SCR" init -q -b feat/trial
git -C "$SCR" add -A
git -C "$SCR" -c user.name=trial -c user.email=trial@example.invalid commit -q -m trial
cd "$SCR"
sh scripts/prod/init-env.sh
. scripts/prod/lib.sh
for kv in VISUALEX_STACK=vxgate VISUALEX_PG_PORT=15436 VISUALEX_REDIS_PORT=16381 VISUALEX_FALKOR_PORT=16382 \
          VISUALEX_QDRANT_PORT=16343 VISUALEX_QDRANT_GRPC_PORT=16344 INGRESS_PORT=18080 \
          PUBLIC_ORIGIN=http://localhost:18080 MERLT_ENABLED=false; do
  env_set infra/.env "${kv%%=*}" "${kv#*=}"
done
env_set apps/server/.env JWT_ACCESS_EXPIRY 20s      # a short-lived token, to see the refresh
env_set apps/server/.env SCRAPE_QUOTA_POINTS 40     # a small quota, to see the 429
```

Then `cd <scratch> && bash start.sh --prod --allow-branch` and wait for the report (every module up and healthy). Seed a test account with a password made for the run and never printed:

```bash
TEST_PW="Tp-$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 20)"
docker compose -f infra/compose.yml -f infra/compose.app.yml -f infra/compose.scrapers.yml -f infra/compose.prod.yml \
  exec -T -e ADMIN_EMAIL=trial-admin@example.invalid -e ADMIN_USERNAME=trialadmin -e ADMIN_PASSWORD="$TEST_PW" \
  server node dist/utils/seed.js >/dev/null
```

- [ ] **Step 2: Check the gate with curl** (`B=http://127.0.0.1:18080`, the token from `POST $B/api/auth/login` with `{"email":"trial-admin@example.invalid","password":"$TEST_PW"}`, taken inside the script)

| Call | Expected |
|---|---|
| `GET /fetch_alias_catalog`, no token | `401` |
| `GET /fetch_alias_catalog`, with the token | `200`, JSON with the presets |
| `GET /version`, `GET /health`, no token | `200` |
| `GET /health/detailed`, no token | `401` |
| `GET /api/auth/verify`, with the token | `204` |
| 60 calls to `/fetch_alias_catalog` in a row, with the token | `200` up to the quota, then `429` with a `Retry-After` header |

- [ ] **Step 3: A browser pass through the ingress**

With the Browser pane, open `http://localhost:18080`, sign in as `trial-admin@example.invalid`, and:

1. Open a norm (for example *art. 2043 codice civile* from the palette). The text appears. In the network panel, `/fetch_article_text` carries an `Authorization` header.
2. Wait 25 seconds (the access token lives 20) and open another article. It loads, and the panel shows one `POST /api/auth/refresh` before it: Review Focus 1.
3. Export the open article as PDF: a file is offered (needs the network to Normattiva; if it is unreachable, say so instead of skipping silently): Review Focus 2.
4. Remove `access_token` and `refresh_token` from local storage and open an article: the app returns to the login page once, with no request loop: Review Focus 3.

- [ ] **Step 4: Tear down what you made**

`docker compose … down -v --remove-orphans` for the stack `vxgate` only (check `docker compose … config --format json` names that project before running it), remove the scratch directory and `~/visualex-backups/vxgate-*` if a backup was taken.

- [ ] **Step 5: Mark the spec, commit, open PR 3, merge when CI is green**

In section 5 of the deployment spec, mark steps 2 and 3 done with the three PR numbers (a one-line status each). Then:

```bash
git add docs/superpowers/specs/2026-09-29-modular-deployment-design.md
git commit -m "docs(deploy): phase 2 steps 2 and 3 are built and proved"
git push -u origin feat/ingress-login-gate
gh pr create --base develop --title "feat(ingress): the scraping routes need a login" --body "$(cat <<'EOF'
## Summary
The Caddyfile now asks the server (`forward_auth` to `/api/auth/verify`) before it passes a request to the scrapers. `/version` and `/health`, matched exactly, stay open. The scrapers never see the login token. If the server does not answer, the request fails.

## For the other developer, after the merge
Touches `infra/`.

## Checked
- `node --test infra/ingress/paths.test.mjs`: 7 tests (3 new); `caddy validate`.
- `sh infra/ingress/checks/gate.sh`: 15 checks against stand-in upstreams (401 without a token and the scrapers not called, the 429 and its Retry-After passing through, the token kept from the scrapers, the open paths, the stream flushing, closed when the server is down).
- A throwaway production stack with a 20-second token and a 40-point quota, driven by curl and by a browser: sign-in, an article, the refresh, the 429, the return to the login page.
EOF
)"
gh pr merge --merge --subject "merge: feat/ingress-login-gate — the scraping routes need a login" --body ""
```

---

## Coverage of the spec (section 5, phase 2)

| Spec | Where |
|---|---|
| Step 2: one authenticated client for the 17 call sites; token attached, refreshed on a 401 as `api.ts` does; NDJSON stream and PDF keep working | Tasks 1–3 (15 gated sites measured today, plus the health probe; the earlier analysis said "about seventeen"); Task 2 tests; Task 7 steps 3.1–3.3 |
| Step 3: `forward_auth` to a new `GET /api/auth/verify` that reuses `authenticate` | Tasks 4, 5 |
| Step 3: the same hop applies a per-user quota to the scraping paths, replacing the per-IP ceiling of the auth plan | Task 4 (per user, by route, plus a per-address cap for calls with no token) |
| Q7: `forward_auth` rather than the server proxying the calls | Task 5 |
| Fail-closed if the server does not answer | Task 6 check 7 |

## Not in this plan

- **The real client address** (spec step 5): checked at go-live, with the router; the Python side already reads it from the proxy (`TRUSTED_PROXIES=1`), and the server already has `trust proxy 1`.
- **The per-IP ceiling in the Python API** (Task 10 of the auth plan): superseded by the quota here; the Python limiter stays as a second layer.
- **Invites, password reset, the mailer, `tokenVersion`** and **the MERL-T visibility switch**: separate plans, written when their turn comes (`docs/superpowers/plans/2026-09-29-auth-self-service-v2.md` is the starting point of the first).
- **CSP enforcing, the host firewall rule (R1), the MERL-T admin routes (R2), DNS, certificates, the router, the phone backup.**
- **Tuning the quota.** The defaults (300 points a minute, an export 20) are generous on purpose, and a user over quota is logged (`[scrapeGate] user … is over the scraping quota`); tune them from real use.
