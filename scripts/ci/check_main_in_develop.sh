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
