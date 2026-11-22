#!/bin/sh
# Tests for the repository checks: the release source and main-in-develop on a throwaway git
# repository, the release note on a throwaway folder.
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

# The note of the version in version.txt, in a web app folder of its own.
version="$(tr -d '[:space:]' <"$here/../../version.txt")"
web="$(mktemp -d)"
repo="$(mktemp -d)"
trap 'rm -rf "$repo" "$web"' EXIT
mkdir -p "$web/src/content/novita"
note="$web/src/content/novita/$version.md"
expect 1 "a release note that is missing fails" sh "$here/check_release_note.sh" "$web"
: >"$note"
expect 1 "an empty release note fails" sh "$here/check_release_note.sh" "$web"
printf ' \n\n' >"$note"
expect 1 "a release note of blank lines fails" sh "$here/check_release_note.sh" "$web"
printf '**Accesso**\n- una novita\n' >"$note"
expect 0 "a release note with text passes" sh "$here/check_release_note.sh" "$web"

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
