# Unified VisuaLex — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge vanilla and MERL-T into one product line, reorganise the repository into a monorepo, move to a `main` + `develop` git flow enforced by GitHub, give both developers the same Claude Code rules, and make every data store portable through native export and import.

**Architecture:** The unification is a git merge in the existing MERL-T worktree; `develop` is born from it. The monorepo layout is reached by one commit of pure moves followed by path fixes. Data stores run in one Compose stack with a fixed project name, pinned images and one Postgres; a small stdlib-only Python tool (`scripts/datakit`) exports and imports each store with its native mechanism and checks counts. Shared rules live in `.claude/settings.json` (a Node hook) and in GitHub rulesets plus `CODEOWNERS`.

**Tech Stack:** git, GitHub (rulesets, Actions, `gh`), Docker Compose v2, Postgres 16, FalkorDB, Qdrant 1.17.1, Redis 7, Python 3.12+ (stdlib + pytest), Node 24 (`node:test`), Bash.

**Spec:** `docs/superpowers/specs/2026-09-27-unified-repo-design.md`

## Global Constraints

- The repository stays `capazme/VisuaLexAPI`, public, on the owner's account. No rename, no licence change: `LICENSE` (MIT) and `services/merlt/LICENSE` (Apache-2.0) are moved, never edited.
- Branches: `main` = released; `develop` = default and integration; short branches `feat/`, `fix/`, `refactor/`, `chore/`, `docs/` from `develop`; `hotfix/` from `main`.
- Merge commits only, titled `merge: <branch> — <what changes>`.
- Commits: each message below is the one to use. The owner's global rule applies — commit and push only with the owner's authorization for this plan (asked at hand-off); without it, stop at every commit and ask.
- Nothing private enters the repository: no text from the owners' private notes, no infrastructure addresses, no personal paths (`/Users/…`), no personal names. Refer to "the second developer".
- Python package names do not change: `visualex_api`, `archivio_normativo`, `e2e`.
- One Postgres 16 with databases `visualex_platform`, `visualex_test`, `merlt`; Qdrant `qdrant/qdrant:v1.17.1`; FalkorDB pinned by the digest of the image cached today.
- Compose project name fixed by the top-level `name:`, default `visualex`; `VISUALEX_STACK` names a throwaway stack. A throwaway stack also needs its own ports.
- Data moves by export and import only. This plan never deletes the volumes `visualexapi_merlt_*`, `visualexapi-merlt_*` or the host Postgres database `visualex_platform`; deleting them is the owner's call after the plan.
- The MERL-T test suite never runs against the development stack's database (CI, or a disposable database).
- Claude cannot read or edit `.env` files (the owner's hook). Every step that creates, moves or edits one is an **owner step**.
- Before calling a task done: the suites of the areas it touches, green — web (`npm run test -- --run`, `npm run build`, `npm run lint`), server (`npm run build`, `npm test`), Python API (`python -m pytest tests/ -q`), MERL-T (CI or disposable database).

## Review Focus

1. **The stack started from another folder must find the same data.** Starting `infra/compose.yml` from the main checkout after Task 16 shows the migrated graph (node count equal to Task 9's), not an empty one. Pinned by Task 16, Step 7.
2. **A restore over a non-empty store without `--force` must refuse and change nothing.** Pinned by the roundtrip test in Task 8.
3. **FalkorDB restored with append-only persistence on must not come back empty after a restart** (Redis ignores `dump.rdb` when append-only is on and no AOF exists). Pinned by the roundtrip test in Task 8, which restarts the container after the restore and counts again.
4. **The shared hook must not block ordinary work**: commits on feature branches, `git push -u origin feat/x`, `--force-with-lease` on one's own branch, pushing a tag, `git log main..develop`. Pinned by the "allowed" cases in Task 10.
5. **The moved `.env` files must never be committable**: `apps/server/.env`, `services/visualex/.env`, `infra/.env`, `CLAUDE.local.md`. Pinned by the `git check-ignore` step in Task 10.

## Working directories

- `MAIN` — the absolute path of the main checkout (`VisuaLexAPI/`), on `main` until Task 16. Set it once: `MAIN="$(git -C <your checkout> rev-parse --show-toplevel)"`.
- `WT="$(cd "$MAIN/../VisuaLexAPI-merlt" && pwd)"` — the MERL-T worktree beside it. Tasks 2–15 run here.
- `WORK="${TMPDIR:-/tmp}/visualex-unify"` — throwaway files (`mkdir -p "$WORK"` before first use).

Shell harness note: a leading `cd` can be ignored; use `git -C`, `npm --prefix` or absolute paths.

---

## Phase 1 — Settle the pending work

### Task 1: Land the test-server fix and the spec on `main`

The last change made under the old flow. `fix/test-server-loopback` exists (created from `83bd9c8`); its one-line change may still be uncommitted in a scratch worktree, or lost.

**Files:**
- Modify: `backend/tests/helpers.ts:15-16`

- [ ] **Step 1: Put the change on the branch**

```bash
LOOP=$(git -C "$MAIN" worktree list | awk '/\[fix\/test-server-loopback\]/ {print $1}')
if [ -z "$LOOP" ]; then LOOP="$WORK/loopback"; git -C "$MAIN" worktree add "$LOOP" fix/test-server-loopback; fi
echo "$LOOP"
```

In `$LOOP/backend/tests/helpers.ts`, the persistent server must read:

```ts
// the listener never keeps the test process alive at teardown.
//
// Bound to 127.0.0.1, the address supertest dials. On macOS a wildcard listen
// can be given a port another local process holds on 127.0.0.1 alone, and the
// kernel then hands that process the suite's requests: a dev tool answering
// 403 failed `sharedEnvironments.publish` once in eight runs. A loopback bind
// cannot share its port that way.
const app = expressApp.listen(0, '127.0.0.1');
```

- [ ] **Step 2: Run the server suite on the branch**

```bash
[ -e "$LOOP/backend/node_modules" ] || ln -s "$MAIN/backend/node_modules" "$LOOP/backend/node_modules"
npm --prefix "$LOOP/backend" test
```

Expected: `Test Files 13 passed`, `Tests 65 passed`.

- [ ] **Step 3: Commit**

```bash
git -C "$LOOP" add backend/tests/helpers.ts
git -C "$LOOP" commit -F - <<'EOF'
fix(tests): bind the backend test server to 127.0.0.1

supertest dials 127.0.0.1, but the suite's persistent server listened on
the wildcard address. On macOS a wildcard listen can be given a port that
another local process holds on 127.0.0.1 alone, and the kernel then routes
the suite's requests to that process: a local dev tool answering 403 failed
sharedEnvironments.publish once in eight runs. Reproduced with two plain
http servers; a loopback bind gets EADDRINUSE instead, so port 0 picks a
free one. The Linux CI never showed it.

Verified: npm test in backend/ (13 files, 65 tests).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 4: Merge both branches into `main`, verify, push**

```bash
git -C "$MAIN" merge --no-ff docs/unified-repo-spec -m "merge: docs/unified-repo-spec — spec and plan for the unified repository" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C "$MAIN" merge --no-ff fix/test-server-loopback -m "merge: fix/test-server-loopback — the backend test server binds the address supertest dials" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm --prefix "$MAIN/backend" test
```

Expected: `Tests 67 passed`. Then:

```bash
git -C "$MAIN" push origin main
git -C "$MAIN" branch -d fix/test-server-loopback docs/unified-repo-spec
git -C "$MAIN" worktree prune
```

### Task 2: Commit the staged merge of `v1.7.8` into MERL-T

**Files:** the staged merge in `$WT` (verified: web 1343 tests, server 497, Python 984).

- [ ] **Step 1: Check the staged state is intact**

Run: `git -C "$WT" status --short | grep -v '^[MADR] '` → no output; `git -C "$WT" rev-parse --verify -q MERGE_HEAD` → prints a hash.

- [ ] **Step 2: Commit with the reviewed message**

```bash
git -C "$WT" commit -F - <<'EOF'
merge: v1.7.8 — vanilla 1.7.8 into merlt

Three releases of main (1.7.6 to 1.7.8, 74 commits, base v1.7.5): the
normative archive and its API extensions (recitals, AKN fingerprints,
consolidated EUR-Lex texts, article-number forms), saved-norm change
tracking, article discussions, dossier snapshots, account export and
deletion, the health banner, deep links, search filters, document review,
and the structured reading surface (round A) with its review. 11
conflicted files; main changed no package manifest, so no lockfile moved.

Resolutions worth knowing:
- urngenerator.py: main's, whole. merlt emitted ~art2-bis since June
  (faeeb71); main emits ~art2bis, ~art270bis.1, ~art135sexdecies,
  verified live against Normattiva. This also fixes a MERL-T mismatch:
  the graph keys bis articles concatenated (seed ~art30bis, mechanical
  ingestion) and normalizeGraphUrn strips only the version marker, so the
  hyphenated form never found its node. No ingestion job (0 of 101) and
  no graph node in the dev data carries the hyphenated form: nothing to
  backfill.
- normattiva_scraper.py: identical to v1.7.8, _estrai_testo_* included.
- Prisma: the two conflicted controllers keep merlt's lib/prisma
  singleton, and the three files main brought with a client of their own
  (normaWatcher, articleDiscussionController, the health check in app.ts)
  use it too, so the shutdown's $disconnect covers every query.
- index.ts: merlt's watchdog and graceful shutdown plus main's saved-norm
  watcher, whose interval the shutdown clears as well.
- schema.prisma: DossierItemStatus (merlt) beside DossierSnapshot (main);
  main's two migrations sort before 20260925150000 and apply cleanly on a
  reset database.
- sanitize.tsx: merlt's split kept; main's role/tabindex allowance moved
  into sanitizeHtml.ts, and articleRender.test.ts imports from there.
- App, Layout, Sidebar: unions. Nav order: Forum, Analizza documento,
  Cronologia (saved-norm badge), Assistente, Grafo. Sidebar.test's
  expected href lists gain /documents; its invariants are unchanged.
- CLAUDE.md: main's text plus the MERL-T sections. deploy.sh: main's plus
  the --merlt flags, all after the step-0 guard.

Verified on the result: frontend 1343 tests, build, lint; backend + BFF
497 tests, build; Python 984. MERL-T Python: no file under merlt/ changes
and its suite reads nothing outside it; green in CI on 9c0fd07.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C "$WT" log --oneline -1
```

### Task 3: Unify — merge `main` into the MERL-T line

**Files (expected conflicts):**
- `backend/src/index.ts` (4 blocks)
- `backend/src/app.ts` (1 block)
- `backend/src/controllers/sharedEnvironmentController.ts` (1 block)

- [ ] **Step 1: Merge**

```bash
git -C "$WT" fetch origin
git -C "$WT" merge --no-ff --no-commit origin/main
git -C "$WT" diff --name-only --diff-filter=U
```

- [ ] **Step 2: Resolve `backend/src/index.ts`**

Keep MERL-T's imports, `envMs`, the watchdog block and `let normaWatcherInterval` / `const server = app.listen(...)`. The shutdown function becomes, whole:

```ts
// Graceful shutdown: stop the MERL-T watchdog and the saved-norm watcher,
// drain in-flight requests, release the Prisma connection pool, then exit.
// Idempotent across repeated signals. A watcher run already under way is cut
// short, which is safe: each of its writes is atomic, and the next run starts
// again from the least recently seen watch.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing server...`);
  if (watchdogInterval) clearInterval(watchdogInterval);
  if (normaWatcherInterval) clearInterval(normaWatcherInterval);
  server.close(() => {
    prisma
      .$disconnect()
      .catch((err) => console.error('[shutdown] prisma disconnect failed:', err))
      .finally(() => process.exit(0));
  });
  // close() drops the idle keep-alive sockets only once. A socket that was
  // mid-request stays open for the whole keep-alive timeout (~6 s) after its
  // answer: drop each one as soon as it goes idle.
  setInterval(() => server.closeIdleConnections(), 100).unref();
  // Handling the signal replaces Node's own exit and repeats are ignored, so a
  // request or a disconnect that never ends must not keep the process alive.
  setTimeout(() => {
    console.error('[shutdown] still running after 10 s, forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 3: Resolve `app.ts` and `sharedEnvironmentController.ts`**

Take the MERL-T side of each import block (both already import `prisma` from `./lib/prisma` / `../lib/prisma`). Then: `grep -rn "new PrismaClient" "$WT/backend/src"` → only `backend/src/lib/prisma.ts`.

- [ ] **Step 4: Check the auto-merged files that matter**

```bash
grep -n "runNormaWatcher().catch" "$WT/backend/src/utils/normaWatcher.ts"   # main's .catch arrived
grep -c "^<<<<<<<\|^>>>>>>>" -r "$WT/backend/src" "$WT/frontend/src" "$WT/docs" "$WT/CLAUDE.md" | grep -v ":0$"   # no output
```

- [ ] **Step 5: Run the vanilla and server suites**

```bash
npm --prefix "$WT/backend" run build && npm --prefix "$WT/backend" test
npm --prefix "$WT/frontend" run test -- --run && npm --prefix "$WT/frontend" run build && npm --prefix "$WT/frontend" run lint
( cd "$WT" && .venv/bin/python -m pytest tests/ -q )
```

Expected: server ≥ 499 tests passed (497 + `prismaClient` + watcher tests), web 1343, Python 984 passed / 6 deselected, all exit 0.

- [ ] **Step 6: Commit and push; let CI run the MERL-T suite**

```bash
git -C "$WT" add -A backend/src
git -C "$WT" commit -F - <<'EOF'
merge: main — the shared Prisma client and the loopback test server into merlt

main after v1.7.8: one PrismaClient for the whole backend with a graceful
shutdown that drops keep-alive sockets as they go idle, a watcher run that
cannot crash the server, and the backend test server bound to 127.0.0.1.
index.ts keeps merlt's job watchdog and stops both timers on shutdown;
app.ts and sharedEnvironmentController.ts keep merlt's imports, which
already used the shared client.

Verified: web 1343 tests, build, lint; server build and tests; Python API.
The MERL-T suite runs in CI on this push.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C "$WT" push origin visualex-merlt-main
gh run list --repo capazme/VisuaLexAPI --branch visualex-merlt-main --limit 1
```

Expected: the run for this commit ends `success`, including the job `MERL-T python tests`. Check it once when it finishes; do not poll in a loop.

---

## Phase 2 — `develop`

### Task 4: Create `develop` and retire `visualex-merlt-main`

**Files:**
- Modify: `.github/workflows/ci.yml` (triggers and the MERL-T job condition)

- [ ] **Step 1: Create the branch in the worktree**

```bash
git -C "$WT" switch -c develop visualex-merlt-main
```

- [ ] **Step 2: Let CI run on `develop`**

In `.github/workflows/ci.yml`, both `branches: [main, visualex-merlt-main]` lines become `branches: [main, develop]`, and the MERL-T job's condition becomes:

```yaml
    if: github.ref == 'refs/heads/develop' || github.base_ref == 'develop'
```

- [ ] **Step 3: Commit (bootstrap exception: no protection exists yet) and push**

```bash
git -C "$WT" commit -am "ci: run the suites on develop" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C "$WT" push -u origin develop
```

- [ ] **Step 4: Archive and delete the old branch**

```bash
git -C "$WT" tag -a archive/visualex-merlt-main visualex-merlt-main -m "The MERL-T line before it became develop (27 Sep 2026)"
git -C "$WT" push origin archive/visualex-merlt-main
git -C "$WT" branch -d visualex-merlt-main
git -C "$WT" push origin --delete visualex-merlt-main
git -C "$MAIN" fetch --prune
```

Expected: `git -C "$MAIN" branch -r` lists `origin/main` and `origin/develop` only; `git -C "$MAIN" ls-remote --tags origin archive/visualex-merlt-main` prints one line.

---

## Phase 3 — Reorganise the folders

### Task 5: One commit of pure moves

`git mv` of a directory renames it on disk, so ignored contents (`node_modules`, `dist`, `.venv`, `apps/server/.env`) travel with it and need no reinstall.

**Files:**
- Create: `$WORK/inventory.py` (throwaway, not committed)
- Move: see Step 3

- [ ] **Step 1: Branch and snapshot the file list**

```bash
mkdir -p "$WORK"
git -C "$WT" switch -c refactor/monorepo-layout develop
git -C "$WT" ls-files > "$WORK/before.txt"
```

- [ ] **Step 2: Write the inventory checker**

`$WORK/inventory.py`:

```python
"""Every path of before.txt must be at its new path or retired by name."""
import sys
from pathlib import Path

PREFIXES = [  # longest first: tests/archivio/ before tests/
    ("tests/archivio/", "tools/archivio-normativo/tests/"),
    ("frontend/", "apps/web/"),
    ("backend/", "apps/server/"),
    ("merlt/", "services/merlt/"),
    ("visualex_api/", "services/visualex/visualex_api/"),
    ("tests/", "services/visualex/tests/"),
    ("archivio_normativo/", "tools/archivio-normativo/archivio_normativo/"),
    ("e2e/", "tools/e2e/"),
    ("bmad/", "docs/archive/bmad-config/"),
]
FILES = {
    "app.py": "services/visualex/app.py",
    "pytest.ini": "services/visualex/pytest.ini",
    "requirements.txt": "services/visualex/requirements.txt",
    "requirements-dev.txt": "services/visualex/requirements-dev.txt",
    ".env.example": "services/visualex/.env.example",
    "requirements-archivio.txt": "tools/archivio-normativo/requirements-archivio.txt",
    "docker-compose.merlt.yml": "infra/compose.yml",
    ".env.merlt.example": "infra/.env.example",
    "docs/deployment.md": "docs/archive/deployment-lightsail.md",
    "docs/sprint-status.yaml": "docs/archive/sprint-status.yaml",
}
RETIRED = {
    "deploy.sh", "start-quart.sh", "package-lock.json", "VisuaLexAPI.code-workspace",
    "data/codice_civile_articoli.txt", "data/costituzione_articoli.txt",
}


def new_path(old: str) -> str:
    if old in FILES:
        return FILES[old]
    for src, dst in PREFIXES:
        if old.startswith(src):
            return dst + old[len(src):]
    return old


def main(before: Path, after: Path) -> int:
    present = set(after.read_text().split())
    lost = [p for p in before.read_text().split()
            if p not in RETIRED and new_path(p) not in present]
    for p in lost:
        print(f"LOST {p} -> expected {new_path(p)}")
    print(f"{len(lost)} lost")
    return 1 if lost else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]), Path(sys.argv[2])))
```

- [ ] **Step 3: Move**

```bash
mkdir -p "$WT/apps" "$WT/services/visualex" "$WT/tools/archivio-normativo" "$WT/infra"
git -C "$WT" mv frontend apps/web
git -C "$WT" mv backend apps/server
git -C "$WT" mv merlt services/merlt
git -C "$WT" mv tests/archivio tools/archivio-normativo/tests
git -C "$WT" mv app.py visualex_api tests pytest.ini requirements.txt requirements-dev.txt services/visualex/
git -C "$WT" mv .env.example services/visualex/.env.example
git -C "$WT" mv archivio_normativo requirements-archivio.txt tools/archivio-normativo/
git -C "$WT" mv e2e tools/e2e
git -C "$WT" mv docker-compose.merlt.yml infra/compose.yml
git -C "$WT" mv .env.merlt.example infra/.env.example
```

- [ ] **Step 4: Check that the commit is moves only and nothing is lost**

```bash
git -C "$WT" diff --cached -M --name-status | grep -v '^R100' ; echo "exit=$?"
git -C "$WT" ls-files > "$WORK/after.txt"
python3 "$WORK/inventory.py" "$WORK/before.txt" "$WORK/after.txt"
```

Expected: the `grep` prints nothing and `exit=1`; the checker prints lines only for `bmad/`, `docs/deployment.md`, `docs/sprint-status.yaml` and the retired files (they move or go in Task 6), then `N lost` — note N, it must reach 0 at the end of Task 6.

- [ ] **Step 5: Commit**

```bash
git -C "$WT" commit -F - <<'EOF'
refactor: move every component to its place in the monorepo layout

Moves only, no content change, so every file's history follows it:
frontend → apps/web, backend → apps/server, merlt → services/merlt,
the Python API (app.py, visualex_api, tests, pytest.ini, requirements)
→ services/visualex, archivio_normativo with its tests → tools/, e2e →
tools/e2e, the MERL-T compose file → infra/compose.yml. The paths inside
are fixed in the next commits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 6: Fix the paths, retire the dead files

**Files:**
- Create: `services/visualex/tests/test_version_endpoint.py`, `tools/archivio-normativo/pytest.ini`
- Modify: `services/visualex/app.py:1461-1498`, `tools/archivio-normativo/tests/test_manifest.py:12`, `tools/archivio-normativo/README.md`, `tools/e2e/preflight.py:22-24`, `tools/e2e/README.md`, `.gitignore`, `infra/compose.yml`, `start.sh`, `.github/workflows/ci.yml`, `.github/workflows/security-audit.yml`
- Remove / archive: the files of spec §3.3

- [ ] **Step 1: A Python venv for the moved API**

```bash
python3 -m venv "$WT/services/visualex/.venv"
"$WT/services/visualex/.venv/bin/pip" install -r "$WT/services/visualex/requirements-dev.txt"
"$WT/services/visualex/.venv/bin/playwright" install chromium
```

- [ ] **Step 2: Write the failing test for `/version`**

`services/visualex/tests/test_version_endpoint.py`:

```python
"""/version reads the product version from the repository root."""
from pathlib import Path

import pytest

from app import NormaController

REPO_ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture(scope="module")
def client():
    return NormaController().app.test_client()


async def test_version_comes_from_the_repository_version_file(client):
    response = await client.get("/version")
    assert response.status_code == 200
    body = await response.get_json()
    assert body["version"] == (REPO_ROOT / "version.txt").read_text().strip()
```

Run: `(cd "$WT/services/visualex" && .venv/bin/python -m pytest tests/test_version_endpoint.py -q)`
Expected: FAIL — `'1.0.0' == '1.7.8'` (the file is looked up next to `app.py`).

- [ ] **Step 3: Read `version.txt` from the repository root**

In `services/visualex/app.py`, the line `project_root = Path(__file__).parent` becomes:

```python
        project_root = Path(__file__).resolve().parent
        # version.txt is the product's version and lives at the repository root,
        # two levels above services/visualex/.
        repo_root = project_root.parents[1]
```

`version_file = project_root / 'version.txt'` becomes `version_file = repo_root / 'version.txt'`, and the git call `['log', '-n', '2', '--format=%h', '--', 'version.txt']` becomes `['log', '-n', '2', '--format=%h', '--', ':/version.txt']` (`:/` = path from the top of the working tree, whatever the cwd).

Run the test again. Expected: PASS.

- [ ] **Step 4: The archive CLI and its tests**

In `tools/archivio-normativo/tests/test_manifest.py`, `parents[2] / "archivio_normativo"` becomes `parents[1] / "archivio_normativo"`.

`tools/archivio-normativo/pytest.ini`:

```ini
[pytest]
testpaths = tests
asyncio_mode = auto
addopts = -m "not live"
markers =
    live: hits real external sources; excluded by default, run with -m live
```

In `tools/archivio-normativo/README.md`, put `cd tools/archivio-normativo` on the line before the first `python -m archivio_normativo` example.

Run: `(cd "$WT/tools/archivio-normativo" && ../../services/visualex/.venv/bin/python -m pytest tests/ -q)` → all pass.

- [ ] **Step 5: The e2e harness**

In `tools/e2e/preflight.py`:

```python
REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "apps" / "server"
```

In `tools/e2e/README.md`, every `cd` to an absolute path of the author's machine becomes `cd "$(git rev-parse --show-toplevel)"`:

```bash
perl -pi -e 's#^cd /\S*/VisuaLexAPI\s*$#cd "\$(git rev-parse --show-toplevel)"\n#' "$WT/tools/e2e/README.md"
```

Then every `docker-compose.merlt.yml` becomes `infra/compose.yml`, every `backend/.env` becomes `apps/server/.env`, and `cd tools` goes before each `python -m e2e` command.

Run: `(cd "$WT/tools" && ../services/visualex/.venv/bin/python -c "import e2e.preflight, e2e.runner")` → exit 0.
Run: `grep -rn "/Users/" "$WT/tools/e2e"` → no output.

- [ ] **Step 6: `.gitignore`**

Replace the old paths: `backend/logs/` → `apps/server/logs/`; the four `merlt/…` runtime lines → `services/merlt/uploads/`, `services/merlt/data/`, `services/merlt/.venv/`, `services/merlt/merlt.egg-info/`; `!backend/.env.test` → `!apps/server/.env.test`; delete `!.env.merlt.example` (covered by `!.env.example`); delete `/data`.

Run: `git -C "$WT" status --short | grep -E "node_modules|\.venv|dist/"` → no output.

- [ ] **Step 7: `infra/compose.yml`, interim**

The full rework is Task 7. For now it must run from its new place on today's volumes:

```bash
perl -0pi -e 's#\nservices:\n#\n# Interim (monorepo move): keep the project name the volumes carry today.\nname: visualexapi\n\nservices:\n#' "$WT/infra/compose.yml"
perl -pi -e 's#context: \./vendor/mcp-legal-it#context: ../vendor/mcp-legal-it#; s#context: \./merlt$#context: ../services/merlt#; s#- \./merlt/data:/app/data:ro#- ../services/merlt/data:/app/data:ro#' "$WT/infra/compose.yml"
docker compose -f "$WT/infra/compose.yml" --profile api-in-docker config --quiet && echo compose-ok
```

Expected: `compose-ok`; `grep -n "name: visualexapi\|\.\./services/merlt\|\.\./vendor" "$WT/infra/compose.yml"` shows the four lines.

- [ ] **Step 8: `start.sh`, interim**

```bash
perl -pi -e 's#\$PROJECT_ROOT/docker-compose\.merlt\.yml#\$PROJECT_ROOT/infra/compose.yml#g; s#\$PROJECT_ROOT/merlt\}#\$PROJECT_ROOT/services/merlt}#g; s#\$PROJECT_ROOT/\.venv#\$PROJECT_ROOT/services/visualex/.venv#g; s#\$PROJECT_ROOT/backend#\$PROJECT_ROOT/apps/server#g; s#\$PROJECT_ROOT/frontend#\$PROJECT_ROOT/apps/web#g' "$WT/start.sh"
perl -0pi -e 's#cd "\$PROJECT_ROOT"\nsource \.venv/bin/activate\npython app\.py &#cd "\$PROJECT_ROOT/services/visualex"\nsource .venv/bin/activate\npython app.py &#' "$WT/start.sh"
grep -nE 'docker-compose\.merlt|PROJECT_ROOT/(backend|frontend)|PROJECT_ROOT/merlt\}|PROJECT_ROOT/\.venv' "$WT/start.sh" ; echo "exit=$?"
```

Expected: no match lines, `exit=1`; `grep -n 'services/visualex"' "$WT/start.sh"` shows the new `cd`.

- [ ] **Step 9: CI paths**

In `.github/workflows/ci.yml`:
- the `python` job gets, under `runs-on`, `defaults: { run: { working-directory: services/visualex } }`; its last step becomes `python -m pytest tests/ -q`, followed by:

```yaml
      - name: Archive CLI tests
        working-directory: tools/archivio-normativo
        run: python -m pytest tests/ -q
```

- every `frontend/package-lock.json` / `working-directory: frontend` → `apps/web/…`; every `backend/…` → `apps/server/…`; `cache-dependency-path: merlt/pyproject.toml` and `working-directory: merlt` → `services/merlt/…`.

In `.github/workflows/security-audit.yml`: `inputs: requirements.txt` → `inputs: services/visualex/requirements.txt`; `workspace: [frontend, backend]` → `workspace: [apps/web, apps/server]`.

Run: `grep -nE "(frontend|backend)/|working-directory: (frontend|backend|merlt)$|merlt/pyproject" "$WT/.github/workflows/"*.yml` → no output.

- [ ] **Step 10: Commit the fixes**

```bash
git -C "$WT" add -A services/visualex tools .gitignore infra start.sh .github
git -C "$WT" commit -F - <<'EOF'
fix(paths): point scripts, CI, tests and tools at the monorepo layout

/version reads version.txt from the repository root (new test), and its
git history query uses a top-level pathspec. The archive CLI and the e2e
harness find their files from their new places; the e2e README no longer
carries a personal absolute path. The interim compose file keeps today's
project name so the existing volumes are reused until the data moves.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 11: Retire**

```bash
git -C "$WT" grep -n "codice_civile_articoli\|costituzione_articoli" -- ':!data/*' ; echo "exit=$?"
```

Expected: no output, `exit=1`. Then:

```bash
git -C "$WT" rm -q deploy.sh start-quart.sh package-lock.json VisuaLexAPI.code-workspace data/codice_civile_articoli.txt data/costituzione_articoli.txt
git -C "$WT" mv docs/deployment.md docs/archive/deployment-lightsail.md
git -C "$WT" mv docs/sprint-status.yaml docs/archive/sprint-status.yaml
git -C "$WT" mv bmad docs/archive/bmad-config
git -C "$WT" commit -F - <<'EOF'
chore: retire the files of the decommissioned server and of closed cycles

deploy.sh and start-quart.sh served a server that no longer exists;
docs/deployment.md moves to docs/archive/ as the record of that deploy.
The empty root package-lock.json, a personal editor workspace, two data
files nothing reads, and the BMAD configuration and sprint status go too.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C "$WT" ls-files > "$WORK/after.txt"
python3 "$WORK/inventory.py" "$WORK/before.txt" "$WORK/after.txt"
```

Expected: `0 lost`.

- [ ] **Step 12: All suites on the new layout**

```bash
(cd "$WT/services/visualex" && .venv/bin/python -m pytest tests/ -q)
npm --prefix "$WT/apps/web" run test -- --run && npm --prefix "$WT/apps/web" run build && npm --prefix "$WT/apps/web" run lint
npm --prefix "$WT/apps/server" run build && npm --prefix "$WT/apps/server" test
```

```bash
(cd "$WT/tools/archivio-normativo" && ../../services/visualex/.venv/bin/python -m pytest tests/ -q)
```

Expected: the two Python runs together give 985 passed (984 before the move + the version test) and 6 deselected; web 1343; server ≥ 499; all exit 0.

- [ ] **Step 12b: History still follows every moved file**

```bash
for f in apps/server/src/index.ts apps/web/src/App.tsx services/visualex/app.py services/merlt/merlt/app.py tools/archivio-normativo/archivio_normativo/cli.py; do echo "$f: $(git -C "$WT" log --follow --oneline -- "$f" | wc -l)"; done
```

Expected: every count well above 1 (the history crosses the move commit).

- [ ] **Step 13: Start the stack from the new layout**

In a separate terminal (the script stays in the foreground): `MERLT_ENABLED=true ./start.sh` from `$WT`. Then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5000/health
curl -s http://localhost:3001/api/merlt/health
```

Expected: `200`; the MERL-T health shows `"merlt":"reachable"` and a graph node count near 27,700 — the interim name reused the existing volumes. Stop the stack with Ctrl-C.

- [ ] **Step 14: Pull request into `develop`**

```bash
git -C "$WT" push -u origin refactor/monorepo-layout
gh pr create --repo capazme/VisuaLexAPI --base develop --head refactor/monorepo-layout \
  --title "merge: refactor/monorepo-layout — every component in its place" \
  --body "Spec §3. Moves only in the first commit; path fixes and retirements after. Inventory: 0 lost. Suites green locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

When CI is green: `gh pr merge --repo capazme/VisuaLexAPI --merge --delete-branch --subject "merge: refactor/monorepo-layout — every component in its place"`, then `git -C "$WT" switch develop && git -C "$WT" pull --ff-only`.

---

## Phase 4 — Docker and data

All of Phase 4 happens on `feat/portable-data`, branched from the updated `develop`, merged back by one pull request at the end of Task 9. The development stack keeps running on today's volumes (interim name `visualexapi`) until Task 9 moves the data.

> If the owner's hook refuses a step that writes a `.env*` path (even `.env.example`), the owner runs that step with the content given.

### Task 7: One stack, fixed names, pinned images, one Postgres

**Files:**
- Rewrite: `infra/compose.yml`, `infra/.env.example`, `start.sh`
- Create: `infra/postgres/init/01-databases.sh`, `infra/compose.datadir.yml`
- Modify: `apps/server/.env.example` (`DATABASE_URL`), `apps/server/.env.test` (`DATABASE_URL`), `tools/e2e/preflight.py`, `services/merlt/merlt/scripts/purge_error_chunks.py`, the `services/merlt/tests` files that name containers

**Interfaces:**
- Produces: service names `postgres`, `redis`, `falkordb`, `qdrant`, `mcp-legal-it`, `merlt-api`, `merlt-worker`; container names `${VISUALEX_STACK}-<service>` (default `visualex-…`; `visualex-merlt-api`, `visualex-merlt-worker`, `visualex-mcp-legal-it` keep today's names); volumes `${VISUALEX_STACK}_postgres_data`, `_falkordb_data`, `_qdrant_data`, `_merlt_uploads`, `_merlt_hf_cache`, `_merlt_checkpoints`, `_merlt_ner_models`; profile `merlt`; env `FALKORDB_ARGS` (overridable); databases `visualex_platform`, `visualex_test` (owner `visualex`), `merlt` (owner `merlt`), superuser `postgres`.

- [ ] **Step 1: Branch and read the FalkorDB digest**

```bash
git -C "$WT" switch -c feat/portable-data develop
docker image inspect falkordb/falkordb:latest --format '{{index .RepoDigests 0}}'
docker run --rm --entrypoint redis-server falkordb/falkordb:latest --version
```

Expected: `falkordb/falkordb@sha256:<64 hex>` (the image that wrote today's graph) and its Redis version. Keep both for Step 2.

- [ ] **Step 2: Write `infra/compose.yml`**

Replace the whole file with the following. Then replace `sha256:DIGEST_FROM_STEP_1` with the digest printed in Step 1 and check `grep -c DIGEST_FROM_STEP_1 infra/compose.yml` → `0`.

```yaml
# VisuaLex development stack.
#
#   default profile   postgres, redis, falkordb, qdrant — the stores
#   profile "merlt"   mcp-legal-it, merlt-api, merlt-worker
#
# The Python API, the server and the web app run on the host (./start.sh).
# The project name is fixed (name: below), so containers and volumes keep
# their names wherever this file is run from. A throwaway stack sets
# VISUALEX_STACK and its own ports. Variables: infra/.env (from .env.example).
# Data moves by export and import only: scripts/backup.sh, scripts/restore.sh.

name: ${VISUALEX_STACK:-visualex}

x-merlt-env: &merlt-env
  DATABASE_URL: "postgresql://merlt:${MERLT_DB_PASSWORD:-merlt}@postgres:5432/merlt"
  ENRICHMENT_DATABASE_URL: "postgresql+asyncpg://merlt:${MERLT_DB_PASSWORD:-merlt}@postgres:5432/merlt"
  ENRICHMENT_DB_HOST: "postgres"
  ENRICHMENT_DB_PORT: "5432"
  ENRICHMENT_DB_NAME: "merlt"
  ENRICHMENT_DB_USER: "merlt"
  ENRICHMENT_DB_PASSWORD: "${MERLT_DB_PASSWORD:-merlt}"
  RLCF_DATABASE_URL: "postgresql://merlt:${MERLT_DB_PASSWORD:-merlt}@postgres:5432/merlt"
  RLCF_ASYNC_DATABASE_URL: "postgresql+asyncpg://merlt:${MERLT_DB_PASSWORD:-merlt}@postgres:5432/merlt"
  REDIS_URL: "redis://redis:6379/0"
  REDIS_HOST: "redis"
  REDIS_PORT: "6379"
  # RQ queues on Redis DB 1: the api enqueues, the worker consumes.
  RQ_REDIS_URL: "redis://redis:6379/1"
  FALKORDB_HOST: "falkordb"
  FALKORDB_PORT: "6379"
  FALKORDB_GRAPH_NAME: "${MERLT_GRAPH_NAME:-merl_t_legal}"
  QDRANT_HOST: "qdrant"
  QDRANT_PORT: "6333"
  QDRANT_COLLECTION: "${MERLT_QDRANT_COLLECTION:-merl_t_legal_chunks}"
  # The Python API runs on the host. host.docker.internal reaches it from a
  # container (extra_hosts maps it on Linux, where it does not exist).
  VISUALEX_API_URL: "${VISUALEX_API_URL:-http://host.docker.internal:5000}"
  MERLT_INTERNAL_SECRET: "${MERLT_INTERNAL_SECRET:-dev-internal-secret}"
  OPENROUTER_API_KEY: "${OPENROUTER_API_KEY:-}"
  MERLT_NEURAL_TRAVERSAL_ENABLED: "${MERLT_NEURAL_TRAVERSAL_ENABLED:-true}"
  MERLT_REACT_ENABLED: "${MERLT_REACT_ENABLED:-true}"
  MERLT_SEMANTIC_SEARCH_ENABLED: "${MERLT_SEMANTIC_SEARCH_ENABLED:-true}"
  MERLT_ADVANCED_ROUTING_ENABLED: "${MERLT_ADVANCED_ROUTING_ENABLED:-true}"
  MERLT_DATA_DIR: "/app/data"

x-merlt-volumes: &merlt-volumes
  - ../services/merlt/data:/app/data:ro
  # api receives uploads, worker extracts them: one volume for both.
  - merlt_uploads:/app/uploads
  - merlt_hf_cache:/home/appuser/.cache/huggingface
  - merlt_checkpoints:/app/checkpoints
  - merlt_ner_models:/app/models

services:
  postgres:
    image: postgres:16-alpine
    container_name: ${VISUALEX_STACK:-visualex}-postgres
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
      # Read by init/01-databases.sh on the first start of an empty volume.
      PLATFORM_DB_PASSWORD: ${PLATFORM_DB_PASSWORD:-visualex}
      MERLT_DB_PASSWORD: ${MERLT_DB_PASSWORD:-merlt}
    ports:
      - "127.0.0.1:${VISUALEX_PG_PORT:-5436}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: ${VISUALEX_STACK:-visualex}-redis
    ports:
      - "127.0.0.1:${VISUALEX_REDIS_PORT:-6381}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  falkordb:
    # Pinned to the image that wrote the development graph: a newer one might
    # not read a saved snapshot.
    image: falkordb/falkordb@sha256:DIGEST_FROM_STEP_1
    container_name: ${VISUALEX_STACK:-visualex}-falkordb
    restart: unless-stopped
    environment:
      # scripts/restore.sh overrides this for one start to load a snapshot.
      FALKORDB_ARGS: "${FALKORDB_ARGS:---save 60 1 --appendonly yes --appendfsync everysec}"
    ports:
      - "127.0.0.1:${VISUALEX_FALKOR_PORT:-6382}:6379"
    volumes:
      # The image writes here, not to /data.
      - falkordb_data:/var/lib/falkordb/data
    healthcheck:
      test: ["CMD", "redis-cli", "-p", "6379", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  qdrant:
    image: qdrant/qdrant:v1.17.1
    container_name: ${VISUALEX_STACK:-visualex}-qdrant
    ports:
      - "127.0.0.1:${VISUALEX_QDRANT_PORT:-6343}:6333"
      - "127.0.0.1:${VISUALEX_QDRANT_GRPC_PORT:-6344}:6334"
    volumes:
      - qdrant_data:/qdrant/storage
    healthcheck:
      test: ["CMD-SHELL", "bash -c ':> /dev/tcp/127.0.0.1/6333'"]
      interval: 10s
      timeout: 5s
      retries: 5

  mcp-legal-it:
    build:
      context: ../vendor/mcp-legal-it
      dockerfile: Dockerfile
    container_name: ${VISUALEX_STACK:-visualex}-mcp-legal-it
    profiles: ["merlt"]
    environment:
      MCP_TRANSPORT: "http"
      MCP_HOST: "0.0.0.0"
      MCP_PORT: "8011"
      MCP_PATH: "/mcp"
      LEGAL_PROFILE: "full"
    ports:
      - "127.0.0.1:${MCP_LEGAL_IT_PORT:-8011}:8011"
    healthcheck:
      # No curl in the image, and /mcp needs a handshake: a TCP connect is enough.
      test: ["CMD-SHELL", "python3 -c \"import socket; socket.create_connection(('localhost',8011),2).close()\""]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 30s

  merlt-api:
    build:
      context: ../services/merlt
      dockerfile: Dockerfile
    container_name: ${VISUALEX_STACK:-visualex}-merlt-api
    profiles: ["merlt"]
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres: {condition: service_healthy}
      redis: {condition: service_healthy}
      falkordb: {condition: service_healthy}
      qdrant: {condition: service_healthy}
      mcp-legal-it: {condition: service_started}
    environment:
      <<: *merlt-env
      # Below the server's extraction watchdog, or jobs flip to timeout early.
      MERLT_EXTRACT_JOB_TIMEOUT: "${MERLT_EXTRACT_JOB_TIMEOUT:-1800}"
      MERLT_NER_LEARNED_ENABLED: "false"
      MERLT_RLCF_BUFFER_PATH: "/app/checkpoints/rlcf/replay_buffer.json"
      MCP_LEGAL_IT_URL: "http://mcp-legal-it:8011/mcp"
      BFF_QA_CALLBACK_URL: "${MERLT_BFF_QA_CALLBACK_URL:-http://host.docker.internal:3001/api/merlt/internal/qa-callback}"
      MERLT_ADMIN_API_KEY: "${MERLT_API_KEY:-}"
      MERLT_SKIP_SEED: "${MERLT_SKIP_SEED:-false}"
      MERLT_SKIP_EMBEDDINGS: "${MERLT_SKIP_EMBEDDINGS:-true}"
      MERLT_HYGIENE_INTERVAL_HOURS: "${MERLT_HYGIENE_INTERVAL_HOURS:-24}"
    volumes: *merlt-volumes
    ports:
      - "127.0.0.1:${MERLT_API_PORT:-8000}:8000"
    command: ["uvicorn", "merlt.app:app", "--host", "0.0.0.0", "--port", "8000"]
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:8000/health"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 300s

  merlt-worker:
    build:
      context: ../services/merlt
      dockerfile: Dockerfile
    container_name: ${VISUALEX_STACK:-visualex}-merlt-worker
    profiles: ["merlt"]
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres: {condition: service_healthy}
      redis: {condition: service_healthy}
      falkordb: {condition: service_healthy}
      qdrant: {condition: service_healthy}
    environment:
      <<: *merlt-env
      BFF_CALLBACK_URL: "${MERLT_BFF_CALLBACK_URL:-http://host.docker.internal:3001/api/merlt/internal/job-callback}"
      BFF_EXTRACTION_CALLBACK_URL: "${MERLT_BFF_EXTRACTION_CALLBACK_URL:-http://host.docker.internal:3001/api/merlt/internal/extraction-callback}"
      # Only the api seeds the graph at boot.
      MERLT_SKIP_SEED: "true"
    volumes: *merlt-volumes
    command: ["rq", "worker", "merlt_ingest", "merlt_extract", "merlt_ner_train", "--url", "redis://redis:6379/1"]
    healthcheck:
      # Not an HTTP server: alive = it reaches its queue.
      test: ["CMD-SHELL", "python -c \"import os,redis; redis.from_url(os.environ['RQ_REDIS_URL']).ping()\""]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  postgres_data: {name: "${VISUALEX_STACK:-visualex}_postgres_data"}
  falkordb_data: {name: "${VISUALEX_STACK:-visualex}_falkordb_data"}
  qdrant_data: {name: "${VISUALEX_STACK:-visualex}_qdrant_data"}
  merlt_uploads: {name: "${VISUALEX_STACK:-visualex}_merlt_uploads"}
  merlt_hf_cache: {name: "${VISUALEX_STACK:-visualex}_merlt_hf_cache"}
  merlt_checkpoints: {name: "${VISUALEX_STACK:-visualex}_merlt_checkpoints"}
  merlt_ner_models: {name: "${VISUALEX_STACK:-visualex}_merlt_ner_models"}
```

- [ ] **Step 3: The database init script**

`infra/postgres/init/01-databases.sh` (then `chmod +x`):

```sh
#!/bin/sh
# Runs once, when the postgres volume is empty (the image's entrypoint).
# One role and one database per component. visualex_test is the server
# suite's database: its setup refuses any database without "test" in the name.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<SQL
CREATE ROLE visualex LOGIN CREATEDB PASSWORD '${PLATFORM_DB_PASSWORD}';
CREATE ROLE merlt LOGIN PASSWORD '${MERLT_DB_PASSWORD}';
CREATE DATABASE visualex_platform OWNER visualex;
CREATE DATABASE visualex_test OWNER visualex;
CREATE DATABASE merlt OWNER merlt;
SQL
```

- [ ] **Step 4: The data-directory override**

`infra/compose.datadir.yml`:

```yaml
# Bind every persistent store to a directory of your choice — on a server,
# the disk chosen for the databases. The directories must exist first:
#   mkdir -p "$VISUALEX_DATA_DIR"/{postgres,falkordb,qdrant,merlt_uploads,merlt_hf_cache,merlt_checkpoints,merlt_ner_models}
#   docker compose -f infra/compose.yml -f infra/compose.datadir.yml up -d
volumes:
  postgres_data:
    driver: local
    driver_opts: {type: none, o: bind, device: "${VISUALEX_DATA_DIR:?set VISUALEX_DATA_DIR}/postgres"}
  falkordb_data:
    driver: local
    driver_opts: {type: none, o: bind, device: "${VISUALEX_DATA_DIR:?set VISUALEX_DATA_DIR}/falkordb"}
  qdrant_data:
    driver: local
    driver_opts: {type: none, o: bind, device: "${VISUALEX_DATA_DIR:?set VISUALEX_DATA_DIR}/qdrant"}
  merlt_uploads:
    driver: local
    driver_opts: {type: none, o: bind, device: "${VISUALEX_DATA_DIR:?set VISUALEX_DATA_DIR}/merlt_uploads"}
  merlt_hf_cache:
    driver: local
    driver_opts: {type: none, o: bind, device: "${VISUALEX_DATA_DIR:?set VISUALEX_DATA_DIR}/merlt_hf_cache"}
  merlt_checkpoints:
    driver: local
    driver_opts: {type: none, o: bind, device: "${VISUALEX_DATA_DIR:?set VISUALEX_DATA_DIR}/merlt_checkpoints"}
  merlt_ner_models:
    driver: local
    driver_opts: {type: none, o: bind, device: "${VISUALEX_DATA_DIR:?set VISUALEX_DATA_DIR}/merlt_ner_models"}
```

- [ ] **Step 5: `infra/.env.example`**

```sh
# Variables for infra/compose.yml. Copy to infra/.env (never committed).
# A throwaway stack (tests, onboarding checks) sets its own name AND ports.
VISUALEX_STACK=visualex
VISUALEX_PG_PORT=5436
VISUALEX_REDIS_PORT=6381
VISUALEX_FALKOR_PORT=6382
VISUALEX_QDRANT_PORT=6343
VISUALEX_QDRANT_GRPC_PORT=6344
MCP_LEGAL_IT_PORT=8011
MERLT_API_PORT=8000

# Development passwords only.
POSTGRES_PASSWORD=postgres
PLATFORM_DB_PASSWORD=visualex
MERLT_DB_PASSWORD=merlt

# MERL-T. Each developer uses their own model key; empty = no LLM calls.
OPENROUTER_API_KEY=
MERLT_GRAPH_NAME=merl_t_legal
MERLT_QDRANT_COLLECTION=merl_t_legal_chunks

# Optional: every store in one directory (with infra/compose.datadir.yml).
# VISUALEX_DATA_DIR=/path/to/visualex-data
```

- [ ] **Step 6: The server points at the stack's Postgres**

```bash
perl -pi -e 's#^DATABASE_URL=.*#DATABASE_URL="postgresql://visualex:visualex\@localhost:5436/visualex_platform"#' "$WT/apps/server/.env.example"
perl -pi -e 's#^DATABASE_URL=.*#DATABASE_URL="postgresql://visualex:visualex\@localhost:5436/visualex_test"#' "$WT/apps/server/.env.test"
grep -n "^DATABASE_URL" "$WT/apps/server/.env.example" "$WT/apps/server/.env.test"
```

Expected: the two new URLs. (`.env.test` no longer names a personal database user.)

- [ ] **Step 7: Rename the four store containers where code names them**

```bash
git -C "$WT" grep -lE "visualex-merlt-(postgres|redis|falkordb|qdrant)" -- tools services start.sh \
  | xargs perl -pi -e 's#visualex-merlt-(postgres|redis|falkordb|qdrant)#visualex-$1#g'
git -C "$WT" grep -nE "visualex-merlt-(postgres|redis|falkordb|qdrant)" -- tools services start.sh ; echo "exit=$?"
```

Expected: no match, `exit=1`. (`visualex-merlt-api`, `visualex-merlt-worker`, `visualex-mcp-legal-it` keep their names.)

- [ ] **Step 7b: Peers are configuration, not hard-coded (spec §6.3)**

The Compose services were renamed (`merlt-postgres` → `postgres`, …), so a hard-coded host would now point at nothing.

```bash
git -C "$WT" grep -nE "merlt-(postgres|redis|falkordb|qdrant)|['\"]postgres['\"]\s*[,)]|localhost:(5436|6381|6382|6343)" -- apps/server/src services/merlt/merlt services/visualex/visualex_api tools/e2e ':!*.md'
```

Every line printed must be the *default* of an environment variable (`os.environ.get("X", "...")`, `process.env.X ?? '...'`, a settings field with an env alias). A host used without an environment override is changed to read one, in this task, with the variable added to `infra/compose.yml`'s environment for the service that needs it.

- [ ] **Step 8: Write `start.sh`**

Replace the whole file (keep it executable):

```bash
#!/bin/bash
# VisuaLex development stack — one command.
#   Docker (infra/compose.yml): postgres, redis, falkordb, qdrant — always;
#     mcp-legal-it, merlt-api, merlt-worker too with MERLT_ENABLED=true.
#   Host, with hot reload: Python API (services/visualex, :5000), server
#     (apps/server, :3001), web (apps/web, :5173).
#   MERLT_API_IN_DOCKER=false runs the MERL-T api and worker on the host
#     (developer mode: a venv with the merlt deps, no mcp-legal-it tools).
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
# Same values as Compose reads: ports, stack name, passwords.
if [ -f "$PROJECT_ROOT/infra/.env" ]; then set -a; . "$PROJECT_ROOT/infra/.env"; set +a; fi
COMPOSE=(docker compose -f "$PROJECT_ROOT/infra/compose.yml")
MERLT_ENABLED="${MERLT_ENABLED:-false}"
MERLT_API_IN_DOCKER="${MERLT_API_IN_DOCKER:-true}"
MERLT_ROOT="$PROJECT_ROOT/services/merlt"
MERLT_PORT="${MERLT_API_PORT:-8000}"
MERLT_HEALTH_TIMEOUT="${MERLT_HEALTH_TIMEOUT:-60}"
SERVER_ENV="$PROJECT_ROOT/apps/server/.env"
VENV="$PROJECT_ROOT/services/visualex/.venv"
if [ -z "${MERLT_PYTHON:-}" ] && [ -x "$MERLT_ROOT/.venv/bin/python" ]; then MERLT_PYTHON="$MERLT_ROOT/.venv/bin/python"; fi
MERLT_PYTHON="${MERLT_PYTHON:-python}"

# KEY from apps/server/.env, for the secrets MERL-T and the server share.
server_env() {
    [ -f "$SERVER_ENV" ] || return 0
    sed -n "s/^$1=[\"']\{0,1\}\([^\"']*\).*/\1/p" "$SERVER_ENV" | tail -1
}

echo -e "${BLUE}VisuaLex development stack${NC}"

CLEANED_UP=""
cleanup() {
    [ -n "$CLEANED_UP" ] && return
    CLEANED_UP=1
    echo -e "\n${YELLOW}Shutting down...${NC}"
    kill ${API_PID:-} ${SERVER_PID:-} ${WEB_PID:-} ${MERLT_PID:-} ${MERLT_WORKER_PID:-} 2>/dev/null || true
    # stop, not down: containers and volumes stay for the next start.
    "${COMPOSE[@]}" --profile merlt stop >/dev/null 2>&1 || true
    echo -e "${GREEN}Stopped.${NC}"
}
trap 'cleanup; exit 0' SIGINT SIGTERM
trap cleanup EXIT

check_port() {
    if lsof -Pi :"$1" -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}Port $1 in use${NC} - run: ${YELLOW}kill \$(lsof -t -i:$1)${NC}"
        return 1
    fi
}
for p in 5000 3001 5173; do check_port "$p" || exit 1; done

if [ ! -x "$VENV/bin/python" ]; then
    echo -e "${RED}No venv at services/visualex/.venv${NC} - see docs/setup.md"; exit 1
fi
if ! "$VENV/bin/python" -c "import redis, playwright" 2>/dev/null; then
    echo -e "${RED}Python dependencies missing${NC} - run: ${YELLOW}services/visualex/.venv/bin/pip install -r services/visualex/requirements-dev.txt${NC}"; exit 1
fi
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-}"
if [ -z "$PW_CACHE" ]; then
    case "$OSTYPE" in
        darwin*) PW_CACHE="$HOME/Library/Caches/ms-playwright" ;;
        linux*)  PW_CACHE="$HOME/.cache/ms-playwright" ;;
    esac
fi
if [ -n "$PW_CACHE" ] && ! ls "$PW_CACHE" 2>/dev/null | grep -q chromium; then
    echo -e "${RED}Playwright Chromium missing${NC} - run: ${YELLOW}services/visualex/.venv/bin/playwright install chromium${NC}"; exit 1
fi

if [ "$MERLT_ENABLED" = "true" ]; then
    check_port "$MERLT_PORT" || exit 1
    if [ "$MERLT_API_IN_DOCKER" = "true" ] && [ ! -f "$PROJECT_ROOT/vendor/mcp-legal-it/Dockerfile" ]; then
        echo -e "${YELLOW}Initialising the vendor/mcp-legal-it submodule...${NC}"
        git -C "$PROJECT_ROOT" submodule update --init --recursive vendor/mcp-legal-it
    fi
    MERLT_INTERNAL_SECRET="${MERLT_INTERNAL_SECRET:-$(server_env MERLT_INTERNAL_SECRET)}"
    MERLT_API_KEY="${MERLT_API_KEY:-$(server_env MERLT_API_KEY)}"
    if [ -n "$MERLT_INTERNAL_SECRET" ]; then export MERLT_INTERNAL_SECRET; else
        echo -e "${YELLOW}MERLT_INTERNAL_SECRET empty: MERL-T callbacks to the server will be refused${NC}"; fi
    if [ -n "$MERLT_API_KEY" ]; then export MERLT_API_KEY MERLT_ADMIN_API_KEY="$MERLT_API_KEY"; else
        echo -e "${YELLOW}MERLT_API_KEY empty: MERL-T admin routes will answer 401${NC}"; fi
    if [ "$MERLT_API_IN_DOCKER" != "true" ] && ! "$MERLT_PYTHON" -c 'import merlt.app' >/dev/null 2>&1; then
        echo -e "${RED}MERLT_PYTHON ($MERLT_PYTHON) cannot import merlt.app${NC}"; exit 1
    fi
fi

echo -e "\n${YELLOW}[1/4] Data stores...${NC}"
"${COMPOSE[@]}" up -d --wait postgres redis falkordb qdrant

echo -e "\n${YELLOW}[2/4] Python API (:5000)...${NC}"
( cd "$PROJECT_ROOT/services/visualex" && exec "$VENV/bin/python" app.py ) &
API_PID=$!

echo -e "\n${YELLOW}[3/4] Server (:3001)...${NC}"
cd "$PROJECT_ROOT/apps/server"
npx prisma generate > /dev/null 2>&1 || echo -e "${YELLOW}prisma generate failed${NC}"
npx prisma migrate deploy || echo -e "${YELLOW}prisma migrate deploy failed - does DATABASE_URL in apps/server/.env point at port ${VISUALEX_PG_PORT:-5436}?${NC}"
if [ -n "${ADMIN_PASSWORD:-}" ]; then npm run db:seed || echo -e "${YELLOW}db:seed failed${NC}"; fi
npm run dev &
SERVER_PID=$!

echo -e "\n${YELLOW}[4/4] Web (:5173)...${NC}"
cd "$PROJECT_ROOT/apps/web"
npm run dev &
WEB_PID=$!
cd "$PROJECT_ROOT"

if [ "$MERLT_ENABLED" = "true" ]; then
    if [ "$MERLT_API_IN_DOCKER" = "true" ]; then
        echo -e "\n${YELLOW}MERL-T in Docker...${NC}"
        "${COMPOSE[@]}" --profile merlt up -d
    else
        echo -e "\n${YELLOW}MERL-T on the host (:$MERLT_PORT)...${NC}"
        DB="postgresql://merlt:${MERLT_DB_PASSWORD:-merlt}@localhost:${VISUALEX_PG_PORT:-5436}/merlt"
        REDIS="redis://localhost:${VISUALEX_REDIS_PORT:-6381}"
        # Exported only now: the server already runs with its own DATABASE_URL.
        export DATABASE_URL="$DB" RLCF_DATABASE_URL="$DB" \
            ENRICHMENT_DATABASE_URL="${DB/postgresql:/postgresql+asyncpg:}" RLCF_ASYNC_DATABASE_URL="${DB/postgresql:/postgresql+asyncpg:}" \
            ENRICHMENT_DB_HOST=localhost ENRICHMENT_DB_PORT="${VISUALEX_PG_PORT:-5436}" ENRICHMENT_DB_NAME=merlt \
            ENRICHMENT_DB_USER=merlt ENRICHMENT_DB_PASSWORD="${MERLT_DB_PASSWORD:-merlt}" \
            REDIS_HOST=localhost REDIS_PORT="${VISUALEX_REDIS_PORT:-6381}" REDIS_URL="$REDIS/0" RQ_REDIS_URL="$REDIS/1" \
            FALKORDB_HOST=localhost FALKORDB_PORT="${VISUALEX_FALKOR_PORT:-6382}" FALKORDB_GRAPH_NAME="${MERLT_GRAPH_NAME:-merl_t_legal}" \
            QDRANT_HOST=localhost QDRANT_PORT="${VISUALEX_QDRANT_PORT:-6343}" QDRANT_COLLECTION="${MERLT_QDRANT_COLLECTION:-merl_t_legal_chunks}" \
            VISUALEX_API_URL=http://localhost:5000 \
            BFF_CALLBACK_URL=http://localhost:3001/api/merlt/internal/job-callback \
            BFF_EXTRACTION_CALLBACK_URL=http://localhost:3001/api/merlt/internal/extraction-callback \
            BFF_QA_CALLBACK_URL=http://localhost:3001/api/merlt/internal/qa-callback \
            MERLT_REACT_ENABLED="${MERLT_REACT_ENABLED:-true}" \
            MERLT_SEMANTIC_SEARCH_ENABLED="${MERLT_SEMANTIC_SEARCH_ENABLED:-true}" \
            MERLT_ADVANCED_ROUTING_ENABLED="${MERLT_ADVANCED_ROUTING_ENABLED:-true}" \
            MERLT_MCP_LEGAL_TOOLS_ENABLED="${MERLT_MCP_LEGAL_TOOLS_ENABLED:-false}"
        ( cd "$MERLT_ROOT" && exec "$MERLT_PYTHON" -m uvicorn merlt.app:app --reload --port "$MERLT_PORT" ) &
        MERLT_PID=$!
        MERLT_SKIP_SEED=true "$MERLT_PYTHON" -m rq.cli worker merlt_ingest merlt_extract merlt_ner_train --url "$RQ_REDIS_URL" &
        MERLT_WORKER_PID=$!
    fi
    echo -e "${YELLOW}Waiting for MERL-T /health (up to ${MERLT_HEALTH_TIMEOUT}s)...${NC}"
    elapsed=0
    until curl -fsS "http://localhost:$MERLT_PORT/health" >/dev/null 2>&1; do
        if [ "$elapsed" -ge "$MERLT_HEALTH_TIMEOUT" ]; then
            echo -e "${RED}MERL-T not healthy after ${MERLT_HEALTH_TIMEOUT}s - continuing${NC}"; break
        fi
        sleep 2; elapsed=$((elapsed + 2))
    done
    if [ "$MERLT_API_IN_DOCKER" = "true" ] && ! "${COMPOSE[@]}" --profile merlt ps --status running --services 2>/dev/null | grep -q '^merlt-worker$'; then
        echo -e "${RED}merlt-worker is not running: ingestion, note extraction and NER training will not complete${NC}"
    fi
fi

sleep 3
echo -e "\n${GREEN}Running:${NC} Python API http://localhost:5000 · server http://localhost:3001 · web http://localhost:5173"
[ "$MERLT_ENABLED" = "true" ] && echo -e "         MERL-T http://localhost:$MERLT_PORT"
echo -e "${YELLOW}Ctrl+C stops everything (data stays in the volumes).${NC}\n"
wait
```

Run: `bash -n "$WT/start.sh" && echo syntax-ok` → `syntax-ok`.

- [ ] **Step 9: Test the stack on a throwaway name**

```bash
T=(env VISUALEX_STACK=visualex-t7 VISUALEX_PG_PORT=55436 VISUALEX_REDIS_PORT=56381 VISUALEX_FALKOR_PORT=56382 VISUALEX_QDRANT_PORT=56343 VISUALEX_QDRANT_GRPC_PORT=56344)
"${T[@]}" docker compose -f "$WT/infra/compose.yml" --profile merlt config --quiet && echo config-ok
"${T[@]}" docker compose -f "$WT/infra/compose.yml" up -d --wait postgres redis falkordb qdrant
docker exec visualex-t7-postgres psql -U postgres -Atc "select datname from pg_database where datname in ('visualex_platform','visualex_test','merlt') order by 1"
docker exec visualex-t7-postgres psql -U postgres -Atc "select rolname from pg_roles where rolname in ('visualex','merlt') order by 1"
DATABASE_URL="postgresql://visualex:visualex@localhost:55436/visualex_test" npm --prefix "$WT/apps/server" test
```

Expected: `config-ok`; `merlt`, `visualex_platform`, `visualex_test`; `merlt`, `visualex`; server suite green. Then remove **only** the throwaway stack:

```bash
"${T[@]}" docker compose -f "$WT/infra/compose.yml" down -v
docker volume ls --format '{{.Name}}' | grep '^visualex-t7_' ; echo "exit=$?"
```

Expected: no volume listed, `exit=1`.

- [ ] **Step 10: Commit**

```bash
git -C "$WT" add infra start.sh apps/server/.env.example apps/server/.env.test tools services
git -C "$WT" commit -F - <<'EOF'
feat(infra): one development stack with fixed names, pinned images, one Postgres

infra/compose.yml carries a fixed project name and named volumes, so the
data no longer depends on the folder the file runs from; VISUALEX_STACK and
the port variables give a throwaway stack its own. FalkorDB is pinned to the
image that wrote the development graph, Qdrant to 1.17.1. One Postgres 16
holds visualex_platform, visualex_test and merlt, one role each, created
by an init script. infra/compose.datadir.yml binds the stores to a chosen
directory. start.sh always starts the stores (the platform database lives
there now) and MERL-T under the merlt profile.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 8: `datakit` — backup, restore, verify

Stdlib-only Python, so it runs on any machine with Python 3 and Docker. It works on a stack by container and volume names, so the same tool exports today's legacy containers (Task 9) and, on another machine, that machine's stack.

**Files:**
- Create: `scripts/datakit/__init__.py`, `scripts/datakit/manifest.py`, `scripts/datakit/target.py`, `scripts/datakit/sh.py`, `scripts/datakit/cli.py`, `scripts/datakit/stores/__init__.py`, `scripts/datakit/stores/postgres.py`, `scripts/datakit/stores/falkordb.py`, `scripts/datakit/stores/qdrant.py`, `scripts/datakit/stores/volumes.py`, `scripts/datakit/README.md`, `scripts/backup.sh`, `scripts/restore.sh`
- Test: `scripts/datakit/tests/conftest.py`, `scripts/datakit/tests/test_manifest.py`, `scripts/datakit/tests/test_roundtrip.py`

**Interfaces:**
- Consumes: Task 7's container names `<stack>-postgres`, `<stack>-falkordb`; volume names `<stack>_<key>`; `FALKORDB_ARGS`; `VISUALEX_QDRANT_PORT`.
- Produces: `scripts/backup.sh [--stack S] [--out DIR] [--stores postgres,falkordb,qdrant,volumes] [--pg-container C] [--pg-user U] [--databases a,b] [--falkor-container C] [--qdrant-url URL] [--volume-prefix P] [--volumes a,b]`; `scripts/restore.sh DIR [--force] [--stores …] [same target options]`; `python3 scripts/datakit/cli.py verify DIR [target options]`. Exit 0 = ok, 1 = counts differ, 2 = folder damaged. Backup folder: `postgres/<db>.dump`, `falkordb/dump.rdb`, `qdrant/<collection>.snapshot`, `volumes/<key>.tgz`, `manifest.json`.

- [ ] **Step 1: Write the unit tests**

`scripts/datakit/tests/conftest.py`:

```python
import sys
from pathlib import Path

# The package lives in scripts/: make `import datakit` work from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
```

`scripts/datakit/tests/test_manifest.py`:

```python
import json

import pytest

from datakit import manifest
from datakit.target import Target


def _folder(tmp_path):
    (tmp_path / "postgres").mkdir()
    (tmp_path / "postgres" / "db.dump").write_bytes(b"dump")
    (tmp_path / "falkordb").mkdir()
    (tmp_path / "falkordb" / "dump.rdb").write_bytes(b"rdb")
    return tmp_path


def test_the_index_lists_every_file_but_the_manifest(tmp_path):
    root = _folder(tmp_path)
    (root / "manifest.json").write_text("{}")
    files = manifest.index_files(root)
    assert sorted(files) == ["falkordb/dump.rdb", "postgres/db.dump"]
    assert files["postgres/db.dump"]["bytes"] == 4
    assert len(files["postgres/db.dump"]["sha256"]) == 64


def test_an_intact_folder_verifies(tmp_path):
    root = _folder(tmp_path)
    assert manifest.verify_files(root, {"format": 1, "files": manifest.index_files(root)}) == []


def test_a_changed_or_missing_file_is_reported(tmp_path):
    root = _folder(tmp_path)
    listed = {"format": 1, "files": manifest.index_files(root)}
    (root / "postgres" / "db.dump").write_bytes(b"tampered")
    (root / "falkordb" / "dump.rdb").unlink()
    assert manifest.verify_files(root, listed) == [
        "missing: falkordb/dump.rdb",
        "sha256 mismatch: postgres/db.dump",
    ]


def test_a_file_outside_the_manifest_is_reported(tmp_path):
    root = _folder(tmp_path)
    listed = {"format": 1, "files": manifest.index_files(root)}
    (root / "stray.txt").write_text("x")
    assert manifest.verify_files(root, listed) == ["not in manifest: stray.txt"]


def test_matching_counts_give_no_problem():
    counts = {"merlt": {"users": 3, "votes": 0}}
    assert manifest.compare_counts(counts, json.loads(json.dumps(counts))) == []


def test_count_differences_name_the_place():
    expected = {"merlt": {"users": 3, "votes": 1}, "g": {"nodes": 5}}
    actual = {"merlt": {"users": 2}, "g": {"nodes": 5}, "extra": {}}
    assert manifest.compare_counts(expected, actual) == [
        "extra: not in the backup",
        "merlt/users: expected 3, found 2",
        "merlt/votes: missing after restore",
    ]


def test_a_manifest_of_another_format_is_refused(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"format": 99}))
    with pytest.raises(ValueError, match="format"):
        manifest.read(tmp_path)


def test_a_stack_names_its_containers_volumes_and_qdrant_port(monkeypatch):
    monkeypatch.setenv("VISUALEX_QDRANT_PORT", "56343")
    t = Target.for_stack("x")
    assert (t.pg_container, t.falkor_container, t.volume_prefix) == ("x-postgres", "x-falkordb", "x_")
    assert t.qdrant_url == "http://127.0.0.1:56343"
    assert Target.for_stack("x", pg_container="legacy").pg_container == "legacy"
```

- [ ] **Step 2: Run them to see them fail**

Run: `(cd "$WT" && services/visualex/.venv/bin/python -m pytest scripts/datakit/tests/test_manifest.py -q)`
Expected: FAIL — `ModuleNotFoundError: No module named 'datakit'`.

- [ ] **Step 3: Write `manifest.py`, `target.py`, `__init__.py`**

`scripts/datakit/__init__.py`:

```python
"""Portable export and import of the VisuaLex data stores."""
```

`scripts/datakit/manifest.py`:

```python
"""The backup folder's manifest: file hashes and store counts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

FORMAT = 1
MANIFEST = "manifest.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def index_files(root: Path) -> dict[str, dict[str, Any]]:
    """Every file under root except the manifest: relative path -> hash and size."""
    files: dict[str, dict[str, Any]] = {}
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix()
        if rel != MANIFEST:
            files[rel] = {"sha256": sha256_file(path), "bytes": path.stat().st_size}
    return files


def verify_files(root: Path, manifest: dict[str, Any]) -> list[str]:
    """What differs between the folder and its manifest; empty means intact."""
    listed = manifest.get("files", {})
    present = index_files(root)
    problems = []
    for rel, meta in listed.items():
        if rel not in present:
            problems.append(f"missing: {rel}")
        elif present[rel]["sha256"] != meta["sha256"]:
            problems.append(f"sha256 mismatch: {rel}")
    problems += [f"not in manifest: {rel}" for rel in present if rel not in listed]
    return problems


def compare_counts(expected: Any, actual: Any, path: str = "") -> list[str]:
    """Differences between two nested count trees (dicts of ints)."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        problems = []
        for key in sorted(set(expected) | set(actual)):
            where = f"{path}/{key}" if path else str(key)
            if key not in actual:
                problems.append(f"{where}: missing after restore")
            elif key not in expected:
                problems.append(f"{where}: not in the backup")
            else:
                problems += compare_counts(expected[key], actual[key], where)
        return problems
    return [] if expected == actual else [f"{path}: expected {expected}, found {actual}"]


def write(root: Path, manifest: dict[str, Any]) -> None:
    (root / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def read(root: Path) -> dict[str, Any]:
    manifest = json.loads((root / MANIFEST).read_text())
    if manifest.get("format") != FORMAT:
        raise ValueError(f"unsupported manifest format: {manifest.get('format')}")
    return manifest
```

`scripts/datakit/target.py`:

```python
"""Where the stores are: containers and volumes of a stack, overridable by name."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATABASES = ("visualex_platform", "merlt")
DEFAULT_VOLUMES = ("merlt_uploads", "merlt_checkpoints", "merlt_ner_models")
# Owner role of each database in the stack (infra/postgres/init).
DB_OWNERS = {"visualex_platform": "visualex", "visualex_test": "visualex", "merlt": "merlt"}


@dataclass(frozen=True)
class Target:
    stack: str
    compose_file: Path
    pg_container: str
    pg_user: str
    databases: tuple[str, ...]
    falkor_container: str
    qdrant_url: str
    volume_prefix: str
    volumes: tuple[str, ...]

    @classmethod
    def for_stack(cls, stack: str | None = None, **overrides) -> "Target":
        stack = stack or os.environ.get("VISUALEX_STACK", "visualex")
        values = {
            "stack": stack,
            "compose_file": REPO_ROOT / "infra" / "compose.yml",
            "pg_container": f"{stack}-postgres",
            "pg_user": "postgres",
            "databases": DEFAULT_DATABASES,
            "falkor_container": f"{stack}-falkordb",
            "qdrant_url": f"http://127.0.0.1:{os.environ.get('VISUALEX_QDRANT_PORT', '6343')}",
            "volume_prefix": f"{stack}_",
            "volumes": DEFAULT_VOLUMES,
        }
        values.update({key: value for key, value in overrides.items() if value is not None})
        return cls(**values)
```

- [ ] **Step 4: Run the unit tests**

Run: `(cd "$WT" && services/visualex/.venv/bin/python -m pytest scripts/datakit/tests/test_manifest.py -q)`
Expected: `8 passed`.

- [ ] **Step 5: Write the roundtrip test**

`scripts/datakit/tests/test_roundtrip.py`:

```python
"""Backup → wipe → restore → restart → verify, on a throwaway stack.

Needs Docker: run with DATAKIT_DOCKER_TESTS=1. The stack is
'datakit-selftest' on its own ports; the development stack is not touched.
"""
import json
import os
import subprocess
import urllib.request

import pytest

from datakit import cli
from datakit.target import REPO_ROOT

pytestmark = pytest.mark.skipif(
    os.environ.get("DATAKIT_DOCKER_TESTS") != "1", reason="needs Docker: set DATAKIT_DOCKER_TESTS=1"
)

STACK = "datakit-selftest"
PORTS = {
    "VISUALEX_PG_PORT": "55436", "VISUALEX_REDIS_PORT": "56381", "VISUALEX_FALKOR_PORT": "56382",
    "VISUALEX_QDRANT_PORT": "56343", "VISUALEX_QDRANT_GRPC_PORT": "56344",
}
COMPOSE = ["docker", "compose", "-f", str(REPO_ROOT / "infra" / "compose.yml"), "-p", STACK]
STORES = ["postgres", "falkordb", "qdrant"]
QDRANT = f"http://127.0.0.1:{PORTS['VISUALEX_QDRANT_PORT']}"
TARGET = ["--stack", STACK, "--volumes", "merlt_uploads"]


def sh(*args):
    return subprocess.run(list(args), check=True, capture_output=True, text=True).stdout


def qdrant(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(QDRANT + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())


@pytest.fixture(scope="module")
def stack():
    assert STACK != "visualex"
    saved = dict(os.environ)
    os.environ.update(PORTS, VISUALEX_STACK=STACK)
    sh(*COMPOSE, "up", "-d", "--wait", *STORES)
    try:
        yield
    finally:
        subprocess.run([*COMPOSE, "down", "-v"], check=False, capture_output=True)
        subprocess.run(["docker", "volume", "rm", "-f", f"{STACK}_merlt_uploads"], check=False, capture_output=True)
        os.environ.clear()
        os.environ.update(saved)


def seed():
    for db in ("visualex_platform", "merlt"):
        sh("docker", "exec", f"{STACK}-postgres", "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1",
           "-c", "CREATE TABLE notes (id int primary key, body text); INSERT INTO notes VALUES (1,'a'),(2,'b'),(3,'c');")
    sh("docker", "exec", f"{STACK}-falkordb", "redis-cli", "GRAPH.QUERY", "g", "CREATE (:A {x:1})-[:R]->(:B {x:2})")
    qdrant("PUT", "/collections/c", {"vectors": {"size": 4, "distance": "Cosine"}})
    qdrant("PUT", "/collections/c/points?wait=true",
           {"points": [{"id": i, "vector": [0.1 * i, 0.2, 0.3, 0.4]} for i in (1, 2, 3)]})
    sh("docker", "volume", "create", "--label", f"com.docker.compose.project={STACK}",
       "--label", "com.docker.compose.volume=merlt_uploads", f"{STACK}_merlt_uploads")
    sh("docker", "run", "--rm", "-v", f"{STACK}_merlt_uploads:/v", "alpine:3.20",
       "sh", "-c", "echo note > /v/a.txt && mkdir /v/d && echo n > /v/d/b.txt")


def wipe():
    sh(*COMPOSE, "down", "-v")
    subprocess.run(["docker", "volume", "rm", "-f", f"{STACK}_merlt_uploads"], check=False, capture_output=True)
    sh(*COMPOSE, "up", "-d", "--wait", *STORES)


def test_backup_restore_roundtrip(stack, tmp_path):
    seed()
    out = tmp_path / "backup"
    assert cli.main(["backup", *TARGET, "--out", str(out)]) == 0
    stores = json.loads((out / "manifest.json").read_text())["stores"]
    assert stores["postgres"]["counts"] == {"visualex_platform": {"notes": 3}, "merlt": {"notes": 3}}
    assert stores["falkordb"]["counts"] == {"g": {"nodes": 2, "edges": 1}}
    assert stores["qdrant"]["counts"] == {"c": 3}
    assert stores["volumes"]["counts"] == {"merlt_uploads": 2}

    wipe()
    assert cli.main(["restore", str(out), *TARGET]) == 0

    # The AOF trap: a plain restart must bring the graph back, not an empty one.
    sh(*COMPOSE, "restart", "falkordb")
    sh(*COMPOSE, "up", "-d", "--wait", "falkordb")
    assert cli.main(["verify", str(out), *TARGET]) == 0

    # Restoring over stores that now hold data must refuse.
    with pytest.raises(RuntimeError, match="not empty|exists"):
        cli.main(["restore", str(out), *TARGET])
```

Run: `(cd "$WT" && DATAKIT_DOCKER_TESTS=1 services/visualex/.venv/bin/python -m pytest scripts/datakit/tests/test_roundtrip.py -q)`
Expected: FAIL — `ImportError: cannot import name 'cli'`.

- [ ] **Step 6: Write the helpers and the four stores**

`scripts/datakit/sh.py`:

```python
"""Subprocess helpers: every call is echoed and a failure raises."""
from __future__ import annotations

import subprocess
import sys
from typing import IO, Sequence


def run(args: Sequence[str], *, stdin: IO | None = None, stdout: IO | None = None,
        env: dict | None = None) -> str:
    args = [str(a) for a in args]
    print("+", " ".join(args), file=sys.stderr)
    captured = stdout is None
    result = subprocess.run(args, stdin=stdin, stdout=subprocess.PIPE if captured else stdout,
                            stderr=subprocess.PIPE, env=env, text=captured, check=False)
    if result.returncode != 0:
        err = result.stderr if isinstance(result.stderr, str) else result.stderr.decode(errors="replace")
        raise RuntimeError(f"{' '.join(args[:3])} failed ({result.returncode}): {err.strip()}")
    return result.stdout if captured else ""


def image_of(container: str) -> str:
    return run(["docker", "inspect", "-f", "{{.Config.Image}}", container]).strip()
```

`scripts/datakit/stores/__init__.py`: empty file.

`scripts/datakit/stores/postgres.py`:

```python
"""Postgres: pg_dump -Fc per database, pg_restore into an empty database."""
from __future__ import annotations

from pathlib import Path

from datakit.sh import image_of, run
from datakit.target import DB_OWNERS, Target


def _psql(t: Target, db: str, sql: str) -> str:
    return run(["docker", "exec", t.pg_container, "psql", "-U", t.pg_user, "-d", db,
                "-AtF", "|", "-v", "ON_ERROR_STOP=1", "-c", sql])


def tables(t: Target, db: str) -> list[str]:
    out = _psql(t, db, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
    return [line for line in out.splitlines() if line]


def count(t: Target) -> dict:
    counts = {}
    for db in t.databases:
        names = tables(t, db)
        if not names:
            counts[db] = {}
            continue
        union = " UNION ALL ".join(
            "SELECT '{0}', count(*) FROM public.\"{1}\"".format(n.replace("'", "''"), n.replace('"', '""'))
            for n in names
        )
        rows = [row.split("|") for row in _psql(t, db, union).splitlines() if row]
        counts[db] = {name: int(n) for name, n in rows}
    return counts


def backup(t: Target, out: Path) -> dict:
    folder = out / "postgres"
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    for db in t.databases:
        with (folder / f"{db}.dump").open("wb") as handle:
            run(["docker", "exec", t.pg_container, "pg_dump", "-U", t.pg_user, "-Fc", db], stdout=handle)
    return {"image": image_of(t.pg_container), "databases": list(t.databases), "counts": counts}


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    for db in entry["databases"]:
        if tables(t, db) and not force:
            raise RuntimeError(f"postgres/{db} is not empty: pass --force to replace it")
        args = ["docker", "exec", "-i", t.pg_container, "pg_restore", "-U", t.pg_user, "-d", db,
                "--no-owner", "--no-privileges", f"--role={DB_OWNERS.get(db, t.pg_user)}", "--exit-on-error"]
        if force:
            args += ["--clean", "--if-exists"]
        with (src / "postgres" / f"{db}.dump").open("rb") as handle:
            run(args, stdin=handle)
```

`scripts/datakit/stores/falkordb.py`:

```python
"""FalkorDB: an RDB snapshot taken over the replication protocol.

The restore is the delicate part. With append-only persistence on and no AOF
on disk, Redis starts EMPTY and ignores dump.rdb — and its next save would
overwrite the snapshot. So the container starts once with append-only off,
loads the snapshot, rewrites it as an AOF (CONFIG SET appendonly yes), and
only then restarts with the normal settings.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from datakit.sh import image_of, run
from datakit.target import Target

LOAD_ARGS = "--save 60 1 --appendonly no"
TMP = "/tmp/datakit-dump.rdb"


def _cli(container: str, *args: str) -> str:
    return run(["docker", "exec", container, "redis-cli", *args])


def _first_int(output: str) -> int:
    for line in output.splitlines():
        if line.strip().isdigit():
            return int(line.strip())
    raise RuntimeError(f"no count in the FalkorDB answer: {output!r}")


def count(t: Target) -> dict:
    counts = {}
    for graph in [g for g in _cli(t.falkor_container, "GRAPH.LIST").splitlines() if g]:
        counts[graph] = {
            "nodes": _first_int(_cli(t.falkor_container, "GRAPH.RO_QUERY", graph, "MATCH (n) RETURN count(n)")),
            "edges": _first_int(_cli(t.falkor_container, "GRAPH.RO_QUERY", graph, "MATCH ()-[r]->() RETURN count(r)")),
        }
    return counts


def backup(t: Target, out: Path) -> dict:
    folder = out / "falkordb"
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    run(["docker", "exec", t.falkor_container, "redis-cli", "--rdb", TMP])
    run(["docker", "cp", f"{t.falkor_container}:{TMP}", str(folder / "dump.rdb")])
    run(["docker", "exec", t.falkor_container, "rm", "-f", TMP])
    return {"image": image_of(t.falkor_container), "counts": counts}


def _compose(t: Target, *args: str, falkordb_args: str | None = None) -> None:
    env = dict(os.environ, VISUALEX_STACK=t.stack)
    env.pop("FALKORDB_ARGS", None)
    if falkordb_args:
        env["FALKORDB_ARGS"] = falkordb_args
    run(["docker", "compose", "-f", str(t.compose_file), "-p", t.stack, *args], env=env)


def _wait_for_aof(container: str, timeout: float = 900) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        info = _cli(container, "INFO", "persistence")
        if all(flag in info for flag in ("aof_enabled:1", "aof_rewrite_in_progress:0",
                                          "aof_rewrite_scheduled:0", "aof_last_bgrewrite_status:ok")):
            return
        time.sleep(1)
    raise RuntimeError("FalkorDB did not finish writing its AOF")


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    if any(g["nodes"] for g in count(t).values()) and not force:
        raise RuntimeError("falkordb is not empty: pass --force to replace it")
    _compose(t, "stop", "falkordb")
    run(["docker", "run", "--rm", "-v", f"{t.volume_prefix}falkordb_data:/data",
         "-v", f"{(src / 'falkordb').resolve()}:/in:ro", "alpine:3.20",
         "sh", "-c", "rm -rf /data/* && cp /in/dump.rdb /data/dump.rdb"])
    _compose(t, "up", "-d", "--wait", "--force-recreate", "falkordb", falkordb_args=LOAD_ARGS)
    _cli(t.falkor_container, "CONFIG", "SET", "appendonly", "yes")
    _wait_for_aof(t.falkor_container)
    _compose(t, "up", "-d", "--wait", "--force-recreate", "falkordb")
```

`scripts/datakit/stores/qdrant.py`:

```python
"""Qdrant: one snapshot per collection, through its HTTP API."""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from datakit.sh import run
from datakit.target import Target


def _call(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read() or b"{}")


def collections(t: Target) -> list[str]:
    return sorted(c["name"] for c in _call("GET", f"{t.qdrant_url}/collections")["result"]["collections"])


def count(t: Target) -> dict:
    return {c: _call("POST", f"{t.qdrant_url}/collections/{c}/points/count", {"exact": True})["result"]["count"]
            for c in collections(t)}


def backup(t: Target, out: Path) -> dict:
    folder = out / "qdrant"
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    for c in counts:
        name = _call("POST", f"{t.qdrant_url}/collections/{c}/snapshots?wait=true")["result"]["name"]
        urllib.request.urlretrieve(f"{t.qdrant_url}/collections/{c}/snapshots/{name}", folder / f"{c}.snapshot")
        _call("DELETE", f"{t.qdrant_url}/collections/{c}/snapshots/{name}?wait=true")
    return {"version": _call("GET", f"{t.qdrant_url}/").get("version", "unknown"), "counts": counts}


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    existing = set(collections(t))
    for c in entry["counts"]:
        if c in existing and not force:
            raise RuntimeError(f"qdrant/{c} exists: pass --force to replace it")
        run(["curl", "-sS", "--fail-with-body", "-X", "POST",
             f"{t.qdrant_url}/collections/{c}/snapshots/upload?priority=snapshot&wait=true",
             "-F", f"snapshot=@{src / 'qdrant' / (c + '.snapshot')}"])
```

`scripts/datakit/stores/volumes.py`:

```python
"""Docker volumes of files (uploads, model artefacts): one tar per volume."""
from __future__ import annotations

from pathlib import Path

from datakit.sh import run
from datakit.target import Target

HELPER = "alpine:3.20"


def _exists(volume: str) -> bool:
    try:
        run(["docker", "volume", "inspect", volume])
        return True
    except RuntimeError:
        return False


def _files(volume: str) -> int:
    return int(run(["docker", "run", "--rm", "-v", f"{volume}:/v:ro", HELPER,
                    "sh", "-c", "find /v -type f | wc -l"]).strip())


def count(t: Target) -> dict:
    return {v: _files(t.volume_prefix + v) for v in t.volumes if _exists(t.volume_prefix + v)}


def backup(t: Target, out: Path) -> dict:
    folder = (out / "volumes").resolve()
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    for v in counts:
        run(["docker", "run", "--rm", "-v", f"{t.volume_prefix + v}:/src:ro", "-v", f"{folder}:/out", HELPER,
             "tar", "czf", f"/out/{v}.tgz", "-C", "/src", "."])
    return {"counts": counts}


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    folder = (src / "volumes").resolve()
    for v in entry["counts"]:
        volume = t.volume_prefix + v
        if not _exists(volume):
            # Labelled like Compose's own, so Compose adopts it without warnings.
            run(["docker", "volume", "create", "--label", f"com.docker.compose.project={t.stack}",
                 "--label", f"com.docker.compose.volume={v}", volume])
        elif _files(volume) and not force:
            raise RuntimeError(f"volume {volume} is not empty: pass --force to replace it")
        run(["docker", "run", "--rm", "-v", f"{volume}:/dst", "-v", f"{folder}:/in:ro", HELPER,
             "sh", "-c", f"find /dst -mindepth 1 -delete && tar xzf /in/{v}.tgz -C /dst"])
```

- [ ] **Step 7: Write the command line and the two wrappers**

`scripts/datakit/cli.py`:

```python
#!/usr/bin/env python3
"""datakit — export and import every VisuaLex data store.

  backup  [--out DIR]          one dated folder: a native export per store + manifest.json
  restore DIR [--force]        check the manifest, load the stores, compare the counts
  verify  DIR                  compare the live counts and the files with the manifest
"""
from __future__ import annotations

import argparse
import datetime as dt
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from datakit import manifest  # noqa: E402
from datakit.stores import falkordb, postgres, qdrant, volumes  # noqa: E402
from datakit.target import REPO_ROOT, Target  # noqa: E402

STORES = {"postgres": postgres, "falkordb": falkordb, "qdrant": qdrant, "volumes": volumes}


def _split(value):
    return tuple(value.split(",")) if value else None


def _target(args) -> Target:
    return Target.for_stack(
        args.stack, pg_container=args.pg_container, pg_user=args.pg_user, databases=_split(args.databases),
        falkor_container=args.falkor_container, qdrant_url=args.qdrant_url,
        volume_prefix=args.volume_prefix, volumes=_split(args.volumes),
    )


def _git_commit() -> str:
    try:
        return subprocess.run(["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _live_counts(t: Target, name: str, entry: dict) -> dict:
    if name == "postgres":
        t = replace(t, databases=tuple(entry["databases"]))
    elif name == "volumes":
        t = replace(t, volumes=tuple(entry["counts"]))
    return STORES[name].count(t)


def _compare(t: Target, m: dict, names) -> list[str]:
    problems = []
    for name in names:
        entry = m["stores"][name]
        problems += [f"{name}: {p}" for p in manifest.compare_counts(entry["counts"], _live_counts(t, name, entry))]
    return problems


def cmd_backup(args) -> int:
    t = _target(args)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path(args.out or Path.home() / "visualex-backups" / f"{t.stack}-{stamp}").expanduser()
    out.mkdir(parents=True, exist_ok=False)
    stores = {}
    for name in args.stores.split(","):
        print(f"== backup {name}", file=sys.stderr)
        stores[name] = STORES[name].backup(t, out)
    manifest.write(out, {
        "format": manifest.FORMAT,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": {"stack": t.stack, "git_commit": _git_commit()},
        "stores": stores,
        "files": manifest.index_files(out),
    })
    print(out)
    return 0


def cmd_restore(args) -> int:
    src = Path(args.folder).expanduser()
    m = manifest.read(src)
    damaged = manifest.verify_files(src, m)
    if damaged:
        print("\n".join(damaged), file=sys.stderr)
        return 2
    t = _target(args)
    names = [n for n in (args.stores.split(",") if args.stores else m["stores"]) if n in m["stores"]]
    for name in names:
        print(f"== restore {name}", file=sys.stderr)
        STORES[name].restore(t, src, m["stores"][name], args.force)
    problems = _compare(t, m, names)
    print("\n".join(problems) if problems else "restore verified: counts match", file=sys.stderr)
    return 1 if problems else 0


def cmd_verify(args) -> int:
    src = Path(args.folder).expanduser()
    m = manifest.read(src)
    problems = manifest.verify_files(src, m) + _compare(_target(args), m, list(m["stores"]))
    print("\n".join(problems) if problems else "verified: files intact, counts match", file=sys.stderr)
    return 1 if problems else 0


def main(argv=None) -> int:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--stack", help="Compose stack (default: $VISUALEX_STACK or visualex)")
    common.add_argument("--pg-container")
    common.add_argument("--pg-user")
    common.add_argument("--databases", help="comma-separated (default visualex_platform,merlt)")
    common.add_argument("--falkor-container")
    common.add_argument("--qdrant-url")
    common.add_argument("--volume-prefix")
    common.add_argument("--volumes", help="comma-separated logical names")
    parser = argparse.ArgumentParser(prog="datakit", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    backup = sub.add_parser("backup", parents=[common])
    backup.add_argument("--out")
    backup.add_argument("--stores", default="postgres,falkordb,qdrant,volumes")
    restore = sub.add_parser("restore", parents=[common])
    restore.add_argument("folder")
    restore.add_argument("--force", action="store_true")
    restore.add_argument("--stores")
    verify = sub.add_parser("verify", parents=[common])
    verify.add_argument("folder")
    args = parser.parse_args(argv)
    return {"backup": cmd_backup, "restore": cmd_restore, "verify": cmd_verify}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())
```

`scripts/backup.sh` and `scripts/restore.sh` (then `chmod +x scripts/*.sh scripts/datakit/cli.py`):

```sh
#!/bin/sh
# Export every data store of a VisuaLex stack into one dated folder.
# Options and examples: scripts/datakit/README.md
exec python3 "$(dirname "$0")/datakit/cli.py" backup "$@"
```

```sh
#!/bin/sh
# Load a backup folder into a VisuaLex stack and check the counts.
# Options and examples: scripts/datakit/README.md
exec python3 "$(dirname "$0")/datakit/cli.py" restore "$@"
```

`scripts/datakit/README.md`:

````markdown
# datakit — portable data

Data moves by export and import, never by copying a database's files.

```bash
scripts/backup.sh                          # ~/visualex-backups/visualex-<UTC time>/
scripts/restore.sh ~/visualex-backups/X    # into the stack of infra/.env; refuses non-empty stores
scripts/restore.sh X --force               # replace what is there
python3 scripts/datakit/cli.py verify X    # files intact? live counts equal?
```

A folder holds `postgres/<db>.dump` (`pg_dump -Fc`), `falkordb/dump.rdb`,
`qdrant/<collection>.snapshot`, `volumes/<volume>.tgz` and `manifest.json`
(time, commit, image versions, a sha256 per file, the counts of every store).
Redis (cache and queues) and the model download cache are not saved.

`--stack NAME` works on another stack; `--pg-container`, `--falkor-container`,
`--qdrant-url`, `--volume-prefix`, `--databases`, `--volumes` point at stores by
name, which is how a stack that does not follow `infra/compose.yml` is exported.

Backups contain personal data (accounts, notes, uploads): keep them outside the
repository, encrypted when they leave the machine.
````

- [ ] **Step 8: Run all datakit tests**

Run: `(cd "$WT" && DATAKIT_DOCKER_TESTS=1 services/visualex/.venv/bin/python -m pytest scripts/datakit/tests -q)`
Expected: `9 passed`. Then `docker ps -a --format '{{.Names}}' | grep datakit-selftest ; echo "exit=$?"` → `exit=1` (cleaned up).

- [ ] **Step 9: Commit**

```bash
git -C "$WT" add scripts
git -C "$WT" commit -F - <<'EOF'
feat(data): backup, restore and verify every store with its native export

scripts/backup.sh writes one folder per run: pg_dump per database, a
FalkorDB snapshot over the replication protocol, a Qdrant snapshot per
collection, a tar per file volume, and a manifest with a sha256 per file
and the counts of every store. scripts/restore.sh checks the manifest,
refuses non-empty stores without --force, and compares the counts after
loading. FalkorDB loads its snapshot with append-only off and rewrites the
AOF before its normal restart: with append-only on and no AOF, Redis starts
empty and would overwrite the snapshot. A roundtrip test on a throwaway
stack covers backup, wipe, restore, restart and the refusal.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 9: Move today's development data into the new stack

The first real run of `datakit`. The legacy stores are exported by name, the new stack receives them, and every count is compared. Nothing old is deleted.

**Files:** none committed (the backup folders live under `~/visualex-backups/`, outside the repository).

**Interfaces:**
- Consumes: Task 7's stack, Task 8's `backup.sh` / `restore.sh` / `cli.py verify`; the Task 6 version of `infra/compose.yml` (project `visualexapi`, containers `visualex-merlt-*`).

- [ ] **Step 1: Bring up the legacy stores (and nothing that writes to them)**

```bash
git -C "$WT" show develop:infra/compose.yml > "$WORK/legacy-compose.yml"
grep -n "^name: visualexapi" "$WORK/legacy-compose.yml"
docker stop visualex-merlt-api visualex-merlt-worker 2>/dev/null || true
docker compose -f "$WORK/legacy-compose.yml" -p visualexapi up -d --wait merlt-postgres merlt-falkordb merlt-qdrant
```

Expected: the `name:` line; three healthy containers on today's volumes `visualexapi_merlt_*`.

- [ ] **Step 2: Export the legacy MERL-T stores**

```bash
LEGACY="$HOME/visualex-backups/legacy-merlt-$(date -u +%Y%m%dT%H%M%SZ)"
"$WT/scripts/backup.sh" --stack visualexapi --out "$LEGACY" \
  --pg-container visualex-merlt-postgres --pg-user merlt --databases merlt \
  --falkor-container visualex-merlt-falkordb --qdrant-url http://127.0.0.1:6343 \
  --volume-prefix visualexapi_ --volumes merlt_uploads,merlt_checkpoints,merlt_ner_models
python3 -c "import json,sys; s=json.load(open(sys.argv[1]))['stores']; print(s['falkordb']['counts'], s['qdrant']['counts'], s['volumes']['counts'])" "$LEGACY/manifest.json"
```

Expected: the folder path; the graph `merl_t_legal` with about 27,700 nodes, the collection `merl_t_legal_chunks` with its points, the three volumes' file counts. Write these numbers down.

- [ ] **Step 3: Export the platform database from the host Postgres 14, with its counts**

```bash
pg_dump -Fc -d visualex_platform -f "$WORK/visualex_platform.dump"
psql -d visualex_platform -Atc "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1" > "$WORK/platform-tables.txt"
while read -r t; do printf '%s|%s\n' "$t" "$(psql -d visualex_platform -Atc "SELECT count(*) FROM public.\"$t\"")"; done < "$WORK/platform-tables.txt" > "$WORK/platform-before.txt"
wc -l < "$WORK/platform-before.txt"
```

Expected: a dump file and one `table|rows` line per table.

- [ ] **Step 4: Stop the legacy stores, start the new ones**

```bash
docker compose -f "$WORK/legacy-compose.yml" -p visualexapi stop
docker compose -f "$WT/infra/compose.yml" up -d --wait postgres redis falkordb qdrant
docker volume ls --format '{{.Name}}' | grep -E '^visualex(api)?_'
```

Expected: the new volumes `visualex_postgres_data`, `visualex_falkordb_data`, `visualex_qdrant_data`, and the old `visualexapi_*` volumes still there.

- [ ] **Step 5: Restore MERL-T's stores and check the counts**

Run: `"$WT/scripts/restore.sh" "$LEGACY" --databases merlt --volumes merlt_uploads,merlt_checkpoints,merlt_ner_models`
Expected: last line `restore verified: counts match`, exit 0.

- [ ] **Step 6: Restore the platform database and compare it table by table**

```bash
docker exec -i visualex-postgres pg_restore -U postgres -d visualex_platform --no-owner --no-privileges --role=visualex --exit-on-error < "$WORK/visualex_platform.dump"
while read -r t; do printf '%s|%s\n' "$t" "$(docker exec visualex-postgres psql -U postgres -d visualex_platform -Atc "SELECT count(*) FROM public.\"$t\"")"; done < "$WORK/platform-tables.txt" > "$WORK/platform-after.txt"
diff "$WORK/platform-before.txt" "$WORK/platform-after.txt" && echo platform-counts-match
```

Expected: `platform-counts-match`.

- [ ] **Step 7: Owner step — the `.env` files**

The owner, not Claude:
1. `cp infra/.env.example infra/.env`, then move into it `OPENROUTER_API_KEY` and any other Compose variable kept in the root `.env`.
2. In `apps/server/.env`, set `DATABASE_URL="postgresql://visualex:<PLATFORM_DB_PASSWORD>@localhost:5436/visualex_platform"` (`visualex` unless changed in `infra/.env`).

- [ ] **Step 8: Start everything and look**

In a separate terminal: `MERLT_ENABLED=true ./start.sh` from `$WT`. Then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/health/detailed
curl -s http://localhost:3001/api/merlt/health
```

Expected: `200`; MERL-T health with the graph node count of Step 2. The owner logs in at `http://localhost:5173` and sees their own dossiers and notes.

- [ ] **Step 9: The first backup of the new stack**

```bash
NEW=$("$WT/scripts/backup.sh" | tail -1)
python3 "$WT/scripts/datakit/cli.py" verify "$NEW"
```

Expected: `verified: files intact, counts match`. Keep `$NEW`: Task 16 restores it into a fresh clone.

- [ ] **Step 10: Pull request into `develop` for Tasks 7–9**

```bash
git -C "$WT" push -u origin feat/portable-data
gh pr create --repo capazme/VisuaLexAPI --base develop --head feat/portable-data \
  --title "merge: feat/portable-data — one stack with fixed names and portable data" \
  --body "Spec §6. Development data moved with the new scripts; every count matched. Old volumes and the host database are untouched.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

When CI is green: `gh pr merge --repo capazme/VisuaLexAPI --merge --delete-branch --subject "merge: feat/portable-data — one stack with fixed names and portable data"`, then `git -C "$WT" switch develop && git -C "$WT" pull --ff-only`.

---

## Phase 5 — Rules and documents

### Task 10: Shared Claude Code rules

**Files:**
- Create: `.claude/settings.json`, `.claude/hooks/guard.mjs`
- Test: `.claude/hooks/guard.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `decide(command: string, branchOf: (dir: string | null) => string): string | null` — `null` allows, a string is the refusal shown to Claude. `PROTECTED = ['main', 'develop']`.

> The owner's personal hook reads the text of shell commands: a command that *contains* a force-push to `main` is refused even inside a test string. Write these files with the editor, not with a shell heredoc.

- [ ] **Step 1: Branch and open `.claude/` to git**

```bash
git -C "$WT" switch -c chore/shared-claude-rules develop
```

In `.gitignore`, the line `.claude` becomes:

```gitignore
# Claude Code: personal files stay local; the shared rules are versioned.
.claude/*
!.claude/settings.json
!.claude/hooks/
CLAUDE.local.md
*.code-workspace
```

- [ ] **Step 2: Check what is and is not ignored**

```bash
cd "$WT" && for p in apps/server/.env services/visualex/.env infra/.env CLAUDE.local.md .claude/settings.local.json .claude/launch.json; do git check-ignore -q "$p" || echo "NOT IGNORED: $p"; done
cd "$WT" && git check-ignore .claude/settings.json .claude/hooks/guard.mjs ; echo "exit=$?"
```

Expected: no `NOT IGNORED` line; the second command prints nothing and `exit=1`.

- [ ] **Step 3: Write the failing tests**

`.claude/hooks/guard.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './guard.mjs';

// branchOf stub: the current branch, or the branch of a `git -C <dir>` target.
const on = (branch, dirs = {}) => (dir) => (dir ? dirs[dir] ?? branch : branch);

const denied = [
  ['git commit -m x', on('develop')],
  ['git add -A && git commit -m x', on('main')],
  ['git -C /repo commit -m x', on('feat/x', { '/repo': 'main' })],
  ['git push origin main', on('feat/x')],
  ['git push origin HEAD:develop', on('feat/x')],
  ['git push --force origin +feat/x:main', on('feat/x')],
  ['git push', on('develop')],
  ['git push origin HEAD', on('main')],
  ['git push --all origin', on('feat/x')],
  ['git push origin --delete develop', on('feat/x')],
  ['git push origin :main', on('feat/x')],
  ['npx prisma migrate dev --name add_x', on('feat/x')],
  ['cd apps/server && npx prisma migrate reset --force', on('feat/x')],
  ['npx prisma db push --force-reset', on('feat/x')],
];

const allowed = [
  ['git commit -m x', on('feat/x')],
  ['git commit --dry-run', on('main')],
  ['git push -u origin feat/x', on('feat/x')],
  ['git push --force-with-lease origin feat/x', on('feat/x')],
  ['git push origin v2.0.0', on('develop')],
  ['git push origin --tags', on('develop')],
  ['git log --oneline main..develop', on('develop')],
  ['git switch develop && git pull --ff-only', on('main')],
  ['npx prisma migrate deploy', on('develop')],
  ['npx prisma migrate status', on('develop')],
  ['npm test', on('develop')],
  ['echo "git commit is refused on main"', on('main')],
];

for (const [command, branchOf] of denied) {
  test(`denies: ${command}`, () => assert.ok(decide(command, branchOf)));
}
for (const [command, branchOf] of allowed) {
  test(`allows: ${command}`, () => assert.equal(decide(command, branchOf), null));
}
```

Run: `node --test "$WT/.claude/hooks/"`
Expected: FAIL — `Cannot find module` … `guard.mjs`.

- [ ] **Step 4: Write the hook**

`.claude/hooks/guard.mjs`:

```js
#!/usr/bin/env node
// PreToolUse hook (Bash), shared by everyone who opens this repository with
// Claude Code: the git flow and the database rules of docs/git-workflow.md.
// GitHub enforces the branch rules too; this says so before the round trip.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROTECTED = ['main', 'develop'];

// migrate dev offers to reset a drifted database, and an agent can accept.
const MIGRATE = /\bprisma\s+migrate\s+(dev|reset)\b/;
const FORCE_RESET = /\bprisma\s+db\s+push\b[^;&|]*--force-reset/;

function segments(command) {
  return command.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);
}

function gitCall(tokens) {
  if (tokens[0] !== 'git') return null;
  let i = 1;
  let dir = null;
  while (i < tokens.length && tokens[i].startsWith('-')) {
    if (tokens[i] === '-C') { dir = tokens[i + 1]; i += 2; continue; }
    if (tokens[i] === '-c') { i += 2; continue; }
    i += 1;
  }
  return { sub: tokens[i], args: tokens.slice(i + 1), dir };
}

function pushTargets(args, branch) {
  const flags = args.filter((a) => a.startsWith('-'));
  if (flags.includes('--all') || flags.includes('--mirror')) return PROTECTED;
  const refspecs = args.filter((a) => !a.startsWith('-')).slice(1); // [0] is the remote
  if (refspecs.length === 0) {
    const onlyTagsOrDelete = flags.includes('--tags') || flags.includes('--delete') || flags.includes('-d');
    return onlyTagsOrDelete ? [] : [branch];
  }
  return refspecs.map((spec) => {
    const s = spec.replace(/^\+/, '');
    const dst = (s.includes(':') ? s.split(':')[1] : s).replace(/^refs\/heads\//, '');
    return dst === 'HEAD' ? branch : dst;
  });
}

export function decide(command, branchOf) {
  for (const segment of segments(command)) {
    if (MIGRATE.test(segment) || FORCE_RESET.test(segment)) {
      return 'prisma migrate dev/reset and db push --force-reset can wipe the development database. '
        + 'Write the migration by hand and apply it with `npx prisma migrate deploy` (apps/server/CLAUDE.md).';
    }
    const call = gitCall(segment.split(/\s+/));
    if (!call) continue;
    const branch = branchOf(call.dir);
    if (call.sub === 'commit' && !call.args.includes('--dry-run') && PROTECTED.includes(branch)) {
      return `Commits do not go on ${branch}: create a branch from develop (feat/, fix/, refactor/, chore/, docs/) `
        + 'and open a pull request (docs/git-workflow.md).';
    }
    if (call.sub === 'push') {
      const hit = pushTargets(call.args, branch).find((target) => PROTECTED.includes(target));
      if (hit) return `Nothing is pushed to ${hit} directly: it changes only through a pull request (docs/git-workflow.md).`;
    }
  }
  return null;
}

function branchResolver(cwd) {
  return (dir) => {
    try {
      return execFileSync('git', ['-C', dir ? path.resolve(cwd, dir) : cwd, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
}

function main() {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const reason = decide(input?.tool_input?.command ?? '', branchResolver(input?.cwd ?? process.cwd()));
  if (reason) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
```

Run: `node --test "$WT/.claude/hooks/"`
Expected: `# pass 26`, `# fail 0`.

- [ ] **Step 5: The settings file**

`.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.mjs\"",
            "timeout": 10
          }
        ]
      }
    ]
  },
  "permissions": {
    "deny": [
      "Read(**/.env)",
      "Edit(**/.env)",
      "Read(**/.env.local)",
      "Edit(**/.env.local)"
    ]
  }
}
```

- [ ] **Step 6: Run the hook the way Claude Code does**

```bash
printf '%s' "{\"tool_input\":{\"command\":\"git commit -m x\"},\"cwd\":\"$MAIN\"}" | node "$WT/.claude/hooks/guard.mjs"; echo
printf '%s' "{\"tool_input\":{\"command\":\"git commit -m x\"},\"cwd\":\"$WT\"}" | node "$WT/.claude/hooks/guard.mjs"; echo "exit=$?"
```

Expected: the first prints a JSON with `"permissionDecision":"deny"` (`$MAIN` is on `main`); the second prints nothing and `exit=0` (`$WT` is on `chore/shared-claude-rules`).

- [ ] **Step 7: Commit**

```bash
git -C "$WT" add .gitignore .claude/settings.json .claude/hooks
git -C "$WT" commit -F - <<'EOF'
chore(claude): shared hooks and permissions for everyone using Claude Code here

.claude/settings.json is versioned now (the rest of .claude/ stays local).
A Bash hook refuses commits on main and develop, pushes to them, and
prisma migrate dev/reset or db push --force-reset, pointing to the
documented procedure; reading or editing .env files is denied. The hook is
tested on the commands it must refuse and on ordinary ones it must allow.
CLAUDE.local.md and editor workspaces are ignored.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 11: Layered `CLAUDE.md`

The text of today's root file moves, verbatim except for paths, into the area files; only the root is rewritten. A check proves every section landed somewhere or was retired by name.

**Files:**
- Rewrite: `CLAUDE.md`
- Create: `apps/web/CLAUDE.md`, `apps/server/CLAUDE.md`, `services/visualex/CLAUDE.md`, `tools/archivio-normativo/CLAUDE.md`, `docs/merlt/claude-notes.md`
- Modify: `services/merlt/CLAUDE.md` (paths, pointer)
- Create (throwaway): `$WORK/claude_coverage.py`

- [ ] **Step 1: Branch and keep the old text**

```bash
git -C "$WT" switch -c docs/layered-claude-md develop
git -C "$WT" show develop:CLAUDE.md > "$WORK/CLAUDE.old.md"
```

- [ ] **Step 2: Write the coverage check**

`$WORK/claude_coverage.py`:

```python
"""Every ##/### heading of the old CLAUDE.md must appear in a new file or be retired."""
import re
import sys
from pathlib import Path

RETIRED = {  # rewritten in the new root, or removed on purpose
    "project overview", "branches and deployment", "development commands",
    "working in this repo", "second brain", "architecture",
}


def headings(text: str) -> list[str]:
    found, fenced = [], False
    for line in text.splitlines():
        if line.startswith("```"):
            fenced = not fenced
        elif not fenced and re.match(r"#{2,3} ", line):
            found.append(normalise(line.lstrip("#")))
    return found


def normalise(title: str) -> str:
    title = re.sub(r"\(.*?\)|`", "", title)
    return re.sub(r"\s+", " ", title.split("—")[0]).strip().lower()


def main(old: Path, new_files: list[Path]) -> int:
    present = set()
    for path in new_files:
        present.update(headings(path.read_text()))
    missing = [h for h in headings(old.read_text()) if h not in present and not any(h.startswith(r) for r in RETIRED)]
    for h in missing:
        print(f"NOT CARRIED: {h}")
    print(f"{len(missing)} not carried")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1]), [Path(p) for p in sys.argv[2:]]))
