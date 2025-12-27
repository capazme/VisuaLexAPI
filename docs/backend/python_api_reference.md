# Python API Reference

Complete reference for all Python API endpoints. All endpoints accept JSON request bodies and return JSON responses unless otherwise specified.

**Base URLs:**
- Main server: `http://localhost:5000`
- Alternative server: `http://localhost:5000/api` (with Swagger UI at `/api/docs`)

---

## Core Endpoints

### POST `/fetch_norma_data`

Create norm structure from request parameters. This is typically the first step before fetching article text.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `act_type` | string | Yes | Act type (e.g., "codice civile", "legge", "decreto legislativo") |
| `date` | string | No | Date in YYYY-MM-DD format |
| `act_number` | string | No | Act number (e.g., "241" for Law 241/1990) |
| `article` | string | Yes | Single ("2043"), list ("1,2,3"), or range ("1-5") |
| `version` | string | No | "vigente" (current) or "originale" (original) |
| `version_date` | string | No | Historical version date (YYYY-MM-DD) |
| `annex` | string | No | Annex identifier (e.g., "A", "1") |

**Example Request:**
```json
{
  "act_type": "codice civile",
  "article": "2043"
}
```

**Response:**
```json
{
  "norma_data": [
    {
      "tipo_atto": "codice civile",
      "data": "1942-03-16",
      "numero_atto": "262",
      "url": "urn:nir:stato:codice.civile:1942-03-16;262",
      "allegato": null,
      "numero_articolo": "2043",
      "versione": "vigente",
      "data_versione": null,
      "urn": "urn:nir:stato:codice.civile:1942-03-16;262~art2043"
    }
  ]
}
```

**Status Codes:**
- `200`: Success
- `400`: Validation error (invalid act_type, date format, etc.)
- `500`: Server error

---

### POST `/fetch_article_text`

Fetch article text for one or more articles. Automatically selects the appropriate scraper (Normattiva or EUR-Lex) based on act type.

**Request Body:** Same as `/fetch_norma_data`

**Example Request:**
```json
{
  "act_type": "codice civile",
  "article": "2043,2044"
}
```

**Response:**
```json
[
  {
    "article_text": "Qualunque fatto doloso o colposo, che cagiona ad altri un danno ingiusto, obbliga colui che ha commesso il fatto a risarcire il danno.",
    "norma_data": {
      "tipo_atto": "codice civile",
      "data": "1942-03-16",
      "numero_atto": "262",
      "numero_articolo": "2043",
      "urn": "urn:nir:stato:codice.civile:1942-03-16;262~art2043"
    },
    "url": "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art2043"
  },
  {
    "article_text": "Il danno non patrimoniale deve essere risarcito solo nei casi determinati dalla legge.",
    "norma_data": { ... },
    "url": "..."
  }
]
```

**Status Codes:**
- `200`: Success
- `400`: Validation error
- `429`: Rate limit exceeded
- `500`: Scraper or server error

---

### POST `/stream_article_text`

Stream article results as NDJSON (Newline Delimited JSON). Ideal for large requests where you want to display results as they arrive.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `act_type` | string | Yes | Act type |
| `article` | string | Yes | Article(s) to fetch |
| `show_brocardi_info` | boolean | No | Include Brocardi annotations (default: false) |
| *(other fields same as `/fetch_norma_data`)* | | | |

**Response:** `application/x-ndjson`

Each line is a complete JSON object:
```
{"article_text": "...", "norma_data": {...}, "url": "...", "brocardi_info": {...}}
{"article_text": "...", "norma_data": {...}, "url": "...", "brocardi_info": null}
```

