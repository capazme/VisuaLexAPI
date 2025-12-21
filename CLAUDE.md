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
  - `text_op.py`: Text parsing and normalization
  - `config.py`: Rate limiting, cache size
  - `map.py`: Act type mappings

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

## Scraping Architecture

The application uses async web scraping with intelligent source routing:

1. **Source Detection**: `NormaController.get_scraper_for_norma()` routes requests based on act type
   - EUR-Lex: TUE, TFUE, CDFUE, Regolamento UE, Direttiva UE
   - Normattiva: All Italian state laws (legge, decreto, d.p.r., regio decreto, codici)
   - Brocardi: Annotations only for Normattiva sources

2. **Parallel Fetching**: `asyncio.gather()` fetches multiple articles concurrently

3. **Streaming**: `/stream_article_text` uses Quart's `Response` generator for real-time results

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
- **Date handling**: Use `complete_date_or_parse()` and `format_date_to_extended()`

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
- Use `asyncio.to_thread()` for blocking operations (file I/O, Playwright)
- Quart routes are async by default

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

## Debugging

- Python: Logs use structlog with ISO timestamps and color output (DEBUG level)
- Frontend: React DevTools, Zustand DevTools, browser console
- Playwright: Check with `playwright install --dry-run`

## Environment Variables

Python API:
- `HOST`: Server host (default: `0.0.0.0`)
- `PORT`: Server port (default: `5000`)

Node.js Backend: See `backend/.env.example` for required variables.
