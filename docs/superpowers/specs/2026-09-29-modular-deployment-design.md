# Modular deployment on the dedicated host — Design (DRAFT 2)

**Date:** 2026-09-29
**Status:** DRAFT 2 for the owner's review. The interview answers of 29 September are in
(section 3); section 11 keeps what is still open.
**Round:** deployment. It comes **before** the self-service authentication round
(`docs/superpowers/plans/2026-09-29-auth-self-service-v2.md`), by the owner's choice, and
supersedes that plan's section 5 ("Exposure").

## 1. Context

What exists today:

- `./start.sh` is the development entry point: the stores run in Docker
  (`infra/compose.yml`), the Python API, the server and the web app run on the host with
  hot reload. The old production server is gone; there is no `deploy.sh`.
- The Compose file holds the stores (Postgres, Redis, FalkorDB, Qdrant) and, under the
  `merlt` profile, MERL-T. **Nothing else is containerised**: there is no Dockerfile for
  `apps/server`, `apps/web` or `services/visualex`.
- The Python API starts with Quart's built-in development server (`app.run`); no
  production ASGI server is in `requirements.txt`. It keeps state on disk — a search
  history and a dossier file under `data/` (older than, and separate from, the
  server-backed ones), and a cache under `download/cache` — and logs to a file in its
  working directory.
- The browser calls the scraping endpoints at the root of the origin (`/fetch_*`,
  `/stream_article_text`, `/export_pdf`, …), with a bare `fetch` from about seventeen
  places and **without any login token**. Vite proxies them to :5000 in development,
  by path prefix.
- The Python API has no authentication. Only the Node server does.
- Every server-side consumer of the Python API already takes its address from the
  environment: `LEGAL_API_URL` (the saved-norm watcher) and `VISUALEX_API_URL` (MERL-T).

## 2. Goals and non-goals

**Goals.** The whole stack runs on one dedicated machine as containers; it comes back by
itself after a reboot; one command builds and starts it; a deploy never happens without a
fresh backup; the scraper module can later move to another machine without code changes.
Phase 2 adds: one door facing the internet, with the scrapers behind a login.

**Non-goals.** Multi-host orchestration (Swarm, Kubernetes) and high availability; a CI/CD
pipeline that deploys by itself; moving MERL-T off the host; the authentication round
itself (invites, password reset).

## 3. Decisions taken (interview of 29 September)

