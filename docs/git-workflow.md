# Git workflow

How work moves through this repository: two long-lived branches, short-lived
topic branches, and tags that name what is in production. Everything here is
meant to be true of the repository as it stands — if you find a rule the
history contradicts, fix the rule in the same change that taught you.

Decided 19 September 2026, after the second cleanup in a month found a
production fix stranded on a session branch and the experiment three months
behind `main`. Read `docs/deployment.md` for what the deploy script does; this
file is about what happens *before* it runs. `visualex-merlt-main` is written
`merlt` below.

Two incidents shaped these rules, and the text refers to both: in June 2026,
32 vanilla commits (four of them security fixes) were made *on* `merlt` and
sat there for ten weeks while production ran without them; and between June
and September 2026, `merlt` stopped absorbing `main` and fell 177 commits
behind. The same neglect, in both directions.

## The shape

| Ref | What it is | Lifetime |
|---|---|---|
| `main` | Visualex "vanilla", the product. Every commit here was verified locally before its merge and by CI on push; any of them could be deployed. | Permanent |
| `vX.Y.Z` tags | What *was* deployed. Created by `deploy.sh --patch/--minor/--major` on the server, together with the version-bump commit. | Permanent |
| `visualex-merlt-main` | The AI experiment. Never deployed. Absorbs `main` **by tag**, never the other way. | Permanent, until MERL-T ships or is dropped |
| `fix/…`, `feature/…`, `refactor/…`, `chore/…` | One piece of work each, branched from `main`, merged back with `--no-ff`, deleted. | Days; a large feature (the 2026 auth round, planned as ten tasks) stays on its branch until complete, and rebases on `main` as it goes |

```
main      ──●──●──●──●──●──●──●──●──●──●──●──●──●──●──►
              │      ▲       ▲          │      ▲
   fix/x  ────┴──●───┘       │  feature/y──●──●┘
                        v1.7.5 ┐                    v1.7.6 ┐
merlt     ─────────────────────●─────────────────────────●──►
                          merge v1.7.5                merge v1.7.6
```

Each tag sits on the `chore: bump version to X.Y.Z` commit the server creates
and pushes at deploy time, so after a release the laptop's `main` is one commit
behind `origin` until the next `git pull` — pull before you branch.

`main` is the integration line. The release is not a merge, it is the deploy,
and the tag is its name. That is the whole model: what a `main`/`dev` pair
expresses with two branches, this repository expresses with one branch and
tags, because the deploy is a deliberate manual step and not every green
commit is shipped the moment it lands.

## Why there is no `dev` branch

Recorded so it is not re-proposed without new information.

