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

### POST `/fetch_decision`

Read one decision of the Corte di cassazione or of the Corte costituzionale from its
reference: the court, the number and the year a citation gives. The text comes back whole,
never cut. Cassazione decisions come from Italgiure's public archive (SentenzeWeb), Corte
costituzionale decisions from the court's open data. Behind the ingress the route needs a
login like the other scraping routes, and a call costs two points of the user's quota.
Design: `docs/superpowers/specs/2026-10-01-sentenze-design.md`.

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `corte` | string | Yes | `cassazione` or `corte_costituzionale` |
| `numero` | integer | Yes | The decision's number, 1 to 999999 (a string of digits is accepted) |
| `anno` | integer | Yes | The year of the number, from 1900 (1956 for the Corte costituzionale) to the current year. For a penal decision of the Cassazione it is the year of deposit |
| `archivio` | string | No | `civile` or `penale` (Cassazione only). Without it both archives are read |
| `sezione` | string | No | The section the citation names, a hint and never part of the identity (Cassazione only): `1`-`7` or `I`-`VII`, `SU`, `U` or `unite` (Sezioni Unite), `L` (lavoro), `F` (feriale), `T` (tributaria: civil section 5, and it implies `archivio` `civile` when none is given), in any case and with or without dots (`S.U.`). A form that is not recognised is ignored, with a notice |

**Example Request:**
```json
{
  "corte": "cassazione",
  "numero": 10787,
  "anno": 2024,
  "archivio": "civile"
}
```

**Response:** always JSON with `esito`. Unlike the other endpoints, a failure is an `esito`
body too, not `{"error": ...}`.

| `esito` | Status | Content |
|---------|--------|---------|
| `trovata` | 200 | `identita`, `attributi`, `testo`, `fonte`, `avvisi` |
| `ambigua` | 200 | `candidati`: the identity and attributes of each decision found |
| `non_trovata` | 404 | `motivo`, `archivio_dal` when known, `suggerimento` when found |
| `fonte_non_raggiungibile` | 503 | `fonte`: `cassazione` or `corte_costituzionale` |
| `richiesta_non_valida` | 400 | `errori`: each bad field, with what was expected |

**`trovata`** carries:
- `identita`: `{corte, numero, anno, archivio?}`, what VisuaLex resolved. `archivio` is always
  there for the Cassazione. Its key is `cassazione:<archivio>:<numero>:<anno>` or
  `corte_costituzionale:<numero>:<anno>`.
- `attributi`: the particulars the source has, and only those: `sezione`, `tipo` (sentenza,
  ordinanza, ordinanza interlocutoria, decreto), `data_deposito` and `data_decisione` (ISO
  dates; the second for the Corte costituzionale), `ecli` (Corte costituzionale), `relatore`,
  `presidente`, `materia`.
- `testo`: the blocks the source gives, each whole: `epigrafe` (Corte costituzionale),
  `motivazione`, `dispositivo` (a block the source leaves empty is absent). It is `{}` when
  the source withholds the text (notice `testo_non_disponibile`).
