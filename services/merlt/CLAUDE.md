# CLAUDE.md: MERL-T (vendored in VisuaLexAPI)

Guidance for agents working under `services/merlt/`. Keep it true of the code: if the code
contradicts a line here, fix the line in the same change.

## What this directory is

`services/merlt/` is the **vendored MERL-T sidecar** of VisuaLexAPI (on
`develop` since the unification; the old `visualex-merlt-main` line is the tag
`archive/visualex-merlt-main`). It started as a selective copy of the upstream research
monorepo `ALIS_CORE/merlt` and has since diverged. **This copy is the source of
truth** for the code VisuaLex runs. `docs/merlt/upstream-sync.md` records what
was copied, how to sync, and the local divergences.

It is not a PyPI package and it has no standalone workflow here. It runs as the
`merlt-api` and `merlt-worker` containers of `infra/compose.yml` (profile
`merlt`), started by the root `start.sh`. `services/merlt/docker-compose.dev.yml`
and `services/merlt/start_dev.sh` are upstream leftovers that VisuaLex does not use.

Read first:

- MERL-T integration across server and web (routes, gates, guards, surfaces, slice history): `docs/merlt/claude-notes.md`.
- `docs/merlt/blueprint.md`: the architecture, verified against the code.
- `docs/merlt/integration.md`: the runbook and the env vars.
- `docs/merlt/contract-matrix.md`: which MERL-T routes the BFF proxies.

