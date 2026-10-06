# The MCP Server in the Production Stack — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person with an account on the `./start.sh --prod` stack adds VisuaLex to Claude Code from a device of the overlay network (`https://<host>:8443/mcp`), signs in, and uses the dossier tools; and every client is counted at its own address, not at the Docker gateway's.

**Architecture:** Two pull requests. PR 1 makes Caddy trust `X-Forwarded-For` from the stack's two fixed subnets and the server walk the header past private hops. PR 2 packages `apps/mcp` as a hardened Compose module behind a profile, on a network shared with the server only, published on the loopback. It also routes the OAuth endpoints through the ingress, and teaches the deploy scripts the new secrets, the address checks and a port check.

**Tech Stack:** Node 24 / TypeScript (Express 5, `@modelcontextprotocol/sdk` 1.31.0, `express-rate-limit` 8, vitest), Caddy 2, Docker Compose ≥ 2.24, POSIX sh, Python 3 (compose invariants).

**Spec:** `docs/superpowers/specs/2026-10-05-mcp-production-design.md` (approved 5 October 2026).

**Execution:** native (owner, 6 October 2026: «a — li eseguo io»). The controller implements each task, a fresh code-reviewer checks each task, and a security review runs before PR 2 merges.

## Global Constraints

- **Branches:** off `develop`, in a worktree, never in the main checkout:
  - PR 1: `fix/real-client-address`;
  - PR 2: `feat/mcp-in-production`, branched after PR 1 merges.
- **Commits and merges:**
  - Conventional Commits, English;
  - each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - merge commit titled `merge: <branch> — <what changes>`, once CI is green.
- **Secrets:**
  - never read `.env` files; never print a secret in scripts, logs or tests' output;
  - nothing private in the repo: no host names, overlay names or addresses (use `<host>`, TEST-NET `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`, CGNAT `100.64.0.0/10` examples).
- **Shared resources:** ask the orchestrating session (visualexapi-98) before:
  - the server test DB (`npm --prefix apps/server test`);
  - any docker build or throwaway stack;
  - restarting anything.

  The shared dev stack is never restarted.
- **Defaults:**
  - `EDGE_SUBNET` default `172.29.241.0/24`; `APP_SUBNET` default stays `172.29.240.0/24`;
  - published MCP port: `${MCP_BIND:-127.0.0.1}:${MCP_PORT:-8091}:3002`;
  - per-address ceiling on the MCP endpoint: 300 requests a minute;
  - generated secrets: 48 characters; a secret is accepted only at 32 characters or more;
  - OAuth body cap at the ingress: 64 KB.
- **Trust settings:** only Express's named presets (`loopback`, `uniquelocal`) or plain IPv4 CIDRs, never IPv4-mapped IPv6 notation. `proxy-addr` must be 2.0.8 or newer in `apps/server` and `apps/mcp` (GHSA-jqcg-44mw-7w3h: a short IPv4-mapped trust subnet matches every address). PR 1 branches from `develop` after the audit fix (`chore/npm-audit-oct6`) merges; Task 1 checks `npm ls proxy-addr`.
- **Unchanged:**
  - `--dev` behaves exactly as before;
  - `apps/mcp` defaults keep the dev stack working with no new variable.
- **Approvals:** PR 1 touches `infra/` and authentication (rate limits). PR 2 touches `infra/`, authentication (OAuth settings) and the deploy scripts. Say so in each PR body; the owner approves these areas for now.

## Review Focus

1. **A deploy over the existing host's env files.** `infra/.env` and `apps/server/.env` already exist without the new keys. `init-env.sh` must add `MCP_CLIENT_SECRET` and `OAUTH_DELEGATION_SECRET` without touching anything else. Owned by Task 6.
2. **`PUBLIC_ORIGIN` written with a trailing slash or a comma list.** The issuer would not match what clients see, and every sign-in would fail obscurely. The preflight must refuse it by name. Owned by Task 6.
3. **`MCP_PUBLIC_URL` unset.** The stack must render, deploy and stop exactly as today, with no `mcp` container and no new refusal. A stop must still stop an `mcp` container that a previous deploy started. Owned by Tasks 4 and 6.
4. **A request whose `Host` is the overlay name with a port** (`<host>:8443`). It must pass the MCP's Host check, which compares hostnames only. Owned by Task 3.
5. **An `X-Forwarded-For` a client forged before the overlay proxy** (`203.0.113.9, 100.64.1.2, <gateway>`). The server must take `100.64.1.2`, never `203.0.113.9`. Owned by Task 1.

---

## PR 1 — `fix/real-client-address`

### Task 1: The server takes the client's address past private hops

**Files:**
- Create: `apps/server/src/lib/trustProxy.ts`
- Modify: `apps/server/src/app.ts:36-37`
- Test: `apps/server/tests/trustProxy.test.ts`

**Interfaces:**
- Produces: `export const TRUST_PROXY = 'loopback, uniquelocal'` (used by `app.ts`; `apps/mcp` uses the same literal in Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/server/tests/trustProxy.test.ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TRUST_PROXY } from '../src/lib/trustProxy';
import app from '../src/app';

// A bare app with the server's setting: what req.ip becomes for a given header.
// supertest connects from the loopback, which stands for the ingress here.
function probe() {
  const a = express();
  a.set('trust proxy', TRUST_PROXY);
  a.get('/ip', (req, res) => res.json({ ip: req.ip }));
  return a;
}
const ipFor = async (xff?: string) => {
  const r = request(probe()).get('/ip');
  if (xff) r.set('X-Forwarded-For', xff);
  return (await r).body.ip as string;
};

describe('trust proxy: the real client address', () => {
  it('is the server setting', () => {
    expect(app.get('trust proxy')).toBe(TRUST_PROXY);
  });

  it('takes an overlay address forwarded through the host gateway', async () => {
    expect(await ipFor('100.64.1.2, 172.29.241.1')).toBe('100.64.1.2');
  });

  it('never takes what the client wrote before the first untrusted hop', async () => {
    expect(await ipFor('203.0.113.9, 100.64.1.2, 172.29.241.1')).toBe('100.64.1.2');
  });

  it('takes a public address', async () => {
    expect(await ipFor('198.51.100.7')).toBe('198.51.100.7');
  });

  it('takes a home-network address written by the ingress', async () => {
    expect(await ipFor('192.168.1.20')).toBe('192.168.1.20');
  });

  it('falls back to the socket address with no header', async () => {
    expect(await ipFor()).toMatch(/^(::ffff:)?127\.0\.0\.1$|^::1$/);
  });
});
```

- [ ] **Step 2: Ask visualexapi-98 for a window on the server test DB** (the suite's setup file needs it even for this file). Then run:

Run: `npm --prefix apps/server test -- tests/trustProxy.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/trustProxy'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/server/src/lib/trustProxy.ts
/**
 * Which hops may tell the server the client's address (X-Forwarded-For).
 * Express walks the header from the right and stops at the first address
 * outside these ranges: loopback and the private ones, where the ingress, the
 * host's own gateway addresses and the stack's containers live. A client's
 * address (public, or an overlay one in 100.64.0.0/10) is outside them, so it
 * becomes req.ip, and per-address limits count each client apart.
 * Only containers reach the server in production; in development req.ip is the
 * loopback. Spec: docs/superpowers/specs/2026-10-05-mcp-production-design.md §5.
 */
export const TRUST_PROXY = 'loopback, uniquelocal';
```

In `apps/server/src/app.ts` replace

```ts
// Trust first proxy (load balancer) for accurate req.ip
app.set('trust proxy', 1);
```

with

```ts
// The client's address past the ingress and the host's own hops (lib/trustProxy.ts).
app.set('trust proxy', TRUST_PROXY);
```

and add `import { TRUST_PROXY } from './lib/trustProxy';` with the other imports.

- [ ] **Step 4: Run the test, then the whole server suite and the build**

Run: `npm --prefix apps/server test -- tests/trustProxy.test.ts` → PASS (6 tests).
Run: `npm --prefix apps/server test` → all green (still inside the agreed window; tell visualexapi-98 when done).
Run: `npm --prefix apps/server run build` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/lib/trustProxy.ts apps/server/src/app.ts apps/server/tests/trustProxy.test.ts
git commit -m "fix(server): count each client at its own address behind the ingress and the overlay proxy"
```