- `fonte`: `nome`; `licenza` (Corte costituzionale: CC BY-SA 3.0, credited wherever the text
  appears); `url` (Corte costituzionale only: the court's page for that decision, for the
  reader's browser, which this server never contacts). The Cassazione has no `url`.
- `avvisi`: the notices below.

**Example answers.** The particulars come from the tests; the text blocks and the names are
elided with `…`.

`trovata`, Cassazione:
```json
{
  "esito": "trovata",
  "identita": {"corte": "cassazione", "numero": 10787, "anno": 2024, "archivio": "civile"},
  "attributi": {"sezione": "3", "tipo": "sentenza"},
  "testo": {"motivazione": "…"},
  "fonte": {"nome": "Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)"},
  "avvisi": []
}
```

`trovata`, Corte costituzionale (`{"corte": "corte_costituzionale", "numero": 1, "anno": 2014}`):
```json
{
  "esito": "trovata",
  "identita": {"corte": "corte_costituzionale", "numero": 1, "anno": 2014},
  "attributi": {
    "tipo": "sentenza",
    "data_deposito": "2014-01-13",
    "data_decisione": "2013-12-04",
    "ecli": "ECLI:IT:COST:2014:1",
    "relatore": "…",
    "presidente": "…"
  },
  "testo": {"epigrafe": "…", "motivazione": "…", "dispositivo": "…"},
  "fonte": {
    "nome": "Corte costituzionale — dati aperti",
    "licenza": "CC BY-SA 3.0",
    "url": "https://www.cortecostituzionale.it/scheda-pronuncia/2014/1"
  },
  "avvisi": []
}
```

`trovata` without its text:
```json
{
  "esito": "trovata",
  "identita": {"corte": "cassazione", "numero": 10787, "anno": 2024, "archivio": "civile"},
  "attributi": {"sezione": "3", "tipo": "ordinanza"},
  "testo": {},
  "fonte": {"nome": "Corte di cassazione — archivio pubblico SentenzeWeb (Italgiure)"},
  "avvisi": [{"tipo": "testo_non_disponibile"}]
}
```

`ambigua`, when both archives hold the number and the section does not pick exactly one
(`{"corte": "cassazione", "numero": 10787, "anno": 2024}`):
```json
{
  "esito": "ambigua",
  "candidati": [
    {
      "identita": {"corte": "cassazione", "numero": 10787, "anno": 2024, "archivio": "civile"},
      "attributi": {"sezione": "3", "tipo": "sentenza"}
    },
    {
      "identita": {"corte": "cassazione", "numero": 10787, "anno": 2024, "archivio": "penale"},
      "attributi": {"sezione": "7", "tipo": "sentenza"}
    }
  ]
}
```

`non_trovata` (`{"corte": "cassazione", "numero": 1, "anno": 2019, "archivio": "civile"}`):
```json
{
  "esito": "non_trovata",
  "motivo": "fuori_archivio",
  "archivio_dal": "2021-02-17"
}
```

`non_trovata` with a suggestion (`{"corte": "cassazione", "numero": 1399, "anno": 2023, "archivio": "penale"}`):
```json
{
  "esito": "non_trovata",
  "motivo": "inesistente",
  "suggerimento": {"corte": "cassazione", "numero": 1399, "anno": 2024, "archivio": "penale"}
}
```

`fonte_non_raggiungibile`:
```json
{
  "esito": "fonte_non_raggiungibile",
  "fonte": "cassazione"
}
```

`richiesta_non_valida` (`{"corte": "tar", "numero": 1, "anno": 2024}`):
```json
{
  "esito": "richiesta_non_valida",
  "errori": {"corte": "atteso cassazione o corte_costituzionale"}
}
```
A body that is not a JSON object answers `{"body": "atteso un oggetto JSON"}` in `errori`.

**`motivo`** of a `non_trovata`:
- `inesistente`: the archive covers that year and holds no such number.
- `fuori_archivio`: the year is before the start of Italgiure's public archive, a moving
  window; `archivio_dal`, when known, is the day it starts.
- `anno_parziale`: the first year of that archive, which is only partly covered;
  `archivio_dal`, when known, is the day it starts.

`suggerimento` is the identity of a penal decision with the same number in the next year
(a penal number belongs to the year of deposit, so a December hearing is numbered in
January). It is offered, never followed: a different year may be a different decision.

**Notices (`avvisi`)**, one entry per notice, each with its `tipo`:
- `sezione_diversa`: the section cited is not the decision's; the decision is returned all the
  same (`citata`, `effettiva`).
- `archivio_dedotto`: no archive was given, both held the number, and the section picked one
  (`archivio`, `sezione`).
- `sezione_non_riconosciuta`: the section is in none of the accepted forms and was ignored
  (`citata`).
- `testo_non_disponibile`: the source withholds the text while it removes personal data;
  `testo` is `{}`. The source's own notice is never passed on as the text.

**Caches.** Each archive lookup is cached on its own and the answer is composed from them, so a
homonym deposited later in the other archive is never hidden:

| Lookup result | Kept for |
|---------------|----------|
| found | 30 days |
| not found | 1 hour |
| found without its text | 24 hours |
| error | never |

A Corte costituzionale range bundle is kept on disk: 30 days for a closed range, 24 hours for
the one that holds the current year.

**Status Codes:**
- `200`: `trovata` or `ambigua`
- `400`: `richiesta_non_valida`
- `404`: `non_trovata`
- `503`: `fonte_non_raggiungibile`. A source that cannot be reached is never reported as
  `non_trovata`

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
      "message": "feat(reading): Add new feature",
      "summary": "Add new feature",
      "type": "feat",
      "scope": "reading",
      "date": "2024-01-15T10:30:45Z",
      "author": "Developer Name"
    }
  ]
}
```

**Notes:** The changelog is what landed in the current version, read from the
first-parent log so each entry is a branch that landed rather than a development
step. `services/visualex/visualex_api/tools/changelog.py` drops reverted work (a revert cancels
the merge it undid, and with it everything that merge brought in), housekeeping
types (`build/chore/ci/docs/refactor/style/test`) and toolchain scopes, then
caps the list at 20 entries. `message` is the raw commit subject; `summary`,
`type` and `scope` are its parsed parts, `type` and `scope` null when the
subject carries no conventional prefix.

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

See `services/visualex/visualex_api/tools/map.py` for complete mappings.
