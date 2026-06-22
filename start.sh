#!/bin/bash

# VisuaLex Development Startup Script
# Starts: visualex_api (Python), backend (Node), frontend (Vite)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}           VisuaLex Development Environment${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"

# Cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    kill $API_PID $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
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

# Wait for services
sleep 3

# Display info
echo -e "\n${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}Services running:${NC}"
echo -e "  VisuaLex API:      ${BLUE}http://localhost:5000${NC}"
echo -e "  Platform Backend:  ${BLUE}http://localhost:3001${NC}"
echo -e "  Frontend:          ${BLUE}http://localhost:5173${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}\n"

wait
