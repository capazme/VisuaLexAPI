# CLAUDE.md: MERL-T (vendored in VisuaLexAPI)

Guidance for agents working under `merlt/`. Keep it true of the code: if the code
contradicts a line here, fix the line in the same change.

## What this directory is

`merlt/` is the **vendored MERL-T sidecar** of VisuaLexAPI, branch
`visualex-merlt-main`. It started as a selective copy of the upstream research
monorepo `ALIS_CORE/merlt` and has since diverged. **This copy is the source of
truth** for the code VisuaLex runs. `docs/merlt/upstream-sync.md` records what
was copied, how to sync, and the local divergences.

It is not a PyPI package and it has no standalone workflow here. It runs as the
`merlt-api` and `merlt-worker` containers of `docker-compose.merlt.yml`, at the
repo root, started by the root `start.sh`. `merlt/docker-compose.dev.yml` and
`merlt/start_dev.sh` are upstream leftovers that VisuaLex does not use.

Read first:

- `../CLAUDE.md`, the MERL-T sections: topology, BFF contract, gates, gotchas.
- `../docs/merlt/blueprint.md`: the architecture, verified against the code.
- `../docs/merlt/integration.md`: the runbook and the env vars.
- `../docs/merlt/contract-matrix.md`: which MERL-T routes the BFF proxies.

The browser never calls MERL-T. Every call comes from the Node BFF
(`/api/merlt/*`), which injects `user_id` into the body and sends `X-API-Key`
when it is configured.

## What it does

A legal question is deliberated by four experts, one per canon of art. 12
preleggi. Each expert reasons in a ReAct loop with tools. An adaptive
synthesizer merges their answers (convergent) or keeps the dissent (divergent).

| Expert | Canon | File |
|---|---|---|
| `LiteralExpert` | letterale | `merlt/experts/literal.py` |
| `SystemicExpert` | sistematico (walks the graph) | `merlt/experts/systemic.py` |
| `PrinciplesExpert` | principî | `merlt/experts/principles.py` |
| `PrecedentExpert` | precedente | `merlt/experts/precedent.py` |

**RLCF (Reinforcement Learning from Community Feedback)** turns user feedback
into REINFORCE updates of three policy heads: gating, traversal and
tool_gating. The authority of the user scales the learning rate.

The graph co-evolves on its own:

- live sources become provisional `live:` nodes;
- use and feedback promote them;
- a hygiene sweep decays and prunes the ones nobody uses.

## Real layout

```
merlt/
├── merlt/                 the Python package (below)
├── tests/                 pytest suite (api, pipeline, rlcf, scripts, storage, unit, worker)
├── alembic/ + alembic.ini Alembic revisions 001–008 + baafa63897a6 (not run by the live stack)
├── config/                RLCF training YAML (`rlcf_training.yaml`)
├── scripts/               utility scripts
├── data/                  seeds + dumps, mounted read-only at /app/data in the containers
├── docs/                  upstream MERL-T docs (historical; VisuaLex docs live in ../docs/merlt/)
├── Dockerfile             multi-stage, python:3.11-slim, torch CPU + spaCy it_core_news_lg
└── pyproject.toml         deps; extras [dev]; pytest addopts excludes the `integration` marker
```

`merlt/merlt/` (the package):

| Package | What lives there |
|---|---|
| `app.py` | the FastAPI app (`merlt.app:app`), the lifespan boot sequence, `/health`, the router list |
| `api/` | the routers (below), `engine_bootstrap.py` (builds the orchestrator, also used by "Riavvia motore"), `auth.py` (`verify_api_key`, `require_role`), `api_key_seed.py`, `models/` (Pydantic DTOs) |
| `experts/` | `orchestrator.py`, the four experts, `base.py`, `react_mixin.py`, `synthesizer.py` (`AdaptiveSynthesizer`), `router.py`, `gating.py`, `neural_gating/` (gating MLP, `HybridExpertRouter`, tool selector), `models.py` (`QATrace`, `QAFeedback`, `ApiKey`), `llm/` |
| `tools/` | the tools the experts call (`search.py`, `mcp_legal_adapter.py` for mcp-legal-it, `registry.py`, …) |
| `rlcf/` | `training_scheduler.py` (buffer, `add_experience`, persistence), `replay_buffer.py`, `buffer_rehydration.py`, `policy_gradient.py` (REINFORCE, `GRAPH_TO_POLICY_RELATION`), `policy_manager.py` (loads `*_latest.pt`), `authority.py`, `domain_authority.py`, `authority_sync.py`, `aggregation.py`, `devils_advocate.py`, `quarantine_service.py`, `ai_service.py` (`OpenRouterService`), and more |
| `weights/` | `store.py` (`WeightStore`, `weight_versions`), `learner.py`, `experiment.py`, `config/` |
| `pipeline/` | `document_parser.py` (notes → staging, relation endpoint resolution), `provisional_writer.py`, `promotion.py`, `hygiene.py`, `mechanical_ingestion/` (parser, conflict report, promote), `ingestion.py`, `enrichment/`, `semantic_chunking/`, `live_enrichment.py`, `multivigenza.py` |
| `storage/` | `graph/` (FalkorDB client and config, `entity_writer.py`, `relation_endpoints.py`), `vectors/` (embeddings, `collection.py`), `retriever/`, `bridge/`, `trace/`, `temporal/`, `enrichment/` (SQLAlchemy models, `database.py`, `consensus_triggers.py`, `schema_additions.py`, `deduplication.py`), `migrations/` (plain SQL for the `create_tables()` stack) |
| `worker/` | RQ tasks: `tasks.py` (article ingest), `extraction_tasks.py` (`extract_to_staging`), `mechanical_ingest_tasks.py`, `ner_training_tasks.py` |
| `ner/` | spaCy model, feedback buffer, training data conversion |
| `disagreement/` | the companion `LegalDisagreementNet` classifier (not part of the policy gradient) |
| `citation/`, `clients/`, `config/`, `core/`, `utils/`, `scripts/`, `benchmark/` | URN parsing/formatting; the client to the VisuaLex Python API; `RuntimeConfig`; `LegalKnowledgeGraph`; `urn_labels.py`, `urngenerator.py`, ordinals, maps; the seed loader and backfills; the RAG benchmark |
| `models/`, `services/`, `sources/` | mappings; empty placeholder packages |

