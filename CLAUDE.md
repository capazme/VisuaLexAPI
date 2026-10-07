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
| `apps/server/` | Express + Prisma: accounts, dossier, community, the MERL-T gateway, the OAuth authorization server for MCP clients | `apps/server/CLAUDE.md` |
| `apps/mcp/` | the MCP server (Streamable HTTP, :3002): dossier tools for Claude Code and LibreLex, no database | `apps/mcp/CLAUDE.md` |
| `services/visualex/` | Quart: sources, reading text, URNs, citations, AKN | `services/visualex/CLAUDE.md` |
| `services/merlt/` | MERL-T and RLCF — its own licence (Apache-2.0) | `services/merlt/CLAUDE.md` |
| `tools/archivio-normativo/` | CLI: a local archive of acts | `tools/archivio-normativo/CLAUDE.md` |
| `tools/e2e/` | end-to-end and stress harness | `tools/e2e/README.md` |
| `conventions/` | the convention for legal sources: identity and labels of norms and decisions, as one golden file (read today by the web and API suites, by the others as they adopt it) | `conventions/sources/README.md` |
| `infra/` | the Compose stack: stores and MERL-T, and the production modules (app, scrapers, overlay) | `infra/compose.yml` header |
| `scripts/` | data backup and restore, smoke tests; `scripts/prod/`: what `./start.sh --prod` runs | `scripts/datakit/README.md` |
| `vendor/mcp-legal-it/` | git submodule | — |
| `docs/` | git workflow, setup, MERL-T, specs and plans, archive | `docs/README.md` |

MERL-T work that spans the server and the web app: `docs/merlt/claude-notes.md`.

## Commands

```bash
./start.sh [--dev]                           # the development stack (the default); MERLT_ENABLED=true adds MERL-T
./start.sh --prod --branch main|develop      # the deployment host only: pull that branch, build and run everything as containers
./start.sh --prod --no-pull [--allow-branch] # the same, with what is checked out; bare --prod asks which
./start.sh --prod --stop                     # stop that stack (containers and volumes stay)
sh scripts/prod/tests/test_deploy.sh         # start.sh and scripts/prod, against a stub docker
npm --prefix apps/web run test -- --run      # web tests
npm --prefix apps/web run build              # tsc -b + vite: the real type-check
npm --prefix apps/web run lint
npm --prefix apps/server run build
npm --prefix apps/server test                # only this way: the setup refuses a non-test database
npm --prefix apps/mcp run build && npm --prefix apps/mcp test   # stub servers, no database
(cd services/visualex && .venv/bin/python -m pytest tests/ -q)
(cd tools/archivio-normativo && ../../services/visualex/.venv/bin/python -m pytest tests/ -q)
node --test '.claude/hooks/*.test.mjs'
scripts/backup.sh / scripts/restore.sh <folder>
```

A bare `tsc --noEmit` does not walk the project references and reports a false
green. The MERL-T suite runs in CI or against a disposable database
(`services/merlt/CLAUDE.md`), never against the development stack's.
First-time setup: `docs/setup.md`. `--dev` prepares a fresh checkout itself (env
files, venv, packages, Chromium). `--prod --branch main|develop` fast-forwards the
checkout to origin's latest commit of that branch (`scripts/prod/update.sh`) and
deploys it; `--no-pull` deploys what is checked out — `main`, `develop` or a
`vX.Y.Z` tag, clean tree, unless `--allow-branch`; a bare `--prod` asks at the
terminal. Either way after a backup of an existing stack; on its first run it creates `infra/.env` and `apps/server/.env`
with generated secrets and refuses development values. Both modes read
`infra/.env` and, by default, share the stack name `visualex` (`VISUALEX_STACK`):
never run `--dev` on the deployment host. Design:
`docs/superpowers/specs/2026-09-29-modular-deployment-design.md`.

## Git flow — `docs/git-workflow.md`

- `main` is the released version; `develop` is where work lands and the
  default branch.
- Branch from `develop` (`feat/`, `fix/`, `refactor/`, `chore/`, `docs/`),
  open a pull request into `develop`, merge it yourself with a merge commit
  titled `merge: <branch> — <what changes>` once CI is green.
- Changes to authentication, the Prisma schema and migrations, licences,
  `.github/`, `infra/` and the data scripts, `.claude/settings.json`, and
  `normattiva_scraper.py` are for the other developer to approve. Not enforced
  yet: `.github/CODEOWNERS` waits for their GitHub account, and until then the
  owner merges them alone.
- A release is a pull request `develop → main`, then a tag `vX.Y.Z`. A
  hotfix starts from `main`, returns to `main`, and `main` is merged into
  `develop` at once.
- No other long-lived branch: experiments sit behind flags.
- The shared hook (`.claude/settings.json`) refuses commits on `main` and
  `develop` of this repository, pushes to them, and `prisma migrate
  dev/reset`. GitHub's ruleset refuses the same pushes and any merge whose CI
  is not green.

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

23. **`article_text` is a data contract, not a string.** Highlights and anchored
    notes are pinned by `(startOffset, text)` where the offset counts characters
    in a projection of `article_text` in which only `\n` is invisible.
    The renderer (`utils/articleRender.ts`) requires the stored text to equal
    the slice at that offset (case-insensitive; whitespace-only differences
    tolerated, nothing else) and drops the marker silently on mismatch — no
    fuzzy fallback, no log, no visual difference from "never existed". Changing
    the scraper's output formatting by one space deletes every anchor after it,
    for every user, with no way to detect it afterwards. Measured: AKN vs HTML
    is 0/19 identical. This is why `normattiva_scraper._estrai_testo_*` output
    is frozen and why AKN is never the display text. The same holds on the
    rendering side: the structured reading surface may wrap characters in
    elements but never add, drop or change one — `articleRender.test.ts`
    checks the rendered text nodes against `article_text` on 27 real texts,
    with the annotation signs on (a sign has no text node).
    Decision texts are held to the same contract since 2026-10-05 (notes and
    highlights on decisions): the readers in
    `services/visualex/visualex_api/services/decisions/` — the Cassazione's text
    from the court's PDF (`pdf_text.py`), its fallback from the text field, the
    Corte costituzionale's open data — may add or move `\n` and move a boundary
    between blocks, never change another character. The anchors count characters
    in the projection: each block stripped at its edges, concatenated, every `\n`
    removed. `test_decisions_text_frozen.py` (synthetic cases) and its `_local`
    twin (real decisions kept out of the repository) compare each reader's
    projection with a stored SHA-256 and length, never the text, and
    `decisionRender.test.ts` checks the rendered text nodes; an anchor that no
    longer matches is listed in the decision tab, never dropped. The freeze takes
    effect with the pull request that first stores notes on decisions.
    (Inserting only `\n` would not move any offset — newlines are invisible in
    the projection — but the saved-norm watcher compares `article_text`
    verbatim, so it would still raise false "changed" notifications.)
