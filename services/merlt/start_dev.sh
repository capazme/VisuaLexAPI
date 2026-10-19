#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to start MERL-T databases."
  echo "Install Docker Desktop and retry."
  exit 1
fi

if [ -f "docker-compose.dev.yml" ]; then
  echo "Starting MERL-T dev databases..."
  docker compose -f docker-compose.dev.yml up -d
fi

if ! command -v python >/dev/null 2>&1; then
  echo "Python is required to run the MERL-T API."
  exit 1
fi

if ! python -c "import uvicorn" >/dev/null 2>&1; then
  echo "Missing uvicorn. Install dev deps with:"
  echo "  pip install -e \".[dev]\""
  exit 1
fi

echo "Starting MERL-T API on http://localhost:8100"
exec python -m uvicorn merlt.app:app --reload --port 8100