| # | Decision |
|---|---|
| D1 | The host is a dedicated Linux machine, always on, on the home network. Docker Engine with the Compose plugin; systemd starts it at boot. |
| D2 | One entry point, two modes: `./start.sh --dev` (default, exactly today's behaviour) and `./start.sh --prod` (build and run the containers on the host). |
| D3 | Deployment comes before the authentication round; and phase 1 (private) before phase 2 (public). |
| D4 | The architecture is modular: each module is one image and one Compose service, and the scrapers are the module designed to be movable. |
| D5 | The spare Android phone (Termux, 8 GB) **cannot host a module**: Docker needs kernel features an unrooted Android app cannot use, and running the scraper natively under Termux is a different, fragile stack (Chromium under a proot userland, background processes killed by Android). The scrapers start on the host, isolated by network (section 4.2). |
| D6 | The domain's DNS zone stays on AWS Route 53. |
| D7 | Phase 2 takes the Route 53 route: Caddy with automatic HTTPS behind the home router, the address kept current in Route 53, and **the web-app refactor first**, so that every scraping call carries the login and the ingress can check it. Cloudflare is not used. A public, unshared IPv4 address is a prerequisite; that check is postponed to the start of phase 2 (question Q3). |
| D8 | Backups leave the machine to the phone (section 8). |
| D9 | MERL-T is on in production from the first deploy. It collects, and the admins control it; whether ordinary users see it is a separate switch (section 4.5). |

## 4. Architecture

### 4.1 Modules

| Module | Image | Talks to | State | Notes |
|---|---|---|---|---|
| `ingress` | Caddy, with the built web app | `server`, `scrapers` | none | The only module facing the network. Routes `/api/*` to `server`, the scraping paths to `scrapers`, everything else to the static app with the single-page fallback. The scraping path list is the one in `apps/web/vite.config.ts`, prefix semantics included (`/health` also covers `/health/detailed`); a test keeps the two in step. Everything else in the Python API (its own `/history`, `/dossiers…`, circuit-breaker status) stays unrouted. |
| `server` | Node (built from `apps/server`) | stores, `scrapers`, MERL-T | none | A one-shot `migrate` service runs `prisma migrate deploy` first; `server` starts when it has finished. |
| `scrapers` | Python + Chromium (from `services/visualex`) | the internet | cache and state folders | Runs under Hypercorn with **one worker** (the rate limiter, circuit breaker and fetch queue are in-memory per instance). Filesystem cache, no Redis (section 4.2). The movable module. |
| stores | as `infra/compose.yml` | — | volumes | Postgres, Redis, FalkorDB, Qdrant. Already pinned. |
| MERL-T | as `infra/compose.yml` | stores, `scrapers` | volumes | `mcp-legal-it`, `merlt-api`, `merlt-worker`. On in production (D9). |

Compose is split so that modularity is real, not nominal:

- `infra/compose.yml` — stores and MERL-T, unchanged: development keeps working as is.
- `infra/compose.app.yml` — `ingress`, `server` (and its `migrate` step).
- `infra/compose.scrapers.yml` — `scrapers` alone. On this host it is one more `-f`; on
  another Linux host it would run by itself.
- `infra/compose.prod.yml` — production overrides: restart policies, log rotation,
  networks, resource limits, MERL-T's callback addresses pointed at container names.

### 4.2 Networks and what a compromise can reach

Three internal networks and nothing else:

| Network | Members | Why |
|---|---|---|
| `edge` | `ingress` | The only door; in phase 2 the router forwards to it. |
| `app` | `ingress`, `server`, `scrapers`, MERL-T | The request path. |
| `data` | `server`, MERL-T, the stores | The stores are reachable only by the two modules that need them. |

`scrapers` sits on `app` only and needs outbound internet, so `app` is not an `internal`
network. It has **no Redis**: MERL-T's job queues live in Redis as pickled objects, so a
scraper able to write there could get code run by the worker. The scrapers keep their
cache on the filesystem instead.

Two risks remain, stated so nobody finds them by accident:

- **R1 — the home network.** A compromised Chromium (it renders third-party pages) cannot
  reach the databases, but on an ordinary Docker install it could still reach the other
  devices on the home network through the host. Hardening H1 closes that with a host
  firewall rule; the smoke test checks it.
- **R2 — MERL-T's own API.** From `app` a compromised scraper can reach `merlt-api`, whose
  `/admin/*` and `/ner/*` routes have no gate of their own (only the server's
  `requireAdmin` protects them today). Closing it means requiring the admin key on those
  routes inside `services/merlt` — a separate change, recorded here as a follow-up for
  the owner's approval, not folded into this round.

### 4.3 What is published

In `--prod` no port is published beyond the machine's own loopback (the backup tool
reaches the stores there). The ingress answers on the local network address in phase 1;
in phase 2 it is the one port the router forwards.

### 4.4 The scrapers as a movable module

Moving them later is configuration, not code: `LEGAL_API_URL` and `VISUALEX_API_URL` point
at the new address and the ingress upstream variable does the same. The day they run on
another machine the link stops being a private Docker network, so two things become
mandatory then, and are **not** built in this round: a shared secret checked by the Python
API (the pattern of `internalAuth` in the server) and the firewall rule on the far machine
allowing only the host.

### 4.5 MERL-T in production

