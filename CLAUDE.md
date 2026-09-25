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

### MERL-T Integration (branch `visualex-merlt-main`): where to look

MERL-T is the legal knowledge graph + RLCF sidecar. It exists only on this
branch. Start from these, in `docs/merlt/`:

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

**Runtime topology.** `docker-compose.merlt.yml` defines 7 services:

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
- reads `MERLT_INTERNAL_SECRET` and `MERLT_API_KEY` from `backend/.env` when
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
on the same three queues. `MERLT_PYTHON` defaults to `merlt/.venv/bin/python`,
and the script checks that it can import `merlt.app`. The mode exports the
wiring compose gives the containers: graph name, `RQ_REDIS_URL` on DB 1 of the
MERL-T redis, callback URLs, collection and feature flags. It runs without the
mcp-legal-it tools: `MERLT_MCP_LEGAL_TOOLS_ENABLED=false` unless you set
`MCP_LEGAL_IT_URL`.

**MERL-T code is baked into the image.** Only `merlt/data` is mounted, and it
is read-only. After any change under `merlt/`, a restart is not enough: rebuild
and recreate.

```bash
docker compose -f docker-compose.merlt.yml --profile api-in-docker build merlt-api merlt-worker
docker compose -f docker-compose.merlt.yml --profile api-in-docker up -d --force-recreate merlt-api merlt-worker
```

**Boot, in order (`merlt/merlt/app.py` lifespan).** Each step is failure-isolated:
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
namespace with `merlt_disabled`. `backend/.env.example` ships it `"false"`;
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
on by default; `false`, `0` or `""` disables them. So a group that is switched
off server-side still shows its hub card, and its calls get 404s.

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
`backend/.env.example` ships the same one.

**MERL-T auth and the API key.** Every BFF client sends `MERLT_API_KEY` as
`X-API-Key` when it is set: `merltClient`, `graphClient`, `contribClient`,
`expertsClient`, `nerClient`, `opsClient` and `opsIngestionClient`. No JWT and
no `X-User-ID` is forwarded. MERL-T learns who the user is only from the
`user_id` the BFF injects into the body.

`merlt/merlt/app.py` overrides `verify_api_key` with `optional_api_key`, so only
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

**Job nets (`services/merlt/jobWatchdog.ts`).** `backend/src/index.ts` schedules
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

**BFF (`backend/src/`).**

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
  `backend/logs/merlt-dead-letter.jsonl` (`MERLT_DEAD_LETTER_DIR`). It holds
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
   tree. The first MERL-T copy silently dropped `merlt/merlt/models/`,
   `merlt/merlt/api/models/` and `merlt/merlt/disagreement/data/`. Use
   `--exclude='/models/'` to exclude the top level only.
3. **Tracking is persisted.** `tracking_router` writes `tracking_events`
   (`TrackingEventRecord`). When the DB is unreachable it falls back to a
   bounded in-memory buffer and still answers 202. Verify with
   `SELECT event_type, user_id, created_at FROM tracking_events ORDER BY created_at DESC`.
   Nothing in MERL-T reads the table yet, so the signals feed neither
   authority nor training.
4. **MERL-T paths carry the `/api/v1/` prefix.** See the `include_router` list
   in `merlt/merlt/app.py`. `/health` and `/` are the only root-level routes.
   A nock mock of the wrong path stays green: the Story 1.5 client, and later
   `confirm-source`, proxied to routes that did not exist while their tests
   passed.
   - `backend/tests/nockShim.ts` now honours `reqheaders`/`badheaders`, so
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

**Seed and worker (MERL-T).** `merlt/merlt/scripts/load_seed_libro_iv.py` runs
in the lifespan. It is idempotent (it skips when the graph has >100 nodes) and
MERGEs `merlt/data/seeds/libro-iv-cc-graph.json` on `URN`/`node_id`.
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
  through `backend/tests/nockShim.ts`. `backend/tests/setup.ts` truncates
  `merlt_qa_jobs`, `merlt_ingestion_jobs`, `merlt_extraction_jobs`,
  `merlt_consent_audits`, `merlt_user_preferences` and
  `merlt_user_authority_cache` between tests.
