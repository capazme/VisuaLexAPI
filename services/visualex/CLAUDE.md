# Python API — services/visualex

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

### Python API (`services/visualex`)

- **`app.py`** (this folder): main server, UI + API. **`services/visualex/visualex_api/app.py`**:
  alternative server with `/api/*` prefix and Swagger.
- **`services/`** — `normattiva_scraper.py`, `eurlex_scraper.py`,
  `brocardi_scraper.py` (annotations), `pdfextractor.py` (Playwright pool),
  `http_client.py` (the shared throttled aiohttp client — TLS verification on).
  - `brocardi_scraper.py` also emits `Glossario` (links to Brocardi's legal
    dictionary, `{termine, url, dizionario_id}`). Any new `brocardi_info` key
    must be whitelisted in **all three** wire literals in `app.py` (this folder)
    (`stream_article_text`, `fetch_brocardi_info`, `fetch_all_data`) — a key
    missing from any one of them never reaches the frontend.
  - `akn_parser.py` / `akn_fetch.py` — Normattiva's Akoma Ntoso export.
    **Structure and fallback only, never the display text**: the export
    transliterates every accent ("attivita'", "e'"), and `article_text` is the
    offset space every stored highlight and note is anchored to. Used to answer
    "does this article exist" when the HTML tree is unusable
    (`fetch_act_index`), and as a last-resort article text when HTML extraction
    fails outright (`fetch_act_article`, from `NormattivaScraper.get_document`).
    Only the article INDEX is cached — in memory, capped at
    `AKN_CACHE_MAX_ACTS`, and through the shared cache manager, with an
    in-flight registry so N concurrent cold requests download the act once.
    Article texts are never cached. `ParsedPart.dates` carries each article's
    FRBRWork date (component acts only), and `AktIndex.fingerprints` a sha256
    per article — both are metadata about the text, not the text. The hash
    is of the RENDERED AKN text (the markdown `akn_parser` produces,
    AGGIORNAMENTO blocks included), so a renderer change moves every hash — a
    harmless full refetch. The top-level map covers the dominant part only;
    an annex such as the preleggi or the disposizioni di attuazione must be
    read from `parts_fingerprints` (served as `parts` by
    `/fetch_act_fingerprints`), which is kept apart from `parts_detail` so
    the hashes do not ride along on every `/fetch_rubriche` answer. With
    the fingerprints a codice's in-memory index is a few hundred KB.
    `AKN_ENABLED=false` disables the whole path and is read at call time.
    `normalize_article_key` in `akn_parser.py` is the pure canonicaliser for
    article numbers and needs no network.