MERL-T is deployed and on: its three containers join `app` and `data`, their callbacks
to the server and their address for the scrapers use container names (`server`,
`scrapers`) instead of `host.docker.internal`, and `--prod` initialises the
`vendor/mcp-legal-it` submodule as development does. The language model key is the
owner's own (`OPENROUTER_API_KEY`); empty means no model calls, while tracking and the
graph do not need it.

**Collecting, controlled by admins, not yet shown to users** is not something the code
can do today, and the reason is worth stating:

- The tracking signals are consent-gated by contract: the server refuses them without a
  consent level of `basic` or `full`, and the client sends them only when the consent
  context allows it.
- The front-end flags (`VITE_FEATURE_MERLT`, `VITE_FEATURE_MERLT_GRAPH`) are **build-time**
  and default to **on**. As built, MERL-T is either shown to everyone or absent for
  everyone, admins included — and absent means nothing is collected, because the
  trackers live in the hidden slot.
- The admin controls that exist (training, graph hygiene, engine configuration) already
  sit behind `requireAdmin`.

What is missing is a **runtime visibility switch** with three values — `off`, `admins`,
`everyone` — that the web app reads after login and that `useMerltFeatures` and the
sidebar honour, changed by an admin from the MERL-T ops cards. **Decided (29 September): a database
setting**, so an admin flips it without a restart — a Prisma migration, which the other
developer approves (an environment variable would have needed a restart and left the
admins unable to change it themselves). Until it exists there is one user, an
admin, who sees everything, so it is not needed for phase 1. **It must exist before
anyone else is admitted.** Collecting from ordinary users while the feature is hidden is a
transparency question for the privacy notice, not something code settles; in `admins`
mode only admins' actions are collected.

## 5. Phases and exposure

**Phase 1 — private.** The stack runs on the host and answers on the home network only;
from outside it is reachable through a VPN if wanted. No domain, no port forwarded. There
is one user today, so nothing is lost, and every module, the boot behaviour, the backup
and the update path are proven before anyone else is admitted.

**Phase 2 — public** (D7). In this order:

1. **The connection.** A public IPv4 address that is not shared with other customers
   (no carrier-grade NAT) and an ISP that leaves 80 and 443 alone. If it fails, option B
   below is impossible and the question is reopened. *Blocking; checked first (Q3).*
2. **The web-app refactor.** One authenticated client for the seventeen call sites: it
   attaches the token, refreshes it on a 401 as `services/api.ts` does, and keeps the
   NDJSON stream and the PDF download working. Its own task, with its own review, on
   files the reading surface depends on.
3. **The login check at the ingress.** Caddy asks the server before passing a scraping
   request on (`forward_auth` to a new `GET /api/auth/verify`, which reuses
   `authenticate`). The same hop applies a per-user quota to the scraping paths — this
   replaces the per-IP ceiling of the auth plan's WS6.
4. **Address and certificate.** The router forwards 80 and 443 to the ingress; a small
   updater keeps a Route 53 record current with an IAM user allowed to change that one
   record set and nothing else; Caddy gets its certificate from Let's Encrypt over the
   same port. The home address becomes public in DNS.
5. **The real client address**, carried from the router hop through the ingress to the
   server, so per-IP limits mean something.
6. **The MERL-T visibility switch** (section 4.5).

*Considered and set aside:* Cloudflare Tunnel with an access policy would have opened the
door with no web-app change, but it needs the DNS zone on Cloudflare (a partial setup is
Business and Enterprise only) and puts a third party in front of the traffic. The owner
chose the refactor instead.

## 6. `start.sh`

- **`--dev`** (the default when no flag is given, printed as a one-line notice): today's
  behaviour, unchanged — stores in Docker, three services on the host, Ctrl+C stops the
  host processes and the stores. The bootstrap of a fresh checkout (env files, venv,
  dependencies, Chromium) lives here.