- **It already died once.** `origin/dev` stopped on 30 December 2025, and every
  merge in its history goes *from* `main` *into* `dev` ("Merge branch 'main'
  into dev"). Work was going straight to `main`; `dev` was an echo, not an
  integration branch. That is the natural end state with one developer.
- **`merlt` makes a third long-lived branch, and three branches mean two
  synchronisation directions** (`dev → main`, `main → merlt`) plus the third
  that git-flow needs for hotfixes (`main → dev`). Each is a place where the
  one-way valve can invert without anyone noticing — which is exactly how
  the June 2026 stranding happened.
- **A `dev` nobody deploys is a queue, not a test bed.** There is one server
  and no staging environment. Topic branches already hold work that is not
  ready, one piece at a time, and they cannot drift as a group.

Also rejected, when the two-branch model was decided on 24 August 2026:
merging `merlt` into `main` behind feature flags (it drags the MERL-T Python
service and Docker stack into the production deploy).

## Day to day on `main`

1. **Branch from `main`**, named for the kind of change: `fix/`, `feature/`,
   `refactor/`, `chore/`. One piece of work per branch.
2. **Verify before merging.** `npm run test` and `npm run build` in
   `frontend/` (the build is the real type-check — a bare `tsc --noEmit`
   reports a false green), `npm test` in `backend/`, and
   `.venv/bin/python -m pytest tests/ -q` from the repo root. CI runs the same
   gates on every push to `main` and every PR into it; a local red is cheaper
   than a remote one.
3. **Merge with a merge commit**, so the branch stays legible in history:

   ```
   git checkout main
   git merge --no-ff fix/thing -F msg.txt     # "merge: fix/thing — what it fixes"
   git branch -d fix/thing
   git push origin main
   ```

   The first line of the message is `merge: <what was merged> — <what
   changed>`; the tag merge into `merlt` (below) follows the same shape with
   the tag in place of the branch. Put the verification you ran in the body.
   If the branch was pushed to GitHub, a PR does the same job and leaves the
   review on the record — give the PR's merge commit the same first line
   instead of GitHub's default. A PR is not mandatory for a solo change.
4. **Long features rebase, they do not merge `main` in.** A branch with a
   handful of unpushed commits is rebased onto `main` when `main` moves
   (`git rebase main`); its history stays linear and the eventual merge commit
   is the only knot. The limit is other people, not the push itself: a branch
   someone else has based work on is not rebased any more. This is a
   single-developer repository, and a session branch (`origin/claude/…`) is
   yours alone, so those are rebased freely.
5. **Read the CI run before deploying.** `deploy.sh` consults nothing.

## Release = deploy + tag

On the server:

```
./deploy.sh --patch      # 1.7.5 → 1.7.6
```

Step 7 of the script writes `version.txt`, commits `chore: bump version to
1.7.6`, tags that commit `v1.7.6`, and pushes commit and tag to `origin`. The
tag is the only durable record of what production ran and when. On the
laptop, `git pull` brings the bump commit and its tag; `git describe --tags
--match 'v*'` on any commit then says how far it is from the last release
(the `--match` keeps the experiment's own tags out of the answer). A rollback
is `git checkout v1.7.5` plus a re-run with `--allow-branch`, because a tag
checkout is a detached HEAD and the step-0 guard refuses it (the known gaps
in `docs/deployment.md` still apply — migrations do not walk backwards).

Deploys without a bump (`./deploy.sh` alone) are re-deploys of the current
version and leave no tag. Use them for a restart, not for shipping a change —
the `--allow-branch` emergency under Hotfixes is the one exception, and it is
followed by a tagged deploy the same day.

## `visualex-merlt-main` follows the tags

The experiment absorbs vanilla **after every release**, by merging the tag:

```
git checkout visualex-merlt-main
git merge v1.7.6 -F msg.txt     # "merge: v1.7.6 — vanilla 1.7.6 into merlt"
# resolve, run every suite, commit
```

Merging a tag rather than `main` means the sync points have names, the
experiment never carries an unreleased state of vanilla, and "how far behind
is merlt" is one `git log --oneline v1.7.6..main` away.

The cost of skipping this compounds. The June-to-September gap of 2026 was
177 commits and 34 conflicted files: two lockfiles, the store, the admin page,
the dossier controller, the scraper, and MERL-T instrumentation attached to
two components `main` had deleted in the meantime — a full day's work that
would have been an hour a month.

**Checklist for the merge**, learned from that dry-run:

- **Lockfiles are regenerated, never hand-merged.** Resolve
  `frontend/package.json` and `backend/package.json` by hand, take either
  side of each lockfile whole (`git checkout --theirs frontend/package-lock.json`
  — `npm` cannot parse conflict markers), then `npm install` in each directory
  rewrites the lock from the resolved manifest. Stage the result.
- **`normattiva_scraper._estrai_testo_*` is `main`'s, always.** Its output is
  the offset space every stored highlight and note is anchored to (gotcha 23
  in `CLAUDE.md`). A one-space change deletes every anchor after it, for every
  user, silently.
- **A file `main` deleted stays deleted.** Take the deletion, then re-home
  whatever MERL-T added (a `publishMerltEvent`, a hook) in the component that
  replaced it. Do not resurrect the file.
- **`deploy.sh` keeps `main`'s branch guard** (step 0). Whatever the
  experiment adds to the script sits after it.
- **`CLAUDE.md` is `main`'s text plus the MERL-T sections**, not a choice
  between the two.
- **Run all of it afterwards**: the three vanilla suites above, plus the
  experiment's own (BFF, MERL-T Python) — the merge is not done until they are
  green on `merlt`.
- **Nothing goes back.** No cherry-pick from `merlt` to `main`, ever. If you
  are fixing something vanilla while on `merlt`, stop, do it on a topic branch
  off `main`, release it, and let the next tag merge bring it over.

If MERL-T ever needs releases of its own, it gets its own tag namespace
(`merlt-vX.Y`, the existing `merlt-baseline-from-alis-core` is the precedent)
and its own deploy — never a merge into `main`. If it ever *replaces* vanilla,
the move is "merlt becomes `main`", which the one-way flow makes possible.

## Where work strands, and the monthly sweep

Two places accumulate branches without anyone deciding to create them:

- **Claude Code web sessions** push their result as
  `origin/claude/<adjective>-<name>-<id>`. One such branch held a real fix for
  three days while a narrower fix for the same regexes landed on `main`, and
  the two conflicted on rebase. Rule: within days of a web session ending, its
  branch is either merged into `main` or deleted; the choice is whether you
  still want the change, and "not sure" means read the diff now, not later.
  To merge: `git fetch`, `git checkout -b fix/<what-it-does>
  origin/claude/<name>`, `git rebase main`, run the suites, `--no-ff` merge
  into `main` under the new name, push `main`, then
  `git push origin --delete claude/<name>`. Nothing lives on `claude/*`.
- **Claude Code desktop sessions** leave worktrees under `.claude/worktrees/`,
  often on a detached HEAD, sometimes holding an uncommitted file. Remove them
  when the session's work has landed; check for untracked files first.

Once a month, or before assuming every fix has reached `main`:

```
git fetch --prune
git branch -r | grep origin/claude/          # session branches: merge or delete
git branch --merged main                     # local branches to delete
git worktree list                            # anything but the main checkout?
git log --oneline $(git describe --tags --abbrev=0 --match 'v*' visualex-merlt-main)..main | wc -l
                                             # how far behind is merlt (--match: ignore merlt-* tags)
```

## Hotfixes

A hotfix is a `fix/` branch like any other: branch from `main`, verify, merge,
push, deploy with a bump. That path is minutes, not hours, and it is the
default even under pressure.

`deploy.sh --allow-branch` exists for the emergency where the fix must be live
before the merge. It is the one deploy that ships a change without a bump —
and therefore without a tag: push the branch, on the server `git checkout
fix/thing`, `./deploy.sh --allow-branch` (no `--patch`). Then, the same day:
merge into `main`, push, on the server `git checkout main` and
`./deploy.sh --patch`. Until that second deploy runs, production has no tag
naming what it runs and the server is on a branch the step-0 guard would
refuse — do not leave it there overnight.

## Quick reference

| I want to… | Do |
|---|---|
| Start a change | `git checkout -b fix/thing main` |
| Land it | verify · `git merge --no-ff` into `main` · delete branch · push |
| Ship it | on the server, `./deploy.sh --patch` |
| Bring vanilla into the experiment | `git checkout visualex-merlt-main && git merge vX.Y.Z` |
| See what is in production | `git tag -l 'v*' --sort=-v:refname \| head -1` |
| See what merlt is missing | `git log --oneline vX.Y.Z..main` |
| Close a web session's branch | `git checkout -b fix/… origin/claude/…` → `git rebase main` → suites → `--no-ff` merge → `git push origin --delete claude/…` |
