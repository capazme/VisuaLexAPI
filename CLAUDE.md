# CLAUDE.md

Guidance for Claude Code working in this repository. Everything here is meant to
be true of the code as it stands — if you find a statement that the code
contradicts, fix the statement in the same change that taught you.

## Project Overview

VisuaLexAPI fetches and displays Italian legal texts from Normattiva, EUR-Lex and
Brocardi. Three services:

- **Python API** (`/visualex_api`, port 5000) — Quart, async scraping, PDF export
- **Node backend** (`/backend`, port 3001) — Express + Prisma, auth and user data
- **Frontend** (`/frontend`, port 5173) — React + TypeScript + Vite

The user is a practising lawyer, not a developer. UI copy is Italian; code,
comments and commits are English.

## Branches and Deployment

**`main` is the product in production ("vanilla"). `visualex-merlt-main` is the
AI experiment and is never deployed.**

Work flows one way, `main` → `merlt`. Vanilla fixes are committed on `main`
through short-lived branches (`fix/…`, `feature/…`); `merlt` absorbs them with a
periodic `git merge main`. Nothing is cherry-picked back. If you find yourself
fixing something vanilla while on `merlt`, stop and move to `main` — that
one-way-valve discipline is what this model exists to enforce, after 32 vanilla
commits (four of them security fixes) sat stranded on the experiment for weeks.

When backporting from `merlt`, watch for two things: commits are often mixed
(a vanilla fix and MERL-T work in one commit), and MERL-T code can ride along —
`publishMerltEvent` calls and types tied to schema changes `main` does not have.

Deployment is a single batch script run on the server, `deploy.sh`. CI gates
`main` on GitHub, but the script consults nothing and has no rollback, so a red
`main` still deploys — read the run before you deploy. **Read
`docs/deployment.md` before changing anything the script touches** — it records
what each step exists to prevent and the known gaps.

Two traps worth knowing without opening that file:
- `npm run build` (`tsc -b`) is the real frontend type-check. A bare
  `tsc --noEmit` does not walk the project references and reports a false green.
- Step 1 pulls whatever branch the server is on; only the step-0 guard keeps that
  honest.

## Development Commands

```bash
./start.sh                       # all three services

source .venv/bin/activate        # Python API
python app.py                    # main server (UI + API)
python -m visualex_api.app       # alt server with /api/* prefix + Swagger

# The Python suite — always through the project venv, from the repo root.
# The ambient python3 cannot import quart and fails a batch of tests for that
# reason alone; those failures are an interpreter mistake, not a regression.
.venv/bin/python -m pytest tests/ -q

cd backend && npm run dev        # Node backend
cd backend && npm run prisma:studio

cd frontend && npm run dev       # :5173
cd frontend && npm run build     # tsc -b && vite build — the real type-check
cd frontend && npm run lint
cd frontend && npm run test      # vitest (npm run test:ui for the UI)
```

PDF export needs Playwright browsers: `playwright install chromium`.

Backend tests live in `backend/tests` (vitest + supertest). An end-to-end and
stress harness lives in `e2e/` with its own README. `pytest.ini` sets
`asyncio_mode = auto` and excludes the `live` marker by default (`-m live` runs
the tests that hit real sources). `.github/workflows/` gates `main` and every PR
into it: Python tests on 3.12 and 3.14, the three frontend gates, backend tests,
plus a weekly `pip-audit` / `npm audit`. That is the only automated check in the
project: `deploy.sh` consults nothing, runs no test and has no rollback, so a red
`main` still deploys.

## Architecture

### Python API (`/visualex_api`)

- **`app.py`** (root): main server, UI + API. **`visualex_api/app.py`**:
  alternative server with `/api/*` prefix and Swagger.
- **`services/`** — `normattiva_scraper.py`, `eurlex_scraper.py`,
  `brocardi_scraper.py` (annotations), `pdfextractor.py` (Playwright pool),
  `http_client.py` (the shared throttled aiohttp client — TLS verification on).
  - `brocardi_scraper.py` also emits `Glossario` (links to Brocardi's legal
    dictionary, `{termine, url, dizionario_id}`). Any new `brocardi_info` key
    must be whitelisted in **all three** wire literals in root `app.py`
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
    Article texts are never cached. `AKN_ENABLED=false` disables the whole path
    and is read at call time.
    `normalize_article_key` in `akn_parser.py` is the pure canonicaliser for
    article numbers and needs no network.
