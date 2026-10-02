"""Indexes and integrity checks against a throwaway FalkorDB — never the stack's.

Each test writes to a graph of its own (`merlt_test_indexes_<random>`), deleted
after. The client reads FALKORDB_HOST and FALKORDB_PORT: CI sets them for its
integration step; locally, see test_migrate_graph_vocabulary_integration.py.
"""
import asyncio
import uuid

import pytest
import pytest_asyncio
from falkordb import FalkorDB

from merlt.scripts import migrate_graph_vocabulary as mig
from merlt.storage.graph import FalkorDBClient
from merlt.storage.graph.schema import GRAPH_INDEXES

pytestmark = pytest.mark.integration

LIST = "CALL db.indexes() YIELD label, properties RETURN label, properties"

BROKEN = """
CREATE (a:Norma {URN: 'x'}), (b:Norma {URN: 'x'}),
       (c:Norma {URN: 'y', tipo_documento: 'articolo'}),
       (d:Norma {estremi: 'senza chiave'}),
       (a)-[:RINVIA {certezza: 2.0}]->(b),
       (b)-[:RINVIA {certezza: '2.0'}]->(a),
       (a)-[:CORRELATO {certezza: '0.5'}]->(b)
"""

CLEAN = {
    "duplicate_urn": 0,
    "norma_without_urn": 0,
    "article_without_text": 0,
    "isolated_nodes": 0,
    "certezza_out_of_range": 0,
}


def _drop_graph(config) -> None:
    FalkorDB(host=config.host, port=config.port, password=config.password).select_graph(config.graph_name).delete()


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name=f"merlt_test_indexes_{uuid.uuid4().hex[:12]}")
    await client.connect()
    await client.query("CREATE (:Probe)")  # the graph exists from here: db.indexes() needs one
    await client.query("MATCH (n) DETACH DELETE n")
    yield client
    try:
        await asyncio.to_thread(_drop_graph, client.config)
    finally:
        await client.close()


async def _present(client) -> set[tuple[str, str]]:
    return {(row["label"], prop) for row in await client.query(LIST) for prop in row["properties"]}


async def test_indexes_are_created_once(graph):
    assert await mig.ensure_graph_indexes(graph, apply=True) == len(GRAPH_INDEXES)
    assert await mig.ensure_graph_indexes(graph, apply=True) == 0
    assert {(label.value, prop) for label, prop in GRAPH_INDEXES} <= await _present(graph)


async def test_a_dry_run_counts_the_missing_indexes_and_creates_none(graph):
    assert await mig.ensure_graph_indexes(graph, apply=False) == len(GRAPH_INDEXES)
    assert await _present(graph) == set()


async def test_an_index_of_another_kind_is_not_the_one_the_schema_asks_for(graph):
    # A full-text index on Norma.URN, and a relationship index whose type is spelt like
    # the label, leave Norma.URN without the range index every MERGE looks up.
    await graph.query("CREATE (:Norma {URN: 'x'})")
    await graph.query("CALL db.idx.fulltext.createNodeIndex('Norma', 'URN')")
    await graph.query("CREATE INDEX FOR ()-[r:Norma]-() ON (r.URN)")
    assert await mig.ensure_graph_indexes(graph, apply=True) == len(GRAPH_INDEXES)
    assert await mig.ensure_graph_indexes(graph, apply=True) == 0


async def test_integrity_counts_what_is_wrong(graph):
    await graph.query(BROKEN)
    assert await mig.integrity_report(graph) == {
        "duplicate_urn": 1,
        "norma_without_urn": 1,
        "article_without_text": 1,
        "isolated_nodes": 2,
        "certezza_out_of_range": 2,  # 2.0 and '2.0'; '0.5' is in range
    }


async def test_integrity_passes_a_sound_graph_and_spares_stubs(graph):
    await graph.query(
        "CREATE (a:Norma {URN: 'a', tipo_documento: 'articolo', testo: 't'}), "
        "(s:Norma {URN: 's', tipo_documento: 'articolo', is_stub: true}), "
        "(a)-[:RINVIA {certezza: 1.0}]->(s)"
    )
    assert await mig.integrity_report(graph) == CLEAN
