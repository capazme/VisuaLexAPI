# Deployment

Everything ships through one script, `deploy.sh`, run **on the server**. It is a
batch job, not a pipeline: there is no CI, nothing validates a push, and nothing
rolls back. What the script does is the whole of what happens at deploy time, so
the script has to be kept in step with the codebase by hand. This document is
the record of that contract.

---

## The two-branch model, and why it matters here

| Branch | What it is |
|---|---|
| `main` | Visualex "vanilla" — the product in production |
| `visualex-merlt-main` | The AI-powered experiment. **Never deployed.** |

The pull at step 1 is:

```bash
git pull -r origin "$(git branch --show-current)"
```

It follows **whatever branch the server happens to be on**. If a debugging
session ever left the server checked out on `visualex-merlt-main`, this would
ship the experiment — including a Python sidecar and a Docker stack production
has no configuration for.

Step 0 therefore refuses to run from anything but `main`, detached HEAD
included:

```
✗ Refusing to deploy from branch 'visualex-merlt-main' — expected 'main'.
  Switch with: git checkout main
  Or, if this is deliberate, re-run with --allow-branch
```

`--allow-branch` downgrades it to a warning, for the deliberate case of
deploying a hotfix branch.

Work flows one way, `main` → `merlt`. Vanilla fixes are committed on `main`
through short-lived branches; `merlt` absorbs them with a periodic
`git merge main`. Nothing is ever cherry-picked back.

---

## What `deploy.sh` does

```bash
./deploy.sh --patch     # build, bump 1.0.0 -> 1.0.1, restart
./deploy.sh             # build and restart, no version bump
./deploy.sh --no-pull   # build what is already checked out
./deploy.sh --no-restart
```

The steps, and what each one is there to prevent. Most were added after their
absence broke a deploy, which is why they read as a list of scars:

| # | Step | Why it is there |
|---|---|---|
| 0 | Branch guard | Refuses to deploy from anything but `main`. See above. |
| 1 | `git pull -r` on the current branch | Rebases onto the remote. Discards lockfile churn if it finds any — with `npm ci` there should be none, so this is now a net for a hand-run `npm install` — and **refuses to continue** if anything else in the tree is dirty: `git pull -r` cannot rebase over unstaged changes, and a deploy must not silently discard work it did not create. |
| 2 | `pip install -r requirements.txt` | Runtime deps only. `requirements-dev.txt` (pytest) is deliberately **not** installed in production. Now includes `lxml` (the Akoma Ntoso parser): it ships a `cp314` wheel, so the server needs no compiler — check that before pinning a version that has none. |
| 2b | `playwright install chromium` | `pip install` does not fetch browser binaries. Without this, PDF export and date completion break at runtime, not at build time. |
| 3 | `npm ci` in `backend/` | Installs exactly the committed lockfile and never rewrites it. If it fails with EUSAGE the lockfile and `package.json` have drifted — commit an updated lockfile, do not fall back to `npm install`. |
| 3b | `npx prisma generate` | A schema change pulled from git leaves `node_modules/@prisma/client` stale, and the backend build then fails on missing models. |
| 3c | `npx prisma migrate deploy` | Idempotent. Without it a schema change ships with no matching column and the API fails on the first query that touches it. |
| 4 | `npm ci` in `frontend/` | |
| 5 | `npm run build` (frontend) | `tsc -b && vite build`. **This is the real type-check** — it walks the project references, which a bare `tsc --noEmit` does not. |
| 6 | `npm run build` (backend) | pm2 runs `node dist/index.js`, so skipping this leaves the service on a stale `dist/`. `tsc` type-checks as it emits and fails before writing. |
| 7 | Version bump + commit | Only when `--major/--minor/--patch` is passed. |
| 8 | Restart | `pm2 restart all`, else `systemctl restart visualex-backend`. |

---

## Before you run it

