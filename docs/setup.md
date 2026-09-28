# Setup — from clone to a running stack

For a Mac (Apple Silicon, 16 GB or more). Commands run from the repository root.

## 1. Prerequisites

- Docker Desktop with Compose v2, running.
- Node 24 and npm 11 (`node -v`, `npm -v`).
- Python 3.12 or newer (`python3 --version`).
- git, with access to GitHub.

## 2. Clone

```bash
git clone --recurse-submodules https://github.com/capazme/VisuaLexAPI.git
cd VisuaLexAPI
git switch develop
```

`--recurse-submodules` fetches `vendor/mcp-legal-it`. Forgot it?
`git submodule update --init --recursive`.

## 3. The `.env` files

They hold your own settings and keys, and are never committed.

```bash
cp infra/.env.example infra/.env
cp apps/server/.env.example apps/server/.env
cp services/visualex/.env.example services/visualex/.env
```

In `apps/server/.env`, fill the secrets the file marks as required with long
random strings (`openssl rand -hex 32`), and set `ADMIN_PASSWORD` if you want
an admin account seeded at start. For MERL-T, choose a `MERLT_INTERNAL_SECRET`
and a `MERLT_API_KEY` in `apps/server/.env`, and put your own
`OPENROUTER_API_KEY` in `infra/.env` (left empty, MERL-T runs without model
answers).

## 4. Dependencies (once)

```bash
npm ci --prefix apps/web
npm ci --prefix apps/server
python3 -m venv services/visualex/.venv
services/visualex/.venv/bin/pip install -r services/visualex/requirements-dev.txt
services/visualex/.venv/bin/playwright install chromium
```

## 5. Start

```bash
./start.sh                      # stores in Docker; API, server and web on your Mac
MERLT_ENABLED=true ./start.sh   # also MERL-T (the first time builds images: several minutes)
```

The first start creates the databases and applies the migrations. Open
`http://localhost:5173`. Ctrl+C stops everything; the data stays in Docker's
volumes.

## 6. A development dataset (optional)

Ask the other developer for a backup folder (made by `scripts/backup.sh`) and
load it with only the stores running — before the first `./start.sh`, or with
it stopped, so nothing writes while it loads:

```bash
docker compose -f infra/compose.yml up -d --wait postgres redis falkordb qdrant
scripts/restore.sh /path/to/backup-folder
```

It refuses to overwrite data already there (`--force` replaces it) and ends
with `restore verified: counts match`. Backups contain personal data: move them
encrypted and delete them when you are done.

## 7. Check that everything works

```bash
npm --prefix apps/web run test -- --run && npm --prefix apps/web run build && npm --prefix apps/web run lint
npm --prefix apps/server run build && npm --prefix apps/server test
(cd services/visualex && .venv/bin/python -m pytest tests/ -q)
node --test '.claude/hooks/*.test.mjs'
```

## When something fails

| Symptom | Cause and fix |
|---|---|
| `Port 5000/3001/5173 in use` | Another process holds it: `kill $(lsof -t -i:5000)`. |
| `prisma migrate deploy failed` | `DATABASE_URL` in `apps/server/.env` must point at `localhost:5436`, or the stack is down: `docker compose -f infra/compose.yml ps`. |
| `Playwright Chromium missing` | `services/visualex/.venv/bin/playwright install chromium` |
| `vendor/mcp-legal-it` is empty | `git submodule update --init --recursive` |
| MERL-T not healthy after 60 s | Its first build may still be running: `docker compose -f infra/compose.yml --profile merlt logs -f merlt-api` |
| The server tests refuse to run | They need a database whose name contains `test`: `apps/server/.env.test` points at `visualex_test` on port 5436. |

Two stacks on one machine (a test next to your own): in the second checkout's
`infra/.env`, set another `VISUALEX_STACK` and other ports.
