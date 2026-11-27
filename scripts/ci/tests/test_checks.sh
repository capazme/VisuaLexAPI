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
# What the core pins (check_pins.sh), on throwaway repositories: a contract, a web, and a core that
# holds both as submodules. The script runs from a copy of scripts/ci inside the core; the contract
# carries the core's own conventions/compat, which judges the classes (G-607…G-611).
pins="$(mktemp -d)"
trap 'rm -rf "$repo" "$web" "$pins"' EXIT
gp() { d="$1"; shift; git -C "$d" -c user.name=t -c user.email=t@example.invalid -c protocol.file.allow=always "$@"; }
mkrepo() { git init -q -b develop "$1" && gp "$1" commit -q --allow-empty -m base; }
golden() {  # golden <proposed citation> <decided citation>
  printf '{ "version": 1, "norms": [{ "id": "n", "labels": { "citation": { "value": "%s", "status": "proposed" }, "short": { "value": "%s", "status": "decided" } } }] }\n' "$1" "$2" \
    >"$pins/contracts/sources/golden.json"
}
paths() { printf '{ "version": 1, "note": "%s", "paths": [%s] }\n' "$2" "$1" >"$pins/contracts/contract/legal-paths.json"; }
# contract <message>: a commit on the contract's develop, as a merged pull request leaves it.
contract() { gp "$pins/contracts" add -A; gp "$pins/contracts" commit -q -m "$1"; gp "$pins/contracts" rev-parse HEAD; }
# core_at <commit>: the core pins its conventions there.
core_at() { gp "$pins/core/conventions" fetch -q origin '+refs/heads/*:refs/remotes/origin/*'; gp "$pins/core/conventions" checkout -q "$1"; gp "$pins/core" add conventions; }
# web_at <commit> <tag>: a release of the web holding that contract, which the core pins.
web_at() {
  gp "$pins/web/conventions" fetch -q origin '+refs/heads/*:refs/remotes/origin/*'; gp "$pins/web/conventions" checkout -q "$1"
  gp "$pins/web" add conventions; gp "$pins/web" commit -q -m "the contract, $2"; gp "$pins/web" tag "$2"
  gp "$pins/core/apps/web" fetch -q --tags origin; gp "$pins/core/apps/web" checkout -q "$2"; gp "$pins/core" add apps/web
}
mkrepo "$pins/contracts"; mkdir -p "$pins/contracts/sources" "$pins/contracts/contract"
cp -R "$here/../../conventions/compat" "$pins/contracts/compat"
golden a s; paths '"/a"' n; echo 1.70.0 >"$pins/contracts/version.txt"
base="$(contract "the contract")"
mkrepo "$pins/web"; gp "$pins/web" submodule add -q "$pins/contracts" conventions; gp "$pins/web" commit -q -m "the contract"; gp "$pins/web" tag v1.0.0
mkrepo "$pins/core"; mkdir -p "$pins/core/scripts"; cp -R "$here" "$pins/core/scripts/ci"
gp "$pins/core" submodule add -q "$pins/contracts" conventions
gp "$pins/core" submodule add -q "$pins/web" apps/web
gp "$pins/core" submodule update -q --init --recursive
gp "$pins/core" add -A; gp "$pins/core" commit -q -m pins
check_pins() { sh "$pins/core/scripts/ci/check_pins.sh" apps/web; }
expect 0 "a web pinned at a tag, with the core's contract, passes" check_pins
gp "$pins/core/apps/web" commit -q --allow-empty -m "not a release"; gp "$pins/core" add apps/web
expect 1 "a web pinned at a commit that is no release tag fails" check_pins
gp "$pins/core/apps/web" checkout -q v1.0.0; gp "$pins/core" add apps/web

# The case of the Corte costituzionale's massime: a path added to the contract, and the core moves
# alone; the web keeps the contract it was released with.
paths '"/a", "/search_corte_cost_massime"' n; echo 1.71.0 >"$pins/contracts/version.txt"
core_at "$(contract "a path")"
expect 0 "the core alone takes a path added to the contract: the web's older contract is contained" check_pins
golden b s; core_at "$(contract "a proposed citation corrected")"
expect 0 "a value still proposed corrected in the core's contract passes (G-610)" check_pins
paths '"/a", "/search_corte_cost_massime"' "another note"; core_at "$(contract "a note")"
expect 0 "a note changed in the core's contract passes" check_pins
golden b t; decided="$(contract "a decided citation changed")"; core_at "$decided"
expect 1 "a decided value changed in the core's contract fails: a major moves all together" check_pins
web_at "$decided" v1.1.0
expect 0 "the web released on that contract passes again" check_pins
paths '"/a", "/search_corte_cost_massime", "/b"' "another note"; echo 2.0.0 >"$pins/contracts/version.txt"
core_at "$(contract "a path, marked a major")"
expect 1 "a major raised by hand fails, though the files show only an addition" check_pins
echo 1.71.0 >"$pins/contracts/version.txt"
paths '"/a", "/search_corte_cost_massime"' "another note"; back="$(contract "back to the web's")"; core_at "$back"
expect 0 "the same files under another commit, same major, pass" check_pins
gp "$pins/core/conventions" commit -q --allow-empty -m "never pushed"; gp "$pins/core" add conventions
expect 1 "the core's contract at a commit not on the contract's develop fails" check_pins
core_at "$back"
paths '"/a", "/search_corte_cost_massime", "/c"' "another note"; ahead="$(contract "a path the core has not taken")"
web_at "$ahead" v1.2.0
expect 1 "a web whose contract is ahead of the core's fails" check_pins
core_at "$ahead"
expect 0 "once the core takes that contract, it passes" check_pins
gp "$pins/contracts" switch -q -c feat/unmerged; paths '"/a", "/search_corte_cost_massime", "/c", "/d"' "another note"
unmerged="$(contract "a branch nobody merged")"; gp "$pins/contracts" switch -q develop
web_at "$unmerged" v1.3.0
expect 1 "a web holding a contract commit that is not on its develop fails" check_pins
web_at "$ahead" v1.4.0
gp "$pins/contracts" rm -q -r compat; paths '"/a", "/search_corte_cost_massime", "/c", "/e"' "another note"
core_at "$(contract "a contract from before compat/")"
expect 1 "a core's contract with no compat/ to compare with asks for the same commit" check_pins
mkrepo "$pins/mcp"; gp "$pins/mcp" tag v1.0.0
gp "$pins/core" submodule add -q "$pins/mcp" apps/mcp; gp "$pins/core" commit -q -m "the MCP server"
expect 0 "a component at a tag with no contract of its own passes (a release from before the split)" sh "$pins/core/scripts/ci/check_pins.sh" apps/mcp
exit $fail