## HTTP API

The app is `merlt.app:app`. `/health` and `/` are the only root routes. Every
router is mounted with `prefix="/api/v1"` plus its own prefix:

| Router | Prefix |
|---|---|
| `feedback_api` | `/feedback` |
| `auth_api` | `/auth` |
| `experts_router` | `/experts` |
| `admin_router` | `/admin` |
| `enrichment_router` | `/enrichment` |
| `document_router` | `/documents`, `/amendments`, `/candidates` |
| `graph_router` | `/graph` |
| `pipeline_router` | `/pipeline` |
| `training_router` | `/training` |
| `trace_router` | `/traces` |
| `validity_router` | `/validity` |
| `citation_router` | `/citations` |
| `dashboard_router` | `/dashboard` |
| `profile_router` | `/profile` |
| `rlcf_router` | `/rlcf` |
| `expert_metrics_router` | `/expert-metrics` |
| `ws_router` | `/ws` |
| `tracking_router` | `/tracking` |
| `policy_evolution_router` | `/policy-evolution` |
| `export_router` | `/export` |
| `devils_advocate_router` | `/devils-advocate` |
| `audit_router` | `/audit` |
| `circuit_breaker_router` | `/circuit-breaker` |
| `regression_router` | `/regression` |
| `quarantine_router` | `/feedback` (same prefix as `feedback_api`, different paths) |
| `api_keys_router` | `/api-keys` |
| `ner_router` | `/ner` |
| `ingestion_mechanical_router` | `/ingestion/mechanical` |

**Auth.** `app.py` sets `app.dependency_overrides[verify_api_key] = optional_api_key`,
so a route that declares only `verify_api_key` accepts requests without a key.
Only `require_role("admin")` checks the key.

- Among the routes the BFF uses, those are `/rlcf/training/{start,stop}` and
  `/ingestion/mechanical/*`.
- `/admin/*` and `/ner/*` are therefore open at this layer. Never expose :8000,
  and design every new sensitive route assuming `verify_api_key` filters
  nothing.
- The admin key is seeded at boot from `MERLT_ADMIN_API_KEY`
  (`api/api_key_seed.py`).

**Callbacks to the BFF.** They carry `X-Internal-Secret` (`MERLT_INTERNAL_SECRET`):

- the worker posts to `BFF_CALLBACK_URL` and `BFF_EXTRACTION_CALLBACK_URL`;
- the api's async Q&A task posts to `BFF_QA_CALLBACK_URL`.

## Boot (the `app.py` lifespan)

Each step is failure-isolated: if one fails, it logs and the boot goes on.

1. `init_db()` and `create_tables()`.
2. `ensure_consensus_triggers()`.
3. `ensure_schema_additions()`.
4. `ensure_admin_api_key()`.
5. The expert system (`engine_bootstrap.build_orchestrator`).
6. Replay-buffer rehydration, when no buffer file was loaded.
7. The Libro IV seed (`MERLT_SKIP_SEED`).
8. The hygiene loop, when `MERLT_HYGIENE_INTERVAL_HOURS > 0`.

**The live stack never runs Alembic.** A column added to a model must also go
into `storage/enrichment/schema_additions.py`, and into a SQL file under
`storage/migrations/` and an Alembic revision for parity. Otherwise the ORM
selects a column that Postgres does not have.

The RQ worker has no lifespan: every task that touches the enrichment DB calls
`await init_db()` first.

## Critical files: read before editing