- **`--prod`**, on the deployment host:
  1. **Preflight.** Linux with Docker and the Compose plugin; `infra/.env` and
     `apps/server/.env` exist and none of the development passwords is left in them;
     the working tree is clean and `HEAD` is `main` or a `vX.Y.Z` tag, unless
     `--allow-branch` says otherwise. The commit or tag being deployed is printed.
  2. **First run only.** Missing env files are created with **generated** random secrets,
     never the development defaults, and their location is printed — the values are not.
     `MERLT_ENABLED` starts as `true`.
  3. **Backup.** `scripts/backup.sh` runs first (skippable with `--no-backup`, and skipped
     by itself on a first deploy, when the stores are empty).
  4. **Build and start.** `docker compose -f … up -d --build --wait`, the MERL-T profile
     included, migrations included, then a health check of every module.
  5. **Report.** The address it answers on and how to follow the logs.
  It **does not** run `git pull`: it deploys what is checked out, and says which. It does
  not stay in the foreground; the containers keep running.
- A rollback is `git checkout vX.Y.Z && ./start.sh --prod`. Migrations do not walk
  backwards: the pre-deploy backup is the rollback for the data.
- Stopping: `./start.sh --prod --stop` (containers and volumes stay).

## 7. The images

- **`scrapers`.** A Debian-based Python image (Playwright does not support Alpine),
  Chromium installed with its system libraries, a non-root user, Hypercorn with one
  worker. Docker's default 64 MB of shared memory is enough (measured: Playwright's
  Chromium avoids `/dev/shm`); the memory limit comes from measurement too — about
  280 MiB idle and about 1.06 GiB with four PDF exports at once — so it is set at 2 GiB
  and Chromium cannot starve the databases. The application needs a module-level ASGI object (`asgi.py`)
  because `app.py` builds it inside `main()`. Three details the code forces: the image
  mirrors the repository layout (`/repo/services/visualex`, `/repo/version.txt`) because
  `/version` and the state paths are computed relative to the source tree; the log file
  handler becomes optional, because a read-only root filesystem cannot open it; and the
  `data/` and `download/` folders are volumes, or the history and the cache die with
  every rebuild. The client address for the rate limiter is read from `X-Forwarded-For`
  only when told how many proxies to trust — today it trusts any caller-supplied value,
  which makes the per-IP limit meaningless once the service is reachable. Behind the
  ingress the count is 1; left at 0, every client would share the ingress's address and
  one rate-limit bucket.
- **`server`.** A multi-stage build: `npm ci`, `prisma generate` and `tsc`, then a runtime
  with only what `node dist/index.js` needs, on a Debian slim base (not Alpine) for
  Prisma's engine. `prisma` and `tsx` are development dependencies, so the `migrate` step
  runs from the build stage and the admin seed runs compiled (`dist/utils/seed.js`) once,
  on first deploy, with the password from `.env`.
- **`ingress`.** Multi-stage: the web build with `VITE_API_URL=/api` (same origin, so no
  CORS), copied into Caddy. Security headers (the content security policy starts in
  report-only mode), compression, immutable caching for hashed assets, no buffering on
  the stream path, and body limits that match the server's (the note upload is 50 MB).

## 8. Data, secrets, hardening

**Data.** Named volumes, as today. A backup before every deploy (section 6, step 3), a
scheduled one by a systemd timer, and a copy **off the machine to the phone** (D8):
`restic` over SFTP to an `sshd` running in Termux (both packages exist there — to be
confirmed on the device), key-only, the key restricted to the host. restic encrypts, keeps
retention and checks integrity; its password lives in the owner's password manager and
**also** on the host — without it the backups are unreadable, so it is never only on the
machine it protects. Termux needs a wake lock and an exemption from battery optimisation
or Android will stop it, and the phone stays plugged in. Two limits to accept: the phone
is in the same house, so it protects against a dead disk and not against a fire or a
theft, and a second, encrypted copy in a bucket is the cheap way to cover that; and the
backup holds personal data, so it is encrypted wherever it leaves the host
(`scripts/datakit/README.md`). A restore is rehearsed once, on a throwaway stack, before
the deployment is called done.

