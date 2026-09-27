"""Unit tests for the seed loader (MERLT-2a.1).

Two scenarios documented in the sprint plan acceptance criteria:

    1. Idempotency: when the FalkorDB graph already has > 100 nodes,
       the loader must short-circuit and return SeedLoadResult(skipped=True)
       without touching JSON / Qdrant / Postgres.

    2. Missing seed JSON: the loader must raise SeedLoadError with a
       descriptive message — no silent fallback.

Integration tests (full pipeline against live FalkorDB + Qdrant + Postgres)
are out of scope here; they are covered by the manual smoke checklist
documented in `docs/merlt-smoke-checklist.md`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.scripts.load_seed_libro_iv import (
    IDEMPOTENCY_NODE_THRESHOLD,
    SeedLoadError,
    SeedLoadResult,
    load_seed_libro_iv,
)


@pytest.mark.asyncio
async def test_skip_when_graph_already_populated():
    """If the graph has > IDEMPOTENCY_NODE_THRESHOLD nodes, return skipped=True.

    No call to the JSON loader, embedding service, Qdrant client, or
    bridge psql restore should happen.
    """
    existing_nodes = IDEMPOTENCY_NODE_THRESHOLD + 1

    falkordb = MagicMock()
    falkordb.query = AsyncMock(return_value=[{"c": existing_nodes}])

    # Sentinels: if any of these is called, the test fails — we want hard skip.
    qdrant = MagicMock()
    qdrant.collection_exists = MagicMock(side_effect=AssertionError("must not call qdrant"))
    embedding = MagicMock()
    embedding.encode_batch_async = AsyncMock(
        side_effect=AssertionError("must not call embedder")
    )

    result: SeedLoadResult = await load_seed_libro_iv(
        falkordb_client=falkordb,
        qdrant_client=qdrant,
        embedding_service=embedding,
        pg_dsn="postgres://unused",
        # Paths point to non-existent locations to assert we don't even read them
        seed_graph_path=Path("/nonexistent/seed.json"),
        seed_bridge_path=Path("/nonexistent/bridge.sql"),
    )

    assert result.skipped is True
    assert result.reason == "graph_not_empty"
    assert result.integrity == {"nodes_before": existing_nodes}
    # Verify the idempotency query was the only DB interaction
    falkordb.query.assert_awaited_once()
    cypher_called: str = falkordb.query.await_args.args[0]
    assert "count(n)" in cypher_called.lower()


@pytest.mark.asyncio
async def test_raises_when_seed_json_missing(tmp_path: Path):
    """If the seed JSON file is missing, raise SeedLoadError with the offending path."""
    falkordb = MagicMock()
    # Graph empty -> we proceed past the idempotency check
    falkordb.query = AsyncMock(return_value=[{"c": 0}])

    missing_json = tmp_path / "does_not_exist.json"
    # Bridge SQL exists so the JSON-missing branch is the only failure path
    existing_bridge = tmp_path / "bridge.sql"
    existing_bridge.write_text("-- placeholder")

    with pytest.raises(SeedLoadError) as exc_info:
        await load_seed_libro_iv(
            falkordb_client=falkordb,
            qdrant_client=MagicMock(),
            embedding_service=MagicMock(),
            pg_dsn="postgres://unused",
            seed_graph_path=missing_json,
            seed_bridge_path=existing_bridge,
        )

    assert "Seed JSON not found" in str(exc_info.value)
    assert str(missing_json) in str(exc_info.value)


@pytest.mark.asyncio
async def test_raises_when_bridge_sql_missing(tmp_path: Path):
    """The bridge SQL must exist for the loader to commit; missing -> SeedLoadError."""
    falkordb = MagicMock()
    falkordb.query = AsyncMock(return_value=[{"c": 0}])

    existing_json = tmp_path / "graph.json"
    existing_json.write_text('{"meta": {}, "nodes": [], "edges": []}')
    missing_bridge = tmp_path / "bridge.sql"

    with pytest.raises(SeedLoadError) as exc_info:
        await load_seed_libro_iv(
            falkordb_client=falkordb,
            qdrant_client=MagicMock(),
            embedding_service=MagicMock(),
            pg_dsn="postgres://unused",
            seed_graph_path=existing_json,
            seed_bridge_path=missing_bridge,
        )

    assert "Seed bridge SQL not found" in str(exc_info.value)
