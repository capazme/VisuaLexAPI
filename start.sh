#!/bin/bash
# VisuaLex — the one entry point, in two modes.
#
#   ./start.sh [--dev]    the development stack, on this machine, with hot reload:
#                           Docker (infra/compose.yml): postgres, redis, falkordb, qdrant — always;
#                             mcp-legal-it, merlt-api, merlt-worker too with MERLT_ENABLED=true.
#                           Host: Python API (services/visualex, :5000), server (apps/server, :3001),
#                             web (apps/web, :5173).
#                           MERLT_API_IN_DOCKER=false runs the MERL-T api and worker on the host
#                             (developer mode: a venv with the merlt deps, no mcp-legal-it tools).
#                           A fresh checkout is prepared here: env files, venv, dependencies, Chromium.
#   ./start.sh --prod     on the deployment host: build the images and run the whole stack as
#                           containers, behind the ingress (scripts/prod/deploy.sh). It deploys what
#                           is checked out: main or a vX.Y.Z tag with a clean tree, unless
#                           --allow-branch; after a backup, unless --no-backup.
#   ./start.sh --prod --stop
#                         stop the production stack (containers and volumes stay).
set -e

usage() {
    cat <<'EOF'
Usage: ./start.sh [--dev]                                  the development stack (the default)
       ./start.sh --prod [--allow-branch] [--no-backup]    deploy what is checked out, on the production host
       ./start.sh --prod --stop                            stop the production stack (containers and volumes stay)
EOF
}

# The flags come first: nothing is started, created or checked before they are understood.
MODE=""
PROD_ARGS=()
for arg in "$@"; do
    case "$arg" in
        --dev|--prod)
            if [ -n "$MODE" ] && [ "$MODE" != "${arg#--}" ]; then
                echo "Choose --dev or --prod, not both." >&2; usage >&2; exit 2
            fi
            MODE="${arg#--}" ;;
        --stop|--allow-branch|--no-backup) PROD_ARGS+=("$arg") ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $arg" >&2; usage >&2; exit 2 ;;
    esac
done
DEFAULTED_TO_DEV=""
if [ -z "$MODE" ]; then MODE=dev; DEFAULTED_TO_DEV=1; fi
if [ "$MODE" = dev ] && [ "${#PROD_ARGS[@]}" -gt 0 ]; then
    echo "${PROD_ARGS[*]} only goes with --prod." >&2; usage >&2; exit 2
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ "$MODE" = prod ]; then
    exec sh "$PROJECT_ROOT/scripts/prod/deploy.sh" "${PROD_ARGS[@]}"
fi

# First run on a fresh checkout: the two env files the stack and the server read, from their
# examples. Never overwritten. The JWT secret is generated here, not left as the example's.
. "$PROJECT_ROOT/scripts/prod/lib.sh"
if [ ! -f "$PROJECT_ROOT/infra/.env" ]; then
    cp "$PROJECT_ROOT/infra/.env.example" "$PROJECT_ROOT/infra/.env"
    echo -e "${YELLOW}Created infra/.env from the example (development passwords)${NC}"
fi
if [ ! -f "$PROJECT_ROOT/apps/server/.env" ]; then
    # umask 077: the file is the owner's alone from the moment it exists, and so is the temporary
    # copy env_set writes beside it while the secret goes in.
    (
        umask 077
        cp "$PROJECT_ROOT/apps/server/.env.example" "$PROJECT_ROOT/apps/server/.env"
        env_set "$PROJECT_ROOT/apps/server/.env" JWT_SECRET "$(random_secret 64)" '"'
    )
    echo -e "${YELLOW}Created apps/server/.env from the example, with a fresh JWT secret${NC}"
