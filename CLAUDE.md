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
  - `config.py`: Rate limiting, cache size, Playwright browser pool, Redis config (`REDIS_ENABLED`, `REDIS_URL`)
  - `map.py`: Act type mappings
  - `browser_manager.py`: Playwright browser pool management (`PlaywrightManager`)
  - `nl_parser.py` (Sprint 1): Natural language query parser — normalizes inputs like "art. 3 cc" into structured API params. Exposed at `POST /api/parse_query`.
  - `alias_resolver.py` + `preset_aliases.yaml` (Sprint 1): Preset alias library (e.g. `gdpr` → Regolamento UE 2016/679). Runs before the NL parser.
  - `citation_linker.py` (Sprint 1): Detects explicit and contextual citations in article text; emits `{start, end, display_text, article, act_type, date, act_number}`. Exposed at `POST /api/extract_citations`.
  - `circuit_breaker.py` (Sprint 1): Per-source scraper circuit breaker. **State is in-memory per-instance** (registry `_breakers: Dict[str, CircuitBreaker]`) — single-instance deployment only. Redis-backed shared state is deferred tech debt if scaling becomes needed. Status endpoint: `GET /api/circuit-breakers`.
  - `redis_cache.py` + `cache_manager.py` (Sprint 1): Redis-backed async cache with automatic filesystem fallback. Both backends implement the same async `get`/`set`/`delete`. Startup emits a warning when `REDIS_ENABLED=false` or when the redis package is missing while enabled.

### Node.js Backend (`/backend`)

Express server with Prisma ORM for platform features (authentication, user data).

Sprint 1 additions:
- `src/middleware/rateLimiter.ts`: `rate-limiter-flexible` based middleware. Tiers: anonymous 100/min (by IP), authenticated 300/min (by userId), writes 20/min. Uses `RateLimiterRedis` when `REDIS_ENABLED=true`, else falls back to `RateLimiterMemory` and logs a startup warning. Mounted globally in `src/index.ts`.
- `src/utils/redis.ts`: `ioredis` client factory (`getRedisClient()`). Returns `null` if Redis is disabled. Connection errors fail open (rate limiter continues on memory).

Scoped-bulk-delete endpoints (added for `applyEnvironment(replace)`):
- `DELETE /annotations` → `annotationController.deleteAllAnnotations` — `prisma.annotation.deleteMany({ where: { userId: req.user.id } })`. Returns `{ deleted: count }`.
- `DELETE /highlights` → `highlightController.deleteAllHighlights` — same pattern for highlights.
- Both authenticate-gated (like every annotation/highlight route) and scoped to the current user. Intended caller is `applyEnvironment(replace)` ONLY — do not wire into end-user UI without a dedicated confirm flow (the current one lives in `EnvironmentPage`, danger-variant `ConfirmDialog` spelling out the wipe).

Personal-environment CRUD (added when the environments page moved off localStorage):
- `Environment` Prisma model with top-level columns for `name/description/author/version/category/color/tags` (searchable/indexable metadata) plus a single `content` JSON blob for `dossiers/quickNorms/customAliases/annotations/highlights`. Kept intentionally separate from `SharedEnvironment` (the community-board entity); a personal env can be promoted to shared but the tables stay distinct.
- `environmentController` + `routes/environments.ts`: GET `/environments`, GET `/environments/:id`, POST `/environments`, PUT `/environments/:id`, DELETE `/environments/:id`. Ownership enforced via `findFirst({ userId })` on every write/read. Zod validates the metadata; `content` is passed through as opaque JSON.

QuickNorm + CustomAlias CRUD (added to close the last localStorage-only slices):
- `QuickNorm` Prisma model: `label`, `searchParams` JSON, `sourceUrl`, `usageCount`, `lastUsedAt`, `userId`. `CustomAlias` model: `trigger`, `aliasType` (new `AliasType` enum: `shortcut` | `reference`), `expandTo`, `searchParams` JSON, `description`, `usageCount`, `lastUsedAt`, `userId`. Custom aliases carry `@@unique([userId, trigger])` so duplicate-prevention happens at the DB, not only in the store; controller catches Prisma P2002 and surfaces 409.
- Routes `/quick-norms` and `/custom-aliases` (authenticate-gated) expose list / create / update / delete, PLUS a dedicated `POST /:id/use` endpoint per entity.
- The `POST /:id/use` endpoints exist for a reason: client code bumps the local `usageCount` instantly for UX and then fires a `.use(id)` Promise that does `prisma.update({ usageCount: { increment: 1 }, lastUsedAt: now })`. This is atomic, so concurrent clicks (or rapid-fire alias resolutions) can't race the counter, and clients don't need to read-modify-write.

### MERL-T Integration (Slice 1, branch `visualex-merlt-main`)

Slice 1 wires 5 user-action signals from VisuaLex into MERL-T's RLCF tracking buffer. Implementation lives across both backends and the frontend; the design doc is `docs/merlt/slices/slice1/design.md`, the smoke checklist is `docs/merlt/smoke-checklist.md`, and the forum attribution decision is `docs/merlt/decisions/forum-authoring.md`.

**Runtime topology.** MERL-T is a separate FastAPI sidecar (Python, port 8000) defined in `docker-compose.merlt.yml` with 5 services: `merlt-api` + `merlt-postgres` + `merlt-redis` + `merlt-falkordb` + `merlt-qdrant`. Source lives in `VisuaLexAPI/merlt/` (selective copy of `ALIS_CORE/merlt` — see `docs/merlt/upstream-sync.md`). Two env flags control startup: `MERLT_ENABLED` gates the whole stack in `start.sh`, `MERLT_API_IN_DOCKER` switches between `--profile api-in-docker` (full container) and local uvicorn. The compose-network host names matter: BFF talks to `merlt-postgres:5432` and `merlt-api:8000` from inside Docker, and `localhost:5436` / `localhost:8000` from the host. `RLCF_DATABASE_URL`, `ENRICHMENT_DB_*`, `REDIS_URL`, `FALKORDB_HOST`, `QDRANT_HOST` are explicit env vars on the merlt-api service — MERL-T code has hardcoded defaults pointing at `localhost:5433/rlcf_dev` which break inside the container network.

