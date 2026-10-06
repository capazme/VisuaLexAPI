#!/bin/sh
# What ./start.sh --prod checks before it changes anything.
#
#   preflight.sh host [--allow-branch]   the machine and the checkout
#   preflight.sh docker                  the machine alone (before a pull)
#   preflight.sh env                     the two env files
#   preflight.sh ports                   the ports the stack publishes, before a build
#
# A value is never printed: a message names the KEY and the file, and that is all.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$root/scripts/prod/lib.sh"

# The machine alone: run before anything is pulled, so a host that cannot deploy is found
# before the checkout moves.
check_docker() {
  command -v docker >/dev/null 2>&1 || { err "docker is not installed"; return 1; }
  docker info >/dev/null 2>&1 || { err "the Docker daemon does not answer: is it running, and is this user allowed to use it?"; return 1; }
  version="$(docker compose version --short 2>/dev/null || true)"
  version="${version#v}"
  [ -n "$version" ] || { err "the Docker Compose plugin is missing"; return 1; }
  version_ge "$version" 2.24 || { err "Docker Compose $version is too old: 2.24 or newer is required"; return 1; }
  case "$(uname -s)" in
    Linux) ;;
    *) warn "--prod is meant for the Linux host; this is $(uname -s), fine for a trial but not for the deployment" ;;
  esac
}

check_host() {
  allow="${1:-}"
  check_docker || return 1

  git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { err "$root is not a git checkout"; return 1; }
  if [ -n "$(git -C "$root" status --porcelain)" ]; then
    err "the working tree has uncommitted changes: commit or stash them (what is deployed must be something you can go back to)"
    return 1
  fi
  branch="$(git -C "$root" symbolic-ref -q --short HEAD || true)"
  tag="$(git -C "$root" describe --exact-match --tags --match 'v[0-9]*' HEAD 2>/dev/null || true)"
  sha="$(git -C "$root" rev-parse --short HEAD)"
  # main is the released version, develop the latest work (shown before a release); any other
  # branch is a trial, and says so.
  if [ "$branch" != main ] && [ "$branch" != develop ] && [ -z "$tag" ]; then
    if [ "$allow" = --allow-branch ]; then
      warn "deploying '${branch:-a detached HEAD}', which is neither main, develop nor a release tag (--allow-branch)"
    else
      err "HEAD is on '${branch:-a detached HEAD}': deploy main, develop or a vX.Y.Z tag, or pass --allow-branch"
      return 1
    fi
  fi
  if [ "$branch" = develop ] && [ -z "$tag" ]; then
    warn "deploying develop: the latest work, not a release"
  fi
  say "deploying ${tag:-${branch:-detached HEAD}} ($sha)"
}

# What the development flow uses as passwords and secrets: none may reach production.
is_development_value() {
  case "$1" in
    postgres|visualex|merlt|dev-internal-secret|CHANGE_ME*|use_a_strong_password_here) return 0 ;;
    *) return 1 ;;
  esac
}

# The host of an origin or a URL (no scheme, port or path).
host_of() { printf '%s' "$1" | sed -n 's#^[a-z]*://\([^/:]*\).*#\1#p'; }

# https, or http on this machine (throwaway trials). Anything else would send OAuth tokens in clear.
secure_or_local() {
  case "$1" in
    https://*) return 0 ;;
    http://localhost|http://localhost:*|http://localhost/*|http://127.0.0.1|http://127.0.0.1:*|http://127.0.0.1/*) return 0 ;;
    *) return 1 ;;
  esac
}

# A secret fit for production: set, not a development value, 32 characters or more.
check_secret() { # check_secret <file> <KEY> <label>
  value="$(env_get "$1" "$2")"
  if [ -z "$value" ]; then err "$2 is not set in $3"; return 1; fi
  if is_development_value "$value" || [ "${#value}" -lt 32 ]; then err "$2 in $3 is a placeholder or shorter than 32 characters"; return 1; fi
}

