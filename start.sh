#!/bin/bash
# VisuaLex development stack — one command.
#   Docker (infra/compose.yml): postgres, redis, falkordb, qdrant — always;
#     mcp-legal-it, merlt-api, merlt-worker too with MERLT_ENABLED=true.
#   Host, with hot reload: Python API (services/visualex, :5000), server
#     (apps/server, :3001), web (apps/web, :5173).
#   MERLT_API_IN_DOCKER=false runs the MERL-T api and worker on the host
#     (developer mode: a venv with the merlt deps, no mcp-legal-it tools).
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
# Same values as Compose reads: ports, stack name, passwords.
if [ -f "$PROJECT_ROOT/infra/.env" ]; then set -a; . "$PROJECT_ROOT/infra/.env"; set +a; fi
COMPOSE=(docker compose -f "$PROJECT_ROOT/infra/compose.yml")
MERLT_ENABLED="${MERLT_ENABLED:-false}"
MERLT_API_IN_DOCKER="${MERLT_API_IN_DOCKER:-true}"
MERLT_ROOT="$PROJECT_ROOT/services/merlt"
MERLT_PORT="${MERLT_API_PORT:-8000}"
MERLT_HEALTH_TIMEOUT="${MERLT_HEALTH_TIMEOUT:-60}"
SERVER_ENV="$PROJECT_ROOT/apps/server/.env"
VENV="$PROJECT_ROOT/services/visualex/.venv"
if [ -z "${MERLT_PYTHON:-}" ] && [ -x "$MERLT_ROOT/.venv/bin/python" ]; then MERLT_PYTHON="$MERLT_ROOT/.venv/bin/python"; fi
MERLT_PYTHON="${MERLT_PYTHON:-python}"

# KEY from apps/server/.env, for the secrets MERL-T and the server share.
server_env() {
    [ -f "$SERVER_ENV" ] || return 0
    sed -n "s/^$1=[\"']\{0,1\}\([^\"']*\).*/\1/p" "$SERVER_ENV" | tail -1
}

echo -e "${BLUE}VisuaLex development stack${NC}"

# A process and its descendants: Quart's reloader serves from a child process
# that outlives its parent's SIGTERM and keeps :5000 bound.
kill_tree() {
    local pid="$1" child
    [ -n "$pid" ] || return 0
    for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
    kill "$pid" 2>/dev/null || true
}

CLEANED_UP=""
cleanup() {
    [ -n "$CLEANED_UP" ] && return
    CLEANED_UP=1
    echo -e "\n${YELLOW}Shutting down...${NC}"
    for pid in ${API_PID:-} ${SERVER_PID:-} ${WEB_PID:-} ${MERLT_PID:-} ${MERLT_WORKER_PID:-}; do kill_tree "$pid"; done
    # stop, not down: containers and volumes stay for the next start.
    "${COMPOSE[@]}" --profile merlt stop >/dev/null 2>&1 || true
    echo -e "${GREEN}Stopped.${NC}"
}
trap 'cleanup; exit 0' SIGINT SIGTERM
trap cleanup EXIT

check_port() {
    if lsof -Pi :"$1" -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}Port $1 in use${NC} - run: ${YELLOW}kill \$(lsof -t -i:$1)${NC}"
        return 1
    fi
}
for p in 5000 3001 5173; do check_port "$p" || exit 1; done

if [ ! -x "$VENV/bin/python" ]; then
    echo -e "${RED}No venv at services/visualex/.venv${NC} - see docs/setup.md"; exit 1
fi
if ! "$VENV/bin/python" -c "import redis, playwright" 2>/dev/null; then
    echo -e "${RED}Python dependencies missing${NC} - run: ${YELLOW}services/visualex/.venv/bin/pip install -r services/visualex/requirements-dev.txt${NC}"; exit 1
fi
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-}"
if [ -z "$PW_CACHE" ]; then
    case "$OSTYPE" in
        darwin*) PW_CACHE="$HOME/Library/Caches/ms-playwright" ;;
        linux*)  PW_CACHE="$HOME/.cache/ms-playwright" ;;
    esac
