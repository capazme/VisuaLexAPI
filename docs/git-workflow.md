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
| `vX.Y.Z` tags | One per release, on `main`. `v1.7.8` is the last release of the old line, `v1.8.0` the first of the unified repository. | Permanent |
| `feat/`, `fix/`, `refactor/`, `chore/`, `docs/` | One piece of work each, from `develop`, back into `develop` by pull request, deleted on merge. | Days |
| `hotfix/…` | An urgent fix to the released version, from `main`, back into `main`. | Hours |
| `preview/…` | Unreleased work run on the deployment host, only when the owner asks for it (see "Deploy"). Never merged. | Until the next release |

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
5. CI must be green: GitHub refuses the merge until every CI job has
   passed. On the paths in "Review" below, GitHub asks the other developer
   for a review; it does not wait for it.
6. Merge it yourself with a merge commit titled `merge: feat/thing — what it
   changes`. The branch is deleted automatically. The title is what the
   changelog is written from, so it says what changes for the reader, not
   how.

Nothing is pushed to `develop` or `main` directly, nobody force-pushes them,
nobody deletes them: GitHub's rulesets refuse it, and the shared Claude Code
hook refuses it first.

## Review

Each developer manages their own code: a pull request is reviewed by the
other when they can, and it never waits for that review. The owners decided
so on 4 October 2026.

- `.github/CODEOWNERS` asks for the other developer's review on the paths
  where one person's mistake costs everyone: authentication and tokens, the
  Prisma schema and migrations, the licences, `.github/`, `infra/` and the data
  scripts, the shared Claude Code rules, and the Normattiva text extraction
  (its output is the offset space of every stored highlight and note). The
  ruleset does not require that review: the author merges at green CI.
- A review that arrives after the merge is answered by a new pull request.
- The licence, copyright assignment and contribution terms are decided by
  both owners together. A pull request that changes `LICENSE`, `NOTICE`, the
  SPDX headers or the contribution terms is merged only with both owners'
  agreement written on it.

## Shared files and migrations

Both developers' sessions work in parallel, so two things are reserved before
anyone touches them, in the owners' shared coordination register:

- **a migration**: its timestamp (Prisma's `YYYYMMDDHHMMSS_name`) and the
  tables it changes, so two branches never write the same timestamp or the
  same table;
- **a shared file** that several areas edit — the root `CLAUDE.md`,
  `.claude/settings.json`, `.github/`, `infra/`, `start.sh` — for the time a
  branch holds it.

The reservation is released when the branch merges or is abandoned. A
conflict found in a pull request is settled between the two developers, not by
whoever merges first.

## Versions

`X.Y.Z`, read from `version.txt`:

- **Y**, the minor number, goes up with each batch of features: roughly every
  one to two weeks (1.8, 1.9…).
- **Z**, the patch number, goes up with a hotfix (1.8.1).
- **X** moves only by the owners' decision.

Each release has a section in `CHANGELOG.md`, in English, written from the
merge titles (`sh scripts/release-notes.sh vPREVIOUS origin/develop` lists
them, after a `git fetch`),
and a short note in Italian for the people who use VisuaLex: what changed in
the parts they use, by area, without technical terms, never naming a doctrine
source («una fonte esterna di dottrina»). The note is a file of the web app,
`apps/web/src/content/novita/X.Y.Z.md` (a bold line per area, `- ` per item,
no `#` heading): the window «Novità» shows it after an update, and the GitHub
release carries the same text.

## Release

A release is cut when the owners say so. The checklist, in order:

1. **Suites.** `develop` is green in CI, and every suite in the root
   `CLAUDE.md` ("Commands") passes on a checkout of it — MERL-T's in CI or
   against a disposable database.
2. **Browser.** A pass on `http://localhost:5173` through the main flows:
   login; search a norm, read it, change its date; open a decision; add both
   to a dossier and export its PDF; the find window; a study card; «Collega
   un'app AI». Anything broken is fixed on `develop` first.
3. **Changelog.** On `chore/release-X.Y.Z` from `develop`: bring
   `[Unreleased]` in `CHANGELOG.md` up to date from `release-notes.sh` (pull
   requests do not edit it, so they never conflict on it), rename it to
   `[X.Y.Z] - YYYY-MM-DD`, and open a new empty `[Unreleased]` above it; set `version.txt` to `X.Y.Z`; write the
   Italian note in `apps/web/src/content/novita/X.Y.Z.md`, in the same pull request (the web suite fails
   on a `version.txt` with no note). Pull request into `develop`, merge.
4. **Pull request `develop → main`**, titled `merge: develop — release X.Y.Z`.
   The check "Release source" accepts only `develop` and `hotfix/…` as the
   source of a pull request into `main`. Merge it with a merge commit.
5. **Tag**, on `main`:
   `git tag -a vX.Y.Z -m "Release X.Y.Z" && git push origin vX.Y.Z`, then the
   GitHub release from the tag, with the changelog section and the Italian
   note (`apps/web/src/content/novita/X.Y.Z.md`, then the changelog section):
   `gh release create vX.Y.Z --title "VisuaLex X.Y.Z" --notes-file <note>`.
6. **Deploy** (below), and record it in the coordination register.

## Deploy

The deployment host runs the latest release: `./start.sh --prod --branch
main`. A preview of unreleased work runs there only when the owner asks for
it explicitly, recorded in the coordination register: a `preview/…` branch
deployed with `./start.sh --prod --no-pull --allow-branch`, back to the latest
release when the next one is cut. The preview branch is then deleted. A
preview carries no migration that `develop` lacks: the deploy refuses to move
the host to a version without a migration it already applied, so such a
preview could not go back to the release.

## Hotfix

1. `git switch -c hotfix/thing origin/main`, fix, raise the patch number in
   `version.txt`, add its section to `CHANGELOG.md` and its Italian note in
   `apps/web/src/content/novita/X.Y.Z.md`; pull request into `main`.
2. Merge it, then tag and release on `main` as in "Release", steps 5 and 6.
3. Right after, a pull request `main → develop`.

Until the second one lands, the check "main inside develop" is red on
`develop`: it fails whenever `main` holds a change `develop` lacks (release
merges do not count). A forgotten hotfix becomes a red check, not a fix
stranded for weeks.

## Where work strands

- **Claude Code web sessions** push `claude/…` branches: within days, open them
  as a pull request into `develop`, or delete them.
- **Desktop sessions** leave worktrees under `.claude/worktrees/`: remove them
  once their work has landed, after checking for untracked files.
- **Remote branches** are deleted by GitHub when their pull request merges.
  A branch whose pull request was closed without merging is deleted by its
  author.
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
