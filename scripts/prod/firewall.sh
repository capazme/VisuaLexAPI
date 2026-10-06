#!/bin/sh
# H1 (deployment design, section 8): the containers on the stack's request-path network
# (APP_SUBNET: the scrapers, which render third-party pages, MERL-T, the server, the ingress)
# may not open connections to private addresses outside the stack: the home network, the
# overlay network (Tailscale, 100.64.0.0/10), link-local. The internet stays reachable.
#
#   firewall.sh apply      add the rules (replacing this stack's, if any)            needs root
#   firewall.sh remove     delete exactly this stack's rules                         needs root
#   firewall.sh status     this stack's rules, and a live check from a scraper
#   firewall.sh install    apply at every start of Docker, from a root-owned copy    needs root
#   firewall.sh uninstall  remove that copy, its unit and the rules                  needs root
#   --dry-run              print the iptables commands instead of running them
#
# Only Docker's DOCKER-USER chain is touched, and only with rules that carry this stack's
# comment, so another program's rules on a shared machine are never changed. Replies to
# connections made from outside (a published port) are let through first, then traffic inside
# the subnet, then DNS to the private resolvers Docker forwards to (it may forward a
# container's lookups from the container itself), then the drops.
#
# What it does not cover: a container reaching the HOST itself (its own addresses, SSH, its
# services) is INPUT, not FORWARD: that is the host firewall's job (H4). IPv6 is not enabled
# on the stack's networks. Docker's experimental nftables backend has no DOCKER-USER chain:
# the script refuses to run there.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
. "$here/lib.sh"

action="${1:-}"; dry=""
[ "${2:-}" = --dry-run ] && dry=1

# The settings: from the environment (the installed copy carries them), else infra/.env.
root="$(cd "$here/../.." 2>/dev/null && pwd || true)"
stack="${VISUALEX_STACK:-$(env_get "$root/infra/.env" VISUALEX_STACK)}"; stack="${stack:-visualex}"
subnet="${APP_SUBNET:-$(env_get "$root/infra/.env" APP_SUBNET)}"; subnet="${subnet:-172.29.240.0/24}"
case "$stack" in ''|*[!a-z0-9_-]*) err "the stack name '$stack' is not a Compose project name"; exit 2 ;; esac
# A private IPv4 block of /16 to /28: anything wider (0.0.0.0/0, say) would cut other
# programs' containers off the network too.
if ! printf '%s' "$subnet" | grep -Eq '^(10|172\.(1[6-9]|2[0-9]|3[01])|192\.168)\.[0-9]{1,3}\.[0-9]{1,3}/(1[6-9]|2[0-8])$'; then
  err "APP_SUBNET '$subnet' is not a private IPv4 block between /16 and /28"; exit 2
fi

# No ':' in the tag: iptables prints a comment with other characters in quotes.
tag="visualex-h1-$stack"
chain=DOCKER-USER
ranges="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16 100.64.0.0/10"
copy="/usr/local/lib/visualex-h1-$stack"
unit="/etc/systemd/system/visualex-h1-$stack.service"
resolv="${FIREWALL_RESOLV_CONF:-/etc/resolv.conf}"

need_root() {
  [ -n "$dry" ] && return 0
  [ "$(id -u)" = 0 ] || { err "this changes the host firewall: run it with sudo"; exit 1; }
  command -v iptables >/dev/null 2>&1 || { err "iptables is missing"; exit 1; }
  iptables -S "$chain" >/dev/null 2>&1 \
    || { err "the $chain chain does not exist: is Docker running, with its iptables integration (not the nftables backend)?"; exit 1; }
}

ipt() { # the command, or its text with --dry-run; -w waits for the xtables lock (legacy)
  if [ -n "$dry" ]; then printf 'iptables %s\n' "$*"; else iptables -w "$@"; fi
}

is_private() {
  case "$1" in
    10.*|192.168.*|169.254.*) return 0 ;;
    172.1[6-9].*|172.2[0-9].*|172.3[01].*) return 0 ;;
    100.6[4-9].*|100.[7-9][0-9].*|100.1[01][0-9].*|100.12[0-7].*) return 0 ;;
    *) return 1 ;;
  esac
}

# The resolvers Docker forwards to: those of the host, or systemd-resolved's real ones when
# the host points at its local stub. Only private ones need an exception.
private_resolvers() {
  file="$resolv"
  if grep -Eq '^nameserver[[:space:]]+127\.0\.0\.53' "$file" 2>/dev/null && [ -f /run/systemd/resolve/resolv.conf ]; then
    file=/run/systemd/resolve/resolv.conf
  fi
  sed -n 's/^nameserver[[:space:]]*\([0-9.]*\).*/\1/p' "$file" 2>/dev/null | while IFS= read -r ns; do
    if is_private "$ns"; then printf '%s\n' "$ns"; fi
  done | sort -u
}