fi
if [ -n "$PW_CACHE" ] && ! ls "$PW_CACHE" 2>/dev/null | grep -q chromium; then
    echo -e "${RED}Playwright Chromium missing${NC} - run: ${YELLOW}services/visualex/.venv/bin/playwright install chromium${NC}"; exit 1
fi

if [ "$MERLT_ENABLED" = "true" ]; then
    check_port "$MERLT_PORT" || exit 1
    if [ "$MERLT_API_IN_DOCKER" = "true" ] && [ ! -f "$PROJECT_ROOT/vendor/mcp-legal-it/Dockerfile" ]; then
        echo -e "${YELLOW}Initialising the vendor/mcp-legal-it submodule...${NC}"
        git -C "$PROJECT_ROOT" submodule update --init --recursive vendor/mcp-legal-it
    fi
    MERLT_INTERNAL_SECRET="${MERLT_INTERNAL_SECRET:-$(server_env MERLT_INTERNAL_SECRET)}"
    MERLT_API_KEY="${MERLT_API_KEY:-$(server_env MERLT_API_KEY)}"
    if [ -n "$MERLT_INTERNAL_SECRET" ]; then export MERLT_INTERNAL_SECRET; else
        echo -e "${YELLOW}MERLT_INTERNAL_SECRET empty: MERL-T callbacks to the server will be refused${NC}"; fi
    if [ -n "$MERLT_API_KEY" ]; then export MERLT_API_KEY MERLT_ADMIN_API_KEY="$MERLT_API_KEY"; else
        echo -e "${YELLOW}MERLT_API_KEY empty: MERL-T admin routes will answer 401${NC}"; fi
    if [ "$MERLT_API_IN_DOCKER" != "true" ] && ! "$MERLT_PYTHON" -c 'import merlt.app' >/dev/null 2>&1; then
        echo -e "${RED}MERLT_PYTHON ($MERLT_PYTHON) cannot import merlt.app${NC}"; exit 1
    fi
fi

echo -e "\n${YELLOW}[1/4] Data stores...${NC}"
"${COMPOSE[@]}" up -d --wait postgres redis falkordb qdrant

echo -e "\n${YELLOW}[2/4] Python API (:5000)...${NC}"
( cd "$PROJECT_ROOT/services/visualex" && exec "$VENV/bin/python" app.py ) &
API_PID=$!

echo -e "\n${YELLOW}[3/4] Server (:3001)...${NC}"
cd "$PROJECT_ROOT/apps/server"
npx prisma generate > /dev/null 2>&1 || echo -e "${YELLOW}prisma generate failed${NC}"
npx prisma migrate deploy || echo -e "${YELLOW}prisma migrate deploy failed - does DATABASE_URL in apps/server/.env point at port ${VISUALEX_PG_PORT:-5436}?${NC}"
if [ -n "${ADMIN_PASSWORD:-}" ]; then npm run db:seed || echo -e "${YELLOW}db:seed failed${NC}"; fi
npm run dev &
SERVER_PID=$!

echo -e "\n${YELLOW}[4/4] Web (:5173)...${NC}"
cd "$PROJECT_ROOT/apps/web"
npm run dev &
WEB_PID=$!
cd "$PROJECT_ROOT"

