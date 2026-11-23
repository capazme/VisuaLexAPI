#!/bin/sh
# What the core pins (G-603): apps/web (lexcraft-web) and apps/mcp (lexcraft-mcp) each at a release
# tag vX.Y.Z of its own repository, and, where the pinned commit carries conventions/ itself, at the
# same commit of lexcraft-contracts as the core's conventions/: otherwise the web and the core would
# hold their copies to different contracts. Run from anywhere, after a checkout with the submodules.
#
#   check_pins.sh [submodule...]      # default: apps/web apps/mcp
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
g() { git -C "$root" "$@"; }
# The commit a submodule is pinned at, as the index records it (in CI the index is HEAD's); empty
# when the path is not a submodule.
pin() { g ls-files -s -- "$1" | awk '$1 == "160000" { print $2 }'; }
[ "$#" -gt 0 ] || set -- apps/web apps/mcp
fail=0

contract="$(pin conventions)"
[ -n "$contract" ] || { echo "the core records no conventions/ submodule" >&2; exit 1; }
[ -f "$root/conventions/sources/golden.json" ] \
  || { echo "conventions/ is empty: check out the submodules (git submodule update --init --recursive)" >&2; exit 1; }

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
  elif [ "$nested" = "$contract" ]; then
    echo "  its conventions/ is the core's ($contract)"
  else
    echo "$sub holds conventions/ at $nested and the core at $contract: they must be the same commit of lexcraft-contracts" >&2; fail=1
  fi
done
exit "$fail"
