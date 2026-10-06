#!/bin/sh
# Invariants of infra/compose*.yml, checked on the rendered configuration.
# Needs docker (the compose plugin) and python3; starts nothing.
set -eu
root="$(cd "$(dirname "$0")/../../.." && pwd)"
infra="$root/infra"
here="$root/scripts/prod/tests"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fail=0

# Hermetic: nothing the developer has exported may change what is rendered.
for v in INGRESS_BIND INGRESS_PORT PUBLIC_ORIGIN APP_SUBNET EDGE_SUBNET MCP_PUBLIC_URL MCP_CLIENT_SECRET MCP_PORT SCRAPERS_ADDR SCRAPERS_MEM_LIMIT \
         MERLT_ENABLED POSTGRES_PASSWORD PLATFORM_DB_PASSWORD MERLT_DB_PASSWORD \
         VITE_FEATURE_MERLT VITE_FEATURE_MERLT_GRAPH VISUALEX_STACK ENV_FILE; do
  unset "$v"
done

# The production files refuse to render without these: throwaway values.
export MERLT_INTERNAL_SECRET=test-internal-secret MERLT_API_KEY=test-api-key

# render <out.json> <profiles: "" | "merlt" | "merlt mcp"> <compose file>...
render() {
  out="$1"; profiles="$2"; shift 2
  files=""
  for f in "$@"; do files="$files -f $infra/$f"; done
  flag=""
  for p in $profiles; do flag="$flag --profile $p"; done
  # shellcheck disable=SC2086
  docker compose --env-file "${ENV_FILE:-$infra/.env.example}" $files $flag config --format json >"$out" 2>"$tmp/stderr"
}

# scenario <name> <profiles> <compose file>...   returns non-zero on any failure.
# Run each one in a subshell: an assignment in front of a function call outlives the
# call in some shells (dash), and would leak into the scenarios after it.
scenario() {
  name="$1"; profiles="$2"; shift 2
  if render "$tmp/$name.json" "$profiles" "$@"; then
    python3 "$here/compose_invariants.py" "$name" "$tmp/$name.json"
  else
    echo "FAIL $name: the files do not render"; sed 's/^/     /' "$tmp/stderr" | head -5; return 1
  fi
}

all="compose.yml compose.app.yml compose.scrapers.yml compose.prod.yml"
(scenario dev "" compose.yml) || fail=1
(scenario dev-merlt merlt compose.yml) || fail=1
(INGRESS_BIND=192.0.2.10; export INGRESS_BIND; scenario prod-lan merlt $all) || fail=1
(scenario prod-default merlt $all) || fail=1
(VITE_FEATURE_MERLT=false; export VITE_FEATURE_MERLT; scenario prod-flags merlt $all) || fail=1
(MERLT_ENABLED=false; export MERLT_ENABLED; scenario prod-merlt-off "" $all) || fail=1
(SCRAPERS_ADDR=192.0.2.20:5000; export SCRAPERS_ADDR; scenario no-scrapers merlt compose.yml compose.app.yml compose.prod.yml) || fail=1
(scenario scrapers-alone "" compose.scrapers.yml) || fail=1
(MCP_PUBLIC_URL=https://vlx.example:8443/mcp PUBLIC_ORIGIN=https://vlx.example MCP_CLIENT_SECRET=test-mcp-secret-0123456789abcdef
 export MCP_PUBLIC_URL PUBLIC_ORIGIN MCP_CLIENT_SECRET; scenario prod-mcp "merlt mcp" $all) || fail=1

# Fail closed: without the shared secret the production files must not render.
if (unset MERLT_INTERNAL_SECRET; render "$tmp/nosecret.json" merlt $all); then
  echo "FAIL a missing MERLT_INTERNAL_SECRET is accepted"; fail=1
elif grep -q MERLT_INTERNAL_SECRET "$tmp/stderr"; then
  echo "ok   a missing MERLT_INTERNAL_SECRET is refused, by name, not defaulted"
else
  echo "FAIL the refusal is not about MERLT_INTERNAL_SECRET:"; sed 's/^/     /' "$tmp/stderr" | head -3; fail=1
fi

# Fail closed on the database passwords too: an env file without them must not render.
grep -v -E '^(POSTGRES_PASSWORD|PLATFORM_DB_PASSWORD|MERLT_DB_PASSWORD)=' "$infra/.env.example" >"$tmp/env-nopasswords"
if (ENV_FILE="$tmp/env-nopasswords"; export ENV_FILE; render "$tmp/nopw.json" merlt $all); then
  echo "FAIL missing database passwords are accepted"; fail=1
elif grep -q -E 'POSTGRES_PASSWORD|PLATFORM_DB_PASSWORD|MERLT_DB_PASSWORD' "$tmp/stderr"; then
  echo "ok   missing database passwords are refused, by name, not defaulted"
else
  echo "FAIL the refusal is not about the passwords:"; sed 's/^/     /' "$tmp/stderr" | head -3; fail=1
fi

exit "$fail"
