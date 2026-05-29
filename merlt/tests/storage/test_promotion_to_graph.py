"""Integration test for vote→consensus→graph promotion (loop-closure A3).

A2 proves authority-weighted votes flip `consensus_reached`/`consensus_type`.
This proves the next link: an *approved* PendingEntity is written to FalkorDB as
a real `:Entity` node by the same `EntityGraphWriter.write_entity` that the
validate-entity endpoint calls on approved consensus (enrichment_router.py:1269).

Writes to an ISOLATED test graph (`merlt_test_a3`) so the production Libro IV
graph is never touched; the graph is wiped at teardown.

    docker exec -w /app visualex-merlt-api python -m pytest tests/storage/test_promotion_to_graph.py -q
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio

from merlt.storage.enrichment.models import PendingEntity
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.entity_writer import EntityGraphWriter

TEST_GRAPH = "merlt_test_a3"


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name=TEST_GRAPH)
    await client.connect()
    yield client
    # Wipe the isolated test graph, then close.
    try:
        await client.query("MATCH (n) DETACH DELETE n", {})
    finally:
        await client.close()


def _approved_entity(name: str) -> PendingEntity:
    return PendingEntity(
        entity_id=f"concetto:{name}",
        article_urn="urn:test:a3:art1",
        entity_type="concetto",
        entity_text=name,
        descrizione="Concetto di test per la promozione nel grafo.",
        ambito="generale",
        validation_status="approved",
        consensus_reached=True,
        consensus_type="approved",
    )


async def test_approved_entity_is_written_to_graph(graph):
    name = f"ZZTEST_{uuid.uuid4().hex[:8]}"
    entity = _approved_entity(name)

    writer = EntityGraphWriter(graph)
    result = await writer.write_entity(entity)

    assert result.success is True
    assert result.action == "created"
    # write_entity normalizes the name (lowercase, strip punctuation) into the id.
    assert result.node_id.startswith("concetto:")
    assert "zztest" in result.node_id.lower()

    rows = await graph.query(
        "MATCH (e:Entity {id: $id}) RETURN e.id AS id", {"id": result.node_id}
    )
    assert rows, "expected the promoted Entity node to exist in the graph"
    assert rows[0]["id"] == result.node_id


async def test_unapproved_entity_is_rejected(graph):
    entity = _approved_entity(f"ZZTEST_{uuid.uuid4().hex[:8]}")
    entity.consensus_reached = False
    entity.consensus_type = None

    writer = EntityGraphWriter(graph)
    with pytest.raises(ValueError):
        await writer.write_entity(entity)