Paths in this file: `merlt/…` is the Python package inside this folder;
everything else is relative to the repository root.

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
services/merlt/
├── merlt/                 the Python package (below)
├── tests/                 pytest suite (api, pipeline, rlcf, scripts, storage, unit, worker)
├── alembic/ + alembic.ini Alembic revisions 001–010 + baafa63897a6 (not run by the live stack)
├── config/                RLCF training YAML (`rlcf_training.yaml`)
├── scripts/               utility scripts
├── data/                  seeds + dumps, mounted read-only at /app/data in the containers
├── docs/                  upstream MERL-T docs (historical; VisuaLex docs live in docs/merlt/)
├── Dockerfile             multi-stage, python:3.11-slim, torch CPU + spaCy it_core_news_lg
└── pyproject.toml         deps; extras [dev]; pytest addopts excludes the `integration` marker
```

`services/merlt/merlt/` (the package):

| Package | What lives there |
|---|---|
| `app.py` | the FastAPI app (`merlt.app:app`), the lifespan boot sequence, `/health`, the router list |
| `api/` | the routers (below), `engine_bootstrap.py` (builds the orchestrator, also used by "Riavvia motore"), `auth.py` (`verify_api_key`, `require_role`), `api_key_seed.py`, `models/` (Pydantic DTOs) |
| `experts/` | `orchestrator.py`, the four experts, `base.py`, `react_mixin.py`, `synthesizer.py` (`AdaptiveSynthesizer`), `router.py`, `gating.py`, `neural_gating/` (gating MLP, `HybridExpertRouter`, tool selector), `models.py` (`QATrace`, `QAFeedback`, `ApiKey`), `llm/` |
| `tools/` | the tools the experts call (`search.py`, `mcp_legal_adapter.py` for mcp-legal-it, `registry.py`, …) |
| `rlcf/` | `training_scheduler.py` (buffer, `add_experience`, persistence), `replay_buffer.py`, `buffer_rehydration.py`, `policy_gradient.py` (REINFORCE, `GRAPH_TO_POLICY_RELATION`), `policy_manager.py` (loads `*_latest.pt`), `authority.py`, `domain_authority.py`, `authority_sync.py`, `aggregation.py`, `devils_advocate.py`, `quarantine_service.py`, `ai_service.py` (`OpenRouterService`), and more |
| `weights/` | `store.py` (`WeightStore`, `weight_versions`), `learner.py`, `experiment.py`, `config/` |
| `pipeline/` | `document_parser.py` (notes → staging, relation endpoint resolution), `provisional_writer.py`, `promotion.py`, `hygiene.py`, `mechanical_ingestion/` (parser, conflict report, promote), `massimario/` (the Massimario's annual reviews: portal links to URNs, paragraphs, citation grammar, volume assembly, promotion, vectors, the reader), `ingestion.py`, `enrichment/`, `semantic_chunking/`, `live_enrichment.py`, `multivigenza.py` |
| `storage/` | `graph/` (FalkorDB client and config, `entity_writer.py`, `relation_endpoints.py`), `vectors/` (embeddings, `collection.py`), `retriever/`, `bridge/`, `trace/`, `temporal/`, `enrichment/` (SQLAlchemy models, `database.py`, `consensus_triggers.py`, `schema_additions.py`, `deduplication.py`), `migrations/` (plain SQL for the `create_tables()` stack) |
| `worker/` | RQ tasks: `tasks.py` (article ingest), `extraction_tasks.py` (`extract_to_staging`), `mechanical_ingest_tasks.py`, `massimario_tasks.py` (a promoted Massimario batch's vectors and bridge rows, 100 paragraphs a job, chained on `merlt_bulk`), `ner_training_tasks.py` |
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
| `rassegne_router` | `/rassegne` (`GET /by-norma`: the review paragraphs citing a norm, by year) |
| `user_data_router` | `/user-data` (`GET` and `DELETE /{user_id}`: a person's data, for the BFF only; see Personal data) |

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
9. The retention loop, always (see Personal data).

**The live stack never runs Alembic.** A column added to a model must also go
into `storage/enrichment/schema_additions.py`, and into a SQL file under
`storage/migrations/` and an Alembic revision for parity. Otherwise the ORM
selects a column that Postgres does not have.

The RQ worker has no lifespan: every task that touches the enrichment DB calls
`await init_db()` first.

## Personal data

MERL-T keeps the VisuaLex user id in clear, next to what the person did and
wrote: it is personal data, collected only with the user's consent, which the
BFF checks (`merlt_user_preferences`). `merlt/privacy/` holds the obligations:

- `user_data.py`: `USER_COLUMNS`, the one inventory of the columns that hold a
  user id, and `export_user_data` / `erase_user_data` over it, plus the stores
  outside Postgres (the uploaded files, the graph's `contributed_by`, the RLCF
  replay buffer). Private data is deleted; what the community took up (approved
  proposals, votes, issue reports) stays with the link to the person cut. Every
  step is idempotent, and a failed store makes the answer 503 so the BFF retries.
  Errors report the exception's class only: a message can carry the user id.
- `retention.py` (periods decided by the owner, 18 October 2026):
  `tracking_events` expire after `MERLT_TRACKING_RETENTION_DAYS` (default 365);
  the assistant's questions (`qa_traces`), the judgements on them (`qa_feedback`,
  the Devil's Advocate log), the citation feedback (`ner_feedback`) and the replay
  buffer's experiences after `MERLT_ASSISTANT_RETENTION_DAYS` (default 730); each
  pass also strips `note_text` from stored events. The lifespan loop runs every
  `MERLT_RETENTION_INTERVAL_HOURS` (default 24), first a few minutes after boot.
- **MERL-T never collects the text of a note** (the owner, 18 October 2026, «c»):
  an annotation event carries the anchored passage, never the note's words. The BFF
  does not relay it; do not add a field that carries it.
- `api/user_data_router.py`: `GET`/`DELETE /api/v1/user-data/{user_id}`, admin
  key only (`require_role("admin")`).

Never call the user id «anonymous», «opaque» or «pseudonymous», and never log
it next to a payload. The research export (`export_router`) pseudonymises with a
salted hash, which is still personal data for whoever holds the salt.

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
| `utils/sources.py` | the source convention as MERL-T holds it: the URN normaliser, a node's `estremi` (`short_norm`, `short_from_urn`), an act's `titolo` (`act_heading`) and `autorita_emanante`, a decision's `estremi` (`decision_short`). A copy of the API's `visualex_api/tools/sources.py` (MERL-T does not import it), pinned by `tests/unit/test_sources_golden.py` to `conventions/sources/golden.json`, as are the copies of `NORMATTIVA_URN_CODICI`, `ANNEXED_ACTS`, `ANNEX_SIGLE` and `ANNEX_HEADINGS` (`utils/map.py`; an annex of a code's decree cited by its own sigla, G-369; an act whose text is its annex, the TULPS, is keyed by it and never named, G-351) and of the ordinal table (`utils/article_suffixes.py`). `scripts/backfill_source_labels.py` rewrites the graph's labels (dry run by default) |
| `api/experts_router.py`, `api/enrichment_router.py`, `api/graph_router.py` | the BFF-facing contract; see `docs/merlt/contract-matrix.md` |

## Running

**In Docker (the supported path), from the repo root.** Only `services/merlt/data`
is mounted, so after any code change rebuild and recreate:

```bash
MERLT_ENABLED=true ./start.sh
docker compose -f infra/compose.yml --profile merlt build merlt-api merlt-worker
docker compose -f infra/compose.yml --profile merlt up -d --force-recreate merlt-api merlt-worker
```

**Locally** (developer mode, deps still in Docker):

```bash
python3.11 -m venv services/merlt/.venv
services/merlt/.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
services/merlt/.venv/bin/pip install -e 'services/merlt[dev]'
MERLT_ENABLED=true MERLT_API_IN_DOCKER=false ./start.sh
```

In this mode `start.sh` runs `uvicorn merlt.app:app --reload` and a local
`rq worker merlt_ingest merlt_extract merlt_ner_train merlt_bulk`, from `MERLT_PYTHON`
(default `services/merlt/.venv/bin/python`).

The host ports, all bound to 127.0.0.1: postgres 5436, redis 6381, FalkorDB
6382, Qdrant 6343, api 8000, mcp-legal-it 8011. Inside the compose network the
services use their container ports (FalkorDB and Redis on 6379, Qdrant on 6333).

## Tests

CI (`.github/workflows/ci.yml`, job `merlt`, on `develop` and on pull requests
into it) is the reference run. On Python 3.11 it:

1. installs CPU torch, then `pip install -e ".[dev]"`;
2. bootstraps a Postgres service with `init_db()`, `create_tables()` and
   `ensure_schema_additions()`;
3. runs `python -m pytest tests/ -q`;
4. runs `python -m pytest tests/ -q -m integration` against a FalkorDB service
   (the image `infra/compose.yml` pins), with `FALKORDB_HOST` and
   `FALKORDB_PORT` set for that step only.

Tests marked `integration` need a live FalkorDB: `pyproject.toml` `addopts`
excludes them from a plain run. Run them with `-m integration` against a
disposable FalkorDB (`FALKORDB_HOST`, `FALKORDB_PORT`; the client's default
is `localhost:6380`), never the development graph. CI has only Postgres and
FalkorDB, so a test that needs another live service (Qdrant, Normattiva)
needs a marker of its own, kept out of CI.

Locally, from the venv. The DB-backed tests write rows, so point them at a
disposable database, never at the dev stack's data:

```bash
cd services/merlt
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