### Task 2: Caddy keeps the forwarded address from the stack's own subnets

**Files:**
- Modify: `infra/ingress/Caddyfile` (global block, header comment)
- Modify: `infra/compose.app.yml` (ingress `environment`)
- Modify: `infra/compose.prod.yml` (`networks.edge`, header comment)
- Modify: `infra/.env.example` (production section)
- Modify: `infra/ingress/checks/stub_upstream.py` (record `X-Forwarded-For`)
- Modify: `infra/ingress/checks/gate.sh` (two new sections, a second ingress)
- Modify: `scripts/prod/tests/compose_invariants.py` (`prod`), `scripts/prod/tests/test_compose.sh` (hermetic unset list)

**Interfaces:**
- Consumes: nothing from Task 1 (independent).
- Produces: the ingress container reads `APP_SUBNET` and `EDGE_SUBNET`. The `edge` network has a fixed subnet.

- [ ] **Step 1: Write the failing checks**

`stub_upstream.py`, in the `server` branch of `handle_any`, add the header to what is remembered:

```python
            seen["last"] = {
                "uri": self.headers.get("X-Forwarded-Uri"),
                "method": self.headers.get("X-Forwarded-Method"),
                "path": self.path,
                "xff": self.headers.get("X-Forwarded-For"),
            }
```

and in the scrapers branch keep it as it is. In the `server` role, answer `/api/*` and `/oauth/*` and `/.well-known/*` the same way as now (401 without the good token): no change needed.

`gate.sh`:
- **The main container:** start it trusting every address and pass the subnets: in the `docker run` line add `-e APP_SUBNET=0.0.0.0/0 -e EDGE_SUBNET=0.0.0.0/0`.
- **A second ingress:** after the main container, start a second one that trusts nothing reachable:

```sh
name2="$name-untrusted"
docker run -d --name "$name2" -p 127.0.0.1:18082:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e SERVER_UPSTREAM=host.docker.internal:13001 -e SCRAPERS_UPSTREAM=host.docker.internal:15000 \
  -e APP_SUBNET=192.0.2.0/24 -e EDGE_SUBNET=198.51.100.0/24 \
  -v "$root/infra/ingress/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null || { echo "cannot start the second caddy"; exit 1; }
B2=http://127.0.0.1:18082
```

- **Cleanup and wait:** extend `cleanup()` with `docker rm -f "$name2" >/dev/null 2>&1`, and wait for `$B2/version` like `$B`.
- **The new section,** before section 8 (which kills the server stand-in):

```sh
# 7b. the client's address: kept from a trusted hop, overwritten from anyone else
curl -s -o /dev/null -m 10 -H 'X-Forwarded-For: 100.64.1.2' "$B/api/probe"
xff="$(seen 13001 'd["last"]["xff"]')"
case "$xff" in "100.64.1.2, "*) ok "from a trusted hop the forwarded address is kept, and the hop appended ($xff)" ;;
  *) bad "from a trusted hop the forwarded address is kept (got '$xff')" ;; esac
curl -s -o /dev/null -m 10 -H 'X-Forwarded-For: 100.64.1.2' "$B2/api/probe"
xff="$(seen 13001 'd["last"]["xff"]')"
case "$xff" in *100.64.1.2*) bad "from an untrusted peer the forwarded address is overwritten (got '$xff')" ;;
  "") bad "from an untrusted peer the ingress still sends an address (got none)" ;;
  *) ok "from an untrusted peer the forwarded address is overwritten ($xff)" ;; esac
```

`compose_invariants.py`, in `prod(cfg, lan_bind)` after the `app` subnet check:

```python
    edge = ((cfg["networks"]["edge"].get("ipam") or {}).get("config") or [{}])[0].get("subnet")
    check(edge == "172.29.241.0/24", "the edge network has a fixed subnet: the ingress trusts it")
    ingress_env = environment(services, "ingress")
    check(
        ingress_env.get("EDGE_SUBNET") == edge and ingress_env.get("APP_SUBNET") == subnet,
        "and the ingress is told the same two subnets it trusts forwarded addresses from",
    )
```

`test_compose.sh`: add `EDGE_SUBNET` to the hermetic `unset` list.

- [ ] **Step 2: Run them to see them fail**

Ask visualexapi-98 before (it starts two small containers).

Run: `sh infra/ingress/checks/gate.sh` → FAIL on "from a trusted hop the forwarded address is kept".
Run: `sh scripts/prod/tests/test_compose.sh` → FAIL on "the edge network has a fixed subnet".

- [ ] **Step 3: Implement**

`Caddyfile` global block:

```
{
	admin off
	auto_https off
	servers {
		# The client's address (X-Forwarded-For) is kept only when the connection comes from
		# the stack's own subnets: the host's gateway addresses, where a proxy on the host
		# (the overlay's) arrives through the loopback, and the stack's containers. From
		# anyone else Caddy writes the address it sees. Docker may route a published port
		# through either network of the ingress, so both are listed. Spec 2026-10-05 §5.
		trusted_proxies static {$APP_SUBNET:172.29.240.0/24} {$EDGE_SUBNET:172.29.241.0/24}
	}
}
```

`compose.app.yml`, ingress `environment`:

```yaml
      # The subnets Caddy keeps a forwarded client address from: the same values that
      # compose.prod.yml gives the two networks.
      APP_SUBNET: "${APP_SUBNET:-172.29.240.0/24}"
      EDGE_SUBNET: "${EDGE_SUBNET:-172.29.241.0/24}"
```

`compose.prod.yml` `networks`:

```yaml
networks:
  edge:
    ipam:
      config:
        # Fixed, because the ingress trusts a forwarded client address from it (and from app).
        - subnet: "${EDGE_SUBNET:-172.29.241.0/24}"
  app:
```

and one line in its header comment: `edge` and `app` have fixed subnets, because the host firewall and the ingress key on them.

`infra/.env.example`, after `APP_SUBNET`:

```
# The ingress's own network. Fixed, because the ingress keeps a forwarded client address
# only from this subnet and APP_SUBNET. Change it if it collides with yours.
EDGE_SUBNET=172.29.241.0/24
```

- [ ] **Step 4: Run everything that reads these files**

Run: `sh infra/ingress/checks/gate.sh` → every line `ok`, exit 0.
Run: `sh scripts/prod/tests/test_compose.sh` → exit 0.
Run: `node --test infra/ingress/paths.test.mjs` → pass.
Run: `docker run --rm -v "$PWD/infra/ingress/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` → `Valid configuration`.

- [ ] **Step 5: Commit**

```bash
git add infra/ scripts/prod/tests/
git commit -m "fix(infra): the ingress keeps the client's forwarded address from the stack's own subnets"
```

### PR 1 close

- [ ] Review the branch (code-reviewer agent against spec §5); fix every finding.
- [ ] Push, open the PR into `develop`. Body: what changes for whom (login limits per person). It touches `infra/` and authentication's rate limits. The server test DB was used in a window agreed with visualexapi-98.
- [ ] CI green → merge commit `merge: fix/real-client-address — each client is counted at its own address behind the ingress`.

---

## PR 2 — `feat/mcp-in-production` (branched from `develop` after PR 1 merges)

### Task 3: `apps/mcp` calls the server at its network address, checks Host always, counts per address

