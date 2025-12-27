# Python API Setup

The Python API is an async web application built with Quart that fetches and processes Italian legal texts from Normattiva, EUR-Lex, and Brocardi.

## Requirements

- **Python 3.10+**
- **Playwright browsers** (for PDF export and EUR-Lex WAF bypass)

## Installation

### 1. Clone and Create Virtual Environment

```bash
cd VisuaLexAPI
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

**Core packages installed:**
| Package | Purpose |
|---------|---------|
| `quart` | Async Flask-like web framework |
| `quart_cors` | CORS middleware for Quart |
| `beautifulsoup4` | HTML parsing for scrapers |
| `requests` | HTTP client with retry logic |
| `aiohttp` | Async HTTP client |
| `aiocache` | Async caching (memory + persistent) |
| `playwright` | Browser automation for PDF export |
| `structlog` | Structured logging |

### 3. Install Playwright Browsers

Required for PDF export and EUR-Lex scraping (which requires JavaScript execution):

```bash
playwright install chromium
```

## Environment Variables

All environment variables are optional and have sensible defaults.

### Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `5000` | Server port |

### HTTP Client Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTP_MAX_CONCURRENCY` | `3` | Max parallel HTTP requests to external sources |
| `HTTP_MIN_INTERVAL` | `0.5` | Minimum interval between requests (seconds) |
| `HTTP_MAX_RETRIES` | `4` | Max retry attempts for failed requests |
| `HTTP_BACKOFF_FACTOR` | `2.0` | Exponential backoff multiplier |
| `HTTP_INITIAL_BACKOFF` | `0.5` | Initial backoff delay (seconds) |
| `HTTP_JITTER` | `0.3` | Random jitter factor for backoff |
| `HTTP_TIMEOUT` | `30` | Request timeout (seconds) |

### Queue Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `FETCH_QUEUE_WORKERS` | `2` | Number of parallel fetch workers |
| `FETCH_QUEUE_DELAY` | `0.3` | Delay between queue items (seconds) |

### Cache Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PERSISTENT_CACHE_TTL` | `86400` | Cache TTL in seconds (24 hours) |

## Running the Server

### Development (Main Server)

```bash
source .venv/bin/activate
python app.py
```

- **Web Interface**: http://localhost:5000
- **API Endpoints**: Available at root paths (e.g., `/fetch_article_text`)

### Alternative Server with Swagger UI

```bash
python -m visualex_api.app
```

- **Swagger Documentation**: http://localhost:5000/api/docs
- **OpenAPI Spec**: http://localhost:5000/api/openapi.json
- **API Endpoints**: Prefixed with `/api/` (e.g., `/api/fetch_article_text`)

### Using the Start Script

The project includes a convenient start script that launches all services:

```bash
./start.sh
```

This starts:
- Python API on port 5000
- Node.js backend on port 3001
- Frontend dev server on port 5173

## Configuration Files

| File | Description |
|------|-------------|
| `visualex_api/tools/config.py` | Environment variable defaults and configuration |
| `data/history.json` | Search history persistence (auto-created) |
| `data/dossiers.json` | Dossier persistence (auto-created) |
| `download/cache/` | Persistent cache directory (auto-created) |

## Rate Limiting

The API includes built-in rate limiting:
- **Default**: 1000 requests per 10 minutes per IP
- Configurable via `RATE_LIMIT` and `RATE_LIMIT_WINDOW` constants in `config.py`
- Returns HTTP 429 when limit exceeded

## Troubleshooting

### Playwright Installation Issues

**Error**: `playwright install` fails or browsers not found

```bash
# Ensure playwright is installed
pip install playwright

# Install with verbose output
playwright install chromium --with-deps

# Check installation
playwright --version
```

### EUR-Lex Access Issues

EUR-Lex uses Web Application Firewall (WAF) protection. The scraper uses Playwright to bypass this:

```bash
# Ensure chromium is installed
playwright install chromium

# Test browser launch
python -c "from playwright.sync_api import sync_playwright; p = sync_playwright().start(); b = p.chromium.launch(); b.close(); p.stop(); print('OK')"
```

### Port Already in Use

```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>
```

### Cache Issues

If you experience stale data:

```bash
# Clear persistent cache
rm -rf download/cache/*

# Clear history
rm data/history.json
```

## Health Checks

Verify the server is running:

```bash
# Basic health check
curl http://localhost:5000/health

# Detailed health check (tests external services)
curl http://localhost:5000/health/detailed

# Version info
curl http://localhost:5000/version
```
