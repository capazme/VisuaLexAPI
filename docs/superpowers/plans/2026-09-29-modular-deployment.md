# Modular deployment — Implementation Plan (phase 1, DRAFT)

**Spec:** `docs/superpowers/specs/2026-09-29-modular-deployment-design.md` (read section 4
and 6 first). **Status:** DRAFT for the owner's review — nothing is built until it is
approved. **Scope:** phase 1 (private). Phase 2 is planned when this is done and question
Q3 (is the connection behind carrier-grade NAT?) is answered.

## Global constraints

- Code first with a failing test wherever there is code to test; `docs/`, Dockerfiles and
  Compose files are verified by the build and by the checks named in each task.
- The gates are those of `CLAUDE.md`: `npm --prefix apps/server test`, `npm --prefix
  apps/web run build && run lint && run test -- --run`, `(cd services/visualex &&
  .venv/bin/python -m pytest tests/ -q)`, `node --test '.claude/hooks/*.test.mjs'`,
  `sh scripts/ci/tests/test_checks.sh`. Record each suite's count before and after.
- Nothing private enters the repository: no addresses of the home network, no key, no
  password, no personal path. `.env` files are never read or printed. Generated secrets
  are written to a file and never echoed.
- A hook forbids commits on `develop`: every group of tasks below is a branch from
  `develop` and a pull request into it, merged with a merge commit once CI is green.
- The other developer approves changes to `infra/`, `.github/`, the data scripts and the
  Prisma schema, so the groups are cut along that line (last section).
- A throwaway stack is used for every test: `VISUALEX_STACK=deploytest` and its own
  ports (`infra/.env.example` explains), never the development stack's volumes.

## Before you start

1. **PR #15 is merged into `develop`.** Tasks 5 and 6 edit `start.sh` and the docs it
   reorganised; building on the old tree means a conflict. Rebase every branch on the
   merged `develop`.
2. **`start.sh` bootstrap.** The stash `start.sh bootstrap` (env files, venv,
   dependencies, Chromium, Docker check) is re-applied by Task 5 as part of `--dev`.
3. **Baselines** on the merged `develop`: the four suites above, counts written down.
4. **A host to test on.** The images are built and tried on the development machine
   first; the host is needed for Tasks 6 and 7 (reboot, firewall, phone backup).

## File structure

| Path | Task | What |
|---|---|---|
| `services/visualex/{Dockerfile,Dockerfile.dockerignore,asgi.py}` | 1 | scraper image and its ASGI entry |
| `services/visualex/visualex_api/tools/{client_ip.py,logging_config.py}` | 1 | trusted-proxy client address; optional log file |
| `services/visualex/tests/{test_asgi.py,test_client_ip.py}` | 1 | tests |
| `apps/server/{Dockerfile,.dockerignore}` | 2 | server image with `migrate` and `runtime` targets |
| `infra/ingress/{Dockerfile,Caddyfile,paths.test.mjs}` | 3 | ingress image, routes, the path-list test |
| `infra/compose.{app,scrapers,prod}.yml`, `infra/.env.example` | 4 | the Compose split |
| `scripts/prod/{deploy.sh,preflight.sh,init-env.sh,tests/}` | 5 | what `--prod` runs |
| `start.sh` | 5 | `--dev` / `--prod` / `--stop` |
| `docs/deployment.md`, `scripts/prod/{backup-to-phone.sh,isolate-scrapers.sh,systemd/}` | 6 | runbook, phone backup, H1 |
| `.github/workflows/ci.yml`, `scripts/prod/smoke.sh` | 7 | image build job, smoke test |

---

## Task 1: The `scrapers` image

**Files:** the first four rows of the table, plus `requirements.txt` (add `hypercorn`) and
`services/visualex/CLAUDE.md` (container notes).

- [ ] **1.1 ASGI entry, test first.** `tests/test_asgi.py`: import `asgi`, use its
  `app.test_client()`, `GET /health` answers 200. Red (no module). Then `asgi.py`:
  `from app import NormaController; app = NormaController().app`. Green. The start and
  stop hooks (`before_serving`, `after_serving`) are what Hypercorn runs, so the fetch
  queue and the browser pool clean-up need no change.