- **`tools/`**:
  - `norma.py` — core models `Norma` / `NormaVisitata` (both with
    `to_dict()`/`from_dict()`; `NormaVisitata` implements hash/equality and is
    the primary container across the API)
  - `urngenerator.py` — URN generation · `treextractor.py` — article trees
  - `text_op.py` — text parsing **and** date handling (see Date System)
  - `browser_manager.py` — `PlaywrightManager` singleton (browser pooling)
  - `config.py` — rate limiting, cache size, Redis (`REDIS_ENABLED`, `REDIS_URL`)
  - `map.py` — act-type mappings, plus the act tables the resolver reads
    (`ATTI_NOTI` 63 aliases, `ATTI_DENOMINATI` 200 aliases over 80 acts, built
    from the reviewable `_ATTI_DENOMINATI_SPEC` rows) and `codice_urn(name)`,
    the **case-insensitive** lookup into `NORMATTIVA_URN_CODICI` — six keys
    carry capitals ("codice del Terzo settore"), so a bare `in` test missed
    them and those codici lost their default annex
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
    `POST /extract_citations`
  - `circuit_breaker.py` — per-source breaker. **State is in-memory
    per-instance** — single-instance deployment only. Status at
    `GET /api/circuit-breakers`
  - `redis_cache.py` + `cache_manager.py` — Redis cache with automatic
    filesystem fallback; startup warns when Redis is disabled or missing

### Node backend (`/backend`)

Express + Prisma. Auth, and the persistence for every user-owned slice.

- `src/middleware/rateLimiter.ts` — tiers: anonymous 100/min (by IP),
  authenticated 300/min (by userId), writes 20/min. `RateLimiterRedis` when
  `REDIS_ENABLED=true`, else in-memory with a startup warning.
- `src/utils/redis.ts` — `getRedisClient()`, returns `null` when disabled;
  connection errors fail open.
- `src/middleware/errorHandler.ts` — the only place a status is decided for an
  unhandled throw. `AppError` carries its own; a Zod `ZodError` becomes **400**
  naming the offending fields; everything else is a 500. Controllers therefore
  call `schema.parse()` and let it throw — 41 sites across 13 controllers — and
  must not catch it to hand-roll a status. The body is
  `{ detail: string, errors?: [{ field, message }] }`: `detail` stays a plain
  string because `services/api.ts` renders it straight to the user.
- **Environments**: `Environment` model keeps searchable metadata in columns
  (`name/description/author/version/category/color/tags`) and everything else in
  one opaque `content` JSON blob. Deliberately separate from `SharedEnvironment`
  (the forum entity) — a personal env can be promoted, the tables stay distinct.
- **QuickNorm / CustomAlias**: full CRUD, plus a dedicated `POST /:id/use` per
  entity (see gotcha 19). `CustomAlias` carries `@@unique([userId, trigger])`;
  the controller maps Prisma P2002 to 409.
- **Scoped bulk deletes**: `DELETE /annotations` and `DELETE /highlights`, both
  scoped to `req.user.id`. Intended caller is `applyEnvironment(replace)` ONLY —
  do not wire into end-user UI without a dedicated confirm flow.
- Dossier item mutations are scoped to their dossier (IDOR fix — keep it that
  way when adding item routes).

### Frontend (`/frontend/src`)

- `App.tsx` — routing. Routes: `/` (search), `/dossier`, `/history`,
  `/environments`, `/forum`, `/admin/*`, plus `/login` and `/register`.
- `store/useAppStore.ts` — Zustand + Immer, the single global store.
- `types/index.ts` — shared types. `services/` — one file per backend entity.
- `components/features/` — `search`, `workspace`, `dossier`, `environments`,
  `bulletin` (the Forum), `history`, `compare`, `settings`.
- `components/layout/` — `Layout`, `Sidebar`, `ReaderLayout`.
- `components/ui/` — shared primitives: `Button`, `IconButton`, `Input`, `Card`,
  `Modal`, `ConfirmDialog`, `Toast`, `EmptyState`, plus feature-flavoured modals.
  Interaction tokens live in `constants/interactions.ts`, stacking bands in
  `constants/zIndex.ts`. Compose these rather than hand-rolling Tailwind.

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
- `GET /fetch_alias_catalog` — the presets we ship plus the act names the
  resolver already understands. The only GET among these; a POST answers 405
- `/fetch_case_law` — decisions bearing on a norm, grouped by source. Always 200
  on a well-formed request: a source that is down reports `ok:false` inside its
  own section, so one dead source never hides the ones that answered. Each
  section and each decision inside it carries two source fields that answer
  different questions: `organo` is the human-readable label a lawyer reads
  ("CGUE", "Giustizia amministrativa"; for CeRDEF's per-row `organo` it is the
  court parsed off that row, e.g. "Corte di Cassazione" — never the source's
  own label), `fonte` is the `registry.ADAPTERS` key ("cgue", "cassazione",
  "cerdef", "giustizia-amm") this row came from and is what a client must send
  back as `organo` to `/fetch_decision`. The two only coincide by
  case-folding for three of the four sources — `fonte="giustizia-amm"` does
  not fold from `organo="Giustizia amministrativa"` — so always read `fonte`
  for the address, never derive it from `organo`