**Files:**
- Modify: `apps/mcp/src/config.ts` (new `authUrl`)
- Modify: `apps/mcp/src/auth.ts:34` and `apps/mcp/src/exchange.ts:26` (use `authUrl`)
- Modify: `apps/mcp/src/server.ts` (Host allow-list always on, `trust proxy`, limiter; `createApp` options)
- Modify: `apps/mcp/package.json`, `apps/mcp/package-lock.json` (`express-rate-limit`)
- Modify: `apps/mcp/tests/stubs.ts` (issuer ≠ authUrl)
- Modify: `apps/mcp/.env.example` (document `MCP_AUTH_URL`)
- Test: `apps/mcp/tests/server.test.ts` (new `describe('exposure')`)

**Interfaces:**
- Produces:
  - `McpConfig.authUrl: string`: where introspection and the token exchange go.
  - `createApp(config, options?: { store?: SessionStore; requestsPerMinute?: number })`.
  - `export const REQUESTS_PER_MINUTE = 300` in `server.ts`.
  - Environment variable `MCP_AUTH_URL` (Task 4 sets it to `http://server:3001`).

- [ ] **Step 1: Write the failing tests**

In `tests/stubs.ts`, build the config so that the issuer is unreachable and only `authUrl` reaches the stub:

```ts
  const config: McpConfig = {
    host: '127.0.0.1',
    port: 0,
    resource: RESOURCE,
    // The public identity, never called: introspection and the exchange go to authUrl.
    issuer: 'https://visualex.example',
    authUrl: `http://127.0.0.1:${asPort}`,
    apiBase: `http://127.0.0.1:${asPort}/api`,
    apiAudience: `http://127.0.0.1:${asPort}/api`,
    clientId: 'mcp-omnilex',
    clientSecret: SECRET,
    allowedOrigins: ['http://localhost:5173'],
    confirmationTimeoutMs: 1500,
  };
```

In `tests/server.test.ts`, add:

```ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.js';
import { readConfig } from '../src/config.js';

/** A raw request with a chosen Host header (fetch does not let a caller set it). */
function rawPost(url: string, host: string, headers: Record<string, string> = {}): Promise<number> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST',
        headers: { host, 'content-type': 'application/json', ...headers } },
      (res) => { res.resume(); resolve(res.statusCode ?? 0); },
    );
    req.on('error', reject);
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  });
}

describe('exposure', () => {
  it('calls the server at MCP_AUTH_URL, not at the issuer', async () => {
    // stubs.ts sets an unreachable issuer: a good token only works through authUrl.
    const client = await connect('good');
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    await client.close();
  });

  it('defaults MCP_AUTH_URL to the issuer, so development needs nothing new', () => {
    const config = readConfig({ MCP_CLIENT_SECRET: 's', MCP_AUTH_ISSUER: 'http://localhost:3001/' });
    expect(config.authUrl).toBe('http://localhost:3001');
    expect(readConfig({ MCP_CLIENT_SECRET: 's', MCP_AUTH_URL: 'http://server:3001/' }).authUrl).toBe('http://server:3001');
  });

  it("refuses a Host that is not the endpoint's", async () => {
    expect(await rawPost(env.mcpUrl, 'evil.example')).toBe(403);
  });

  it("accepts the endpoint's own hostname, with any port", async () => {
    // RESOURCE is http://localhost:3002/mcp: the hostname is what counts, as behind the overlay proxy (<host>:8443).
    expect(await rawPost(env.mcpUrl, 'localhost:8443')).toBe(401);
  });

  it('accepts the loopback names (the health check)', async () => {
    expect(await rawPost(env.mcpUrl, '127.0.0.1:3002')).toBe(401);
  });

  it('checks Host even when listening on every interface', async () => {
    const app = createApp({ ...env.config, host: '0.0.0.0', resource: 'https://mcp.example:8443/mcp' });
    const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    try {
      expect(await rawPost(url, 'evil.example')).toBe(403);
      expect(await rawPost(url, 'mcp.example:8443')).toBe(401);
    } finally {
      server.close();
    }
  });

  it('counts requests per forwarded address and refuses past the ceiling', async () => {
    const app = createApp(env.config, { requestsPerMinute: 3 });
    const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    try {
      const from = (ip: string) => rawPost(url, 'localhost', { 'x-forwarded-for': ip });
      for (let i = 0; i < 3; i += 1) expect(await from('100.64.1.2')).toBe(401);
      expect(await from('100.64.1.2')).toBe(429);
      // another person behind the same proxy is not affected
      expect(await from('100.64.1.3')).toBe(401);
    } finally {
      server.close();
    }
  });
});
```

Also in `stubs.ts`, the shared app must not hit the new ceiling, since the suites send hundreds of requests from one address: `createApp(config, { store, requestsPerMinute: 100_000 })`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix apps/mcp test`
Expected: FAIL. TypeScript reports `authUrl` not in `McpConfig`; once that compiles, the existing suites fail with 503 (introspection sent to `https://visualex.example`).

- [ ] **Step 3: Implement**

Install the limiter as a direct dependency (it is already in the lockfile through the SDK):

Run: `npm --prefix apps/mcp install express-rate-limit@^8.7.0`

`config.ts`: in `McpConfig`, after `issuer`:

```ts
  /**
   * Where introspection and the token exchange are sent: the authorization
   * server's address on the network. Defaults to the issuer; in a container it
   * is the server's container address, since the public origin is not reachable
   * from inside.
   */
  authUrl: string;
```

and in `readConfig`, after `issuer`:

```ts
  const authUrl = (env.MCP_AUTH_URL || issuer).replace(/\/+$/, '');
```

and `authUrl,` in the returned object after `issuer,`.

`auth.ts:34`: `fetch(`${config.authUrl}/oauth/introspect`, {`
`exchange.ts:26`: `fetch(`${config.authUrl}/oauth/token`, {`

`server.ts`:
- Remove the `LOOPBACK` set and its `if`.
- Add `import { rateLimit } from 'express-rate-limit';`.
- Add, at module level:

```ts
/** Hostnames always accepted besides the endpoint's: the health check calls the loopback. */
const LOOPBACK_NAMES = ['localhost', '127.0.0.1', '[::1]'];

/**
 * Requests per address per minute on the endpoint: a backstop, so one caller
 * sending invalid tokens cannot spend the introspection ceiling every user
 * shares (spec 2026-10-05 §5).
 */
export const REQUESTS_PER_MINUTE = 300;
```

change the signature to `export function createApp(config: McpConfig, options: { store?: SessionStore; requestsPerMinute?: number } = {})`, and replace the DNS-rebinding block with:

```ts
  // Behind the overlay proxy and Docker's gateway: the client's address is the
  // first one, from the right, outside the loopback and the private ranges.
  app.set('trust proxy', 'loopback, uniquelocal');

  // DNS rebinding: only the endpoint's own hostname, and the loopback names
  // (a rebinding page sends its own hostname, never these). On every bind.
  app.use(hostHeaderValidation([...new Set([new URL(config.resource).hostname, ...LOOPBACK_NAMES])]));
```

and, right after `const endpoint = new URL(config.resource).pathname;`:

```ts
  app.use(
    endpoint,
    rateLimit({
      windowMs: 60_000,
      limit: options.requestsPerMinute ?? REQUESTS_PER_MINUTE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests: retry in a minute' }, id: null },
    }),
  );
```

`.env.example`, after `MCP_API_BASE`:

```
# Where it calls the authorization server (introspection, token exchange). Defaults to
# MCP_AUTH_ISSUER; in the production stack it is the server's container address, because
# the issuer is the public origin, which a container cannot reach.
# MCP_AUTH_URL=http://localhost:3001
```

and replace the first comment block's "Keep 127.0.0.1 in development: the server also refuses Host headers that are not loopback (DNS rebinding)." with "Keep 127.0.0.1 in development. On any bind it refuses a Host other than MCP_RESOURCE's hostname or the loopback (DNS rebinding)."

- [ ] **Step 4: Run the suite and the build**

