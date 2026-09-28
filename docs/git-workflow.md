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