# The rules, in the order they must be met. -I at position N keeps them ahead of whatever
# Docker or anyone else put in the chain (Docker's own default is a final RETURN).
rules() {
  printf '%s\n' "-s $subnet -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"
  printf '%s\n' "-s $subnet -d $subnet -j RETURN"
  for ns in $(private_resolvers); do
    printf '%s\n' "-s $subnet -d $ns/32 -p udp --dport 53 -j RETURN"
    printf '%s\n' "-s $subnet -d $ns/32 -p tcp --dport 53 -j RETURN"
  done
  for range in $ranges; do printf '%s\n' "-s $subnet -d $range -j DROP"; done
}

# This stack's rules as `iptables -S` prints them. The match is anchored on both sides of
# the comment, so the rules of a stack whose name extends this one's are never taken.
ours() { iptables -S "$chain" 2>/dev/null | grep -F -- "--comment $tag -j " || true; }

remove_rules() {
  ours | while IFS= read -r line; do
    # shellcheck disable=SC2086
    ipt -D ${line#-A }
  done
}

apply_rules() {
  [ -n "$dry" ] || remove_rules
  n=1
  rules | while IFS= read -r spec; do
    # shellcheck disable=SC2086
    if ! ipt -I "$chain" "$n" $spec -m comment --comment "$tag"; then
      # Half a rule set (exceptions without drops) would look applied and protect nothing.
      err "adding a rule failed: this stack's rules are taken out again"
      remove_rules
      exit 1
    fi
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
    scraper="$stack-scrapers"
    if ! docker ps -q --filter "name=^$scraper\$" 2>/dev/null | grep -q .; then
      say "the scrapers are not running here: nothing checked from inside"
      exit 0
    fi
    # The time is measured: a lookup that only succeeds after a resolver timed out is a
    # resolver being dropped.
    dns="$(docker exec "$scraper" python -c "
import socket, time
t = time.monotonic()
try:
    socket.getaddrinfo('www.normattiva.it', 443)
except OSError:
    print('failed')
else:
    print('slow' if time.monotonic() - t > 2 else 'ok')" 2>/dev/null || echo failed)"
    case "$dns" in
      ok) say "a scraper resolves names: yes" ;;
      slow) warn "a scraper resolves names, but slowly (over 2 s): a resolver is probably dropped. Report it" ;;
      *) warn "a scraper cannot resolve names: the sources will fail. Remove the rules (sudo sh scripts/prod/firewall.sh uninstall) and report it" ;;
    esac
    # The home router (the host's default gateway): a drop is a timeout; a refusal or an
    # answer means the scraper reached it.
    gateway="$(ip route show default 2>/dev/null | sed -n 's/^default via \([0-9.]*\).*/\1/p' | head -1)"
    if [ -n "$gateway" ]; then
      verdict="$(docker exec "$scraper" python -c "
import socket
try:
    socket.create_connection(('$gateway', 80), 3)
    print('reached')
except socket.timeout:
    print('blocked')
except OSError:
    print('reached')" 2>/dev/null || echo unknown)"
      case "$verdict" in
        blocked) say "the home network from a scraper ($gateway): blocked" ;;
        reached) warn "the home network from a scraper ($gateway): REACHED — H1 is not in effect" ;;
        *) warn "the home network from a scraper: could not be checked" ;;
      esac
    fi
    ;;
  install)
    need_root
    if [ -n "$dry" ]; then printf 'would copy the script to %s and write and enable %s\n' "$copy" "$unit"; exit 0; fi
    # Root runs a copy that only root can change, with the settings written into the unit:
    # never the checkout, which the deploying user can edit and git pull can change.
    install -d -o root -g root -m 755 "$copy"
    install -o root -g root -m 755 "$here/firewall.sh" "$copy/firewall.sh"
    install -o root -g root -m 644 "$here/lib.sh" "$copy/lib.sh"
    cat >"$unit" <<UNIT
[Unit]
Description=VisuaLex H1: the stack $stack's containers kept off private networks
After=docker.service
PartOf=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
Environment=VISUALEX_STACK=$stack APP_SUBNET=$subnet
ExecStart=/bin/sh $copy/firewall.sh apply

[Install]
WantedBy=multi-user.target docker.service
UNIT
    systemctl daemon-reload
    systemctl enable "$(basename "$unit")"
    # restart, not start: an installed unit is already active, and a start would not apply a
    # new subnet or a new copy of the script.
    systemctl restart "$(basename "$unit")"
    say "installed: $(basename "$unit") applies the rules whenever Docker starts, from $copy"
    ;;
  uninstall)
    need_root
    if [ -n "$dry" ]; then printf 'would disable and delete %s and %s, then remove the rules\n' "$unit" "$copy"; exit 0; fi
    systemctl disable --now "$(basename "$unit")" 2>/dev/null || true
    rm -f "$unit"
    rm -rf "$copy"
    systemctl daemon-reload
    remove_rules
    say "uninstalled: the unit, its copy and this stack's rules are gone"
    ;;
  *)
    err "usage: firewall.sh apply | remove | status | install | uninstall [--dry-run]"; exit 2 ;;
esac
