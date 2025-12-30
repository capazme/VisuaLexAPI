# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VisuaLexAPI is an async web application and REST API for fetching and displaying Italian legal texts from multiple sources (Normattiva, EUR-Lex, Brocardi). Built with Quart (async Flask-like framework), it provides both a web UI and API endpoints for retrieving legal norms, article texts, Brocardi annotations, and PDF exports.

The project consists of:
- **Python API**: Quart-based async API with web scraping (port 5000)
- **Node.js Backend**: Express + Prisma platform backend (port 3001)
- **Frontend**: React + TypeScript SPA with Vite (port 5173)

## Architecture

### Python API (`/visualex_api`)

Controller-service architecture for legal data retrieval:

- **`app.py`** (root): Main server with UI + API endpoints
- **`visualex_api/app.py`**: Alternative server with `/api/*` prefix + Swagger UI
- **`visualex_api/services/`**: Scraper services
  - `normattiva_scraper.py`: Italian state laws (Normattiva)
  - `eurlex_scraper.py`: EU regulations/directives (EUR-Lex)
  - `brocardi_scraper.py`: Legal annotations (Brocardi.it)
  - `pdfextractor.py`: PDF extraction using Playwright browser pool
- **`visualex_api/tools/`**: Utilities
  - `norma.py`: Core data models (`Norma`, `NormaVisitata`)
  - `urngenerator.py`: URN generation for legal documents
  - `treextractor.py`: Article tree structures
  - `text_op.py`: Text parsing, normalization, and date handling
  - `config.py`: Rate limiting, cache size, Playwright browser pool
  - `map.py`: Act type mappings
  - `browser_manager.py`: Playwright browser pool management (`PlaywrightManager`)

### Node.js Backend (`/backend`)

Express server with Prisma ORM for platform features (authentication, user data).

### Frontend Structure

React SPA with component-based architecture:

- **`frontend/src/App.tsx`**: Main app with routing
- **`frontend/src/store/useAppStore.ts`**: Zustand store for global state
- **`frontend/src/components/`**:
  - `features/search/`: Search form, results, article display
  - `features/workspace/`: Active workspace view
  - `features/history/`: Search history
  - `features/bookmarks/`: Saved articles
  - `layout/`: Layout components (Sidebar, Layout)
  - `ui/`: Reusable UI components (modals, PDF viewer, toasts)
- **`frontend/src/types/index.ts`**: TypeScript type definitions
- **`frontend/src/pages/SearchPage.tsx`**: Main search page

## Development Commands

### Quick Start (All Services)

```bash
./start.sh  # Starts Python API (5000), Node backend (3001), Frontend (5173)
```

### Python API

```bash
source .venv/bin/activate
pip install -r requirements.txt

# Main server (UI + API)
python app.py

# Alternative server with /api/* prefix + Swagger
python -m visualex_api.app
```

### Node.js Backend

```bash
cd backend
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev      # Dev server at :5173
npm run build    # Production build
npm run lint     # ESLint
npm run test     # Vitest
npm run test:ui  # Vitest with UI
```

### PDF Export

Requires Playwright browsers:
```bash
pip install playwright
playwright install chromium
```

## Key API Endpoints

All endpoints are POST unless specified, accepting JSON bodies.

### Core Endpoints

- **POST `/fetch_norma_data`**: Create norm structure from parameters (act_type, date, act_number, article)
- **POST `/fetch_article_text`**: Fetch article text in parallel for multiple articles
- **POST `/stream_article_text`**: Stream article results as NDJSON (one JSON object per line)
- **POST `/fetch_brocardi_info`**: Retrieve Brocardi annotations (position, ratio, spiegazione, massime)
- **POST `/fetch_all_data`**: Combined endpoint returning both article text and Brocardi info
- **POST `/fetch_tree`**: Get article tree for complete URN (with optional link/details flags)
- **GET `/history`**: Retrieve server-side search history
- **POST `/export_pdf`**: Export document to PDF using Playwright

### API Request Format

```json
{
  "act_type": "codice civile",
  "date": "1990-08-07",         // Optional
  "act_number": "241",           // Optional
  "article": "2043",             // Required: single, list "1,2", or range "3-5"
  "version": "vigente",          // Optional: "vigente" | "originale"
  "version_date": "2024-01-15",  // Optional: YYYY-MM-DD
  "annex": "A"                   // Optional: allegato
}
```

