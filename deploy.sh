#!/bin/bash

#===============================================================================
# VisuaLex Deploy Script
#
# Usage: ./deploy.sh [OPTIONS]
#
# Options:
#   --major     Increment major version (1.0.0 -> 2.0.0)
#   --minor     Increment minor version (1.0.0 -> 1.1.0)
#   --patch     Increment patch version (1.0.0 -> 1.0.1)
#   --no-pull   Skip git pull
#   --no-restart Skip service restart
#   -h, --help  Show this help message
#
# Example:
#   ./deploy.sh --patch           # Build and bump patch version
#   ./deploy.sh --minor --no-pull # Build without pull, bump minor
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
  --major       Increment major version (1.0.0 -> 2.0.0)
  --minor       Increment minor version (1.0.0 -> 1.1.0)
  --patch       Increment patch version (1.0.0 -> 1.0.1)
  --no-pull     Skip git pull
  --no-restart  Skip service restart
  -h, --help    Show this help message

Examples:
  ./deploy.sh --patch             # Build and bump patch version
  ./deploy.sh --minor --no-pull   # Build without pull, bump minor
  ./deploy.sh                     # Build only, no version bump
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
else
    print_warning "Skipping git pull (--no-pull)"
fi

# Step 2: Backend dependencies
print_step "Installing backend dependencies..."
cd "$SCRIPT_DIR/backend"
npm install --silent
print_success "Backend dependencies installed"

# Step 3: Frontend dependencies
print_step "Installing frontend dependencies..."
cd "$SCRIPT_DIR/frontend"
npm install --silent
print_success "Frontend dependencies installed"

# Step 4: Frontend build
print_step "Building frontend..."
npm run build
print_success "Frontend build completed"

# Step 5: TypeScript check for backend
print_step "Checking backend TypeScript..."
cd "$SCRIPT_DIR/backend"
npx tsc --noEmit
print_success "Backend TypeScript check passed"

# Step 6: Update version (only if build succeeded and bump requested)
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

# Step 7: Restart services
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
