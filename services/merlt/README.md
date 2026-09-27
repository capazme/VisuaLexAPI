# MERL-T: Multi-Expert Reasoning with Legal Texts (vendored in VisuaLexAPI)

> **This is a vendored fork.** VisuaLexAPI (branch `visualex-merlt-main`) runs this code as the
> MERL-T sidecar, started by the repo-root `start.sh` through `docker-compose.merlt.yml`. It is not
> installed from PyPI, and the upstream standalone flow (`start_dev.sh`,
> `docker-compose.dev.yml`) is not used here. For the architecture, the runbook and the agent
> guidance, see:
>
> - [`../docs/merlt/blueprint.md`](../docs/merlt/blueprint.md)
> - [`../docs/merlt/integration.md`](../docs/merlt/integration.md)
> - [`CLAUDE.md`](CLAUDE.md)

## Overview

MERL-T answers Italian legal questions by *deliberation*. Four experts, one per interpretive canon
of art. 12 preleggi (literal, systemic, principles, precedent), each reason in a ReAct loop with
tools over:

- a FalkorDB legal knowledge graph;
- a Qdrant vector store;
- live legal sources reached through the `mcp-legal-it` MCP server.

An adaptive synthesizer merges their positions, or keeps the dissent.

The system learns from its users through **RLCF** (Reinforcement Learning from Community
Feedback): feedback on answers trains three policy heads (gating, traversal, tool gating) with
REINFORCE, weighted by the user's authority. Community proposals, votes and consensus grow the
graph, and live sources the experts used are absorbed as provisional nodes, then promoted or
pruned.

## Architecture

```
            BFF (VisuaLex Node, /api/merlt/*)
                         |
                  merlt-api :8000  (merlt.app:app)
                         |
      +------------------+------------------+
      |                  |                  |
 Orchestrator        RQ queues         Graph co-evolution
 4 ReAct experts     (merlt-worker)    provisional → promote → hygiene
 + AdaptiveSynth.    ingest / extract
      |              / NER training
      |
 FalkorDB · Qdrant · Postgres (traces, feedback, pending_*, RLCF) · Redis
```

The package layout, the router list and the boot sequence are in [`CLAUDE.md`](CLAUDE.md).

## Quick start (inside VisuaLexAPI)

From the repo root:

```bash
git submodule update --init --recursive vendor/mcp-legal-it   # or let start.sh do it
cp backend/.env.example backend/.env                          # then set MERLT_API_KEY, DATABASE_URL, JWT_SECRET
MERLT_ENABLED=true ./start.sh                                 # builds and starts the 7-service stack
curl -s http://localhost:8000/health
```

After changing any code under `merlt/`, rebuild and recreate: the code is baked into the image.

```bash
docker compose -f docker-compose.merlt.yml --profile api-in-docker build merlt-api merlt-worker
docker compose -f docker-compose.merlt.yml --profile api-in-docker up -d --force-recreate merlt-api merlt-worker
```

To use the engine from Python, go through the HTTP API (`POST /api/v1/experts/query` and friends).
In process, the entry point is `merlt.experts.orchestrator.MultiExpertOrchestrator`, which
`merlt.api.engine_bootstrap.build_orchestrator(ai_service)` builds.

## Tests

```bash
cd merlt
python3.11 -m venv .venv
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install -e ".[dev]"
.venv/bin/python -m pytest tests/ -q
```

The DB-backed tests need `ENRICHMENT_DATABASE_URL` and the `RLCF_*` URLs pointing at a disposable
Postgres, bootstrapped with `create_tables()` and `ensure_schema_additions()`. See
[`CLAUDE.md`](CLAUDE.md) for the exact commands. CI runs the same suite in the `merlt` job of
`.github/workflows/ci.yml`.

## Research

MERL-T implements the architecture described in Allega & Puzio (2025), *MERL-T: A multi-expert
architecture for trustworthy artificial legal intelligence*, and *Reinforcement learning from
community feedback (RLCF)*.

## License

Apache License 2.0 - see [LICENSE](LICENSE)
