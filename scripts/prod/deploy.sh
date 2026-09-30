#!/bin/sh
# ./start.sh --prod: deploy what is checked out, on the production host.
#
#   deploy.sh [--allow-branch] [--no-backup]     build, migrate and start the stack
#   deploy.sh --stop                             stop it (containers and volumes stay)
#
# It does NOT run `git pull`: it deploys the commit that is checked out, and says which.
# Design: docs/superpowers/specs/2026-09-29-modular-deployment-design.md, section 6.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$root/scripts/prod/lib.sh"

usage() {
  cat <<'EOF'
Usage: deploy.sh [--allow-branch] [--no-backup]    build, migrate and start the stack
       deploy.sh --stop                            stop it (containers and volumes stay)
EOF
}

allow=""; backup=1; stop=0
for arg in "$@"; do
  case "$arg" in
    --allow-branch) allow=--allow-branch ;;
    --no-backup)    backup=0 ;;
    --stop)         stop=1 ;;
    -h|--help)      usage; exit 0 ;;
    *) err "unknown option: $arg"; usage >&2; exit 2 ;;
  esac
done
cd "$root"

# The Compose files of the production stack, in order; compose.prod.yml always last.
# compose.scrapers.yml stays out when the scrapers live on another machine (SCRAPERS_ADDR
# names a host other than `scrapers`); MERL-T is in unless MERLT_ENABLED is false.
compose_files() {
  FILES="-f infra/compose.yml -f infra/compose.app.yml"
  REMOTE_SCRAPERS=""
  scrapers_addr="$(env_get infra/.env SCRAPERS_ADDR)"
  case "${scrapers_addr:-scrapers:5000}" in
    scrapers|scrapers:*) FILES="$FILES -f infra/compose.scrapers.yml" ;;
    *)                   REMOTE_SCRAPERS="$scrapers_addr" ;;
  esac
  FILES="$FILES -f infra/compose.prod.yml"
  if [ "$(env_get infra/.env MERLT_ENABLED)" != false ]; then FILES="$FILES --profile merlt"; fi
}
# FILES is unquoted on purpose: paths relative to the checkout, no spaces.
dc() { docker compose $FILES "$@"; }

if [ "$stop" = 1 ]; then
  if [ ! -f infra/.env ]; then
    say "nothing to stop: infra/.env does not exist, so no production stack was started from this checkout"
    exit 0
  fi
  compose_files
  dc stop
  say "stopped; the containers and the volumes stay. ./start.sh --prod starts them again."
  exit 0
fi

# 1. The machine and the checkout.
# shellcheck disable=SC2086
deploying="$(sh scripts/prod/preflight.sh host $allow)" || exit 1
say "$deploying"

# 2. First run: the env files, with generated secrets; then they must be fit for production.
sh scripts/prod/init-env.sh
sh scripts/prod/preflight.sh env || exit 1
compose_files
if [ -n "$REMOTE_SCRAPERS" ]; then
  say "the scrapers run elsewhere ($REMOTE_SCRAPERS): compose.scrapers.yml is left out"
fi

if [ "$(env_get infra/.env MERLT_ENABLED)" != false ] && [ ! -f vendor/mcp-legal-it/Dockerfile ]; then
  say "initialising the vendor/mcp-legal-it submodule..."
  git submodule update --init --recursive vendor/mcp-legal-it
fi

# 3. A backup first. Migrations do not walk backwards, so this is the way back for the data.
# Whether a stack exists is read from Docker's own list of volumes; when Docker cannot answer,
# the deploy stops: "no stack" is never the reading of an error.
stack="$(env_get infra/.env VISUALEX_STACK)"
stack="${stack:-visualex}"
if ! volumes="$(docker volume ls -q 2>&1)"; then
  err "cannot list the Docker volumes, so cannot tell whether a stack exists to back up: $volumes"
  exit 1
fi
if printf '%s\n' "$volumes" | grep -Fqx "${stack}_postgres_data"; then
  if [ "$backup" = 1 ]; then
    command -v python3 >/dev/null 2>&1 \
      || { err "python3 is needed by the backup tool (scripts/backup.sh): install it, or deploy without a backup with --no-backup"; exit 1; }
    say "an existing stack: backing it up first..."
    # Only what is not running is started, and what runs is left as it is: the backup must see the
    # stack as it has been running, not one that this release's configuration has already changed.
    if ! dc up -d --wait --no-recreate postgres redis falkordb qdrant; then
      err "the data stores did not come up healthy, so no backup could be taken and nothing was built or migrated; look at them (docker compose $FILES ps), or deploy without a backup with --no-backup"
      exit 1
    fi
    if ! sh scripts/backup.sh; then
      err "the backup failed, so nothing was built or migrated (the stores that were down are running now). Fix it, or deploy without one with --no-backup"
      exit 1
    fi
  else
    warn "an existing stack, and no backup (--no-backup)"
  fi
else
  say "a first deploy: nothing to back up yet"
  # A stack named differently from the one whose data lives here would read as a first deploy too:
  # if the host has other Postgres volumes, say so while there is still time to stop.
  others="$(printf '%s\n' "$volumes" | grep '_postgres_data$' | tr '\n' ' ' || true)"
  if [ -n "$others" ]; then
    warn "no ${stack}_postgres_data, but this host has other Postgres volumes (${others% }): if one of them is this stack's data, VISUALEX_STACK in infra/.env is wrong. Stop now (Ctrl+C) and check"
  fi
fi

# 4. Build, migrate, start, and wait until every module is healthy.
say "building and starting; the first build takes several minutes (MERL-T is large)..."
if ! dc up -d --build --wait; then
  err "the stack did not come up healthy; what runs now:"
  dc ps || true
  err "the logs of a module: docker compose $FILES logs <module>"
  exit 1
fi

# 5. The first admin. The seed is idempotent: with the admin already there it changes nothing.
if [ -n "$(env_get apps/server/.env ADMIN_PASSWORD)" ]; then
  dc exec -T server node dist/utils/seed.js >/dev/null 2>&1 \
    || warn "the admin seed did not run; try: docker compose $FILES exec server node dist/utils/seed.js"
fi

bind="$(env_get infra/.env INGRESS_BIND)"; bind="${bind:-127.0.0.1}"
port="$(env_get infra/.env INGRESS_PORT)"; port="${port:-8080}"
say ""
say "$deploying: the stack is up and healthy"
dc ps --format 'table {{.Service}}\t{{.Status}}' || true
say ""
say "  address   http://$bind:$port"
if [ "$bind" = 127.0.0.1 ]; then
  say "            (this machine only: to reach it from another device set INGRESS_BIND and PUBLIC_ORIGIN in infra/.env, then run this again)"
fi
if [ -n "$REMOTE_SCRAPERS" ]; then say "  scrapers  expected at $REMOTE_SCRAPERS (compose.scrapers.yml is not started here)"; fi
say "  logs      docker compose $FILES logs -f"
say "  stop      ./start.sh --prod --stop"
say "  secrets   infra/.env and apps/server/.env (mode 600). The first admin's password is ADMIN_PASSWORD in the latter: sign in, change it, delete that line and run ./start.sh --prod again, so the server stops holding it"
