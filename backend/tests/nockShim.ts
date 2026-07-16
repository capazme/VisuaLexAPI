/**
 * nock-compatible mock over `global.fetch` (drop-in for the subset of the nock
 * API the MERL-T tests use).
 *
 * WHY: nock 14 intercepts HTTP through `@mswjs/interceptors`, which patches
 * `http.ClientRequest` globally. Once any nock file activates it, it randomly
 * corrupts the supertest→app passthrough requests (HTTP parse errors, crossed
 * responses, wrong status/body) — an intermittent, order-dependent flake that
 * hit even DB-only tests. The MERL-T clients all use native `fetch`; supertest
 * uses `http`. By mocking only `global.fetch`, we intercept exactly the
 * client→MERL-T calls and never touch supertest's sockets — killing the flake
 * at the root.
 *
 * This module is wired in via a vitest `resolve.alias` (`nock` → this file), so
 * every `import nock from 'nock'` in the test suite resolves here with no
 * per-file changes.
 *
 * Coverage: nock(base).{get,post,put,delete}(path, bodyMatcher?)
 *   .query(matcher) .times(n) .delay(ms) .delayConnection(ms)
 *   .reply(status, body) | .reply(fn) | .replyWithError(err)
 * plus statics: activate/restore/cleanAll/disableNetConnect/enableNetConnect/
 * isActive/isDone/abortPendingRequests/pendingMocks.
 */

type Json = unknown;
type BodyMatcher = boolean | Record<string, unknown> | ((body: any) => boolean);
type QueryMatcher =
  | boolean
  | Record<string, string>
  | ((q: Record<string, string>) => boolean);
type ReplyFn = (uri: string, body: any) => [number, Json] | Json;

interface Interceptor {
  method: string;
  origin: string;
  path: string;
  bodyMatcher?: BodyMatcher;
  queryMatcher?: QueryMatcher;
  status: number;
  body?: Json;
  replyFn?: ReplyFn;
  error?: unknown;
  delayMs?: number;
  remaining: number;
}

const interceptors: Interceptor[] = [];
let originalFetch: typeof globalThis.fetch | undefined;
let active = false;

function lowerHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => (out[k.toLowerCase()] = v));
  } else if (Array.isArray(h)) {
    for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
  } else {
    for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  }
  return out;
}

function parseJsonBody(init?: RequestInit): unknown {
  const b = init?.body;
  if (b == null) return undefined;
  if (typeof b === 'string') {
    try {
      return JSON.parse(b);
    } catch {
      return b;
    }
  }
  // FormData / streams (e.g. multipart uploads): not JSON — matchers for those
  // endpoints match on path only.
  return b;
}

function matchQuery(m: QueryMatcher | undefined, q: Record<string, string>): boolean {
  if (m === undefined) {
    // nock: an interceptor with no .query() only matches a URL with NO query.
    return Object.keys(q).length === 0;
  }
  if (m === true) return true;
  if (typeof m === 'function') return !!m(q);
  // object: exact match of provided keys
  return Object.entries(m).every(([k, v]) => q[k] === v);
}

function matchBody(m: BodyMatcher | undefined, body: unknown): boolean {
  if (m === undefined || m === true) return true;
  if (typeof m === 'function') return !!m(body);
  // object: shallow deep-equal on provided keys
  if (typeof body !== 'object' || body === null) return false;
  return Object.entries(m).every(
    ([k, v]) => JSON.stringify((body as Record<string, unknown>)[k]) === JSON.stringify(v)
  );
}

function makeError(err: unknown): Error {
  if (typeof err === 'string') return new Error(err);
  if (err && typeof err === 'object') {
    const e = new Error((err as { message?: string }).message ?? 'network error');
    Object.assign(e, err);
    return e;
  }
  return new Error('network error');
}

function delayRespectingSignal(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(abortError());
    };
    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    signal?.addEventListener('abort', onAbort);
  });
}

function abortError(): Error {
  const e = new Error('The operation was aborted');
  e.name = 'AbortError';
  return e;
}