The script builds but **never runs a test**, and it still has no rollback. Since
the transfusion round there is CI (`.github/workflows/ci.yml`) on every PR into
`main` and on `main` itself — Python tests on 3.12 and 3.14, the three frontend
gates, backend tests, plus a weekly `pip-audit` / `npm audit` — so a red `main`
is now visible before a deploy rather than after it. It is a signal, not a gate:
`deploy.sh` does not consult it and will happily ship a red commit. Run the
suites first, from the repo root:

```bash
.venv/bin/python -m pytest tests/ -q
```

```bash
cd backend && npm test
```

```bash
cd frontend && npm run build && npx vitest run
```

Expected today: 355 Python (1 deselected — the `live` marker), 28 backend, 84 frontend.

The backend suite needs `backend/.env.test` pointing at a **separate** database
(`visualex_test`, not `visualex_platform`) — it runs `prisma migrate reset` on
whatever `DATABASE_URL` it is given. There is a guard against resetting a
non-test database, but check the file rather than trusting it.

There are no end-to-end tests on `main`. Builds and unit tests do not catch a
visual or interaction regression, so after a deploy that touched the frontend,
open the app and walk the main flows: search, dossier, workspace.

---

## Environment variables

Not in git. They live in `.env` on the server, and a missing one either falls
back silently or stops the boot.

**Backend** (`backend/.env`) — `DATABASE_URL` and `JWT_SECRET` are validated at
startup and the process refuses to boot without them. See
`backend/.env.example`.

| Variable | Note |
|---|---|
| `DATABASE_URL` | Required |
| `JWT_SECRET` | Required. Generate with `openssl rand -base64 32` |
| `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY` | Default `30m` / `7d` |
| `ALLOWED_ORIGINS` | Comma-separated. Must list the production origin |
| `PORT` / `NODE_ENV` | |
| `REDIS_ENABLED` / `REDIS_URL` | With Redis off the rate limiter falls back to per-instance memory and logs a warning |

**Python API** — all optional, all with defaults:

| Variable | Default | Note |
|---|---|---|
| `ALLOWED_ORIGINS` | localhost only | **Set this in production**, or CORS silently allows only localhost |
| `RATE_LIMIT` / `RATE_LIMIT_WINDOW` | `1000` / `600` | Per-IP counter |
| `REDIS_ENABLED` / `REDIS_URL` / `REDIS_CACHE_PREFIX` | off | Falls back to a filesystem cache |
| `PERSISTENT_CACHE_TTL` | `86400` | |
| `HTTP_MAX_CONCURRENCY`, `HTTP_TIMEOUT`, `HTTP_MAX_RETRIES`, `HTTP_BACKOFF_FACTOR`, `HTTP_INITIAL_BACKOFF`, `HTTP_MIN_INTERVAL`, `HTTP_JITTER` | see `tools/config.py` | Scraper tuning |
| `FETCH_QUEUE_WORKERS` / `FETCH_QUEUE_DELAY` | | |
| `AKN_ENABLED` | `true` | Kill switch for the Akoma Ntoso path (article index + last-resort text fallback). Read at call time, so flipping it needs no code change |
| `AKN_CACHE_MAX_ACTS` | `40` | Article indexes held in memory, a few tens of KB each. Texts are never cached |

---

## Maintaining the batch

`deploy.sh` encodes assumptions about the project. When one of these changes,
the script changes with it — otherwise the deploy fails on the server, where
finding out is most expensive.

- **New runtime dependency** → make sure it is in `requirements.txt` or the
  right `package.json`. Test-only deps belong in `requirements-dev.txt` or
  `devDependencies`, which production never installs.
- **Prisma schema change** → nothing to do; steps 3b and 3c cover it. But the
  migration must be **committed**. A schema edit without a migration file passes
  the build and breaks at runtime.
- **New service or process** → step 8 must learn to restart it, and the pm2
  definition must exist on the server (see the gap below).
- **New required env var** → add it to `backend/.env.example`, add it to the
  table above, and set it on the server *before* deploying. A backend var that
  is validated at boot will take the service down.
- **Build command or output path change** → steps 5, 6 and the pm2 `start`
  script must agree on where the artefacts land.

---

## Node runtime

