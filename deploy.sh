#!/bin/bash

#===============================================================================
# VisuaLex Deploy Script
#
# Usage: ./deploy.sh [OPTIONS]
#
# Options:
#   --major          Increment major version (1.0.0 -> 2.0.0)
#   --minor          Increment minor version (1.0.0 -> 1.1.0)
#   --patch          Increment patch version (1.0.0 -> 1.0.1)
#   --no-pull        Skip git pull
#   --no-restart     Skip service restart
#   --merlt          Build + (re)start the MERL-T Docker stack this deploy
#   --no-merlt-build Bring the MERL-T stack up WITHOUT rebuilding images
#                    (only meaningful together with --merlt)
#   -h, --help       Show this help message
#
# Example:
#   ./deploy.sh --patch             # Build and bump patch version (vanilla)
#   ./deploy.sh --minor --no-pull   # Build without pull, bump minor
#   ./deploy.sh --merlt             # Vanilla deploy + rebuild MERL-T stack
#   ./deploy.sh --merlt --no-merlt-build  # Vanilla deploy + restart MERL-T (no rebuild)
#===============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_FILE="$SCRIPT_DIR/version.txt"

# Default options
DO_PULL=true
DO_RESTART=true
VERSION_BUMP=""
DO_MERLT=false          # --merlt: manage the MERL-T Docker stack this deploy
MERLT_REBUILD=true      # --no-merlt-build flips this off (up without rebuild)

# MERL-T compose invocation — keep in sync with start.sh / docs.
MERLT_COMPOSE_FILE="docker-compose.merlt.yml"
MERLT_BUILD_SERVICES=("merlt-api" "merlt-worker" "mcp-legal-it")

#===============================================================================
# Functions
#===============================================================================

print_header() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                  VisuaLex Deploy Script                   ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${BLUE}▶${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

show_help() {
    cat << 'EOF'
Usage: ./deploy.sh [OPTIONS]

Options:
  --major          Increment major version (1.0.0 -> 2.0.0)
  --minor          Increment minor version (1.0.0 -> 1.1.0)
  --patch          Increment patch version (1.0.0 -> 1.0.1)
  --no-pull        Skip git pull
  --no-restart     Skip service restart
  --merlt          Build + (re)start the MERL-T Docker stack this deploy
  --no-merlt-build Bring the MERL-T stack up WITHOUT rebuilding images
                   (only meaningful together with --merlt)
  -h, --help       Show this help message

Examples:
  ./deploy.sh --patch             # Build and bump patch version (vanilla)
  ./deploy.sh --minor --no-pull   # Build without pull, bump minor
  ./deploy.sh                     # Build only, no version bump
  ./deploy.sh --merlt             # Vanilla deploy + rebuild MERL-T stack
  ./deploy.sh --merlt --no-merlt-build   # Vanilla deploy + restart MERL-T (no rebuild)
EOF
    exit 0
}

get_current_version() {
    if [[ -f "$VERSION_FILE" ]]; then
        cat "$VERSION_FILE" | tr -d '[:space:]'
    else
        echo "1.0.0"
    fi
}

bump_version() {
    local version="$1"
    local bump_type="$2"

    # Parse version
    IFS='.' read -r major minor patch <<< "$version"

    case "$bump_type" in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch)
            patch=$((patch + 1))
            ;;
    esac

    echo "${major}.${minor}.${patch}"
}

update_version_file() {
    local new_version="$1"
    echo "$new_version" > "$VERSION_FILE"
}

#===============================================================================
# Parse Arguments
#===============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --major)
            VERSION_BUMP="major"
            shift
            ;;
        --minor)
            VERSION_BUMP="minor"
            shift
            ;;
        --patch)
            VERSION_BUMP="patch"
            shift
            ;;
        --no-pull)
            DO_PULL=false
            shift
            ;;
        --no-restart)
            DO_RESTART=false
            shift
            ;;
        --merlt)
            DO_MERLT=true
            shift
            ;;
        --no-merlt-build)
            MERLT_REBUILD=false
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

#===============================================================================
# Main Script
#===============================================================================

print_header

CURRENT_VERSION=$(get_current_version)
echo -e "Current version: ${YELLOW}${CURRENT_VERSION}${NC}"

