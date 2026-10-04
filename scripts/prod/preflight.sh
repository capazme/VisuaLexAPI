#!/bin/sh
# What ./start.sh --prod checks before it changes anything.
#
#   preflight.sh host [--allow-branch]   the machine and the checkout
#   preflight.sh docker                  the machine alone (before a pull)
#   preflight.sh env                     the two env files
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
  return "$bad"
}

case "${1:-}" in
  host) shift; check_host "$@" ;;
  docker) check_docker ;;
  env)  check_env ;;
  *)    err "usage: preflight.sh host [--allow-branch] | docker | env"; exit 2 ;;
esac