- `/search_case_law` — free-text search across the same sources
- `/fetch_decision` — one decision by `organo` (the `fonte` key above —
  lookup is case-insensitive and also tolerant of the human-readable `organo`
  label, but the response's `fonte` is always the canonical key), `numero`,
  `anno`
- `/export_pdf` — PDF via Playwright (rejects non-Normattiva URNs — SSRF guard)
- `GET /history` — server-side search history

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
  "annex": "A"                   // optional (allegato)
}
```

Request fields are `act_type/act_number/date`; the `norma_data` in responses uses
`tipo_atto/numero_atto/data`. The mismatch is real — map, don't assume.

## Date System

Two complementary paths, chosen by whether you need speed or truth.

**Backend** (`visualex_api/tools/text_op.py`):
- `complete_date_or_parse(date_str)` — **sync, fast, approximate**. Year-only
  dates become `YYYY-01-01`. Used by `urngenerator.py` so URN generation never
  blocks on a lookup.
- `complete_date_or_parse_async(date_str)` — **async, slow, accurate**. Drives
  Playwright to read the real publication date from Normattiva, memoised in
  `_date_cache`. Used where the date is displayed or compared.
- `complete_date()` — the low-level Playwright call behind the async wrapper.

**Frontend** (`frontend/src/utils/dateUtils.ts`):
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

Errors use the hierarchy in `visualex_api/tools/exceptions.py`
(`ValidationError`, `ResourceNotFoundError`, `RateLimitExceededError`), surfaced
by `NormaController.handle_error()`. Logging is structlog.

## Frontend State

One Zustand store (`store/useAppStore.ts`) with Immer. Always mutate through
actions.

**Server-backed** (hydrated by `fetchUserData`, mutated optimistically then
synced): bookmarks, dossiers + items, environments, quickNorms, customAliases,
annotations and highlights (these two hydrate per-article via
`loadAnnotationsForArticle` / `loadHighlightsForArticle`), history.

**UI-only** (persisted to `localStorage` through the `persist` partialize):
workspace tabs and z-index, settings, `searchPanelState`.

The partialize deliberately holds UI state only. **Every user-owned slice is
server-backed** — see gotcha 17, which is the rule any new slice must follow.

### How the collections differ

- **Dossiers** (`/dossier`) — the working file for a task: many articles, read in
  place, reorderable, exportable, shareable. This is where real work happens.
- **Bookmarks** — a save action in the reading toolbar backed by
  `bookmarkService`. There is **no bookmarks page or route**; the dedicated UI was
  removed as dead code. Don't document or build against a bookmarks page without
  first deciding to rebuild one.
- **History** (`/history`) — server-side search history.

All of them reopen a norm through `triggerSearch()`.

### Aliases

Three different things. Conflating them is the recurring mistake.

- **Presets** (80) — shipped in `preset_aliases.yaml`, served by
  `GET /fetch_alias_catalog`. 21 of them only rename an act type: "codice
  appalti" IS the "Codice Contratti Pubblici" tile already in the palette's
  grid, so listing them duplicates that grid. The palette shows only the 59
  that carry a number and a date (`gdpr` → Reg. UE 679/2016), which is work
  the grid cannot save.
- **Known acts** (389) — names `act_resolver.py` understands unaided ("statuto
  dei lavoratori", "TUSL"). These need no alias at all; one would only drift.
- **CustomAlias** — the user's own, server-backed. A custom trigger beats a
  preset of the same name, because the client resolves its own aliases before
  asking the server. So the palette hides the shadowed preset rather than
  advertising a shortcut that no longer runs, and the manager badges it
  "sovrascritto".

`AliasManager` is reached **only** from the command palette (gotcha 27), and in
the palette the presets cost one line of header text at rest — they render as
rows only once the user types, and cmdk does the matching. `useAliasCatalog`
keeps its `loaded` flag in component state, so the palette and the manager each
fetch the catalog once for as long as they stay mounted — two calls per session,
never repeated, nothing persisted.

### Reading surface

The dashboard article view (`ArticleTabContent`) composes: `ArticleBody` (renders
sanitised HTML + hosts `SelectionPopup`), `useArticleMarkers` (turns raw text into
HTML with highlight `<mark>`s and wavy note anchors), and the toolbar
(`ReadingToolbar`). Keys are `buildItemKey(norma)` and
`uniqueArticleIdFromNorma(norma)` from `utils/normaKeys.ts` — the dossier reader
uses the same two functions, and they must stay byte-identical or annotations
made on one surface stop appearing on the other.

**Notes**: a Peek popover (`NotesPeekPanel`) from the toolbar for browsing and
free notes; `InlineNoteComposer` anchored on the selection when creating an
anchored note; `InlineNotePopover` when clicking an existing wavy underline.
Three entry points, deliberately distinct — don't collapse them.

**Highlights**: created **only** from `SelectionPopup`. The toolbar's Highlighter
button opens `HighlightsActionsPicker`, an action bar that toggles visibility and
exports to `.txt` — it is not a second creator (that was tried and rolled back).

**The index is a window, the text is not.** `TreeViewPanel` takes a `variant`:
`'window'` on desktop — a draggable, backdrop-less window portalled to
`document.body`, parked where the user left it — and `'drawer'` on mobile, the
old right-side sheet. Neither closes when an article is picked: taking three
articles out of an index without reopening it is the whole point. Ownership of
the desktop window lives in the store as a single `structureWindow.blockId`, so
opening one block's index hands the window over rather than stacking a second.
The floating mechanism belongs to the *tool*, not the content — the owner's own
framing, and the correction that shaped round 2a.

**Opening an act without an article.** `fetchActUrn` (`utils/actUrn.ts`) resolves
an act's URN structurally, with no text fetched; `addNormaIndexToTab` then drops
an article-less block on a tab and points the window at it atomically. The
palette's "Apri l'indice e sfoglia" is the entry point. A block with zero
articles is a legitimate state — guard anything that dereferences the active
article (`StudyMode` is mounted conditionally for exactly this reason).

**Going back.** `readingBackStack` records **citation jumps only**. Picking from
the index does not lose your place, and a previous/next arrow is undone by the
opposite arrow; recording those would fill the stack with stops nobody wants.
`ReadingBackControl` renders once for the whole app — the stack is global, so a
per-tab copy would sit inside the very tab an entry points at. It names its
destination, and it has no keyboard shortcut on purpose: every natural
combination for "back" already belongs to the browser.

### Dossier

A dossier is where the articles needed for a task are aggregated and read.

- **Rows expand in place**: clicking a norma row renders `DossierItemReader.tsx`
  inline, reusing the dashboard reading layer (markers, `SelectionPopup`, note
  composer and popover). "Apri su Dashboard" and "Copia citazione" live in the
  expanded footer. `ArticleViewerModal` no longer exists.
- **Fetching**: `utils/articleFetchCache.ts` — session-only cache, in-flight
  de-dup, max 3 concurrent fetches, errors not cached so "Riprova" really
  refetches.
- **Important star**: reading statuses (unread/reading/done) were removed. The
  star persists through a `_dossierMeta` envelope packed into the item's `content`
  JSON — no backend schema change — via `packItemContent`/`unpackItemContent` in
  `dossierUtils.ts`. `updateDossierItemStatus` writes only `'unread' | 'important'`
  and defers the PUT while an item is still in `pendingDossierItemIds` (its
  `addItem` POST hasn't returned a server id yet), replaying it once settled.
  Legacy status values still hydrate and simply render as unstarred.
- **Collection**: `AddToDossierPopover.tsx` is the only add-from-reading entry
  point (from `ReadingToolbar` and `LooseArticleCard`). It lists recent dossiers,
  guards duplicates, and its inline "Nuovo dossier" waits for the server id
  before adding — `createDossier()` returns `Promise<string | null>`.
  `DossierModal` is create-only.
- **Rows** (`SortableDossierItem`): the expand toggle lives on a header-scoped
  sub-div, never wrapping the reader or the action buttons (see gotcha 22); the
  star keeps a 44px touch target.

## Shared utilities — check before writing a new one

Duplicating any of these is a defect, not a shortcut.

**Python**: `urngenerator.py` (URNs) · `text_op.py` (text parsing + dates) ·
`treextractor.py` (trees) · `PlaywrightManager` (browsers).

**Frontend**:
- `utils/normaKeys.ts` — `buildItemKey(norma)` (norm + article),
  `buildNormaKey(norma)` (act only, used to group streaming results),
  `uniqueArticleIdFromNorma(norma)`. Both keys share their act-level segments so
  they cannot drift. `buildItemKey` is the annotation/highlight key contract and
  must stay byte-identical across dashboard and dossier.
- `utils/actUrn.ts` — `fetchActUrn(params)`: an act's URN with no article text
  fetched. It sends `article: '1'` because the endpoint refuses to build a
  `NormaVisitata` without one — a probe, not a request for article 1.
- `utils/readingBackStack.ts` — `appendBackEntry`, `peekReadingBack`,
  `findLiveBackIndex` for citation-jump undo.
- `hooks/useIsDesktop.ts` — viewport check for components that must render
  *structurally* different markup per breakpoint (portal vs. inline). It existed
  as two private copies before round 2a; do not make a third. For anything a CSS
  breakpoint can express, use the CSS breakpoint.
- `utils/articleIds.ts` — `getUniqueArticleId(article)` (canonical `allN:num`),
  `filterLoadedIdsForAnnex(ids, annex)`, `findArticleByNormalizedId(articles, id)`
  (**tolerant** lookup — required, see gotcha 9).
- `utils/dateUtils.ts` — `parseItalianDate`, `formatDateItalianLong`.
- `utils/normaMeta.ts` — `formatNormaMeta(norma, { variant })` for the subtitle
  (`'card-mobile' | 'card-desktop' | 'block'`), `formatCitation(norma)` for the
  copyable citation string.
- `utils/articleFetchCache.ts` — `fetchArticleForNorma`, cached and capped.
- `components/features/dossier/dossierUtils.ts` — `searchParamsFromNorma`,
  `packItemContent`/`unpackItemContent`, `computeItemCounts`, `dossierRecency`,
  `dossierContainsArticle`, `computeNormaGroups`, `formatTimestampLong`.
- `hooks/useAnnexNavigation.ts` — shared tree fetch + annex switch + load article.

## UI Conventions

Non-obvious rules baked into the codebase. Follow them so new surfaces stay
coherent.

**Destructive confirmations** — never `window.confirm`. Use
`components/ui/ConfirmDialog` with `variant="danger"`, and word the message so it
names the scope *and* what is not touched ("Segnalibri e dossier non saranno
toccati").

**Keyboard-accessible collapsibles** — a `div` that toggles on click needs
`role="button"`, `tabIndex={0}`, `aria-expanded`, a dynamic `aria-label`
(espandi/comprimi), and `onKeyDown` for Enter/Space with `preventDefault()`. The
handler must start with `if (e.target !== e.currentTarget) return;` or interactive
children re-trigger the toggle. Always add
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500`.
Never nest interactive content inside the element carrying `role="button"` —
scope the role to the header, as `SortableDossierItem` does.