if [[ -n "$VERSION_BUMP" ]]; then
    NEW_VERSION=$(bump_version "$CURRENT_VERSION" "$VERSION_BUMP")
    echo -e "New version:     ${GREEN}${NEW_VERSION}${NC} (${VERSION_BUMP})"
fi

echo ""

# Step 1: Git Pull
if [[ "$DO_PULL" == true ]]; then
    print_step "Pulling latest changes..."
    cd "$SCRIPT_DIR"
    git pull -r origin "$(git branch --show-current)"
    print_success "Git pull completed"

    # The mcp-legal-it MERL-T sidecar is a git submodule at vendor/mcp-legal-it.
    # A plain pull does NOT update submodules, leaving its Docker build context
    # empty. Only needed when we are going to build the MERL-T stack.
    if [[ "$DO_MERLT" == true ]]; then
        print_step "Updating git submodules (vendor/mcp-legal-it)..."
        git submodule update --init --recursive
        print_success "Submodules updated"
    fi
else
    print_warning "Skipping git pull (--no-pull)"
fi

# Step 2: Python API dependencies + Playwright browser
print_step "Installing Python API dependencies..."
VENV_PIP="$SCRIPT_DIR/.venv/bin/pip"
VENV_PLAYWRIGHT="$SCRIPT_DIR/.venv/bin/playwright"
if [[ -x "$VENV_PIP" ]]; then
    "$VENV_PIP" install --quiet -r "$SCRIPT_DIR/requirements.txt"
    print_success "Python API dependencies installed"
else
    print_error "Python venv not found at $SCRIPT_DIR/.venv — create it with 'python -m venv .venv && .venv/bin/pip install -r requirements.txt'"
    exit 1
fi

# Ensure Playwright Chromium browser matches the installed package version
# (pip install does not download browser binaries; PDF export and date
# completion require chromium to be present in the Playwright cache).
if [[ -x "$VENV_PLAYWRIGHT" ]]; then
    print_step "Syncing Playwright Chromium browser..."
    "$VENV_PLAYWRIGHT" install chromium > /dev/null 2>&1 \
        && print_success "Playwright Chromium ready" \
        || print_warning "Playwright install failed — PDF export and date completion may break. Run '.venv/bin/playwright install chromium' manually."
fi

# Step 3: Backend dependencies
print_step "Installing backend dependencies..."
cd "$SCRIPT_DIR/backend"
npm install --silent
print_success "Backend dependencies installed"

# Step 3b: Regenerate Prisma client to match the current schema.
# Without this, schema changes pulled from git leave node_modules/@prisma/client
# stale and `tsc --noEmit` fails on missing models/fields.
print_step "Regenerating Prisma client..."
npx prisma generate > /dev/null
print_success "Prisma client regenerated"

# Step 3c: Apply pending migrations to the production database.
# Idempotent — no-op if there are no pending migrations. Without this, a
# schema change ships to prod with no matching DB column/table and the API
# fails at runtime on the first query.
print_step "Applying database migrations..."
npx prisma migrate deploy
print_success "Database migrations applied"

# Step 4: Frontend dependencies
print_step "Installing frontend dependencies..."
cd "$SCRIPT_DIR/frontend"
npm install --silent
print_success "Frontend dependencies installed"

# Step 5: Frontend build
print_step "Building frontend..."
npm run build
print_success "Frontend build completed"

# Step 6: Compile backend TypeScript to dist/.
# pm2 launches `node dist/index.js` (see backend/package.json `start` script),
# so without this step the service runs against a stale dist on every deploy.
# `tsc` performs the type-check too — it fails on any error before emitting.
print_step "Building backend..."
cd "$SCRIPT_DIR/backend"
npm run build
print_success "Backend build completed"

