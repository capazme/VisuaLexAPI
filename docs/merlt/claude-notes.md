# MERL-T integration notes — server and web

The MERL-T sections of the former root `CLAUDE.md`. `apps/server/CLAUDE.md`,
`apps/web/CLAUDE.md` and `services/merlt/CLAUDE.md` point here; read the section
you need before changing a MERL-T route, gate, guard or surface.

### MERL-T Integration (on `develop`): where to look

MERL-T is the legal knowledge graph + RLCF sidecar. It lived on the
`visualex-merlt-main` line until the unification (now the tag
`archive/visualex-merlt-main`) and is part of `develop`. Start from these, in
`docs/merlt/`:

- `blueprint.md`: the architecture reference, verified against the code.
- `contract-matrix.md`: every route mounted on the BFF, with its guard, its
  MERL-T path and its FE consumer.
- `integration.md`: the runbook, from a fresh clone to a working stack, plus
  the env var tables.
- `smoke-checklist.md`: the manual E2E checklist for every surface.
- `seed-libro-iv.md`, `upstream-sync.md`, `qa-async-progressive-contract.md`.
- Slice designs and sprint plans: `slices/<slice>/{design,sprint-plan}.md`.
  Decisions: `decisions/`.

The subsections below go slice by slice. Where a later slice changed an
earlier one, the text says what is true today.

**Runtime topology.** `infra/compose.yml` defines 7 services:

- Always on: `merlt-postgres`, `merlt-redis`, `merlt-falkordb`, `merlt-qdrant`.
- Under the `api-in-docker` profile:
  - `mcp-legal-it`: a git submodule at `vendor/mcp-legal-it`, serving HTTP MCP
    on :8011.
  - `merlt-api`: FastAPI `merlt.app:app`, on :8000.
  - `merlt-worker`: an RQ worker on the queues `merlt_ingest`, `merlt_extract`
    and `merlt_ner_train`.

Every host port is bound to 127.0.0.1: postgres 5436, redis 6381, falkordb
6382, qdrant 6343/6344, mcp 8011, api 8000.

The BFF runs on the host. It reaches MERL-T through `MERLT_API_URL`
(`http://localhost:8000`) and keeps its own Prisma database, so it never
connects to `merlt-postgres`. The api and the worker call the BFF (:3001) and
the Python API (:5000) through `host.docker.internal`. That name needs
`extra_hosts: host-gateway`, which Linux requires.

Compose sets `ENRICHMENT_DB_*`, `RLCF_DATABASE_URL`, `RQ_REDIS_URL`,
`FALKORDB_HOST`, `QDRANT_HOST` and their siblings explicitly. The MERL-T code
defaults point at `localhost:5433/rlcf_dev`, which does not exist inside the
container network.

**`start.sh`.** `MERLT_ENABLED=true` turns the sidecar on. `MERLT_API_IN_DOCKER`
defaults to `true`, the supported path, and implies `MERLT_COMPOSE_ENABLED=true`,
so the script runs `docker compose --profile api-in-docker up -d`. Before it
starts anything, the script:

- initialises the `vendor/mcp-legal-it` submodule when the directory is empty.
  A fresh clone has an empty directory, and the compose build then fails.
- reads `MERLT_INTERNAL_SECRET` and `MERLT_API_KEY` from `apps/server/.env` when
  the shell does not set them.
- exports the key a second time as `MERLT_ADMIN_API_KEY`. This keeps the BFF,
  compose and the seeded admin key in agreement.

After the containers are up, the script:

- waits for `:8000/health` (`MERLT_HEALTH_TIMEOUT`, default 60 s). On timeout
  it prints a failure and carries on.
- prints an error if `merlt-worker` is not running.

Cleanup also runs on `EXIT`, so a failed step no longer leaves the other
services orphaned.

`MERLT_API_IN_DOCKER=false` is a developer mode. The deps stay in Docker, and
`MERLT_PYTHON` runs `uvicorn merlt.app:app --reload` plus a local `rq worker`
on the same three queues. `MERLT_PYTHON` defaults to `services/merlt/.venv/bin/python`,
and the script checks that it can import `merlt.app`. The mode exports the
wiring compose gives the containers: graph name, `RQ_REDIS_URL` on DB 1 of the
MERL-T redis, callback URLs, collection and feature flags. It runs without the
mcp-legal-it tools: `MERLT_MCP_LEGAL_TOOLS_ENABLED=false` unless you set
`MCP_LEGAL_IT_URL`.

**MERL-T code is baked into the image.** Only `services/merlt/data` is mounted, and it
is read-only. After any change under `services/merlt/`, a restart is not enough: rebuild
and recreate.

```bash
docker compose -f infra/compose.yml --profile api-in-docker build merlt-api merlt-worker
docker compose -f infra/compose.yml --profile api-in-docker up -d --force-recreate merlt-api merlt-worker
```

**Boot, in order (`services/merlt/merlt/app.py` lifespan).** Each step is failure-isolated:
if one fails, it logs and the api boots anyway.

1. `init_db()` and `create_tables()`.
2. `ensure_consensus_triggers()`: the PL/pgSQL chain vote → net_score →
   consensus.
3. `ensure_schema_additions()` (`storage/enrichment/schema_additions.py`):
   additive `ADD COLUMN IF NOT EXISTS` statements. `create_tables()` never
   alters an existing table and the stack runs no Alembic, so a column added
   to a model reaches Postgres only through this step. Keep its list in step
   with `storage/migrations/*.sql` and `alembic/versions/`.
4. `ensure_admin_api_key()` (`api/api_key_seed.py`): seeds `MERLT_ADMIN_API_KEY`
   by hash as an `admin` key. It is idempotent, and skipped when the variable
   is unset.
5. The expert system (`api/engine_bootstrap.build_orchestrator`).
6. Replay-buffer rehydration, only when no buffer file was loaded. It rebuilds
   from persisted `QAFeedback JOIN QATrace`, is capped at 120 s, and never
   trains.
7. The Libro IV seed (`MERLT_SKIP_SEED`).
8. The graph hygiene loop, when `MERLT_HYGIENE_INTERVAL_HOURS > 0`.

**Persistence.** These volumes survive a recreate: `merlt_postgres_data`,
`merlt_falkor_data`, `merlt_qdrant_data`, `merlt_uploads` (shared api↔worker),
`merlt_hf_cache`, `merlt_checkpoints` and `merlt_ner_models`. Redis is not
durable: the RQ queue and the cache are lost on recreate.

- **FalkorDB.** The image writes to `/var/lib/falkordb/data`, and the volume
  is mounted there, with `FALKORDB_ARGS="--save 60 1 --appendonly yes
  --appendfsync everysec"`. The volume used to sit at `/data`, next to the
  real data dir, so every recreate dropped the lazily ingested and co-evolved
  nodes and only the seed came back.
- **RLCF replay buffer.** It lives at `MERLT_RLCF_BUFFER_PATH`, which compose
  sets to `/app/checkpoints/rlcf/replay_buffer.json`. It cannot go under
  `/app/data`, which is read-only.

**BFF mount and feature gates.** `app.ts` mounts
`app.use('/api/merlt', merltKillSwitch, merltRoutes)` before the catch-all auth
routers (gotcha 1). `MERLT_ENABLED=false` in the BFF env 404s the whole
namespace with `merlt_disabled`. `apps/server/.env.example` ships it `"false"`;
`MERLT_ENABLED=true ./start.sh` still wins, because dotenv never overwrites a
variable that is already set.

