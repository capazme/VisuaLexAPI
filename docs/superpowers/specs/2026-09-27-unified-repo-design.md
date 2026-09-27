# Unified VisuaLex — repository layout, git flow, shared Claude Code setup, portable data

- **Status**: draft for the owners' review
- **Date**: 2026-09-27
- **Scope**: spec 1 of 2. Spec 2 ("containers and a multi-node beta") follows it
  and is listed in §11 only to say what this spec leaves out.

## 1. Context

Until 26 September 2026 the repository had two long-lived lines:

- `main` — "vanilla", deployed to a production server and tagged `vX.Y.Z` at
  each deploy. Last release `v1.7.8`; `main` is at `a1d67a0` (v1.7.8 plus the
  shared Prisma client).
- `visualex-merlt-main` — the MERL-T experiment (knowledge graph, experts,
  RLCF), never deployed, absorbing `main` one way, by tag
  (`docs/git-workflow.md`). The merge of `v1.7.8` into it is staged in the
  worktree `../VisuaLexAPI-merlt`, resolved and verified, not committed.

Three things changed that day:

1. **The owners decided to unify the two lines into one product** (decision log
   D-016). MERL-T code enters the product; no feature of the first release may
   depend on the MERL-T experts, and data structures are designed to host them.
2. **The production server was decommissioned.** There is no production.
   Development is local; a closed beta will later run on the owners' own
   machines (spec 2).
3. **A second developer joins**, working on the whole repository with Claude
   Code, without the first developer's personal hooks, memories or global
   instructions.

The branch model after unification was left open in the decision log (A8).
This spec closes it.

## 2. Goals and non-goals

**Goals**

- **G1** — One product line. Nothing from either branch is lost unless this
  spec retires it by name (§3.3).
- **G2** — A monorepo layout with one home per component (§3).
- **G3** — A git flow for two developers, enforced by GitHub rather than by
  personal hooks (§4).
- **G4** — Claude Code behaves the same for both developers: layered
  `CLAUDE.md`, shared settings and hooks in the repository (§5).
- **G5** — Data that is portable and backupable: every store exported and
  imported with its native tool, stable names, pinned versions, one Postgres
  (§6).
- **G6** — The second developer goes from `git clone` to a running stack and
  green suites by following one guide (§5.5, §8 step 8).

**Non-goals** (spec 2 or later)

- Container images for the Python API, the server and the web app; images built
  by CI; deployment on several machines; reverse proxy; scheduled offsite
  backups; release gates and rollback (decision log A7, A9).
- Product work: new modules and their data models get their own specs.
- Renaming the repository (it stays `VisuaLexAPI`, public, on the owner's
  account; no transfer before the ownership review) and any licence change.

## 3. Repository layout

### 3.1 Target tree

```
apps/
  web/                    React + Vite: reader, dossier, forum, graph
  server/                 Express + Prisma: accounts, dossier, community, MERL-T gateway
services/
  visualex/               Python API: sources, reading text, URNs, citations
    app.py
    visualex_api/         (package name unchanged: no import changes)
    tests/
    pytest.ini
    requirements.txt, requirements-dev.txt
  merlt/                  MERL-T + RLCF — keeps its own LICENSE (Apache-2.0)
tools/
  archivio-normativo/     the archive CLI
    archivio_normativo/   (package name unchanged)
    tests/                (from tests/archivio/)
    requirements-archivio.txt
  e2e/                    end-to-end and stress harness
vendor/
  mcp-legal-it/           git submodule, unchanged
infra/
  compose.yml             the development stack (§6)
  .env.example
  postgres/init/          database and role creation
scripts/
  backup.sh, restore.sh   portable data (§6.4)
  merlt-live-smoke.sh
docs/
  README.md               index
  git-workflow.md         rewritten (§4)
  setup.md                new: from clone to running stack (§5.5)
  archive/                retired material
  merlt/, superpowers/    unchanged
start.sh                  one command for the whole development stack
CLAUDE.md                 short root (§5.1)
.claude/settings.json     shared Claude Code rules (§5.2)
.github/                  CI, CODEOWNERS
LICENSE                   unchanged (MIT)
```

`apps/server` is named for what it is, so it is not confused with the Python
API in `services/visualex`.

### 3.2 Moves