- [ ] **1.2 Trusted-proxy client address, test first.** `tests/test_client_ip.py` for a
  pure function `client_ip(forwarded_for, remote_addr, trusted_proxies)`: with 0 trusted
  proxies the header is ignored whatever it says; with N it is the N-th entry from the
  right; a header shorter than N, or malformed, falls back to `remote_addr`. Then use it
  in `rate_limit_middleware`, reading `TRUSTED_PROXIES` (default 0). Run the existing
  rate-limit tests: they must still pass.
- [ ] **1.3 Optional log file.** Three modules (`treextractor`, `text_op`,
  `urngenerator`) open `norma.log` in the working directory **at import time**, and the
  alternative server opens `visualex_api.log`: on a read-only filesystem the application
  never starts. One shared helper, `log_handlers(default_file)`, replaces the four
  `FileHandler` calls; `VISUALEX_LOG_FILE` names another file, and an **empty** value drops
  the file handler. With it unset each call site keeps its own default, so development is
  unchanged. Test: with it empty, no file is created.
- [ ] **1.4 Hypercorn.** Quart already pulls it in; name it in `requirements.txt` anyway; run `hypercorn asgi:app --bind
  127.0.0.1:5000 --workers 1` from `services/visualex` and `curl /health`. One worker is
  not a default: the rate limiter, the circuit breaker and the fetch queue are in-memory.
- [ ] **1.5 Dockerfile.** Build context is the repository root (`version.txt` is read from
  it), with `services/visualex/Dockerfile.dockerignore` next to the Dockerfile (BuildKit
  reads that one). `python:3.12-slim-bookworm`; `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`;
  `WORKDIR /repo/services/visualex` and `COPY version.txt /repo/version.txt` — the code
  computes `/version` and the `data/`, `download/` paths relative to the tree;
  `pip install -r requirements.txt`, then `playwright install --with-deps chromium` as
  root, then a non-root user; `VISUALEX_LOG_FILE=` empty; `TRUSTED_PROXIES` from the
  environment; a `HEALTHCHECK` that requests `/health` (never `/health/detailed`, which
  probes the real sources); `CMD hypercorn asgi:app --bind 0.0.0.0:5000 --workers 1`.