```

- [ ] **Step 3: Move each section to its area**

Copy each section of `$WORK/CLAUDE.old.md` — heading and body, verbatim — into its destination, in this order of the old file:

| Old section | Destination |
| --- | --- |
| `## Project Overview`, `## Branches and Deployment`, `## Development Commands`, `## Working in this repo` | not copied: the new root (Step 5) replaces them |
| `## Archivio normativo` | `tools/archivio-normativo/CLAUDE.md` |
| `### Python API` | `services/visualex/CLAUDE.md` |
| `### Node backend` | `apps/server/CLAUDE.md` |
| `### Frontend` | `apps/web/CLAUDE.md` |
| the twelve `### MERL-T …` sections (from `MERL-T Integration` to `MERL-T gotchas learned 2026-09-25`) | `docs/merlt/claude-notes.md` |
| `## Key API Endpoints`, `## Date System`, `## Scraping Architecture`, `### Async rules (Python)` | `services/visualex/CLAUDE.md` |
| `## Frontend State` with `### How the collections differ`, `### Aliases`, `### Reading surface`, `### Dossier`; `## UI Conventions` | `apps/web/CLAUDE.md` |
| `## Shared utilities — check before writing a new one` | its **Python** paragraph → `services/visualex/CLAUDE.md`; its **Frontend** list → `apps/web/CLAUDE.md` (same heading in both) |
| `## Common Patterns` | new scraper, new API endpoint, Playwright work → `services/visualex/CLAUDE.md`; new frontend component → `apps/web/CLAUDE.md` (same heading in both) |
| `## Environment Variables` | **Python API** paragraph (with the `lxml` note) → `services/visualex/CLAUDE.md`; **Node backend** paragraph → `apps/server/CLAUDE.md` |
| `## Critical Files` | **Python** → `services/visualex/CLAUDE.md`; **Frontend core** and **Frontend features** → `apps/web/CLAUDE.md`; **Backend** → `apps/server/CLAUDE.md` |
| `## Gotchas` | 1–8 and 24 → `services/visualex/CLAUDE.md`; 9 → both `services/visualex/CLAUDE.md` and `apps/web/CLAUDE.md`; 10–22 and 25–29 → `apps/web/CLAUDE.md`; 23 → the new root. Keep each gotcha's number. |
| `## Second brain (vault Obsidian)` | not copied: private, it belongs in each developer's `CLAUDE.local.md` |