**Popovers with `@floating-ui/react`** — split positioning and animation across
**two** elements: outer div takes `refs.setFloating` + `floatingStyles`, inner div
owns the entry animation. On the same element the scale transform overwrites the
positioning transform. Compute `transformOrigin` from `placement` (see
`getTransformOrigin` in `NotesPeekPanel.tsx`). Anchor via a `useState` element,
not a ref object, and pass it at render time (gotcha 13).

**Toggle buttons** — drive the visual from an `isPressed` selector, not a fixed
colour: idle `text-slate-400` + hover accent, active `bg-{accent}-50
text-{accent}` (plus `fill-` when the icon has a body). Toast wording must match
the action actually taken. Always set `aria-pressed`.

**Two flavours of pop-up** — *Peek* (header, scrollable body, composer; ~360px,
page-themed) when the surface lists or edits content; *action bar* (thin dark
slate, 2-4 icon buttons with 1px dividers, no chrome) when it only performs
actions. Both use the outer/inner split above.

**Sticky filter rows** — `sticky top-0` alone lets content scroll through. Give
the row an opaque background matching the panel, bleed it edge-to-edge with
negative margins matching the parent padding, add `border-b border-current/10`,
and raise it to `z-20`.

**Stacking** — use the bands in `constants/zIndex.ts` (`sidebar` 50, `dock` 80,
overlay band 1000+), never a bare literal. See gotcha 22 before assuming a
z-index will be honoured.

