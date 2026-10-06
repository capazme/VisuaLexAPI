#!/bin/sh
# First run of ./start.sh --prod: create the two env files that do not exist yet, with
# GENERATED secrets. Never overwrites a file; never prints a value, only where they are.
set -eu
root="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$root/scripts/prod/lib.sh"
umask 077

infra="$root/infra/.env"
if [ ! -f "$infra" ]; then
  cp "$root/infra/.env.example" "$infra"
  # The three database passwords, and the two secrets the server and MERL-T share.
  for key in POSTGRES_PASSWORD PLATFORM_DB_PASSWORD MERLT_DB_PASSWORD MERLT_INTERNAL_SECRET MERLT_API_KEY; do
    env_set "$infra" "$key" "$(random_secret 40)"
  done
  env_set "$infra" MERLT_ENABLED true
  chmod 600 "$infra"
  say "created infra/.env: the database passwords and the MERL-T secrets are generated (not shown here)"
fi

server="$root/apps/server/.env"
if [ ! -f "$server" ]; then
  cp "$root/apps/server/.env.example" "$server"
  env_set "$server" JWT_SECRET "$(random_secret 64)" '"'
  # The first admin. The seed reads it; sign in once, change it, and delete the line.
  env_set "$server" ADMIN_PASSWORD "$(random_secret 24)" '"'
  chmod 600 "$server"
  say "created apps/server/.env: the JWT secret and the first admin's password (ADMIN_PASSWORD in that file) are generated"
fi

# Keys added since a host first ran this: completed in files that already exist, never
# overwritten. The MCP's credential is shared by the server and the mcp module, so it lives
# in infra/.env (like MERLT_INTERNAL_SECRET); the delegation key is the server's alone.
add_missing() { # add_missing <file> <KEY> [quote]
  if [ -z "$(env_get "$1" "$2")" ]; then
    env_set "$1" "$2" "$(random_secret 48)" "${3:-}"
    chmod 600 "$1"
    say "added $2 to ${1#"$root"/} (generated, not shown here)"
  fi
}
add_missing "$infra" MCP_CLIENT_SECRET
add_missing "$server" OAUTH_DELEGATION_SECRET '"'
