#!/bin/sh
# Tests for scripts/release-notes.sh, on a throwaway git repository.
set -eu
script="$(cd "$(dirname "$0")/.." && pwd)/release-notes.sh"
fail=0
repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
g() { git -C "$repo" -c user.name=t -c user.email=t@example.invalid "$@"; }
land() {  # land <branch> <merge title>
  g switch -q -c "$1" develop
  g commit -q --allow-empty -m "work on $1"
  g switch -q develop
  g merge -q --no-ff "$1" -m "$2"
}
g init -q -b develop
g commit -q --allow-empty -m base
g tag v1.0.0
land fix/a "merge: fix/a — a fix"
land feat/b "merge: feat/b — a feature"
land feat/c "Merge branch 'feat/c'"
land chore/d "merge: chore/d — housekeeping"

out="$(cd "$repo" && sh "$script" v1.0.0)"
has() {  # has <description> <fixed string>
  if printf '%s\n' "$out" | grep -qF -- "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}
has "a feature is listed under Features" "### Features"
has "with its title and hash" "- feat/b — a feature ("
has "a fix is listed under Fixes" "- fix/a — a fix ("
has "chore is maintenance" "### Maintenance"
if printf '%s\n' "$out" | grep -q "feat/c"; then echo "FAIL a merge git named is left out"; fail=1; else echo "ok   a merge git named is left out"; fi
first="$(printf '%s\n' "$out" | head -n 1)"
if [ "$first" = "### Features" ]; then echo "ok   Features come first"; else echo "FAIL Features come first (got '$first')"; fail=1; fi
if (cd "$repo" && sh "$script") >/dev/null 2>&1; then echo "FAIL a missing ref is refused"; fail=1; else echo "ok   a missing ref is refused"; fi
if (cd "$repo" && sh "$script" v9.9.9) >/dev/null 2>&1; then echo "FAIL an unknown ref is refused"; fail=1; else echo "ok   an unknown ref is refused"; fi
exit $fail