if [ "$MERLT_ENABLED" = "true" ]; then
    if [ "$MERLT_API_IN_DOCKER" = "true" ]; then
        echo -e "\n${YELLOW}MERL-T in Docker...${NC}"
        "${COMPOSE[@]}" --profile merlt up -d
    else
        echo -e "\n${YELLOW}MERL-T on the host (:$MERLT_PORT)...${NC}"
        DB="postgresql://merlt:${MERLT_DB_PASSWORD:-merlt}@localhost:${VISUALEX_PG_PORT:-5436}/merlt"
        REDIS="redis://localhost:${VISUALEX_REDIS_PORT:-6381}"
        # Exported only now: the server already runs with its own DATABASE_URL.
        export DATABASE_URL="$DB" RLCF_DATABASE_URL="$DB" \
            ENRICHMENT_DATABASE_URL="${DB/postgresql:/postgresql+asyncpg:}" RLCF_ASYNC_DATABASE_URL="${DB/postgresql:/postgresql+asyncpg:}" \
            ENRICHMENT_DB_HOST=localhost ENRICHMENT_DB_PORT="${VISUALEX_PG_PORT:-5436}" ENRICHMENT_DB_NAME=merlt \
            ENRICHMENT_DB_USER=merlt ENRICHMENT_DB_PASSWORD="${MERLT_DB_PASSWORD:-merlt}" \
            REDIS_HOST=localhost REDIS_PORT="${VISUALEX_REDIS_PORT:-6381}" REDIS_URL="$REDIS/0" RQ_REDIS_URL="$REDIS/1" \
            FALKORDB_HOST=localhost FALKORDB_PORT="${VISUALEX_FALKOR_PORT:-6382}" FALKORDB_GRAPH_NAME="${MERLT_GRAPH_NAME:-merl_t_legal}" \
            QDRANT_HOST=localhost QDRANT_PORT="${VISUALEX_QDRANT_PORT:-6343}" QDRANT_COLLECTION="${MERLT_QDRANT_COLLECTION:-merl_t_legal_chunks}" \
            VISUALEX_API_URL=http://localhost:5000 \
            BFF_CALLBACK_URL=http://localhost:3001/api/merlt/internal/job-callback \
            BFF_EXTRACTION_CALLBACK_URL=http://localhost:3001/api/merlt/internal/extraction-callback \
            BFF_QA_CALLBACK_URL=http://localhost:3001/api/merlt/internal/qa-callback \
            MERLT_REACT_ENABLED="${MERLT_REACT_ENABLED:-true}" \
            MERLT_SEMANTIC_SEARCH_ENABLED="${MERLT_SEMANTIC_SEARCH_ENABLED:-true}" \
            MERLT_ADVANCED_ROUTING_ENABLED="${MERLT_ADVANCED_ROUTING_ENABLED:-true}" \
            MERLT_MCP_LEGAL_TOOLS_ENABLED="${MERLT_MCP_LEGAL_TOOLS_ENABLED:-false}"
        ( cd "$MERLT_ROOT" && exec "$MERLT_PYTHON" -m uvicorn merlt.app:app --reload --port "$MERLT_PORT" ) &
        MERLT_PID=$!
        MERLT_SKIP_SEED=true "$MERLT_PYTHON" -m rq.cli worker merlt_ingest merlt_extract merlt_ner_train --url "$RQ_REDIS_URL" &
        MERLT_WORKER_PID=$!
    fi
    echo -e "${YELLOW}Waiting for MERL-T /health (up to ${MERLT_HEALTH_TIMEOUT}s)...${NC}"
    elapsed=0
    until curl -fsS "http://localhost:$MERLT_PORT/health" >/dev/null 2>&1; do
        if [ "$elapsed" -ge "$MERLT_HEALTH_TIMEOUT" ]; then
            echo -e "${RED}MERL-T not healthy after ${MERLT_HEALTH_TIMEOUT}s - continuing${NC}"; break
        fi
        sleep 2; elapsed=$((elapsed + 2))
    done
    if [ "$MERLT_API_IN_DOCKER" = "true" ] && ! "${COMPOSE[@]}" --profile merlt ps --status running --services 2>/dev/null | grep -q '^merlt-worker$'; then
        echo -e "${RED}merlt-worker is not running: ingestion, note extraction and NER training will not complete${NC}"
    fi
fi

sleep 3
echo -e "\n${GREEN}Running:${NC} Python API http://localhost:5000 · server http://localhost:3001 · web http://localhost:5173"
[ "$MERLT_ENABLED" = "true" ] && echo -e "         MERL-T http://localhost:$MERLT_PORT"
echo -e "${YELLOW}Ctrl+C stops everything (data stays in the volumes).${NC}\n"
wait