- **`tools/`**:
  - `norma.py` — core models `Norma` / `NormaVisitata` (both with
    `to_dict()`/`from_dict()`; `NormaVisitata` implements hash/equality and is
    the primary container across the API)
  - `urngenerator.py` — URN generation · `treextractor.py` — article trees
  - `text_op.py` — text parsing **and** date handling (see Date System)
  - `article_suffixes.py` — the ordinal table (`bis` … `vicies`) every
    article-number regex reads, longest-first so a short entry cannot claim the
    head of a longer one. A leaf module, imported by `nl_parser`,
    `citation_linker`, `alias_resolver` and `services/akn_parser`; mirrored by
    `apps/web/src/utils/articleSuffixes.ts`. Nine private copies each stopped at
    `decies`, so "art. 25-terdecies" resolved to art. 25-ter — an article that
    exists, which is why nothing looked broken
  - `browser_manager.py` — `PlaywrightManager` singleton (browser pooling)
  - `config.py` — rate limiting, cache size, Redis (`REDIS_ENABLED`, `REDIS_URL`)
  - `map.py` — act-type mappings, plus the act tables the resolver reads
    (`ATTI_NOTI` 64 aliases, `ATTI_DENOMINATI` 202 aliases over 81 acts, built
    from the reviewable `_ATTI_DENOMINATI_SPEC` rows) and `codice_urn(name)`,
    the **case-insensitive** lookup into `NORMATTIVA_URN_CODICI` — six keys
    carry capitals ("codice del Terzo settore"), so a bare `in` test missed
    them and those codici lost their default annex
  - `map.py` also holds `BROCARDI_CODICI` (label → page, one row per source at
    brocardi.it/fonti.html) and `find_brocardi_url(tipo, numero, data)`, which
    `brocardi_scraper.do_know` asks. The lookup is **by identity**: every label
    embeds the act's extremes ("Statuto dei lavoratori(L. 20 maggio 1970, n.
    300)"), `parse_brocardi_estremi()` reads them once into (tipo esteso, anno,
    numero), and a norma matches only its own triple — the year is what tells
    D.lgs. 81/2008 from D.lgs. 81/2015, so without one the number must be unique
    for that tipo. Only the labels without extremes (Costituzione, Preleggi,
    CCNL) match by name, and they win: Preleggi share the codice civile's R.D.
    262/1942. Codici go through the extremes of their Normattiva URN, which is
    how "codice in materia di protezione dei dati personali" reaches the page
    Brocardi calls "Codice della privacy". **Never match a label as a
    substring**: `do_know` used to look for "D.lgs. 2001-06-08, n. 231" inside
    "(D.lgs. 8 giugno 2001, n. 231)", so no act outside the codici ever got its
    dottrina and massime (69 of 100 sources). An act that is not on Brocardi
    returns `None`, never the nearest label.
  - `act_resolver.py` — `resolve_atto(name)` maps an act named the way a lawyer
    writes it ("statuto dei lavoratori", "TUSL", "del D.Lgs. 231/2001") to
    `{tipo_atto, data, numero_atto}`, over the `ATTI_NOTI` / `ATTI_DENOMINATI`
    tables in `map.py`. It **never guesses**: an unrecognised name returns `None`
    and `suggest_acts()` offers near misses. Chained after the exact-match paths
    in `alias_resolver` and `nl_parser`, so nothing that resolved before changes.
  - `egress.py` — `ALLOWED_HOSTS` plus `is_allowed(url)`, checked in
    `ThrottledHttpClient.request`. `tests/test_egress_allowlist.py` fails the
    build when a URL literal names an undeclared host. The runtime check covers
    the shared HTTP client only — `SECURITY.md` lists the three paths it does
    not cover (treextractor's own session, Playwright, redirect targets).
  - `nl_parser.py` — natural-language query parser ("art. 3 cc" → params),
    exposed at `POST /parse_query`
  - `alias_resolver.py` + `preset_aliases.yaml` — preset aliases (`gdpr` →
    Regolamento UE 2016/679); runs before the NL parser
  - `citation_linker.py` — citation detection in article text, emits
    `{start, end, display_text, article, act_type, date, act_number}`; exposed at
    `POST /extract_citations`. EU acts ("regolamento (UE) 2016/679, art. 5",
    "art. 5 del regolamento (UE) 2016/679", "direttiva 2002/58/CE") go
    through `nl_parser`'s shared pattern, with the marker mandatory for
    regulations — a bare "regolamento n. 5/2020" in a text is a national
    one. A bare "art. 7" after a numbered act inherits its number and year,
    not only its type
  - `circuit_breaker.py` — per-source breaker. **State is in-memory
    per-instance** — single-instance deployment only. Status at
    `GET /api/circuit-breakers`
  - `redis_cache.py` + `cache_manager.py` — Redis cache with automatic
    filesystem fallback; startup warns when Redis is disabled or missing

## Key API Endpoints

POST unless noted, JSON bodies.

- `/fetch_norma_data` — build norm structure from params
- `/fetch_article_text` — fetch article text (array response)
- `/stream_article_text` — stream results as NDJSON, one object per line
- `/fetch_brocardi_info` — Brocardi annotations (position, ratio, spiegazione, massime)
- `/fetch_all_data` — article text + Brocardi in one call
- `/fetch_tree` — article tree for a complete URN
- `/parse_query`, `/extract_citations` — NL parsing and citation detection
- `/fetch_rubriche` — article titles and repealed articles for an act, from the
  AKN index. Structure only: it never carries the display text
- `/fetch_recitals` — every considerando of an EU act (`regolamento ue` /
  `direttiva ue`) in one call: `{recitals: [{number, text}], count, url}`.
  Reads the OJ page the tree already uses; a consolidated text has no
  preamble and answers an empty list. Normattiva acts get a 400
- `/fetch_act_fingerprints` — `{urn}` → a sha256 per article of the act's
  AKN text plus, for the codici, the FRBRWork date of each article (the day
  its current text came into force). `urn` is the act's full URL as
  `norma_data.url` gives it (`https://www.normattiva.it/uri-res/N2Ls?urn:nir:…`),
  not a bare `urn:nir:` string; an article suffix (`~art2`) is stripped. A
  change detector, never the text: a client refetches only the articles
  whose hash moved. `available: false` with empty maps when there is no AKN
  index, or an index without fingerprints — the caller must then refetch
  everything, not conclude nothing changed
- `GET /fetch_alias_catalog` — the presets we ship plus the act names the
  resolver already understands. The only GET among these; a POST answers 405
- `/export_pdf` — PDF via Playwright (rejects non-Normattiva URNs — SSRF guard)
- `GET /history` — server-side search history
- `GET /health/detailed` — probes Normattiva, EUR-Lex and Brocardi **for
  real**, on the shared client and circuit breakers. One result is cached
  for `HEALTH_DETAILED_TTL` seconds (120) behind an `asyncio.Lock`, so N
  concurrent cold callers run one probe; the body carries `cached` and the
  status stays 503 while a source fails. Never wire it to a tight loop

Root `app.py` maps failures through `_error_response`, so the status now carries
meaning: `ValidationError` → 400 (missing `act_type`/`article`, malformed article
input), `ResourceNotFoundError` → 404 (the article is not in the act),
`RateLimitExceededError` → 429, everything else 500. Before, every failure was a
500 — and `stream_article_text` raised through to Quart and answered an HTML
error page instead of NDJSON.

```json
{
  "act_type": "codice civile",
  "date": "1990-08-07",         // optional
  "act_number": "241",           // optional
  "article": "2043",             // required: single, list "1,2", or range "3-5"
  "version": "vigente",          // optional: "vigente" | "originale"
  "version_date": "2024-01-15",  // optional
  "annex": "A",                  // optional (allegato)
  "celex_consolidated": "02002L0058-20091219"  // optional, EU acts only: serve this consolidated version
}
```

Request fields are `act_type/act_number/date`; the `norma_data` in responses uses
`tipo_atto/numero_atto/data`. The mismatch is real — map, don't assume.

## Date System

Two complementary paths, chosen by whether you need speed or truth.

**Backend** (`services/visualex/visualex_api/tools/text_op.py`):
- `complete_date_or_parse(date_str)` — **sync, fast, approximate**. Year-only
  dates become `YYYY-01-01`. Used by `urngenerator.py` so URN generation never
  blocks on a lookup.
- `complete_date_or_parse_async(date_str)` — **async, slow, accurate**. Drives
  Playwright to read the real publication date from Normattiva, memoised in
  `_date_cache`. Used where the date is displayed or compared.
- `complete_date()` — the low-level Playwright call behind the async wrapper.

**Frontend** (`apps/web/src/utils/dateUtils.ts`):
- `parseItalianDate(dateStr)` — parses while preserving the original precision.
- `formatDateItalianLong(date)` — "7 agosto 1990". Use this for every displayed
  date; never `toLocaleDateString()`.

**The principle**: synthetic `YYYY-01-01` exists for URNs only. The UI shows the
precision the backend actually has — a year-only entry displays as a year, and
that is correct, not a bug to normalise away.

If date completion feels slow, you are probably calling the async variant in a
loop; if a browser timeout appears, the async wrapper catches it and falls back
to the cached or synthetic value.

## Scraping Architecture

1. **Routing**: `NormaController.get_scraper_for_norma()` picks the source —
   EUR-Lex for TUE/TFUE/CDFUE/Regolamento UE/Direttiva UE, Normattiva for Italian
   state law, Brocardi for annotations on Normattiva sources.
   EU acts come from the Official Journal page unless the request names a
   `celex_consolidated` (sector-0 CELEX, `02002L0058-20091219`): then the
   tree, rubriche and article text are read from that consolidated page,
   whose markup is different (`title-article-norm`, `modref` markers) and
   handled by its own branch in `eurlex_scraper.py` / `treextractor.py`.
   Consolidated texts carry no preamble — recitals always come from the OJ
   page of the base act.
2. **Parallel fetching** via `asyncio.gather()`.
3. **Streaming**: `/stream_article_text` uses a Quart `Response` generator.
4. **Browsers**: always through the `PlaywrightManager` singleton.

Scrapers parse third-party HTML. When one breaks, the site changed — expect to
update selectors, not logic.

### Async rules (Python)

Every scraper method is async (`get_document()`, `get_info()`). Quart routes are
async by default. Never block the loop: wrap blocking I/O in
`asyncio.to_thread()`. Playwright is async throughout — `WebDriverManager` is a
deprecated alias of `PlaywrightManager`; Selenium is gone.

Errors use the hierarchy in `services/visualex/visualex_api/tools/exceptions.py`
(`ValidationError`, `ResourceNotFoundError`, `RateLimitExceededError`), surfaced
by `NormaController.handle_error()`. Logging is structlog.

## Shared utilities — check before writing a new one

Duplicating any of these is a defect, not a shortcut.

**Python**: `urngenerator.py` (URNs) · `text_op.py` (text parsing + dates) ·
`treextractor.py` (trees) · `PlaywrightManager` (browsers) ·
`article_suffixes.py` (the ordinal suffix table).

## Common Patterns

**New scraper** — add the class in `services/`, implement async
`get_document(normavisitata) -> Tuple[str, str]`, register the act type in
`NormaController.get_scraper_for_norma()`, extend `tools/map.py` if needed.

**New API endpoint** — route in `NormaController._setup_routes()`, async handler,
`await request.get_json()`, return `jsonify()`, log with structlog.

**Playwright work** —

```python
from visualex_api.tools.browser_manager import PlaywrightManager

manager = PlaywrightManager()
browser = await manager.get_browser()
page = await browser.new_page()
# ... work
await page.close()
```

The manager owns the lifecycle; don't tear browsers down yourself.

## Environment Variables

**Python API** — `HOST` (`0.0.0.0`), `PORT` (`5000`), `REDIS_ENABLED` (`false`;
filesystem cache when off, warned at startup), `REDIS_URL`,
`REDIS_CACHE_PREFIX` (`vlx`), `PERSISTENT_CACHE_TTL` (`86400`),
`HTTP_MAX_CONCURRENCY` / `HTTP_TIMEOUT` / `HTTP_MAX_RETRIES`,
`ALLOWED_ORIGINS` (**unset means localhost only — production must set it**),
`RATE_LIMIT` / `RATE_LIMIT_WINDOW` (`1000` / `600` per IP),
`AKN_ENABLED` (`true` — kill switch for the whole Akoma Ntoso path, read at
call time), `AKN_CACHE_MAX_ACTS` (`40` — parsed article indexes held in memory;
a few tens of KB for an ordinary act, a few hundred KB for a codice because of
the per-article fingerprints), `HEALTH_DETAILED_TTL` (`120` — seconds the
`/health/detailed` probe is cached, read at call time). Template in
`.env.example`.

Runtime dependency worth knowing: `lxml` (`requirements.txt`) is what the AKN
parser uses; it ships a `cp314` wheel, so installing it needs no compiler.

## Critical Files

Breaking one of these breaks the product. Read before editing.

**Python** — `services/visualex/visualex_api/app.py` (controller) · `tools/norma.py` (models) ·
`tools/text_op.py` (parsing + dates) · `tools/browser_manager.py` (browser pool) ·
`services/*_scraper.py` (fragile HTML parsers).

## Gotchas

1. **Scraper fragility** — every scraper depends on third-party HTML. Breakage
   means the site changed.
2. **Async context** — never block the Python event loop; wrap blocking calls in
   `asyncio.to_thread()`.
3. **Rate limiting** — per-IP, configured in `config.py`; 429 when exceeded.
4. **Playwright** — needed for PDF export and date completion
   (`playwright install chromium`); always via `PlaywrightManager`.
5. **Dates** — sync for URNs (approximate), async for display (accurate); never
   render a synthetic `YYYY-01-01`. See Date System.
6. **CORS/proxy** — the Vite dev server proxies to the Python API; check
   `vite.config.ts`. `ALLOWED_ORIGINS` unset means localhost only.
7. **Annex handling** — codici carry a default annex in the URN; see
   `create_norma_visitata_from_data()`.
8. **Selenium is gone** — Playwright only.
9. **Article id formatting (`-bis` / `-ter`)** — the tree API and the scraper
   disagree (`"1-bis"` vs `"1 bis"`). Server-side both are now canonicalised
   through `normalize_article_key` (`services/akn_parser.py`), which reads the
   ordinal from `tools/article_suffixes.py` and falls back to "any alphabetic
   tail" for anything that table does not list — Normattiva goes well past
   `decies` ("2409 octiesdecies" c.c.). On the frontend the tolerant
   `findArticleByNormalizedId` is still required: a naive `===` silently misses
   and falls back to the first article. Always use it, then canonicalise with
   `getUniqueArticleId(match)` before storing in state. The accepted forms now
   include the dotted sub-number (`270-bis.1`, `171-octies.1`), the slash
   (`314/2`) and multi-token ordinals (`135-sex-decies`), on both the server
   normaliser and the archive (`tools/archivio-normativo/archivio_normativo/hierarchy.py`).
24. **A missing article gets you a different one.** Normattiva answers a request
    for a nonexistent article with the act's Art. 1 and HTTP 200. The existence
    check in `create_norma_visitata_from_data` is what turns that into a 404
    ("Articolo N non presente in …", through `_error_response`); it fails open,
    so a Normattiva outage is never reported as "does not exist". A range where
    *some* articles exist keeps those and drops the rest.
