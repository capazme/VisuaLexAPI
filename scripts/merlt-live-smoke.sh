#!/usr/bin/env bash
#
# MERL-T live end-to-end smoke — exercises the REAL BFF (:3001) talking to the
# REAL MERL-T sidecar (:8000), not the nock-mocked unit suite. Proves the live
# integration of the lawyer's journey: consent -> profile/authority -> graph
# read (seeded Libro IV) -> entity search -> validation queue.
#
# Usage:
#   E2E_EMAIL=you@example.com E2E_PASSWORD=secret ./scripts/merlt-live-smoke.sh
#
# Defaults to the throwaway dev user. Requires the full stack up (./start.sh with
# MERLT_ENABLED=true) and the user to exist + be active.
#
set -uo pipefail

BFF="${BFF_URL:-http://localhost:3001}"
EMAIL="${E2E_EMAIL:-e2e-overnight@test.local}"
PASSWORD="${E2E_PASSWORD:-OvernightE2E2026}"
# Full Normattiva URL form (the canonical key the seed + VisuaLex use).
ART_URN="${E2E_ART_URN:-https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043}"

pass=0; fail=0
ok() { echo "  ✅ $1"; pass=$((pass+1)); }
ko() { echo "  ❌ $1"; fail=$((fail+1)); }
enc() { python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$1"; }
# Safe JSON readers (no eval): each parses stdin with json and returns one value.
field()   { python3 -c "import sys,json;print(json.load(sys.stdin).get(sys.argv[1],''))" "$1"; }
node_len(){ python3 -c "import sys,json;print(len(json.load(sys.stdin).get('nodes',[])))"; }
list_len(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(len(d) if isinstance(d,list) else len(d.get('results',d.get('entities',[]))))"; }

echo "== MERL-T live smoke =="
echo "BFF=$BFF  user=$EMAIL"

# 1. health (no auth)
H=$(curl -s -m 8 "$BFF/api/merlt/health")
if [ "$(printf '%s' "$H" | field merlt)" = "reachable" ]; then ok "health: merlt reachable"; else ko "health: $H"; fi

# 2. login
TOKEN=$(curl -s -m 15 -X POST "$BFF/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | field access_token)
if [ -n "$TOKEN" ]; then ok "login (token ${#TOKEN} chars)"; else ko "login failed"; echo "ABORT"; exit 1; fi
AUTH=(-H "Authorization: Bearer $TOKEN")

# 3. consent -> full
C=$(curl -s -m 10 -X POST "$BFF/api/merlt/consent" "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"level":"full","reason":"e2e smoke"}')
if [ "$(printf '%s' "$C" | field level)" = "full" ]; then ok "consent set to full"; else ko "consent: $C"; fi
if [ "$(curl -s -m 10 "$BFF/api/merlt/consent" "${AUTH[@]}" | field level)" = "full" ]; then ok "consent persisted (GET=full)"; else ko "consent GET mismatch"; fi

# 4. profile / authority
P=$(curl -s -m 12 -o /dev/null -w "%{http_code}" "$BFF/api/merlt/profile" "${AUTH[@]}")
if [ "$P" = "200" ]; then ok "profile 200"; else ko "profile HTTP $P"; fi

# 5. graph read of a SEEDED article (the URN-normalization fix)
N=$(curl -s -m 20 "$BFF/api/merlt/graph/article/$(enc "$ART_URN")?depth=1&limit=25" "${AUTH[@]}" | node_len)
if [ "${N:-0}" -gt 0 ] 2>/dev/null; then ok "graph read art2043: $N nodes (seed reachable)"; else ko "graph read art2043: ${N:-0} nodes"; fi

# 5b. same with !vig= marker (must normalize to the same node set)
NV=$(curl -s -m 20 "$BFF/api/merlt/graph/article/$(enc "${ART_URN}!vig=")?depth=1&limit=25" "${AUTH[@]}" | node_len)
if [ "${NV:-0}" -gt 0 ] 2>/dev/null; then ok "graph read art2043!vig=: $NV nodes (marker stripped)"; else ko "graph read !vig=: ${NV:-0} nodes"; fi

# 6. entity search (q=contratto — a term present in the dev seed concepts)
SH=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "$BFF/api/merlt/graph/search?q=contratto&limit=5" "${AUTH[@]}")
SC=$(curl -s -m 15 "$BFF/api/merlt/graph/search?q=contratto&limit=5" "${AUTH[@]}" | list_len)
if [ "$SH" = "200" ]; then ok "entity search 200 (${SC:-0} hits)"; else ko "entity search HTTP $SH"; fi

# 7. validation queue (full-consent gated)
VH=$(curl -s -m 12 -o /dev/null -w "%{http_code}" "$BFF/api/merlt/validate/pending" "${AUTH[@]}")
if [ "$VH" = "200" ]; then ok "validate/pending 200"; else ko "validate/pending HTTP $VH"; fi

echo ""
echo "== result: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