Inside `routes/merlt/index.ts`, `featureGate(flag, prefixes, exactPaths)` gates
router groups by path. The `config.ts` getters read `process.env` on every
access and default to `true`:

| Flag | Paths it owns |
|---|---|
| `MERLT_GRAPH_ENABLED` | `/graph/*`, `/internal/job-callback` |
| `MERLT_CONTRIBUTION_ENABLED` | `/contrib/*`, `/internal/extraction-callback`, and exactly `POST /ner/feedback` |
| `MERLT_VALIDATION_ENABLED` | `/validate/*` |
| `MERLT_OPS_ENABLED` | `/ops/*` (including `/ops/ingestion/*`), `/ner/training/*`, `/ner/feedback/stats` |
| none (kill switch only) | `/health`, `/consent`, `/profile`, `/events/*`, `/experts/*`, `/internal/qa-callback` |

The gate must filter by path because every sub-router is mounted at `/`. An
unconditional 404 in front of one router would end the fall-through for every
router after it. Turning `graph` or `contribution` off also 404s the worker
callback that group owns.

The FE sees only `VITE_FEATURE_MERLT` and `VITE_FEATURE_MERLT_GRAPH`. Both are
on by default; `false`, `0` or `""` disables them. The master switch follows the
server's unless set: `./start.sh` exports `VITE_FEATURE_MERLT` from its own
`MERLT_ENABLED`, and `infra/compose.app.yml` builds the app with
`${VITE_FEATURE_MERLT:-${MERLT_ENABLED:-true}}`, so MERL-T off on the server is off
in the app (`scripts/prod/tests/test_compose.sh`, scenario `prod-merlt-off`). A
single group switched off server-side still shows its hub card, and its calls
get 404s.

**Guards.**

| Guard | Passes | Otherwise |
|---|---|---|
| `consentGuard` | consent `basic` or `full` | 403 `consent_required` |
| `contributionGuard` | consent `full` | 403 `contribution_consent_required` |
| `validationGuard` | consent `full` | 403 `validation_consent_required` |
| `requireAdmin` | admin user (runs after `authenticate`) | 403 `admin_required` |
| `internalAuth` | `X-Internal-Secret` equals `MERLT_INTERNAL_SECRET` | 500 `internal_auth_not_configured` when the env is empty, 401 when the header differs |

`requireAdmin` is live on every ops route and every NER admin route.
`MERLT_INTERNAL_SECRET` authenticates all three callbacks: `job-callback`,
`extraction-callback` and `qa-callback`. It must equal the value compose
interpolates. That value defaults to `dev-internal-secret`, and
`apps/server/.env.example` ships the same one.

**MERL-T auth and the API key.** Every BFF client sends `MERLT_API_KEY` as
`X-API-Key` when it is set: `merltClient`, `graphClient`, `contribClient`,
`expertsClient`, `nerClient`, `opsClient` and `opsIngestionClient`. No JWT and
no `X-User-ID` is forwarded. MERL-T learns who the user is only from the
`user_id` the BFF injects into the body.

`services/merlt/merlt/app.py` overrides `verify_api_key` with `optional_api_key`, so only
`require_role("admin")` routes need the key. Of the routes the BFF proxies,
those are `/rlcf/training/start` and `/ingestion/mechanical/*`. The `/admin/*`
routes (config, engine reinitialize, graph hygiene) and `/ner/*` declare only
`verify_api_key`, so MERL-T itself leaves them open. The BFF `requireAdmin` is
their only gate, and `:8000` must never be exposed.

The admin key is seeded at boot from `MERLT_ADMIN_API_KEY`; compose passes it
`${MERLT_API_KEY}`. A fresh stack therefore no longer needs the manual
`POST /api/v1/api-keys/bootstrap`, which nothing ever called.

When MERL-T refuses the key:

- the `ops.ts` routes answer 503 `merlt_auth_misconfigured` on an upstream
  401/403;
- `opsIngestion.ts` collapses every upstream 4xx except 404/409 to 503
  `merlt_unavailable`.

**Job nets (`services/merlt/jobWatchdog.ts`).** `apps/server/src/index.ts` schedules
the watchdog every 5 min; it is off in tests. The watchdog is what unblocks a
poll whose callback was lost. Worker callbacks for ingestion and extraction
make a single attempt, and only the Q&A terminal callback retries (3 attempts).

The watchdog flips pending/running rows to `timeout`:

| Job | Env var | Default | Measured from |
|---|---|---|---|
| Ingestion | `MERLT_INGEST_STALE_MS` | 10 min | `createdAt` |
| Extraction | `MERLT_EXTRACT_STALE_MS` | 45 min | `createdAt` |
| Q&A | `MERLT_QA_STALE_MS` | 20 min of silence | `updatedAt`, which every per-expert callback bumps |

`lazyIngest` also uses `MERLT_INGEST_STALE_MS` to supersede a stale in-flight
job. Terminal Q&A rows are purged after `MERLT_QA_RETENTION_DAYS` (default 30).
See gotcha 4 of the 2026-09-25 list for how a net must relate to the RQ job
timeout.

### MERL-T Slice 1: tracking signals

Slice 1 wires 5 user-action signals into MERL-T.

- Design: `docs/merlt/slices/slice1/design.md`.
- Sprint plan: `docs/merlt/slices/slice1/sprint-plan.md`.
- Forum attribution: `docs/merlt/decisions/forum-authoring.md`.

**BFF (`apps/server/src/`).**

- `routes/merlt/consent.ts`: GET, POST and DELETE on `/consent`, with body
  `{ level, reason? }`. Each change runs in a Prisma transaction that upserts
  `MerltUserPreference` and appends a `MerltConsentAudit` row. The enum is
  `MerltConsentLevel` (none|basic|full), and `preferencesForLevel()` in
  `schemas/merlt/consent.ts` derives the 3 toggles. The audit is write-only:
  no route lists it.
- `routes/merlt/events.ts`: 5 endpoints (`article-viewed`,
  `highlight-annotation`, `dossier-bookmark`, `citation-clicked`,
  `forum-signal`). Each one runs `authenticate → consentGuard → Zod →
  authorityCache (best-effort) → eventMapper → merltClient.sendEvent` and
  answers `202 { received, timestamp }`. `_resetMerltClientForTests` resets the
  singleton client.
- `routes/merlt/health.ts`: GET `/health`, no auth, proxies MERL-T `/health`.
  - It answers 200 `{ bff, merlt: 'reachable', upstream }` whenever MERL-T
    answers, including when `upstream.status` is `degraded`, and 503
    `unreachable` otherwise.
  - MERL-T checks postgres, falkordb, qdrant and redis, and reports
    `graph.nodes`. It checks neither the worker, nor mcp-legal-it, nor the
    LLM key.
- `routes/merlt/profile.ts`: GET `/profile`. It reads `MerltUserAuthorityCache`
  and falls back to the cache when MERL-T is down; it answers 503 only on a
  cache miss during an outage.
- `services/merlt/merltClient.ts`: a typed client over native `fetch` +
  `AbortController`. It posts to `/api/v1/tracking/events`, batch-wrapped as
  `{events: [{type, data, timestamp}]}`, and reads `/api/v1/profile/full`.
  - The errors are typed: `MerltTimeoutError` (with the subclass
    `MerltNetworkError` for a refused connection), `MerltServerError` and
    `MerltBadRequestError`.
  - `eventMapper.ts` lifts `type` out of each event, attaches `user_id` and
    the cached `user_authority`, and normalises `art1 bis` to `art1-bis`.