(`merlt_test` must exist: `createdb -h localhost -p 5436 -U postgres -O merlt merlt_test` — the `merlt`
role cannot create databases; the superuser's password is `POSTGRES_PASSWORD` in `infra/.env`.)

**In a container:** `docker exec -w /app <stack>-merlt-api python -m pytest tests/ -q`,
where `<stack>` is a throwaway stack (`VISUALEX_STACK=… ` with its own ports,
see `infra/.env.example`), never the development one: the command runs against
that stack's own database, and the tests write rows. The Dockerfile copies
`tests/` and installs pytest; this works only while
`services/merlt/.dockerignore` does not exclude `tests/`.

**Test gotchas:**

- `merlt.api` re-exports every router under its module's name.
  `from merlt.api import graph_router` gives you the `APIRouter`, not the
  module. To patch module globals, use
  `importlib.import_module("merlt.api.graph_router")`.
- Tests that pin shared vocabularies (the systemic relation floor, for
  example) must import the source list, not copy it.
- `tests/unit/test_sources_golden.py` reads `conventions/sources/golden.json`
  and two of the API's files above `services/merlt`; inside a throwaway
  container mount `conventions/` and `services/visualex/visualex_api/tools/` at
  the same place above `/app`, or deselect it by name.

## Conventions

- Async everywhere (FastAPI, SQLAlchemy async, FalkorDB client). Log with
  `structlog`.
- `user_id` is the VisuaLex user id, a `varchar(100)` string in clear, never a
  foreign key. It is personal data, not an anonymous or pseudonymous id: every
  table, column or store that keeps it is listed in `privacy/user_data.py`
  (`USER_COLUMNS`), which the per-user export and erasure walk. A new one goes
  there in the same change.
- RQ job ids use `-`, never `:`, and every enqueue sets an explicit
  `job_timeout`: RQ's 180 s default kills with SIGALRM and skips the task's
  `except`.
- The FalkorDB graph key for a norm is the full Normattiva URL, without the
  version marker. Strip only the marker (`!vig=`, `@originale`), never the URL
  wrapper. `schema.canonical_urn` is the one function that does it, and every
  writer and reader calls it (a `strip` goes around the call, not instead of it).
  It cuts a norm reference and returns any other string as it is: a case-law URL
  such as an Italgiure id holds `@` and is not a norm's key.
- One graph name (`merl_t_legal`) and one Qdrant collection
  (`storage/vectors/collection.default_chunks_collection()`).
- The tools the experts call, the temporal validity check, the graph context and the
  graph router's relation and subgraph reads use `FalkorDBClient.ro_query`
  (GRAPH.RO_QUERY: the server refuses a write). A new reader should too; a writer
  uses `query`.
- A tool argument is chosen by an LLM that reads retrieved text, so it reaches
  Cypher text only as a relation or label name from `storage/graph/schema.py`
  (`cypher_rel_names`, `cypher_labels`) or as a number clamped by
  `tools/base.bounded_int`; every other value is a parameter. A filter that comes
  out empty returns an empty result, never an unfiltered query.
- A community entity is written `:Entity:<Label>`, the label of its kind from
  `schema.ENTITY_LABEL_BY_TYPE` (`:Entity` alone when the type has none). FalkorDB
  orders a node's labels by label id, so `labels(n)[0]` can be `Entity`: a node's
  type is read with `schema.node_type_from_labels` (Python) or
  `schema.node_type_cypher` (Cypher), the first label that is not `Entity`. A
  contract test fails on `labels(x)[0]` in Cypher.
- Do not change the authority algorithm or the synthesizer's contract without
  the owner's approval.
- Brocardi is no longer a source (D-078). MERL-T does not fetch from it: the
  VisuaLex client's `fetch_brocardi_info` returns nothing without a call,
  `include_brocardi` defaults to False, no expert is granted `cerca_brocardi`
  (it stays out of `BaseExpert.LIVE_LEGAL_TOOLS`, or the per-expert filter would
  hand it to every expert), and `cite_law` never gets `include_annotations`
  (`tools/mcp_legal_adapter._BROCARDI_ARGUMENTS`). Its slot in `TOOL_VOCAB`
  stays: the vocabulary is append-only. The Brocardi data already in the graph
  and in Qdrant stays (the owners' decision), but **its text never reaches a
  user**: `storage/graph/brocardi_guard.py` recognises it (its `fonte`, the
  `massima_`/`dottrina_…` ids, the Brocardi-only source types, a brocardi.it
  URL) and takes the text out, keeping the ids and, for a massima, its decision's
  `estremi`. It runs on every tool result in `BaseTool.__call__` (so before any
  LLM prompt and any trace), on every node `graph_router._parse_graph_node_v2`
  returns, on the provisional-review rows, on the validation queue, and on the
  stored turns `/experts/history` and `/experts/trace` read back (a turn stored
  before the guard has no `brocardi_guard` mark in `full_trace`, and its retrieval
  summaries and non-norm excerpts are emptied), and on the turns the per-user
  export returns. A new path that hands graph or vector text to a user or to an
  LLM goes through it. **Accepted limit:** an answer the LLM wrote before the
  guard (`synthesis_text`, the experts' theses) may quote Brocardi verbatim, and
  `/experts/history`, `/experts/trace` and the export serve it as it was written;
  it leaves with the assistant retention (`MERLT_ASSISTANT_RETENTION_DAYS`).
