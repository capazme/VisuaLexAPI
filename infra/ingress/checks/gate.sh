#!/bin/sh
# The login gate at the ingress, proved against stand-in upstreams: the real Caddyfile, run by
# the caddy image, in front of infra/ingress/checks/stub_upstream.py. Needs Docker and python3.
#
#   sh infra/ingress/checks/gate.sh
#
# Ports: the ingress on 18081, the stand-in server on 13001, the stand-in scrapers on 15000.
# A second ingress on 18082 trusts no forwarded address from the caller (section 7b).
set -u
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
B=http://127.0.0.1:18081
name="vlx-gate-check-$$"
name2="$name-untrusted"
pids=""
fail=0
ok()  { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
cleanup() {
  docker rm -f "$name" "$name2" >/dev/null 2>&1
  for p in $pids; do kill "$p" 2>/dev/null; done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

python3 "$here/stub_upstream.py" server 13001 & server_pid=$!; pids="$server_pid"
python3 "$here/stub_upstream.py" scrapers 15000 & scrapers_pid=$!; pids="$pids $scrapers_pid"
# The first ingress trusts a forwarded address from anyone (stands for a hop from the stack's
# own subnets); the second from nobody it can meet here (TEST-NET subnets).
docker run -d --name "$name" -p 127.0.0.1:18081:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e SERVER_UPSTREAM=host.docker.internal:13001 -e SCRAPERS_UPSTREAM=host.docker.internal:15000 \
  -e APP_SUBNET=0.0.0.0/0 -e EDGE_SUBNET=0.0.0.0/0 \
  -v "$root/infra/ingress/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null || { echo "cannot start caddy"; exit 1; }
docker run -d --name "$name2" -p 127.0.0.1:18082:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e SERVER_UPSTREAM=host.docker.internal:13001 -e SCRAPERS_UPSTREAM=host.docker.internal:15000 \
  -e APP_SUBNET=192.0.2.0/24 -e EDGE_SUBNET=198.51.100.0/24 \
  -v "$root/infra/ingress/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null || { echo "cannot start the second caddy"; exit 1; }
B2=http://127.0.0.1:18082

# wait until both stand-ins answer, then the ingress (any status)
for port in 13001 15000; do
  i=0; until curl -s -m 1 -o /dev/null "http://127.0.0.1:$port/__seen"; do i=$((i + 1)); [ "$i" -gt 20 ] && { echo "the stand-in on port $port did not start"; exit 1; }; sleep 1; done
done
for pair in "$B $name" "$B2 $name2"; do
  url="${pair% *}"; container="${pair#* }"
  i=0; until curl -s -o /dev/null -m 2 "$url/version"; do i=$((i + 1)); [ "$i" -gt 30 ] && { echo "the ingress at $url did not start"; docker logs "$container" 2>&1 | tail -20; exit 1; }; sleep 1; done
done

code()   { curl -s -o /dev/null -m 10 -w '%{http_code}' "$@"; }
seen()   { curl -s -m 5 "http://127.0.0.1:$1/__seen" | python3 -c "import json,sys; d=json.load(sys.stdin); print($2)"; }
scraper_calls() { seen 15000 'd["calls"]'; }
verify_calls()  { seen 13001 'd["calls"]'; }
expect() { if [ -n "$2" ] && [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted '$2', got '$3')"; fi; }

# 1. no token: refused at the door, and the scrapers never hear of it
before="$(scraper_calls)"
expect "a scraping call without a token is refused" 401 "$(code -X POST -d '{}' "$B/fetch_article_text")"
expect "and the scrapers were not called" "$before" "$(scraper_calls)"

# 2. a good token: let through, with the question the server needs, and no token for the scrapers
body="$(curl -s -m 10 -X POST -H 'Authorization: Bearer good-token' -d '{"probe":1}' "$B/fetch_article_text?x=1")"
expect "a signed-in call reaches the scrapers" "scrapers POST /fetch_article_text?x=1" "$body"
expect "the server was asked what the call was" "/fetch_article_text?x=1 POST" "$(seen 13001 'd["last"]["uri"] + " " + d["last"]["method"]')"
expect "and the scrapers never saw the login token" "None" "$(seen 15000 'd["last"]["authorization"]')"
expect "and the request body reached the scrapers untouched" '{"probe":1}' "$(seen 15000 'd["last"]["body"]')"

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

# 7. odd spellings of a gated path are gated too: Caddy matches the decoded, cleaned path,
#    so none of these may reach the scrapers without a login; only the exact /version and
#    /health are open
before="$(scraper_calls)"
for spelling in /fetch_article%5Ftext //fetch_article_text /x/../fetch_article_text /FETCH_ARTICLE_TEXT /health%2Fdetailed /health/ /version/x; do
  expect "$spelling without a token is refused" 401 "$(code --path-as-is -X POST -d '{}' "$B$spelling")"
done
expect "and none of them reached the scrapers" "$before" "$(scraper_calls)"

# 7b. the client's address: kept from a trusted hop, overwritten from anyone else
curl -s -o /dev/null -m 10 -H 'X-Forwarded-For: 100.64.1.2' "$B/api/probe"
xff="$(seen 13001 'd["last"]["xff"]')"
case "$xff" in "100.64.1.2, "*) ok "from a trusted hop the forwarded address is kept, and the hop appended ($xff)" ;;
  *) bad "from a trusted hop the forwarded address is kept (got '$xff')" ;; esac
curl -s -o /dev/null -m 10 -H 'X-Forwarded-For: 100.64.1.2' "$B2/api/probe"
xff="$(seen 13001 'd["last"]["xff"]')"
case "$xff" in *100.64.1.2*) bad "from an untrusted peer the forwarded address is overwritten (got '$xff')" ;;
  ""|None) bad "from an untrusted peer the ingress still sends an address (got none)" ;;
  *) ok "from an untrusted peer the forwarded address is overwritten ($xff)" ;; esac

# 8. the server does not answer: the gate stays shut (last: once it is killed everything fails closed)
kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null; sleep 1
status="$(code -H 'Authorization: Bearer good-token' -X POST -d '{}' "$B/fetch_article_text")"
case "$status" in 502|503|504) ok "with no server behind it the gate is closed ($status)" ;; *) bad "with no server behind it the gate is closed (got $status)" ;; esac

# 9. the server hangs instead of dying: the login check is timed out, the gate stays shut, in time
python3 "$here/stub_upstream.py" hang 13001 & hang_pid=$!; pids="$pids $hang_pid"
sleep 1
started="$(date +%s)"
status="$(curl -s -o /dev/null -m 25 -w '%{http_code}' -H 'Authorization: Bearer good-token' -X POST -d '{}' "$B/fetch_article_text")"
took=$(( $(date +%s) - started ))
if [ "$status" = 504 ] && [ "$took" -ge 9 ] && [ "$took" -le 15 ]; then
  ok "with a server that hangs the login check times out and the gate stays shut (504 after ${took}s)"
else
  bad "with a server that hangs the login check times out and the gate stays shut (got $status after ${took}s)"
fi

exit "$fail"
