# The MCP server in the production stack — Design (DRAFT 1)

Date: 5 October 2026. Status: draft, for the owner's approval before any code.
Builds on `2026-09-29-modular-deployment-design.md` (the stack, its networks and
hardening) and `2026-10-02-mcp-spike-design.md` (the authorization server and
`apps/mcp`). Changes `infra/`, authentication and the deploy scripts: areas the
other developer approves, approved by the owner for now.

## 1. Context

Since 4 October the deployment host runs `./start.sh --prod --branch develop`
and the owner serves it to a few people over a private overlay network
(Tailscale's `serve`: HTTPS on the host's overlay name, proxied to the ingress
on the loopback). `apps/mcp` — the dossier tools for Claude Code and LibreLex —
runs only under `--dev`. The owner asked whether the MCP can be used there too.

**Goal.** A person with a VisuaLex account on that stack, on a device of the
overlay network, runs

```
claude mcp add --transport http visualex https://<host>:8443/mcp
```

signs in through the OAuth flow with that account, and uses the six dossier
tools (and the two deleting ones, if they allow it on the consent page).

**Not in scope.** claude.ai and Claude Desktop custom connectors: they connect
from Anthropic's cloud, which cannot reach an overlay address; they wait for
the public exposure (phase 2 of the deployment design).

## 2. Decisions (owner, 5 October 2026)

| # | Question | Decision |
|---|---|---|
| D1 | `/mcp` behind the ingress, or on a port of its own? | **A port of its own** (recommended was the ingress). The OAuth endpoints and the consent page stay behind the ingress: they belong to `apps/server`. |
| D2 | The real client address (today every overlay user looks like one address) | **Fixed in this design**, as its own pull request, merged first. |
| D3 | The host firewall rule (H1, the overlay range added) | A reversible script; the owner runs it with `sudo` after the machine owner agrees. A separate small pull request, not part of this design. |
| D4 | Periodic backups | On the host's disk first, a copy off the machine later. A separate small pull request. |

## 3. What is wrong today (measured on `develop`, 5 October)

1. **`apps/mcp` uses the issuer as a network address.** It calls
   `${MCP_AUTH_ISSUER}/oauth/introspect` and `/oauth/token`. In production the
   issuer is the public origin (`https://<host>`), which a container cannot
   reach. Every call would answer 503.
2. **Every overlay user shares one address.** Caddy ignores an incoming
   `X-Forwarded-For` from an untrusted peer and writes the address it sees: the
   Docker gateway, since `tailscale serve` connects through the loopback. The
   server trusts one hop (`trust proxy 1`) and reads that gateway. So the login
   limit (5 attempts per 15 minutes per address), dynamic client registration
   (10 per hour per address) and the scraping gate's per-address quota are
   **shared by everyone**: one person's wrong passwords lock the others out.
   This holds today, with or without the MCP.
3. **Nothing in the stack runs, configures or routes the MCP:**
   - no image for it;
   - no Compose service;
   - no ingress route for `/oauth/*` or the authorization server metadata;
   - no generated `OAUTH_MCP_CLIENT_SECRET` / `OAUTH_DELEGATION_SECRET`;
   - no preflight check of them.
4. **The ingress answers `200 index.html` for any unknown path**, including
   `/.well-known/openid-configuration`, which OAuth clients probe. A client
   that tries it reads HTML where it expects JSON.

## 4. Architecture

### 4.1 The module

`mcp`, built from a new `apps/mcp/Dockerfile`:
- **Image:** the server's pattern — Node 24 slim, `npm ci` in a build stage, the runtime with production dependencies only, user `node`, exec-form `CMD`.
- **Hardening** as every application module (H2/H3): `init`, `cap_drop: ALL`, `no-new-privileges`, `read_only` with a `tmpfs` on `/tmp`, log rotation, `restart: unless-stopped`.
- **Health check:** `GET /.well-known/oauth-protected-resource` on `127.0.0.1`. It is unauthenticated and needs no new route.
- **Started only when `MCP_PUBLIC_URL` is set** in `infra/.env`: a Compose profile `mcp` that `deploy.sh` turns on. Without the variable the stack is exactly today's.
- **`./start.sh --prod --stop` stops it** whatever the setting.

