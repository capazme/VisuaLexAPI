# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VisuaLexAPI is an async web application and REST API for fetching and displaying Italian legal texts from multiple sources (Normattiva, EUR-Lex, Brocardi). Built with Quart (async Flask-like framework), it provides both a web UI and API endpoints for retrieving legal norms, article texts, Brocardi annotations, and PDF exports.

The project consists of:
- **Backend**: Quart-based async Python API with web scraping capabilities
- **Frontend**: React + TypeScript SPA with Vite, Tailwind CSS, and Zustand state management

## Architecture

### Backend Structure

The backend uses a controller-service architecture:

- **`src/app.py`**: Standalone server with UI + root-level API endpoints (e.g., `/fetch_article_text`)
- **`src/visualex_api/app.py`**: Alternative server with `/api/*` prefixed endpoints + Swagger UI
- **`src/visualex_api/services/`**: Scraper services for different legal sources
  - `normattiva_scraper.py`: Scrapes Normattiva (Italian state laws)
  - `eurlex_scraper.py`: Scrapes EUR-Lex (EU regulations/directives)
  - `brocardi_scraper.py`: Scrapes Brocardi.it (legal annotations/commentary)
  - `pdfextractor.py`: Selenium-based PDF extraction using Chrome headless
- **`src/visualex_api/tools/`**: Utility modules
  - `norma.py`: Core data models (`Norma`, `NormaVisitata`)
  - `urngenerator.py`: URN generation for legal documents
  - `treextractor.py`: Extracts article tree structures
  - `text_op.py`: Text parsing and normalization
  - `sys_op.py`: WebDriver management for Selenium
  - `config.py`: Configuration constants (rate limiting, cache size)
  - `map.py`: Act type mappings for EUR-Lex

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

### Backend Setup and Running

```bash
# Create and activate virtual environment
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run main server (UI + root API)
cd src
python app.py
# Server runs at http://localhost:5000

# Run alternative server (API with /api/* prefix + Swagger)
cd src
python -m visualex_api.app
# API at http://localhost:5000/api/*
# Swagger UI at http://localhost:5000/api/docs
```

### Frontend Setup and Running

```bash
# Install dependencies
cd frontend
npm install

# Development server with hot reload
npm run dev
# Runs at http://localhost:5173 (proxies API calls to :5000)

# Build for production
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

### PDF Export Prerequisites

PDF export functionality requires Chrome and ChromeDriver:

```bash
# macOS
brew install chromedriver

# Verify installation
chromedriver --version
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
- **POST `/export_pdf`**: Export document to PDF using Selenium + Chrome headless

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

### Core Classes (src/visualex_api/tools/norma.py)

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
- **History**: Previously searched norms (persisted to localStorage)
- **Bookmarks**: Saved articles for later reference
- **Workspace**: Active tabs with content
- **Settings**: User preferences (API endpoint, theme, etc.)

The store is located in `frontend/src/store/useAppStore.ts` and uses Immer for immutable updates.

## Important Implementation Notes

### Avoiding Code Duplication

Always check for existing utilities before implementing:
- **URN generation**: Use `urngenerator.py` functions
- **Text parsing**: Use `text_op.py` for normalization and parsing
- **Tree extraction**: Use `treextractor.py` for article structures
- **Date handling**: Use `complete_date_or_parse()` and `format_date_to_extended()`

### Rate Limiting

Configured in `src/visualex_api/tools/config.py`:
- Default: 1000 requests per 600 seconds (10 minutes) per IP
- Middleware in `NormaController.rate_limit_middleware()`
- Returns 429 status when limit exceeded

### Scraping Fragility

Web scrapers depend on HTML structure of external sites:
- Normattiva (normattiva.it)
- EUR-Lex (eur-lex.europa.eu)
- Brocardi (brocardi.it)

HTML changes on these sites will break scrapers and require updates to parsing logic.

### Async Patterns

The codebase extensively uses Python's `asyncio`:
- All scraper methods are async (`async def get_document()`, `async def get_info()`)
- Use `asyncio.gather()` for parallel operations
- Use `asyncio.to_thread()` for blocking operations (file I/O, Selenium)
- Quart routes are async by default

### Frontend-Backend Communication

- Development: Vite dev server proxies API calls from `:5173` to `:5000`
- Production: Frontend build should be served by backend or separate static server
- CORS configured for `http://localhost:3000` in backend

## Common Patterns

### Adding a New Scraper

1. Create new scraper class in `src/visualex_api/services/`
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

## Testing and Debugging

### Backend Debugging

- Logs use structlog with ISO timestamps and color output
- Log level: DEBUG (configured in both app.py files)
- Query statistics logged automatically (duration, token count)
- Check ChromeDriver with: `chromedriver --version`

### Frontend Debugging

- React DevTools for component inspection
- Zustand DevTools for state inspection
- Network tab for API call debugging
- Console logs for errors (check browser console)

## File Naming Conventions

- Backend: `snake_case.py`
- Frontend: `PascalCase.tsx` for components, `camelCase.ts` for utilities
- Types: Defined in `frontend/src/types/index.ts`
- CSS: Tailwind utility classes (no separate CSS files)

## Environment Variables

Backend supports:
- `HOST`: Server host (default: `0.0.0.0`)
- `PORT`: Server port (default: `5000`)

No `.env` file required for basic operation. Configuration in `tools/config.py`.