| From (unified tree) | To |
| --- | --- |
| `frontend/` | `apps/web/` |
| `backend/` | `apps/server/` |
| `app.py`, `visualex_api/`, `tests/` (minus `tests/archivio/`), `pytest.ini`, `requirements.txt`, `requirements-dev.txt` | `services/visualex/` |
| `merlt/` | `services/merlt/` |
| `archivio_normativo/`, `tests/archivio/`, `requirements-archivio.txt` | `tools/archivio-normativo/` |
| `e2e/` | `tools/e2e/` |
| `docker-compose.merlt.yml`, `.env.merlt.example` | `infra/compose.yml`, `infra/.env.example` (reworked, §6) |

`vendor/mcp-legal-it`, `scripts/`, `docs/`, `.github/`, `LICENSE`, `README.md`,
`SECURITY.md`, `version.txt` keep their place.

### 3.3 Retired (they stay in git history)

| Item | Why |
| --- | --- |
| `deploy.sh`, `start-quart.sh` | Scripts for the decommissioned server (`start-quart.sh` is not called by anything and points at server paths). |
| `docs/deployment.md` | Moves to `docs/archive/`: history of the old deploy and its known gaps, input for spec 2. |
| root `package-lock.json` | An empty stub (`"packages": {}`); no root package exists. |
| `VisuaLexAPI.code-workspace` | A personal editor file pointing outside the repository. Added to `.gitignore`. |
| `bmad/`, `docs/sprint-status.yaml` | The closed BMAD cycle. Moved to `docs/archive/`. |
| `data/codice_civile_articoli.txt`, `data/costituzione_articoli.txt` | Nothing in the code reads them (checked by search); removed after a last check in step 3. |

### 3.4 Path references to fix

A search of the unified tree found the fixed paths that a move breaks:
`start.sh`, the Compose file, `.github/workflows/ci.yml`,
`services/merlt/api-contract.json` (front-end consumer paths),
`scripts/merlt-live-smoke.sh`, `merlt/Dockerfile` and `merlt/pyproject.toml`,
two Python tests that build paths from `__file__`
(`tests/test_egress_allowlist.py`, `tests/archivio/test_manifest.py`), the
reader of `version.txt` in `app.py`, and the documentation. No Python or
TypeScript import crosses a top-level folder, so each component moves as a
unit.

## 4. Git flow

### 4.1 Branches

- **`main`** — the released version: what testers get once the beta exists.
  It receives only release pull requests from `develop` and `hotfix/…`
  branches. Every release is tagged `vX.Y.Z`; the first is `v2.0.0`, the
  unified product.
- **`develop`** — where work integrates. GitHub's default branch, so new pull
  requests target it.
- **Short branches** — `feat/…`, `fix/…`, `refactor/…`, `chore/…`, `docs/…`
  start from `develop` and return to it by pull request. A branch rebases on
  `develop` when `develop` moves; it never merges `develop` in.
- **`hotfix/…`** — starts from `main`, returns to `main` by pull request;
  `main` is then merged into `develop` at once.
- **No other long-lived branch.** Experimental work sits behind flags, as
  MERL-T already does (`MERLT_ENABLED` and the per-area flags). A research
  branch is created only if unavoidable and never holds a security fix
  (decision log A8).
- `visualex-merlt-main` becomes the tag `archive/visualex-merlt-main` and the
  branch is deleted. The permanent worktree `../VisuaLexAPI-merlt` retires:
  one checkout.

This supersedes the "no `dev` branch" section of the current
`docs/git-workflow.md`. Its three reasons no longer hold as written: `dev` died
as an echo of `main` with one developer — now there are two, and
`develop → main` is a real step, the release to testers; three long-lived
branches meant two synchronisation directions — `merlt` disappears, and the
only way back (hotfix into `develop`) is checked automatically (§4.4); a `dev`
nobody deploys is a queue — true while there is no test environment, answered
by small, frequent releases.

### 4.2 Pull requests

- Nothing reaches `main` or `develop` except through a pull request: no direct
  push, no force-push, no branch deletion.
- CI must be green (§7). The author merges their own pull request.
- Merge style: merge commits only (squash and rebase merges disabled), titled
  as today: `merge: <branch> — <what changes>`. Merged branches are deleted
  automatically.