Each area file starts with a one-line title and this sentence: "Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules." `apps/server/CLAUDE.md` also gets, after its backend section, the Prisma migration procedure (write by hand in `prisma/migrations/<timestamp>_<name>/migration.sql` following Prisma's naming, apply with `npx prisma migrate deploy`, then `npx prisma generate` and `npx prisma migrate status`; never `migrate dev` — it offers to reset a drifted database) and the test-harness notes (tests only through `npm test`, whose setup refuses a non-test database; nock replaced by a fetch shim; one persistent server bound to `127.0.0.1`). `apps/server/CLAUDE.md`, `apps/web/CLAUDE.md` and `services/merlt/CLAUDE.md` each get the line: "MERL-T integration across server and web (routes, gates, guards, surfaces, slice history): `docs/merlt/claude-notes.md`."

- [ ] **Step 4: Fix the paths inside the moved text**

```bash
cd "$WT" && FILES="apps/web/CLAUDE.md apps/server/CLAUDE.md services/visualex/CLAUDE.md services/merlt/CLAUDE.md tools/archivio-normativo/CLAUDE.md docs/merlt/claude-notes.md"
cd "$WT" && perl -pi -e 's#docker-compose\.merlt\.yml#infra/compose.yml#g; s#(^|[^/\w.-])frontend/#$1apps/web/#g; s#(^|[^/\w.-])backend/#$1apps/server/#g; s#(^|[^/\w.-])visualex_api/#$1services/visualex/visualex_api/#g; s#(^|[^/\w.-])archivio_normativo/#$1tools/archivio-normativo/archivio_normativo/#g; s#(^|[^/\w.-])merlt/#$1services/merlt/#g; s#(^|[^/\w.-])e2e/#$1tools/e2e/#g' $FILES
cd "$WT" && grep -nE "(^|[^/[:alnum:]_.-])(frontend|backend|e2e)/|docker-compose\.merlt|cd merlt\b" $FILES ; echo "exit=$?"
```

Expected: `exit=1`. Read the diff of `services/merlt/CLAUDE.md`: its own commands run from `services/merlt` (`cd services/merlt`); fix by hand any line the substitution got wrong.

- [ ] **Step 5: Write the new root `CLAUDE.md`**

Replace the whole file. The text between the markers is gotcha 23 of the old file, copied verbatim.

````markdown
# CLAUDE.md

Guidance for Claude Code in this repository. Everything here is meant to be
true of the code as it stands — if the code contradicts a statement, fix the
statement in the same change that taught you.

This file is the map and the rules that cross areas. Each area has its own
`CLAUDE.md`, which Claude Code loads when it works in that folder: read it
before changing the area.

## What this is

VisuaLex reads Italian legal texts from Normattiva, EUR-Lex and Brocardi and
lets a lawyer work on them: dossiers, notes, highlights, discussions, and a
knowledge graph with interpretive experts (MERL-T). UI copy is Italian; code,
comments, commits and documentation are English. The people who develop here
are lawyers first: say plainly when a change carries an architectural or
security risk.

## Layout

| Path | What | Read first |
| --- | --- | --- |
| `apps/web/` | React 19 + Vite + TypeScript: reader, workspace, dossier, forum, graph | `apps/web/CLAUDE.md` |
| `apps/server/` | Express + Prisma: accounts, dossier, community, the MERL-T gateway | `apps/server/CLAUDE.md` |
| `services/visualex/` | Quart: sources, reading text, URNs, citations, AKN | `services/visualex/CLAUDE.md` |
| `services/merlt/` | MERL-T and RLCF — its own licence (Apache-2.0) | `services/merlt/CLAUDE.md` |
| `tools/archivio-normativo/` | CLI: a local archive of acts | `tools/archivio-normativo/CLAUDE.md` |
| `tools/e2e/` | end-to-end and stress harness | `tools/e2e/README.md` |
| `infra/` | the Compose stack: stores and MERL-T | `infra/compose.yml` header |
| `scripts/` | data backup and restore, smoke tests | `scripts/datakit/README.md` |
| `vendor/mcp-legal-it/` | git submodule | — |
| `docs/` | git workflow, setup, MERL-T, specs and plans, archive | `docs/README.md` |

MERL-T work that spans the server and the web app: `docs/merlt/claude-notes.md`.

## Commands

```bash
./start.sh                                   # the whole stack; MERLT_ENABLED=true adds MERL-T
npm --prefix apps/web run test -- --run      # web tests
npm --prefix apps/web run build              # tsc -b + vite: the real type-check
npm --prefix apps/web run lint
npm --prefix apps/server run build
npm --prefix apps/server test                # only this way: the setup refuses a non-test database
(cd services/visualex && .venv/bin/python -m pytest tests/ -q)
(cd tools/archivio-normativo && ../../services/visualex/.venv/bin/python -m pytest tests/ -q)
node --test .claude/hooks/
scripts/backup.sh / scripts/restore.sh <folder>
```

A bare `tsc --noEmit` does not walk the project references and reports a false
green. The MERL-T suite runs in CI or against a disposable database
(`services/merlt/CLAUDE.md`), never against the development stack's.
First-time setup: `docs/setup.md`.

## Git flow — `docs/git-workflow.md`

- `main` is the released version; `develop` is where work lands and the
  default branch.
- Branch from `develop` (`feat/`, `fix/`, `refactor/`, `chore/`, `docs/`),
  open a pull request into `develop`, merge it yourself with a merge commit
  titled `merge: <branch> — <what changes>` once CI is green.
- The other developer approves changes to authentication, the Prisma schema
  and migrations, licences, `.github/`, `infra/` and the data scripts,
  `.claude/settings.json`, and `normattiva_scraper.py` (`.github/CODEOWNERS`).
- A release is a pull request `develop → main`, then a tag `vX.Y.Z`. A
  hotfix starts from `main`, returns to `main`, and `main` is merged into
  `develop` at once.
- No other long-lived branch: experiments sit behind flags.
- The shared hook (`.claude/settings.json`) refuses commits on `main` and
  `develop`, pushes to them, and `prisma migrate dev/reset`.

## Before calling work done

- The suites of every area you touched, green.
- UI work: a real browser pass on `http://localhost:5173` (login required).
- Errors you surface in files you touch are fixed, pre-existing ones too.
- Feature work runs as rounds: an interview about real use, a spec in
  `docs/superpowers/specs/`, a plan in `docs/superpowers/plans/`, then task by
  task with a review after each. `docs/archive/` is history, not guidance.

## Rules that cross areas

**Nothing private enters the repository.** It is public. No notes from the
owners' private workspaces, no infrastructure addresses, no personal paths or
names, no secrets. `.env` files are never committed and Claude does not read
them.

**Data moves by export and import.** `scripts/backup.sh` and
`scripts/restore.sh`; never copy a database's files, never delete a volume you
did not create.

<!-- gotcha 23 of the old CLAUDE.md, verbatim, with its number -->
````

After writing it, paste gotcha 23 in place of the marker line and check `wc -l "$WT/CLAUDE.md"` → under 250.

- [ ] **Step 6: Run the coverage check**

```bash
cd "$WT" && python3 "$WORK/claude_coverage.py" "$WORK/CLAUDE.old.md" CLAUDE.md apps/web/CLAUDE.md apps/server/CLAUDE.md services/visualex/CLAUDE.md services/merlt/CLAUDE.md tools/archivio-normativo/CLAUDE.md docs/merlt/claude-notes.md
grep -niE "vault|obsidian|/Users/" "$WT/CLAUDE.md" "$WT"/apps/*/CLAUDE.md "$WT"/services/*/CLAUDE.md "$WT/tools/archivio-normativo/CLAUDE.md" ; echo "exit=$?"
```

Expected: `0 not carried`; the `grep` prints nothing and `exit=1`.

- [ ] **Step 7: Commit**

```bash
git -C "$WT" add CLAUDE.md apps/web/CLAUDE.md apps/server/CLAUDE.md services/visualex/CLAUDE.md services/merlt/CLAUDE.md tools/archivio-normativo/CLAUDE.md docs/merlt/claude-notes.md
git -C "$WT" commit -F - <<'EOF'
docs(claude): a short root CLAUDE.md and one per area

The 2,050-line root file was loaded whole in every session. The root now
holds the map, the commands, the git flow, the checks before calling work
done and the rules that cross areas (the article_text offset contract);
each area's text moved verbatim, paths updated, into its own CLAUDE.md,
which Claude Code loads only when it works there. The MERL-T integration
notes live in docs/merlt/claude-notes.md. A check proved every section
landed somewhere. The block about a personal notes vault is gone: it
belongs in each developer's CLAUDE.local.md.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

### Task 12: The workflow, the setup guide, the README and the living docs

**Files:**
- Rewrite: `docs/git-workflow.md`
- Create: `docs/setup.md`
- Modify: `README.md` (sections `## Quick Start`, `## Project Structure`, `## Deployment`), `docs/README.md`, the living docs of Step 5

- [ ] **Step 1: Branch**

```bash
git -C "$WT" switch -c docs/workflow-and-setup develop
```

- [ ] **Step 2: Rewrite `docs/git-workflow.md`**

Replace the whole file:

````markdown
# Git workflow

How work moves through this repository. Everything here is meant to be true of
the repository as it stands — if the history contradicts a rule, fix the rule
in the same change that taught you. Decided on 27 September 2026, when vanilla
and the MERL-T line became one product and a second developer joined; the
history at the end says what it replaced and why.

## The shape

| Ref | What it is | Lifetime |
|---|---|---|
| `main` | The released version: what testers get. Changes only through pull requests from `develop` (releases) and `hotfix/…`. | Permanent |
| `develop` | Where work integrates. GitHub's default branch. | Permanent |
| `vX.Y.Z` tags | One per release, on `main`. `v2.0.0` is the first unified release, `v1.7.8` the last of the old line. | Permanent |
| `feat/`, `fix/`, `refactor/`, `chore/`, `docs/` | One piece of work each, from `develop`, back into `develop` by pull request, deleted on merge. | Days |
| `hotfix/…` | An urgent fix to the released version, from `main`, back into `main`. | Hours |

No other long-lived branch. Experimental work sits behind flags (MERL-T's
`MERLT_ENABLED` and its per-area flags). A research branch is opened only if
unavoidable, and it never holds a security fix.

## Day to day

1. `git switch develop && git pull --ff-only`, then `git switch -c feat/thing`.
2. Work, and commit often with Conventional Commits (`feat(scope): …`).
3. Before pushing, run the suites of the areas you touched (root `CLAUDE.md`,
   "Commands"). A branch rebases on `develop` when `develop` moves; it does not
   merge `develop` in.
4. `git push -u origin feat/thing`, then a pull request into `develop`.
5. CI must be green. If the pull request touches a path in
   `.github/CODEOWNERS`, the other developer approves it.
6. Merge it yourself with a merge commit titled `merge: feat/thing — what it
   changes`. The branch is deleted automatically.

Nothing is pushed to `develop` or `main` directly, nobody force-pushes them,
nobody deletes them: GitHub's rulesets refuse it, and the shared Claude Code
hook refuses it first.

## Code owners

The paths where one person's mistake costs everyone: authentication and
tokens, the Prisma schema and migrations, the licences, `.github/`, `infra/`
and the data scripts, the shared Claude Code rules, and the Normattiva text
extraction (its output is the offset space of every stored highlight and
note). A pull request touching them needs the other developer's approval, on
`develop` and on `main`, so a release carrying such a change is approved too.

## Release

1. On `chore/release-X.Y.Z` from `develop`, set `version.txt` to `X.Y.Z`; pull
   request into `develop`, merge.
2. Pull request `develop → main`, titled `merge: develop — release X.Y.Z`. The
   check "Release source" accepts only `develop` and `hotfix/…` as the source
   of a pull request into `main`.
3. Merge with a merge commit, then on `main`:
   `git tag -a vX.Y.Z -m "Release X.Y.Z" && git push origin vX.Y.Z`.

How a release reaches the beta machines is being designed separately.

## Hotfix

1. `git switch -c hotfix/thing origin/main`, fix, pull request into `main`.
2. Right after the merge, a pull request `main → develop`.

Until the second one lands, the check "main inside develop" is red on
`develop`: it fails whenever `main` holds a change `develop` lacks (release
merges do not count). A forgotten hotfix becomes a red check, not a fix
stranded for weeks.

## Where work strands

- **Claude Code web sessions** push `claude/…` branches: within days, open them
  as a pull request into `develop`, or delete them.
- **Desktop sessions** leave worktrees under `.claude/worktrees/`: remove them
  once their work has landed, after checking for untracked files.
- Once a month: `git fetch --prune`, `git branch -r | grep origin/claude/`,
  `git branch --merged develop`, `git worktree list`.

## History

Until 26 September 2026 there were two lines: `main` ("vanilla"), deployed to a
production server and tagged at each deploy, and `visualex-merlt-main`, the
MERL-T experiment, which absorbed `main` one way, by tag. That rule came from
two incidents: in June 2026, 32 vanilla commits (four of them security fixes)
sat on the experiment for ten weeks; between June and September the experiment
fell 177 commits behind. On 26 September the owners unified the two lines, the
production server was decommissioned, and a second developer joined. The
experiment's last state is the tag `archive/visualex-merlt-main`; the old
deploy is described in `docs/archive/deployment-lightsail.md`.

A `dev` branch had been rejected in September 2026 for three reasons, each
answered by the new situation. It had died once as an echo of `main`, with one
developer: now there are two, and `develop → main` is a real step, the release.
Three long-lived branches meant two synchronisation directions: the
experiment's branch is gone, and the one way back — a hotfix — is checked
automatically. A `dev` nobody deploys is a queue: still true while there is no
test environment, so release small and often.
````

- [ ] **Step 3: Write `docs/setup.md`**

````markdown
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

Ask the other developer for a backup folder (made by `scripts/backup.sh`):

```bash
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
node --test .claude/hooks/
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
````

Check the variables the guide names exist where it says (owner step if the hook refuses to read `.env.example`):

```bash
grep -cE "^(DATABASE_URL|ADMIN_PASSWORD|MERLT_INTERNAL_SECRET|MERLT_API_KEY)=" "$WT/apps/server/.env.example"
grep -c "^OPENROUTER_API_KEY=" "$WT/infra/.env.example"
```

Expected: `4` and `1`. A variable missing from `apps/server/.env.example` is added there, commented, in this task.

- [ ] **Step 4: `README.md`**

Replace everything from `## Quick Start` up to (not including) `## Core Features` with:

````markdown
## Quick Start

```bash
git clone --recurse-submodules https://github.com/capazme/VisuaLexAPI.git
cd VisuaLexAPI && git switch develop
./start.sh
```

The one-time setup (Docker, Node, Python, the `.env` files) is in
[docs/setup.md](docs/setup.md).

````

Replace everything from `## Project Structure` up to (not including) `## Deployment` with:

````markdown
## Project Structure

| Path | What |
|---|---|
| `apps/web/` | React + Vite web app |
| `apps/server/` | Express + Prisma: accounts, dossiers, community |
| `services/visualex/` | Python API (Quart): Normattiva, EUR-Lex, Brocardi |
| `services/merlt/` | MERL-T knowledge graph and RLCF (Apache-2.0) |
| `tools/` | archive CLI, end-to-end harness |
| `infra/` | Docker Compose stack |
| `scripts/` | data backup and restore |
| `docs/` | documentation — start from [docs/README.md](docs/README.md) |

````

Replace everything from `## Deployment` up to (not including) `## Troubleshooting` with:

````markdown
## Releases

There is no public deployment at the moment. Releases are tags on `main`;
day-to-day work goes to `develop` — see [docs/git-workflow.md](docs/git-workflow.md).

````

- [ ] **Step 5: Paths in the living docs**

```bash
cd "$WT" && LIVING="README.md docs/README.md docs/architecture.md docs/user_guide.md docs/backend/node_backend.md docs/backend/python_api_reference.md docs/backend/python_api_setup.md docs/frontend/component_library.md docs/frontend/setup.md docs/legacy-libro-iv-seed.md docs/merlt-smoke-checklist.md docs/merlt/integration.md docs/merlt/blueprint.md docs/merlt/smoke-checklist.md docs/merlt/system-map.md docs/merlt/seed-libro-iv.md docs/merlt/glossary.md docs/merlt/upstream-sync.md docs/merlt/contract-matrix.md docs/merlt/coauth-ux-prompt.md"
cd "$WT" && perl -pi -e 's#docker-compose\.merlt\.yml#infra/compose.yml#g; s#\.env\.merlt\.example#infra/.env.example#g; s#(^|[^/\w.-])frontend/#$1apps/web/#g; s#(^|[^/\w.-])backend/#$1apps/server/#g; s#(^|[^/\w.-])visualex_api/#$1services/visualex/visualex_api/#g; s#(^|[^/\w.-])archivio_normativo/#$1tools/archivio-normativo/archivio_normativo/#g; s#(^|[^/\w.-])merlt/#$1services/merlt/#g; s#(^|[^/\w.-])e2e/#$1tools/e2e/#g; s#visualex-merlt-(postgres|redis|falkordb|qdrant)#visualex-$1#g' $LIVING
cd "$WT" && grep -nE "(^|[^/[:alnum:]_.-])(frontend|backend|e2e)/|docker-compose\.merlt|visualex-merlt-(postgres|redis|falkordb|qdrant)|deploy\.sh|/Users/" $LIVING ; echo "exit=$?"
```

Expected: `exit=1`. Any `deploy.sh` mention the grep finds is rewritten by hand to point at `docs/archive/deployment-lightsail.md`. Mentions of `python app.py` or `.venv` at the repository root become `services/visualex` equivalents, by hand, found with `grep -nE "python app\.py|\.venv" $LIVING`.

In `docs/README.md`, under `## Inizia da qui`, add `git-workflow.md` (the branch model) and `setup.md` (from clone to running stack); move the `deployment.md` entry to the archive list as `archive/deployment-lightsail.md`; and add under `## Convenzioni`: "Documents under `merlt/slices/`, `archive/` and `superpowers/` describe the repository of their time: their paths predate the v2.0.0 layout."

- [ ] **Step 6: Commit**

```bash
git -C "$WT" add docs README.md apps/server/.env.example
git -C "$WT" commit -F - <<'EOF'
docs: the develop/main workflow, a setup guide, and paths for the new layout

docs/git-workflow.md now describes main (released) and develop
(integration), the pull-request rules, code owners, releases and hotfixes,
and keeps the history of the two-line model it replaces. docs/setup.md
takes a new developer from clone to a running stack and green suites. The
README and the living docs point at the monorepo paths; the historical
documents keep the paths of their time, as docs/README.md now says.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: The three pull requests of Phase 5**

For each branch — `chore/shared-claude-rules`, `docs/layered-claude-md`, `docs/workflow-and-setup` — push it, open a pull request into `develop` titled `merge: <branch> — <first line of its commit, lower-cased after the type>`, with body `Spec §5.` plus the "Generated with Claude Code" line, and merge it with `gh pr merge --merge --delete-branch --subject "<the title>"` when CI is green. Then `git -C "$WT" switch develop && git -C "$WT" pull --ff-only`.

---

## Phase 6 — CI and GitHub

### Task 13: CI for the new flow, the two checks, `CODEOWNERS`

**Input from the owner, before this task:** the second developer's GitHub username. `SECOND_DEV_HANDLE` below is replaced by it; the task does not start without it.

**Files:**
- Rewrite: `.github/workflows/ci.yml`, `.github/workflows/security-audit.yml`
- Create: `.github/CODEOWNERS`, `scripts/ci/check_release_source.sh`, `scripts/ci/check_main_in_develop.sh`
- Test: `scripts/ci/tests/test_checks.sh`

**Interfaces:**
- Produces: check names used by Task 14 — `Python API (3.12)`, `Python API (3.14)`, `Web build, test, lint`, `Server tests`, `MERL-T tests`, `Data backup and restore`, `Repository tooling`, `Release source`, `main inside develop`.

- [ ] **Step 1: Branch and write the failing tests**

```bash
git -C "$WT" switch -c chore/ci-develop-main develop
```

`scripts/ci/tests/test_checks.sh`:

```sh
#!/bin/sh
# Tests for the two repository checks, on a throwaway git repository.
set -eu
here="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
expect() {  # expect <0|1> <description> <command...>
  want="$1"; desc="$2"; shift 2
  if "$@" >/dev/null 2>&1; then got=0; else got=1; fi
  if [ "$got" = "$want" ]; then echo "ok   $desc"; else echo "FAIL $desc (exit $got, wanted $want)"; fail=1; fi
}

expect 0 "develop may open a pull request into main" sh "$here/check_release_source.sh" develop
expect 0 "a hotfix branch may open one" sh "$here/check_release_source.sh" hotfix/login
expect 1 "a feature branch may not" sh "$here/check_release_source.sh" feat/x

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
g() { git -C "$repo" -c user.name=t -c user.email=t@example.invalid "$@"; }
g init -q -b main
g commit -q --allow-empty -m base
g switch -q -c develop
g commit -q --allow-empty -m feature
g switch -q main
g merge -q --no-ff develop -m "merge: develop — release"
check() { (cd "$repo" && sh "$here/check_main_in_develop.sh" main develop); }
expect 0 "a release merge on main does not count" check
g switch -q -c hotfix/x main
g commit -q --allow-empty -m hotfix
g switch -q main
g merge -q --no-ff hotfix/x -m "merge: hotfix/x — fix"
expect 1 "a hotfix missing from develop fails" check
g switch -q develop
g merge -q --no-ff main -m "merge: main — the hotfix back"
expect 0 "after main is merged back, it passes" check
exit $fail
```

Run: `sh "$WT/scripts/ci/tests/test_checks.sh"`
Expected: `FAIL` lines (the scripts do not exist yet), exit 1.

- [ ] **Step 2: Write the two checks**

`scripts/ci/check_release_source.sh`:

```sh
#!/bin/sh
# A pull request into main comes from develop (a release) or a hotfix/ branch.
set -eu
head="${1:?usage: check_release_source.sh <head branch>}"
case "$head" in
  develop|hotfix/*) echo "release source: $head" ;;
  *) echo "Pull requests into main come from develop or hotfix/..., not '$head' (docs/git-workflow.md)." >&2; exit 1 ;;
esac
```

`scripts/ci/check_main_in_develop.sh`:

```sh
#!/bin/sh
# develop must hold every change of main. Release merges (develop into main)
# are not changes, so only non-merge commits count. After a hotfix, merge main
# into develop and this passes again (docs/git-workflow.md).
set -eu
main_ref="${1:-origin/main}"
develop_ref="${2:-HEAD}"
if [ -n "$(git rev-list --no-merges "$develop_ref..$main_ref")" ]; then
  echo "develop lacks these changes of main — merge main into develop:" >&2
  git log --oneline --no-merges "$develop_ref..$main_ref" >&2
  exit 1
fi
echo "develop holds every change of main"
```

Run: `sh "$WT/scripts/ci/tests/test_checks.sh"`
Expected: six `ok` lines, exit 0.

- [ ] **Step 3: Rewrite `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]

permissions:
  contents: read

jobs:
  visualex:
    name: Python API (${{ matrix.python-version }})
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.12', '3.14']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}
      # requirements-dev.txt pulls requirements.txt.
      - run: pip install -r services/visualex/requirements-dev.txt
      - run: python -m pytest tests/ -q
        working-directory: services/visualex
      - run: python -m pytest tests/ -q
        working-directory: tools/archivio-normativo

  web:
    name: Web build, test, lint
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: apps/web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          # npm 11 writes the lockfiles; npm 10 (Node 20) rejects them.
          node-version: '24'
          cache: npm
          cache-dependency-path: apps/web/package-lock.json
      - run: npm ci
      - run: npm run test -- --run
      # tsc -b is the real type-check: a bare tsc --noEmit reports a false green.
      - run: npm run build
      - run: npm run lint

  server:
    name: Server tests
    runs-on: ubuntu-latest
    # The setup runs `prisma migrate reset` and truncates every table: it needs
    # a real Postgres and a database whose name contains "test".
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: visualex
          POSTGRES_PASSWORD: visualex
          POSTGRES_DB: visualex_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U visualex -d visualex_test"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      # Wins over apps/server/.env.test: dotenv-cli does not override.
      DATABASE_URL: postgresql://visualex:visualex@localhost:5432/visualex_test
    defaults:
      run:
        working-directory: apps/server
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
          cache-dependency-path: apps/server/package-lock.json
      - run: npm ci
      - run: npx prisma generate
      - run: npm run build
      - run: npm run test

  merlt:
    name: MERL-T tests
    runs-on: ubuntu-latest
    # Tests marked `integration` (live FalkorDB) are excluded by pyproject's
    # addopts; the database ones run against this disposable Postgres.
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: merlt
          POSTGRES_PASSWORD: merlt
          POSTGRES_DB: merlt
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U merlt -d merlt"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      ENRICHMENT_DATABASE_URL: postgresql+asyncpg://merlt:merlt@localhost:5432/merlt
      RLCF_DATABASE_URL: postgresql://merlt:merlt@localhost:5432/merlt
      RLCF_ASYNC_DATABASE_URL: postgresql+asyncpg://merlt:merlt@localhost:5432/merlt
      DATABASE_URL: postgresql://merlt:merlt@localhost:5432/merlt
    defaults:
      run:
        working-directory: services/merlt
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          # The image is python:3.11-slim (services/merlt/Dockerfile).
          python-version: '3.11'
          cache: pip
          cache-dependency-path: services/merlt/pyproject.toml
      # CPU wheels first, as the Dockerfile does.
      - run: pip install torch --index-url https://download.pytorch.org/whl/cpu
      - run: pip install -e ".[dev]"
      - run: |
          python -c "
          import asyncio
          from merlt.storage.enrichment.database import init_db, create_tables
          from merlt.storage.enrichment.schema_additions import ensure_schema_additions
          async def main():
              await init_db()
              await create_tables()
              await ensure_schema_additions()
          asyncio.run(main())
          "
      - run: python -m pytest tests/ -q -p no:cacheprovider

  data:
    name: Data backup and restore
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install pytest
      # The roundtrip starts a throwaway stack from infra/compose.yml.
      - run: python -m pytest scripts/datakit/tests -q
        env:
          DATAKIT_DOCKER_TESTS: '1'

  tooling:
    name: Repository tooling
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: node --test .claude/hooks/
      - run: sh scripts/ci/tests/test_checks.sh

  release-source:
    name: Release source
    if: github.event_name == 'pull_request' && github.base_ref == 'main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Through env, never inline: a branch name is attacker-controlled text.
      - run: sh scripts/ci/check_release_source.sh "$HEAD_REF"
        env:
          HEAD_REF: ${{ github.head_ref }}

  main-in-develop:
    name: main inside develop
    if: (github.event_name == 'push' && github.ref == 'refs/heads/develop') || (github.event_name == 'pull_request' && github.base_ref == 'develop')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: sh scripts/ci/check_main_in_develop.sh origin/main HEAD
```

- [ ] **Step 4: Rewrite `.github/workflows/security-audit.yml`**

```yaml
name: Security Audit

# Python deps have lower bounds only, so a clean resolution can turn
# vulnerable with no change here: hence the weekly schedule.

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]
  schedule:
    - cron: '0 6 * * 1'  # Monday 06:00 UTC
  workflow_dispatch:

permissions:
  contents: read

jobs:
  pip-audit:
    name: pip-audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - uses: pypa/gh-action-pip-audit@1220774d901786e6f652ae159f7b6bc8fea6d266  # v1.1.0
        with:
          inputs: services/visualex/requirements.txt

  npm-audit:
    name: npm audit
    runs-on: ubuntu-latest
    strategy:
      matrix:
        workspace: [apps/web, apps/server]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
      - run: npm audit --audit-level=high
        working-directory: ${{ matrix.workspace }}
```

Run: `"$WT/services/visualex/.venv/bin/python" -c "import sys, yaml; [yaml.safe_load(open(p)) for p in sys.argv[1:]]; print('yaml-ok')" "$WT/.github/workflows/ci.yml" "$WT/.github/workflows/security-audit.yml"`
Expected: `yaml-ok`.

- [ ] **Step 5: `.github/CODEOWNERS`**

```text
# The other developer approves changes to these paths (docs/git-workflow.md);
# everything else needs green CI only. Both are listed: GitHub asks the one
# who did not open the pull request.
/apps/server/src/middleware/auth.ts                             @capazme @SECOND_DEV_HANDLE
/apps/server/src/controllers/authController.ts                  @capazme @SECOND_DEV_HANDLE
/apps/server/src/utils/jwt.ts                                   @capazme @SECOND_DEV_HANDLE
/apps/server/prisma/                                            @capazme @SECOND_DEV_HANDLE
/LICENSE                                                        @capazme @SECOND_DEV_HANDLE
/services/merlt/LICENSE                                         @capazme @SECOND_DEV_HANDLE
/.github/                                                       @capazme @SECOND_DEV_HANDLE
/infra/                                                         @capazme @SECOND_DEV_HANDLE
/scripts/backup.sh                                              @capazme @SECOND_DEV_HANDLE
/scripts/restore.sh                                             @capazme @SECOND_DEV_HANDLE
/scripts/datakit/                                               @capazme @SECOND_DEV_HANDLE
/.claude/settings.json                                          @capazme @SECOND_DEV_HANDLE
/.claude/hooks/                                                 @capazme @SECOND_DEV_HANDLE
/services/visualex/visualex_api/services/normattiva_scraper.py @capazme @SECOND_DEV_HANDLE
```

Replace `SECOND_DEV_HANDLE` with the username the owner gave; `grep -c SECOND_DEV_HANDLE "$WT/.github/CODEOWNERS"` → `0`.

- [ ] **Step 6: Commit, pull request, merge**

```bash
git -C "$WT" add .github scripts/ci
git -C "$WT" commit -F - <<'EOF'
ci: suites for the monorepo, the release-source and main-inside-develop checks, code owners

CI runs on pull requests into develop and main and on pushes to them: the
Python API and the archive CLI, the web app, the server, MERL-T (no longer
limited to the old experiment branch), the data roundtrip on a throwaway
stack, and the repository tooling. Two checks guard the flow: a pull
request into main comes from develop or hotfix/, and develop holds every
non-merge commit of main. CODEOWNERS names the paths that need the other
developer's approval.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C "$WT" push -u origin chore/ci-develop-main
gh pr create --repo capazme/VisuaLexAPI --base develop --head chore/ci-develop-main \
  --title "merge: chore/ci-develop-main — CI and checks for the develop/main flow" \
  --body "Spec §4.4, §7. Checks tested on a throwaway repository.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected on the pull request: every job green, `Release source` skipped, `main inside develop` green. Merge: `gh pr merge --repo capazme/VisuaLexAPI --merge --delete-branch --subject "merge: chore/ci-develop-main — CI and checks for the develop/main flow"`; then `git -C "$WT" switch develop && git -C "$WT" pull --ff-only`.

### Task 14: GitHub settings

Every step changes the repository's settings on GitHub: run each only with the owner's explicit yes, given for this task.

**Files:**
- Create (throwaway): `$WORK/ruleset-develop.json`, `$WORK/ruleset-main.json`

- [ ] **Step 1: Owner step — the collaborator**

The owner adds the second developer (GitHub → Settings → Collaborators, permission Write) and waits for the invitation to be accepted. Then:

Run: `gh api "repos/capazme/VisuaLexAPI/codeowners/errors?ref=develop"`
Expected: `{"errors":[]}`.

- [ ] **Step 2: Repository settings**

```bash
gh api -X PATCH repos/capazme/VisuaLexAPI \
  -f default_branch=develop \
  -F allow_merge_commit=true -F allow_squash_merge=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true \
  -f merge_commit_title=PR_TITLE -f merge_commit_message=PR_BODY \
  --jq '{default_branch, allow_merge_commit, allow_squash_merge, allow_rebase_merge, delete_branch_on_merge}'
```

Expected: `develop`, `true`, `false`, `false`, `true`.

- [ ] **Step 3: The two rulesets**

`$WORK/ruleset-develop.json`:

```json
{
  "name": "develop",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {"ref_name": {"include": ["refs/heads/develop"], "exclude": []}},
  "rules": [
    {"type": "deletion"},
    {"type": "non_fast_forward"},
    {"type": "pull_request", "parameters": {
      "required_approving_review_count": 0,
      "require_code_owner_review": true,
      "dismiss_stale_reviews_on_push": true,
      "require_last_push_approval": false,
      "required_review_thread_resolution": false
    }},
    {"type": "required_status_checks", "parameters": {
      "strict_required_status_checks_policy": false,
      "required_status_checks": [
        {"context": "Python API (3.12)"},
        {"context": "Python API (3.14)"},
        {"context": "Web build, test, lint"},
        {"context": "Server tests"},
        {"context": "MERL-T tests"},
        {"context": "Data backup and restore"},
        {"context": "Repository tooling"},
        {"context": "main inside develop"}
      ]
    }}
  ]
}
```

`$WORK/ruleset-main.json`: the same, with `"name": "main"`, `"include": ["refs/heads/main"]`, and `{"context": "Release source"}` in place of `{"context": "main inside develop"}`.

```bash
gh api -X POST repos/capazme/VisuaLexAPI/rulesets --input "$WORK/ruleset-develop.json" --jq '.id'
gh api -X POST repos/capazme/VisuaLexAPI/rulesets --input "$WORK/ruleset-main.json" --jq '.id'
gh api repos/capazme/VisuaLexAPI/rules/branches/develop --jq '[.[].type] | sort'
gh api repos/capazme/VisuaLexAPI/rules/branches/main --jq '[.[].type] | sort'
```

Expected: two ids; for each branch `["deletion","non_fast_forward","pull_request","required_status_checks"]`.

- [ ] **Step 4: Prove the code-owner rule works with zero general approvals**

Two throwaway pull requests into `develop`:

```bash
git -C "$WT" switch -c chore/check-owned develop && printf '\n' >> "$WT/.github/CODEOWNERS" && git -C "$WT" commit -qam "chore: check the code-owner rule (throwaway)" && git -C "$WT" push -qu origin chore/check-owned
gh pr create --repo capazme/VisuaLexAPI --base develop --head chore/check-owned --title "throwaway: owned path" --body "Do not merge."
git -C "$WT" switch -c chore/check-free develop && printf '\n' >> "$WT/docs/README.md" && git -C "$WT" commit -qam "chore: check a free path (throwaway)" && git -C "$WT" push -qu origin chore/check-free
gh pr create --repo capazme/VisuaLexAPI --base develop --head chore/check-free --title "throwaway: free path" --body "Do not merge."
```

After CI finishes on both (check once), run `gh pr view <number> --repo capazme/VisuaLexAPI --json reviewDecision,mergeStateStatus` for each.
Expected: owned path → `"reviewDecision":"REVIEW_REQUIRED"`, `"mergeStateStatus":"BLOCKED"`; free path → `"mergeStateStatus":"CLEAN"`.
Then close both without merging and delete the branches: `gh pr close <n> --repo capazme/VisuaLexAPI --delete-branch` (twice), `git -C "$WT" switch develop`, `git -C "$WT" branch -D chore/check-owned chore/check-free`.

If the free path is also `BLOCKED` for want of a review, GitHub does not support the rule as designed: stop and ask the owner to choose between one approval on every pull request and a CI check that enforces the code-owner paths (spec §8, step 6).

---

## Phase 7 — Release

### Task 15: Release `v2.0.0`

**Files:**
- Modify: `version.txt`

- [ ] **Step 1: The version bump, through `develop`**

```bash
git -C "$WT" switch -c chore/release-2.0.0 develop
printf '2.0.0\n' > "$WT/version.txt"
git -C "$WT" commit -am "chore: version 2.0.0, the unified VisuaLex" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git -C "$WT" push -u origin chore/release-2.0.0
gh pr create --repo capazme/VisuaLexAPI --base develop --head chore/release-2.0.0 --title "merge: chore/release-2.0.0 — version 2.0.0" --body "Spec §8 step 7.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

When CI is green: `gh pr merge --repo capazme/VisuaLexAPI --merge --delete-branch --subject "merge: chore/release-2.0.0 — version 2.0.0"`.

- [ ] **Step 2: The release pull request**

```bash
gh pr create --repo capazme/VisuaLexAPI --base main --head develop \
  --title "merge: develop — release 2.0.0" \
  --body "The unified VisuaLex: vanilla and MERL-T in one line, the monorepo layout, the develop/main flow, portable data. Spec: docs/superpowers/specs/2026-09-27-unified-repo-design.md.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: CI green and `Release source` green. The pull request carries changes to code-owned paths, so the second developer approves it. If the second developer cannot yet, the owner uses the emergency provision of `docs/git-workflow.md` (suspend the `main` ruleset, merge, restore it the same day) — the owner's call.

Merge: `gh pr merge <number> --repo capazme/VisuaLexAPI --merge --subject "merge: develop — release 2.0.0"` (no `--delete-branch`: `develop` is permanent).

- [ ] **Step 3: Tag**

```bash
git -C "$WT" fetch origin
git -C "$WT" tag -a v2.0.0 origin/main -m "Release 2.0.0: the unified VisuaLex"
git -C "$WT" push origin v2.0.0
git -C "$WT" describe --tags --match 'v*' origin/main
```

Expected: `v2.0.0`. On `develop`, the next CI run keeps `main inside develop` green (a release merge does not count).

---

## Phase 8 — The second developer's test, and one checkout

### Task 16: Onboarding from a clean clone; `$MAIN` moves to `develop`; the worktree retires

- [ ] **Step 1: A clean clone, following only `docs/setup.md`**

Stop your own stack first (Ctrl+C in its terminal): the clone's `start.sh` needs ports 5000, 3001 and 5173.

```bash
git clone --recurse-submodules --branch develop https://github.com/capazme/VisuaLexAPI.git "$WORK/onboarding"
```

Follow `docs/setup.md` sections 3–5 in `$WORK/onboarding` with one change, so this test cannot touch your own stack: in its `infra/.env` set `VISUALEX_STACK=visualex-onboarding`, `VISUALEX_PG_PORT=45436`, `VISUALEX_REDIS_PORT=46381`, `VISUALEX_FALKOR_PORT=46382`, `VISUALEX_QDRANT_PORT=46343`, `VISUALEX_QDRANT_GRPC_PORT=46344`, `MCP_LEGAL_IT_PORT=48011`, `MERLT_API_PORT=48000`; in its `apps/server/.env` use port `45436` in `DATABASE_URL`. (`.env` files: owner step if the hook refuses.)
Every problem met — a missing step, a wrong command, an unclear sentence — is fixed in `docs/setup.md` on a `docs/` branch before going on.

- [ ] **Step 2: Restore a dataset into the clone's stack**

```bash
export VISUALEX_STACK=visualex-onboarding VISUALEX_QDRANT_PORT=46343
"$WORK/onboarding/scripts/restore.sh" "$NEW"
```

(`$NEW` is Task 9's backup.) Expected: `restore verified: counts match`.

- [ ] **Step 3: The suites, as `docs/setup.md` §7 says**

Run §7 in `$WORK/onboarding`, with `DATABASE_URL="postgresql://visualex:visualex@localhost:45436/visualex_test"` exported for the server suite.
Expected: every command exits 0.

- [ ] **Step 4: Start and look, then tear down only the clone's stack**

`./start.sh` in `$WORK/onboarding`; `http://localhost:5173` answers and the owner's account (restored) logs in. Ctrl+C. Then:

```bash
test "$VISUALEX_STACK" = visualex-onboarding && docker compose -f "$WORK/onboarding/infra/compose.yml" -p visualex-onboarding --profile merlt down -v
docker volume ls --format '{{.Name}}' | grep '^visualex-onboarding_' ; echo "exit=$?"
unset VISUALEX_STACK VISUALEX_QDRANT_PORT
rm -rf "$WORK/onboarding"
```

Expected: `exit=1` (no volume left). Your own `visualex_*` volumes are untouched.

- [ ] **Step 5: Owner step — carry the `.env` files to the main checkout**

List them, names only:

```bash
find "$MAIN" "$WT" -maxdepth 4 -name '.env*' -not -name '*.example' -not -path '*/node_modules/*' -not -path '*/.venv/*'
```

After Step 6 the owner copies `$WT/apps/server/.env` to `$MAIN/apps/server/.env` and `$WT/infra/.env` to `$MAIN/infra/.env`, and moves the Python API's variables from `$MAIN/.env` into `$MAIN/services/visualex/.env`.

- [ ] **Step 6: `$MAIN` switches to `develop`**

```bash
git -C "$MAIN" status --short ; echo "clean-if-empty"
git -C "$MAIN" fetch origin && git -C "$MAIN" switch develop && git -C "$MAIN" pull --ff-only
git -C "$MAIN" submodule update --init --recursive
git -C "$MAIN" clean -ndX backend frontend merlt .venv
```

The last command only lists the ignored leftovers of the old layout (`node_modules`, `dist`, the old venv, any `.env`). Once the owner has done Step 5 and confirms, remove them with `git -C "$MAIN" clean -fdX backend frontend merlt .venv`. Then install as in `docs/setup.md` §4.

- [ ] **Step 7: Start from `$MAIN` — the same data**

`MERLT_ENABLED=true ./start.sh` in `$MAIN`, then:

```bash
curl -s http://localhost:3001/api/merlt/health
```

Expected: the graph node count of Task 9, Step 2 (Review Focus 1: same stack name, same volumes, another folder).

- [ ] **Step 8: Retire the worktree (owner confirms)**

```bash
git -C "$WT" status --short ; echo "clean-if-empty"
git -C "$MAIN" worktree remove --force "$WT"
git -C "$MAIN" worktree list
```

Expected: only `$MAIN`. (`--force` because the worktree holds the submodule; its `.env` files were copied in Step 5.)

- [ ] **Step 9: Close the loop**

- Update the project memory: the branch model is `main` + `develop` (`git_model_vanilla_vs_merlt.md`), the stack and backups (`production_access.md` points to this plan).
- The owner restarts the three paused pieces of work (the account export, the discussion-reports view, the database error in the login middleware) on `develop`: their proposals name old paths (`backend/…` → `apps/server/…`).
- The owners record the branch model in their decision log (A8), by number only.
- The legacy volumes (`visualexapi_merlt_*`, `visualexapi-merlt_*`) and the host Postgres database stay until the owner decides to delete them.
