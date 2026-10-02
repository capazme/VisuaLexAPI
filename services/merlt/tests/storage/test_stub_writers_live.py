"""Integration: the two writers that create a Norma stub leave exactly the schema's shape.

`schema.stub_properties` is the one shape of a stub, and the migration's `unify_stubs`
reshapes any stub that differs from it. A writer that adds a property of its own (it was
`created_at`) leaves a stub the migration's check reports as reshaped, whenever the stub
is born between `--apply` and the check. Only a graph engine shows what the node holds.

Writes to an ISOLATED test graph (`merlt_test_stub_writers`), wiped before and after, so
the Libro IV graph is never touched.

    docker exec -w /app <throwaway-stack>-merlt-api python -m pytest tests/storage/test_stub_writers_live.py -m integration -q
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
import pytest_asyncio

from merlt.api.enrichment_router import _NORMA_PATTERN, _GraphEndpoint, _relation_write_cypher
from merlt.scripts import migrate_graph_vocabulary as mig
from merlt.storage.enrichment.models import PendingEntity
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.entity_writer import EntityGraphWriter
from merlt.storage.graph.schema import stub_properties

# Needs a live FalkorDB (the compose falkordb service): excluded by default through
# pyproject's `-m 'not integration'`; run with `-m integration` in-container.
pytestmark = pytest.mark.integration

TEST_GRAPH = "merlt_test_stub_writers"
CODE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2"
ART = CODE + "~art1321"
STUB_BY_ENTITY = CODE + "~art1322"
STUB_BY_RELATION = CODE + "~art1323"


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name=TEST_GRAPH)
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n", {})
    await client.query(
        "CREATE (:Norma {URN: $art, node_id: $art, tipo_documento: 'articolo', testo: 'Testo.'}), "
        "(:Entity:PrincipioGiuridico {id: 'principio:buona_fede', node_id: 'principio:buona_fede', nome: 'buona fede'})",
        {"art": ART},
    )
    yield client
    try:
        await client.query("MATCH (n) DETACH DELETE n", {})
    finally:
        await client.close()


async def _properties(graph, urn: str) -> list[dict]:
    rows = await graph.query("MATCH (n:Norma {URN: $u}) RETURN properties(n) AS p", {"u": urn})
    return [row["p"] for row in rows]


async def test_the_entity_writers_stub_is_the_schema_shape_and_the_migration_leaves_it(graph):
    proposal = PendingEntity(
        entity_id="pe-1",
        article_urn=STUB_BY_ENTITY + "!vig=2020-01-01",
        entity_type="principio",
        entity_text="Lealta",
        descrizione="",
        ambito="generale",
        validation_status="approved",
        consensus_reached=True,
        consensus_type="approved",
        approval_score=2.0,
        votes_count=3,
        contributed_by="u1",
    )
    await EntityGraphWriter(graph).write_entity(proposal)
    assert await _properties(graph, STUB_BY_ENTITY) == [stub_properties(STUB_BY_ENTITY)]
    report = await mig.unify_stubs(graph, apply=False, batch=10)
    assert report["reshaped"] == 0 and report["reported"] == []


async def test_the_relation_writers_stub_is_the_schema_shape_and_the_migration_leaves_it(graph):
    source = _GraphEndpoint(key=STUB_BY_RELATION, pattern=_NORMA_PATTERN, create_norma=True)
    target = _GraphEndpoint(key=ART, pattern=_NORMA_PATTERN)
    params = {
        "source_key": STUB_BY_RELATION,
        "source_stub": stub_properties(STUB_BY_RELATION),
        "target_key": ART,
        "certezza": 1.0,
        "evidence": "",
        "approval_score": 2.0,
        "votes_count": 3,
        "contributed_by": "u1",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    assert await graph.query(_relation_write_cypher("RINVIA", source, target), params)
    assert await _properties(graph, STUB_BY_RELATION) == [stub_properties(STUB_BY_RELATION)]
    report = await mig.unify_stubs(graph, apply=False, batch=10)
    assert report["reshaped"] == 0 and report["reported"] == []