**Secrets.** Only in `infra/.env` and `apps/server/.env`, mode 0600, never in an image,
a log or the repository.

**Hardening.**

| # | Item |
|---|---|
| H1 | A rule in the host firewall's Docker chain, keyed on the `app` network's fixed subnet, drops traffic from it to the private address ranges of the home network — except to the `app` subnet itself. Checked by the smoke test. |
| H2 | Containers run as non-root with `no-new-privileges` and all capabilities dropped; the root filesystem is read-only where the module allows it. |
| H3 | Log rotation on every container; health checks; `restart: unless-stopped`. |
| H4 | The host: firewall denying incoming traffic except SSH from the home network (and 80/443 in phase 2), SSH by key only, automatic security updates. |
| H5 | Store images stay pinned; new images pinned by version, not `latest`. |

## 9. Verification

Phase 1 is done when all of this holds, each shown, not asserted:

1. `./start.sh --prod` from a clean checkout on the host brings every module healthy,
   MERL-T included.
2. The end-to-end harness (`tools/e2e`) passes against the ingress.
3. A reboot of the host brings the stack back by itself.
4. From another device on the home network, only the ingress answers; no store or
   module port does; and from inside the scraper container the home network is
   unreachable (H1).
5. A backup taken before a deploy restores on a throwaway stack, and the copy on the phone
   restores too.
6. A CI job builds the three images on every pull request, so a Dockerfile cannot rot
   unnoticed.

## 10. Shape of the plan

Ordered, one commit per task, a review after each; the gates are those of `CLAUDE.md`.
Detail: `docs/superpowers/plans/2026-09-29-modular-deployment.md` (phase 1).

**Phase 1.** (1) `scrapers` image; (2) `server` image and `migrate`; (3) `ingress`
image; (4) the Compose split, networks and production overrides, MERL-T wired in;
(5) `start.sh --dev/--prod`; (6) the host runbook `docs/deployment.md` with H1–H5 and the
phone backup; (7) verification and the CI job that builds the images.

**Phase 2** (planned when phase 1 is done and Q3 is answered): the connection check; the
web-app refactor; the verify endpoint and `forward_auth`; the address updater, the
certificate and the router; the real client address; the MERL-T visibility switch.

**Later:** scrapers on another Linux machine (shared secret, firewall); the admin key on
MERL-T's own routes (R2).

Changes to `infra/`, `.github/`, the data scripts, authentication and the Prisma schema
need the other developer's approval (`CLAUDE.md`, git flow), so tasks 4, 5 and 7 — and, in
phase 2, the verify endpoint and the visibility switch — are separate pull requests from
the rest.

## 11. Open questions

- **Q3.** Does the home connection have a public, unshared address? It decides whether
  phase 2 as designed is possible at all. Check: the WAN address shown by the router's
  admin page against the address a "what is my IP" site reports — if they differ, or the
  WAN address starts with `100.64.` to `100.127.`, the connection is behind
  carrier-grade NAT. *Postponed by the owner to the start of phase 2.*
- **Q6.** ~~Where the MERL-T visibility switch lives~~ — decided: a database setting with
  an admin toggle (section 4.5). Still to confirm when it is planned: in `admins` mode,
  is collection from admins only acceptable for now?
- **Q7.** The login check: `forward_auth` at the ingress (recommended: no new hop for the
  payload, one small server endpoint) or the server proxying the scraping calls itself.
  Settled in the phase 2 plan.

## 12. Declared, not forgotten

- Inside the private network the scrapers are unauthenticated; in phase 1 the door is the
  home network, in phase 2 the ingress.
- Compose on one host is a single point of failure by design; the backup is the recovery.
- The privacy notice and the security measures for a host exposed to third parties are
  legal work outside this round, and must exist before phase 2 admits anyone.
