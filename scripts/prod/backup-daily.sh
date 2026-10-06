#!/bin/sh
# What the daily backup timer runs (backup-timer.sh): a backup of the stack named in
# infra/.env, then only the newest BACKUP_KEEP (default 7) of that stack's folders in
# ~/visualex-backups are kept, whoever took them (a deploy takes one too).
# A failed backup deletes nothing. Only folders named <stack>-YYYYMMDDTHHMMSSZ, as the
# backup tool names them, are ever removed.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$root/scripts/prod/lib.sh"
cd "$root"

stack="$(env_get infra/.env VISUALEX_STACK)"; stack="${stack:-visualex}"
keep="${BACKUP_KEEP:-7}"
case "$keep" in ''|*[!0-9]*|0) err "BACKUP_KEEP must be a whole number of at least 1, not '$keep'"; exit 2 ;; esac

sh scripts/backup.sh

dir="$HOME/visualex-backups"
# The tool's names sort by time as text; everything but the newest $keep goes.
ls -1 "$dir" 2>/dev/null \
  | grep -E "^${stack}-[0-9]{8}T[0-9]{6}Z\$" \
  | sort -r \
  | awk -v keep="$keep" 'NR > keep' \
  | while IFS= read -r old; do
      rm -rf -- "${dir:?}/$old"
      say "removed the old backup $old"
    done