The box runs **Node 24 (NodeSource) / npm 11**, matching both CI and the npm
that writes the committed lockfiles. That alignment is what lets steps 3 and 4
use `npm ci`; it was Node 20 / npm 10 until 29 August 2026, and the mismatch
rewrote the lockfiles on every deploy.

Upgrading is an apt operation, because Node comes from NodeSource:

```bash
sudo sed -i 's|node_20.x|node_24.x|' /etc/apt/sources.list.d/nodesource.list
sudo apt-get update && sudo apt-get install -y nodejs
pm2 update            # restarts the pm2 daemon under the new Node
```

`pm2` lives in `/usr/lib/node_modules`, which the nodejs package does not own,
so it survives the upgrade — but `pm2 update` is required, or the daemon keeps
running on the old binary. Run `pm2 save` first.

To roll back, restore `/etc/apt/sources.list.d/nodesource.list.bak-node20` and
`sudo apt-get install -y nodejs=20.19.6-1nodesource1`, then reinstall
`node_modules` in both `backend/` and `frontend/`.

Keep this in step with `.github/workflows/ci.yml`, which pins Node 24. If the
two drift again, the lockfile churn comes back.

## nginx routes the Python API by prefix, and the list is hand-maintained

`/etc/nginx/sites-enabled/visualex` proxies to the Quart app only for paths
matching one regex:

```
location ~ ^/(fetch_|search_|stream_|export_|history|version|health|dossiers|parse_query)
```

Anything else is served as frontend. **A new endpoint whose path does not start
with one of those prefixes is invisible in production** — nginx answers with the
SPA and the client sees a 405 or an HTML page, while every local test passes.

This has cost two incidents in one day: `/parse_query` and `/search_case_law`.
When adding an endpoint, either name it with an existing prefix or add the new
one here, and verify against production with `curl` after deploying — the deploy
script does not check.

Config changes are made with `sudo`, after `sudo nginx -t` and with a timestamped
backup beside the file.

## The shared HTTP client binds to the first event loop that used it

`visualex_api/services/http_client.py` keeps one module-level `ThrottledHttpClient`
whose `aiohttp.ClientSession` is created lazily and then memoised. It binds to
whatever event loop was running at that moment.

pytest-asyncio gives each test its own loop, so the **second** live test in a
single process fails with "Event loop is closed" — and that surfaces as the
adapter reporting the source unreachable, which is the worst possible disguise:
it looks exactly like the remote site being down.

Today only one test carries the `live` marker, so the bug is dormant. The moment
a second one is added, reset the client between tests (replace the instance's
`__dict__` in an autouse fixture) rather than spending an afternoon believing
Normattiva is down.

## Known gaps

Recorded rather than fixed, so nobody rediscovers them during an incident.

- **CI does not gate the deploy.** `.github/workflows/ci.yml` runs the Python
  suite on 3.12 and 3.14, the three frontend gates and the backend tests on
  every push to `main` — but `deploy.sh` consults nothing and runs no tests, so
  a red `main` still deploys. Read the run on GitHub before deploying; the
  pre-deploy checklist above is still run by hand or not at all.
- **The `systemctl` path only restarts the backend.** `pm2 restart all` covers
  every registered process, but the `systemctl` fallback restarts
  `visualex-backend` alone — the Python API on :5000 keeps running the old code.
- **The pm2 process definitions are not in the repo.** There is no
  `ecosystem.config.js`. What pm2 runs, with which env and which working
  directory, exists only on the server; if that machine is lost, so is the
  knowledge. `start.sh` is a *development* launcher (`npm run dev`,
  `python app.py &`) and is not what production runs.
- **The version bump commit is never pushed.** It stays local to the server, so
  the server's `main` sits one commit ahead of `origin/main` and `git pull -r`
  rebases it forward on every deploy.
- **`requirements.txt` has no version pins.** Builds are not reproducible, and a
  compromised or breaking upstream release lands in production on the next
  deploy without anyone choosing it.
- **No rollback.** Recovery means checking out the previous tag and re-running
  the script — and `prisma migrate deploy` does not walk migrations backwards.