- `services/merlt/authorityCache.ts`: MERL-T computes the authority, and the
  BFF caches it with a 1 h TTL. When MERL-T is unreachable it serves the stale
  entry, and returns null only when there is no cache and the sync fails. A
  vote that closes a consensus refreshes the voter's entry (`validate.ts`).
- `services/merlt/deadLetterLog.ts`: NDJSON at
  `apps/server/logs/merlt-dead-letter.jsonl` (`MERLT_DEAD_LETTER_DIR`). It holds
  the full event payload, is capped at 50 MB, and is skipped under
  `NODE_ENV=test` unless `MERLT_DEAD_LETTER_LOG_IN_TESTS=1`.
- Prisma models: `MerltUserPreference`, `MerltConsentAudit` and
  `MerltUserAuthorityCache`. The cache column `baselineQual` holds MERL-T's
  authority tier, and the hub labels it "Livello di autorevolezza".

**Frontend.** The plugin host (`plugins/registry.tsx`, `plugins/types.ts`)
declares three slots. `PluginSlot` itself lives in `plugins/PluginSlot.tsx`.

| Slot | Component | Flag |
|---|---|---|
| `article_content_after` | `ArticleMerltSlot` | `VITE_FEATURE_MERLT` |
| `global` (mounted once in `Layout`) | `GlobalMerltSlot` | `VITE_FEATURE_MERLT` |
| `article_sidebar` | `ArticleGraphSideRail` | `VITE_FEATURE_MERLT_GRAPH` |

- `ArticleMerltSlot` hosts **only** `useArticleViewedTracker`, the
  IntersectionObserver dwell tracker (≥3 s, or ≥30 % read progress).
  - Progress is how much of the article has been revealed inside its nearest
    scrolling ancestor, or the viewport.
  - The article element itself does not scroll, so measuring its own
    `scrollTop` always read 0.
- `GlobalMerltSlot` hosts the four bus-subscriber trackers (forum,
  highlight/annotation, dossier/bookmark, citation) and `ConsentBanner`. A
  single mount means one BFF POST per bus event (Slice 3 §3.9); mounting them
  per article card duplicated every event.
- `merltEventBus.ts` is pure pub/sub: `publishMerltEvent` makes no network
  call. `MERLT_EVENT_TYPES` also declares types that nothing publishes or
  forwards, such as `search_performed`, `dossier_export_training` and
  `issue_*`.
- The plugin host is not the only door. `ArticleTabContent` imports
  `AskMerltEntry`, `useMerltFeatures`, `publishMerltEvent` and
  `sendNerFeedback` directly, and `CitationPreviewPopup` imports
  `CitationNerFeedback`. Each of them is hidden at runtime when
  `VITE_FEATURE_MERLT` is off.

Emission call-sites. Keep them thin: the tracker hooks do the BFF talk.

- `useAppStore.addBookmark` → `bookmark_add`.
- `useAppStore.addToDossier` (type `'norma'` with a urn) → `dossier_item_add`.
- `ArticleTabContent`:
  - `handlePopupHighlight` → `highlight_create`
  - `handleAddNote` → `annotation_create`
  - `handleOpenCitationInTab` → `citation_click`
- `BulletinBoardPage` → forum like, suggestion accepted and suggestion
  declined, keyed on `sharedEnvironmentId`. The tracker drops an event
  without it.
- `ImportEnvironmentModal.handleImport` → `forum_download`.

**Slice 1 gotchas:**
1. **Express mount order beats prefix specificity.** `merltRoutes` must be
   mounted before the catch-all auth routers. Otherwise `folders.ts`'s pathless
   `authenticate` 401s `/api/merlt/health`.
2. **An `rsync --exclude` pattern without a leading `/`** matches anywhere in the
   tree. The first MERL-T copy silently dropped `services/merlt/merlt/models/`,
   `services/merlt/merlt/api/models/` and `services/merlt/merlt/disagreement/data/`. Use
   `--exclude='/models/'` to exclude the top level only.
3. **Tracking is persisted.** `tracking_router` writes `tracking_events`
   (`TrackingEventRecord`). When the DB is unreachable it falls back to a
   bounded in-memory buffer and still answers 202. Verify with
   `SELECT event_type, user_id, created_at FROM tracking_events ORDER BY created_at DESC`.
   Nothing in MERL-T reads the table yet, so the signals feed neither
   authority nor training.
4. **MERL-T paths carry the `/api/v1/` prefix.** See the `include_router` list
   in `services/merlt/merlt/app.py`. `/health` and `/` are the only root-level routes.
   A nock mock of the wrong path stays green: the Story 1.5 client, and later
   `confirm-source`, proxied to routes that did not exist while their tests
   passed.
   - `apps/server/tests/nockShim.ts` now honours `reqheaders`/`badheaders`, so
     header assertions such as `X-API-Key` actually run.
   - A mocked upstream still proves nothing about MERL-T. Check the MERL-T
     router.

### MERL-T Slice 2a: the graph, read-only

Slice 2a brings the FalkorDB graph to the frontend, starting from a pre-loaded
Libro IV CC seed (about 27.7k nodes), with lazy ingestion for articles not yet
indexed. It has two surfaces: the side rail in `ArticleTabContent` and the
`/grafo` page, which Slice 4 turned into the Q&A surface.

- Sprint plan: `docs/merlt/slices/slice2a/sprint-plan.md`.
- Seed how-to: `docs/merlt/seed-libro-iv.md`.

**Seed and worker (MERL-T).** `services/merlt/merlt/scripts/load_seed_libro_iv.py` runs
in the lifespan. It is idempotent (it skips when the graph has >100 nodes) and
MERGEs `services/merlt/data/seeds/libro-iv-cc-graph.json` on `URN`/`node_id`.
Embeddings are skipped by default (`MERLT_SKIP_EMBEDDINGS=true`).

Lazy ingestion runs on RQ, not arq: arq's redis pin conflicts with falkordb's.
`POST /api/v1/graph/ingest-article` enqueues on `merlt_ingest` with
`job_id = "ingest-" + sha256(urn)[:40]` and `job_timeout=600`. The worker
calls the BFF back at `/api/merlt/internal/job-callback`.

**BFF (`/api/merlt/graph/*`).**

- `services/merlt/graphClient.ts` has these methods:
  - `checkArticle`, which returns `{exists}`, not `in_graph`.
  - `getSubgraph(urn, depth, maxNodes)`.
  - `ingestArticle(urn, bffJobId)`.
  - `searchEntities(q, limit)`, a fuzzy name autocomplete. The semantic
    `POST /api/v1/graph/search` is not proxied.
  - `listProvisionalReview` and `adjudicateProvisional`.
- `services/merlt/lazyIngest.ts`: `ensureIngestionJob(prisma, graphClient, urn,
  userId)`. The explicit `POST /graph/ingest` and the `article:viewed` trigger
  both use it; do not duplicate it.
  - It keys rows on `normalizeGraphUrn(urn)`.
  - Every further reader of an in-flight article gets a mirror row of their
    own, with no second enqueue.
  - It judges staleness on the oldest in-flight row, and supersedes a stale
    one (flip to `timeout`, then re-enqueue).
  - The job-callback fans out, status-guarded, to every in-flight row of the
    article, and invalidates the subgraph cache for that URN.
