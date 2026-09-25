#!/bin/bash

# VisuaLex Development Startup Script
# Starts: visualex_api (Python), backend (Node), frontend (Vite)
# Optional: MERLT FastAPI sidecar when MERLT_ENABLED=true

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
MERLT_ENABLED="${MERLT_ENABLED:-false}"
# The supported MERL-T path is api-in-docker (api + worker + mcp-legal-it as
# containers, ~40 env vars wired in docker-compose.merlt.yml). It implies the
# compose dependencies. Local uvicorn (MERLT_API_IN_DOCKER=false) is a
# developer mode: it needs a venv with the merlt deps and runs without the
# mcp-legal-it tools.
MERLT_API_IN_DOCKER="${MERLT_API_IN_DOCKER:-true}"
if [ "$MERLT_ENABLED" = "true" ] && [ "$MERLT_API_IN_DOCKER" = "true" ]; then
    MERLT_COMPOSE_ENABLED="true"
fi
MERLT_COMPOSE_ENABLED="${MERLT_COMPOSE_ENABLED:-false}"
MERLT_COMPOSE_FILE="${MERLT_COMPOSE_FILE:-$PROJECT_ROOT/docker-compose.merlt.yml}"
MERLT_ROOT="${MERLT_ROOT:-$PROJECT_ROOT/merlt}"
MERLT_PORT="${MERLT_PORT:-8000}"
MERLT_HEALTH_TIMEOUT="${MERLT_HEALTH_TIMEOUT:-60}"
# Local mode interpreter: the VisuaLex .venv sourced below has no torch/fastmcp/
# falkordb, so a bare "python" cannot import merlt. Prefer a merlt venv.
if [ -z "${MERLT_PYTHON:-}" ] && [ -x "$MERLT_ROOT/.venv/bin/python" ]; then
    MERLT_PYTHON="$MERLT_ROOT/.venv/bin/python"