# Step 6b: MERL-T Docker stack (opt-in via --merlt)
# Builds the three code-bearing images (api/worker/mcp-legal-it) from the
# freshly pulled source and (re)creates the whole stack. The DB/cache/graph
# containers (postgres/redis/falkordb/qdrant) keep their data volumes, so a
# recreate reloads state intact. Heavy: needs Docker + a >=4GB instance.
if [[ "$DO_MERLT" == true ]]; then
    print_step "Deploying MERL-T Docker stack..."
    cd "$SCRIPT_DIR"

    # Preflight — fail loudly with a clear message instead of half-way.
    if ! command -v docker &> /dev/null; then
        print_error "Docker not found. Install Docker before deploying MERL-T (--merlt)."
        exit 1
    fi
    if ! docker compose version &> /dev/null; then
        print_error "'docker compose' (v2) not available. Install the Docker Compose plugin."
        exit 1
    fi
    if [[ ! -f "$SCRIPT_DIR/$MERLT_COMPOSE_FILE" ]]; then
        print_error "$MERLT_COMPOSE_FILE not found in $SCRIPT_DIR."
        exit 1
    fi

    DC=(docker compose -f "$MERLT_COMPOSE_FILE" --profile api-in-docker)

    if [[ "$MERLT_REBUILD" == true ]]; then
        print_step "Building MERL-T images (${MERLT_BUILD_SERVICES[*]})..."
        "${DC[@]}" build "${MERLT_BUILD_SERVICES[@]}"
        print_success "MERL-T images built"
    else
        print_warning "Skipping MERL-T image rebuild (--no-merlt-build)"
    fi

    print_step "Starting MERL-T stack..."
    "${DC[@]}" up -d
    print_success "MERL-T stack up"

    # Wait for the two code-bearing services to report healthy (or fail fast on
    # a crash loop). set -e is disabled around the poll so a transient
    # non-healthy read doesn't abort the deploy.
    print_step "Waiting for merlt-api / merlt-worker to be healthy..."
    set +e
    MERLT_DEADLINE=$(( $(date +%s) + 240 ))
    while true; do
        api_h=$(docker inspect -f '{{.State.Health.Status}}' visualex-merlt-api 2>/dev/null)
        wrk_h=$(docker inspect -f '{{.State.Health.Status}}' visualex-merlt-worker 2>/dev/null)
        api_s=$(docker inspect -f '{{.State.Status}}' visualex-merlt-api 2>/dev/null)
        if [[ "$api_h" == "healthy" && "$wrk_h" == "healthy" ]]; then
            print_success "MERL-T api + worker healthy"
            break
        fi
        if [[ "$api_s" == "exited" || "$api_s" == "restarting" ]]; then
            print_error "merlt-api is $api_s — check 'docker logs visualex-merlt-api'"
            break
        fi
        if [[ $(date +%s) -ge $MERLT_DEADLINE ]]; then
            print_warning "MERL-T not healthy after 240s (api=$api_h worker=$wrk_h). Check 'docker compose -f $MERLT_COMPOSE_FILE ps'."
            break
        fi
        sleep 5
    done
    set -e
else
    print_warning "Skipping MERL-T Docker stack (pass --merlt to deploy it)"
fi

# Step 7: Update version (only if build succeeded and bump requested)
if [[ -n "$VERSION_BUMP" ]]; then
    print_step "Updating version to ${NEW_VERSION}..."
    update_version_file "$NEW_VERSION"
    print_success "Version updated to ${NEW_VERSION}"

    # Commit version change
    cd "$SCRIPT_DIR"
    git add version.txt
    git commit -m "chore: bump version to ${NEW_VERSION}

🤖 Generated with [Claude Code](https://claude.com/claude-code)" || true
    print_success "Version commit created"
fi

# Step 8: Restart services
if [[ "$DO_RESTART" == true ]]; then
    print_step "Restarting services..."

    # Try pm2 first
    if command -v pm2 &> /dev/null; then
        pm2 restart all 2>/dev/null || print_warning "pm2 restart failed or no processes"
        print_success "Services restarted (pm2)"
    # Try systemctl
    elif command -v systemctl &> /dev/null; then
        sudo systemctl restart visualex-backend 2>/dev/null || print_warning "systemctl restart failed"
        print_success "Services restarted (systemctl)"
    else
        print_warning "No service manager found (pm2/systemctl). Please restart manually."
    fi
else
    print_warning "Skipping service restart (--no-restart)"
fi

# Done
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                  Deploy completed!                        ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"

FINAL_VERSION=$(get_current_version)
echo -e "Version: ${GREEN}${FINAL_VERSION}${NC}"
echo ""