Run: `npm --prefix apps/mcp test` → all green, including the 7 new tests.
Run: `npm --prefix apps/mcp run build` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/
git commit -m "feat(mcp): call the server at its network address, check Host on every bind, count requests per address"
```

### Task 4: The `mcp` image and Compose module

**Files:**
- Create: `apps/mcp/Dockerfile`, `apps/mcp/.dockerignore`
- Modify: `infra/compose.app.yml` (service `mcp`, server OAuth environment, header)
- Modify: `infra/compose.prod.yml` (network `mcp`, `mcp` service wiring, server networks, header)
- Modify: `infra/.env.example` (the MCP block)
- Modify: `scripts/prod/tests/test_compose.sh` (profiles in `render`, two scenarios, unset list)
- Modify: `scripts/prod/tests/compose_invariants.py` (`prod` server networks and OAuth environment, new `prod_mcp`)

**Interfaces:**
- Consumes: `MCP_AUTH_URL` (Task 3).
- Produces:
  - Compose profile `mcp` and service `mcp`, container `${VISUALEX_STACK}-mcp`, on network `mcp`.
  - `infra/.env` keys: `MCP_PUBLIC_URL`, `MCP_CLIENT_SECRET`, `MCP_BIND`, `MCP_PORT`.
  - The server environment: `OAUTH_ISSUER`, `OAUTH_CONSENT_URL`, `OAUTH_MCP_RESOURCE`, `OAUTH_MCP_CLIENT_SECRET`.

- [ ] **Step 1: Write the failing invariants**

`test_compose.sh`:
- Add `EDGE_SUBNET MCP_PUBLIC_URL MCP_CLIENT_SECRET MCP_BIND MCP_PORT` to the unset list.
- Change `render` so its second argument is a list of profiles:

```sh
# render <out.json> <profiles: "" | "merlt" | "merlt mcp"> <compose file>...
render() {
  out="$1"; profiles="$2"; shift 2
  files=""
  for f in "$@"; do files="$files -f $infra/$f"; done
  flag=""
  for p in $profiles; do flag="$flag --profile $p"; done
  # shellcheck disable=SC2086
  docker compose --env-file "${ENV_FILE:-$infra/.env.example}" $files $flag config --format json >"$out" 2>"$tmp/stderr"
}
```

- Replace every `0`/`1` profile argument: `0` → `""`, `1` → `merlt`. This covers the scenario calls and the two fail-closed `render` calls.
- Add:

```sh
(MCP_PUBLIC_URL=https://vlx.example:8443/mcp PUBLIC_ORIGIN=https://vlx.example MCP_CLIENT_SECRET=test-mcp-secret-0123456789abcdef;
 export MCP_PUBLIC_URL PUBLIC_ORIGIN MCP_CLIENT_SECRET; scenario prod-mcp "merlt mcp" $all) || fail=1
```

`compose_invariants.py`:
- Add `MCP = {"mcp"}`.
- In `prod`:
  - change the server network check to `{"app", "data", "mcp"}` ("server: app, data, and the MCP's network");
  - add `check("mcp" not in services, "without the mcp profile there is no MCP container")`;
  - after the server environment checks add:

```python
    check(server["OAUTH_ISSUER"] == "http://localhost:8080", "the OAuth issuer is the public origin")
    check(server["OAUTH_CONSENT_URL"] == "http://localhost:8080/connect", "and the consent page is on it")
```

- New scenario:

```python
def prod_mcp(cfg):
    services = cfg["services"]
    check("mcp" in services, "with the mcp profile the MCP module runs")
    check(networks(services, "mcp") == {"mcp"}, "mcp: its own network, shared with the server only")
    members = {name for name in services if "mcp" in networks(services, name)}
    check(members == {"mcp", "server"}, "and nothing else is on it: no scraper, no MERL-T, no store")
    ports = services["mcp"].get("ports") or []
    check(
        [(p.get("host_ip"), p.get("published"), p.get("target")) for p in ports] == [(LOOPBACK, "8091", 3002)],
        "it is published on the loopback, port 8091, and nowhere else",
    )
    m = services["mcp"]
    check(m.get("cap_drop") == ["ALL"] and "no-new-privileges:true" in (m.get("security_opt") or []), "it drops every capability and cannot gain privileges")
    check(m.get("read_only") is True and "/tmp" in (m.get("tmpfs") or []), "its root filesystem is read-only, with a tmpfs")
    check(m.get("restart") == "unless-stopped" and m.get("init") is True, "it restarts unless stopped, with an init")
    check((m.get("logging") or {}).get("options", {}).get("max-size"), "its log is rotated")
    env = environment(services, "mcp")
    server = environment(services, "server")
    check(env["MCP_RESOURCE"] == "https://vlx.example:8443/mcp" == server["OAUTH_MCP_RESOURCE"], "the MCP and the server agree on the resource, from MCP_PUBLIC_URL")
    check(env["MCP_AUTH_ISSUER"] == "https://vlx.example" == server["OAUTH_ISSUER"], "and on the issuer, from PUBLIC_ORIGIN")
    check(env["MCP_AUTH_URL"] == "http://server:3001" and env["MCP_API_BASE"] == "http://server:3001/api", "it calls the server by container name")
    check(env["MCP_API_AUDIENCE"] == "https://vlx.example/api", "and asks for the API audience the server issues")
    check(env["MCP_CLIENT_SECRET"] == server["OAUTH_MCP_CLIENT_SECRET"] != "", "the credential is the same on both sides, from one place")
    check(env["MCP_HOST"] == "0.0.0.0" and env.get("MCP_ALLOWED_ORIGINS", "") == "", "it listens in its container and admits no browser origin")
    check(
        (m.get("depends_on") or {}).get("server", {}).get("condition") == "service_healthy",
        "it starts once the server is healthy",
    )
```

and `"prod-mcp": prod_mcp,` in `SCENARIOS`.

- [ ] **Step 2: Run them to see them fail**

Run: `sh scripts/prod/tests/test_compose.sh`
Expected: FAIL. "server: app, data, and the MCP's network", the OAuth issuer checks, and `prod-mcp` (no `mcp` service).

- [ ] **Step 3: Implement**

`apps/mcp/Dockerfile`:

```dockerfile
# The MCP module: VisuaLex's dossier tools for Claude Code and LibreLex (Streamable HTTP).
#
# Build with this folder as the context:
#   docker build -t visualex-mcp apps/mcp
#
# No database and no secret in the image: everything comes from the environment
# (infra/compose.app.yml). Spec: docs/superpowers/specs/2026-10-05-mcp-production-design.md

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3002

# The protected resource metadata needs no token: a 200 means the process serves.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.MCP_PORT||3002)+'/.well-known/oauth-protected-resource').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so SIGTERM reaches the shutdown that closes the sessions first.
CMD ["node", "dist/index.js"]
```

`apps/mcp/.dockerignore`:

```
node_modules
dist
tests
scripts
.env
.env.*
!.env.example
*.log
```

`compose.app.yml`:
- Server `environment`, after `ALLOWED_ORIGINS`:

```yaml
      # The OAuth authorization server for MCP clients. Its identity is the public origin,
      # exactly as clients see it; the resource is the MCP endpoint as people type it. The
      # MCP's credential lives in infra/.env, shared with the mcp module (below). Without
      # the mcp profile none of this is used.
      OAUTH_ISSUER: "${PUBLIC_ORIGIN:-http://localhost:8080}"
      OAUTH_CONSENT_URL: "${PUBLIC_ORIGIN:-http://localhost:8080}/connect"
      OAUTH_MCP_RESOURCE: "${MCP_PUBLIC_URL:-http://localhost:8091/mcp}"
      OAUTH_MCP_CLIENT_SECRET: "${MCP_CLIENT_SECRET:-}"