fi
MERLT_PYTHON="${MERLT_PYTHON:-python}"
MERLT_PID=""
MERLT_WORKER_PID=""

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           VisuaLex Development Environment${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Cleanup on exit. Also on EXIT: with `set -e` an aborted step (a failed
# compose up, a missing submodule) used to leave the Python API, Node and Vite
# running as orphans. The guard keeps the handler from running twice.
CLEANED_UP=""
cleanup() {
    if [ -n "$CLEANED_UP" ]; then return; fi
    CLEANED_UP=1
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    kill ${API_PID:-} ${BACKEND_PID:-} ${FRONTEND_PID:-} ${MERLT_PID:-} ${MERLT_WORKER_PID:-} 2>/dev/null || true
    if [ "$MERLT_COMPOSE_ENABLED" = "true" ]; then
        docker compose -f "$MERLT_COMPOSE_FILE" --profile api-in-docker down >/dev/null 2>&1 || true
    fi
    echo -e "${GREEN}All services stopped.${NC}"
}
on_signal() { cleanup; exit 0; }
trap on_signal SIGINT SIGTERM
trap cleanup EXIT

# Check port availability
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1; then
        echo -e "${RED}Port $1 in use${NC} - run: ${YELLOW}kill \$(lsof -t -i:$1)${NC}"
        return 1
    fi
    return 0
}

echo -e "\n${YELLOW}Checking ports...${NC}"
check_port 5000 || exit 1
check_port 3001 || exit 1
check_port 5173 || exit 1
if [ "$MERLT_ENABLED" = "true" ]; then
    check_port "$MERLT_PORT" || exit 1
    if [ ! -d "$MERLT_ROOT" ]; then
        echo -e "${RED}MERLT_ROOT not found: $MERLT_ROOT${NC}"
        exit 1
    fi
    if [ "$MERLT_COMPOSE_ENABLED" = "true" ] && [ ! -f "$MERLT_COMPOSE_FILE" ]; then
        echo -e "${RED}MERLT_COMPOSE_FILE not found: $MERLT_COMPOSE_FILE${NC}"
        exit 1
    fi
    # mcp-legal-it is a git submodule that docker-compose.merlt.yml builds from
    # ./vendor/mcp-legal-it: a fresh clone has an EMPTY directory there and
    # `compose up` fails on the missing Dockerfile. Initialise it here, before
    # anything is started.
    if [ "$MERLT_API_IN_DOCKER" = "true" ] && [ ! -f "$PROJECT_ROOT/vendor/mcp-legal-it/Dockerfile" ]; then
        echo -e "${YELLOW}vendor/mcp-legal-it is empty: initialising the git submodule...${NC}"
        git -C "$PROJECT_ROOT" submodule update --init --recursive vendor/mcp-legal-it || true
        if [ ! -f "$PROJECT_ROOT/vendor/mcp-legal-it/Dockerfile" ]; then
            echo -e "${RED}vendor/mcp-legal-it still empty. Run: git submodule update --init --recursive vendor/mcp-legal-it${NC}"
            exit 1
        fi
    fi
    # The MERL-T → BFF callbacks are authenticated with X-Internal-Secret. The
    # BFF reads MERLT_INTERNAL_SECRET from backend/.env, compose interpolates
    # the same variable from this shell: read it from backend/.env when the
    # shell does not carry it, so the two sides cannot disagree.
    if [ -z "${MERLT_INTERNAL_SECRET:-}" ] && [ -f "$PROJECT_ROOT/backend/.env" ]; then
        MERLT_INTERNAL_SECRET="$(sed -n 's/^MERLT_INTERNAL_SECRET=["'"'"']\{0,1\}\([^"'"'"']*\).*/\1/p' "$PROJECT_ROOT/backend/.env" | tail -1)"
    fi
    if [ -z "${MERLT_INTERNAL_SECRET:-}" ]; then
        echo -e "${YELLOW}MERLT_INTERNAL_SECRET is empty: worker/api callbacks to the BFF will be refused (set it in backend/.env)${NC}"
    else
        export MERLT_INTERNAL_SECRET
    fi
    # Same for the admin API key: the BFF sends it as X-API-Key, merlt-api seeds
    # it (MERLT_ADMIN_API_KEY) so RLCF training, hygiene and ingestion work.
    if [ -z "${MERLT_API_KEY:-}" ] && [ -f "$PROJECT_ROOT/backend/.env" ]; then
        MERLT_API_KEY="$(sed -n 's/^MERLT_API_KEY=["'"'"']\{0,1\}\([^"'"'"']*\).*/\1/p' "$PROJECT_ROOT/backend/.env" | tail -1)"
    fi
    if [ -z "${MERLT_API_KEY:-}" ]; then
        echo -e "${YELLOW}MERLT_API_KEY is empty: admin ops (RLCF training, graph hygiene, ingestion) will answer 401 until a key is set in backend/.env${NC}"
    else
        export MERLT_API_KEY
        export MERLT_ADMIN_API_KEY="$MERLT_API_KEY"
    fi
    if [ "$MERLT_API_IN_DOCKER" != "true" ]; then
        if ! "$MERLT_PYTHON" -c 'import merlt.app' >/dev/null 2>&1; then
            echo -e "${RED}MERLT_PYTHON ($MERLT_PYTHON) cannot import merlt.app: create a venv in $MERLT_ROOT (pip install -e '.[dev]') or use MERLT_API_IN_DOCKER=true${NC}"
            exit 1
        fi
    fi
fi
echo -e "${GREEN}All ports available${NC}"

# Preflight: Python venv, required packages, Playwright browser
echo -e "\n${YELLOW}Checking Python environment...${NC}"
VENV_PYTHON="$PROJECT_ROOT/.venv/bin/python"
VENV_PLAYWRIGHT="$PROJECT_ROOT/.venv/bin/playwright"

if [ ! -x "$VENV_PYTHON" ]; then
    echo -e "${RED}.venv not found at $PROJECT_ROOT/.venv${NC}"
    echo -e "  Run: ${YELLOW}python -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/playwright install chromium${NC}"
    exit 1
fi

if ! "$VENV_PYTHON" -c "import redis, playwright" 2>/dev/null; then
    echo -e "${RED}Python dependencies missing (redis and/or playwright not importable)${NC}"
    echo -e "  Run: ${YELLOW}.venv/bin/pip install -r requirements.txt${NC}"
    exit 1
fi

# Detect Playwright browser cache location (OS-aware, honors override env var)
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-}"
if [ -z "$PW_CACHE" ]; then
    case "$OSTYPE" in
        darwin*) PW_CACHE="$HOME/Library/Caches/ms-playwright" ;;
        linux*)  PW_CACHE="$HOME/.cache/ms-playwright" ;;
    esac