- `services/merlt/subgraphCache.ts`: an in-memory TTL + LRU cache with request
  coalescing on `GET /graph/article/:urn`, keyed on
  (normalised urn, depth, limit). Two env vars tune it:
  `MERLT_SUBGRAPH_CACHE_TTL_MS` (clamped to 60 000..300 000, default 120 000)
  and `MERLT_SUBGRAPH_CACHE_MAX_ENTRIES` (default 200). It is single-instance
  state.
- `routes/merlt/graph.ts`:

| Route | Guard | Notes |
|---|---|---|
| `GET /graph/article/:urn` | authenticate | `depth` 1..3 (default 2), `limit` 1..200 (default 200): MERL-T caps `max_nodes` at 200 |
| `GET /graph/search` | authenticate | 400 on a blank `q` |
| `GET` and `POST /graph/provisional-review[/:nodeId]` | authenticate + validationGuard | see the co-evolution section |
| `POST /graph/ingest` | authenticate + consentGuard | |
| `GET /graph/jobs/:jobId/status` | authenticate | owner-scoped |
| `POST /internal/job-callback` | internalAuth | |

  Reading is not consent-gated (Slice 3 D2).
- `routes/merlt/events.ts`: after forwarding `article-viewed`, the handler
  calls `checkArticle`. On `!exists` it calls `ensureIngestionJob` and adds
  `{ ingestionJob }` to the 202. All of this is failure-isolated.
- Prisma: `MerltIngestionJob` plus the enum `MerltJobStatus
  {pending running completed failed timeout}`. The enum value is
  `completed`, not `succeeded`.

**Frontend (`features/merlt/graph/`).**

- `shared/`:
  - `GraphCanvas.tsx`: the G6 v5 canvas (`@antv/g6`), default export, loaded
    with `React.lazy`.
  - `graphStyles.ts` and `graphTransform.ts`.
  - `useArticleGraph.ts`: args `(urn, depth, limit?)`; a discriminated union
    with stale-response discard.
  - `useIngestionJob.ts`: polls every 2 s within a 60 s budget.
  - `graphApi.ts`.
  - `snapshotIO.ts`: the local export and reload of a slice.
- `side-rail/ArticleGraphSideRail.tsx`: depth 1, at most 25 nodes. It fetches
  only while open. An empty result starts lazy ingest, then polls, then
  refetches. A node click navigates to `/grafo?urn=`.
- `page/GraphExplorerPage.tsx`: driven by the URL
  (`?urn=&depth=&layout=&type=`).
  - Search and navigation: `GraphSearchBox` (300 ms debounce),
    `BreadcrumbHistory` / `useBreadcrumbHistory` (sessionStorage, cap 5),
    `DepthSelector`, `GraphFilterPanel`.
  - Detail drawers: `NodeDetailsDrawer`, `EdgeDetailsDrawer`.
  - The Q&A column: see Slice 4.
- The route `/grafo` and the Sidebar entry "Grafo" are gated by
  `isMerltEnabled() && isMerltGraphEnabled()`.

**Slice 2a gotchas:**
1. **The graph is G6, not Cytoscape.** `cytoscape`, `react-cytoscapejs` and
   their ambient `.d.ts` are gone.
   - `GraphCanvas` applies selection imperatively from its props and does not
     register G6's `click-select`, so React and G6 cannot diverge.
   - Filters use `setElementVisibility`/`setElementState` without re-running
     the layout.
2. **`react-hooks/set-state-in-effect` is enforced.** Reset state by deriving
   it during render with a prev-input tracker (see `useArticleGraph`,
   `useIngestionJob`, `GraphSearchBox`). The rule flags only direct setters.
3. **An empty `nodes` array is the "not indexed" signal.** The BFF returns the
   subgraph verbatim and never 404s for a missing article. `checkArticle.exists`
   is the explicit probe the `article:viewed` trigger uses.
4. **`VITE_FEATURE_MERLT_GRAPH=false`** hides the side-rail slot and the
   Sidebar entry, and renders `/grafo` as "Grafo non disponibile".
5. **The URN version-marker trap.** The seed keys Normattiva URNs by the full
   URL form (`https://www.normattiva.it/uri-res/N2Ls?urn:nir:…~art2043`), with
   no version marker. VisuaLex urns carry `!vig=`, `!orig=…` or `@originale`.
   - `graphClient.normalizeGraphUrn()` cuts from the first `!` or `@`, and
     every urn-keyed graph call, the lazy-ingest key, the subgraph cache key
     and the `/grafo` center matcher go through it.
   - Never strip the URL wrapper: seeded nodes would become unreachable and
     re-trigger lazy ingestion forever.

### MERL-T Slice 2b: hub and consent

- Design: `docs/merlt/slices/slice2b/design.md`.
- Sprint plan: `docs/merlt/slices/slice2b/sprint-plan.md`.

**The server is the source of truth for consent; the client is a synced
cache.** The server `consentGuard` family is the hard gate.

- `features/merlt/consent/context.ts` holds the context object, in a
  non-component file for the react-refresh boundary.
- `ConsentContext.tsx`: `ConsentProvider`, which wraps the authenticated
  `Layout` in `App.tsx`.
  - It hydrates from `GET /consent` with inline `.then/.catch`, and uses
    `inFlightRef` to prevent overlapping fetches.
  - It exposes `setConsent`, `revokeConsent` and `refresh`.
  - It writes the level to `localStorage`, which is only a boot cache
    (`merltConsent.ts`).
- `useConsent.ts` exposes `level`, `canTrack` and `status`.
- The trackers gate on `useConsent().canTrack`, held in a `canTrackRef` that a
  `useEffect` syncs.

**Feature gating is derived on the client.** There is no
`GET /api/merlt/features`. `features/merlt/useMerltFeatures.ts` combines the two
Vite flags, the consent level and `useAuth().isAdmin` into:

| Field | Value |
|---|---|
| `merltEnabled`, `graphEnabled` | the Vite flags |
| `canTrack` | the consent context's `canTrack` |
| `qaAskable` | `level !== 'none'` |
| `canContribute`, `canValidate` | `level === 'full'` |
| `graphReadable` | the graph flag only |
| `opsVisible` | `isAdmin` |

**Hub (`pages/MerltHubPage.tsx`, route `/merlt`, Sidebar label "Assistente").**
The cards are `QaCard`, `ValidateCard`, `GraphCard` (when `graphEnabled`),
`ContribCard`, `ConsentCard` and `ProfileCard`. `useHubData` loads their live
data. Two more cards are admin-only (`opsVisible`):

- "Ops (admin)": `OpsTrainingButton`, `OpsHygieneButton` and `NerOpsCard`.
- "Regolazione motore (admin)": `OpsConfigPanel`.

`ConsentDialog.tsx` offers the three levels. `ConsentBanner.tsx` is a
non-blocking first-run prompt in `GlobalMerltSlot`. It fires only on the real
RLCF bus events (`TRACKED_EVENT_TYPES`), never on `scroll` or `text_selection`.

**Slice 2b gotchas:**
1. **Revoking consent while a tracker is mounted.** React runs an effect's
   cleanup before the ref-sync effect. A tracker with `canTrack` in its deps
   would therefore emit its cleanup-path event with the stale `true`.
   `useArticleViewedTracker` keeps `canTrack` out of its main effect deps and
   gates on `canTrackRef.current`.