| File | Why |
|---|---|
| `experts/base.py` | the expert contract and the LLM call path; keep the signatures |
| `experts/orchestrator.py`, `experts/synthesizer.py` | query flow, `forced_mode`, progress callbacks, disagreement |
| `rlcf/authority.py` | the authority algorithm: needs the owner's explicit approval |
| `rlcf/policy_gradient.py`, `rlcf/training_scheduler.py` | REINFORCE and the buffer; `GRAPH_TO_POLICY_RELATION` must map every floor relation |
| `storage/enrichment/models.py`, `schema_additions.py`, `consensus_triggers.py` | the schema and the vote → consensus chain |
| `storage/graph/entity_writer.py`, `relation_endpoints.py` | what consensus writes into FalkorDB; the `user_document` placeholder must never become a node |
| `pipeline/provisional_writer.py`, `promotion.py`, `hygiene.py` | the graph co-evolution; match nodes by `URN OR node_id OR source_url` |
| `utils/urn_labels.py` | URN → label, the article-suffix regex (longest-first) |
| `api/experts_router.py`, `api/enrichment_router.py`, `api/graph_router.py` | the BFF-facing contract; see `../docs/merlt/contract-matrix.md` |

## Running

**In Docker (the supported path), from the repo root.** Only `merlt/data` is
mounted, so after any code change rebuild and recreate:

```bash
MERLT_ENABLED=true ./start.sh
docker compose -f docker-compose.merlt.yml --profile api-in-docker build merlt-api merlt-worker
docker compose -f docker-compose.merlt.yml --profile api-in-docker up -d --force-recreate merlt-api merlt-worker
```

**Locally** (developer mode, deps still in Docker):

```bash
python3.11 -m venv merlt/.venv
merlt/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
merlt/.venv/bin/pip install -e 'merlt[dev]'
MERLT_ENABLED=true MERLT_API_IN_DOCKER=false MERLT_COMPOSE_ENABLED=true ./start.sh
```

In this mode `start.sh` runs `uvicorn merlt.app:app --reload` and a local
`rq worker merlt_ingest merlt_extract merlt_ner_train`, from `MERLT_PYTHON`
(default `merlt/.venv/bin/python`).

The host ports, all bound to 127.0.0.1: postgres 5436, redis 6381, FalkorDB
6382, Qdrant 6343, api 8000, mcp-legal-it 8011. Inside the compose network the
services use their container ports (FalkorDB and Redis on 6379, Qdrant on 6333).

## Tests

CI (`.github/workflows/ci.yml`, job `merlt`, branch `visualex-merlt-main`) is
the reference run. On Python 3.11 it:

1. installs CPU torch, then `pip install -e ".[dev]"`;
2. bootstraps a Postgres service with `init_db()`, `create_tables()` and
   `ensure_schema_additions()`;
3. runs `python -m pytest tests/ -q`.

Tests marked `integration` (live FalkorDB) are excluded by `pyproject.toml`
`addopts`. Run them with `-m integration`.

Locally, from the venv. The DB-backed tests write rows, so point them at a
disposable database, never at the dev stack's data:

```bash
cd merlt
export ENRICHMENT_DATABASE_URL=postgresql+asyncpg://merlt:merlt@localhost:5436/merlt_test
export RLCF_DATABASE_URL=postgresql://merlt:merlt@localhost:5436/merlt_test
export RLCF_ASYNC_DATABASE_URL=postgresql+asyncpg://merlt:merlt@localhost:5436/merlt_test
export DATABASE_URL=postgresql://merlt:merlt@localhost:5436/merlt_test
.venv/bin/python -c "import asyncio
from merlt.storage.enrichment.database import init_db, create_tables
from merlt.storage.enrichment.schema_additions import ensure_schema_additions
async def main():
    await init_db(); await create_tables(); await ensure_schema_additions()
asyncio.run(main())"
.venv/bin/python -m pytest tests/ -q
```

(`merlt_test` must exist: `createdb -h localhost -p 5436 -U merlt merlt_test`.)

**In the container:** `docker exec -w /app visualex-merlt-api python -m pytest tests/ -q`.
The Dockerfile copies `tests/` and installs pytest, and this works only if
`merlt/.dockerignore` does not exclude `tests/`. The command runs against the
stack's own database.

**Two test gotchas:**

- `merlt.api` re-exports every router under its module's name.
  `from merlt.api import graph_router` gives you the `APIRouter`, not the
  module. To patch module globals, use
  `importlib.import_module("merlt.api.graph_router")`.
- Tests that pin shared vocabularies (the systemic relation floor, for
  example) must import the source list, not copy it.

## Conventions

- Async everywhere (FastAPI, SQLAlchemy async, FalkorDB client). Log with
  `structlog`.
- `user_id` is an opaque `varchar(100)` string (the VisuaLex user id), never a
  foreign key.
- RQ job ids use `-`, never `:`, and every enqueue sets an explicit
  `job_timeout`: RQ's 180 s default kills with SIGALRM and skips the task's
  `except`.
- The FalkorDB graph key for a norm is the full Normattiva URL, without the
  version marker. Strip only the marker (`!vig=`, `@originale`), never the URL
  wrapper.
- One graph name (`merl_t_legal`) and one Qdrant collection
  (`storage/vectors/collection.default_chunks_collection()`).
- Do not change the authority algorithm or the synthesizer's contract without
  the owner's approval.