fi
if [ -n "$PW_CACHE" ] && ! ls "$PW_CACHE" 2>/dev/null | grep -q chromium; then
    echo -e "${RED}Playwright Chromium browser not found in $PW_CACHE${NC}"
    echo -e "  Run: ${YELLOW}.venv/bin/playwright install chromium${NC}"
    exit 1
fi
echo -e "${GREEN}Python environment OK${NC}"

# 1. Start VisuaLex API (Python/Quart - port 5000)
echo -e "\n${YELLOW}[1/3] Starting VisuaLex API (port 5000)...${NC}"
cd "$PROJECT_ROOT"
source .venv/bin/activate
python app.py &
API_PID=$!
echo -e "${GREEN}VisuaLex API started (PID: $API_PID)${NC}"

# 2. Start Platform Backend (Node - port 3001)
echo -e "\n${YELLOW}[2/3] Starting Platform Backend (port 3001)...${NC}"
cd "$PROJECT_ROOT/backend"

# Bootstrap the platform DB before launching the server so a fresh checkout is
# usable end-to-end: regenerate the Prisma client, apply pending migrations,
# and seed the admin. Without this, a clean clone has an unmigrated DB and zero
# loginable accounts (register creates inactive users; login rejects them), so
# the whole authenticated app is unreachable. Non-fatal (guarded against set -e)
# so the dev server still comes up if something needs fixing by hand. The admin
# seed runs only when ADMIN_PASSWORD is set (seed.ts exits 1 otherwise).
# Uses backend/.env DATABASE_URL — the MERL-T DATABASE_URL export happens later
# (step 4) and only targets the MERL-T sidecar.
echo -e "${BLUE}  Bootstrapping platform DB (prisma generate + migrate deploy + seed)...${NC}"
npx prisma generate > /dev/null 2>&1 || echo -e "${YELLOW}  ⚠ prisma generate failed${NC}"
npx prisma migrate deploy || echo -e "${YELLOW}  ⚠ prisma migrate deploy failed — is the platform DB reachable on DATABASE_URL?${NC}"
if [ -n "$ADMIN_PASSWORD" ]; then
    npm run db:seed || echo -e "${YELLOW}  ⚠ db:seed failed${NC}"
else
    echo -e "${YELLOW}  ⚠ ADMIN_PASSWORD not set — skipping admin seed (no admin will exist on a fresh DB).${NC}"
    echo -e "${YELLOW}    Set ADMIN_PASSWORD then run 'npm run db:seed' in backend/ to create one.${NC}"
fi

npm run dev &
BACKEND_PID=$!
echo -e "${GREEN}Platform Backend started (PID: $BACKEND_PID)${NC}"

# 3. Start Frontend (Vite - port 5173)
echo -e "\n${YELLOW}[3/3] Starting Frontend (port 5173)...${NC}"
cd "$PROJECT_ROOT/frontend"
npm run dev &
FRONTEND_PID=$!
echo -e "${GREEN}Frontend started (PID: $FRONTEND_PID)${NC}"