fi
# The MCP server's two secrets: its credential at the authorization server (shared by
# apps/server and apps/mcp) and the key exchanged tokens are signed with. Added when
# missing, also to an existing apps/server/.env; never replaced.
(
    umask 077
    S="$PROJECT_ROOT/apps/server/.env"; M="$PROJECT_ROOT/apps/mcp/.env"
    if [ -z "$(env_get "$S" OAUTH_MCP_CLIENT_SECRET)" ]; then
        env_set "$S" OAUTH_MCP_CLIENT_SECRET "$(random_secret 48)" '"'
        echo -e "${YELLOW}Added OAUTH_MCP_CLIENT_SECRET to apps/server/.env${NC}"
    fi
    if [ -z "$(env_get "$S" OAUTH_DELEGATION_SECRET)" ]; then
        env_set "$S" OAUTH_DELEGATION_SECRET "$(random_secret 48)" '"'
        echo -e "${YELLOW}Added OAUTH_DELEGATION_SECRET to apps/server/.env${NC}"
    fi
    if [ ! -f "$M" ] && [ -f "$PROJECT_ROOT/apps/mcp/.env.example" ]; then
        cp "$PROJECT_ROOT/apps/mcp/.env.example" "$M"
        env_set "$M" MCP_CLIENT_SECRET "$(env_get "$S" OAUTH_MCP_CLIENT_SECRET)" '"'
        echo -e "${YELLOW}Created apps/mcp/.env, with the server's MCP credential${NC}"
    fi
)
# Same values as Compose reads: ports, stack name, passwords.
if [ -f "$PROJECT_ROOT/infra/.env" ]; then set -a; . "$PROJECT_ROOT/infra/.env"; set +a; fi
COMPOSE=(docker compose -f "$PROJECT_ROOT/infra/compose.yml")
MERLT_ENABLED="${MERLT_ENABLED:-false}"
# One switch for all three: the server (whose apps/server/.env this overrides), the web
# app, and the MERL-T services started below. A web app showing MERL-T while the
# server has it off calls routes that answer 404.
export MERLT_ENABLED
export VITE_FEATURE_MERLT="${VITE_FEATURE_MERLT:-$MERLT_ENABLED}"
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
[ -z "$DEFAULTED_TO_DEV" ] || echo "(--dev is the default; ./start.sh --prod deploys on the server)"

# A process and its descendants: Quart's reloader serves from a child process
# that outlives its parent's SIGTERM and keeps :5000 bound.
kill_tree() {
    local pid="$1" child
    [ -n "$pid" ] || return 0
    for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
    kill "$pid" 2>/dev/null || true
}

CLEANED_UP=""
STORES_STARTED=""
cleanup() {
    [ -n "$CLEANED_UP" ] && return
    CLEANED_UP=1
    echo -e "\n${YELLOW}Shutting down...${NC}"
    for pid in ${API_PID:-} ${SERVER_PID:-} ${WEB_PID:-} ${MCP_PID:-} ${MERLT_PID:-} ${MERLT_WORKER_PID:-}; do kill_tree "$pid"; done
    # Only once this run started the stores: a second start.sh that stops at a
    # check must not take the running stack's stores away. stop, not down:
    # containers and volumes stay for the next start.
    if [ -n "$STORES_STARTED" ]; then
        "${COMPOSE[@]}" --profile merlt stop >/dev/null 2>&1 || true
    fi
    echo -e "${GREEN}Stopped.${NC}"
}
trap 'cleanup; exit 0' SIGINT SIGTERM
trap cleanup EXIT

check_port() {
    if lsof -Pi :"$1" -sTCP:LISTEN -t >/dev/null 2>&1; then
        holder="$(lsof -Pi :"$1" -sTCP:LISTEN -Fc 2>/dev/null | sed -n 's/^c//p' | head -1)"
        if [ "$holder" = "ControlCenter" ]; then
            # Killing it is useless: macOS starts it again at once.
            echo -e "${RED}Port $1 is held by macOS's AirPlay Receiver${NC} - turn it off: System Settings → General → AirDrop & Handoff → AirPlay Receiver"
        else
            echo -e "${RED}Port $1 in use${NC} (${holder:-unknown}) - run: ${YELLOW}kill \$(lsof -t -i:$1)${NC}"
        fi
        return 1
    fi
}
for p in 5000 3001 5173 3002; do check_port "$p" || exit 1; done

if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}Docker is not running${NC} - start Docker Desktop and run ./start.sh again"; exit 1
fi

