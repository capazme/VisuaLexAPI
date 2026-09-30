#!/bin/sh
# The login gate at the ingress, proved against stand-in upstreams: the real Caddyfile, run by
# the caddy image, in front of infra/ingress/checks/stub_upstream.py. Needs Docker and python3.
#
#   sh infra/ingress/checks/gate.sh
#
# Ports: the ingress on 18081, the stand-in server on 13001, the stand-in scrapers on 15000.
set -u
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
B=http://127.0.0.1:18081
name="vlx-gate-check-$$"
pids=""
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1
  for p in $pids; do kill "$p" 2>/dev/null; done
}
trap cleanup EXIT INT TERM

python3 "$here/stub_upstream.py" server 13001 & server_pid=$!; pids="$server_pid"
python3 "$here/stub_upstream.py" scrapers 15000 & scrapers_pid=$!; pids="$pids $scrapers_pid"
docker run -d --rm --name "$name" -p 127.0.0.1:18081:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e SERVER_UPSTREAM=host.docker.internal:13001 -e SCRAPERS_UPSTREAM=host.docker.internal:15000 \
  -v "$root/infra/ingress/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null || { echo "cannot start caddy"; exit 1; }

# wait until the ingress answers (any status)
i=0; until curl -s -o /dev/null -m 2 "$B/version"; do i=$((i + 1)); [ "$i" -gt 30 ] && { echo "the ingress did not start"; exit 1; }; sleep 1; done

code()   { curl -s -o /dev/null -m 10 -w '%{http_code}' "$@"; }
seen()   { curl -s -m 5 "http://127.0.0.1:$1/__seen" | python3 -c "import json,sys; d=json.load(sys.stdin); print($2)"; }
scraper_calls() { seen 15000 'd["calls"]'; }
verify_calls()  { seen 13001 'd["calls"]'; }
expect() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted '$2', got '$3')"; fi; }

# 1. no token: refused at the door, and the scrapers never hear of it
before="$(scraper_calls)"
expect "a scraping call without a token is refused" 401 "$(code -X POST -d '{}' "$B/fetch_article_text")"
expect "and the scrapers were not called" "$before" "$(scraper_calls)"

# 2. a good token: let through, with the question the server needs, and no token for the scrapers
body="$(curl -s -m 10 -X POST -H 'Authorization: Bearer good-token' -d '{}' "$B/fetch_article_text?x=1")"
expect "a signed-in call reaches the scrapers" "scrapers POST /fetch_article_text?x=1" "$body"
expect "the server was asked what the call was" "/fetch_article_text?x=1 POST" "$(seen 13001 'd["last"]["uri"] + " " + d["last"]["method"]')"
expect "and the scrapers never saw the login token" "None" "$(seen 15000 'd["last"]["authorization"]')"

# 3. over the quota: the server's 429 reaches the caller with its Retry-After, the scrapers are spared
before="$(scraper_calls)"
expect "over the quota the caller gets 429" 429 "$(code -H 'Authorization: Bearer slow-down' "$B/fetch_tree")"
expect "with the server's Retry-After" "7" "$(curl -s -m 10 -D - -o /dev/null -H 'Authorization: Bearer slow-down' "$B/fetch_tree" | tr -d '\r' | sed -n 's/^[Rr]etry-[Aa]fter: //p')"
expect "and the scrapers were not called" "$before" "$(scraper_calls)"

# 4. /version and /health stay open and do not ask the server
before="$(verify_calls)"
expect "/version is open" 200 "$(code "$B/version")"
expect "/health is open" 200 "$(code "$B/health")"
expect "and the server was not asked" "$before" "$(verify_calls)"

# 5. /health/detailed reaches the sources: not open
expect "/health/detailed needs a login" 401 "$(code "$B/health/detailed")"
expect "/health/detailed answers a signed-in caller" 200 "$(code -H 'Authorization: Bearer good-token' "$B/health/detailed")"

# 6. the stream still comes line by line through the gate
timing="$(curl -s -m 20 -o /dev/null -H 'Authorization: Bearer good-token' -w '%{time_starttransfer} %{time_total}' -X POST -d '{}' "$B/stream_article_text")"
first="${timing% *}"; total="${timing#* }"
if python3 -c "import sys; sys.exit(0 if float('$first') < 1.0 and float('$total') >= 2.0 else 1)"; then
  ok "the stream flushes line by line (first byte at ${first}s, done at ${total}s)"
else
  bad "the stream flushes line by line (first byte at ${first}s, done at ${total}s)"
fi

# 7. the server does not answer: the gate stays shut
kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null; sleep 1
status="$(code -H 'Authorization: Bearer good-token' -X POST -d '{}' "$B/fetch_article_text")"
case "$status" in 502|503|504) ok "with no server behind it the gate is closed ($status)" ;; *) bad "with no server behind it the gate is closed (got $status)" ;; esac

exit "$fail"