2. **The consent route was always right; the old client was the bug.** Use
   `setMerltConsent(level, reason?)` (POST) and `revokeMerltConsent` (DELETE).
   Never reintroduce a PUT or `{ consentLevel }`.
3. **`MerltEventResponse` is `{ received, timestamp }`**, not `{ trace_id }`.
   `ArticleViewedEventResponse` can also carry `ingestionJob`.

### MERL-T Slice 2c: "Apprendi dai miei appunti", and validation

The flow: upload notes → async LLM extraction into ephemeral staging →
per-item review → promotion to RLCF `pending_*` → community vote.

- Design: `docs/merlt/slices/slice2c/design.md`.
- Sprint plan: `docs/merlt/slices/slice2c/sprint-plan.md`.
- The server keeps only the central graph and the RLCF proposals.
  Candidates live in the MERL-T `extraction_candidates` table, with a TTL of
  `MERLT_STAGING_TTL_HOURS` (48). The verbatim never enters `pending_*`.

**BFF (`/api/merlt/contrib/*`, `/api/merlt/validate/*`).**

- `services/merlt/contribClient.ts` has these methods: `uploadDocument`
  (multipart), `getDocument`, `extractAsync`, `listCandidates`, `getCandidate`,
  `proposeEntity`, `proposeRelation`, `markPromoted`, `getPending`,
  `validateEntity` and `validateRelation`. Its timeout is
  `MERLT_CONTRIB_TIMEOUT_MS`, falling back to `MERLT_TIMEOUT_MS`, then 30 s.
- `services/merlt/promotionGate.ts` is the copyright gate. A candidate passes
  only with a non-empty `fonte`, a text that differs from the verbatim, and
  `attested`. The gate is re-checked server-side against the authoritative
  verbatim from `getCandidate`.
- `routes/merlt/contrib.ts` (contributionGuard unless noted):

| Route | Notes |
|---|---|
| `POST /contrib/documents` | multer; PDF, TXT or DOCX up to 50 MB |
| `POST /contrib/documents/:id/extract` | creates a `MerltExtractionJob` and enqueues |
| `GET /contrib/documents/:id/candidates` | MERL-T scopes it with the caller's `user_id` |
| `GET /contrib/jobs/:jobId/status`, `GET /contrib/me/jobs` | authenticate only, owner-scoped |
| `POST /contrib/candidates/:id/promote` | gate → propose → `markPromoted` |
| `POST /internal/extraction-callback` | internalAuth |

  **The BFF is the ownership boundary.** MERL-T document and candidate ids are
  sequential, and MERL-T does not scope extract or the candidate reads by
  user. So `extract`, `candidates` and `promote` first check that the caller
  uploaded the document (`getDocument(...).uploaded_by`). Otherwise they
  answer 404 `document_not_found` / `candidate_not_found`, never 403.
- **The promote response.** Read `created`, not the status code. It returns
  `{ pendingId, created, hasDuplicates, duplicateActionRequired, message,
  duplicates }`.
  - MERL-T answers 200 without an id when it defers on a duplicate or refuses
    the name. The card then offers "Invia comunque", which retries with
    `skipDuplicateCheck` plus `acknowledgedDuplicateOf`. That skips the dedup,
    never the copyright gate.
  - The candidate's `entity_type` is re-read from the authoritative candidate,
    so a principio is not filed as a concetto.
  - The provenance sent is `fonte: 'community'`, `source_reference` (the
    user's citation) and `source_document_id` (the MERL-T `user_documents`
    id, never the staging id).
- `routes/merlt/validate.ts` (validationGuard):
  - `GET /validate/pending`, `POST /validate/entity|relation`.
  - A vote carries `user_id`, `vote` and `reason`. MERL-T computes the
    authority itself.
  - `VoteType` is approve|reject|edit; the FE sends only approve|reject.

**MERL-T side.**

- `document_parser.py`: `persist_target="staging"` sets `expires_at` and runs
  `EntityDeduplicator.find_duplicates` (best-effort).
- `worker/extraction_tasks.py` `extract_to_staging`:
  - It is enqueued with `job_id = "extract-" + sha256(docId)[:40]` and
    `job_timeout = MERLT_EXTRACT_JOB_TIMEOUT` (1800 s).
  - It sends a `failed` callback when the upload was already purged or every
    extractor failed.
  - It deletes the file after extraction, except when nothing was staged, so
    a retry stays possible.
- **Relation candidates are extracted from notes** (loop-closure B1).
  - The worker calls `parse_document(extract_relations=True)`, which writes
    `ExtractionCandidate(candidate_type="relation")` through
    `canonical_relation_type`.
  - `propose-relation` stores the resolved wire value, not the Enum object,
    so relation promotion no longer fails the INSERT.
- **Relation endpoints are resolved at staging** (`document_parser.py`).
  Each endpoint becomes one of: the URN or URL as written; a same-document
  entity candidate, matched by normalised name; or the pending entity id of
  an EXACT/HIGH deduplicator match.
  - The candidate read model carries `source_text`/`target_text` (the raw
    LLM names, null on older rows) and `source_resolved`/`target_resolved`
    (null on entity candidates).
  - `get_pending` relations carry `source_label`/`target_label`.
  - `target_entity_id` is `varchar(300)` on `extraction_candidates` and
    `pending_relations`. Three places apply the widening: `schema_additions`
    at boot, Alembic 008 and `storage/migrations/004_relation_endpoints.sql`.
  - The shared helpers live in `storage/graph/relation_endpoints.py`.
- **At consensus, `_write_relation_to_graph` (`enrichment_router.py`) only
  MATCHes existing nodes.** It matches by norm URN, by pending entity id (the
  Entity id convention `entity_writer.entity_node_id`), by Entity id, by
  `node_id`, or by a unique case-insensitive Entity name.
  - Only a `urn:nir:` value may create a Norma stub, and `user_document` is
    refused.
  - A relation that points at a pending entity not yet in the graph is
    deferred. `_write_deferred_relations_for_entity` writes it once that
    entity is written.
  - Known limit: `propose_relation` (the manual/legacy path) still stores
    endpoints verbatim and only marks `target_is_pending`, so the cascade
    does not reset a rejected pending *source*.
- On the BFF side, the promote schema (`schemas/merlt/contrib.ts`) accepts
  only resolved relation endpoints: a `urn:nir:` URN or URL, or a
  `<tipo>:<slug>` id. Anything else gets 400 `unresolved_endpoint`.

**Frontend.**

- `features/merlt/contrib/` (route `/merlt/contribuisci`):
  - `ContribPage` orchestrates `UploadDropzone`, `useExtractionJob` (2 s
    poll), `CandidateReviewList` and `CandidateCard`.
  - `CandidateCard` enables promote only once `fonte`, the reformulation and
    the attestation are all present, and shows the entity type as a badge.
  - `NormaPicker` picks the norma the candidate refers to.
- `features/merlt/validate/` (route `/merlt/valida`): `ValidationPage`,
  `ValidationCard` (provenance, norm link, one-tap reject) and
  `ProvisionalReviewSection`.
- Snapshot export and import live on `/grafo` (`graph/shared/snapshotIO.ts`),
  not in contrib.

**Slice 2c gotchas:**
1. **MERL-T `parse_document` has two paths.** The legacy sync path writes
   straight to `pending_*`, and it is unchanged. The staging path is async.
2. **`user_id` is a varchar(100) string everywhere toward MERL-T.** It is the
   VisuaLex id, never an FK.