**Beating inline `style="..."` without `!important`** — when markup you don't
control ships inline styles (e.g. `useArticleMarkers` emits
`<mark style="background-color:hsl(var(--hl-yellow-bg))">`), first try
**redefining the CSS variable in a narrower scope** so the inline `hsl(var(--…))`
resolves differently. Only if the inline style references no variable, fall back
to a single narrowly-scoped `!important` with a comment justifying why every
other route fails.

**Colour markers** — for a list mirroring something already coloured in the
article body, use a 4px stripe down the card's leading edge rather than
re-applying a saturated background behind the text.

**Mobile-first** — interactive controls keep a 44px touch target on mobile.
`TOUCH_TARGET_RESPONSIVE` in `constants/interactions.ts` covers the height only
(`min-h-[44px] md:min-h-0`); icon-only buttons need the width too, so they carry
`min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0` explicitly — as the dossier
row's star and remove buttons do.

## Common Patterns

**New scraper** — add the class in `services/`, implement async
`get_document(normavisitata) -> Tuple[str, str]`, register the act type in
`NormaController.get_scraper_for_norma()`, extend `tools/map.py` if needed.

**New API endpoint** — route in `NormaController._setup_routes()`, async handler,
`await request.get_json()`, return `jsonify()`, log with structlog.

