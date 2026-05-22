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
MERLT_COMPOSE_ENABLED="${MERLT_COMPOSE_ENABLED:-false}"
MERLT_API_IN_DOCKER="${MERLT_API_IN_DOCKER:-false}"
MERLT_COMPOSE_FILE="${MERLT_COMPOSE_FILE:-$PROJECT_ROOT/docker-compose.merlt.yml}"
MERLT_ROOT="${MERLT_ROOT:-$PROJECT_ROOT/merlt}"
MERLT_PORT="${MERLT_PORT:-8000}"
MERLT_HEALTH_TIMEOUT="${MERLT_HEALTH_TIMEOUT:-60}"
MERLT_PYTHON="${MERLT_PYTHON:-python}"
MERLT_PID=""

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           VisuaLex Development Environment${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    kill $API_PID $BACKEND_PID $FRONTEND_PID ${MERLT_PID:-} 2>/dev/null || true
    if [ "$MERLT_COMPOSE_ENABLED" = "true" ]; then
        docker compose -f "$MERLT_COMPOSE_FILE" --profile api-in-docker down >/dev/null 2>&1 || true
    fi
    echo -e "${GREEN}All services stopped.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM

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
        export QDRANT_HOST="${MERLT_QDRANT_HOST:-localhost}"
        export QDRANT_PORT="${MERLT_QDRANT_PORT:-6343}"
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