function makeResponse(status: number, body: Json | undefined): Response {
  if (status === 204 || body === undefined) {
    return new Response(null, { status });
  }
  if (typeof body === 'string') {
    return new Response(body, { status, headers: { 'content-type': 'text/plain' } });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const mockFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const urlStr =
    typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  const url = new URL(urlStr);
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const query = Object.fromEntries(url.searchParams);
  const body = parseJsonBody(init);

  for (const ic of interceptors) {
    if (ic.remaining <= 0) continue;
    if (ic.method !== method) continue;
    if (ic.origin !== url.origin) continue;
    if (ic.path !== url.pathname) continue;
    if (!matchQuery(ic.queryMatcher, query)) continue;
    if (!matchBody(ic.bodyMatcher, body)) continue;

    ic.remaining -= 1;

    if (ic.delayMs) {
      await delayRespectingSignal(ic.delayMs, init?.signal ?? null);
    }
    if ('error' in ic && ic.error !== undefined) {
      throw makeError(ic.error);
    }

    let status = ic.status;
    let respBody = ic.body;
    if (ic.replyFn) {
      const ctx = { req: { headers: lowerHeaders(init) } };
      const ret = ic.replyFn.call(ctx, url.href, body);
      if (Array.isArray(ret)) {
        status = ret[0] as number;
        respBody = ret[1];
      } else {
        respBody = ret;
      }
    }
    return makeResponse(status, respBody);
  }

  throw new Error(`nockShim: no interceptor for ${method} ${url.href}`);
};

class Interceptable {
  constructor(
    private ic: Interceptor,
    private scope: Scope
  ) {}
  query(m: QueryMatcher): this {
    this.ic.queryMatcher = m;
    return this;
  }
  times(n: number): this {
    this.ic.remaining = n;
    return this;
  }
  delay(ms: number): this {
    this.ic.delayMs = ms;
    return this;
  }
  delayConnection(ms: number): this {
    this.ic.delayMs = ms;
    return this;
  }
  reply(statusOrFn: number | ReplyFn, body?: Json): Scope {
    if (typeof statusOrFn === 'function') {
      this.ic.replyFn = statusOrFn;
    } else {
      this.ic.status = statusOrFn;
      this.ic.body = body;
    }
    return this.scope.register(this.ic);
  }
  replyWithError(err: unknown): Scope {
    this.ic.error = err;
    return this.scope.register(this.ic);
  }
}

class Scope {
  private own: Interceptor[] = [];
  constructor(private origin: string) {}
  /** Push a fully-built interceptor to the global registry + this scope. */
  register(ic: Interceptor): Scope {
    interceptors.push(ic);
    this.own.push(ic);
    return this;
  }
  private make(method: string, path: string, bodyMatcher?: BodyMatcher): Interceptable {
    return new Interceptable(
      { method, origin: this.origin, path, bodyMatcher, status: 200, remaining: 1 },
      this
    );
  }
  get(path: string): Interceptable {
    return this.make('GET', path);
  }
  post(path: string, bodyMatcher?: BodyMatcher): Interceptable {
    return this.make('POST', path, bodyMatcher);
  }
  put(path: string, bodyMatcher?: BodyMatcher): Interceptable {
    return this.make('PUT', path, bodyMatcher);
  }
  delete(path: string, bodyMatcher?: BodyMatcher): Interceptable {
    return this.make('DELETE', path, bodyMatcher);
  }
  /** nock scope.isDone(): all interceptors registered on THIS scope consumed. */
  isDone(): boolean {
    return this.own.every((ic) => ic.remaining <= 0);
  }
}

function normalizeBase(base: string): string {
  return new URL(base).origin;
}

interface NockFn {
  (base: string): Scope;
  activate(): void;
  restore(): void;
  cleanAll(): void;
  disableNetConnect(): void;
  enableNetConnect(_matcher?: unknown): void;
  isActive(): boolean;
  isDone(): boolean;
  pendingMocks(): string[];
  abortPendingRequests(): void;
}

const nock = ((base: string): Scope => new Scope(normalizeBase(base))) as NockFn;

nock.activate = (): void => {
  if (active) return;
  originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch as typeof globalThis.fetch;
  active = true;
};
nock.restore = (): void => {
  if (originalFetch) globalThis.fetch = originalFetch;
  active = false;
  interceptors.length = 0;
};
nock.cleanAll = (): void => {
  interceptors.length = 0;
};
nock.disableNetConnect = (): void => {
  /* no-op: we only mock fetch; supertest uses http and is untouched */
};
nock.enableNetConnect = (): void => {
  /* no-op */
};
nock.isActive = (): boolean => active;
nock.isDone = (): boolean => interceptors.every((ic) => ic.remaining <= 0);
nock.pendingMocks = (): string[] =>
  interceptors.filter((ic) => ic.remaining > 0).map((ic) => `${ic.method} ${ic.origin}${ic.path}`);
nock.abortPendingRequests = (): void => {
  /* no-op: no leaked timers in this implementation */
};

export default nock;