- **Frontend.** vitest + jsdom.
- **CI.** `.github/workflows/ci.yml` triggers on `visualex-merlt-main` too. Its
  `merlt` job, scoped to this branch, runs the MERL-T suite on Python 3.11
  against a Postgres service, after `create_tables()` and
  `ensure_schema_additions()`. Tests marked `integration` (live FalkorDB) are
  excluded by `pyproject.toml` `addopts`.
- **The MERL-T suite locally.** Commands are in `merlt/CLAUDE.md`. Use a venv
  in `merlt/`, with `ENRICHMENT_DATABASE_URL` pointing at a disposable
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
   real 2409-ter. The BFF `eventMapper.normalizeArticleUrn` still knows only
   `bis`..`decies`.

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
- **Known acts** (392) — names `act_resolver.py` understands unaided ("statuto
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
- `utils/dateUtils.ts` — `parseItalianDate`, `formatDateItalianLong`,
  `expandTwoDigitYear` (the one two-digit-year pivot, same as the backend's
  `_expand_year`: "90" → 1990, "23" → 2023).
- `utils/euCitation.ts` — the one reading of an EU pair ("2024/2847" is year
  then number, "679/2016" the reverse, "2006/2004" number first), shared by
  the palette parser and the in-text matcher and mirrored by
  `resolve_eu_year_and_number` in `nl_parser.py`, which `citation_linker.py`
  reuses through `build_eu_act_pattern` / `eu_act_from_groups`. Change all
  four together. The two in-text detectors (`citationMatcher.ts`,
  `citation_linker.py`) read the same prose forms: "regolamento (UE)
  2016/679, art. 5", "art. 5 del regolamento (UE) 2016/679", "art. 5, comma
  1, del …", and a list ("articoli 8 e 9 del …") becomes one link per number,
  all towards the EU act. The client matcher reads the article-first form
  for numbered national acts too ("art. 7 del d.lgs. 196/2003", with or
  without the preposition), as the server's `_EXPLICIT_CITE_RE` and
  `_ART_DEL_ACT_RE` do, and the codici and the Costituzione named in full
  ("art. 5 del codice civile") through `FULL_ACT_NAMES`, the palette's own
  vocabulary. An article the prose gives to an act no pattern can read
  ("art. 17 della legge 23 agosto 1988, n. 400") gets no link on the
  client rather than one to the act being read.
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

29. **A Tailwind class whose token is undeclared fails in total silence.**
    `frontend/tailwind.config.js` is a v3-style config and Tailwind v4 never
    loads it — there is no `@config` in `src/index.css`. Every
    `primary-<number>` class the app wrote therefore generated no CSS at all:
    568 of them across 60 files, including 38 buttons carrying `text-white` on
    a `bg-primary-600` that painted nothing, and the
    `focus-visible:ring-primary-500` this file prescribes for accessibility.
    No build error, no lint warning, no visual difference from a typo. The
    scale now lives in the `@theme` block of `index.css`, which is the only
    place v4 reads; `src/theme.test.ts` compiles the real stylesheet and fails
    if a step stops resolving. **`--color-primary` and `--color-primary-500`
    are different tokens** — `bg-primary` (213 uses) comes from the first and
    must keep working. Everything else the config declares — `font-sans`,
    `shadow-glow`, `animate-shimmer` — is still inert.

28. **Two vocabularies name the same act, and they disagree on case.**
    `constants/actTypes.ts` spells it `Regolamento UE`; the backend resolver
    answers `regolamento ue`. A `===` between the two silently produced an act
    with no name in the palette ("· n. 1689 del 2024") and skipped the step
    that collects an act's number and date. Compare case-insensitively and fall
    back to the raw value: the resolver knows 389 names against `ACT_TYPES`'
    40, so a miss is the normal case, not the exception. Same trap as
    `codice_urn` on the backend.