3. **The copyright gate is re-checked server-side.** The client cannot supply
   the verbatim.
4. **RQ job ids cannot contain `:`.** They must match `[A-Za-z0-9_-]`. Use
   `extract-…` and `ingest-…`, with a dash.
5. **`merlt-api` needs `RQ_REDIS_URL` too, not only the worker.** The api is
   the process that enqueues. Without it, it enqueues to `localhost:6379`
   inside the container and fails.
6. **The RQ worker has no FastAPI lifespan.** Any worker task that opens
   `get_db_session()` must `await init_db()` first; the call is idempotent.

### MERL-T Slice 3: UX decisions, and the absorb into `/grafo`

Design: `docs/merlt/slices/slice3-ux/design.md`. The data-quality follow-up is
in `data-quality-plan.md`. These are the owner decisions:

- **D1, navigation.** One Sidebar entry, "Assistente" (the hub).
  - This was later amended by Slice 4 Decision A: the Sidebar now also has
    "Grafo" → `/grafo`, gated on both flags.
  - `/merlt/qa` and `/merlt/chiedi` redirect to `/grafo`.
- **D2, "reading is free, asking needs basic, teaching needs full".**
  - Reading the graph needs no consent.
  - Asking (Q&A) needs `basic`.
  - The teaching channels need `full`: Q&A feedback, confirm-source,
    contributions, votes and NER feedback.
- **D3, hub-dashboard.** The hub shows live data (last question, pending
  count, graph health, profile), not static cards.
- **D4, open community surfaces.** Junk is cleaned by votes, so every
  validation card shows its provenance, a link to the norm and a one-tap
  reject.

### MERL-T Slice 4: the debate on the graph

Design: `docs/merlt/slices/slice4-graph-deliberation/design.md`. The decisions
were locked 2026-07-03.

- **Decision A, absorb.** `/grafo` is the only Q&A surface. The history lives
  in the deliberation column. The hub `QaCard`, the article entry and the
  Sidebar all point to `/grafo`.

The Q&A pieces:

- `AskGraphField` ("Chiedi al grafo").
- `DeliberationColumn`: turns, the history view (`QaHistoryPanel`), sources as
  `QaSourceChip`, the process trace, divergent theses and "Mi convince"
  (preference).
  - `RefineField` ("Approfondisci questa risposta") appears on settled turns
    and calls `useQaThread.refine` with the turn's `trace_id`.
  - `QaSynthesisWithCitations` renders the `qa_chip` NER bar.
- `MobileDeliberationSheet`.
- `GraphTraversalPlayer`: the traversal walk.

On the canvas:

- Canon nodes and contrast arcs come from `shared/graphDeliberation.ts`.
- Provenance styling: `seed`, `community_validated`, `confirmed` and
  `live_unconfirmed`. `confirmed` is first-class: it is what promotion and
  review write.

Other entry points and leftovers:

- `components/features/search/AskMerltEntry.tsx` in `ArticleTabContent`
  navigates to `/grafo?urn=`.
- `qa/QaTurn.tsx` and `qa/QaDeliberationPanel.tsx` are dead: only tests import
  them.

**Teaching controls render only with `canContribute`.** A basic-consent reader
sees a consent upsell in their place. A failed rating reverts and reports
through the shared Toast, and the detailed form confirms only after the server
does.

**Steering that trains (L2).** `preferredExpert` feeds the gating head, and the
heads are authority-weighted (scaled learning rate). The per-relation steer is
`POST /experts/feedback/relation`. Per-node steering and a shareable trace URL
are not built.

### MERL-T Loop β: expert Q&A, sync and async progressive

The async contract is frozen in `docs/merlt/qa-async-progressive-contract.md`.

**BFF routes (`routes/merlt/experts.ts`; `services/merlt/expertsClient.ts`).**

| Kind | Routes | Guard |
|---|---|---|
| Ask | `POST /experts/query` (sync), `POST /experts/query/async`, `GET /experts/history?limit=` (1..100, default 20), `GET /experts/trace/:traceId`, `POST /experts/refine` | authenticate + consentGuard (basic or full) |
| Poll | `GET /experts/jobs/:jobId/status` | authenticate, owner-scoped (404 otherwise) |
| Teach | `/experts/feedback/{inline,source,detailed,preference,relation}`, `/experts/confirm-source` | authenticate + contributionGuard (full) |
| Callback | `POST /internal/qa-callback` | internalAuth |

- `/experts/trace/:traceId` returns the full stored trace, redacted by the
  caller's current consent level.
- **Trace ownership.** Every traceId-keyed route (trace, refine,
  `feedback/*`) first proves that the caller owns the trace
  (`callerOwnsTrace`), and answers 404 `trace_not_found` otherwise. The
  proofs, in order:
  1. a `MerltQaJob` of the caller carries the trace id;
  2. the stored trace names the caller;
  3. the trace is among the caller's last 100 history turns.
- `/experts/refine` stays sync; it calls MERL-T `/experts/feedback/refine`.
- The three steer channels (preference, relation, confirm-source) are deduped
  in memory per (user, channel, trace, target) for 10 minutes. This is
  single-instance state.

**The BFF injects `user_id` and maps the consent level** (none→anonymous,
basic, full). `trace_id` is the handle on every response. Do not follow
legacy code that reads `query_id`.

The feedback schemas:

- `inline.rating` is `1 | 5`.
- `source.relevance` is an int from 1 to 5.
- `detailed.{retrieval,reasoning,synthesis}Score` are floats from 0 to 1.
- `preference.preferredExpert` is one of `literal | systemic | principles |
  precedent`.
- `confirmSource.nodeId` must match `^live:`.

The client timeouts are `MERLT_EXPERTS_TIMEOUT_MS` (sync, default 120 s) and
`MERLT_EXPERTS_ASYNC_TIMEOUT_MS` (submit, default 10 s).

**The async flow.** The FE asks through the async path by default.

1. `POST /experts/query/async` creates a `MerltQaJob`. The row stores the
   query, the mode and the consent level captured at submit, so a later
   downgrade does not apply.
2. The BFF asks MERL-T to run the deliberation in-process on `merlt-api`, in
   an `asyncio.create_task`, not on the RQ worker. This needs
   `BFF_QA_CALLBACK_URL` and the secret on `merlt-api`.
3. MERL-T calls `qa-callback` once per expert with `running` and a partial.
   The BFF upserts the partial by expert and sorts the list in canon order
   (letterale, sistematico, principî, precedente). The final callback carries
   the result.
4. The FE polls the job status every 2 s.

A definite refusal at submit flips the row to `failed` and answers
`202 {status:'failed'}`: a refused connection (`MerltNetworkError`) or a MERL-T
4xx/5xx. A timeout stays `pending`, because MERL-T may still call back.

**The FE state.** `useQaThread` orchestrates ask, refine, rate, rateSrc,
prefer, detailed and confirm, latest-wins. It persists the active thread in
`localStorage` (`merlt-qa-thread-v1`).

**MERL-T side.**

- The reader's convergent/divergent choice reaches the synthesizer as a
  per-request `forced_mode`: `orchestrator.process` →
  `AdaptiveSynthesizer.synthesize`. It is never written to the shared config.
  A forced divergent with fewer than two usable experts falls back to
  convergent and says so. Refine keeps the original answer's mode.