check_env() {
  infra="$root/infra/.env"
  server="$root/apps/server/.env"
  example="$root/infra/.env.example"
  for f in "$infra" "$server"; do
    [ -f "$f" ] || { err "${f#"$root"/} does not exist"; return 1; }
  done
  chmod 600 "$infra" "$server" 2>/dev/null || true
  bad=0

  for key in POSTGRES_PASSWORD PLATFORM_DB_PASSWORD MERLT_DB_PASSWORD MERLT_INTERNAL_SECRET; do
    value="$(env_get "$infra" "$key")"
    if [ -z "$value" ]; then
      err "$key is not set in infra/.env"; bad=1
    elif [ "$value" = "$(env_get "$example" "$key")" ] || is_development_value "$value"; then
      err "$key in infra/.env is still a development value"; bad=1
    fi
  done
  if [ "$(env_get "$infra" MERLT_ENABLED)" != false ] && [ -z "$(env_get "$infra" MERLT_API_KEY)" ]; then
    warn "MERLT_API_KEY is empty in infra/.env: MERL-T's admin routes will answer 401"
  fi

  jwt="$(env_get "$server" JWT_SECRET)"
  if [ -z "$jwt" ]; then
    err "JWT_SECRET is not set in apps/server/.env"; bad=1
  elif is_development_value "$jwt" || [ "${#jwt}" -lt 32 ]; then
    err "JWT_SECRET in apps/server/.env is a placeholder or shorter than 32 characters"; bad=1
  fi
  # The first admin is seeded with this password, on a server that phase 2 puts on the internet:
  # the example's placeholder, or anything guessable, must not get there.
  admin="$(env_get "$server" ADMIN_PASSWORD)"
  if [ -z "$admin" ]; then
    warn "ADMIN_PASSWORD is not set in apps/server/.env: no admin is seeded, so on a new database nobody can sign in as admin"
  elif is_development_value "$admin" || [ "${#admin}" -lt 12 ]; then
    err "ADMIN_PASSWORD in apps/server/.env is a placeholder or shorter than 12 characters"; bad=1
  fi

  # The MCP module, when it is on: its addresses are what clients compare tokens against.
  mcp_url="$(env_get "$infra" MCP_PUBLIC_URL)"
  if [ -n "$mcp_url" ]; then
    origin="$(env_get "$infra" PUBLIC_ORIGIN)"
    # A user@ part or an IPv6 literal would fool the host comparison below: not supported here.
    for value in "$origin" "$mcp_url"; do
      case "$value" in
        *@*|*\[*) err "PUBLIC_ORIGIN and MCP_PUBLIC_URL in infra/.env take a host name or an IPv4 address, with no user@ part"; bad=1 ;;
      esac
    done
    case "$origin" in
      ""|*,*|*://*/*) err "PUBLIC_ORIGIN in infra/.env must be one origin, scheme://host[:port] with no path or trailing slash, when MCP_PUBLIC_URL is set: it is the OAuth issuer"; bad=1 ;;
      *) secure_or_local "$origin" || { err "PUBLIC_ORIGIN in infra/.env must be https (or http on localhost) when MCP_PUBLIC_URL is set"; bad=1; } ;;
    esac
    secure_or_local "$mcp_url" || { err "MCP_PUBLIC_URL in infra/.env must be https (or http on localhost)"; bad=1; }
    [ "$(host_of "$mcp_url")" = "$(host_of "$origin")" ] || { err "MCP_PUBLIC_URL in infra/.env must be on the same host as PUBLIC_ORIGIN"; bad=1; }
    case "$mcp_url" in */mcp) ;; *) err "MCP_PUBLIC_URL in infra/.env must end in /mcp"; bad=1 ;; esac
    # Compose sets the issuer, the consent page and the resource from infra/.env; the API
    # audience it leaves to the server's default (the issuer + /api), which a value pinned in
    # apps/server/.env would override, and every token exchange would then be refused.
    audience="$(env_get "$server" OAUTH_API_AUDIENCE)"
    if [ -n "$audience" ] && [ "$audience" != "$origin/api" ]; then
      err "OAUTH_API_AUDIENCE in apps/server/.env must be PUBLIC_ORIGIN/api or absent: the MCP asks for that audience"; bad=1
    fi
    check_secret "$infra" MCP_CLIENT_SECRET infra/.env || bad=1
    if check_secret "$server" OAUTH_DELEGATION_SECRET apps/server/.env; then
      [ "$(env_get "$server" OAUTH_DELEGATION_SECRET)" != "$jwt" ] \
        || { err "OAUTH_DELEGATION_SECRET in apps/server/.env must differ from JWT_SECRET"; bad=1; }
    else
      bad=1
    fi
  fi
  if [ "$(env_get "$infra" MERLT_ENABLED)" != false ] && [ -z "$(env_get "$infra" OPENROUTER_API_KEY)" ]; then
    warn "OPENROUTER_API_KEY is empty in infra/.env: MERL-T's experts will not answer (the key is not generated: copy it in by hand)"
  fi
  return "$bad"
}

# A port the stack publishes must be free before minutes of building, unless this stack's
# own container holds it (the deploy replaces that container).
check_port() { # check_port <container> <bind> <port> <KEY>
  if [ -n "$(docker ps -q --filter "name=^$1\$" 2>/dev/null)" ]; then return 0; fi
  if ! command -v python3 >/dev/null 2>&1; then warn "python3 is missing: port $3 was not checked before the build"; return 0; fi
  # SO_REUSEADDR as Docker sets it: a connection still in TIME_WAIT after a stop is not a
  # program holding the port, while a listening socket still makes the bind fail.
  if ! python3 -c '
import socket, sys
host = sys.argv[1].strip("[]")
family = socket.getaddrinfo(host, None)[0][0]
s = socket.socket(family)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind((host, int(sys.argv[2])))' "$2" "$3" 2>/dev/null; then
    err "port $3 on $2 is taken by another program: set $4 in infra/.env to a free port"
    return 1
  fi
}

check_ports() {
  infra="$root/infra/.env"
  stack="$(env_get "$infra" VISUALEX_STACK)"; stack="${stack:-visualex}"
  bind="$(env_get "$infra" INGRESS_BIND)"; port="$(env_get "$infra" INGRESS_PORT)"
  bad=0
  check_port "$stack-ingress" "${bind:-127.0.0.1}" "${port:-8080}" INGRESS_PORT || bad=1
  if [ -n "$(env_get "$infra" MCP_PUBLIC_URL)" ]; then
    ingress_port="${port:-8080}"
    port="$(env_get "$infra" MCP_PORT)"
    if [ "${port:-8091}" = "$ingress_port" ]; then
      err "INGRESS_PORT and MCP_PORT in infra/.env are the same port ($ingress_port): give the MCP another one"; bad=1
    else
      check_port "$stack-mcp" 127.0.0.1 "${port:-8091}" MCP_PORT || bad=1
    fi
  fi
  return "$bad"
}

case "${1:-}" in
  host) shift; check_host "$@" ;;
  docker) check_docker ;;
  env)  check_env ;;
  ports) check_ports ;;
  *)    err "usage: preflight.sh host [--allow-branch] | docker | env | ports"; exit 2 ;;
esac