**New frontend component** — compose the `ui/` primitives and the interaction
constants; import types from `types/index.ts`; reach state through
`useAppStore()`; Tailwind v4 for styling.

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

## Working in this repo

Feature work runs as **rounds**: a short interview about real usage, a spec in
`docs/superpowers/specs/`, a plan in `docs/superpowers/plans/`, then
implementation task by task with a review after each. The specs and plans are the
record of *why*; read the relevant one before reopening an area.

Verification before calling anything done: `npm run test` and `npm run build` in
`frontend/`, plus a real browser pass for UI work (dev server at
`http://localhost:5173`; the app requires login). Fix pre-existing errors you
surface in files you touch rather than deferring them.

Specialised subagents live in `~/.claude/agents` — check what is actually
available before dispatching, rather than assuming a name exists.

`docs/archive/` holds superseded design material (the March 2026 BMAD cycle, the
April polish audits). It is history, not guidance. `docs/design/` holds visual
work that is decided but not yet applied. If a `docs/merlt/` directory shows up in
your working tree, it belongs to `visualex-merlt-main`, not to `main`.

## Environment Variables

**Python API** — `HOST` (`0.0.0.0`), `PORT` (`5000`), `REDIS_ENABLED` (`false`;
filesystem cache when off, warned at startup), `REDIS_URL`,
`REDIS_CACHE_PREFIX` (`vlx`), `PERSISTENT_CACHE_TTL` (`86400`),
`HTTP_MAX_CONCURRENCY` / `HTTP_TIMEOUT` / `HTTP_MAX_RETRIES`,
`ALLOWED_ORIGINS` (**unset means localhost only — production must set it**),
`RATE_LIMIT` / `RATE_LIMIT_WINDOW` (`1000` / `600` per IP),
`AKN_ENABLED` (`true` — kill switch for the whole Akoma Ntoso path, read at
call time), `AKN_CACHE_MAX_ACTS` (`40` — parsed article indexes held in memory,
a few tens of KB each). Template in `.env.example`.

Runtime dependency worth knowing: `lxml` (`requirements.txt`) is what the AKN
parser uses; it ships a `cp314` wheel, so `deploy.sh` needs no compiler.

**Node backend** — see `backend/.env.example`. `REDIS_ENABLED` defaults to
`"true"` there to mirror production; set `"false"` for dev without Redis.

## Critical Files

Breaking one of these breaks the product. Read before editing.

**Python** — `visualex_api/app.py` (controller) · `tools/norma.py` (models) ·
`tools/text_op.py` (parsing + dates) · `tools/browser_manager.py` (browser pool) ·
`services/*_scraper.py` (fragile HTML parsers).

**Frontend core** — `store/useAppStore.ts` · `types/index.ts` · `services/api.ts` ·
`utils/normaKeys.ts` · `utils/articleIds.ts` · `utils/dateUtils.ts` ·
`utils/normaMeta.ts` · `utils/articleFetchCache.ts` · `utils/actUrn.ts` ·
`utils/readingBackStack.ts` · `hooks/useAnnexNavigation.ts` ·
`hooks/useIsDesktop.ts` · `constants/zIndex.ts` · `constants/interactions.ts`.

**Frontend features** — each of these folders was split out of a monolith and is
meant to stay split; add new features as new files, not inside the shells:

- `features/dossier/` — `DossierPage.tsx` is a thin shell routing list/detail via
  `?dossier=<id>`; `DossierListView.tsx` (grid, context menu, shortcuts `n` `/`
  `i`), `DossierDetailView.tsx`, `SortableDossierItem.tsx` (row + star + expand),
  `DossierItemReader.tsx` (in-place article), `AddToDossierPopover.tsx`,
  `ToolbarButton.tsx` (colour-token toolbar button with `pressed`/`pressedColor`),
  one file per modal, shared helpers in `dossierUtils.ts`.
- `features/environments/` — `EnvironmentPage.tsx` shell + `EnvironmentCard.tsx` +
  one file per modal; `EnvironmentContentViewer.tsx` renders the shared
  dossier/quickNorm/alias/annotation/highlight tree. Cards carry a category
  stripe and a stale/fresh chip; primary action is "Unisci", replace lives in the
  3-dot menu behind a danger `ConfirmDialog`.