**Headers:**
- `Content-Type: application/x-ndjson`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no` (disables nginx buffering)

---

### POST `/fetch_brocardi_info`

Retrieve Brocardi legal annotations (commentary, ratio, case law) for articles. Only available for Italian law sources (Normattiva), not EU sources.

**Request Body:** Same as `/fetch_norma_data`

**Response:**
```json
[
  {
    "norma_data": { ... },
    "brocardi_info": {
      "position": "art. 2043",
      "link": "https://brocardi.it/codice-civile/libro-quarto/titolo-ix/capo-i/art2043.html",
      "Brocardi": "Commentary text from Brocardi...",
      "Ratio": "The underlying principle of this article...",
      "Spiegazione": "Detailed explanation of the article...",
      "Massime": [
        "Cass. civ. n. 12345/2023: Case law summary...",
        {
          "title": "Cass. civ. n. 6789/2022",
          "content": "Structured case law content...",
          "source": "Cassazione civile"
        }
      ],
      "Relazioni": "Related regulations...",
      "RelazioneCostituzione": "Constitutional relevance...",
      "Footnotes": ["[1] Reference note..."],
      "RelatedArticles": ["2044", "2045", "2046"],
      "CrossReferences": ["Art. 1218 c.c.", "Art. 1223 c.c."]
    }
  }
]
```

**Notes:**
- Returns `null` for `brocardi_info` when source is EUR-Lex or when not available
- Brocardi data is scraped from brocardi.it

---

### POST `/fetch_all_data`

Combined endpoint returning both article text and Brocardi annotations in a single request. Uses a rate-limited task queue.

**Request Body:** Same as `/fetch_norma_data`

**Response:**
```json
[
  {
    "article_text": "...",
    "url": "https://...",
    "norma_data": { ... },
    "brocardi_info": { ... },
    "queue_position": 0
  }
]
```

---

### POST `/fetch_tree`

Get the hierarchical article structure (tree) for a complete law. Useful for document navigation.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `urn` | string | Yes | Complete URN (e.g., "urn:nir:stato:codice.civile:1942-03-16;262") |
| `link` | boolean | No | Include article links (default: false) |
| `details` | boolean | No | Include article details (default: false) |
| `return_metadata` | boolean | No | Include annex metadata (default: true) |

**Example Request:**
```json
{
  "urn": "urn:nir:stato:codice.civile:1942-03-16;262",
  "return_metadata": true
}
```

**Response:**
```json
{
  "articles": [
    {
      "number": "1",
      "title": "Capacità giuridica",
      "link": "https://...",
      "children": []
    },
    {
      "number": "2",
      "title": "Maggiore età. Capacità di agire",
      "children": []
    }
  ],
  "count": 2969,
  "metadata": {
    "annexes": [
      {
        "number": null,
        "article_count": 2969,
        "article_numbers": ["1", "2", "3", ...]
      }
    ]
  }
}
```

**Status Codes:**
- `200`: Success
- `400`: Invalid URN format
- `404`: Document not found
- `500`: Server error

---

## History Endpoints

### GET `/history`

Retrieve server-side search history.

**Response:**
```json
{
  "history": [
    {
      "act_type": "codice civile",
      "act_number": "262",
      "article": "2043",
      "date": "1942-03-16",
      "timestamp": "2024-01-15T10:30:45.123456"
    }
  ]
}
```

**Notes:**
- Returns last 50 items
- Persisted to `data/history.json`
- Deduplicates consecutive identical searches

---

### DELETE `/history`

Clear all search history.

**Response:**
```json
{
  "success": true,
  "message": "History cleared"
}
```

---

### DELETE `/history/<timestamp>`

Delete a single history item by timestamp.

**Path Parameters:**
- `timestamp`: ISO timestamp of the item to delete

**Response:**
```json
{
  "success": true
}
```

**Status Codes:**
- `200`: Success
- `404`: Item not found

---

## Dossier Endpoints

Dossiers are research collections for organizing multiple articles.

### GET `/dossiers`

Get all dossiers.

**Response:**
```json
{
  "dossiers": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Civil Liability Research",
      "description": "Articles related to tort law",
      "created_at": "2024-01-15T10:30:45Z",
      "items": [
        {
          "id": "item-uuid",
          "data": { ... },
          "type": "norma",
          "status": "unread",
          "added_at": "2024-01-15T10:35:00Z"
        }
      ]
    }
  ]
}
```

---

### POST `/dossiers`

Create a new dossier.

**Request Body:**
```json
{
  "title": "New Research Project",
  "description": "Optional description"
}
```

**Response:** Created dossier object (HTTP 201)

---

### GET `/dossiers/<dossier_id>`

Get a specific dossier by ID.

**Path Parameters:**
- `dossier_id`: UUID of the dossier

---

### PUT `/dossiers/<dossier_id>`

Update dossier metadata.

**Request Body:**
```json
{
  "title": "Updated Title",
  "description": "Updated description"
}
```

---

### DELETE `/dossiers/<dossier_id>`

Delete a dossier.

---

### POST `/dossiers/<dossier_id>/items`

Add an item to a dossier.

**Request Body:**
```json
{
  "data": { "norma_data": {...}, "article_text": "..." },
  "type": "norma"
}
```

**Response:** Created item with ID (HTTP 201)

---

### DELETE `/dossiers/<dossier_id>/items/<item_id>`

Remove an item from a dossier.

---

### PUT `/dossiers/<dossier_id>/items/<item_id>/status`

Update item read status.

**Request Body:**
```json
{
  "status": "reading"
}
```

**Valid statuses:** `unread`, `reading`, `important`, `done`

---

### POST `/dossiers/import`

Import a dossier from shared data.

**Request Body:** Complete dossier object

---

### PUT `/dossiers/sync`

Sync all dossiers (overwrites server data from frontend).

**Request Body:**
```json
{
  "dossiers": [ ... ]
}
```

**Response:**
```json
{
  "success": true,
  "count": 5
}
```

---

## Export Endpoint

### POST `/export_pdf`

Export a document to PDF using Playwright headless browser.

**Request Body:**
```json
{
  "urn": "urn:nir:stato:codice.civile:1942-03-16;262"
}
```

**Response:** Binary PDF file (`application/pdf`)

**Notes:**
- Caches generated PDFs to `/download/cache/`
- Checks cache before regenerating
- Requires Playwright Chromium installation

---

## Health & Monitoring Endpoints

### GET `/health`

Basic health check. Returns immediately without external calls.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:45Z"
}
```