- [ ] **1.6 Prove it.** `docker build -f services/visualex/Dockerfile -t
  visualex-scrapers .` from the root; run it, then: `/health`,
  `/version` (shows `version.txt`), `POST /fetch_norma_data` and `/fetch_article_text` for
  art. 2043 c.c., `POST /export_pdf` (Chromium renders), and `/stream_article_text` streams
  line by line. Note `docker stats` during four concurrent PDF exports: the memory limit of
  Task 4 comes from it. *(Measured on 29 September, arm64: idle about 280 MiB, peak about
  1.06 GiB and 195 processes; Docker's default 64 MB `/dev/shm` is enough, so no `--shm-size`.)*
- [ ] **1.7 Docs.** `services/visualex/CLAUDE.md`: how the image is built and why one
  worker, the layout mirror, the trusted-proxy setting.

**Verification:** the Python suite (count before/after, with the new tests), the image
behaviours of 1.6 written into the pull request.

## Task 2: The `server` image and `migrate`

**Files:** `apps/server/Dockerfile`, `apps/server/.dockerignore` (excludes `.env*`,
`node_modules`, `dist`, `coverage`, `tests` — a secret must never enter an image),
`apps/server/CLAUDE.md`.

- [ ] **2.1 Stages.** `deps` (`npm ci`), `build` (`prisma generate`, `tsc`), `migrate`
  (from `build`, `CMD npx prisma migrate deploy` — `prisma` is a development dependency),
  `runtime` (`node:24-bookworm-slim`, `openssl` and `ca-certificates`, `npm ci
  --omit=dev`, the compiled `dist/`, the generated client copied from `build`, the `node`
  user, `EXPOSE 3001`, a `HEALTHCHECK` on `/api/health`, `CMD ["node","dist/index.js"]`
  in exec form so SIGTERM reaches the graceful shutdown).
- [ ] **2.2 Seed.** `src/utils/seed.ts` compiles into `dist/utils/seed.js`; the image runs
  it as `node dist/utils/seed.js` (no `tsx` at runtime). Note: it refuses to run without
  `ADMIN_PASSWORD`.
- [ ] **2.3 Prove it.** Against a throwaway stack: the `migrate` target exits 0 on an empty
  database and again on a migrated one; the runtime target answers `/api/health` and
  `/api/health/detailed`; the seed creates the admin and `POST /api/auth/login` works;
  `docker stop` shuts down within a couple of seconds (the sweep of idle sockets).

**Verification:** `npm --prefix apps/server test` unchanged (no application code moves);
the three checks of 2.3 in the pull request.

## Task 3: The `ingress` image

**Files:** `infra/ingress/Dockerfile`, `infra/ingress/Caddyfile`,
`infra/ingress/paths.test.mjs`.

- [ ] **3.1 The path test, first.** `paths.test.mjs` (Node test): read the keys of the
  Python-bound entries in `apps/web/vite.config.ts` and the `@legal` matcher of the
  Caddyfile; they must be the same set, prefix for prefix. Red until 3.2.
- [ ] **3.2 Caddyfile.** Phase 1 is plain HTTP: `auto_https off`, `admin off`, one site on
  `:8080` (above 1024, so the module runs as a normal user with every capability
  dropped). `@legal` (the Vite list, each with a trailing `*`) goes to
  `{$SCRAPERS_UPSTREAM:scrapers:5000}` with `flush_interval -1` so the NDJSON stream is
  not buffered; `/api/*` to `{$SERVER_UPSTREAM:server:3001}`; everything else from `/srv`
  with `try_files {path} /index.html`. Compression; `Cache-Control` immutable on
  `/assets/*` and `no-cache` on `index.html`; `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `X-Frame-Options`, and the content security policy in
  **report-only** first (the reader emits inline styles). Body limits: 60 MB on
  `/api/merlt/contrib/*` (the note upload is 50 MB), 10 MB on the rest of `/api/`, 1 MB on
  the scraping paths and the static app (their real payloads are a few hundred bytes). Nothing else of the
  Python API is routed: its own `/history`, `/dossiers…` and circuit-breaker status stay
  unreachable.
- [ ] **3.3 Dockerfile.** Stage one builds `apps/web` with `VITE_API_URL=/api` (the
  `VITE_FEATURE_MERLT*` flags are build arguments, default on); stage two is `caddy:2`
  with the build in `/srv` and the Caddyfile copied in, and a `RUN caddy validate` so a
  broken file fails the build, not the start; a non-root user, Caddy's state under `/tmp`
  (so the root filesystem can be read-only), and a `HEALTHCHECK` on `/`, which is what
  makes `up --wait` mean something.
- [ ] **3.4 Prove it.** The path test is green; run the image next to a stub upstream and
  check each route lands where the Caddyfile says; a deep link (`/dossier`) returns the
  app, not a 404; the stream path is not buffered (chunks arrive one by one) **also when
  the client sends `Accept-Encoding: gzip`**, as every browser does — compression is the
  other classic place where a stream gets held back.

**Verification:** `node --test infra/ingress/paths.test.mjs`, `npm --prefix apps/web run
build`, the checks of 3.4.

## Task 4: The Compose split, networks and overrides *(needs the other developer)*

**Files:** `infra/compose.app.yml`, `infra/compose.scrapers.yml`, `infra/compose.prod.yml`,
`infra/.env.example`, `scripts/prod/tests/test_compose.sh`.

- [ ] **4.1 The invariants, first.** `test_compose.sh` renders every combination with
  `docker compose config --format json` against `infra/.env.example` and asserts: it
  renders; `compose.yml` alone still renders as development needs it (no application
  module, no new network, every published port on the loopback); in
  the production combination only `ingress` publishes a non-loopback port; `scrapers` is on
  `app` and on nothing else; no store is on `app`; `ingress` is on `edge` and `app`.
- [ ] **4.2 `compose.app.yml`.** `migrate` (target `migrate`, `restart: "no"`), `server`
  (`depends_on: migrate: condition: service_completed_successfully`), `ingress`. The
  server's `DATABASE_URL` is **derived in Compose** from `infra/.env`
  (`postgresql://visualex:${PLATFORM_DB_PASSWORD}@postgres:5432/visualex_platform`), as are
  the secrets it shares with MERL-T (`MERLT_INTERNAL_SECRET`, `MERLT_API_KEY`): one source,
  no drift. `apps/server/.env` (`env_file`) keeps the server-only secrets such as the JWT
  secret. `LEGAL_API_URL=http://scrapers:5000`, `MERLT_API_URL=http://merlt-api:8000`,
  `ALLOWED_ORIGINS` set to the ingress origin, `NODE_ENV=production`.
- [ ] **4.3 `compose.scrapers.yml`.** One service, a memory limit from
  `SCRAPERS_MEM_LIMIT` (default `2g`, from the measurement in 1.6) and a process limit, the `data` and `download`
  folders as named volumes, `TRUSTED_PROXIES=1` (one proxy, the ingress, is in front: with 0 every client on the
  network would share the ingress's address and one rate-limit bucket), no Redis (the
  filesystem cache).
- [ ] **4.4 `compose.prod.yml`.** The three networks with `app` on a fixed subnet
  (`APP_SUBNET`, a default unlikely to collide with the home network, documented);
  every service assigned to its networks; `restart: unless-stopped`; `init: true`; log
  rotation (`json-file`, 10 MB × 5); `cap_drop: [ALL]`, `no-new-privileges` and, where the module allows it, `read_only` with
  a tmpfs on `/tmp` on the application modules (the ingress qualifies: port 8080, state in
  `/tmp`); MERL-T's callback and scraper addresses pointed at container names
  (`MERLT_BFF_*_CALLBACK_URL` → `http://server:3001/…`, `VISUALEX_API_URL` →
  `http://scrapers:5000`). Loopback publishing of the stores stays: the backup tool
  reaches them there.
- [ ] **4.5 Prove it.** Bring the whole stack up on a throwaway name: every module
  reaches `healthy`, MERL-T's `/health` answers, and from a container on `data` the
  scrapers are not resolvable.

**Verification:** `sh scripts/prod/tests/test_compose.sh` green; the throwaway stack up and
healthy; `docker compose -f infra/compose.yml config` unchanged from `develop`.

## Task 5: `start.sh --dev` and `--prod` *(needs the other developer)*

**Files:** `start.sh`, `scripts/prod/{deploy.sh,preflight.sh,init-env.sh}`,
`scripts/prod/tests/test_deploy.sh`.

- [ ] **5.1 The tests, first** (POSIX `sh`, in the style of `scripts/ci/tests`, with a
  stub `docker` on `PATH` that records its calls and a throwaway git repository): `--prod`
  refuses a dirty tree; refuses a `HEAD` that is neither `main` nor a `vX.Y.Z` tag, and
  accepts it with `--allow-branch`; refuses an env file that still holds a development
  password; on a first run creates both env files with generated secrets that differ from
  the examples, mode 0600, prints their **location and never a value**; skips the backup
  on a first deploy and runs it otherwise; `--no-backup` skips it; `--stop` calls compose
  `stop` and nothing else; an unknown flag exits 2 with the usage line.
- [ ] **5.2 Flag parsing.** `./start.sh` with no flag is `--dev` and says so in one line;
  `--dev` is today's script with the bootstrap of the stash folded in (env files, venv,
  dependencies, Chromium, the Docker check) — the diff of the `--dev` path against
  `develop` is only that.
- [ ] **5.3 `--prod`.** `preflight.sh`, `init-env.sh` and `deploy.sh` as in the spec's
  section 6: preflight, first-run secrets (`MERLT_ENABLED=true`), the `vendor/mcp-legal-it`
  submodule, backup, `docker compose -f … --profile merlt up -d --build --wait`, a health
  check per module, then the report. It does not `git pull`, it prints the commit or tag,
  and it returns.
- [ ] **5.4 Try it.** `./start.sh --dev` behaves as before (a full run of the development
  flow); `./start.sh --prod` on the development machine against a throwaway stack name
  reaches the report.

**Verification:** `sh scripts/prod/tests/test_deploy.sh` green; `bash -n start.sh`; the two
runs of 5.4.

## Task 6: The host runbook, the phone backup, H1

**Files:** `docs/deployment.md`, `docs/README.md` (index), `scripts/prod/backup-to-phone.sh`,
`scripts/prod/isolate-scrapers.sh`, `scripts/prod/systemd/*`.

- [ ] **6.1 `isolate-scrapers.sh` (H1), test first.** With `--dry-run` it prints the
  firewall rules for `APP_SUBNET` (accept within the subnet, drop to the private ranges);
  `scripts/prod/tests/test_host.sh` compares that output. Applying it needs root and is a step of the
  runbook, made persistent by a systemd unit.
- [ ] **6.2 `backup-to-phone.sh`.** Runs `scripts/backup.sh`, then `restic` to the phone
  over SFTP; `--dry-run` prints the commands (tested in `test_host.sh`); a systemd timer runs it daily.
  The restic password is read from a file that is not in the repository.
- [ ] **6.3 The runbook.** Preparing the Linux host (Docker Engine and Compose, the user
  in the `docker` group, `docker` enabled at boot, automatic security updates, firewall
  denying incoming traffic except SSH from the home network, SSH by key only); the first
  deploy; an update; a rollback; the phone (Termux from F-Droid, `openssh` and `restic`,
  a key restricted to the host, a wake lock, the battery exemption, `sshd` started at
  boot, an `restic init` and a **restore test**); H1; the reboot test; what to look at
  when a module is unhealthy (Prisma's engine on a missing library, the memory limit,
  Chromium being killed for it).
- [ ] **6.4 Walk it.** On the host, someone who did not write it follows the runbook from
  a clean machine; every place they stumble is a fix to the text.

**Verification:** the dry-run tests green; the runbook walked end to end on the host.

## Task 7: Verification and the CI job *(needs the other developer)*

**Files:** `.github/workflows/ci.yml`, `scripts/prod/smoke.sh`.

- [ ] **7.1 The CI job `images`.** Builds the three images on every pull request without
  pushing (layer cache on), and the `tooling` job also runs `node --test
  infra/ingress/*.test.mjs` and `sh scripts/prod/tests/*.sh`. A red build of a Dockerfile
  fails the pull request.
- [ ] **7.2 `smoke.sh`.** Every module healthy; the sockets the host listens on are the
  loopback ones plus the ingress's, nothing else; from inside the scraper container the
  home network does not answer (H1) while a public site does; `tools/e2e` run against the
  ingress (`E2E_BFF` and `E2E_PY_API` at the ingress, `E2E_MERLT` at the loopback).
- [ ] **7.3 The acceptance list** of spec section 9, each item shown in the pull request:
  the clean `--prod`, the e2e run, the reboot, the view from another device on the home
  network, the restore of a backup and of the copy on the phone.

**Verification:** the CI run of the pull request; `smoke.sh` output attached.

---

## Pull requests

| Group | Tasks | Approval |
|---|---|---|
| `feat/deploy-images` | 1, 2, 3 | no (`services/`, `apps/`, the ingress folder) |
| `feat/deploy-compose` | 4 | yes (`infra/`) |
| `feat/deploy-start-prod` | 5 | yes (data scripts and `start.sh`'s neighbours) |
| `docs/deployment-runbook` | 6 | no |
| `chore/deploy-ci` | 7 | yes (`.github/`) |

## Risks in this plan

- **Chromium's memory.** Unknown until 1.6 measures it; the limit of Task 4 comes from
  that number, not from a guess.
- **MERL-T's image** is large (PyTorch, language models) and its first build takes
  minutes; `--prod` says so instead of looking hung.
- **The stream through the ingress** (`stream_article_text`) is the likeliest thing to
  misbehave behind a proxy; 3.4 checks it directly.
- **`start.sh` conflicts.** Three changes meet in that file (PR #15, the bootstrap, this
  task); Task 5 waits for PR #15.
- **Phone reliability.** Android may stop Termux despite the settings; the backup is only
  as good as its last verified restore, which is why 6.3 and 7.3 both restore.