```

- The service, after `ingress`:

```yaml
  # The MCP server (profile "mcp": started only when MCP_PUBLIC_URL is set in infra/.env).
  # A door of its own, on the loopback: the overlay proxy publishes it. It reaches the
  # server and nothing else. Spec: docs/superpowers/specs/2026-10-05-mcp-production-design.md
  mcp:
    <<: *hardening
    profiles: [mcp]
    build:
      context: ../apps/mcp
    container_name: ${VISUALEX_STACK:-visualex}-mcp
    environment:
      NODE_ENV: production
      MCP_HOST: "0.0.0.0"
      MCP_PORT: "3002"
      MCP_RESOURCE: "${MCP_PUBLIC_URL:-http://localhost:8091/mcp}"
      MCP_AUTH_ISSUER: "${PUBLIC_ORIGIN:-http://localhost:8080}"
      MCP_AUTH_URL: "http://server:3001"
      MCP_API_BASE: "http://server:3001/api"
      MCP_API_AUDIENCE: "${PUBLIC_ORIGIN:-http://localhost:8080}/api"
      MCP_CLIENT_SECRET: "${MCP_CLIENT_SECRET:-}"
      MCP_ALLOWED_ORIGINS: ""
    # Loopback by default, like the ingress. MCP_PORT here is the port on the host.
    ports:
      - "${MCP_BIND:-127.0.0.1}:${MCP_PORT:-8091}:3002"
    depends_on:
      server: {condition: service_healthy}
    read_only: true
    tmpfs:
      - /tmp
```

- In the header, add one line: `mcp` (profile `mcp`) is the MCP server, a second door, on the loopback.

`compose.prod.yml`:
- Networks: add `mcp: {}` (comment: the MCP and the server, nothing else; not internal, because Docker does not publish a port of a container on internal networks only).
- Services:
  - `server` → `networks: [app, data, mcp]`;
  - add

```yaml
  mcp:
    restart: unless-stopped
    networks: [mcp]
    logging: *logging
```

- Header: add `mcp` to the network list (`mcp  the MCP server and the server, nothing else`).

`infra/.env.example`, after `EDGE_SUBNET`:

```
# The MCP server (apps/mcp), for Claude Code. Off unless MCP_PUBLIC_URL is set: then
# ./start.sh --prod starts it, published on MCP_BIND:MCP_PORT (the loopback by default).
# MCP_PUBLIC_URL is the endpoint exactly as people type it in their client, https, on the
# same host as PUBLIC_ORIGIN, ending in /mcp; PUBLIC_ORIGIN must then be ONE origin (it is
# the OAuth issuer). MCP_CLIENT_SECRET is generated by ./start.sh --prod.
# MCP_PUBLIC_URL=https://<host>:8443/mcp
# MCP_BIND=127.0.0.1
# MCP_PORT=8091
# MCP_CLIENT_SECRET=
```

- [ ] **Step 4: Run the compose checks, then build the image once**

Run: `sh scripts/prod/tests/test_compose.sh` → exit 0, every scenario `ok`.
Ask visualexapi-98, then run: `docker build -t vlx-mcp-check apps/mcp && docker run --rm -e MCP_CLIENT_SECRET=x -e MCP_HOST=0.0.0.0 -d --name vlx-mcp-check -p 127.0.0.1:18091:3002 vlx-mcp-check && sleep 3 && curl -s http://127.0.0.1:18091/.well-known/oauth-protected-resource && docker rm -f vlx-mcp-check && docker rmi vlx-mcp-check`
Expected: the metadata JSON (`"resource":"http://localhost:3002/mcp"`), then the container and image removed.

- [ ] **Step 5: Commit**

```bash
git add apps/mcp/Dockerfile apps/mcp/.dockerignore infra/ scripts/prod/tests/
git commit -m "feat(infra): the MCP server as a module of the production stack, behind its own profile and network"
```

### Task 5: The ingress routes the authorization server and answers 404 for other well-known names

