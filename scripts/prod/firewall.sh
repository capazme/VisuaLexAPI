#!/bin/sh
# H1 (deployment design, section 8): the containers on the stack's request-path network
# (APP_SUBNET: the scrapers, which render third-party pages, MERL-T, the server, the ingress)
# may not open connections to private addresses outside the stack: the home network, the
# overlay network (Tailscale, 100.64.0.0/10), link-local. The internet stays reachable.
#
#   firewall.sh apply      add the rules (replacing this stack's, if any)       needs root
#   firewall.sh remove     delete exactly this stack's rules                    needs root
#   firewall.sh status     list this stack's rules, and whether a scraper still resolves names
#   firewall.sh install    apply at every boot, after Docker (a systemd unit)   needs root
#   firewall.sh uninstall  remove the unit and the rules                        needs root
#   --dry-run              print the iptables commands instead of running them
#
# Only Docker's DOCKER-USER chain is touched, and only with rules that carry this stack's
# comment, so another program's rules on a shared machine are never changed. Replies to
# connections made from outside (a published port) are let through first; traffic inside the
# subnet too. DNS to the overlay's resolver (100.100.100.100) is allowed, in case Docker
# forwards a container's lookups from the container itself.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$root/scripts/prod/lib.sh"

action="${1:-}"; dry=""
[ "${2:-}" = --dry-run ] && dry=1
stack="$(env_get "$root/infra/.env" VISUALEX_STACK)"; stack="${stack:-visualex}"
subnet="$(env_get "$root/infra/.env" APP_SUBNET)"; subnet="${subnet:-172.29.240.0/24}"
tag="visualex-h1:$stack"
chain=DOCKER-USER
ranges="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10"
unit="/etc/systemd/system/$stack-h1.service"

need_root() {
  [ -n "$dry" ] && return 0
  [ "$(id -u)" = 0 ] || { err "this changes the host firewall: run it with sudo"; exit 1; }
  command -v iptables >/dev/null 2>&1 || { err "iptables is missing"; exit 1; }
  iptables -S "$chain" >/dev/null 2>&1 \
    || { err "the $chain chain does not exist: is Docker running, with its iptables integration on?"; exit 1; }
}

ipt() { # the command, or its text with --dry-run
  if [ -n "$dry" ]; then printf 'iptables %s\n' "$*"; else iptables "$@"; fi
}

# The rules, in the order they must be met. -I at position N keeps them ahead of whatever
# Docker or anyone else put in the chain (Docker's own default is a final RETURN).
rules() {
  printf '%s\n' "-s $subnet -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN"
  printf '%s\n' "-s $subnet -d $subnet -j RETURN"
  printf '%s\n' "-s $subnet -d 100.100.100.100/32 -p udp --dport 53 -j RETURN"
  printf '%s\n' "-s $subnet -d 100.100.100.100/32 -p tcp --dport 53 -j RETURN"
  for range in $ranges; do printf '%s\n' "-s $subnet -d $range -j DROP"; done
}

# This stack's rules as `iptables -S` prints them, one per line.
ours() { iptables -S "$chain" 2>/dev/null | grep -F -- "--comment $tag" || true; }

remove_rules() {
  ours | while IFS= read -r line; do
    # "-A DOCKER-USER <spec>" deletes as "-D DOCKER-USER <spec>"; the spec has no quotes
    # (the comment has no spaces).
    # shellcheck disable=SC2086
    ipt -D ${line#-A }
  done
}

apply_rules() {
  remove_rules
  n=1
  rules | while IFS= read -r spec; do
    # shellcheck disable=SC2086
    ipt -I "$chain" "$n" $spec -m comment --comment "$tag"
    n=$((n + 1))
  done
}

case "$action" in
  apply)
    need_root
    apply_rules
    [ -n "$dry" ] || say "applied: new connections from $subnet to private ranges outside it are dropped ($tag). Check with: sh scripts/prod/firewall.sh status"
    ;;
  remove)
    need_root
    remove_rules
    [ -n "$dry" ] || say "removed this stack's rules ($tag); nothing else in $chain was changed"
    ;;
  status)
    rules_now="$(ours)"
    if [ -z "$rules_now" ]; then say "no rules for $tag (or no permission to read them: try with sudo)"; else say "$rules_now"; fi
    if docker ps -q --filter "name=^$stack-scrapers\$" 2>/dev/null | grep -q .; then
      if docker exec "$stack-scrapers" python -c "import socket; socket.getaddrinfo('www.normattiva.it', 443)" >/dev/null 2>&1; then
        say "a scraper resolves names: yes"
      else
        warn "a scraper cannot resolve names: the sources will fail. Remove the rules (sudo sh scripts/prod/firewall.sh remove) and report it"
      fi
    fi
    ;;
  install)
    need_root
    if [ -n "$dry" ]; then printf 'would write %s and enable it\n' "$unit"; exit 0; fi
    cat >"$unit" <<UNIT
[Unit]
Description=VisuaLex H1: the stack $stack's containers kept off private networks
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh $root/scripts/prod/firewall.sh apply
ExecStop=/bin/sh $root/scripts/prod/firewall.sh remove

[Install]
WantedBy=multi-user.target
UNIT
    systemctl daemon-reload
    systemctl enable --now "$(basename "$unit")"
    say "installed: $(basename "$unit") applies the rules at every boot, after Docker"
    ;;
  uninstall)
    need_root
    if [ -n "$dry" ]; then printf 'would disable and delete %s, then remove the rules\n' "$unit"; exit 0; fi
    systemctl disable --now "$(basename "$unit")" 2>/dev/null || true
    rm -f "$unit"
    systemctl daemon-reload
    remove_rules
    say "uninstalled: the unit and this stack's rules are gone"
    ;;
  *)
    err "usage: firewall.sh apply | remove | status | install | uninstall [--dry-run]"; exit 2 ;;
esac