- **Code owners.** A pull request that touches one of these paths needs the
  approval of the other developer:

| Area | Paths |
| --- | --- |
| Authentication and tokens | `apps/server/src/middleware/auth.ts`, `apps/server/src/controllers/authController.ts`, `apps/server/src/utils/jwt.ts` |
| Database schema and migrations | `apps/server/prisma/**` |
| Licences | `LICENSE`, `services/merlt/LICENSE` |
| CI and repository settings | `.github/**` (including `CODEOWNERS`) |
| Infrastructure and data scripts | `infra/**`, `scripts/backup.sh`, `scripts/restore.sh` |
| Shared Claude Code rules | `.claude/settings.json`, `.claude/hooks/**` |
| Reading text extraction | `services/visualex/visualex_api/services/normattiva_scraper.py` — its output is the offset space every stored highlight and note is anchored to; one changed space deletes the anchors after it, for every user, silently |

- The code-owner rule holds on both branches, so a `hotfix/…` that touches one
  of these paths is reviewed too. A release pull request that carries such
  changes therefore also needs the other developer's approval — one approval
  per release, which suits a release.
- The rules apply to everyone, repository owner included. In an emergency the
  owner suspends them from the repository settings and restores them the same
  day.

### 4.3 Releases

A release is a pull request `develop → main`, merged with a merge commit, then
tagged `vX.Y.Z` on `main`; `version.txt` is bumped in the same pull request.
How a tag reaches the beta machines is spec 2.

### 4.4 Automatic checks (in addition to the test suites)

- **Release source** — a pull request into `main` fails unless its head is
  `develop` or `hotfix/…`.
- **`main` inside `develop`** — the CI of `develop` fails if `main` has a commit
  `develop` lacks. A forgotten hotfix back-merge becomes a red check, not a fix
  stranded for weeks.

### 4.5 Where work strands

Unchanged in spirit from the current document: a Claude Code web session's
`claude/…` branch is either opened as a pull request into `develop` or deleted
within days; desktop worktrees under `.claude/worktrees/` are removed once their
work has landed, after checking for untracked files.

## 5. Shared Claude Code setup and documentation

### 5.1 Layered `CLAUDE.md`

The unified root `CLAUDE.md` is 2,050 lines, loaded whole in every session.
It becomes:

- **Root, about 200 lines**: what the project is; the layout map; the commands
  that start and test each area; the git flow in brief (pointing to
  `docs/git-workflow.md`); the verification gates before calling work done;
  the few constraints that cross areas (above all: `article_text` is the
  offset contract shared by the Python API, the server and the web app).
- **One `CLAUDE.md` per area** — `apps/web/`, `apps/server/`,
  `services/visualex/`, `services/merlt/` (exists) — holding that area's
  architecture, conventions and gotchas, taken from today's root file. Claude
  Code loads an area file only when it works in that folder.
- **Nothing about private material**: the repository is public. No private
  decision-log text, no infrastructure addresses, no personal paths. Pointers
  to private notes live in each developer's personal `CLAUDE.md`.

The rule that opens today's file stays: a statement the code contradicts is
fixed in the same change that found it.

### 5.2 Shared rules — `.claude/settings.json` (checked in)

Hooks in `.claude/hooks/`, applied to any Claude Code session in the
repository:

- block `git commit` while `main` or `develop` is checked out (work happens on
  a branch; Claude creates it);
- block `git push` to `main` or `develop` and any force-push to them (GitHub
  refuses them too; the hook says so before the round trip);
- block `prisma migrate dev` and `prisma migrate reset` against the
  development database: `migrate dev` offers to reset a drifted database and a
  non-interactive agent can accept. The message points to the documented
  procedure (hand-written migration, `prisma migrate deploy`).

Permissions: reading or editing `.env` files is denied; the `.env.example`
files are not.

`.gitignore` gains `CLAUDE.local.md`, `.claude/settings.local.json` and
`*.code-workspace`, so personal files are never committed by mistake.

### 5.3 Knowledge that moves from personal notes into the repository

- The Prisma migration procedure and why `migrate dev` is dangerous here →
  `apps/server/CLAUDE.md`.
- Backend tests: only through `npm test` (the setup refuses a non-test
  database); the test harness history (fetch shim instead of nock, one
  persistent server, bound to `127.0.0.1` — the last cause of intermittent
  failures on macOS) → `apps/server/CLAUDE.md`.
