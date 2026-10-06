#!/bin/sh
# What the daily backup timer runs (backup-timer.sh): a backup of the stack named in
# infra/.env, then only the newest BACKUP_KEEP (default 7) of that stack's folders in
# ~/visualex-backups are kept, whoever took them (a deploy takes one too).
# A backup is complete when its folder holds manifest.json, written last; only complete
# ones count. A folder left half-written by a failure is removed once a newer complete
# backup exists (it can no longer be in progress), never before. A failed backup deletes
# nothing. Only folders named <stack>-YYYYMMDDTHHMMSSZ, as the backup tool names them, are
# ever removed.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$root/scripts/prod/lib.sh"
cd "$root"

# The stack as the backup tool reads it: the shell first, then infra/.env.
stack="${VISUALEX_STACK:-$(env_get infra/.env VISUALEX_STACK)}"; stack="${stack:-visualex}"
case "$stack" in ''|*[!a-z0-9_-]*) err "the stack name '$stack' is not a Compose project name"; exit 2 ;; esac
keep="${BACKUP_KEEP:-7}"
case "$keep" in ''|*[!0-9]*|0) err "BACKUP_KEEP must be a whole number of at least 1, not '$keep'"; exit 2 ;; esac

sh scripts/backup.sh

dir="$HOME/visualex-backups"
# The tool's names sort by time as text, newest first.
complete=0
ls -1 "$dir" 2>/dev/null \
  | grep -E "^${stack}-[0-9]{8}T[0-9]{6}Z\$" \
  | sort -r \
  | while IFS= read -r name; do
      if [ -f "$dir/$name/manifest.json" ]; then
        complete=$((complete + 1))
        [ "$complete" -le "$keep" ] && continue
        rm -rf -- "${dir:?}/$name"
        say "removed the old backup $name"
      elif [ "$complete" -gt 0 ]; then
        rm -rf -- "${dir:?}/$name"
        say "removed $name, a backup left half-written"
      fi
    done
