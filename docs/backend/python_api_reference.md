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
login like the other scraping routes, and a call costs two points of the user's quota,
whatever it sends upstream.
A Cassazione lookup sends a Solr `POST` per query (no homepage first: it timed out 20-25 s about
one time in two on 2026-10-07, while a cold select answers in about 1.2 s and sets the session
cookie itself; after an answer that is not JSON the reader fetches the homepage once and asks
again once), and one `GET` for the
court's PDF per decision found (the text is read from it; without it the archive's text field
stands, with the notice `testo_da_archivio`), at most 10 requests in all: a reference without the archive queries both archives (2), a miss adds the query for
each archive's start, once a day (2), and, for the penal archive, the next year's lookup (1).
A later miss the same day sends at most 3, a hit in a named archive 2 (the suggestion of the
penal next year reads the record only, no PDF); retries of a failed
request come on top. A Corte costituzionale call makes at most one
download, shared by concurrent callers.
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
  "archivio": "penale"
}
```

**Response:** every answer the handler writes is JSON with `esito`. Unlike the other
endpoints, a failure is an `esito` body too, not `{"error": ...}`. Answers the handler does
not write are not: the per-IP rate limit answers 429 `{"error": ...}` and, behind the
ingress, the login gate's 401 or 429 come back as the gate gives them, both before the
handler runs; and the framework answers with its own error page a method other than POST or
OPTIONS (405), a body that stalls (408) and a body over 16 MB (413; behind the ingress the
limit is 1 MB, and the ingress's own page answers).

| `esito` | Status | Content |
|---------|--------|---------|
| `trovata` | 200 | `identita`, `attributi`, `testo`, `fonte`, `avvisi` |
| `ambigua` | 200 | `candidati`: the identity and attributes of each decision found |
| `non_trovata` | 404 | `motivo`, `archivio_dal` when known, `suggerimento` when found |
| `fonte_non_raggiungibile` | 503 | `fonte`: `cassazione` or `corte_costituzionale` |
| `richiesta_non_valida` | 400 | `errori`: each bad field, with what was expected |
| `errore_interno` | 500 | nothing else: an unexpected failure, whose details stay in the log |

**`trovata`** carries:
- `identita`: `{corte, numero, anno, archivio?}`, what VisuaLex resolved. `archivio` is always
  there for the Cassazione. Its key is `cassazione:<archivio>:<numero>:<anno>` or
  `corte_costituzionale:<numero>:<anno>`.
- `attributi`: the particulars the source has, and only those: `sezione`, `tipo` (sentenza,
  ordinanza, ordinanza interlocutoria, decreto), `data_deposito` and `data_decisione` (ISO
  dates; the second for the Corte costituzionale), `ecli` (Corte costituzionale), `relatore`,
  `presidente`, `materia`; and `testo_assente`, why there is no text, present only when the
  source said why (the source withholds the text while it removes personal data): `oscuramento`
  (it answers that the text is in the process of being obscured) or `valutazione_oscuramento`
  (it answers that the obscuring is being evaluated).
- `testo`: the whole text, never cut, in blocks: `epigrafe` (Corte costituzionale),
  `motivazione`, `dispositivo` (a block left empty is absent). It is `{}` when the decision
  comes without its text (notice `testo_non_disponibile`). The Cassazione's blocks are the
  source's. When the Corte costituzionale's open data leave their `testo` field empty (3,592 of
  4,056 ordinanze, 2001–2026), the reasoning is inside the epigrafe, and the reader splits it at
  the first line whose first word is "Ritenuto" or "Considerato", in any case, searched after
  "ha pronunciato la seguente" when the epigrafe has it (3,577 of those 3,592): what comes
  before is `epigrafe`, the rest `motivazione`, and only the whitespace at the boundary is
  dropped. Without such a line nothing is split, and the reasoning stays in `epigrafe`.
  Italgiure gives a Cassazione block as one line (45 of 45 texts measured on 2026-10-04, up to
  82,322 characters), so the reader restores its paragraphs by inserting a blank line (`\n\n`)
  before each heading («FATTI DI CAUSA», «RAGIONI DELLA DECISIONE», «RITENUTO IN FATTO» … in
  capitals; «Rilevato che:», «Considerato che,» … in mixed case), before «P.Q.M.» and before
  each numbered point that starts a sentence («1.», «2.1.», «3 -»), and changes nothing else:
  every character is the source's. A combined heading («RITENUTO IN FATTO E CONSIDERATO IN
  DIRITTO») gets one break, before its first word, and a numbered point keeps the words it
  opens: there is no break between «3.» and a «P.Q.M.», lead or heading right after it.
  Italgiure's reasons already end with the dispositivo, which its separate field repeats (36 of
  the 36 sampled texts that have one): the reader cuts it off the end of the reasons, so
  `dispositivo` is the end of the text itself (the same characters, whitespace aside) and the
  decision reads once; a dispositivo that the text holds elsewhere is dropped, and one it does
  not hold stays as the source gave it. The Corte costituzionale's open data break lines two
  ways (a paragraph or a heading per line since about 2001; before, a typewriter wrap at a
  measure of at most 80 characters, a paragraph ending where a line stops short), so the reader
  turns a line break into a paragraph break (a blank line) unless it is such a wrap, in each
  block and after the epigrafe split, and adds nothing else.
- `fonte`: `nome`; `licenza` (Corte costituzionale: CC BY-SA 3.0, credited wherever the text
  appears); `url` (Corte costituzionale only: the court's page for that decision, for the
  reader's browser, which this server never contacts). The Cassazione has no `url`.
- `avvisi`: the notices below.

**Example answers.** The particulars are those of three recorded decisions (Cass. civ.
10787/2024, Cass. pen. 10787/2024, Corte cost. 1/2014); the text blocks, the subject matter
and the magistrates' names are elided with `…`.

`trovata`, Cassazione (the request above):
```json
{
  "esito": "trovata",
  "identita": {"corte": "cassazione", "numero": 10787, "anno": 2024, "archivio": "penale"},
  "attributi": {
    "sezione": "7",
    "tipo": "ordinanza",
    "data_deposito": "2024-03-14",
    "relatore": "…",
    "presidente": "…"
  },
  "testo": {"motivazione": "…", "dispositivo": "…"},
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

`trovata` without its text (Cass. civ. 10787/2024, `"archivio": "civile"`, as recorded on
2026-10-02, while Italgiure withheld its text):
```json
{
  "esito": "trovata",
  "identita": {"corte": "cassazione", "numero": 10787, "anno": 2024, "archivio": "civile"},
  "attributi": {
    "sezione": "3",
    "tipo": "ordinanza",
    "data_deposito": "2024-04-22",
    "relatore": "…",
    "presidente": "…",
    "materia": "…",
    "testo_assente": "oscuramento"
  },
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
      "attributi": {
        "sezione": "3",
        "tipo": "ordinanza",
        "data_deposito": "2024-04-22",
        "relatore": "…",
        "presidente": "…",
        "materia": "…",
        "testo_assente": "oscuramento"
      }
    },
    {
      "identita": {"corte": "cassazione", "numero": 10787, "anno": 2024, "archivio": "penale"},
      "attributi": {
        "sezione": "7",
        "tipo": "ordinanza",
        "data_deposito": "2024-03-14",
        "relatore": "…",
        "presidente": "…"
      }
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

`errore_interno`, an unexpected failure (a bug, never the caller's or a source's fault). The
body is fixed and carries no detail: that stays in the server's log:
```json
{
  "esito": "errore_interno"
}
```

**`motivo`** of a `non_trovata`:
- `inesistente`: the archive covers that year and holds no such number. For the Corte
  costituzionale the open data can lag up to about 48 hours (the court regenerates them daily,
  and the copy on disk is kept 24 hours): a decision deposited in the last two days may not be
  there yet. It is never said from a copy that could not be refreshed: such a copy may have
  been written before the decision was deposited, so a number it does not hold is a
  `fonte_non_raggiungibile`.
- `fuori_archivio`: the year is before the start of Italgiure's public archive, a moving
  window; `archivio_dal`, when known, is the day it starts.
- `anno_parziale`: the first year of that archive, which is only partly covered;
  `archivio_dal`, when known, is the day it starts.

`suggerimento` is the identity (`{corte, numero, anno, archivio}`) of a penal decision with
the same number in the next year (a penal number belongs to the year of deposit, so a
December hearing is numbered in January). It is offered, never followed: a different year
may be a different decision.

**Notices (`avvisi`)**, one entry per notice, each with its `tipo`:
- `sezione_diversa`: the section cited is not the decision's; the decision is returned all the
  same (`citata`, optional; `effettiva`).
- `archivio_dedotto`: no archive was given, both held the number, and the section picked one
  (`archivio`, `sezione`).
- `sezione_non_riconosciuta`: the section is in none of the accepted forms and was ignored
  (`citata`, optional).
- `testo_non_disponibile`: the decision comes without its text; `testo` is `{}`. The reason,
  when the source gives one, is in `attributi.testo_assente`: `oscuramento` when the source
  answers that the text is in the process of being obscured, `valutazione_oscuramento` when it
  answers that the obscuring is being evaluated (both withhold the text while it removes
  personal data, and the source's own notice is never passed on as the text: a text of at most
  300 characters that mentions «oscuramento» is never the court's). Without it, the source said
  nothing about why: a rare stub such as «Oscuramento disposto Numero registro generale …» is
  withheld the same way, with no cause.

`citata` is the section as the caller wrote it, and it is present only when that is a short
plain form: at most 20 characters, all of them letters, digits, `_`, spaces, `.`, `-` or `/`.
Anything else is left out, so that a crafted address cannot put its own text into a notice.

**Caches.** Each archive lookup is cached on its own and the answer is composed from them, so a
homonym deposited later in the other archive is never hidden:

| Lookup result | Kept for |
|---------------|----------|
| found | 30 days |
| not found | 1 hour |
| found without its text | 24 hours |
| error | never |

Expired entries are deleted at start and every six hours, not only when their key is read
again.

A Corte costituzionale range bundle is kept on disk: 30 days for a closed range, 24 hours for
the one that holds the current year. When a refresh fails, the copy on disk still confirms a
decision it holds for a year before the current one, however old. A number it does not hold
is answered `fonte_non_raggiungibile` (503): it cannot be verified, since the copy may have
been written before that decision was deposited, so it is never `non_trovata`. The current
year is never read from a copy that could not be refreshed (`fonte_non_raggiungibile`).

**Status Codes:**
- `200`: `trovata` or `ambigua`
- `400`: `richiesta_non_valida`
- `404`: `non_trovata`
- `500`: `errore_interno`, an unexpected failure: the body is fixed and carries no detail
- `503`: `fonte_non_raggiungibile`. A source that cannot be reached is never reported as
  `non_trovata`

---

### POST `/search_decisions`

The Cassazione decisions that cite an article (through the archive's index) or mention an
article or a topic (in the text). Italgiure only, the last five years; the Corte costituzionale
is not searched. Behind the ingress the route needs a login like the other scraping routes.
A call sends one Solr `POST` (rows fixed at 20) and, for an uncached archive start, one more.
A page is cached for 24 hours per query and page. Design:
`docs/superpowers/specs/2026-10-05-norms-decisions-search-design.md` §5.

**Request Body:** at least one of `norma` and `tema`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `norma` | object | One of the two | The article, as the `/fetch_*` routes take it: `tipo_atto`, `numero_articolo`, and `numero_atto` and `data` for a numbered act |
| `tema` | string | One of the two | A topic, searched as a phrase in the text (at most 80 characters kept) |
| `archivio` | string | No | `civile` or `penale`. Without it, the article's own archive (codes and the Constitution), else both |
| `pagina` | integer | No | 1 to 10, default 1 |
| `modo` | string | No | `indice` (default for an article) or `testo`. The index serves the codes and the Constitution; for any other act, or an article suffix it does not know, the text is searched and the answer says `modo: "testo"` |

| `esito` | Status | Content |
|---------|--------|---------|
| `risultati` | 200 | `totale`, `pagina`, `modo`, `archivio`, `archivio_dal` (first deposit of the archive, `null` without an archive), `decisioni` |
| `non_supportata` | 200 | nothing else: an act the search cannot phrase |
| `richiesta_non_valida` | 400 | `errori`: each bad field, with what was expected |
| `fonte_non_raggiungibile` | 503 | `fonte`: `cassazione`. A source that does not answer is never an empty page |
| `errore_interno` | 500 | nothing else: an unexpected failure, whose details stay in the log |

Each item of `decisioni` is `{identita, attributi, trovata, frammento}`: the identity and
particulars as in `/fetch_decision`, `trovata` (`indice` or `testo`: how the decision was
found) and `frammento`, `{testo, evidenziati}` or `null`, a plain-text excerpt with the
ranges `[start, end]` to emphasise; the client never receives the source's markup. **Offsets
count Python code points**: JavaScript counts UTF-16 units, so the client converts them for
characters outside the BMP. With `modo: "indice"`, `totale` is the index's count; the false
matches of that index (parallel `rnc-*` fields) were measured at 2.0 %, and the reader drops
those it can recognise on the page.

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

Every error a handler gives is JSON with this structure, except `/fetch_decision`'s and `/search_decisions`', which carry `esito` (see their sections):

```json
{
  "error": "Error message describing what went wrong"
}
```

Some answers are not a handler's: the per-IP rate limit answers 429 with the structure above on every route, `/fetch_decision` too, and behind the ingress the login gate's 401 or 429 come back as the gate gives them, both before the handler runs; the framework's own error pages answer a method a route does not take (405), a body that stalls (408) and a body over 16 MB (413; 1 MB behind the ingress, whose own page answers).

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