- The history of the old two-branch model → a short section of
  `docs/git-workflow.md`.

### 5.4 `docs/`

`docs/README.md` indexes the folder. `docs/git-workflow.md` is rewritten for
§4. Retired material goes to `docs/archive/` (§3.3).

### 5.5 `docs/setup.md` — from clone to running stack

Prerequisites (macOS, Docker Desktop, Node, Python, git), clone with the
submodule, the `.env` files to create from the examples, the one-off steps
(dependencies, Playwright's Chromium, database migrations), `./start.sh`,
restoring a development dataset (§6.4), running each suite, where each
developer puts their own model API keys (never in the repository), and what to
do when a step fails. The guide is correct only if §8 step 8 passes.

## 6. Docker and data (development; the foundation for the beta)

### 6.1 One Compose stack

`infra/compose.yml` replaces `docker-compose.merlt.yml`:

- **A fixed project name** (top-level `name:`) and **explicitly named
  volumes**. Today the volumes take their name from the Compose project; a
  file moved to another folder would start on empty volumes.
- **Pinned image versions.** FalkorDB and Qdrant run `latest` today; a restore
  on a new machine could pull a version that cannot read the saved data. Pins
  start from the versions running now (Qdrant 1.17.1; FalkorDB read from the
  running container in step 4).
- **One Postgres 16** instead of two (the server's local Postgres 14 and
  MERL-T's 16): one database per component (`visualex_platform`,
  `visualex_test`, the MERL-T database) and one role each, created by
  `infra/postgres/init/`. Published on a host port that does not collide with
  a locally installed Postgres.
- Redis, FalkorDB, Qdrant, mcp-legal-it, the MERL-T API and worker as today.
- In development the Python API, the server and the web app keep running on
  the host with hot reload; running them in containers is spec 2.

### 6.2 Where data lives

Named volumes by default (the right choice on macOS). One variable,
`VISUALEX_DATA_DIR`, switches every store to bind mounts under a chosen
directory — on a server, a disk picked for the databases.

### 6.3 Addresses are configuration

Every component reads its peers from environment variables (`DATABASE_URL`,
`LEGAL_API_URL`, `MERLT_API_URL`, the MERL-T store hosts, …), never from
hard-coded hostnames. On one machine they point at Compose service names; in
the beta, at other machines on the private network (spec 2). A place that still
hard-codes a peer is fixed in step 4.

### 6.4 Backup and restore

Data moves by export and import, never by copying a database's files.

- `scripts/backup.sh` writes one dated folder:
  - Postgres: `pg_dump -Fc`, one file per database;
  - FalkorDB: a `BGSAVE` snapshot, copied out;
  - Qdrant: a snapshot per collection, through its API;
  - uploaded files and the MERL-T model artefacts (checkpoints, NER models);
  - `manifest.json`: time, image versions, schema versions, a sha256 per file.

  Excluded: Redis (cache and queue, rebuilt) and the model download cache
  (re-downloadable).
- `scripts/restore.sh <folder>` checks the manifest and loads everything, or
  the stores named, into a stack. It refuses to overwrite a non-empty store
  without `--force`.
- The same pair moves data between machines, gives the second developer a
  development dataset, and recovers from a failure.
- Backups contain personal data (accounts, notes, uploads). In the beta they
  are encrypted and kept for a fixed period, so that a deleted account
  disappears from backups when the period ends (spec 2 sets the period and the
  schedule).

### 6.5 Moving today's development data

Today's data (the server's local Postgres 14, the MERL-T volumes
`visualexapi_merlt_*`) moves into the new stack **with `backup.sh` and
`restore.sh`**, their first real run. Counts are compared store by store
(tables and rows, graph nodes and edges, vector points, files). The old
volumes and the old database are left untouched until the owner confirms the
restore is complete. An older duplicate set of volumes (`visualexapi-merlt_*`)
is left alone; deleting it is the owner's call.

## 7. CI

- Triggers: every pull request into `develop` or `main`, every push to them.
- Jobs, always run (GitHub Actions is free for public repositories):
  `services/visualex` (pytest on Python 3.12 and 3.14), `apps/web` (tests,
  build — the real type-check —, lint), `apps/server` (tests against a Postgres
  service), `services/merlt` (pytest on Python 3.11 against a Postgres service,
  no longer limited to the old experiment branch).