- `features/bulletin/` — the Forum. Folder and component names stay `bulletin`
  because they match the backend `SharedEnvironment` model; the route is `/forum`
  and the UI label is "Forum". `BulletinBoardPage.tsx` is a shell over three dumb
  views (`ForumExploreView`, `ForumMyEnvironmentsView`, `ForumSuggestionsView`).
  The suggestion flow adds `SuggestionReviewDialog`, `EditSuggestionDialog`,
  `SuggestionItemCard` (all five itemTypes), `AliasConflictDialog`,
  `AddItemsDialog` and `AttributionChip` (see gotchas 20-21).
- `features/search/` — `ArticleTabContent.tsx` (the reading surface),
  `ArticleBody.tsx`, `NotesPeekPanel.tsx`, `InlineNoteComposer.tsx`,
  `InlineNotePopover.tsx`, `HighlightsActionsPicker.tsx`, `ReadingToolbar.tsx`,
  `SearchPanel.tsx` (streaming merge logic, and the mount point for both
  `CommandPalette.tsx` and `AliasManager` — see gotcha 27),
  `TreeViewPanel.tsx` (the article index window).
- `features/settings/` — `AliasManager.tsx` and nothing else. Named for what it
  edits, not for where it opens: it is reached from the command palette, not
  from Settings (gotcha 27). See the Aliases section above.
- `features/workspace/` — `WorkspaceManager`, `WorkspaceTabPanel`,
  `NormaBlockComponent`, `LooseArticleCard`, and `StudyMode/`.

**Backend** — `prisma/schema.prisma` · `controllers/` (`environmentController`,
`quickNormController`, `customAliasController`, `dossierController`) ·
`routes/` (all authenticate-gated, mounted on `/api`).

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
   through `normalize_article_key` (`services/akn_parser.py`), which treats the
   suffix as any alphabetic tail rather than an enumerated ordinal list —
   Normattiva goes well past `decies` ("2409 octiesdecies" c.c.). On the
   frontend the tolerant `findArticleByNormalizedId` is still required: a naive
   `===` silently misses and falls back to the first article. Always use it, then
   canonicalise with `getUniqueArticleId(match)` before storing in state.
10. **Popover positioning vs entry animation** — floating-ui positions with an
    inline `transform`; an `animate-in zoom-in-95` on the *same* element
    overwrites it and the popover flies from (0,0). Split across two elements.
11. **`set-state-in-effect`** — prefer deriving the value during render over
    silencing the rule. Silence only for effects synchronising with an external
    signal *and* mutating external state in the same transaction, and always
    leave the justification on the disable line.
12. **Workspace tab pin was removed** — the flag only suppressed bring-to-front,
    which contradicted the word "pin". Don't reintroduce without a product
    reason. `Dossier.isPinned` is unrelated and stays.
13. **Popover first paint at (0,0)** — floating-ui computes position
    asynchronously. Registering the reference in a layout effect leaves the first
    paint uncoordinated. For DOM anchors pass
    `useFloating({ elements: { reference: anchorEl } })` at render time. For
    **virtual** elements that path throws, so use `refs.setPositionReference()`
    plus `visibility: isPositioned ? 'visible' : 'hidden'`.
14. **StrictMode double-invoke + multi-step store actions** — an effect issuing
    two separate mutations runs both twice against the same closure value.
    Collapse them into one atomic store action (`drainNextSearch` is the
    canonical example) so the second invocation finds the precondition already
    satisfied and no-ops.
15. **Dossier "apri tutte le norme"** — `triggerSearch` overwrites the trigger, so
    a loop keeps only the last. The flow queues params and drains them one at a
    time; each carries `tabLabel` (cosmetic) and `targetTabId` (load-bearing —
    tells `processResult` to skip merge heuristics). The destination tab is
    pre-created synchronously before `navigate('/')`. Without `targetTabId` a
    stale orphan tab in persisted state can swallow the results.
16. **Capture the selection rect eagerly** — before `hidePopup()` /
    `removeAllRanges()`, because the selection is gone immediately after. The rect
    travels through `onAddNote(text, startOffset, rect)`.
17. **Every user-owned slice is server-backed** — every create/update/delete must
    round-trip the backend. The canonical regressions were `importDossier` and
    `applyEnvironment`, which pushed a local `uuidv4()` into the store; the UI
    looked fine until the first `addItem` 404'd on a ghost entity. Creation goes
    through `service.create()` first so the store holds server ids; mutations are
    optimistic + sync + revert. `applyEnvironment(replace)` also wipes
    server-side first, gated behind a danger `ConfirmDialog`.