---

### GET `/health/detailed`

Detailed health check with external service latency measurements.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:45Z",
  "services": {
    "normattiva": {
      "status": "ok",
      "latency_ms": 234.5
    },
    "eurlex": {
      "status": "ok",
      "latency_ms": 456.2
    },
    "brocardi": {
      "status": "ok",
      "latency_ms": 123.1
    }
  }
}
```

**Status Codes:**
- `200`: All services healthy
- `503`: One or more services degraded

---

### GET `/version`

Get application version and git information.

**Response:**
```json
{
  "version": "1.0.0",
  "git": {
    "branch": "main",
    "commit": {
      "hash": "abc1234",
      "hash_full": "abc123456789...",
      "message": "feat: Add new feature",
      "date": "2024-01-15T10:30:45Z",
      "author": "Developer Name"
    }
  },
  "changelog": [
    {
      "hash": "abc1234",
      "message": "feat: Add new feature",
      "date": "2024-01-15T10:30:45Z",
      "author": "Developer Name"
    }
  ]
}
```

**Notes:** Changelog contains last 10 commits.

---

## Data Models

### Norma

Represents a legal norm (law, code, regulation).

```typescript
interface Norma {
  tipo_atto: string;      // e.g., "codice civile", "legge"
  data: string | null;    // YYYY-MM-DD format
  numero_atto: string | null;
  url: string;            // URN (lazy-loaded)
}
```

### NormaVisitata

Represents a specific article within a norm.

```typescript
interface NormaVisitata {
  tipo_atto: string;
  data: string | null;
  numero_atto: string | null;
  url: string;
  numero_articolo: string;
  versione: string | null;        // "vigente" | "originale"
  data_versione: string | null;   // Historical version date
  allegato: string | null;        // Annex identifier
  urn: string;                    // Full URN with article
}
```

### BrocardiInfo

Legal annotations from Brocardi.it.

```typescript
interface BrocardiInfo {
  position: string;
  link: string;
  Brocardi: string | string[];
  Ratio: string | null;
  Spiegazione: string | null;
  Massime: (string | MassimaStructured)[];
  Relazioni: string | null;
  RelazioneCostituzione: string | null;
  Footnotes: string[] | null;
  RelatedArticles: string[] | null;
  CrossReferences: string[] | null;
}
```

---

## Error Responses

All errors return JSON with a consistent structure:

```json
{
  "error": "Error message describing what went wrong"
}
```

**Common Error Codes:**

| Code | Description |
|------|-------------|
| `400` | Validation error (invalid input) |
| `404` | Resource not found |
| `429` | Rate limit exceeded |
| `500` | Internal server error |

---

## Act Type Mappings

Common act types and their internal mappings:

| Input | Internal Type |
|-------|--------------|
| `codice civile`, `c.c.`, `cc` | Codice Civile |
| `codice penale`, `c.p.`, `cp` | Codice Penale |
| `costituzione`, `cost.` | Costituzione |
| `legge`, `l.` | Legge |
| `decreto legislativo`, `d.lgs.`, `dlgs` | Decreto Legislativo |
| `decreto legge`, `d.l.`, `dl` | Decreto Legge |
| `d.p.r.`, `dpr` | Decreto del Presidente della Repubblica |
| `regolamento ue`, `reg. ue` | Regolamento UE (EUR-Lex) |
| `direttiva ue`, `dir. ue` | Direttiva UE (EUR-Lex) |
| `tue` | Trattato sull'Unione Europea |
| `tfue` | Trattato sul Funzionamento dell'UE |
| `cdfue` | Carta dei Diritti Fondamentali |

See `visualex_api/tools/map.py` for complete mappings.
