"""Integration: the community entity writer meets the seed on a real FalkorDB.

A community entity whose seed twin exists becomes that node. These tests pin what
only a graph engine can show: the twin is found by the seed's key (accents folded),
it is adopted without being re-keyed by a second alias, and the article that
proposed the entity is linked to it, whether the entity is new, an existing one,
or a seed twin.

Writes to an ISOLATED test graph (`merlt_test_twins`), wiped before and after, so
the Libro IV graph is never touched.

    docker exec -w /app <throwaway-stack>-merlt-api python -m pytest tests/storage/test_entity_writer_twins.py -m integration -q
"""

from __future__ import annotations

import pytest
import pytest_asyncio

# Needs a live FalkorDB (the compose falkordb service): excluded by default through
# pyproject's `-m 'not integration'`; run with `-m integration` in-container.
pytestmark = pytest.mark.integration

from merlt.storage.enrichment.models import PendingEntity
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.entity_writer import EntityGraphWriter

TEST_GRAPH = "merlt_test_twins"
ACT = "urn:nir:stato:regio.decreto:1942-03-16;262:2"
ART_1322 = f"https://www.normattiva.it/uri-res/N2Ls?{ACT}~art1322"
ART_1325 = f"https://www.normattiva.it/uri-res/N2Ls?{ACT}~art1325"


@pytest_asyncio.fixture
async def graph():
    client = FalkorDBClient(graph_name=TEST_GRAPH)
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n", {})
    yield client
    try:
        await client.query("MATCH (n) DETACH DELETE n", {})
    finally:
        await client.close()


def _approved(entity_id: str, entity_type: str, name: str, article_urn: str = ART_1322) -> PendingEntity:
    return PendingEntity(
        entity_id=entity_id,
        article_urn=article_urn,
        entity_type=entity_type,
        entity_text=name,
        descrizione="",
        ambito="generale",
        validation_status="approved",
        consensus_reached=True,
        consensus_type="approved",
        approval_score=2.0,
        votes_count=3,
        contributed_by="u1",
    )


async def _seed(graph, label: str, node_id: str, nome: str) -> None:
    await graph.query(
        f"CREATE (:{label} {{node_id: $nid, nome: $nome, provenance: 'seed'}})", {"nid": node_id, "nome": nome}
    )


async def _count(graph, cypher: str, params: dict | None = None) -> int:
    return (await graph.query(cypher, params or {}))[0]["c"]


async def test_an_accented_concept_becomes_its_seed_twin(graph):
    await _seed(graph, "ConcettoGiuridico", "concetto:patto_di_non_trasferibilita", "Patto di non trasferibilità")

    result = await EntityGraphWriter(graph).write_entity(
        _approved("pe-1", "concetto", "Patto di non trasferibilità")
    )

    # The community id is the slug that drops the accent; the node stays the seed's own.
    assert (result.action, result.node_id) == ("enriched_existing", "concetto:patto_di_non_trasferibilit")
    rows = await graph.query(
        "MATCH (c:ConcettoGiuridico:Entity) RETURN c.node_id AS nid, c.id AS id, c.provenance AS p", {}
    )
    assert rows == [
        {"nid": "concetto:patto_di_non_trasferibilita", "id": "concetto:patto_di_non_trasferibilit", "p": "community_validated"}
    ]
    assert await _count(graph, "MATCH (n) WHERE n:ConcettoGiuridico OR n:Entity RETURN count(n) AS c") == 1


async def test_a_second_alias_keeps_the_id_the_first_gave(graph):
    await _seed(graph, "DefinizioneLegale", "definizione:contratto", "Contratto")
    writer = EntityGraphWriter(graph)

    first = await writer.write_entity(_approved("pe-1", "definizione", "Contratto"))
    second = await writer.write_entity(_approved("pe-2", "definizione_legale", "Contratto"))

    assert first.node_id == second.node_id == "definizione:contratto"
    assert await _count(graph, "MATCH (e:Entity {id: 'definizione:contratto'}) RETURN count(e) AS c") == 1
    assert await _count(graph, "MATCH (e:Entity {id: 'definizione_legale:contratto'}) RETURN count(e) AS c") == 0
    # One node for the concept (the article it hangs off is a Norma, counted apart).
    assert await _count(graph, "MATCH (n) WHERE n:DefinizioneLegale OR n:Entity RETURN count(n) AS c") == 1


async def test_a_twin_merge_links_its_article_once_and_records_the_contribution(graph):
    await _seed(graph, "ConcettoGiuridico", "concetto:crediti_futuri", "Crediti futuri")
    await graph.query(
        "CREATE (:Norma {URN: $u, node_id: $u, provenance: 'seed', estremi: 'Art. 1322 c.c.'})", {"u": ART_1322}
    )
    writer = EntityGraphWriter(graph)

    await writer.write_entity(_approved("pe-1", "concetto", "Crediti futuri"))
    await writer.write_entity(_approved("pe-2", "concetto", "Crediti futuri"))  # the same proposal again

    assert await _count(
        graph, "MATCH (:Norma {URN: $u})-[r:DISCIPLINA]->(:ConcettoGiuridico:Entity) RETURN count(r) AS c", {"u": ART_1322}
    ) == 1
    rows = await graph.query(
        "MATCH (c:Entity {id: 'concetto:crediti_futuri'}) RETURN c.sources AS s, c.votes_count AS v", {}
    )
    assert rows == [{"s": [ART_1322], "v": 6}]
    # The article it hangs off is the seed's, untouched.
    norma = await graph.query("MATCH (a:Norma {URN: $u}) RETURN a.provenance AS p, a.is_stub AS stub", {"u": ART_1322})
    assert norma == [{"p": "seed", "stub": None}]


async def test_a_proposal_for_an_existing_entity_links_the_new_article(graph):
    writer = EntityGraphWriter(graph)

    created = await writer.write_entity(_approved("pe-1", "sanzione", "Multa", ART_1322))
    again = await writer.write_entity(_approved("pe-2", "sanzione", "Multa", ART_1325))

    assert (created.action, again.action) == ("created", "enriched_existing")
    linked = await graph.query(
        "MATCH (a:Norma)-[r:PREVEDE_SANZIONE]->(:Entity {id: 'sanzione:multa'}) RETURN a.URN AS u ORDER BY u", {}
    )
    assert [row["u"] for row in linked] == [ART_1322, ART_1325]
