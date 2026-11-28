#!/bin/sh
# What the core pins (G-603, G-607…G-611):
#  - apps/web (lexcraft-web) and apps/mcp (lexcraft-mcp), each at a release tag vX.Y.Z of its own
#    repository;
#  - conventions/ at a commit of lexcraft-contracts that is on its develop or main, so reviewed;
#  - where a pinned component carries conventions/ itself, a contract the core's contains: the same
#    commit, or another one, reviewed, of the same major (version.txt), from which the core's
#    contract is an addition. The class is recomputed from the files at every run, by the core's own
#    conventions/compat/compare.mjs: none, patch or minor passes; a major, a blocked change, or a
#    component ahead of the core fails (lexcraft-contracts' README, «Versions»). A number may make
#    the class higher (a raised major), never lower.
# Run from anywhere, after a checkout with the submodules.
#
#   check_pins.sh [submodule...]      # default: apps/web apps/mcp
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
g() { git -C "$root" "$@"; }
c() { git -C "$root/conventions" "$@"; }
# The commit a submodule is pinned at, as the index records it (in CI the index is HEAD's); empty
# when the path is not a submodule.
pin() { g ls-files -s -- "$1" | awk '$1 == "160000" { print $2 }'; }
[ "$#" -gt 0 ] || set -- apps/web apps/mcp
fail=0

contract="$(pin conventions)"
[ -n "$contract" ] || { echo "the core records no conventions/ submodule" >&2; exit 1; }
[ -f "$root/conventions/sources/golden.json" ] \
  || { echo "conventions/ is empty: check out the submodules (git submodule update --init --recursive)" >&2; exit 1; }

# The contract's history, to tell a reviewed commit and to read older ones: in CI the submodule is a
# shallow clone of one commit.
if [ "$(c rev-parse --is-shallow-repository)" = true ]; then c fetch -q --unshallow origin 2>/dev/null || true; fi
for branch in develop main; do
  c fetch -q origin "+refs/heads/$branch:refs/remotes/origin/$branch" 2>/dev/null || true
done
# reviewed <commit>: on lexcraft-contracts' develop or main, where only a merged pull request lands.
reviewed() {
  for branch in develop main; do
    c rev-parse -q --verify "refs/remotes/origin/$branch" >/dev/null || continue
    c merge-base --is-ancestor "$1" "refs/remotes/origin/$branch" 2>/dev/null && return 0
  done
  return 1
}
# version <commit>: the contract's version.txt there. The commits from before the repository had one
# are the 1.x line of the monorepo's releases (lexcraft-contracts' README, «Versions»).
version() { c show "$1:version.txt" 2>/dev/null | tr -d ' \r\n' || true; }
major() { v="$(version "$1")"; echo "${v:-1}" | cut -d. -f1; }

if reviewed "$contract"; then
  echo "conventions at $contract ($(version "$contract")), on lexcraft-contracts' develop or main"
else
  echo "conventions is pinned at $contract, which is not on lexcraft-contracts' develop or main: merge its pull request there first" >&2
  fail=1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# The folder's real path: on macOS mktemp answers under /var, a link to /private/var, and a script
# run through a link may not know itself as the one node was asked to run.
tmp="$(cd "$tmp" && pwd -P)"
# tree <commit> <dir>: the contract's files at that commit, and the tool that compares them.
tree() {
  mkdir -p "$2"
  paths="$(c ls-tree --name-only "$1" | grep -E '^(sources|contract|compat)$' || true)"
  # Fixed folder names, one per line: word splitting is what is wanted.
  # shellcheck disable=SC2086
  [ -z "$paths" ] || c archive "$1" -- $paths | tar -x -C "$2"
}
tree "$contract" "$tmp/core"

for sub in "$@"; do
  pinned="$(pin "$sub")"
  if [ -z "$pinned" ]; then echo "$sub is not a submodule of the core" >&2; fail=1; continue; fi
  if ! git -C "$root/$sub" cat-file -e "$pinned^{commit}" 2>/dev/null; then
    echo "$sub is not checked out at $pinned: git submodule update --init --recursive" >&2; fail=1; continue
  fi
  # A checkout of a submodule brings no tags: ask its repository for them.
  git -C "$root/$sub" fetch -q --tags origin 2>/dev/null || true
  # An unchanged repository carries several releases' tags on one commit: the latest names it.
  tag="$(git -C "$root/$sub" tag --points-at "$pinned" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1 || true)"
  if [ -n "$tag" ]; then
    echo "$sub at $tag ($pinned)"
  else
    echo "$sub is pinned at $pinned, which is not a release tag vX.Y.Z of its repository" >&2; fail=1
  fi
  nested="$(git -C "$root/$sub" rev-parse -q --verify "$pinned:conventions" 2>/dev/null || true)"
  if [ -z "$nested" ]; then
    echo "  it carries no conventions/ of its own (a release from before the split)"
    continue
  fi
  if [ "$nested" = "$contract" ]; then
    echo "  its conventions/ is the core's ($contract)"
    continue
  fi
  if ! reviewed "$nested"; then
    echo "$sub holds conventions/ at $nested, which is not on lexcraft-contracts' develop or main" >&2; fail=1; continue
  fi
  if [ ! -f "$tmp/core/compat/compare.mjs" ]; then
    echo "$sub holds conventions/ at $nested and the core at $contract, whose contract has no compat/compare.mjs to compare them: they must be the same commit" >&2
    fail=1; continue
  fi
  if [ "$(major "$nested")" != "$(major "$contract")" ]; then
    echo "$sub holds a contract of version $(version "$nested") ($nested) and the core one of $(version "$contract"): a different major, and a major moves all together" >&2
    fail=1; continue
  fi
  command -v node >/dev/null || { echo "node is needed to compare $sub's contract with the core's" >&2; fail=1; continue; }
  tree "$nested" "$tmp/$sub"
  if ! out="$(node "$tmp/core/compat/compare.mjs" "$tmp/$sub" "$tmp/core")"; then
    echo "$sub: the contracts could not be compared" >&2; fail=1; continue
  fi
  class="$(printf '%s\n' "$out" | sed -n 's/^class: //p')"
  case "$class" in
    none|patch|minor)
      echo "  its conventions/ ($nested, $(version "$nested")) is contained in the core's: from it to the core's is a $class change" ;;
    *)
      echo "$sub holds conventions/ at $nested ($(version "$nested")), and from it to the core's ($contract) is a $class change, not an addition:" >&2
      printf '%s\n' "$out" | sed -n '2,11p' | sed 's/^/  /' >&2
      echo "  move $sub to the core's contract, or the core's to one that contains $sub's" >&2
      fail=1 ;;
  esac
done
exit "$fail"