- The partial weight is the normalised routing weight, not the confidence.
- `POST /api/v1/enrichment/confirm-source` ("ricorda nel grafo") exists as of
  2026-09-25. It:
  - validates the `live:` node, and 404s when it is gone;
  - for a Normattiva article, lazily ingests it through the shared enqueue
    helper (same `ingest-` job id);
  - turns any other source into a pending entity through `propose_entity`'s
    gates, with a capped excerpt (never the verbatim);
  - stamps `pending_entity_id` on the node, records the confirmer, and raises
    trust (never lowers it). It is idempotent.

**RLCF training.** The replay buffer (`rlcf/training_scheduler.py`) saves on
`add_experience` with a debounce and an atomic replace, and it is flushed on
shutdown. An empty buffer is rehydrated at boot (`rlcf/buffer_rehydration.py`).

Training starts manually from the hub:

- `POST /ops/rlcf/training/start` (admin) → MERL-T `/api/v1/rlcf/training/start`.
- The body is forwarded verbatim; it is not Zod-validated.
- MERL-T's Pydantic floor is `buffer_threshold ≥ 50`. Below it the answer is
  `{success:false, message:"Buffer insufficiente (N/…)"}`, which is correct
  behaviour.

Checkpoints land on `merlt_checkpoints`, and `PolicyManager` loads them.

**Policy history.** MERL-T `GET /api/v1/rlcf/policies/history` reads the saved
`weight_versions` rows, the same table `/policies/weights` reads. It uses
`WeightStore.list_versions(experiment_id, limit)` (`weights/store.py`) for the
experiment that `_resolve_experiment_id()` resolves, and projects each row
through the shared `_config_to_status()`.

- Rows come oldest first, so `epochs` rise over time.
- An unreadable row is skipped with a warning.
- The history is empty when `RLCF_DATABASE_URL` is unset.
- Nothing in the BFF or the FE calls it yet.

**What Loop β does not have.** There is no SSE or WebSocket proxy (submit and
poll replaced it). There is no training status/stop route, no dashboard,
policy, pipeline, regression or quarantine proxy, and no save-to-dossier for
an answer. The LLM-cited sources are not checked against the retrieved set.

### MERL-T ops, ingestion governance and graph co-evolution

**Ops (`routes/merlt/ops.ts`, `services/merlt/opsClient.ts`).** Every route is
authenticate + requireAdmin, under the `ops` flag:

| BFF route | MERL-T route |
|---|---|
| `POST /ops/rlcf/training/start` | `/api/v1/rlcf/training/start` |
| `POST /ops/graph/hygiene` | `/api/v1/admin/graph/hygiene` |
| `GET /ops/config` | `/api/v1/admin/config` |
| `PUT /ops/config/:key` | `/api/v1/admin/config/{key}` (hand-validated) |
| `POST /ops/engine/reinitialize` | `/api/v1/admin/engine/reinitialize` (30 s timeout) |

FE: the hub ops cards (Slice 2b). `OpsTrainingButton` fires and forgets, with
no status poll. `OpsHygieneButton` reports the reconciled, decayed,
quarantined and pruned counts.

**Mechanical ingestion (admin, zero-LLM).** The design is
`docs/merlt/slices/ingestion-governance/design.md`. It is implemented, even
though that doc's header still says DRAFT.

- `routes/merlt/opsIngestion.ts` and `opsIngestionClient.ts` →
  `/api/v1/ingestion/mechanical/*` (`require_role("admin")`):
  - `POST /ops/ingestion/run`, with `{source: visualex_tree|italia_corpus,
    source_ref, …}`. It enqueues on `merlt_ingest` with `job_timeout=1800`.
  - `GET /ops/ingestion/batches[/:batchId]`.
  - `POST …/promote`, which answers 409 while conflicts are unresolved.
  - `POST …/reject`.
- Each batch carries a conflict report: `urn_conflicts`, `node_updates` and
  `node_new`.
- Status writes are conditional. A reject that races a promote gets 409
  `batch_status_changed_concurrently`, and the worker writes only while the
  batch is still `promoting`.
- The parser (`pipeline/mechanical_ingestion/parser.py`) derives code
  abbreviations from an explicit table, `_CODE_ABBREVIATIONS`, never from
  initials. An unknown act keeps its name.
- FE: `ops/ingestion/IngestionAdminPanel`, under the `/admin` tab
  "Ingestione".

**Graph co-evolution.** The design is
`docs/superpowers/specs/2026-07-16-merlt-graph-coevolution-design.md`; see
also blueprint §2.5.

- **Absorb.** The experts pull live sources from mcp-legal-it.
  `pipeline/provisional_writer.py` writes each one as a `live_unconfirmed`
  node: `URN = node_id = "live:<hash>"`, the real article URL in `source_url`,
  trust 0.6, not community-validated. A Qdrant chunk goes with it, keyed by
  `source_url`, and the node is linked `(confirmed)-[:CORRELATO]->(provisional)`.
- **Learn.** `pipeline/promotion.py` bumps three counters: usage, positive
  feedback and confirmed citation. Above `promotion_threshold` (0.6,
  `RuntimeConfig`) the node becomes `provenance='confirmed'`, trust 1.0.
  Promotion is monotonic. The served provisional nodes of an answer are
  persisted in `full_trace` as `coevo_served_keys`, so positive feedback
  credits them.
- **Self-correct.** `pipeline/hygiene.py` touches only `live_unconfirmed`
  nodes, in four steps: reconcile twins of confirmed nodes, decay stale
  nodes, quarantine doubtful ones for review, prune faded ones.
  - It runs every `MERLT_HYGIENE_INTERVAL_HOURS`: compose sets 24, the code
    default is 0 (off). The first sweep comes one interval after boot.
  - A node carries "human signal" when it has feedback or usage, or when a
    user vouched for it through confirm-source (`confirmed_by` non-empty or
    `pending_entity_id` stamped). `HUMAN_SIGNAL_PREDICATE` expresses this, and
    three steps share it:
    - `quarantine_doubtful` sends such nodes to human review;
    - `prune_faded` deletes only nodes without it;
    - `reconcile_duplicates` leaves vouched twins alone.

    The reason: `entity_writer._link_provisional_source` finds the node again
    by `pending_entity_id` at approval.
  - Known limit: a rejected proposal keeps its stamp. A later confirm of the
    same node answers `"Fonte gia' proposta alla comunita'"` and reuses the
    rejected entity id. The node fades into quarantine, where a reject prunes
    it.
  - It can also run on demand from the hub.
  - The doubtful nodes appear on `/merlt/valida` (`ProvisionalReviewSection`
    → `/graph/provisional-review`, decision approve|reject).
- **The Qdrant collection.** `storage/vectors/collection.default_chunks_collection()`
  names it: `QDRANT_COLLECTION` if set, else `<FALKORDB_GRAPH_NAME>_chunks`
  (`merl_t_legal_chunks`). The graph name defaults to `merl_t_legal`
  everywhere.

### MERL-T Loop β #2: learned NER via RLCF

A spaCy 3.7 + `it_core_news_lg` model is trained on a custom `RIFERIMENTO`
label from user corrections. `MERLT_NER_LEARNED_ENABLED` (default `false`)
gates it at inference.

**BFF (`/api/merlt/ner/*`).**

- `POST /ner/feedback`: authenticate + contributionGuard, under the
  `contribution` flag. It accepts 4 surfaces and 4 feedback types, and caps
  `context_window` at 1200 chars.
