#!/bin/sh
# ./start.sh --prod --branch <main|develop>: bring the checkout to the latest commit of that
# branch on origin, before the deploy builds it.
#
#   update.sh <main|develop>
#
# Fast-forward only: a local commit that origin does not have, or a change not committed,
# stops it before anything moves. A branch that predates ./start.sh --prod is refused before
# the checkout is switched to it, so the checkout never lands where this script is missing.
# So is a branch that lacks a database migration the checked-out version has (develop -> an
# older main): its code would run on a schema already migrated past it, and migrations do not
# walk backwards.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$root/scripts/prod/lib.sh"

branch="${1:-}"
case "$branch" in
  main|develop) ;;
  *) err "usage: update.sh <main|develop>"; exit 2 ;;
esac
g() { git -C "$root" "$@"; }
# Where the stack's database migrations live: the server's Prisma, MERL-T's Alembic and SQL.
MIGRATIONS="apps/server/prisma/migrations services/merlt/alembic/versions services/merlt/merlt/storage/migrations"

if [ -n "$(g status --porcelain)" ]; then
  err "the working tree has uncommitted changes: commit or stash them before pulling $branch"
  exit 1
fi
before="$(g rev-parse --short HEAD)"

say "fetching $branch from origin..."
# --force: on the deployment host origin's tags are the truth, so a moved tag is followed.
g fetch --quiet --prune --tags --force origin || { err "git fetch from origin failed (git's message is above)"; exit 1; }
g rev-parse --verify --quiet "refs/remotes/origin/$branch" >/dev/null \
  || { err "origin has no branch '$branch'"; exit 1; }
if ! g cat-file -e "origin/$branch:scripts/prod/deploy.sh" 2>/dev/null; then
  err "origin/$branch predates ./start.sh --prod (it has no scripts/prod/deploy.sh): release develop into main first, or deploy develop"
  exit 1
fi
# Migrations the checked-out version has and the target does not: the database may already
# carry them. Deleted, going from HEAD to the target.
# shellcheck disable=SC2086
missing="$(g diff --name-only --diff-filter=D HEAD "origin/$branch" -- $MIGRATIONS | sed 's,/[^/]*$,,' | sort -u)"
if [ -n "$missing" ]; then
  err "origin/$branch lacks database migrations that the checked-out version ($before) has:"
  printf '%s\n' "$missing" | sed 's/^/         /' >&2
  err "its code would run on a schema already migrated past it. Deploy develop, or restore the backup taken before that version (scripts/restore.sh) and then check out and deploy with --no-pull"
  exit 1
fi
if ! g merge-base --is-ancestor HEAD "origin/$branch"; then
  warn "origin/$branch does not contain every commit checked out now ($before): this deploy goes back on some changes"
fi

if g show-ref --verify --quiet "refs/heads/$branch"; then
  # Checked before the switch, so a refusal leaves the checkout where it was.
  if ! g merge-base --is-ancestor "$branch" "origin/$branch"; then
    err "the local $branch has commits that origin/$branch does not: it cannot be fast-forwarded. Push them or reset the branch, then run this again"
    exit 1
  fi
  g checkout --quiet "$branch"
  g merge --quiet --ff-only "origin/$branch"
else
  g checkout --quiet -b "$branch" --track "origin/$branch"
fi
# The submodule follows the commit just checked out: left behind, it reads as a change and
# the deploy would refuse the tree.
g submodule --quiet update --init --recursive \
  || { err "$branch is checked out, but its submodules could not be updated: run 'git submodule update --init --recursive' (with the network up), then this again"; exit 1; }

after="$(g rev-parse --short HEAD)"
if [ "$before" = "$after" ]; then
  say "$branch is up to date ($after)"
else
  say "$branch updated: $before -> $after"
fi