- The two checks of §4.4.
- Required status checks on both branches: every job above.
- The weekly dependency audit stays, on `develop` and `main`.

## 8. Sequence of work

Each step ends with every suite green; none starts before the previous one is
done.

1. **Settle the pending work.** Land the test-server fix on `main`. In the
   worktree `../VisuaLexAPI-merlt`: commit the staged merge of `v1.7.8`, then
   merge `main` (the shared Prisma client and the test fix; about six small
   conflicts expected, all in `index.ts`, `app.ts` and one controller). Run
   the four suites (web, server, Python API, MERL-T). The MERL-T suite writes
   rows: it runs against a disposable database, never the development stack's
   (its own `CLAUDE.md` gives the procedure), or in CI.
2. **Create `develop`** from the unified commit and push it. Tag and delete
   `visualex-merlt-main`. Retire the worktree once the Compose stack has moved
   (step 4 moves it; until then it keeps running from there).
3. **Reorganise the folders** on a branch from `develop`: first a commit made
   only of moves, so that every file's history can still be followed; then the
   path fixes of §3.4. Retire the items of §3.3.
4. **Docker and data**: `infra/compose.yml` as in §6.1–6.3, `backup.sh` and
   `restore.sh`, then move today's data (§6.5).
5. **Rules and documents**: layered `CLAUDE.md`, `.claude/settings.json` and
   hooks, `CODEOWNERS`, `docs/setup.md`, the rewritten `docs/git-workflow.md`,
   `docs/archive/`.
6. **GitHub**: `develop` as default branch; rulesets on `main` and `develop`
   (§4.2); merge commits only; automatic branch deletion; CI as in §7. First
   verify that GitHub requires the code owners' approval on their paths while
   requiring no approval elsewhere; if it cannot, the owner chooses between one
   approval on every pull request and a CI check that enforces the code-owner
   rule. The owner adds the second developer as a collaborator.
7. **Release `v2.0.0`**: pull request `develop → main`, tag.
8. **The second developer's test**: a clean clone in an empty folder,
   following only `docs/setup.md`, including a dataset restore. If the stack
   does not start or a suite fails, the guide is wrong and is fixed before the
   second developer starts.

The three pieces of work paused on the old `main` (the account export, the
moderation view for discussion reports, the database error in the login
middleware) restart after step 7, on `develop`.

## 9. Verification

- **Nothing lost** — a script lists every file of the unified tree before step
  3 and checks that each is either at its new path (§3.2) or retired by name
  (§3.3).
- **History** — the move commit contains moves only; `git log --follow` on a
  sample of files in each area crosses it.
- **Data** — the restore of §6.5 matches the counts of the source.
- **Suites** — web (tests, build, lint), server, Python API, MERL-T, locally
  and in CI.
- **Onboarding** — §8 step 8.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Data loss while the stack moves | Backup first; restore into new volumes; old volumes kept until confirmed (§6.5). |
| A broken path after the move | Known reference list (§3.4); moves and fixes in separate commits; four suites and CI. |
| `develop` becomes a queue | Small, frequent releases. |
| A hotfix never reaches `develop` | The `main`-inside-`develop` check (§4.4). |
| GitHub cannot enforce code owners without general approvals | Verified in step 6 before relying on it; fallback chosen by the owner. |
| Private material in a public repository | §5.1 rule; code owners on `.claude/`; review of every document written in steps 3–5. |
| Postgres on macOS bind mounts is slow | Named volumes by default (§6.2). |
| The licence boundary blurs | `services/merlt/LICENSE` moves with its code; `LICENSE` unchanged; no licence text is edited. |

## 11. Out of scope — spec 2

Dockerfiles for `services/visualex`, `apps/server` and `apps/web`; the stack
split by role (data, application, HTTPS proxy) and joined over a private
network, with each machine starting the parts assigned to it; images built by
CI at each release for ARM and x86 and pulled by version, so that rolling back
means pulling the previous one; scheduled encrypted backups to a second site
with periodic restore tests; release gates and rollback (decision log A7, A9).
One constraint is already known: a database and the application that queries it
stay on the same machine, or at least on the same site.