**BFF (Node, port 3001).** All MERL-T traffic flows through `/api/merlt/*` — frontend never calls `:8000` directly. Routes:
- `routes/merlt/index.ts` — mount point, **must be registered BEFORE the catch-all auth routers** (folders/bookmarks/etc. use `router.use(authenticate)` with no path prefix, so Express would 401 anything reaching them first; `app.ts` puts `app.use('/api/merlt', merltRoutes)` at line ~71 before the auth-only routers).
- `routes/merlt/consent.ts` — GET/POST/DELETE `/consent` with Prisma transaction (upsert preference + append audit) and the `MerltConsentLevel` enum (none|basic|full); the `preferencesForLevel()` helper in `schemas/merlt/consent.ts` is the single source of truth for the 3 toggles (contribution / validation / graph).
- `routes/merlt/events.ts` — 5 event endpoints (`article-viewed`, `highlight-annotation`, `dossier-bookmark`, `citation-clicked`, `forum-signal`). Each chain: `authenticate → consentGuard → Zod → authorityCache (best-effort) → eventMapper → merltClient.sendEvent → 202 { received, timestamp }`. The `_resetMerltClientForTests` export wipes the singleton client when integration tests swap `MERLT_API_URL`.
- `routes/merlt/health.ts` — GET `/health`, no auth; proxies MERL-T `:8000/health` and surfaces upstream dependency status.
- `routes/merlt/profile.ts` — GET `/profile` reads `MerltUserAuthorityCache` and falls back to cache-only on MERL-T outage (503 only on cache miss + outage).
- `services/merlt/merltClient.ts` — typed HTTP client over native `fetch` + `AbortController`. Hits `/api/v1/tracking/events` (plural, batch-wrapped) and `/api/v1/profile/full` — both prefixes are mandatory. Typed error hierarchy: `MerltTimeoutError` / `MerltServerError` / `MerltBadRequestError` so the route can map 503/passthrough/dead-letter correctly.
- `services/merlt/eventMapper.ts` — 5 `toMerlt*` functions. Each lifts `type` out, puts the rest into `data`, and merltClient wraps as `{events: [{type, data, timestamp}]}` before POSTing. `normalizeArticleUrn()` collapses `art1 bis` / `art1bis` / `art1_bis` / `art1BIS` to the canonical `art1-bis` form (gotcha #9 anti-regression).
- `services/merlt/authorityCache.ts` — 1h TTL, falls back to stale cache when MERL-T is unreachable; returns null only when cache is missing AND sync fails.
- `services/merlt/deadLetterLog.ts` — NDJSON in `backend/logs/merlt-dead-letter.jsonl` when MERL-T is down; skipped in `NODE_ENV=test` unless `MERLT_DEAD_LETTER_LOG_IN_TESTS=1`.
- Prisma models (in main `schema.prisma`): `MerltUserPreference` (consent level + 3 toggles, enum-backed — kept from commit `81be277`), `MerltConsentAudit` (full transition trail with ip/userAgent), `MerltUserAuthorityCache` (added MERLT-1.2 — separated from the PRD-doc's two-bool model in favour of the existing enum design).

**Frontend (`/frontend`).** Plugin host pattern — `ArticleTabContent` does NOT import MERL-T directly:
- `plugins/registry.tsx` + `plugins/types.ts` — typed slot registry. `requiredFlag: 'VITE_FEATURE_MERLT'` gate, default ON (explicit `false`/`0`/`""` to disable). Two slots in use: `article_content_after` (mounts `ArticleMerltSlot` from `ArticleTabContent`) and `global` (mounts `GlobalMerltSlot` from `Layout`, survives route changes).
- `features/merlt/ArticleMerltSlot.tsx` — null-renderer, hosts the 4 article-scoped tracker hooks: `useArticleViewedTracker`, `useHighlightAnnotationTracker`, `useDossierBookmarkTracker`, `useCitationTracker`. The legacy commit-`81be277` Q&A UI is gone (Slice 3 reintroduces it).
- `features/merlt/GlobalMerltSlot.tsx` — null-renderer, hosts `useForumSignalTracker` (forum is outside any article view, needs Layout-level mount).
- `features/merlt/merltEventBus.ts` — pub/sub between call-sites and the trackers. `MERLT_EVENT_TYPES` includes `articleViewed, highlightCreated, annotationCreated, bookmarkCreated, dossierItemAdded, citationClicked, forumLike/Download/SuggestionAccepted/SuggestionDeclined`. The legacy `trackMerltInteraction()` call inside `publishMerltEvent` still hits a 404 endpoint — its catch swallows the warn; new BFF endpoints are reached via the subscriber hooks instead.
- `features/merlt/tracking/useArticleViewedTracker.ts` — IntersectionObserver-based dwell tracker (≥3s OR scroll ≥30%). Fire-and-forget on unmount/visibility-change.
- `features/merlt/tracking/use{HighlightAnnotation,DossierBookmark,Citation,ForumSignal}Tracker.ts` — bus subscribers that filter on `interaction_type`, map metadata → BFF payload, fire-and-forget.
- `features/merlt/consent/{ConsentContext,ConsentDialog,useConsent}.ts` — minimal consent UI (`docs/superpowers/specs/...` describes the full design; Slice 1 ships the read-side, the visible dialog flow is at Slice 3 polish).
- `services/merltService.ts` — typed BFF clients: `sendArticleViewedEvent`, `sendHighlightAnnotationEvent`, `sendDossierBookmarkEvent`, `sendCitationClickedEvent`, `sendForumSignalEvent`. Same shape (`{ received, timestamp }` response) for all.
- Emission call-sites (kept thin — tracker hooks do the BFF talk):
  - `useAppStore.addBookmark` → `bookmark_add`
  - `useAppStore.addToDossier` (type='norma' + urn) → `dossier_item_add`
  - `ArticleTabContent.handlePopupHighlight` → `highlight_create` (with `anchor_text` in metadata)
  - `ArticleTabContent.handleAddNote` → `annotation_create` (with `note_text + anchor_text`)
  - `ArticleTabContent.handleOpenCitationInTab` → `citation_click` (with `source_urn + target_urn + citation_text`)
  - `BulletinBoardPage.{handleLike, handleTakeItem, handleDeclineItem}` → forum signals
  - `ImportEnvironmentModal.handleImport` → `forum_download`

**Testing.** 143 backend tests (vitest + supertest, real Postgres test DB, nock for MERL-T mock). 63 frontend tests (vitest + jsdom, hook tests + plugin registry). Integration test setup: `backend/tests/setup.ts` TRUNCATEs MERL-T tables (`merlt_consent_audits`, `merlt_user_preferences`, `merlt_user_authority_cache`) between tests. Smoke E2E in `docs/merlt/smoke-checklist.md`.

**Critical gotchas:**
1. **Express mount order** beats prefix specificity. `merltRoutes` must be `app.use('/api/merlt', merltRoutes)` BEFORE the catch-all-auth routers; otherwise GET `/api/merlt/health` returns 401 from `folders.ts`'s authenticate middleware.
2. **`rsync --exclude` pattern without leading `/`** matches anywhere in the tree, not just root. The initial MERL-T copy excluded `models/` and `data/` and silently dropped `merlt/merlt/models/` (BridgeMapping) + `merlt/merlt/api/models/` + `merlt/merlt/disagreement/data/`. Always use `--exclude='/models/'` for top-level-only exclusion.
3. **MERL-T tracking — NOW PERSISTED (updated).** Slice 1 originally sent events to an in-memory buffer (`merlt/api/tracking_router.py`) with no table; the RLCF loop closure (A1) added a `tracking_events` table, so events now survive a container restart. The 202 `{ received }` is still the BFF-side confirmation. See the "RLCF loop closure & next phases" section below.
4. **MERL-T endpoint paths use `/api/v1/` prefix** (per `merlt/app.py:175-194`), with `/health` as the only root-level route. The initial Story 1.5 client hit `/api/tracking/event` (singular, no prefix) → 404 in production but green tests with nock mocking the wrong URL. MERLT-1.5.1 fixed this; same pitfall applies if extending the client.

### MERL-T Integration (Slice 2a — Graph read-only, branch `visualex-merlt-main`)

Slice 2a brings the legal knowledge graph (FalkorDB) to the frontend **read-only**, from a pre-loaded Libro IV CC seed (27.7k nodes), with automatic lazy ingestion for articles not yet indexed. Two surfaces: a collapsible **side rail** inside `ArticleTabContent` and a dedicated **`/grafo` explorer page**. Sprint plan: `docs/merlt/slices/slice2a/sprint-plan.md`; seed how-to: `docs/merlt/seed-libro-iv.md`; smoke: `docs/merlt/smoke-checklist.md` (Slice 2a section).

**Seed + worker (MERL-T, Python).** `merlt/merlt/scripts/load_seed_libro_iv.py` runs in the FastAPI lifespan, idempotent (skip if graph >100 nodes), loads `merlt/data/seeds/libro-iv-cc-graph.json` via MERGE on `URN`/`node_id`. Embeddings skipped by default in dev (`MERLT_SKIP_EMBEDDINGS=true` — the e5-large model is ~2s/text on docker CPU). Lazy ingestion runs on an **RQ** worker (NOT arq — arq's redis pin conflicts with falkordb's; see `legacy_libro_iv_recovery` memory), container `merlt-worker`. Endpoints added to `graph_router.py`: `POST /api/v1/graph/ingest-article` (enqueue, job_id = `ingest:`+sha256(urn) for idempotency) + the worker callbacks the **BFF** (not MERL-T) at `/api/merlt/internal/job-callback`.

**BFF (Node, `/api/merlt/graph/*`).** All in `backend/src/`:
- `services/merlt/graphClient.ts` — mirror of `merltClient.ts` (native fetch + AbortController, reuses the typed error hierarchy). Methods: `checkArticle` (returns `{exists}`, NOT `in_graph`), `getSubgraph(urn, depth, maxNodes)`, `ingestArticle(urn, bffJobId)`, `searchEntities(q, limit)` (param is `q`).
- `services/merlt/lazyIngest.ts` — `ensureIngestionJob(prisma, graphClient, urn, userId)`: idempotency `findFirst` on `(articleUrn, status in pending|running)`, else create + best-effort enqueue. **Shared** by the explicit `POST /graph/ingest` route AND the `article:viewed` lazy trigger (gotcha: don't duplicate this logic).
- `routes/merlt/graph.ts` — `GET /graph/article/:urn` (authenticate-only, NOT consent-gated — passive read; reads `depth` 1..3 / `limit` 1..500 from query, clamped via `clampInt`), `POST /graph/ingest` (authenticate+consentGuard), `GET /graph/jobs/:jobId/status` (owner-scoped → no IDOR), `GET /graph/search` (authenticate, 400 on blank q), `POST /internal/job-callback` (internalAuth shared-secret, NO jwt). Registered in `routes/merlt/index.ts` **before** the catch-all auth routers (extends Slice 1 gotcha #1).
- `routes/merlt/events.ts` — the `article-viewed` handler, after forwarding the event, calls `checkArticle`; if `!exists` it `ensureIngestionJob` and enriches the 202 with `{ ingestionJob }`. Fully failure-isolated (dead-letters, never fails the P0 event).
- Prisma `MerltIngestionJob` (`@@map merlt_ingestion_jobs`) + enum `MerltJobStatus {pending running completed failed timeout}` (value `completed`, NOT `succeeded` — matches the worker callback).

**Frontend (`frontend/src/features/merlt/graph/`).** Cytoscape, code-split via `React.lazy`.
- `shared/` — reused by both surfaces: `CytoscapeView.tsx` (default export so it's lazy-importable; registers cose-bilkent/dagre once; manual double-tap detection), `graphStyles.ts` (~20 node labels + 15 rel types + base fallback), `graphTransform.ts` (`transformSubgraphResponse` — drops dangling edges, de-dupes nodes, synthesizes edge id), `useArticleGraph.ts` (discriminated-union async state `idle|loading|success|error` + refetch + stale-response discard; args `(urn, depth, limit?)`), `useIngestionJob.ts` (2s poll, stops on terminal, cleanup on unmount), `graphApi.ts` (typed BFF clients), `types.ts`, `cytoscape-modules.d.ts` (ambient decls — cytoscape 3.33 ships its own types, so `@types/cytoscape` is NOT installed; use `StylesheetJsonBlock[]`, `Css.NodeShape`, `Ext`).
- `side-rail/ArticleGraphSideRail.tsx` — collapsible right rail, mounted via the `article_sidebar` plugin slot (flag `VITE_FEATURE_MERLT_GRAPH`), depth=1 ≤25 nodes, empty→lazy-ingest→poll→refetch, node click → `/grafo?urn=`.
- `page/` — `GraphExplorerPage.tsx` (URL-driven `?urn=&depth=&layout=`, fully deeplink-reproducible), `GraphSearchBox.tsx` (300ms debounce, latest-wins, keyboard nav), `NodeDetailsDrawer.tsx`, `BreadcrumbHistory.tsx` + `useBreadcrumbHistory.ts` (sessionStorage, cap 5, consecutive-dup collapse), `DepthSelector.tsx` + `graphLayouts.ts`. Route `/grafo` + Sidebar entry gated by `featureFlag.ts:isMerltGraphEnabled()`.
- `plugins/PluginSlot.tsx` — the `PluginSlot` component lives here (split out of `registry.tsx` so the registry exports only data/functions — React Fast Refresh boundary). `registry.tsx` keeps `getSlotComponents` + the slot table.

**Slice 2a gotchas:**
1. **cytoscape 3.33 ships its own `.d.ts`** (wins over `@types/cytoscape` → removed to avoid duplicate-identifier conflicts). Stylesheet type is `StylesheetJsonBlock[]`, shapes/line-styles under the `Css` namespace, extensions typed `Ext`. `react-cytoscapejs` + the two layout extensions are untyped → narrow ambient decls in `shared/cytoscape-modules.d.ts`.
2. **`react-hooks/set-state-in-effect`** is enforced. Synchronous `setState` resets at the top of an effect must instead be **derived during render** via a prev-input tracker (`const [tracked,setTracked]=useState(input); if(input!==tracked){setTracked(input); setState(reset)}`) — see `useArticleGraph`, `useIngestionJob`, `GraphSearchBox`. The rule only flags **direct** useState setters, so calling an indirect setter (e.g. a `useCallback` `push`) inside an effect is allowed (used for the deeplink breadcrumb seed).
3. **react-cytoscapejs `cy` callback fires once** (componentDidMount), not per render — but keep tap handlers in refs anyway and scope `cy.removeListener('tap','node')` to nodes.
4. **The BFF `/graph/article/:urn` returns the subgraph verbatim, no 404 for "not indexed"** — an empty `nodes` array IS the "not in graph" signal that triggers lazy ingestion (both side rail and page). `checkArticle.exists` is the explicit probe used by the `article:viewed` trigger.
5. **`MERLT_INTERNAL_SECRET`** (shared worker↔BFF secret) is in `backend/.env.example`. `VITE_FEATURE_MERLT_GRAPH` (default ON) gates the whole graph UI — `false` hides the Sidebar entry, the side rail slot, and renders `/grafo` as "non disponibile".
6. **URN version-marker mismatch (the `!vig=` trap).** The graph seeds Normattiva URNs WITHOUT the version marker (`...~art2043`), but VisuaLex's `norma_data.urn` carries it (`...~art2043!vig=`). Passed verbatim, `check-article`/`subgraph` return `exists:false`/empty → the side rail and `/grafo` spin forever on lazy ingestion. `graphClient.normalizeGraphUrn()` strips everything from the first `!` (the NIR version/annex separator) before every MERL-T graph call. Don't bypass it when adding new urn-keyed graph calls. **Anti-regression (2026-05-29):** the graph key is the FULL Normattiva URL form — `URN`/`node_id` store `https://www.normattiva.it/uri-res/N2Ls?urn:nir:...~art2043` (wrapper INCLUDED), VisuaLex `/parse_query` + `meta.to_urn()` produce the same, and MERL-T matches on exact equality. So `normalizeGraphUrn` (BFF) and `_canonical_urn` (`merlt/pipeline/ingestion.py`) must strip ONLY the `!` marker and **PRESERVE the URL wrapper**. A regression that also stripped the wrapper to bare `urn:nir:...` made every seeded Libro IV article return `exists:false` (empty `/grafo`, infinite lazy-ingest); reverted. The worker's `parse_urn` reads the article straight from the full URL, so the wrapper never needs stripping. Guarded live by `scripts/merlt-live-smoke.sh` (art 2043 → 26 nodes).

### MERL-T Integration (Slice 2b — Hub & Consent, branch `visualex-merlt-main`)

Slice 2b turns `/merlt` from a dead developer UI (5 JSON tabs calling unmounted endpoints) into a user-facing **hub**, and fixes the fragmented consent. Design: `docs/merlt/slices/slice2b/design.md`; sprint plan: `docs/merlt/slices/slice2b/sprint-plan.md`.

**Consent = server SoT, client = synced cache.** The Prisma `MerltUserPreference` + BFF `GET/POST/DELETE /api/merlt/consent` (body `{ level, reason? }`) is authoritative; the server `consentGuard` is the hard gate (defence in depth). Frontend:
- `features/merlt/consent/context.ts` — the React `ConsentContext` object + `ConsentContextValue` type, kept in a non-component file (react-refresh/only-export-components boundary, same split as graph's `PluginSlot`).
- `features/merlt/consent/ConsentContext.tsx` — `ConsentProvider` (mounted in `App.tsx` wrapping the authenticated `Layout`). Hydrates via `GET /consent` on mount (inline `.then/.catch`, never a synchronous in-effect setState), exposes `setConsent`/`revokeConsent`/`refresh`, and writes the level to `localStorage` (now a **boot cache only** — server wins on reconcile). `inFlightRef` prevents overlapping fetches.
- `features/merlt/consent/useConsent.ts` — consumer hook (throws outside provider). Exposes `level`, `canTrack`, `status`.
- `features/merlt/merltConsent.ts` — repurposed as the boot cache (NOT SoT).
- The 5 Slice 1 trackers now gate on `useConsent().canTrack` instead of `hasMerltConsent()` localStorage. Bus-subscribers hold the live value in a `canTrackRef` updated in a `useEffect` (NOT during render — react-hooks/refs). `useArticleViewedTracker` keeps `canTrack` OUT of its main effect deps and gates the cleanup-path emission on `canTrackRef.current`, because the effect cleanup runs BEFORE the ref-sync effect — including `canTrack` in deps would emit a stale `true` on revoke (gotcha below).

**Feature gating is derived client-side — there is no `GET /api/merlt/features`** (it was never implemented; the dependency is removed). `features/merlt/useMerltFeatures.ts` combines `isMerltEnabled()` (flag `VITE_FEATURE_MERLT`) + `isMerltGraphEnabled()` + `useConsent().level` + `useAuth().isAdmin` into `{ merltEnabled, graphEnabled, consentLevel, canTrack, canContribute, canValidate, graphReadable, opsVisible }`. `canContribute/canValidate = level==='full'`; `opsVisible = isAdmin`.

**Consent UI.** `ConsentDialog.tsx` (3 levels none/basic/full with privacy-first copy, granular capability preview) and `ConsentBanner.tsx` (non-blocking first-run prompt). The banner mounts on the `global` plugin slot (via `GlobalMerltSlot`) and triggers only on the **real RLCF bus events** (`TRACKED_EVENT_TYPES` set), not passive ones like `scroll`/`text_selection`. `pages/MerltHubPage.tsx` is the dashboard (replaces the deleted `MerltWorkspacePage`): consent/profile/graph cards + "in arrivo" placeholders + an admin-only ops card.

**BFF.** `middleware/merlt/requireAdmin.ts` (after `authenticate`, 403 `admin_required` if `!req.user.isAdmin`) — scaffold for the Phase-4 ops routes; today the consent route was already correct (the bug was the old client `PUT { consentLevel }`).

**Slice 2b gotchas:**
1. **Consent revoke + tracker cleanup ordering.** React runs an effect's cleanup BEFORE the ref-sync effect on a re-render, so a `canTrack`-in-deps tracker would fire its cleanup-path emission with the stale `true`. Keep `canTrack` out of the main effect deps and gate on a separately-synced `canTrackRef.current`, which is correct at unmount/article-change.
2. **The consent route is correct; the client was the bug.** Use `setMerltConsent(level, reason?)` (POST) / `revokeMerltConsent` (DELETE) — never reintroduce a PUT or `{ consentLevel }`.
3. **`MerltEventResponse` is `{ received, timestamp }`**, NOT `{ trace_id }` — the BFF `/events/*` 202 shape. `ArticleViewedEventResponse` additionally carries optional `ingestionJob` (Slice 2a lazy trigger).

### MERL-T Integration (Slice 2c — "Apprendi dai miei appunti", branch `visualex-merlt-main`)

Upload study notes → async LLM extraction → per-item review → promotion to RLCF `pending_*`. Design: `docs/merlt/slices/slice2c/design.md`; sprint plan: `docs/merlt/slices/slice2c/sprint-plan.md`. Depends on Slice 2b consent (`full`).

**Load-bearing model (resource cost, not privacy):** the server hosts ONLY the central graph + RLCF proposals — no per-user graphs. Extracted candidates live in an **ephemeral** MERL-T `extraction_candidates` staging table (purged after promotion / TTL); the verbatim NEVER enters `pending_*`. The user's "personal slice" is a **local snapshot** (download/reload, `snapshotIO.ts`). Promotion creates fresh `pending_*` rows from the **reformulated** text.

**BFF (`/api/merlt/contrib/*`)** — done & tested (205 BE tests):
- `services/merlt/contribClient.ts` — mirror of graphClient; `uploadDocument` (multipart→MERL-T `/documents/upload`), `extractAsync`, `listCandidates`, `getCandidate`, `proposeEntity/Relation`, `markPromoted`.
- `services/merlt/promotionGate.ts` — **copyright gate** (`fonte` non-empty AND text ≠ verbatim AND `attested`). Enforced server-side, not just UI.
- `services/merlt/contributionGuard.ts` — requires consent level `full` (stricter than `consentGuard`).
- `routes/merlt/contrib.ts` — `POST /contrib/documents` (multer, validates PDF/TXT/DOCX ≤50MB before forward), `/documents/:id/extract` (creates `MerltExtractionJob`, enqueues), `/documents/:id/candidates` (IDOR-scoped), `/jobs/:jobId/status` (owner-scoped), `/candidates/:id/promote` (gate→propose→markPromoted), `/internal/extraction-callback` (internalAuth). Registered in `routes/merlt/index.ts` BEFORE the catch-all auth routers.
- Prisma `MerltExtractionJob` (`@@map merlt_extraction_jobs`, reuses `MerltJobStatus`).

**Frontend (`features/merlt/contrib/`)** — done & tested (190 FE tests): `UploadDropzone`, `useExtractionJob` (2s poll, mirrors `useIngestionJob`), `CandidateCard` (gate UI: promote disabled until fonte+reformulation+attestation), `CandidateReviewList`, `snapshotIO` (local export/import), `ContribPage` (orchestrator; route `/merlt/contribuisci`, lazy). Hub "Contributi" card links here when `canContribute`.

**MERL-T side (Python, vendored `merlt/`)** — DEPLOYED to the live stack (`ExtractionCandidate` model + migration `005`, `document_parser.py` `persist_target="staging"` branch, `worker/extraction_tasks.py` `extract_to_staging`, `document_router.py` extract-async/candidates + `candidates_router`). Gap-closure additions (also live): **#3** the parser sets `expires_at` (env `MERLT_STAGING_TTL_HOURS`=48), the worker deletes the uploaded file post-extraction, and `list_document_candidates` lazy-purges promoted+expired rows; **#4** the parser staging branch runs `EntityDeduplicator.find_duplicates` (best-effort) to set `potential_duplicate_of`.

**Validation (Slice 2c #8) — vote on the community's pending proposals.** BFF `routes/merlt/validate.ts` (`GET /validate/pending`, `POST /validate/entity|relation`, gated by `validationGuard` = full consent) + contribClient `getPending/validateEntity/validateRelation` (votes carry `user_id`=VisuaLex id; `VoteType` = approve|reject|edit). FE `features/merlt/validate/` (`validateApi` + `ValidationPage`), route `/merlt/valida`, hub card. The local-snapshot affordance (#7) lives on `/grafo` (`graph/shared/snapshotIO.ts` + Esporta/Carica slice in `GraphExplorerPage`), NOT in contrib.

**Deferred by decision: relation EXTRACTION from free-text notes (#5).** MERL-T has no free-text relation extractor (`MechanisticExtractor` is Brocardi-structured-data only; the LLM extractors cover concept/principle/definition entities). The relation *path* (staging schema, `CandidateCard`, `proposeRelation`) is complete — only producing relation candidates from notes is absent (a new research-grade LLM extractor). Entities-first is the MVP.

**Slice 2c gotchas:**
1. **MERL-T `parse_document` was SYNC + wrote straight to `pending_*`.** Slice 2c adds the async staging path (`persist_target`); the legacy sync path is unchanged. The personal staging level did not exist before.
2. **`user_id` is a varchar(100) string everywhere toward MERL-T** (the VisuaLex user id), never an FK.
3. **Copyright gate lives in `promotionGate.ts` and is re-checked server-side against the AUTHORITATIVE verbatim** fetched from MERL-T (`getCandidate`) — the client cannot supply the verbatim.
4. **RQ job ids cannot contain `:`** (this RQ version validates `[A-Za-z0-9_-]`). The extraction job id is `"extract-"+sha256(docId)` (dash, not colon). The graph `"ingest:"` prefix predates this RQ and would break the same way if re-enqueued.
5. **`merlt-api` must define `RQ_REDIS_URL`**, not just the worker — the api is what ENQUEUES (extract-async / ingest-article). Without it the api defaults to `localhost:6379` inside the container and enqueue fails (`Connection refused`). Added to `docker-compose.merlt.yml` api env.
6. **The RQ worker has NO FastAPI lifespan**, so `init_db()` (enrichment Postgres engine) is never auto-called — any worker task that opens `get_db_session()` must `await init_db()` first (idempotent: guarded on `_engine is not None`). The graph ingest task sidesteps this by using FalkorDB only. MERL-T code in `merlt/` is **baked into the image at build** (only `data/` is volume-mounted) → code changes need a `docker compose --profile api-in-docker build` + recreate; the staging table auto-creates at api boot via lifespan `create_tables()`.

### MERL-T Integration (RLCF loop closure & next phases, branch `visualex-merlt-main`)

**Read `docs/merlt/system-map.md` first** — it's the canonical map (implemented vs. target, the two loops, the open reconciliations). Docs index: `docs/README.md`. All MERL-T docs now live under `docs/merlt/` (overviews + `slices/<slice>/{design,sprint-plan}.md` + `decisions/`).

**"RLCF" is TWO loops sharing authority + consensus** — don't conflate them:
- **Loop α — graph enrichment / co-authorship.** contribute/notes → LLM extract (ephemeral `extraction_candidates` staging) → reformulate behind the copyright gate → `pending_entity`/`pending_relation` → authority-weighted vote → **net_score ±2.0 → PostgreSQL trigger sets `consensus_reached`** → write node/edge to FalkorDB → navigable on `/grafo`. **Closed E2E (2026-05-28)**, plan `docs/merlt/slices/rlcf-loop/sprint-plan.md`.
- **Loop β — reasoning / answer quality.** query → gating → experts + traversal → synthesis → multilevel feedback → REINFORCE on gating/traversal weights. **Built in the vendored library, NOT wired into VisuaLex** (the Q&A UI was removed → Slice 3) and carrying known pipeline bugs.

**Loop-closure facts (these SUPERSEDE earlier Slice-1 notes):**
- Consensus runs on **PostgreSQL triggers** (`merlt/storage/enrichment/consensus_triggers.py`, idempotent, hooked to the FastAPI lifespan). **`create_tables()` creates tables, not triggers** — the missing trigger install was the real reason votes never promoted (it was NOT "aggregation never invoked").
- **Tracking is now persisted** (`tracking_events` table, A1) — supersedes Slice 1 gotcha #3.
- **Training is manual, admin-only:** BFF `POST /api/merlt/ops/training/start` (`requireAdmin`) → MERL-T `/api/v1/rlcf/training/start`. No auto-training at boot.
- **B1 added free-text relation extraction** from notes (the Slice 2c "deferred #5" is now done).
- **Durability:** Python changes are baked at build → `docker compose -f docker-compose.merlt.yml --profile api-in-docker build` + recreate **both** `merlt-api` and `merlt-worker`; tables/triggers auto-create at boot via lifespan.

**Next phases (entry points):**
1. **Co-authorship UX — Loop α, phases 3–7 (immediate direction).** Brief + philosophy: `docs/merlt/coauth-ux-prompt.md`. Hard rule: *provenance & deliberation in legal lexicon, never gamification/scores* (no gold rings, progress bars, or point counters). Reuse `AttributionChip` (`components/features/bulletin/`), the dossier 4px status stripe (`STATUS_CONFIG` in `dossierUtils.ts`), and `<details>`. Surfaces to touch: `NodeDetailsDrawer` (provenance "Proposto da @X · su fonte · accolto il…"), `ValidationPage` (vote framed as *adesione/dissenso*; consensus shown as a discreet status stripe, never a progress bar), `MyContributionsCard` (track a proposal's fate). Always brainstorm → spec → plan before building.
2. **Slice 3 — Q&A / reasoning (Loop β).** **Blocked on pipeline fixes first:** per `ALIS_CORE/merlt/docs/architecture/PIPELINE_ANALYSIS.md` the 4 experts receive identical retrieval, `GraphSearchTool` is broken (`.execute_query` vs `.query`), and source grounding is ~20%. Sanitize the retrieval pipeline before exposing Q&A. The legacy Q&A UI lived at commit `81be277`.
3. **Open reconciliations** (system-map §8): consent enum mapping (`none/basic/full` ↔ upstream `Basic/Learning/Research`); canonical authority weights (`0.4/0.4/0.2` vs `0.3/0.5/0.2`); authority calibration (random-noise inflation in EXP-023) and temporal decay (`λ=0.95`) not yet implemented.

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

Uses Zustand for global state with the following slices:

Server-backed (hydrated by `fetchUserData` on login/refresh, mutated via optimistic+sync actions):
- **Bookmarks** — `bookmarkService`, table `bookmarks`
- **Dossiers + items** — `dossierService`, tables `dossiers` / `dossier_items`
- **Environments** — `environmentService`, table `environments`
- **QuickNorms** — `quickNormService`, table `quick_norms` (usage counter via atomic `POST /:id/use`)
- **CustomAliases** — `customAliasService`, table `custom_aliases` (unique `(userId, trigger)` at DB level, usage counter via atomic `POST /:id/use`)
- **Annotations** — `annotationService`, table `annotations` (hydrated per-article by `loadAnnotationsForArticle`)
- **Highlights** — `highlightService`, table `highlights` (hydrated per-article)
- **History** — `/history` API

UI-only (persisted in `localStorage` via Zustand `persist`, partialize list):
- **Search Results / Workspace** — active norm cards, tabs, highest z-index
- **Settings** — theme, API endpoint, studyMode preferences
- **searchPanelState** — panel open/close, last parsed query

The store is located in `frontend/src/store/useAppStore.ts` and uses Immer. Every user-data slice is now server-backed; the partialize intentionally keeps only UI state. See gotcha #17 for the rule every new user-owned slice must follow.

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

### Annotations (Notes) UX

Notes on articles are surfaced through a **Peek popover** (desktop) / **bottom sheet** (mobile) anchored to the StickyNote toolbar button, plus a **compact inline popover** triggered by clicking the `.note-anchor` wavy underline in the article body. The previous always-visible `NotesPanel` above the article was removed because it occupied vertical space even when not needed.

Files:
- `components/features/search/NotesPeekPanel.tsx` — toolbar-anchored popover with list + inline edit + composer + "Apri in Modalità Studio" escape hatch
- `components/features/search/InlineNotePopover.tsx` — single-note mini popover, anchored to the wavy span, for quick-look
- `hooks/useArticleMarkers.ts:82` — renders the wavy `<span class="note-anchor" data-note-id="…">` for each anchored annotation. Click delegation is in `ArticleTabContent` (`contentRef` listener)

Store actions (`useAppStore.ts`):
- `addAnnotation` / `removeAnnotation` / `updateAnnotation(id, newText)` — all optimistic with server sync via `annotationService`. Revert on error.
- `updateAnnotation` powers the inline edit: click a note → textarea; blur commits, Escape cancels, Cmd/Ctrl+Enter commits explicitly. Empty trimmed input reverts to original.

Note lifecycle:
- **Anchored**: created via "Aggiungi nota" from SelectionPopup → `noteAnchor` state → Peek auto-opens with composer pre-focused. On save the backend stores `anchorText + startOffset`, which the marker pipeline uses to paint the wavy underline.
- **Free**: just open the Peek and type. No anchor, shown in the "Libere" group.

Export to `.txt`: a Download icon in the Peek header dumps the article's notes (anchored + free) into a UTF-8 text file. Plumbing lives in `ArticleTabContent` (`downloadTxt` + `slugify` + `articleHeader` helpers) — shared with the highlights export so a future export consumer is a one-liner.

### Highlights UX

Creation of new highlights happens **only** in `SelectionPopup` (the toolbar's button is *not* a second creator — that pattern was tried and rolled back). The Highlighter button in the reading toolbar opens a small **tooltip-style action bar** (`HighlightsActionsPicker.tsx`) with two icon-only buttons:
- **Eye / EyeOff** — toggles a `.highlights-hidden` class on the article body's contentRef. CSS overrides the `--hl-*-bg` HSL variables to alpha-0 so the inline `style="background-color: hsl(var(--hl-*-bg))"` on every `<mark>` resolves to transparent (no `!important` needed for the bg). A single targeted `color: inherit !important` on `.highlight-mark` handles the fg, since `hsl(...)` cannot accept `inherit` via a variable. The markup stays intact, re-toggling restores the colors.
- **Download** — exports the article's highlights to `.txt`, same plumbing as notes.

Both actions disabled with explanatory tooltip when count is 0. Picker style mirrors `SelectionPopup`: dark slate background, ~88px wide, two icon buttons separated by a 1px slate divider, no chrome.

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
- **Article unique IDs** (frontend): Use `src/utils/articleIds.ts`:
  - `getUniqueArticleId(article)`: canonical encoding `allN:num` for annex entries, plain `num` otherwise. Used across NormaCard, NormaBlockComponent, and `useAnnexNavigation`. Never reimplement the `all${allegato}:${num}` string inline.
  - `filterLoadedIdsForAnnex(ids, annex)`: project a list of loaded uniqueIds down to plain article numbers in the current annex context (strips prefix). Replaces the previous ~4 inline copies.
  - `findArticleByNormalizedId(articles, id)`: **tolerant** lookup — matches on `normalizeArticleId` so "1-bis" (tree API) and "1 bis" (scraper) resolve to the same article. Required because the two sources disagree on `-bis/-ter/-quater` formatting.
- **Norma meta line** (frontend): Use `src/utils/normaMeta.ts`:
  - `formatNormaMeta(norma, { variant, articleCount? })`: single source for the "alias vs date + number" subtitle. Variants are `'card-mobile'`, `'card-desktop'`, `'block'` — preserve the three historical phrasings ("Data:", "Edizione del", bare). Never duplicate the conditional JSX.

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

### Frontend: UI Conventions

These are non-obvious conventions baked into the codebase — respect them when adding new interactive surfaces so the app stays coherent.

**Destructive confirmations**
- Never use `window.confirm` for delete/close actions. Use `components/ui/ConfirmDialog` with `variant="danger"`; message should name the scope and clarify what is NOT touched (e.g. "Gli articoli salvati nei segnalibri e dossier non saranno toccati").
- Currently in use by: tab close (`WorkspaceTabPanel`), norma delete (`NormaBlockComponent`), loose article delete (`LooseArticleCard`).

**Keyboard-accessible collapsibles**
- Any `<div>` with `cursor-pointer` + `onClick` that toggles a section must also have: `role="button"`, `tabIndex={0}`, `aria-expanded={isOpen}`, `aria-label` (dynamic "espandi" / "comprimi"), and `onKeyDown` handling Enter / Space with `e.preventDefault()`.
- The `onKeyDown` must short-circuit with `if (e.target !== e.currentTarget) return;` — otherwise interactive children (close buttons, etc.) re-trigger the collapse on Enter/Space.
- Always include `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2` on the wrapper.

**Popover anchoring with `@floating-ui/react`**
- Split positioning and animation onto **two elements**: outer `<div ref={refs.setFloating} style={floatingStyles}>` keeps floating-ui's positioning transform; inner `<div className="animate-in fade-in zoom-in-95" style={{ transformOrigin }}>` owns the entry animation. If you put them on the same element the scale transform overwrites the positioning transform and the popover visibly flies from (0,0) for ~150ms.
- Compute `transformOrigin` from `placement` (see `getTransformOrigin` in `NotesPeekPanel.tsx`) so the popover grows from the anchor edge rather than its geometric centre.
- Anchor using a **state** (`useState<HTMLElement | null>` + callback ref) rather than a ref object: reading `ref.current` in render triggers `react-hooks/refs` lint and can miss the initial mount.

**Toggle buttons (e.g. quick norm, bookmark)**
- When the same click both adds and removes, drive the visual from an `isPressed` selector, not a fixed colour. Idle: `text-slate-400 + hover:text-{accent}`; active: `bg-{accent}-50 text-{accent}` (plus `fill-{accent}` on the icon if it has a fillable body). Toast text must match the real action ("Aggiunto" / "Rimosso"). Always set `aria-pressed`.

**Two flavours of toolbar pop-ups**
- *Peek* (e.g. `NotesPeekPanel`) — a panel with a header, scrollable body, composer/footer. Use when the surface lists/edits content. Width ~360px, light bg matching the page theme.
- *Action bar* (e.g. `HighlightsActionsPicker`, `SelectionPopup`) — a thin dark slate bar with 2-4 icon-only buttons separated by 1px dividers, no chrome. Use when the surface is purely "perform action X". Width auto. Both flavours share the same outer/inner split pattern from the floating-ui rule above.

**Sticky filter rows inside scrollable lists**
- `sticky top-0` alone is not enough — the row needs an **opaque background** that matches the panel's bg, otherwise content scrolls *through* it. Theme-tokenised: register a `filterBg` colour in the panel's THEME_STYLES record.
- Use negative-margin bleed (`-mx-N -mt-N -top-N` matching the parent's `pN`) to extend the opaque bg edge-to-edge over the panel's padding. Pair with `border-b border-current/10` so the boundary is visible while scrolling.
- Bump `z-index` to `z-20` (above any in-flow card decoration that uses `z-10`).

**Beating inline `style="..."` without `!important`**
- When markup ships with inline styles you don't control (e.g. `useArticleMarkers` emits `<mark style="background-color:hsl(var(--hl-yellow-bg))">`), a class-level CSS rule loses specificity. Two safe escape hatches in priority order:
  1. **Override the CSS variable** in a narrower scope (e.g. `.highlights-hidden { --hl-yellow-bg: 0 0% 0% / 0; }`) so the inline `hsl(var(--…))` resolves differently. Same property, narrower scope wins, no `!important` needed.
  2. If the inline style references no variable (or the variable can't yield the value you need), fall back to **a single, narrowly-scoped `!important`** with a code comment justifying why every other route fails. The repo rule against `!important` has this carve-out — don't sprinkle.

**Card markers vs saturated backgrounds**
- For lists that mirror something already coloured in the article body (highlights summary, etc.), prefer a **4px coloured stripe down the leading edge** of the card over re-applying the saturated background to the text inside. The colour signal is preserved, the text stays legible against any theme, and you avoid duplicating the bg the user already sees in context.

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
- `REDIS_ENABLED`: `true`/`false` (default: `false`). When `false`, the cache uses filesystem backend (per-instance). A warning is logged at startup.
- `REDIS_URL`: Redis connection string (default: `redis://localhost:6379/0`)
- `REDIS_CACHE_PREFIX`: Key prefix for cache entries (default: `vlx`)
- `PERSISTENT_CACHE_TTL`: Cache TTL in seconds (default: `86400`)
- `HTTP_MAX_CONCURRENCY`, `HTTP_TIMEOUT`, `HTTP_MAX_RETRIES`, etc.: HTTP client tuning (see `config.py`)

Node.js Backend: See `backend/.env.example` for required variables. `REDIS_ENABLED` defaults to `"true"` in the example to mirror production topology — set to `"false"` if running dev without a Redis instance (rate limiter will use in-memory fallback with warning log).

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
- Article unique IDs: Use `articleIds.ts` (getUniqueArticleId, filterLoadedIdsForAnnex, findArticleByNormalizedId)
- Norma meta line: Use `normaMeta.ts` (formatNormaMeta)
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
- `frontend/src/utils/articleIds.ts` - Article uniqueId encoding + tolerant normalized lookup (used by containers + `useAnnexNavigation`)
- `frontend/src/utils/normaMeta.ts` - Shared alias/regular meta line formatter (used by NormaCard mobile+desktop, NormaBlockComponent)
- `frontend/src/hooks/useAnnexNavigation.ts` - Shared tree-fetch + annex switch + load-article hook for both containers
- `frontend/src/components/features/search/NotesPeekPanel.tsx` - Toolbar-anchored notes popover (replaces the legacy inline NotesPanel)
- `frontend/src/components/features/search/InlineNotePopover.tsx` - Click-on-wavy-underline mini popover (view/edit a single existing note)
- `frontend/src/components/features/search/InlineNoteComposer.tsx` - Tooltip-style composer anchored on the text selection when the user picks "Aggiungi nota" from SelectionPopup. Uses a floating-ui VirtualElement built from the captured selection rect (the range itself gets cleared when SelectionPopup hides). Toolbar button still opens the full Peek; the Peek's anchor-composer path is now this component.
- `frontend/src/components/features/search/HighlightsActionsPicker.tsx` - Tooltip-style action bar (toggle visibility + export .txt) — no creator, that's `SelectionPopup`'s job
- `frontend/src/components/features/workspace/StudyMode/StudyModeSummary.tsx` - Study Mode unified list of highlights+notes with filter row + colour stripes
- `frontend/src/components/features/workspace/StudyMode/StudyModeToolsPanel.tsx` - Study Mode side panel hosting the tabs (Riepilogo / Note / Evidenze)
- `frontend/src/components/features/dossier/` - Dossier is split across multiple files (was a 1366-line monolith): `DossierPage.tsx` is a thin shell that routes list/detail via `?dossier=<id>`, `DossierListView.tsx` hosts the grid + card context menu + page-scoped shortcuts (`n` / `/` / `i`), `DossierDetailView.tsx` hosts the single-dossier view. Modals live one-per-file (`EditDossierModal`, `ImportDossierModal`, `MoveToDossierModal`, `TreeNavigatorModal`, `ArticleViewerModal`, `OpenOnDashboardPicker`, `AddNoteModal`). Shared helpers (`formatTimestampLong`, `STATUS_CONFIG`, `computeNormaGroups`, `computeStatusBreakdown`, `NormaGroup`) live in `dossierUtils.ts`. The item row component is `SortableDossierItem.tsx` (renders the 4px leading-edge status stripe from `STATUS_CONFIG[x].stripe`). Toolbar buttons across mobile + desktop come from `ToolbarButton.tsx` — a color-token-driven component with `pressed`/`pressedColor` for toggle behaviour (pin is the canonical toggle: `color="slateMuted" pressedColor="yellow"`). Never add new dossier features inline in `DossierPage.tsx` — it's intentionally minimal.
- `frontend/src/components/features/environments/` - Environments split across multiple files (was a 1281-line monolith): `EnvironmentPage.tsx` is a thin shell that owns state + handlers + JSX wiring; `EnvironmentCard.tsx` is the grid card; each modal has its own file (`CreateEnvironmentModal`, `EditEnvironmentModal`, `ImportPreviewModal`, `ApplyEnvironmentModal`, `EnvironmentDetailModal`). `EnvironmentContentViewer.tsx` is the shared dossier/quickNorm/alias/annotation/highlight tree renderer (both preview + selection). Cards carry a 4px leading-edge stripe keyed by `category.color` (an `hsl(var(--category-X))` CSS variable), an inline preview of the first 3 dossiers + 2 quick norms, and a stale/fresh chip driven by `updatedAt ?? createdAt` via `date-fns` + `it` locale. Card primary is "Unisci" (direct merge, no intermediate modal); replace lives as an amber voice "Sostituisci tutto…" in the 3-dot menu and routes through the shared `ConfirmDialog variant="danger"` in the parent. Page-scoped shortcuts `n` / `/` / `i` mirror the dossier list. Delete confirmation uses the shared `ConfirmDialog` (no more `DeleteConfirmModal` — that file was removed as part of the polish round). `ApplyEnvironmentModal` remains alive and reachable from `EnvironmentDetailModal` for the "consider + choose merge/replace" path.
- `frontend/src/components/features/bulletin/` - Forum (user-facing name) page split across multiple files (was a 914-line monolith). Folder/component names stay `bulletin` / `BulletinBoardPage` because the tech identifier aligns with the backend `SharedEnvironment` model; the URL path is `/forum` and the UI label is "Forum" (commit `ccb34cc`). `BulletinBoardPage.tsx` is a thin shell owning tab state, data fetches, modal wiring, toast, and tour trigger (`tryStartTour('forum')` on mount). The three tab bodies are dumb views: `ForumExploreView.tsx` (filters + grid + pagination + reset-filters empty state), `ForumMyEnvironmentsView.tsx` (owner-action grid), `ForumSuggestionsView.tsx` (received/sent sub-tabs). `SharedEnvironmentCard.tsx` carries a 4px leading-edge stripe driven by the hex map in `CATEGORY_STRIPE` (EnvironmentCategory has no CSS var equivalent, so inline style — same visual pattern as `SortableDossierItem` / `EnvironmentCard`), the category/version/badges/menu micro-header above the title, and an absolute-timestamp tooltip on the relative time label (prefers `updatedAt` when delta from `createdAt` is ≥1s, label "Aggiornato …" vs "Creato …"). Delete confirmation uses shared `ConfirmDialog variant="danger"` with wording spelling out the forum-level purge (all versions + likes + reports). Empty state in Explore splits into filtered (variant="search" with "Azzera filtri") vs genuine empty via shared `EmptyState` component. First card in the grid carries `tour-forum-card` / `tour-forum-actions` DOM ids via the `isFirst` prop — only Explore sets this (My tab intentionally omits to avoid duplicate ids since the tour starts on mount in Explore). Suggestion rework (Aprile 2026) added: `SuggestionReviewDialog.tsx` (owner-side per-item review modal, Flow 2), `EditSuggestionDialog.tsx` (suggester-side edit modal, Flow 3), `SuggestionItemCard.tsx` (polymorphic renderer for all 5 itemTypes — annotation/highlight/dossier/quickNorm/alias — used in both dialogs), `AliasConflictDialog.tsx` (Replace/Skip mini dialog for 409 alias conflict; Rename is MVP-deferred per gotcha #20), `AddItemsDialog.tsx` (scoped "append" picker launched from Edit dialog), `AttributionChip.tsx` (shared `da @mario` chip rendered on every taken-content surface — see gotcha #21).

**Backend:**
- `backend/prisma/schema.prisma` - Database schema (now includes `Environment`, `QuickNorm`, `CustomAlias`, `AliasType` enum)
- `backend/src/controllers/environmentController.ts` - Personal environment CRUD (separate from `SharedEnvironment`)
- `backend/src/controllers/quickNormController.ts` - QuickNorm CRUD + atomic `useQuickNorm`
- `backend/src/controllers/customAliasController.ts` - CustomAlias CRUD + atomic `useCustomAlias`; maps Prisma P2002 to 409
- `backend/src/routes/environments.ts`, `quickNorms.ts`, `customAliases.ts` - each mounts on `/api`, all routes authenticate-gated

**Frontend services (server sync):**
- `frontend/src/services/environmentService.ts` - `getAll / getById / create / update / delete`
- `frontend/src/services/quickNormService.ts` - CRUD plus `use(id)` for atomic usage bump
- `frontend/src/services/customAliasService.ts` - CRUD plus `use(id)` for atomic usage bump
- `frontend/src/services/annotationService.ts`, `highlightService.ts` - include `deleteAll()` (used by `applyEnvironment(replace)`)

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
9. **Article ID formatting mismatch (-bis / -ter / -quater)**: the tree API and the scraper can disagree on suffix formatting (`"1-bis"` vs `"1 bis"`). A naive `===` comparison between a tree-sourced uniqueId and a loaded-article uniqueId will silently miss the match and fall back to the first article on arrow navigation. **Always** use `findArticleByNormalizedId` from `utils/articleIds.ts` for lookups that might cross this boundary, and canonicalize the matched article's uniqueId (`getUniqueArticleId(match)`) before writing it to component state.
10. **Popover positioning vs. entry animation conflict**: `@floating-ui/react` positions its floating element with an inline `transform: translate(X,Y)`. Applying `animate-in zoom-in-95` on the **same** element overwrites that transform during the entry keyframes, so the popover visibly flies from (0,0) for ~150ms. Split the two: outer div = positioning, inner div = animation (see `NotesPeekPanel.tsx` / `InlineNotePopover.tsx`).
11. **`set-state-in-effect` lint rule**: when React's `react-hooks/set-state-in-effect` flags a `setState(...)` call inside a `useEffect`, prefer deriving the value during render (see `effectiveTabId` / `effectiveActiveId` in the norma containers) instead of silencing. Only silence for effects that synchronise with an external signal AND mutate external state in the same transaction (the R2 autoFocus effect in `NormaBlockComponent` is the canonical example — always leave the justification in a trailing comment on the disable line).
12. **Workspace tab pin removed**: the `WorkspaceTab.isPinned` flag and `toggleTabPin` action were removed (the only behavioural effect was "don't bring pinned tabs to front on click", which contradicted the word "pin" and never protected from close). **Do not reintroduce without a clear product reason**. `Dossier.isPinned` is unrelated and stays.
13. **Popover first-paint (0,0) flash — pass reference at render time, not in a layout effect**: `@floating-ui/react` computes position asynchronously (`computePosition` returns a Promise). If the reference is registered via `refs.setReference(el)` inside a `useLayoutEffect`, the FIRST paint has no coords — the floating div renders at document (0,0) top-left, which on a scrolled article is above the viewport and looks like "the popup disappeared". Fix for DOM elements: pass it through `useFloating({ elements: { reference: anchorEl } })` — floating-ui computes synchronously during the hook call. For **virtual** elements (e.g. a rect captured from `window.getSelection()`): the `elements.reference` path is rejected at runtime with "must be a real DOM element", so use `refs.setPositionReference(virtual)` in a layout effect AND gate visibility with `isPositioned` (`style={{ ...floatingStyles, visibility: isPositioned ? 'visible' : 'hidden' }}`) to hide the first unpositioned frame. Applies to `InlineNotePopover`, `NotesPeekPanel`, `HighlightsActionsPicker` (DOM-element path) and `InlineNoteComposer` (virtual-element path).
14. **StrictMode double-invoke + multi-step store actions**: React dev StrictMode double-invokes every `useEffect` on mount. If your effect issues two SEPARATE store mutations — e.g. `dequeueNextSearch()` then `triggerSearch(next)` where `next = searchQueue[0]` comes from the render closure — both invocations use the SAME closure value and execute the same side-effects in sequence (dequeue+trigger the SAME first item twice), losing subsequent queued items. **Fix**: collapse to a single atomic store action (`drainNextSearch`: one `set()` that checks preconditions, pops, and parks the trigger). The second StrictMode invocation finds the precondition already satisfied (e.g. `searchTrigger` non-null) and no-ops. This is the root cause we hit on the dossier "apri tutte le norme" flow — keep multi-step drains atomic.
15. **Dossier "apri tutte le norme in una tab unica"**: `triggerSearch` overwrites `state.searchTrigger`, so firing N calls in a loop keeps only the last. The dossier open-all flow uses a `searchQueue` drained one item at a time via `drainNextSearch` (see #14). Each queued `SearchParams` carries two complementary fields: `tabLabel: dossier.title` (cosmetic, sets the tab's visible name) AND `targetTabId` (load-bearing, tells `processResult` to skip all merge heuristics and always call `addNormaToTab(targetTabId, ...)`). The destination tab is **pre-created** synchronously before `navigate('/')`: `addWorkspaceTab(dossier.title, undefined, undefined, { isCustom: true })` returns the id that gets threaded into every params. Without `targetTabId` the streaming merge logic in `processResult` might find a stale orphan custom-labeled tab in the persisted `workspaceTabs` and append into THAT instead — `targetTabId` is the unambiguous pointer. Single-norma opens also use this pattern for consistency.
16. **SelectionPopup → downstream composer: capture selection rect eagerly**: when a SelectionPopup action (e.g. "Aggiungi nota") opens a composer that needs to anchor on the selected span, you MUST capture `window.getSelection().getRangeAt(0).getBoundingClientRect()` BEFORE calling `hidePopup()` / `window.getSelection().removeAllRanges()`. The selection is cleared immediately after those calls and `getSelection()` returns no range, so any later lookup gives you no rect. The rect travels as `{ x, y, width, height }` through the `onAddNote(text, startOffset, rect)` callback — see `InlineNoteComposer` which wraps it into a floating-ui `VirtualElement`.
17. **Every user-owned slice is server-backed. Every creation / update / deletion MUST round-trip the backend before (or alongside) the store.** Canonical regressions were `importDossier` (file/share-link JSON import) and `applyEnvironment` (apply an environment preset) — both pushed a local `uuidv4()` straight into the store, the UI looked fine, then the first `addItem` on the "ghost" entity 404'd because the backend `findFirst({ id, userId })` found nothing. Rule: if an entity has a backend service (bookmarks, dossiers, environments, annotations, highlights, quickNorms, customAliases), every creation path goes through `service.create()` before pushing to the store, populating the store with server ids. For mutations the established pattern is optimistic+sync (apply locally, PUT, revert on non-404 error). **There is no intrinsically "client-only" user-data slice anymore** — the partialize only keeps UI state (settings, searchPanelState, workspaceTabs, highestZIndex). `applyEnvironment(replace)` additionally wipes server-side first: `dossierService.delete(each)` + `annotationService.deleteAll()` + `highlightService.deleteAll()`, otherwise server-side orphans come back on the next `fetchUserData`/article load. The replace-mode delete is gated behind a `danger`-variant `ConfirmDialog` in `EnvironmentPage` — the merge/replace split in `ApplyEnvironmentModal` is NOT enough consent for an irreversible server wipe.
18. **Never use silent `.catch(() => fallback)` in load paths**: `fetchUserData` hid a session-level investigation for "dossiers disappear on refresh" (turned out to be the backend tsx watcher mid-restart after a controller change) because `bookmarkService.getAll().catch(() => [])` swallowed the error and the store populated an empty array with zero diagnostic. If a fallback is needed, log first: `.catch((err) => { console.error('context: what failed:', err); return fallback; })`. Any 401/CORS/ECONNREFUSED then shows up immediately in the console instead of surfacing as an empty UI.
19. **Atomic usage counters live in dedicated `POST /:id/use` endpoints, not in PUT patches**: `QuickNorm.usageCount` and `CustomAlias.usageCount` bump every click / alias-resolution. A read-modify-write over PUT would race under rapid fire (click twice, +1 instead of +2). Each controller exposes a `/:id/use` route that runs `prisma.update({ usageCount: { increment: 1 }, lastUsedAt: new Date() })` as a single atomic op. Client pattern: (a) bump the local counter synchronously inside `set((state) => state.X.find(...).usageCount++)` for instant UX, (b) `void service.use(id).catch(...)` fire-and-forget afterwards. A failed sync isn't worth surfacing — the next `fetchUserData` restores the server counter as source of truth. Both `selectQuickNorm` and `trackAliasUsage` follow this shape; replicate it for any new counter slice instead of inventing a PUT-based variant.
20. **SuggestionItem payload shape is per-itemType and server-trusted**: the backend stores `payload` as opaque JSON per `itemType` (see design doc §Data Model). The `take` handler trusts the payload shape — any rename/transformation must happen BEFORE the item is stored. This is why the AliasConflictDialog's Rename path is MVP-deferred: rewriting the trigger at take-time would need either a trigger override param on the endpoint OR a client-side "manually recreate then mark item taken" dance. Replace + Skip cover the pragmatic flows until a Rename endpoint is added.
21. **`sourceSuggestionId` + `originalAuthorId` are the attribution contract, never mutate them**: when a row carries these fields, every UI surface MUST render the AttributionChip. Don't paper over them in a service method (e.g. filtering them out of a `getAll` response) — the invariant is "if the DB has an author, the UI shows the author". If the author is deleted, the fields stay null (Prisma `SetNull`) and the chip renders "@utente-rimosso" — that's the correct, by-design state from D7.

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