## Data Models

### Core Classes (visualex_api/tools/norma.py)

- **`Norma`**: Represents a legal norm
  - Properties: `tipo_atto`, `data`, `numero_atto`, `url`, `tree`
  - Lazy-loads URL (URN) and tree structure

- **`NormaVisitata`**: Represents a specific article visit
  - Properties: `norma`, `numero_articolo`, `versione`, `data_versione`, `allegato`, `urn`
  - Implements hash/equality for deduplication
  - Used throughout the API as the primary data container

Both classes have `to_dict()` and `from_dict()` methods for JSON serialization.

## Date Handling System

The project uses a dual-approach system for date handling, optimizing between speed and accuracy:

### Backend Date System (`visualex_api/tools/text_op.py`)

**Sync approach (for URN generation):**
- `complete_date_or_parse(date_str)`: Fast, synchronous function for URN generation
  - If date is year-only (e.g., "1990"), returns "1990-01-01" for URN
  - If date is partial (e.g., "1990-08"), queries cache first, falls back to year-only
  - Used in `urngenerator.py` to avoid blocking on date lookup

**Async approach (for accurate dates):**
- `complete_date_or_parse_async(date_str)`: Fetches real dates from Normattiva via Playwright
  - Uses Playwright browser to navigate Normattiva and extract actual publication date
  - Implements manual caching in `_date_cache` dict to avoid repeated requests
  - Returns accurate date in YYYY-MM-DD format
  - Used in endpoints that need precise dates (version comparison, metadata display)

**Low-level function:**
- `complete_date()`: Direct Playwright-based date completion (used by async wrapper)

### Frontend Date System (`frontend/src/utils/dateUtils.ts`)

- `parseItalianDate(dateStr)`: Parses date strings while preserving original year (no conversion to YYYY-01-01)
  - Returns Date object with original precision maintained
  - Critical for avoiding artificial date standardization

