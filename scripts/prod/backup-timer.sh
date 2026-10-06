#!/bin/sh
# The daily backup of the production stack, as a systemd user timer (backup-daily.sh at
# 03:30, the newest BACKUP_KEEP folders kept, default 7).
#
#   backup-timer.sh install   write and start the timer for the stack in infra/.env
#   backup-timer.sh remove    stop it and delete its unit files
#   backup-timer.sh status    when it runs next, and the newest backup
#
# A user timer runs only while the user is logged in, unless lingering is on: once, as an
# administrator, `sudo loginctl enable-linger <user>`. The user must be able to use Docker
# (the docker group). Backups stay on this machine; the copy elsewhere is a later step.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$root/scripts/prod/lib.sh"

stack="$(env_get "$root/infra/.env" VISUALEX_STACK)"; stack="${stack:-visualex}"
unit="$stack-backup"
units="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

case "${1:-}" in
  install)
    command -v systemctl >/dev/null 2>&1 || { err "systemctl is missing: the timer needs systemd (the Linux host)"; exit 1; }
    command -v python3 >/dev/null 2>&1 || { err "python3 is needed by the backup tool: install it first"; exit 1; }
    mkdir -p "$units"
    cat >"$units/$unit.service" <<UNIT
[Unit]
Description=Back up the VisuaLex stack $stack

[Service]
Type=oneshot
WorkingDirectory=$root
ExecStart=/bin/sh $root/scripts/prod/backup-daily.sh
UNIT
    cat >"$units/$unit.timer" <<UNIT
[Unit]
Description=Back up the VisuaLex stack $stack every day

[Timer]
OnCalendar=*-*-* 03:30:00
# A run missed while the machine was off happens at the next start.
Persistent=true
RandomizedDelaySec=10min

[Install]
WantedBy=timers.target
UNIT
    systemctl --user daemon-reload
    systemctl --user enable --now "$unit.timer"
    say "installed: $unit.timer, daily at 03:30, the newest 7 backups kept in ~/visualex-backups"
    if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null || true)" != yes ]; then
      warn "lingering is off: the timer runs only while $(id -un) is logged in. Once, as an administrator: sudo loginctl enable-linger $(id -un)"
    fi
    ;;
  remove)
    systemctl --user disable --now "$unit.timer" 2>/dev/null || true
    rm -f "$units/$unit.timer" "$units/$unit.service"
    systemctl --user daemon-reload
    say "removed: $unit.timer (the backups already taken stay in ~/visualex-backups)"
    ;;
  status)
    systemctl --user list-timers "$unit.timer" --all || true
    newest="$(ls -1 "$HOME/visualex-backups" 2>/dev/null | grep -E "^${stack}-[0-9]{8}T[0-9]{6}Z\$" | sort -r | head -1 || true)"
    say "newest backup: ${newest:-none}"
    ;;
  *)
    err "usage: backup-timer.sh install | remove | status"; exit 2 ;;
esac