**Files:**
- Modify: `infra/ingress/Caddyfile` (three `handle` blocks, before the scrapers' blocks)
- Modify: `infra/ingress/paths.test.mjs`
- Modify: `infra/ingress/checks/gate.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: `/oauth/*` and `/.well-known/oauth-authorization-server` reach `SERVER_UPSTREAM`; every other `/.well-known/*` answers 404.

- [ ] **Step 1: Write the failing tests**

`paths.test.mjs`, append:

```js
// The body of the first `handle <path> {` block, braces matched.
function handleBlock(path) {
  const start = caddyfile.indexOf(`handle ${path} {`);
  assert.ok(start >= 0, `the Caddyfile has no "handle ${path} { … }" block`);
  let depth = 0;
  for (let i = caddyfile.indexOf('{', start); i < caddyfile.length; i += 1) {
    if (caddyfile[i] === '{') depth += 1;
    if (caddyfile[i] === '}') depth -= 1;
    if (depth === 0) return caddyfile.slice(start, i + 1);
  }
  assert.fail(`the "handle ${path}" block is not closed`);
}

test('the authorization server is routed to the server, outside the scraping gate', () => {
  for (const path of ['/oauth/*', '/.well-known/oauth-authorization-server']) {
    const block = handleBlock(path);
    assert.match(block, /reverse_proxy \{\$SERVER_UPSTREAM:server:3001\}/, `${path} goes to the server`);
    assert.doesNotMatch(block, /forward_auth/, `${path} is not behind the login check: a client has no login yet`);
    assert.match(block, /max_size 64KB/, `${path} takes a small body only`);
  }
});

test('any other well-known name is a 404, not the app', () => {
  assert.match(handleBlock('/.well-known/*'), /respond 404/);
});
```

`gate.sh`, a new section before 7b:

```sh
# 7a. the authorization server: reached without a login, outside the gate; other well-known names are 404
before="$(scraper_calls)"
expect "/oauth/authorize reaches the server without a login" "401" "$(code "$B/oauth/authorize?client_id=x")"
expect "and the server saw that path" "/oauth/authorize?client_id=x" "$(seen 13001 'd["last"]["path"]')"
expect "the authorization server metadata reaches the server" "/.well-known/oauth-authorization-server" \
  "$(curl -s -o /dev/null -m 10 "$B/.well-known/oauth-authorization-server"; seen 13001 'd["last"]["path"]')"
expect "another well-known name is a 404" 404 "$(code "$B/.well-known/openid-configuration")"
expect "not the app's page with a 200" 404 "$(code "$B/.well-known/anything")"
expect "and the scrapers never heard of any of it" "$before" "$(scraper_calls)"
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test infra/ingress/paths.test.mjs` → FAIL: no `handle /oauth/*` block.
Ask visualexapi-98, then run `sh infra/ingress/checks/gate.sh` → FAIL on 7a. The stub `server` answers the `forward_auth` question only for scraping paths; `/oauth/authorize` today falls to the app (`200`).

- [ ] **Step 3: Implement**

In the Caddyfile, after the `handle /api/*` block:

```
	# The OAuth authorization server for MCP clients (apps/server): its metadata, and the
	# endpoints where a client registers, asks for consent and gets its tokens. Not behind
	# the login check: a client starts here before anyone has signed in. The consent page
	# itself (/connect) is the app's, and frame-ancestors 'none' keeps it out of frames.
	handle /oauth/* {
		request_body {
			max_size 64KB
		}
		reverse_proxy {$SERVER_UPSTREAM:server:3001}
	}
	handle /.well-known/oauth-authorization-server {
		request_body {
			max_size 64KB
		}
		reverse_proxy {$SERVER_UPSTREAM:server:3001}
	}
	# Any other well-known name is not ours: a 404, never the app's page (a client probing
	# /.well-known/openid-configuration would read HTML where it expects JSON).
	handle /.well-known/* {
		respond 404
	}
```

- [ ] **Step 4: Run them**

Run: `node --test infra/ingress/paths.test.mjs` → pass.
Run: `sh infra/ingress/checks/gate.sh` → all `ok`.

- [ ] **Step 5: Commit**

```bash
git add infra/ingress/
git commit -m "feat(infra): the ingress routes the OAuth authorization server, and other well-known names are a 404"
```

### Task 6: The deploy scripts: the MCP's secrets, addresses and port, and the first deploy's lessons

**Files:**
- Modify: `scripts/prod/init-env.sh` (add missing keys to existing files)
- Modify: `scripts/prod/preflight.sh` (MCP checks in `check_env`, OpenRouter warning, new `ports` command)
- Modify: `scripts/prod/deploy.sh` (profile `mcp`, stop with every profile, port check, report)
- Modify: `scripts/prod/tests/test_deploy.sh`

**Interfaces:**
- Consumes: the `infra/.env` keys of Task 4, `OAUTH_DELEGATION_SECRET` in `apps/server/.env`.
- Produces: `preflight.sh ports`; `deploy.sh` adds `--profile mcp` when `MCP_PUBLIC_URL` is set.

- [ ] **Step 1: Write the failing tests**

In `test_deploy.sh`:

`mkrepo`: keep the throwaway repositories off real ports. After `cp "$root/infra/.env.example" "$d/infra/.env.example"`, add:

```sh
  # a port nothing listens on, so the port check passes wherever the tests run
  sed -i.bak "s/^INGRESS_PORT=.*/INGRESS_PORT=$FREE_PORT/" "$d/infra/.env.example" && rm -f "$d/infra/.env.example.bak"
```

and move the one-line `value_of` helper (today defined at the start.sh section, near line 564) up to the helpers after `mode_of`, since the new scenarios use it earlier. At the top, after `fail=0`:

```sh
FREE_PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
```

Extend the leak loop's list with `"infra/.env MCP_CLIENT_SECRET" "apps/server/.env OAUTH_DELEGATION_SECRET"`.

New scenarios, after the `--- the env files ---` block:

```sh
# An existing host: env files from before the MCP get the two new secrets, and nothing else changes.
d="$(mkrepo oldhost)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
grep -v -E '^(MCP_CLIENT_SECRET|OAUTH_DELEGATION_SECRET)=' "$d/infra/.env" >"$d/i" && cat "$d/i" >"$d/infra/.env"
grep -v -E '^(MCP_CLIENT_SECRET|OAUTH_DELEGATION_SECRET)=' "$d/apps/server/.env" >"$d/s" && cat "$d/s" >"$d/apps/server/.env"
rm -f "$d/i" "$d/s"
before_jwt="$(value_of "$d/apps/server/.env" JWT_SECRET)"; before_pg="$(value_of "$d/infra/.env" POSTGRES_PASSWORD)"
outcome "$d" scripts/prod/init-env.sh
expect_status 0 "an existing host's env files are completed"
m="$(value_of "$d/infra/.env" MCP_CLIENT_SECRET)"
[ "${#m}" -ge 32 ] && ok "MCP_CLIENT_SECRET is added to infra/.env" || bad "MCP_CLIENT_SECRET is added to infra/.env (${#m} characters)"
o="$(value_of "$d/apps/server/.env" OAUTH_DELEGATION_SECRET)"
[ "${#o}" -ge 32 ] && ok "OAUTH_DELEGATION_SECRET is added to apps/server/.env" || bad "OAUTH_DELEGATION_SECRET is added (${#o} characters)"
[ "$(value_of "$d/apps/server/.env" JWT_SECRET)" = "$before_jwt" ] && [ "$(value_of "$d/infra/.env" POSTGRES_PASSWORD)" = "$before_pg" ] \
  && ok "and what was there is untouched" || bad "and what was there is untouched"
expect_out "MCP_CLIENT_SECRET" "it says which key it added"
if grep -qF -- "$m" "$work/out" || grep -qF -- "$o" "$work/out"; then bad "and never prints the value"; else ok "and never prints the value"; fi
[ "$(mode_of "$d/infra/.env")" = "-rw-------" ] && ok "the files keep their owner-only mode" || bad "the files keep their owner-only mode ($(mode_of "$d/infra/.env"))"

# The MCP's addresses and secrets: checked only when MCP_PUBLIC_URL is set.
d="$(mkrepo mcpenv)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
mcp_case() { # mcp_case <PUBLIC_ORIGIN> <MCP_PUBLIC_URL> <0|nonzero> <description> [text expected]
  env_line() { sed -i.bak "/^$1=/d" "$d/infra/.env" && rm -f "$d/infra/.env.bak"; [ -n "$2" ] && echo "$1=$2" >>"$d/infra/.env"; }
  env_line PUBLIC_ORIGIN "$1"; env_line MCP_PUBLIC_URL "$2"
  outcome "$d" scripts/prod/preflight.sh env
  expect_status "$3" "$4"
  [ -n "${5:-}" ] && expect_out "$5" "naming $5"
  return 0
}
mcp_case "http://localhost:8080" "" 0 "without MCP_PUBLIC_URL nothing about the MCP is checked"
mcp_case "https://vlx.example" "https://vlx.example:8443/mcp" 0 "an https origin and an endpoint on the same host pass"
mcp_case "http://localhost:18080" "http://localhost:18091/mcp" 0 "http on localhost passes (throwaway trials)"
mcp_case "https://vlx.example/" "https://vlx.example:8443/mcp" nonzero "a trailing slash on PUBLIC_ORIGIN is refused (it is the issuer)" PUBLIC_ORIGIN
mcp_case "https://vlx.example,http://localhost:8080" "https://vlx.example:8443/mcp" nonzero "a list in PUBLIC_ORIGIN is refused" PUBLIC_ORIGIN
mcp_case "http://192.0.2.10:8080" "http://192.0.2.10:8091/mcp" nonzero "plain http beyond the loopback is refused" PUBLIC_ORIGIN
mcp_case "https://vlx.example" "https://other.example:8443/mcp" nonzero "an endpoint on another host is refused" MCP_PUBLIC_URL
mcp_case "https://vlx.example" "https://vlx.example:8443/" nonzero "an endpoint not ending in /mcp is refused" MCP_PUBLIC_URL
mcp_case "https://vlx.example" "https://vlx.example:8443/mcp" 0 "back to a good pair"
env_set_t() { V="$3" awk -v k="$2" 'BEGIN{v=ENVIRON["V"]} $0 ~ "^" k "=" {print k "=" v; next} {print}' "$1" >"$1.t" && cat "$1.t" >"$1" && rm -f "$1.t"; }
env_set_t "$d/infra/.env" MCP_CLIENT_SECRET short
outcome "$d" scripts/prod/preflight.sh env
expect_status nonzero "a short MCP_CLIENT_SECRET is refused"; expect_out "MCP_CLIENT_SECRET" "by name"
env_set_t "$d/infra/.env" MCP_CLIENT_SECRET "abcdefghijklmnopqrstuvwxyz0123456789ABCD"
env_set_t "$d/apps/server/.env" OAUTH_DELEGATION_SECRET "$(value_of "$d/apps/server/.env" JWT_SECRET)"
outcome "$d" scripts/prod/preflight.sh env
expect_status nonzero "a delegation secret equal to JWT_SECRET is refused"; expect_out "OAUTH_DELEGATION_SECRET" "by name"

# OpenRouter: a warning, never a refusal.
d="$(mkrepo openrouter)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
outcome "$d" scripts/prod/preflight.sh env
expect_status 0 "an empty OPENROUTER_API_KEY does not stop a deploy"
expect_out "OPENROUTER_API_KEY" "but it is named in a warning"

# The ports: checked before the build.
d="$(mkrepo ports)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
outcome "$d" scripts/prod/preflight.sh ports
expect_status 0 "a free ingress port passes"
python3 -c 'import socket,sys,time; s=socket.socket(); s.bind(("127.0.0.1",int(sys.argv[1]))); s.listen(); time.sleep(30)' "$FREE_PORT" & holder=$!
sleep 1
outcome "$d" scripts/prod/preflight.sh ports
expect_status nonzero "a port another program holds is refused"
expect_out "INGRESS_PORT" "naming the key to change"
: >"$d/docker.log"
outcome "$d" scripts/prod/deploy.sh --no-backup
expect_no_log "$d" "--build" "and the deploy stops before it builds anything"
kill "$holder" 2>/dev/null; wait "$holder" 2>/dev/null || true

# The mcp profile follows MCP_PUBLIC_URL; a stop stops every module whatever the settings.
d="$(mkrepo mcpdeploy)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
echo "PUBLIC_ORIGIN=https://vlx.example" >>"$d/infra/.env"; echo "MCP_PUBLIC_URL=https://vlx.example:8443/mcp" >>"$d/infra/.env"
echo "MCP_PORT=$FREE_PORT" >>"$d/infra/.env"
outcome "$d" scripts/prod/deploy.sh
expect_status 0 "a deploy with the MCP on runs to the end"
expect_log "$d" "--profile merlt --profile mcp up -d --build --wait" "it starts the mcp profile too"
expect_out "https://vlx.example:8443/mcp" "and prints the address to give Claude Code"
d="$(mkrepo stopall)"
run "$d" scripts/prod/init-env.sh >/dev/null 2>&1
echo "MERLT_ENABLED=false" >>"$d/infra/.env"
outcome "$d" scripts/prod/deploy.sh --stop
expect_log "$d" "--profile merlt --profile mcp stop" "a stop names every profile, so nothing a previous deploy started keeps running"
```

Also update the existing "a first deploy on main" expectation: without `MCP_PUBLIC_URL` the command line stays `... --profile merlt up -d --build --wait` (no `--profile mcp`). Add:

```sh
expect_no_log "$d" "--profile mcp up" "and, with no MCP_PUBLIC_URL, not the MCP"
```

- [ ] **Step 2: Run them to see them fail**

Run: `sh scripts/prod/tests/test_deploy.sh`
Expected: FAIL on the new scenarios. Nothing adds the keys yet, `preflight.sh ports` is an unknown command, and no `--profile mcp` is passed.

- [ ] **Step 3: Implement**

`init-env.sh`, append after the two creation blocks:

```sh
# Keys added since a host first ran this: completed in files that already exist, never
# overwritten. The MCP's credential is shared by the server and the mcp module, so it lives
# in infra/.env (like MERLT_INTERNAL_SECRET); the delegation key is the server's alone.
add_missing() { # add_missing <file> <KEY> [quote]
  if [ -z "$(env_get "$1" "$2")" ]; then
    env_set "$1" "$2" "$(random_secret 48)" "${3:-}"
    chmod 600 "$1"
    say "added $2 to ${1#"$root"/} (generated, not shown here)"
  fi
}
add_missing "$infra" MCP_CLIENT_SECRET
add_missing "$server" OAUTH_DELEGATION_SECRET '"'
```

`preflight.sh`:
- Header: add the line `#   preflight.sh ports                   the ports the stack publishes, before a build`.
- Helpers, after `is_development_value`:

```sh
# The host of an origin or a URL (no scheme, port or path).
host_of() { printf '%s' "$1" | sed -n 's#^[a-z]*://\([^/:]*\).*#\1#p'; }

# https, or http on this machine (throwaway trials). Anything else would send OAuth tokens in clear.
secure_or_local() {
  case "$1" in
    https://*) return 0 ;;
    http://localhost|http://localhost:*|http://localhost/*|http://127.0.0.1|http://127.0.0.1:*|http://127.0.0.1/*) return 0 ;;
    *) return 1 ;;
  esac
}

# A secret fit for production: set, not a development value, 32 characters or more.
check_secret() { # check_secret <file> <KEY> <label>
  value="$(env_get "$1" "$2")"
  if [ -z "$value" ]; then err "$2 is not set in $3"; return 1; fi
  if is_development_value "$value" || [ "${#value}" -lt 32 ]; then err "$2 in $3 is a placeholder or shorter than 32 characters"; return 1; fi
}
```

- In `check_env`, before `return "$bad"`:

```sh
  # The MCP module, when it is on: its addresses are what clients compare tokens against.
  mcp_url="$(env_get "$infra" MCP_PUBLIC_URL)"
  if [ -n "$mcp_url" ]; then
    origin="$(env_get "$infra" PUBLIC_ORIGIN)"
    case "$origin" in
      ""|*,*|*://*/*) err "PUBLIC_ORIGIN in infra/.env must be one origin, scheme://host[:port] with no path or trailing slash, when MCP_PUBLIC_URL is set: it is the OAuth issuer"; bad=1 ;;
      *) secure_or_local "$origin" || { err "PUBLIC_ORIGIN in infra/.env must be https (or http on localhost) when MCP_PUBLIC_URL is set"; bad=1; } ;;
    esac
    secure_or_local "$mcp_url" || { err "MCP_PUBLIC_URL in infra/.env must be https (or http on localhost)"; bad=1; }
    [ "$(host_of "$mcp_url")" = "$(host_of "$origin")" ] || { err "MCP_PUBLIC_URL in infra/.env must be on the same host as PUBLIC_ORIGIN"; bad=1; }
    case "$mcp_url" in */mcp) ;; *) err "MCP_PUBLIC_URL in infra/.env must end in /mcp"; bad=1 ;; esac
    check_secret "$infra" MCP_CLIENT_SECRET infra/.env || bad=1
    if check_secret "$server" OAUTH_DELEGATION_SECRET apps/server/.env; then
      [ "$(env_get "$server" OAUTH_DELEGATION_SECRET)" != "$jwt" ] \
        || { err "OAUTH_DELEGATION_SECRET in apps/server/.env must differ from JWT_SECRET"; bad=1; }
    else
      bad=1
    fi
  fi
  if [ "$(env_get "$infra" MERLT_ENABLED)" != false ] && [ -z "$(env_get "$infra" OPENROUTER_API_KEY)" ]; then
    warn "OPENROUTER_API_KEY is empty in infra/.env: MERL-T's experts will not answer (the key is not generated: copy it in by hand)"
  fi
```

- The ports command, before the final `case`:

```sh
# A port the stack publishes must be free before minutes of building, unless this stack's
# own container holds it (the deploy replaces that container).
check_port() { # check_port <container> <bind> <port> <KEY>
  if [ -n "$(docker ps -q --filter "name=^$1\$" 2>/dev/null)" ]; then return 0; fi
  if ! command -v python3 >/dev/null 2>&1; then warn "python3 is missing: port $3 was not checked before the build"; return 0; fi
  if ! python3 -c 'import socket,sys; s=socket.socket(); s.bind((sys.argv[1], int(sys.argv[2])))' "$2" "$3" 2>/dev/null; then
    err "port $3 on $2 is taken by another program: set $4 in infra/.env to a free port"
    return 1
  fi
}

check_ports() {
  infra="$root/infra/.env"
  stack="$(env_get "$infra" VISUALEX_STACK)"; stack="${stack:-visualex}"
  bind="$(env_get "$infra" INGRESS_BIND)"; port="$(env_get "$infra" INGRESS_PORT)"
  bad=0
  check_port "$stack-ingress" "${bind:-127.0.0.1}" "${port:-8080}" INGRESS_PORT || bad=1
  if [ -n "$(env_get "$infra" MCP_PUBLIC_URL)" ]; then
    bind="$(env_get "$infra" MCP_BIND)"; port="$(env_get "$infra" MCP_PORT)"
    check_port "$stack-mcp" "${bind:-127.0.0.1}" "${port:-8091}" MCP_PORT || bad=1
  fi
  return "$bad"
}
```

and in the final `case`: `ports) check_ports ;;`, plus `| ports` in the usage line.

The docker stub in `test_deploy.sh` answers `docker ps` with nothing, so the check reaches `python3`. No stub change.

`deploy.sh`:
- In `compose_files`, after the MERL-T line:

```sh
  if [ -n "$(env_get infra/.env MCP_PUBLIC_URL)" ]; then FILES="$FILES --profile mcp"; fi
```

- In the stop branch, replace `compose_files` + `dc stop` with:

```sh
  compose_files
  # Every profile, whatever the settings say now: a module a previous deploy started must stop too.
  case "$FILES" in *"--profile merlt"*) ;; *) FILES="$FILES --profile merlt" ;; esac
  case "$FILES" in *"--profile mcp"*) ;; *) FILES="$FILES --profile mcp" ;; esac
  dc stop
```

- After `sh scripts/prod/preflight.sh env || exit 1`:

```sh
sh scripts/prod/preflight.sh ports || exit 1
```

- In the report, after the `address` lines:

```sh
mcp_url="$(env_get infra/.env MCP_PUBLIC_URL)"
if [ -n "$mcp_url" ]; then
  mcp_bind="$(env_get infra/.env MCP_BIND)"; mcp_port="$(env_get infra/.env MCP_PORT)"
  say "  mcp       $mcp_url  (on this machine: http://${mcp_bind:-127.0.0.1}:${mcp_port:-8091}; publish it at that address, e.g. with the overlay's HTTPS proxy)"
  say "            claude mcp add --transport http visualex $mcp_url"
fi
```

- [ ] **Step 4: Run the tests**

Run: `sh scripts/prod/tests/test_deploy.sh` → every line `ok` (the previous checks plus the new ones), exit 0.
Run: `sh scripts/prod/tests/test_compose.sh` → exit 0.
Run (dash, as on Debian): `docker run --rm -v "$PWD:/r" -w /r debian:bookworm-slim sh -c 'apt-get update -qq && apt-get install -y -qq git python3 >/dev/null && dash scripts/prod/tests/test_deploy.sh'` → exit 0. Ask visualexapi-98 first.

- [ ] **Step 5: Commit**

```bash
git add scripts/prod/
git commit -m "feat(deploy): the MCP's secrets, addresses and port are generated and checked before a build"
```

### Task 7: Docs, the throwaway trial, the security review, the PR

**Files:**
- Modify: `apps/mcp/CLAUDE.md` (the last paragraph: packaged now; `MCP_AUTH_URL`; Host check on every bind; the per-address ceiling)
- Modify: `apps/server/.env.example` (the OAuth comment: in `--prod` these come from `infra/.env` through Compose; only `OAUTH_DELEGATION_SECRET` lives here)
- Modify: `docs/superpowers/specs/2026-09-29-modular-deployment-design.md` (§4.1 table: a row for `mcp` pointing to the 2026-10-05 spec; §4.2: the `mcp` network)
- Modify: `CLAUDE.md` (root) only if a statement there became false (`apps/mcp` row: "no database" stays true)

- [ ] **Step 1: Update the docs above.** Every statement must match the code as it now stands. Commit:

```bash
git add apps/mcp/CLAUDE.md apps/server/.env.example docs/ CLAUDE.md
git commit -m "docs: the MCP server runs in the production stack"
```

- [ ] **Step 2: The throwaway trial.** Ask visualexapi-98 for the go-ahead and for the load on the machine (MERL-T is large: run the trial with `MERLT_ENABLED=false`).

  1. **A scratch copy of the worktree:** `git ls-files -co --exclude-standard -z | tar --null -T - -cf - | (cd <scratch> && tar xf -)`, then `git init`, `git add -A`, and a commit (the preflight wants a clean tree), checked out as `develop`.
  2. **Its own `infra/.env` and `apps/server/.env`** from `init-env.sh`, then:
     - `VISUALEX_STACK=vlx-mcp-trial`;
     - store ports 15436/16381/16382/16343/16344 and `MCP_LEGAL_IT_PORT`/`MERLT_API_PORT` moved off the dev ones;
     - `APP_SUBNET=172.29.250.0/24`, `EDGE_SUBNET=172.29.251.0/24`;
     - `INGRESS_PORT=18090`, `MCP_PORT=18091`;
     - `PUBLIC_ORIGIN=http://localhost:18090`, `MCP_PUBLIC_URL=http://localhost:18091/mcp`;
     - `MERLT_ENABLED=false`.

     Before any `down -v`, `docker compose config --format json` must report the name `vlx-mcp-trial`.
  3. Run `./start.sh --prod --no-pull`. Expected: every module healthy, the report prints the MCP address.
  4. **Sign in as the seeded admin:** the password is `ADMIN_PASSWORD` in the scratch `apps/server/.env`; read it inside a script, never print it. Then run `E2E_EMAIL=… E2E_PASSWORD=… VISUALEX_URL=http://localhost:18090 MCP_URL=http://localhost:18091/mcp node apps/mcp/scripts/e2e.mjs`. Expected: the whole flow green (registration, consent, tokens, every tool, a deletion confirmed, one refused, revocation).
  5. **Curl, without a token:**
     - `/mcp` → 401 with `WWW-Authenticate`;
     - `/.well-known/oauth-protected-resource/mcp` → 200;
     - a foreign `Host` → 403;
     - `http://localhost:18090/.well-known/openid-configuration` → 404;
     - `/oauth/register` reachable;
     - `/oauth/introspect` without the MCP credential → 401;
     - the scrapers' and stores' ports are not published beyond the loopback.
  6. **Client address.**
     - Send six logins with a wrong password and `X-Forwarded-For: 100.64.1.2` to `http://localhost:18090/api/auth/login`. Expected: the sixth is a 429.
     - Then one with `X-Forwarded-For: 100.64.1.3`. Expected: 401, not 429, because the limit counts each forwarded address apart.
     - If that last one is also a 429, Caddy saw the connection from an address outside `APP_SUBNET`/`EDGE_SUBNET`. Docker Desktop on a Mac may route the loopback through its own VM address. Record what was seen, and leave the decisive check to the owner on the Linux host (Step 6).
  7. **Tear down:** `./start.sh --prod --stop`; then, after the name guard, `docker compose ... down -v` and `docker rmi` of the trial's images; remove the scratch copy.

- [ ] **Step 3: Security review** (code-reviewer agent, fresh context, read-only) of the branch's diff against spec §9:
  - audience and issuer never derived from the request;
  - Host and Origin checks;
  - what a peer reaches without signing in;
  - no secret in a log, an image layer, the deploy output or a test's output;
  - the trust settings (Task 1, Task 2, Task 3).

  Fix every finding; rerun the suites of every area touched.
- [ ] **Step 4: The gates.** All must be green, output shown:
  - `npm --prefix apps/mcp test && npm --prefix apps/mcp run build`;
  - `npm --prefix apps/server run build`;
  - `sh scripts/prod/tests/test_deploy.sh`;
  - `sh scripts/prod/tests/test_compose.sh`;
  - `node --test infra/ingress/paths.test.mjs`;
  - `sh infra/ingress/checks/gate.sh`;
  - `node --test '.claude/hooks/*.test.mjs'`.
- [ ] **Step 5: Push, open the PR into `develop`.** The body says:
  - what a person can do now, and what the owner must do on the host:
    1. set `PUBLIC_ORIGIN` and `MCP_PUBLIC_URL` in `infra/.env`;
    2. `./start.sh --prod --branch develop`;
    3. `tailscale serve --bg --https=8443 http://127.0.0.1:8091`;
    4. `claude mcp add` from a second device;
  - the areas it touches: `infra/`, authentication settings, the deploy scripts;
  - the trial's results.

  CI green → merge commit `merge: feat/mcp-in-production — Claude Code can use VisuaLex's dossier tools on the production stack`.
- [ ] **Step 6: Hand over to visualexapi-98:** PRs, the trial's measurements, and the commands for the owner. Write them one per code block, the smallest that decide a question. Add the one that shows the overlay proxy's `X-Forwarded-For` reached the server: a wrong login from the second device, then `docker logs visualex-server --since 2m | grep -i 'login'` or the 429's behaviour.