18. **Never silently swallow errors in load paths** — `.catch(() => [])` in
    `fetchUserData` once hid a backend restart behind an empty UI for a whole
    session. Log with context before any fallback.
19. **Atomic usage counters** — `usageCount` bumps go through `POST /:id/use`
    (`increment: 1`), never a read-modify-write PUT. Client pattern: bump locally
    for instant feedback, then fire-and-forget `service.use(id)`; the next
    `fetchUserData` is the source of truth.
20. **SuggestionItem payloads are server-trusted** — the `take` handler trusts the
    stored shape, so any rename must happen before storage. That is why the alias
    Rename path is deferred; Replace and Skip cover the flows.
21. **`sourceSuggestionId` + `originalAuthorId` are the attribution contract** —
    never mutate or filter them out. If a row has an author, the UI shows the
    `AttributionChip`; a deleted author renders "@utente-rimosso" by design.
22. **A z-index is inert on a `static` element, and `backdrop-filter` traps its
    descendants.** The sidebar was `lg:static` with `z-50` (never applied) *and*
    `backdrop-blur-xl`, which creates a stacking context — so its hover tooltips
    could not escape it no matter how high their own z-index went, and page
    content painted over them. Before reaching for a bigger number, check that the
    element is positioned and that no ancestor sets `backdrop-filter`, `filter`,
    `transform`, `opacity < 1` or `isolation`. Fix the ancestor or portal out;
    raising the child's value does nothing.


23. **`article_text` is a data contract, not a string.** Highlights and anchored
    notes are pinned by `(startOffset, text)` where the offset counts characters
    in a projection of `article_text` in which only `\n` is invisible.
    `useArticleMarkers` requires exact equality between the stored text and the
    slice at that offset and drops the marker silently on mismatch — no fuzzy
    fallback, no log, no visual difference from "never existed". Changing the
    scraper's output formatting by one space deletes every anchor after it, for
    every user, with no way to detect it afterwards. Measured: AKN vs HTML is
    0/19 identical. This is why `normattiva_scraper._estrai_testo_*` output is
    frozen and why AKN is never the display text.

24. **A missing article gets you a different one.** Normattiva answers a request
    for a nonexistent article with the act's Art. 1 and HTTP 200. The existence
    check in `create_norma_visitata_from_data` is what turns that into a 404
    ("Articolo N non presente in …", through `_error_response`); it fails open,
    so a Normattiva outage is never reported as "does not exist". A range where
    *some* articles exist keeps those and drops the rest.

25. **`store/workspaceTabActions.ts` is a dead duplicate — edit `useAppStore.ts`.**
    The live workspace-tab actions are inlined in the store (`addNormaToTab` and
    friends); nothing imports the factory in that file. Its only live export is
    the `NormaBlock` / `LooseArticle` *types*, imported by `useGlobalSearch.ts`.
    Editing an action there changes nothing at runtime. The file carries a header
    saying so; relocating the types and deleting the rest is queued for round 2b.
26. **A portal escapes `hidden md:block`, so a CSS breakpoint cannot gate it.**
    `display: none` hides descendants, but a portal re-parents to `document.body`
    and leaves the hidden subtree behind — the desktop renderer would surface its
    window on a phone, next to the mobile one. Anything portalled that exists in
    only one breakpoint needs a real viewport check (`useIsDesktop`), not a
    wrapper class. Conversely, a non-portalled `fixed` element inside a
    transformed ancestor is positioned against *that ancestor*, not the viewport
    (see gotcha 22) — which is why the structure window portals at all.

27. **A store flag only opens a modal that is actually mounted.** `AliasManager`
    (and its siblings) render inside `SearchPanel`, so `aliasManagerOpen` is
    inert on `/dossier`, `/history` or any route that is not the search page —
    the flag flipped and nothing appeared, silently. That is why the alias
    manager is reached from the command palette, which lives in the same subtree,
    and why the Settings entry that used to open it was removed rather than kept
    as a second door. Before adding a global-looking "open X" button, check where
    X is mounted.

28. **Two vocabularies name the same act, and they disagree on case.**
    `constants/actTypes.ts` spells it `Regolamento UE`; the backend resolver
    answers `regolamento ue`. A `===` between the two silently produced an act
    with no name in the palette ("· n. 1689 del 2024") and skipped the step
    that collects an act's number and date. Compare case-insensitively and fall
    back to the raw value: the resolver knows 389 names against `ACT_TYPES`'
    40, so a miss is the normal case, not the exception. Same trap as
    `codice_urn` on the backend.