# 4. Start MERLT sidecar (optional - port 8000 by default)
if [ "$MERLT_ENABLED" = "true" ]; then
    if [ "$MERLT_COMPOSE_ENABLED" = "true" ]; then
        if [ "$MERLT_API_IN_DOCKER" = "true" ]; then
            echo -e "\n${YELLOW}[4/4] Starting MERLT stack (deps + API in Docker)...${NC}"
            docker compose -f "$MERLT_COMPOSE_FILE" --profile api-in-docker up -d
        else
            echo -e "\n${YELLOW}[4/5] Starting MERLT dependencies (deps in Docker, API local)...${NC}"
            docker compose -f "$MERLT_COMPOSE_FILE" up -d
        fi
        MERLT_DB_USER="${MERLT_POSTGRES_USER:-merlt}"
        MERLT_DB_PASSWORD="${MERLT_POSTGRES_PASSWORD:-merlt}"
        MERLT_DB_NAME="${MERLT_POSTGRES_DB:-merlt}"
        MERLT_DB_PORT="${MERLT_POSTGRES_PORT:-5436}"
        MERLT_REDIS_HOST_PORT="${MERLT_REDIS_PORT:-6381}"
        export DATABASE_URL="${MERLT_DATABASE_URL:-postgresql://$MERLT_DB_USER:$MERLT_DB_PASSWORD@localhost:$MERLT_DB_PORT/$MERLT_DB_NAME}"
        export ENRICHMENT_DATABASE_URL="${MERLT_ENRICHMENT_DATABASE_URL:-$DATABASE_URL}"
        export RLCF_DATABASE_URL="${MERLT_RLCF_DATABASE_URL:-$DATABASE_URL}"
        export RLCF_ASYNC_DATABASE_URL="${MERLT_RLCF_ASYNC_DATABASE_URL:-postgresql+asyncpg://$MERLT_DB_USER:$MERLT_DB_PASSWORD@localhost:$MERLT_DB_PORT/$MERLT_DB_NAME}"
        export REDIS_HOST="${MERLT_REDIS_HOST:-localhost}"
        export REDIS_PORT="$MERLT_REDIS_HOST_PORT"
        export REDIS_URL="${MERLT_REDIS_URL:-redis://localhost:$MERLT_REDIS_HOST_PORT/0}"
        export FALKORDB_HOST="${MERLT_FALKOR_HOST:-localhost}"
        export FALKORDB_PORT="${MERLT_FALKOR_PORT:-6382}"
        # The seeded graph: api, worker and seed loader must agree on the name.
        export FALKORDB_GRAPH_NAME="${MERLT_GRAPH_NAME:-merl_t_legal}"
        export QDRANT_HOST="${MERLT_QDRANT_HOST:-localhost}"
        export QDRANT_PORT="${MERLT_QDRANT_PORT:-6343}"
        # RQ queue (Redis DB 1 of the MERL-T redis, NOT localhost:6379): the api
        # enqueues lazy ingestion / note extraction / NER training here and the
        # local worker below consumes it. Without it the api enqueued to a
        # redis that does not exist and every ingest answered 503.
        export RQ_REDIS_URL="${MERLT_RQ_REDIS_URL:-redis://localhost:$MERLT_REDIS_HOST_PORT/1}"
        # worker/config.py reads the split ENRICHMENT_DB_* vars.
        export ENRICHMENT_DB_HOST="${MERLT_ENRICHMENT_DB_HOST:-localhost}"
        export ENRICHMENT_DB_PORT="$MERLT_DB_PORT"
        export ENRICHMENT_DB_NAME="$MERLT_DB_NAME"
        export ENRICHMENT_DB_USER="$MERLT_DB_USER"
        export ENRICHMENT_DB_PASSWORD="$MERLT_DB_PASSWORD"
        if [ "$MERLT_API_IN_DOCKER" != "true" ]; then
            # Local api/worker run on the host: same wiring compose gives the
            # containers, with host addresses. Without the callback URLs the
            # api skips the Q&A progress callback and jobs hang until the watchdog.
            export VISUALEX_API_URL="${VISUALEX_API_URL:-http://localhost:5000}"
            export BFF_CALLBACK_URL="${MERLT_BFF_CALLBACK_URL:-http://localhost:3001/api/merlt/internal/job-callback}"
            export BFF_EXTRACTION_CALLBACK_URL="${MERLT_BFF_EXTRACTION_CALLBACK_URL:-http://localhost:3001/api/merlt/internal/extraction-callback}"
            export BFF_QA_CALLBACK_URL="${MERLT_BFF_QA_CALLBACK_URL:-http://localhost:3001/api/merlt/internal/qa-callback}"
            export QDRANT_COLLECTION="${MERLT_QDRANT_COLLECTION:-merl_t_legal_chunks}"
            export MERLT_REACT_ENABLED="${MERLT_REACT_ENABLED:-true}"
            export MERLT_SEMANTIC_SEARCH_ENABLED="${MERLT_SEMANTIC_SEARCH_ENABLED:-true}"
            export MERLT_ADVANCED_ROUTING_ENABLED="${MERLT_ADVANCED_ROUTING_ENABLED:-true}"
            # mcp-legal-it only runs under the api-in-docker profile: keep the
            # experts on their built-in tools unless an MCP endpoint is given.
            if [ -z "${MCP_LEGAL_IT_URL:-}" ]; then
                export MERLT_MCP_LEGAL_TOOLS_ENABLED="${MERLT_MCP_LEGAL_TOOLS_ENABLED:-false}"
            fi
        fi
    fi

    if [ "$MERLT_API_IN_DOCKER" = "true" ]; then
        echo -e "${BLUE}MERLT API runs in Docker container (no local uvicorn)${NC}"
    else
        echo -e "\n${YELLOW}[5/5] Starting MERLT sidecar locally (port $MERLT_PORT)...${NC}"
        echo -e "${BLUE}  NOTE: requires MERL-T deps installed in MERLT_PYTHON env${NC}"
        echo -e "${BLUE}  If ImportError: set MERLT_API_IN_DOCKER=true to use Docker container${NC}"
        cd "$MERLT_ROOT"
        "$MERLT_PYTHON" -m uvicorn merlt.app:app --reload --port "$MERLT_PORT" &
        MERLT_PID=$!
        echo -e "${GREEN}MERLT sidecar started (PID: $MERLT_PID)${NC}"
        # The RQ worker only exists as a container under --profile api-in-docker;
        # in local mode nothing consumed the queues, so lazy ingestion, note
        # extraction and NER training stayed "in corso" forever. Same three
        # queues as docker-compose.merlt.yml's merlt-worker command.
        if [ -n "${RQ_REDIS_URL:-}" ]; then
            MERLT_SKIP_SEED=true "$MERLT_PYTHON" -m rq.cli worker merlt_ingest merlt_extract merlt_ner_train --url "$RQ_REDIS_URL" &
            MERLT_WORKER_PID=$!
            echo -e "${GREEN}MERLT worker started (PID: $MERLT_WORKER_PID)${NC}"
        else
            echo -e "${YELLOW}RQ_REDIS_URL not set: no local MERL-T worker (set MERLT_COMPOSE_ENABLED=true or export RQ_REDIS_URL)${NC}"
        fi
        cd "$PROJECT_ROOT"
    fi

    # Health gate: aspetta che MERL-T risponda /health prima di proseguire
    echo -e "${YELLOW}Waiting for MERLT /health (timeout ${MERLT_HEALTH_TIMEOUT}s)...${NC}"
    elapsed=0
    until curl -fsS "http://localhost:$MERLT_PORT/health" >/dev/null 2>&1; do
        if [ "$elapsed" -ge "$MERLT_HEALTH_TIMEOUT" ]; then
            echo -e "${RED}MERLT health gate FAILED after ${MERLT_HEALTH_TIMEOUT}s${NC}"
            echo -e "${RED}Check logs above. Continuing anyway (services may not be ready).${NC}"
            break
        fi
        sleep 2
        elapsed=$((elapsed + 2))
    done
    if [ "$elapsed" -lt "$MERLT_HEALTH_TIMEOUT" ]; then
        echo -e "${GREEN}MERLT /health OK after ${elapsed}s${NC}"
    fi
    # A healthy api with no worker is a half-working stack (jobs queue forever):
    # say so instead of letting the first ingestion reveal it.
    if [ "$MERLT_COMPOSE_ENABLED" = "true" ] && [ "$MERLT_API_IN_DOCKER" = "true" ]; then
        if ! docker compose -f "$MERLT_COMPOSE_FILE" --profile api-in-docker ps --status running --services 2>/dev/null | grep -q '^merlt-worker$'; then
            echo -e "${RED}merlt-worker is not running: lazy ingestion, note extraction and NER training will never complete${NC}"
        fi
    fi
fi

# Wait for services
sleep 3

# Display info
echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Services running:${NC}"
echo -e "  VisuaLex API:      ${BLUE}http://localhost:5000${NC}"
echo -e "  Platform Backend:  ${BLUE}http://localhost:3001${NC}"
echo -e "  Frontend:          ${BLUE}http://localhost:5173${NC}"
if [ "$MERLT_ENABLED" = "true" ]; then
    echo -e "  MERLT sidecar:     ${BLUE}http://localhost:$MERLT_PORT${NC}"
fi
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}\n"

wait