# Dependencies: each step runs only when its result is missing, so a second start skips them all.
if [ ! -x "$VENV/bin/python" ]; then
    PY=""
    for candidate in python3.14 python3.13 python3.12 python3; do
        if command -v "$candidate" >/dev/null 2>&1 \
            && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
            PY="$candidate"; break
        fi
    done
    if [ -z "$PY" ]; then
        echo -e "${RED}Python 3.12 or newer not found${NC} - install one (docs/setup.md)"; exit 1
    fi
    echo -e "${YELLOW}Creating services/visualex/.venv with $PY...${NC}"
    "$PY" -m venv "$VENV"
fi
if ! "$VENV/bin/python" -c "import redis, playwright" 2>/dev/null; then
    echo -e "${YELLOW}Installing the Python dependencies...${NC}"
    "$VENV/bin/pip" install -q -r "$PROJECT_ROOT/services/visualex/requirements-dev.txt"
fi
for app in apps/server apps/web apps/mcp; do
    if [ ! -d "$PROJECT_ROOT/$app/node_modules" ]; then
        echo -e "${YELLOW}Installing the $app dependencies...${NC}"
        npm ci --prefix "$PROJECT_ROOT/$app"
    fi
done
PW_CACHE="${PLAYWRIGHT_BROWSERS_PATH:-}"
if [ -z "$PW_CACHE" ]; then
    case "$OSTYPE" in
        darwin*) PW_CACHE="$HOME/Library/Caches/ms-playwright" ;;
        linux*)  PW_CACHE="$HOME/.cache/ms-playwright" ;;
    esac
fi
if [ -n "$PW_CACHE" ] && ! ls "$PW_CACHE" 2>/dev/null | grep -q chromium; then
    echo -e "${YELLOW}Installing Playwright's Chromium...${NC}"
    "$VENV/bin/playwright" install chromium
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

echo -e "\n${YELLOW}[1/5] Data stores...${NC}"
STORES_STARTED=1
"${COMPOSE[@]}" up -d --wait postgres redis falkordb qdrant

echo -e "\n${YELLOW}[2/5] Python API (:5000)...${NC}"
( cd "$PROJECT_ROOT/services/visualex" && exec "$VENV/bin/python" app.py ) &
API_PID=$!

echo -e "\n${YELLOW}[3/5] Server (:3001)...${NC}"
cd "$PROJECT_ROOT/apps/server"
npx prisma generate > /dev/null 2>&1 || echo -e "${YELLOW}prisma generate failed${NC}"
npx prisma migrate deploy || echo -e "${YELLOW}prisma migrate deploy failed - does DATABASE_URL in apps/server/.env point at port ${VISUALEX_PG_PORT:-5436}?${NC}"
# The seed reads ADMIN_PASSWORD from apps/server/.env itself; the shell may override it.
if [ -n "${ADMIN_PASSWORD:-$(server_env ADMIN_PASSWORD)}" ]; then npm run db:seed || echo -e "${YELLOW}db:seed failed${NC}"; fi
npm run dev &
SERVER_PID=$!

echo -e "\n${YELLOW}[4/5] Web (:5173)...${NC}"
cd "$PROJECT_ROOT/apps/web"
npm run dev &
WEB_PID=$!

# The MCP server for Claude Code and LibreLex (apps/mcp/CLAUDE.md): it reads apps/mcp/.env.
echo -e "\n${YELLOW}[5/5] MCP server (:3002)...${NC}"
cd "$PROJECT_ROOT/apps/mcp"
npm run dev &
MCP_PID=$!
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
        MERLT_SKIP_SEED=true "$MERLT_PYTHON" -m rq.cli worker merlt_ingest merlt_extract merlt_ner_train merlt_bulk --url "$RQ_REDIS_URL" &
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
echo -e "\n${GREEN}Running:${NC} Python API http://localhost:5000 · server http://localhost:3001 · web http://localhost:5173 · MCP http://localhost:3002/mcp"
[ "$MERLT_ENABLED" = "true" ] && echo -e "         MERL-T http://localhost:$MERLT_PORT"
echo -e "${YELLOW}Ctrl+C stops everything (data stays in the volumes).${NC}\n"
wait
