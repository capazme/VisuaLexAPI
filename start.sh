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

# 1. Start VisuaLex API (Python/Quart - port 5000)
echo -e "\n${YELLOW}[1/3] Starting VisuaLex API (port 5000)...${NC}"
cd "$PROJECT_ROOT"
if [ -d ".venv" ]; then
    source .venv/bin/activate
fi
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