### 4.2 Networks and what is published

| Network | Members | Why |
|---|---|---|
| `edge` | `ingress` | as today; its subnet becomes fixed (`EDGE_SUBNET`, default `172.29.241.0/24`) because Caddy trusts it (section 5) |
| `mcp` (new) | `mcp`, `server` | the MCP reaches the server and nothing else: not the scrapers, not MERL-T (whose `/admin` and `/ner` routes have no gate of their own, R2), not the stores |

Published: `${MCP_BIND:-127.0.0.1}:${MCP_PORT:-8091}:3002`, on the loopback by
default, like the ingress. The overlay reaches it through a second `tailscale
serve` mapping (`--https=8443`). No other port is published.

### 4.3 The addresses, from one place

`infra/.env` carries two addresses; Compose derives the rest from them:

| Setting | Value | Read by |
|---|---|---|
| `PUBLIC_ORIGIN` | `https://<host>` | issuer, consent page, API audience, CORS |
| `MCP_PUBLIC_URL` | `https://<host>:8443/mcp` | the resource: the audience of the tokens |

| Variable | In | Value |
|---|---|---|
| `OAUTH_ISSUER` | server | `${PUBLIC_ORIGIN}` |
| `OAUTH_CONSENT_URL` | server | `${PUBLIC_ORIGIN}/connect` |
| `OAUTH_MCP_RESOURCE` | server | `${MCP_PUBLIC_URL}` |
| `OAUTH_MCP_CLIENT_SECRET` | server | `${MCP_CLIENT_SECRET}` |
| `MCP_RESOURCE` | mcp | `${MCP_PUBLIC_URL}` |
| `MCP_AUTH_ISSUER` | mcp | `${PUBLIC_ORIGIN}` (what the metadata says) |
| `MCP_AUTH_URL` (new) | mcp | `http://server:3001` (where it calls) |
| `MCP_API_BASE` | mcp | `http://server:3001/api` |
| `MCP_API_AUDIENCE` | mcp | `${PUBLIC_ORIGIN}/api` (= the server's default `OAUTH_API_AUDIENCE`) |
| `MCP_HOST` | mcp | `0.0.0.0` |
| `MCP_CLIENT_SECRET` | mcp | `${MCP_CLIENT_SECRET}` |
| `MCP_ALLOWED_ORIGINS` | mcp | empty: no browser page may call it |

The flow end to end:
1. Claude Code calls `https://<host>:8443/mcp` and gets a 401.
2. It reads the protected resource metadata from the same port (`apps/mcp` serves it).
3. That metadata names the authorization server `https://<host>`.
4. Claude Code reads that server's metadata through the ingress.
5. It registers itself and opens `/oauth/authorize`.
6. The server redirects to `https://<host>/connect`, the consent page.
7. The person signs in and consents; the server redirects back to Claude Code's loopback callback.
8. Claude Code exchanges the code for tokens at `/oauth/token`.
9. From then on `apps/mcp` checks each token at `http://server:3001/oauth/introspect`, and exchanges it there for a short-lived API token on every tool call.

The client's token never reaches the API; the API token never reaches the
client (unchanged from the spike).

The authorization server and the resource sit on different origins (port 443
and port 8443 of the same host). The MCP authorization specification allows it.
The issuer, the token audience and the metadata stay exact strings, as they
are today.

## 5. The real client address (its own pull request, merged first)

- **Caddy** trusts `X-Forwarded-For` only from the `edge` subnet, which is where
  a connection through the host's loopback appears: the global option
  `servers { trusted_proxies static {$EDGE_SUBNET} }`. Anything else, such as a
  device on the home network when `INGRESS_BIND` is a LAN address, still has
  its header overwritten by the address Caddy sees, as today.
- **The server** replaces `trust proxy 1` with `'loopback, uniquelocal'`. Express
  walks `X-Forwarded-For` from the right and stops at the first address that is
  not private. Overlay addresses (`100.64.0.0/10`) are not in those ranges, so
  they become the client's address.
  - In development `req.ip` stays the loopback.
  - In production only containers reach the server. Caddy is the only one that
    forwards client headers; MCP and MERL-T calls carry none.
- **`apps/mcp`** gets the same setting (it sits behind the same overlay proxy,
  through the loopback) and a ceiling per address on its endpoint: 300 requests
  a minute, counted with `express-rate-limit`. Without it, one caller sending
  invalid tokens makes the server introspect each one and spends the
  introspection ceiling (1,200 a minute), which is shared by every user.
- **If the overlay proxy sends no `X-Forwarded-For`**, nothing is worse than
  today. It is measured after the deploy (section 9).

## 6. `apps/mcp` changes

- `MCP_AUTH_URL` (default: the issuer, so development is unchanged) is where
  introspection and the token exchange are sent.
- **The Host allow-list.** Today it applies only on a loopback bind. It becomes
  always on: the hostname of `MCP_RESOURCE` plus `localhost`, `127.0.0.1` and
  `[::1]`. The loopback names are for the health check: a page attempting DNS
  rebinding sends its own hostname, never `localhost`. The SDK compares
  hostnames without the port.
- `trust proxy` and the per-address ceiling of section 5.
- **Unchanged:**
  - browser `Origin` refused unless listed (empty list in production);
  - every token introspected, nothing cached;
  - one log line per tool call, never a token or an argument.

## 7. Ingress changes

- Two new routes to the server, outside the scraping gate, body capped at 64 KB:
  - `handle /oauth/*`
  - `handle /.well-known/oauth-authorization-server`
- Every other `/.well-known/*` answers 404: no more HTML for a client's probe.
- `/connect` is the single-page app. It already gets `frame-ancestors 'none'`
  and `X-Frame-Options: DENY`, so the consent page cannot be framed
  (clickjacking).
- `paths.test.mjs` asserts the two OAuth routes, and that they are not behind
  `forward_auth`.
- `checks/gate.sh` asserts:
  - an unauthenticated `/oauth/authorize` reaches the server;
  - `/.well-known/openid-configuration` is a 404.

## 8. Secrets and the deploy scripts

- **`MCP_CLIENT_SECRET`** lives in `infra/.env`. It is shared between the server
  and the MCP, the same pattern as `MERLT_INTERNAL_SECRET`, so the two sides
  cannot drift.
- **`OAUTH_DELEGATION_SECRET`** lives in `apps/server/.env`: only the server
  signs with it.
- **`init-env.sh`** also adds a missing key to a file that **already exists**
  (the deployment host has both files). It never overwrites a value and never
  prints one.
- **`preflight.sh env`**, when `MCP_PUBLIC_URL` is set, refuses the deploy if:
  - either secret is missing, shorter than 32 characters or a development value;
  - the delegation secret equals `JWT_SECRET`;
  - `PUBLIC_ORIGIN` is not one single origin;
  - `PUBLIC_ORIGIN` or `MCP_PUBLIC_URL` is not `https`, except `localhost` and
    `127.0.0.1` (throwaway trials);
  - `MCP_PUBLIC_URL` is not on the same host as `PUBLIC_ORIGIN`, or does not
    end in `/mcp`.
- **Lessons of the first deploy**, in the same files:
  - the preflight checks, before any build, that `INGRESS_PORT` and `MCP_PORT`
    are free on their bind address, or held by this stack's own containers;
  - it warns when `OPENROUTER_API_KEY` is empty, since `init-env` does not ask
    for it.
- **`--dev` is unchanged:** `start.sh` keeps writing its secrets into
  `apps/server/.env` and `apps/mcp/.env`.

## 9. Security analysis

**Without signing in, a device on the overlay network reaches:**
- **On the ingress:**
  - the static app;
  - login, and registration, which creates an inactive account an admin must
    approve;
  - the authorization server's metadata;
  - dynamic client registration (10 per hour, now per real address);
  - `/oauth/authorize`, which only leads to the consent page and its login;
  - `/oauth/token` and `/oauth/revoke`, which need a code, a refresh token or a
    client credential;
  - the open `/version` and `/health`.
- **On the MCP port:** the protected resource metadata, and a 401 for anything
  else.
- **Introspection** answers only to the MCP's own credential.

**Token audience and issuer behind the proxies:**
- They are configuration strings, never derived from the request's `Host` or
  `X-Forwarded-*`.
- A token minted for another resource fails the MCP's `aud` check.
- An exchanged API token is never accepted at the MCP.

**Host and Origin:**
- The MCP refuses foreign hostnames and every browser origin.
- The ingress serves any hostname, as today; it carries no MCP traffic.

**Secrets:**
- Generated on the host, mode 0600, never in an image, a log or the repository.
- The MCP's log lines name the user, the client and the tool only.
- The review checks this against the code, not this document.

**Remaining risks, stated:**
- The overlay's identity headers (`Tailscale-User-*`) reach the server, and
  nothing reads them. Nothing may start trusting them without a design: anyone
  who reaches the ingress some other way could set them.
- **H1 does not cover the `mcp` network.** A compromised MCP process could open
  connections to the home network. It renders no third-party content, unlike
  the scrapers, so this is lower risk. The H1 script (D3) can take the subnet
  as a second argument.
- **Admitting people beyond the owner** was conditioned by the deployment
  design (section 4.5 and 12) on the MERL-T visibility switch and a privacy
  notice. Both are still missing. That is the owner's decision, outside this
  design.

## 10. Verification

1. **Unit tests in `apps/mcp`:**
   - introspection and exchange go to `MCP_AUTH_URL`, not the issuer;
   - a foreign `Host` gets a 403; the resource host and the loopback get through;
   - the per-address ceiling counts the forwarded address behind a trusted
     proxy, and the socket address otherwise;
   - existing suites green.
2. **Server:**
   - a test that `req.ip` follows the rule of section 5 (a forwarded overlay
     address, a forged header from an untrusted peer);
   - the full server suite, in a window agreed with the orchestrator.
3. **Static checks:**
   - `test_compose.sh` and `compose_invariants.py`: `mcp` hardened, on `mcp`
     and nothing else, published on the loopback only, absent without
     `MCP_PUBLIC_URL`; the server on `mcp`;
   - `test_deploy.sh`: the new preflight refusals and `init-env`'s additions;
   - `paths.test.mjs`, `gate.sh`.
4. **A throwaway production stack on a development machine** (its own
   `VISUALEX_STACK`, ports and subnets, started after the orchestrator agrees),
   with `PUBLIC_ORIGIN` and `MCP_PUBLIC_URL` on `localhost`:
   - `apps/mcp/scripts/e2e.mjs` runs the whole flow through the published
     ports: registration, consent, tokens, every tool, a deletion confirmed and
     one refused;
   - a curl pass on what is reachable without a token.
5. **Security review** of the second pull request before it merges, against
   section 9.
6. **On the deployment host, by the owner:**
   1. set `PUBLIC_ORIGIN` and `MCP_PUBLIC_URL` in `infra/.env`;
   2. run `./start.sh --prod --branch develop`;
   3. add `tailscale serve --bg --https=8443 http://127.0.0.1:8091`;
   4. from a second device of the overlay: `claude mcp add …`, sign in, list
      the dossiers;
   5. in the server's logs, check that a login attempt from that device shows
      its overlay address, not the gateway.

## 11. Pull requests

1. `fix/real-client-address`: section 5 for Caddy and the server, plus
   `EDGE_SUBNET`. Touches `infra/` and authentication (the rate limits).
2. `feat/mcp-in-production`: sections 4, 6, 7, 8, and `apps/mcp`'s half of
   section 5. Touches `infra/`, authentication (the OAuth settings) and the
   deploy scripts. Updates `apps/mcp/CLAUDE.md` (it says the MCP is not
   packaged), `infra/.env.example` and the headers of the Compose files.

Separate, after these: the Postgres health-check margin, H1 (D3), periodic
backups and the runbook (D4), CSP enforcing, CI for the deploy scripts.
