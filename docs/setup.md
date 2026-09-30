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

They hold your own settings and keys, and are never committed. The first
`./start.sh` creates `infra/.env` and `apps/server/.env` itself when they are
missing, from their examples, the server's with a fresh JWT secret; a file that
exists is never touched. To make them by hand, or the third one:

```bash
cp infra/.env.example infra/.env
cp apps/server/.env.example apps/server/.env
cp services/visualex/.env.example services/visualex/.env
```

If you make `apps/server/.env` by hand, put a long random string in
`JWT_SECRET` (`openssl rand -base64 32`). Then, in that file, set
`ADMIN_PASSWORD` if you want an admin account seeded at start. For MERL-T, choose
a `MERLT_INTERNAL_SECRET` and a `MERLT_API_KEY` in `apps/server/.env`, and put
your own `OPENROUTER_API_KEY` in `infra/.env` (left empty, MERL-T runs without
model answers).

## 4. Dependencies (once)

The first `./start.sh` installs what is missing, and skips each step once its
result exists: the venv (`services/visualex/.venv`, made with the first of
`python3.14`, `python3.13`, `python3.12` or `python3` that is 3.12 or newer),
the Python packages, `npm ci` in `apps/server` and `apps/web`, and Playwright's
Chromium. By hand, from the repository root:

```bash
npm ci --prefix apps/web
npm ci --prefix apps/server
python3 -m venv services/visualex/.venv
services/visualex/.venv/bin/pip install -r services/visualex/requirements-dev.txt
services/visualex/.venv/bin/playwright install chromium
```

## 5. Start

```bash
./start.sh                      # = ./start.sh --dev: stores in Docker; API, server and web on your Mac
MERLT_ENABLED=true ./start.sh   # also MERL-T (the first time builds images: several minutes)
```

The first start also prepares the checkout (sections 3 and 4: allow several
minutes), creates the databases and applies the migrations. Open
`http://localhost:5173`. Ctrl+C stops everything; the data stays in Docker's
volumes.

`./start.sh --prod` is not for this machine: it builds and runs the whole stack
as containers on the deployment host (design:
`docs/superpowers/specs/2026-09-29-modular-deployment-design.md`, section 6).

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
| `Port 5000 in use` on a Mac | Usually macOS's AirPlay Receiver (`ControlCenter`), which comes back if killed: System Settings → General → AirDrop & Handoff → AirPlay Receiver off. |
| `Port 5000/3001/5173 in use` | Another process holds it: find it with `lsof -i :5000`, stop it, start again. |
| `prisma migrate deploy failed` | `DATABASE_URL` in `apps/server/.env` must point at `localhost:5436`, or the stack is down: `docker compose -f infra/compose.yml ps`. |
| `Docker is not running` | Start Docker Desktop, wait until it says it is running, `./start.sh` again. |
| An install step fails (venv, pip, `npm ci`, Chromium) | Run that command by hand (section 4), fix what it says, `./start.sh` again: a step whose result exists is skipped. |
| `vendor/mcp-legal-it` is empty | `git submodule update --init --recursive` |
| MERL-T not healthy after 60 s | Its first build may still be running: `docker compose -f infra/compose.yml --profile merlt logs -f merlt-api` |
| The server tests refuse to run | They need a database whose name contains `test`: `apps/server/.env.test` points at `visualex_test` on port 5436. |

Two stacks on one machine (a test next to your own): in the second checkout's
`infra/.env`, set another `VISUALEX_STACK` and other ports.
