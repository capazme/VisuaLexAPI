#!/bin/sh
# A pull request into main comes from develop (a release) or a hotfix/ branch.
set -eu
head="${1:?usage: check_release_source.sh <head branch>}"
case "$head" in
  develop|hotfix/*) echo "release source: $head" ;;
  *) echo "Pull requests into main come from develop or hotfix/..., not '$head' (docs/git-workflow.md)." >&2; exit 1 ;;
esac