- `formatDateItalianLong(date)`: Formats dates to Italian extended format
  - Example output: "7 agosto 1990" for 1990-08-07
  - Used in: `NormaCard`, `NormaBlockComponent`, `NormeNavigator`
  - Respects actual dates from backend (doesn't show synthetic YYYY-01-01)

### When to Use Which Approach

| Use Case | Backend Function | Frontend Function |
|----------|------------------|-------------------|
| URN Generation | `complete_date_or_parse()` | N/A |
| Display in UI | N/A | `formatDateItalianLong()` |
| Article Metadata | `complete_date_or_parse_async()` | `formatDateItalianLong()` |
| Version Comparison | `complete_date_or_parse_async()` | `formatDateItalianLong()` |
| Internal Parsing | `complete_date_or_parse()` | `parseItalianDate()` |

**Key Principle**: Never force year-only dates to "YYYY-01-01" in UI display. The frontend respects backend precision.

## Scraping Architecture

The application uses async web scraping with intelligent source routing:

1. **Source Detection**: `NormaController.get_scraper_for_norma()` routes requests based on act type
   - EUR-Lex: TUE, TFUE, CDFUE, Regolamento UE, Direttiva UE
   - Normattiva: All Italian state laws (legge, decreto, d.p.r., regio decreto, codici)
   - Brocardi: Annotations only for Normattiva sources

2. **Parallel Fetching**: `asyncio.gather()` fetches multiple articles concurrently

3. **Streaming**: `/stream_article_text` uses Quart's `Response` generator for real-time results

4. **Browser Management**: Playwright browser pool via `PlaywrightManager` singleton for efficient resource usage

## Frontend State Management

Uses Zustand for global state with the following stores:

- **Search Results**: Active norm cards with article text, Brocardi info
- **History**: Previously searched norms (server-side, fetched from `/history`)
- **Bookmarks**: Quick-access saved articles (localStorage)
- **Dossiers**: Research collections with multiple articles (localStorage)
- **Workspace**: Active tabs with content
- **Settings**: User preferences (API endpoint, theme, etc.)

The store is located in `frontend/src/store/useAppStore.ts` and uses Immer for immutable updates.

### Bookmarks vs Dossiers - Conceptual Difference

**Bookmarks** 📌 (Simple, Quick Access):
- Purpose: Save individual articles for quick reference
- Use case: Daily workflow, frequently accessed norms
- Features:
  - One-click save/access
  - Tag filtering
  - Instant norm retrieval (click → opens search)
- Think: Browser bookmarks

**Dossiers** 📁 (Advanced, Research Collections):
- Purpose: Organize multiple articles into research projects
- Use case: Complex legal research, study preparation, case analysis
- Features:
  - Multiple articles per dossier
  - Drag & drop reordering
  - Status tracking (unread, reading, important, done)
  - PDF export, JSON export, sharing
  - Bulk operations (move, delete)
  - Import articles from norm tree
  - Description and tags
- Think: Research folders/projects

**Both are essential** - Bookmarks for speed, Dossiers for organization.

All three (History, Bookmarks, Dossiers) support instant norm retrieval via `triggerSearch()`.

## Important Implementation Notes

### Avoiding Code Duplication

Always check for existing utilities before implementing:
- **URN generation**: Use `urngenerator.py` functions
- **Text parsing**: Use `text_op.py` for normalization and parsing
- **Tree extraction**: Use `treextractor.py` for article structures
- **Date handling** (backend): Use `text_op.py` date functions:
  - `complete_date_or_parse(date_str)`: Sync version for URN generation (year-only dates become YYYY-01-01)
  - `complete_date_or_parse_async(date_str)`: Async version using Playwright to fetch real dates from Normattiva
  - `complete_date()`: Low-level async Playwright-based date completion
  - Manual cache in `_date_cache` dict for repeated requests
- **Date handling** (frontend): Use `src/utils/dateUtils.ts`:
  - `parseItalianDate(dateStr)`: Parses dates keeping year as-is (no conversion to YYYY-01-01)
  - `formatDateItalianLong(date)`: Formats to Italian extended format (e.g., "7 agosto 1990")

### Rate Limiting

Configured in `visualex_api/tools/config.py`:
- Default: 1000 requests per 600 seconds (10 minutes) per IP
- Middleware in `NormaController.rate_limit_middleware()`
- Returns 429 status when limit exceeded

### Scraping Fragility

Web scrapers depend on HTML structure of external sites (Normattiva, EUR-Lex, Brocardi). HTML changes on these sites will break scrapers and require updates to parsing logic.

### Async Patterns

- All scraper methods are async (`async def get_document()`, `async def get_info()`)
- Use `asyncio.gather()` for parallel operations
- Use `asyncio.to_thread()` for blocking operations (file I/O, Playwright browser calls)
- Quart routes are async by default
- **Browser management**: Use `PlaywrightManager` singleton from `browser_manager.py` for browser pooling and resource efficiency
- Date completion is async via Playwright: `complete_date_or_parse_async()` fetches real dates from Normattiva asynchronously

### Frontend-Backend Communication

- Development: Vite proxies API calls from `:5173` to `:5000`
- CORS configured for localhost origins

## Common Patterns

### Adding a New Scraper

1. Create new scraper class in `visualex_api/services/`
2. Implement async `get_document(normavisitata: NormaVisitata) -> Tuple[str, str]`
3. Add act type detection in `NormaController.get_scraper_for_norma()`
4. Update `tools/map.py` if new act type mappings are needed

### Adding a New API Endpoint

1. Define route in `NormaController._setup_routes()` (or `setup_routes()` in standalone app.py)
2. Implement async handler method in controller
3. Use `await request.get_json()` for body parsing
4. Return `jsonify()` for JSON responses
5. Use structlog logger for debugging (`log.info()`, `log.error()`)

### Frontend: Adding a New Component

1. Create component in appropriate `components/` subdirectory
2. Import types from `src/types/index.ts`
3. Access global state with `useAppStore()` hook
4. Use Tailwind CSS for styling (configured with v4)
5. Export as default for lazy loading if needed

### Backend: Browser Operations (Playwright)

All browser automation is now async via Playwright. The `PlaywrightManager` singleton handles pooling:

1. **For PDF extraction**: `pdfextractor.py` uses `PlaywrightManager` to pool browser instances
2. **For date completion**: `text_op.py` functions `complete_date()` and `complete_date_or_parse_async()` use Playwright
3. **Usage pattern**:
   ```python
   from visualex_api.tools.browser_manager import PlaywrightManager

   manager = PlaywrightManager()
   browser = await manager.get_browser()
   page = await browser.new_page()
   # ... do work
   await page.close()
   ```
4. **Important**: All Playwright calls are async. Use `asyncio.to_thread()` only if wrapping synchronous code
5. **Installation**: Run `playwright install chromium` before first use
6. **Resource cleanup**: `PlaywrightManager` handles browser lifecycle - no manual cleanup needed for `get_browser()`

## Debugging

- Python: Logs use structlog with ISO timestamps and color output (DEBUG level)
- Frontend: React DevTools, Zustand DevTools, browser console
- Playwright: Check with `playwright install --dry-run`

## Environment Variables

Python API:
- `HOST`: Server host (default: `0.0.0.0`)
- `PORT`: Server port (default: `5000`)

Node.js Backend: See `backend/.env.example` for required variables.

---

## Multi-Agent Workflow

This project is optimized for multi-agent collaboration. Use specialized agents for different types of tasks to maximize efficiency and code quality.

### Recommended Agents by Task Type

| Task Type | Agent | Why |
|-----------|-------|-----|
| **Python API - New Endpoints** | `api-designer` | Design OpenAPI spec, then `builder` implements |
| **Python API - Scraper Issues** | `scraper-builder` | Expert in retry logic, rate limiting, checkpointing |
| **Python API - Async Bugs** | `debugger` | Specializes in asyncio issues, race conditions |
| **Python API - Performance** | `performance-optimization` | Optimize without breaking existing logic |
| **Frontend - New Components** | `frontend-builder` | React/TypeScript/Tailwind expert, follows rules |
| **Frontend - UI/UX Review** | `ux-reviewer` | Can use Chrome DevTools for visual testing |
| **Frontend - State Management** | `frontend-architect` | Zustand patterns, state design |
| **Frontend - Visual Bugs** | `debugger` + `frontend-builder` | Debug + fix with browser testing |
| **Backend - Database Schema** | `database-architect` | Prisma schema design and migrations |
| **Backend - Auth/Security** | `security-audit` | Review auth, middleware, input validation |
| **Documentation** | `scribe` | README, API docs, inline comments |
| **Testing** | `validator` | Write tests, run test suites |
| **Complex Multi-Step** | `orchestrator` | Coordinates multiple agents |

### Quick Multi-Agent Commands

```bash
# Design new API endpoint
> Usa api-designer per progettare endpoint /api/compare_versions

# Fix scraper breakage
> Usa scraper-builder per fixare normattiva_scraper - cambio HTML

# Review frontend UX
> Usa ux-reviewer per valutare la UX del workspace con browser testing

# Optimize performance
> Usa performance-optimization per ottimizzare fetch_article_text

# Add new feature end-to-end
> Usa orchestrator per implementare feature "export to Word"
```

### Entry Points for Agents

**Python API Work:**
- Main controller: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/visualex_api/app.py`
- Scrapers: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/visualex_api/services/*_scraper.py`
- Models: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/visualex_api/tools/norma.py`
- Text/Date utilities: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/visualex_api/tools/text_op.py`
- Browser management: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/visualex_api/tools/browser_manager.py`
- Config: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/visualex_api/tools/config.py`

**Frontend Work:**
- App entry: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/App.tsx`
- Store: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/store/useAppStore.ts`
- Types: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/types/index.ts`
- Date utilities: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/utils/dateUtils.ts`
- Components: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend/src/components/`

**Backend Work:**
- Server: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/backend/src/index.ts`
- Prisma schema: `/Users/gpuzio/Desktop/CODE/VisuaLexAPI/backend/prisma/schema.prisma`

### Common Workflows

#### 1. Add New Scraper Source

```
1. Use architect to research the target site structure
2. Use scraper-builder to implement with retry/rate-limiting
3. Use builder to integrate into NormaController.get_scraper_for_norma()
4. Use validator to write integration tests
```

#### 2. Add New Frontend Feature

```
1. Use frontend-architect to design component structure and state
2. Use frontend-builder to implement (auto-follows Tailwind/React rules)
3. Use ux-reviewer with browser testing to validate UX
4. Use validator to add Vitest tests
```

#### 3. Fix Scraper Breakage

```
1. Use debugger to identify HTML structure changes
2. Use scraper-builder to update selectors and parsing logic
3. Use validator to verify fix with real requests
```

#### 4. Performance Issue

```
1. Use debugger to profile and identify bottleneck
2. Use performance-optimization for idempotent optimization
3. Use validator to ensure no regression
```

#### 5. Add API Endpoint

```
1. Use api-designer to design request/response schema
2. Use builder to implement in NormaController._setup_routes()
3. Use frontend-builder to add corresponding frontend service call
4. Use validator to test end-to-end
```

#### 6. Fix Date Display Issues

```
Backend:
1. For URN generation: Use sync complete_date_or_parse() in urngenerator.py
2. For metadata endpoints: Use async complete_date_or_parse_async() to get accurate dates
3. Always return actual dates in JSON response (not synthetic YYYY-01-01)

Frontend:
1. Replace date.toLocaleDateString() with formatDateItalianLong()
2. Verify parseItalianDate() is used for date input parsing
3. Test with year-only entries to ensure they display correctly (not forced to MM-01)
4. Use ux-reviewer with browser testing to validate date display

Pattern:
- Backend: Sync (fast) for URNs, Async (accurate) for display
- Frontend: Always use formatDateItalianLong() for display, parseItalianDate() for input
```

### Browser Testing (Frontend)

When working on frontend, agents can use Chrome DevTools MCP for visual verification:

**Dev Server URL:** `http://localhost:5173`

**Workflow:**
1. Start dev server: `cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend && npm run dev`
2. Agent uses `navigate_page(http://localhost:5173)`
3. Agent uses `take_screenshot()` for visual check
4. Agent uses `list_console_messages()` for errors
5. Agent uses `resize_page(375, 667)` for mobile testing

**Agents with browser access:** `frontend-builder`, `ux-reviewer`, `validator`, `debugger`

### Project-Specific Patterns

**Async Patterns (Python):**
- All scraper methods return `async def get_document() -> Tuple[str, str]`
- Use `asyncio.gather()` for parallel fetching
- Use `asyncio.to_thread()` for blocking I/O (Playwright, file ops)
- Quart routes are async by default
- Playwright operations are async via `PlaywrightManager` singleton

**Date Handling (Python/Frontend):**
- Backend URN generation: Use sync `complete_date_or_parse()` (fast, year-only dates → YYYY-01-01)
- Backend metadata/comparison: Use async `complete_date_or_parse_async()` (slow, accurate dates via Playwright)
- Frontend display: Always use `formatDateItalianLong()` to show Italian dates (respects backend precision)
- Never display synthetic YYYY-01-01 dates in UI (use actual dates from backend)

**State Management (Frontend):**
- Zustand store in `useAppStore.ts` with Immer
- Always use actions, never mutate state directly
- Store structure: `searchResults`, `history`, `bookmarks`, `dossiers`, `workspace`, `settings`

**Error Handling:**
- Python: Custom exceptions in `visualex_api/tools/exceptions.py`
- Raise `ValidationError`, `ResourceNotFoundError`, `RateLimitExceededError`
- Global error handler in `NormaController.handle_error()`

**Code Reuse:**
- URN generation: Use `urngenerator.py` functions
- Text parsing: Use `text_op.py` utilities (includes date functions)
- Tree extraction: Use `treextractor.py`
- Date utilities: Use `text_op.py` backend or `dateUtils.ts` frontend
- Browser operations: Use `PlaywrightManager` singleton
- Never duplicate these utilities

### Critical Files - DO NOT BREAK

**Python:**
- `visualex_api/app.py` - Main controller
- `visualex_api/tools/norma.py` - Core data models
- `visualex_api/tools/text_op.py` - Text parsing AND date handling (critical for both URN and date completion)
- `visualex_api/tools/browser_manager.py` - Playwright browser pooling singleton
- `visualex_api/services/*_scraper.py` - Fragile HTML parsers

**Frontend:**
- `frontend/src/store/useAppStore.ts` - Global state
- `frontend/src/types/index.ts` - Type definitions
- `frontend/src/services/api.ts` - API client
- `frontend/src/utils/dateUtils.ts` - Date parsing and formatting (used in NormaCard, NormaBlockComponent, NormeNavigator)

**Backend:**
- `backend/prisma/schema.prisma` - Database schema

### Testing Strategy

**Python:**
```bash
# Manual testing
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI
source .venv/bin/activate
python app.py

# Test endpoint
curl -X POST http://localhost:5000/api/fetch_norma_data \
  -H "Content-Type: application/json" \
  -d '{"act_type": "codice civile", "article": "2043"}'
```

**Frontend:**
```bash
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI/frontend
npm run test        # Run all tests
npm run test:ui     # Interactive test UI
npm run lint        # Lint check
```

**Backend:**
```bash
cd /Users/gpuzio/Desktop/CODE/VisuaLexAPI/backend
npm run dev         # Start dev server
npm run prisma:studio  # Prisma database GUI
```

### Gotchas and Known Issues

1. **Scraper Fragility**: All scrapers depend on external HTML structure (Normattiva, EUR-Lex, Brocardi). HTML changes break parsers.
2. **Async Context**: Python API is fully async - never use blocking operations without `asyncio.to_thread()`
3. **Rate Limiting**: Configured in `config.py` - 1000 requests per 10 minutes per IP
4. **Playwright**: Required for PDF extraction and date completion. Install with `playwright install chromium`. Uses `PlaywrightManager` singleton for pooling.
5. **Date Handling**: Two complementary approaches:
   - Sync `complete_date_or_parse()` for URN generation (fast, approximate: year-only dates become YYYY-01-01)
   - Async `complete_date_or_parse_async()` for actual date resolution via Playwright (slower, accurate)
   - Frontend uses `formatDateItalianLong()` for display (e.g., "7 agosto 1990"), respecting actual dates
6. **CORS**: Frontend dev server proxies to Python API - check `vite.config.ts`
7. **Annex Handling**: Codici have default annex in URN - see `create_norma_visitata_from_data()`
8. **Selenium Removed**: All browser automation now uses Playwright. `WebDriverManager` is deprecated alias of `PlaywrightManager`.

### Date System Troubleshooting

**Problem**: Dates showing as "YYYY-01-01" in UI (synthetic dates)
- **Cause**: `parseItalianDate()` or `formatDateItalianLong()` not used in component
- **Fix**: Use `formatDateItalianLong()` instead of `date.toLocaleDateString()`
- **Example**: `formatDateItalianLong(new Date(normVisitata.data_versione))` returns "7 agosto 1990"

**Problem**: Date completion is slow in backend
- **Cause**: Using `complete_date_or_parse_async()` for high-volume requests (launches Playwright for each)
- **Fix**: Use cache-aware approach or batch requests. Check `_date_cache` implementation in `text_op.py`
- **For URN generation**: Use sync `complete_date_or_parse()` instead (never launches Playwright)

**Problem**: Playwright browser timeout during date completion
- **Cause**: Normattiva.it site slow or unresponsive, or `PlaywrightManager` browser exhausted
- **Fix**: Increase timeout in `complete_date()`, check Playwright browser pool size in `browser_manager.py`
- **Fallback**: `complete_date_or_parse_async()` catches timeouts and returns cached/synthetic date

**Problem**: Year-only dates not rendering in display
- **Cause**: `parseItalianDate()` returning Date object with month/day as 01
- **Fix**: This is expected behavior. Frontend should NOT try to "normalize" to full dates - show "1990" for year-only entries
- **Principle**: Backend `complete_date_or_parse()` returns synthetic YYYY-01-01 for URNs only. Display layer uses actual dates from metadata.

### Skills to Use

For this project, these skills are particularly useful:

**Python/Backend:**
- `async-patterns` - For asyncio debugging and optimization
- `fastapi-patterns` - Similar patterns apply to Quart
- `scraping-patterns` - For scraper fixes and improvements
- `error-handling` - For custom exception hierarchy

**Frontend:**
- `react-patterns` - Component design and hooks
- `ui-ux-review` - Complete UX evaluation
- `performance-optimization` - Frontend bundle and render optimization

**General:**
- `code-review` - Before merging significant changes
- `security-audit` - For auth and input validation
