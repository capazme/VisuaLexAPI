# Python API — services/visualex

Loaded when Claude works in this folder; the root `CLAUDE.md` holds the repository-wide rules.

### Python API (`services/visualex`)

- **`app.py`** (this folder): main server, UI + API. **`services/visualex/visualex_api/app.py`**:
  alternative server with `/api/*` prefix and Swagger.
- **`services/`** — `normattiva_scraper.py`, `eurlex_scraper.py`,
  `brocardi_scraper.py` (annotations), `pdfextractor.py` (Playwright pool),
  `http_client.py` (the shared throttled aiohttp client — TLS verification on;
  `request(..., max_retries=n)` lowers the retry budget for a caller that paces
  itself, `None` keeps `HTTP_MAX_RETRIES`).
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
  - `normattiva_validity.py` — what a Normattiva article page says about its own
    validity: the window ("Testo in vigore dal … al …"), the version number, the
    act's last update, and a state (`current`, `historical`, `not_yet`,
    `abrogated`; `historical` means the window ended before today in Rome, a
    window ending today or later is `current` with its `valid_to` kept). Read
    from the raw page the scraper already keeps in its persistent cache (the key
    is the URN `get_document` returns), so it costs no request and never
    touches `article_text` (gotcha 23). A repealed article keeps its update notes
    and their markers on the page and they are not its text (art. 183-bis c.p.c.),
    so `abrogated` does not require an empty body; a whole-article or whole-act notice
    ("ARTICOLO ABROGATO", "PROVVEDIMENTO ABROGATO") is recognised by its words in any
    `ins-akn`, not by the `art_abrogato-akn` class (the class only matters to the structural
    fallback). Best effort: a page it cannot read yields no `validity` key at all, never a
    guess. It also holds the two request guards, `reject_future_version_date` and
    `is_historical_request`.
  - `massimario_portal.py` — internal (MERL-T only): one element of the Massimario
    portal, behind a firewall, so paced (≥ 1.5 s, the environment can only slow it
    down), the client's own retries off, a 403 or 429 is a stop (`429` to the caller).
  - `act_dates.py` — internal (MERL-T only): acts cited by year only → the full URN
    through Normattiva's resolver, verified by the page's title (type, year and
    number; State acts of nine kinds only, because the resolver answers a regional
    URN with the State's act of the same number), cached a year.
  - `decisions/` (in `services/`) — court decisions behind `POST /fetch_decision`:
    `model.py` (identity and reference), `italgiure.py` (Cassazione, Italgiure's Solr),
    `pdf_text.py` (the Cassazione's text from the court's PDF), `corte_cost.py` (Corte
    costituzionale open data, range bundles on disk), `resolver.py` (one outcome, lookups
    cached per archive), `http.py` (the readers' own `ThrottledHttpClient` and honest
    User-Agent); behind `POST /search_decisions` and `POST /fetch_decision_pdf`: `search.py`
    (an article or a topic as one Solr query), `search_route.py`, `pdf_route.py`.
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
    every `ThrottledHttpClient` (the shared one and the decision readers' own)
    and nothing else — `SECURITY.md` lists the three paths it does not cover
    (treextractor's own session, Playwright, redirect targets).
  - `tls.py` — the verifying SSL context for Italgiure, which serves an incomplete chain:
    the missing intermediate ships in `tools/certs/` and is trusted only under its SHA-256
    pin. Never "simplify" it into turning verification off (`tests/test_tls_italgiure.py`
    fails).
  - `sources.py` — the convention for legal sources as this API holds it (spec
    `docs/superpowers/specs/2026-10-04-source-convention-design.md`, golden file
    `conventions/sources/golden.json`, `tests/test_sources_golden.py`):
    `normalize_norm_urn` (any spelling of a norm → its identity: the resolver wrapper,
    version markers cut, Normattiva's alias form of a code, `decreto legislativo` /
    `decreto-legge` tokens, a ministry-form decree), `eu_identity` (`celex:32016R0679~art5`;
    `generate_urn` keeps building the EUR-Lex page) and `cite_article` / `cite_act`, the
    owner's citation style with every form he decided (the web's `utils/citation.ts` and
    the server's `norms/citation.ts` take the forms decided on 4 October, and the golden
    file, with the plan's PRs 1 and 2). `/parse_query`'s `display` is `cite_article`, or
    `cite_act` for a query with no article. A year-only URN and anything that is not a NIR
    URN pass through `normalize_norm_urn` unchanged
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
    not only its type. An ordinal suffix is read spaced, joined or hyphenated
    («615 bis», «615bis», «615-bis») and always emitted as `615-bis`; before
    2026-10-07 only the hyphen was read and the other two came out as art. 615,
    so MERL-T's citation edges built from them may point at the wrong article
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
  AKN index, and the act's `title` (`presentable_title`: no Gazzetta code, no
  amendment brackets, accents restored; `''` when there is none), so the
  dossier names an act with one call. Structure only: it never carries the
  display text
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
- `/fetch_decision` — one court decision: `{corte: cassazione | corte_costituzionale,
  numero, anno, archivio?, sezione?}` → `esito` trovata (identity, attributes, whole text,
  source) and ambigua 200, non_trovata 404 (with the reason and the archive's start),
  fonte_non_raggiungibile 503, richiesta_non_valida 400, errore_interno 500 (a bug: a fixed
  body). That is every answer the handler writes; the others carry no `esito`: the per-IP
  rate limit's 429 `{"error": …}` and the login gate's 401/429 through the ingress (both
  before the handler), and the framework's own 405 (a method other than POST or OPTIONS),
  408 (a stalled body) and 413 (over 16 MB; 1 MB behind the ingress, whose own page
  answers). Italgiure (TLS pinned, own client) and the Corte costituzionale open data
  (bundle on disk; when its refresh fails, the copy on disk still confirms a decision it
  holds for an earlier year, and a number it does not hold is a 503, never `non_trovata`).
  The Corte costituzionale's decisions link to the court's page; the
  Cassazione's have no source link. Lookups cached per archive: found 30 days, absent 1
  hour, a decision found without its text 24 hours (with the notice
  `testo_non_disponibile`; `attributi.testo_assente` says why only when the source did:
  `oscuramento` or `valutazione_oscuramento`), a text read from the archive's field
  instead of the PDF 24 hours too (notice `testo_da_archivio`), errors never. Expired entries are swept at
  start and every six hours (`sweep_decision_caches`). Design:
  docs/superpowers/specs/2026-10-01-sentenze-design.md
- `/search_decisions` — the Cassazione decisions that mention an article or a topic:
  `{norma?, tema?, archivio?: civile | penale, modo?: indice | testo, pagina?}` → `esito`
  risultati (a page of 20 with `totale`, `modo`, `archivio_dal`, and per decision its identity,
  attributes, `trovata` and `frammento`; cached a day), non_supportata, richiesta_non_valida
  400, fonte_non_raggiungibile 503, errore_interno 500 (a bug: a fixed body). Italgiure only,
  the last five years; the index serves codes and the Constitution, any other act goes to the
  text search, and an act no way can phrase (an EU act among them) answers non_supportata. Design:
  docs/superpowers/specs/2026-10-05-norms-decisions-search-design.md
- `/fetch_decision_pdf` — `{corte: cassazione, archivio, numero, anno}` → the court's original
  PDF of a decision as `application/pdf` bytes (an attachment), the ones a lookup cached or
  fetched once; `non_disponibile` 404, fonte_non_raggiungibile 503, richiesta_non_valida 400.
  Served only behind the login
- `GET /fetch_alias_catalog` — the presets we ship plus the act names the
  resolver already understands. A GET, like `/fetch_massimario`; a POST answers 405
- `GET /fetch_massimario?kind=index|capitolo|sezione&id=<n>` — internal (MERL-T): one element of the Massimario portal, raw; paced at ≥1.5 s; 429 when the portal's firewall refuses (a 403 or 429 from the portal, or its "Request Rejected" page); a 5xx or a timeout is retried a few times by the module, then 500.
- `POST /resolve_act_dates {"urns": [...]}` — internal (MERL-T): up to 20 year-only URNs (`urn:nir:stato:legge:1983;184`) → full URNs, through Normattiva's resolver; found dates cached a year. Only State acts of the nine kinds in
  `act_dates._TITLES` are resolved; any other URN, a page whose title is not that act's, a network failure and
  everything after the batch's first 120 s answer `null` for that act.
- `/export_pdf` — PDF via Playwright (rejects non-Normattiva URNs — SSRF guard)
- `GET /history` — server-side search history
- `GET /health/detailed` — probes Normattiva, EUR-Lex and Brocardi **for
  real**, on the shared client and circuit breakers. One result is cached
  for `HEALTH_DETAILED_TTL` seconds (120) behind an `asyncio.Lock`, so N
  concurrent cold callers run one probe; the body carries `cached` and the
  status stays 503 while a source fails. Never wire it to a tight loop

`validity` rides next to `article_text` in `/stream_article_text`,
`/fetch_article_text` and `/fetch_all_data` (Normattiva only; absent when the page
cannot be read): `{state, valid_from, valid_to, version_number, act_updated,
request_in_window}`, dates in ISO form. It is the source's own statement of which
version came back; `norma_data.data_versione` is only the date the caller sent. A
`version_date` after today (Europe/Rome) is a 400 — Normattiva would answer with the
current text and say nothing — and a request for a past text (`version: "originale"`
or a `version_date`) never asks Brocardi, whose commentary carries no date.

Root `app.py` maps failures through `_error_response`, so the status now carries
meaning: `ValidationError` → 400 (missing `act_type`/`article`, malformed article
input), `ResourceNotFoundError` → 404 (the article is not in the act),
`RateLimitExceededError` → 429, everything else 500, except `/fetch_decision`,
whose handler answers every failure with `esito` and never with the exception's text.
What the handler does not write is not its own, on that route too: the per-IP rate
limit's 429 `{"error": …}`, the login gate's 401/429 through the ingress, and the
framework's own 405, 408 and 413 pages.
Before, every failure was a 500 — and `stream_article_text` raised through to
Quart and answered an HTML error page instead of NDJSON.

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

**Python**: `urngenerator.py` (URNs) · `sources.py` (identity and citation of a source) · `text_op.py` (text parsing + dates) ·
`treextractor.py` (trees) · `PlaywrightManager` (browsers) ·
`article_suffixes.py` (the ordinal suffix table).

## Common Patterns

**New scraper** — add the class in `services/`, implement async
`get_document(normavisitata) -> Tuple[str, str]`, register the act type in
`NormaController.get_scraper_for_norma()`, extend `tools/map.py` if needed.

**New API endpoint** — route in `NormaController.setup_routes()`, async handler,
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
`TRUSTED_PROXIES` (`0` — how many reverse proxies sit in front; `X-Forwarded-For` is
believed only that far, and not at all at 0), `VISUALEX_LOG_FILE` (unset keeps
`norma.log` / `visualex_api.log` in the working directory; **empty** means console
only, which a read-only container needs),
`AKN_ENABLED` (`true` — kill switch for the whole Akoma Ntoso path, read at
call time), `AKN_CACHE_MAX_ACTS` (`40` — parsed article indexes held in memory;
a few tens of KB for an ordinary act, a few hundred KB for a codice because of
the per-article fingerprints), `HEALTH_DETAILED_TTL` (`120` — seconds the
`/health/detailed` probe is cached, read at call time). Template in
`.env.example`.

Runtime dependency worth knowing: `lxml` (`requirements.txt`) is what the AKN
parser uses; it ships a `cp314` wheel, so installing it needs no compiler.

## Container image

`services/visualex/Dockerfile`, built from the **repository root** (it reads
`version.txt`): `docker build -f services/visualex/Dockerfile -t visualex-scrapers .`.
`infra/compose.scrapers.yml` is the module that runs it.

- **Hypercorn, one worker** (`asgi:app`). The rate limiter, the circuit breaker and the
  fetch queue keep their state in memory, per process: more workers would each have
  their own. `python app.py` is still the development server.
- **It mirrors the repository layout** (`/repo/services/visualex`, `/repo/version.txt`)
  because `/version` and the `data/` and `download/` paths are computed relative to the
  source tree. `data/` (the search history and dossier file this service keeps) and
  `download/` (the cache and the exported PDFs) are volumes.
- **Chromium runs as a normal user** with every capability dropped and no `--shm-size`.
  Measured: about 280 MiB idle, about 1.06 GiB and 195 processes with four PDF exports at
  once; Docker's default 64 MB `/dev/shm` is enough (Playwright's Chromium avoids it).
- **No Redis.** MERL-T's job queues live in Redis as pickled objects, so a scraper able
  to write there could get code run by the worker. The cache is the filesystem.
- **Behind the ingress set `TRUSTED_PROXIES=1`.** At 0 every client shares the ingress's
  address, and one rate-limit bucket.
- **Behind the ingress the scraping routes need a login.** The Caddyfile asks the server
  (`GET /api/auth/verify`) before it passes a request on, except `/version` and `/health`.
  The Python API itself stays unauthenticated inside the network (the ingress is its only
  door) and never sees the login token (`header_up -Authorization`). The login check is
  timed out after ten seconds (a `504`), so a server that hangs fails the request instead
  of holding it.

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
   `parse_article_input` also takes a table suffix joined to its number, as
   Normattiva's URNs spell it (`615bis` → `615-bis`); a joined word outside the
   table (`5a`) is still refused.
24. **A missing article gets you a different one.** Normattiva answers a request
    for a nonexistent article with the act's Art. 1 and HTTP 200. The existence
    check in `create_norma_visitata_from_data` is what turns that into a 404
    ("Articolo N non presente in …", through `_error_response`); it fails open,
    so a Normattiva outage is never reported as "does not exist". A range where
    *some* articles exist keeps those and drops the rest.

30. **A path built from the URN is untrusted.** The guard on `/export_pdf` checks the
    host (`normattiva.it`), so everything after it is the caller's: `;../../x` used to
    become a directory part of the cached PDF's path, read from and copied to.
    `urn_to_filename` now returns a bare file name (`[A-Za-z0-9._-]`, never hidden), and
    `pdf_cache_path(urn, directory)` is the only way a cache path is built: a file
    directly inside `download/`. Any new path derived from a request goes through the
    same kind of gate; `tests/test_pdf_cache_path.py` lists the attempts.

31. **The window a page states is the only statement of which version came back.**
    `NormaVisitata.data_versione` is the date the caller *sent*, echoed. Normattiva
    answers a date after today with the current text and no sign (hence
    `reject_future_version_date`), and a date before an article existed with a page
    whose text reads "NON ANCORA ESISTENTE O VIGENTE". Read the window from the page
    (`normattiva_validity.py`), never from the request, and say nothing when the page
    cannot be read. A closed window is `historical` only when its last day is before
    today (Europe/Rome): a window ending today or later is the text in force, `current`
    with `valid_to` as stated, and `request_in_window` still judges the request against it.
    A repealed article keeps its update notes and their markers on the page and they are
    not its text (art. 183-bis c.p.c.): `abrogated` does not require an empty body. The
    whole-article and whole-act notices ("ARTICOLO ABROGATO", "PROVVEDIMENTO ABROGATO") are
    recognised by their words in any `ins-akn`: the portal does not always give them the
    `art_abrogato-akn` class (art. 155-ter c.c., every article of a repealed act).
    The window says which text was in force, not which discipline
    governs a fact: transitional provisions and retroactive rules are not on the page.
    `version` is read stripped and lower-cased wherever it is read
    (`is_historical_request`, `append_version_info`): a spelling that keeps Brocardi
    out must also build the URN of the past text, or the text in force goes out
    labelled as a past one.
    `tests/test_normattiva_validity_live.py` (`-m live`) re-checks the extraction
    against the portal.

33. **A decision found is not a text found.** Italgiure answers many decisions with its own
    notice in place of the text, while personal data are being removed (counted on
    2026-10-04, archive-wide): "La sentenza richiesta è in fase di oscuramento" (10,789
    civil and 32,898 penal records), "in fase di valutazione oscuramento" (21,168 civil and
    17,175 penal), and rarely a stub such as "Oscuramento disposto Numero registro generale
    …" (85 characters). The rule is «at most 300 characters and mentions oscuramento»: such
    a text is never the court's. `decisions/italgiure.py` returns the decision with
    `testo == {}` and `testo_assente` `"oscuramento"`, `"valutazione_oscuramento"` or, for
    the stub, none, which travels in `attributi` and through the caches: the decision's tab reads why
    from it. A record with neither a text nor a notice (a missing `ocr`, a renamed field)
    comes back with `testo == {}`, no `testo_assente` and a logged warning: never present it
    as the source's anonymisation. The resolver keeps a decision without its text 24 hours
    (`decisions_pending`), never 30 days, and adds the notice `testo_non_disponibile`; one read
    from the archive's field instead of the PDF is kept the same way. Never
    pass a notice on as `motivazione`: the decision's tab would show it as the court's reasons and a
    note could anchor to it (the first reader did, with the second notice and the stub, and
    the caches kept them 30 days). The decision caches hold whole texts, with whatever
    personal data the source left: `sweep_decision_caches` deletes their expired entries at
    start and every six hours, since the filesystem cache deletes one only when its key is
    read again.
    The Cassazione's text is read from the court's original PDF (`decisions/pdf_text.py`, then
    `italgiure.py`): one more request per decision found, with a budget of its own (one try, 8 s,
    parse 6 s, the whole step 15 s of the resolver's 25) so a slow PDF falls back instead of
    failing the lookup. The PDF is refused when its filename or its first-page header names
    another decision (a filename without tags or a PDF without a header is accepted; a damaged
    PDF is never accepted); it must also be at least 70% of the field's length and share 10 of
    the field's first 20 words with its first 250 (`_plausible`). Otherwise (no filename, a PDF
    that cannot be fetched or parsed, or one that fails these checks) the field's text
    stands, `testo_origine` is `"archivio"`, a warning logs the reason, and the resolver adds the
    notice `testo_da_archivio` and keeps the decision 24 hours in `decisions_pending`, so the PDF
    is tried again soon; a text from the PDF is kept 30 days and its bytes under `decisions_pdf`
    (30 days). A suggestion (the penal next year) reads the record only and keeps nothing. The
    field's text is one line (45 of 45 sampled texts): `paragraphs` inserts blank lines
    before the headings, «P.Q.M.» and the numbered points and changes nothing else (a combined
    heading, «RITENUTO IN FATTO E CONSIDERATO IN DIRITTO», stays one; a point keeps the words
    it opens, so there is no break between «3.» and a «P.Q.M.» right after it), and line
    breaks are invisible to anchors (root rule 23), so a note never moves when the rule is
    refined. Italgiure's `ocr` already ends with the dispositivo that `ocrdis` repeats (36 of
    the 36 sampled texts that have one): `split_dispositivo` cuts it off, so a decision reads
    it once. The Corte costituzionale's open data break lines two ways, and `line_paragraphs`
    turns a line break into a paragraph break unless it is a typewriter wrap of at most 80
    characters (the texts before about 2001): the page draws a paragraph only between blank
    lines, so without it a block is one paragraph. Both add line breaks and nothing else.
    Whatever changes the shape of what a reader returns must raise the version in its cache
    key (`italgiure:v3:…`, `corte_cost:v2:…`), or the entries cached before are served for up
    to 30 days. The `v2` keys (`v3` for the Cassazione since the PDF, 2026-10-05) cover the readers of Tasks 7a to 7c, none of which had shipped,
    so Task 7c raised no version of its own.
    The characters of a decision's text are to be frozen like an article's (root rule 23): the readers
    may add or move `\n` and move a boundary between blocks, never change another character, and a
    cache version bump is for shape only. `tests/test_decisions_text_frozen.py` (synthetic PDFs
    and records in CI; real ones in the `_local` twin) pins the projection (blocks stripped,
    concatenated, `\n` removed) as a SHA-256 and a length in `fixtures/decisions/frozen_projections.json`.
    The test is in place now; the freeze binds from the pull request that first stores notes on
    decisions (plan PR 4), and until then a reader may still change.
