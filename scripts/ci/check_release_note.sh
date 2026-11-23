#!/bin/sh
# The release note of version.txt exists and says something: the window «Novità» shows it after
# an update, and a release without it would show an empty one (docs/git-workflow.md, «Versions»).
#
#   check_release_note.sh [web app folder]
#
# The note is a file of the web app: <web app folder>/src/content/novita/<version>.md. The folder
# is read from the repository root when it is relative. The default is apps/web/app, the app
# folder of the pinned lexcraft-web submodule (G-603, G-604).
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
web="${1:-apps/web/app}"
case "$web" in /*) ;; *) web="$root/$web" ;; esac

[ -f "$root/version.txt" ] || { echo "version.txt is missing at the repository root." >&2; exit 1; }
version="$(tr -d '[:space:]' <"$root/version.txt")"
if ! printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "version.txt holds '$version', not a version X.Y.Z." >&2; exit 1
fi

note="$web/src/content/novita/$version.md"
shown="${note#"$root"/}"
if [ ! -f "$note" ]; then
  echo "The release note $shown is missing: the release pull request adds it with version.txt (docs/git-workflow.md)." >&2
  exit 1
fi
if ! grep -q '[^[:space:]]' "$note"; then
  echo "The release note $shown is empty: write the Italian note for $version (docs/git-workflow.md)." >&2
  exit 1
fi
echo "release note: $shown"