- The admin routes run under the `ops` flag, with requireAdmin:
  - `GET /ner/feedback/stats`
  - `POST /ner/training/start` (`nIter` → `n_iter`; RQ queue
    `merlt_ner_train`, `job_timeout=3600`)
  - `GET /ner/training/jobs/:jobId`
- `nerClient.ts` times out after `MERLT_NER_TIMEOUT_MS` (default 10 s).
- `schemas/merlt/ner.ts` requires `correctReference` when the feedback type
  is `correction` or `missed`.

**The 4 capture surfaces.**

1. **`article_xref`**: `CitationPreviewPopup` → `CitationNerFeedback`
   (✓ / ✗ / Correggi), gated on `canContribute`.
2. **`qa_chip`**: `QaSynthesisWithCitations` in `DeliberationColumn`, which
   passes `sendNerFeedback` with the answer text as the context. Without a
   handler the component shows no affordance.
3. **`implicit`**: `ArticleTabContent.handleOpenCitationInTab` emits a
   `confirmation`.
4. **`search_mining`**: server-side, in `orchestrator.process`, only when
   `consent_level == 'full'`. It is idempotent per (user, urn), with
   `feedback_id = ner-mining-<sha>`.

**Training.** The A/B report (`worker/ner_training_tasks.py`) scores three
systems on a 20 % hash split:

- `baseline`: the query analyzer's `ARTICLE_PATTERNS` spans joined with the
  VisuaLex `extract_citations` offsets;
- `learned`: the fine-tuned model;
- `combined`: baseline ∪ learned, which is what the flag turns on.

When VisuaLex is unreachable, `baseline` is null, `baseline_available` is
false and `baseline_status.reason` says why. Training still runs.

The report keeps `test_examples`, `baseline` and `learned`. It adds:

- `combined`, `baseline_available`, `baseline_status {available, reason,
  system}`;
- `headline_surfaces` (`article_xref` and `qa_chip`), `match`, and `gold`.
  Precision is a lower bound, because only the confirmed span is annotated;
- `by_surface`, and `counts {records, train, test, by_surface,
  train_only_surfaces}`. `search_mining` rows always go to training;
- `created_at`, `checkpoint_path`, `finetuned_from`, `n_iter`,
  `only_untrained`, `test_percent`.

The report is written atomically to `<checkpoint>/ab_report.json` and to
`models/legal_ner_reports/latest.json`; `MERLT_NER_REPORTS_DIR` overrides the
directory. MERL-T serves it at `GET /api/v1/ner/training/report/latest`, which
declares `verify_api_key` and answers 404 `no_report` before the first run and
500 `report_unreadable` on a bad file. No BFF route proxies it yet. The RQ
training result is kept for 7 days.

The model and its checkpoints live on `merlt_ner_models`, which the api and
the worker share.

**Loop β #2 gotchas:**
1. **The worker queue list is load-bearing.** If `merlt_ner_train` drops out
   of the worker `command`, every training POST stays `queued`. Fix the
   compose file, then run
   `docker compose … up -d --no-deps --force-recreate merlt-worker`.
2. **The privacy budget lives in the BFF.** `ner.ts` caps `context_window` at
   1200.
3. **The `search_mining` `feedback_id` is deterministic.** Re-running a query
   does not duplicate rows.

### MERL-T testing

- **Backend.** vitest + supertest on a real Postgres test DB, with nock
  through `apps/server/tests/nockShim.ts`. `apps/server/tests/setup.ts` truncates
  `merlt_qa_jobs`, `merlt_ingestion_jobs`, `merlt_extraction_jobs`,
  `merlt_consent_audits`, `merlt_user_preferences` and
  `merlt_user_authority_cache` between tests.
- **Frontend.** vitest + jsdom.
- **CI.** `.github/workflows/ci.yml` runs on `main` and `develop`. Its
  `merlt` job, on `develop` and on pull requests into it, runs the MERL-T suite on Python 3.11
  against a Postgres service, after `create_tables()` and
  `ensure_schema_additions()`. Tests marked `integration` (live FalkorDB) are
  excluded by `pyproject.toml` `addopts`.
- **The MERL-T suite locally.** Commands are in `services/merlt/CLAUDE.md`. Use a venv
  in `services/merlt/`, with `ENRICHMENT_DATABASE_URL` pointing at a disposable
  Postgres: the DB-backed tests write rows.

### MERL-T gotchas learned 2026-09-25

1. **npm 11 writes the lockfiles.** npm 10 (Node 20) wants the full platform
   matrix for optional deps. So `npm ci` on npm 10 fails with
   "Missing: @esbuild/... from lock file", and `npm install` on npm 10
   rewrites the lock. CI pins Node 24. Locally, use npm 11, or never commit a
   lock that npm 10 rewrote.
2. **Every floor relation needs a policy mapping.** `CORRELATO` is in
   `SystemicExpert.STATIC_SYSTEMIC_RELATIONS` because co-evolution writes it.
   `GRAPH_TO_POLICY_RELATION` in `rlcf/policy_gradient.py` must map it
   (`correlato` → `RELATED_TO`). Otherwise it collapses onto the fallback, and
   the relation-preference channel treats it as unknown vocabulary.
   `tests/unit/test_traversal_inference_steering.py` imports the expert's list
   instead of copying it.
3. **`merlt.api` re-exports every router under its module's name.**
   `from merlt.api import graph_router` gives you the `APIRouter`, not the
   module. A test that patches module globals must call
   `importlib.import_module("merlt.api.graph_router")`.
4. **RQ job timeouts vs the BFF nets.** RQ's default `job_timeout` is 180 s.
   When it expires, SIGALRM kills the job and bypasses the task's `except`,
   so no failure callback reaches the BFF.
   - Every enqueue sets `job_timeout` explicitly: extraction
     `MERLT_EXTRACT_JOB_TIMEOUT` (1800 s), article ingest 600 s, mechanical
     ingestion 1800 s, NER training 3600 s.
   - The BFF net for a job must exceed its `job_timeout` plus the queue wait
     plus the 5-minute sweep. The extraction net is 45 min for that reason.
   - The ingestion net (10 min) equals the ingest `job_timeout`, so a job
     that uses its whole budget can be flipped just before its callback
     lands.
5. **Match provisional nodes by `source_url` too.** A provisional node's
   `URN`/`node_id` is `live:<hash>`, while Qdrant chunks and `QATrace.sources`
   carry the article URL. Every lookup must match
   `URN OR node_id OR source_url`, with exact hits first: the promotion signal
   writers, the Q&A provenance lookup, and hygiene's twin reconcile.
6. **`user_document` never becomes a graph node.** Stand-alone note entities
   carry `article_urn='user_document'`, because the column is NOT NULL.
   `entity_writer.PLACEHOLDER_ARTICLE_URNS` makes the graph writer skip the
   relation (and record the source as `user_note`), and the relation helper
   refuses placeholders. Without that, consensus MERGEd a
   `:Norma {URN:'user_document'}` hub that every such concept hung off.
7. **The URN suffix regex is longest-first.** The article-suffix list in
   `utils/urn_labels.py` is complete, sorted longest-first, and ends with a
   boundary. Before, `2409-terdecies` became `2409-ter` and collided with the
   real 2409-ter. The BFF `eventMapper.normalizeArticleUrn` reads the same
   table (`apps/server/src/utils/articleSuffixes.ts`) and folds every spelling
   into the joined form the graph keys on (`~art2bis`).
