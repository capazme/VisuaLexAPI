"""Integration: a lazy ingestion of an ordinary act fills the stub the Massimario left.

The Massimario's promotion creates a `Norma` stub for every article a review cites
(vol. 96 created 430 on 4 Oct 2026). When a reader opens one of them, the lazy
ingestion must write the text on that same node, keyed by the one URN vocabulary,
never on a parallel one: the decisions' `INTERPRETA` edges hang on the stub.

The stub is made the Massimario's way (portal link → canonical URN → its MERGE),
the job's parameters come from the worker's own URN mapping, and VisuaLex is mocked
(the text below is test text, not the law's).

Writes to an ISOLATED test graph (`merlt_test_lazy_ingest_identity`), wiped before
and after, so the Libro IV graph is never touched.

    FALKORDB_HOST=… FALKORDB_PORT=… python -m pytest tests/storage/test_lazy_ingest_identity_live.py -m integration -q
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio

from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph
from merlt.pipeline.ingestion import IngestionPipelineV2
from merlt.pipeline.massimario.promote import _MERGE_DECISIONS, _MERGE_EDGES, _MERGE_STUBS
from merlt.pipeline.massimario.urns import parse_portal_urn, to_canonical
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.schema import stub_properties
from merlt.worker.tasks import _urn_to_ingest_params

pytestmark = pytest.mark.integration

TEST_GRAPH = "merlt_test_lazy_ingest_identity"
PORTAL_ARTICLE = "/uri-res/N2Ls?urn:nir:stato:legge:2012-12-31;247~art18"
PORTAL_ACT = "/uri-res/N2Ls?urn:nir:stato:legge:2012-12-31;247"
DECISION = "cass:test:1"
CODE_CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2"
TEXT = (
    "Art. 18\n\n(Rubrica di prova).\n\n"
    "Primo comma del testo di prova.\n\n"
    "Secondo comma del testo di prova."
)


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


async def _massimario_stubs(graph) -> tuple[str, str]:
    article = to_canonical(parse_portal_urn(PORTAL_ARTICLE), {})
    act = to_canonical(parse_portal_urn(PORTAL_ACT), {})
    await graph.query(_MERGE_STUBS, {"rows": [{"k": u, "props": stub_properties(u)} for u in (article, act)]})
    await graph.query(_MERGE_DECISIONS, {"rows": [{"k": DECISION, "props": {"node_id": DECISION}}]})
    await graph.query(_MERGE_EDGES, {"rows": [{"s": DECISION, "t": article, "k": "k1", "props": {"volumi": [96]}}]})
    return article, act


async def _properties(graph, urn: str) -> list[dict]:
    rows = await graph.query("MATCH (n:Norma {URN: $u}) RETURN properties(n) AS p", {"u": urn})
    return [row["p"] for row in rows]


async def _lazy_ingest(graph, urn: str):
    params = _urn_to_ingest_params(urn)
    kg = LegalKnowledgeGraph()
    kg._connected = True
    kg._falkordb = graph
    kg._ingestion_pipeline = IngestionPipelineV2(falkordb_client=graph)
    kg._normattiva_scraper = SimpleNamespace(get_document=AsyncMock(return_value=(TEXT, urn + "!vig=")))
    with patch("merlt.core.legal_knowledge_graph.get_hierarchical_tree", new=AsyncMock(return_value=(None, 0))):
        return await kg.ingest_norm(
            params.tipo_atto,
            params.articolo,
            include_brocardi=False,
            include_embeddings=False,
            include_bridge=False,
            include_multivigenza=False,
            data=params.data,
            numero_atto=params.numero_atto,
            allegato=params.allegato,
        )


async def test_the_ingested_article_lands_on_the_massimario_stub(graph):
    article, act = await _massimario_stubs(graph)

    result = await _lazy_ingest(graph, article)

    assert result.fatal_error is None
    assert result.article_urn == article
    rows = await graph.query(
        "MATCH (n:Norma) WHERE n.URN CONTAINS 'legge:2012-12-31;247' "
        "RETURN n.URN AS urn, n.testo AS testo, n.is_stub AS is_stub, n.tipo_documento AS tipo",
        {},
    )
    by_urn = {row["urn"]: row for row in rows}
    assert sorted(by_urn) == sorted([act, article])  # one node each, no parallel twin
    assert by_urn[article]["testo"] == TEXT
    assert by_urn[article]["is_stub"] is None
    assert by_urn[article]["tipo"] == "articolo"
    # The decision's edge still reaches the article, now with its text and commi.
    reached = await graph.query(
        "MATCH (:AttoGiudiziario {node_id: $d})-[:INTERPRETA]->(n:Norma) "
        "OPTIONAL MATCH (n)-[:CONTIENE]->(c:Comma) RETURN n.URN AS urn, count(c) AS commi",
        {"d": DECISION},
    )
    assert [(row["urn"], row["commi"]) for row in reached] == [(article, 2)]
    contains = await graph.query(
        "MATCH (:Norma {URN: $act})-[:CONTIENE]->(n:Norma {URN: $art}) RETURN count(*) AS n",
        {"act": act, "art": article},
    )
    assert contains[0]["n"] == 1


async def test_an_ordinary_act_not_yet_in_the_graph_is_born_a_stub_never_a_code(graph):
    # 4 Oct 2026, live: the act node of l. 247/2012 was created with
    # tipo_documento 'codice', titolo 'Legge', autorita 'Parlamento'.
    article = to_canonical(parse_portal_urn(PORTAL_ARTICLE), {})
    act = to_canonical(parse_portal_urn(PORTAL_ACT), {})

    result = await _lazy_ingest(graph, article)

    assert result.fatal_error is None
    assert await _properties(graph, act) == [stub_properties(act)]
    contains = await graph.query(
        "MATCH (:Norma {URN: $act})-[:CONTIENE]->(:Norma {URN: $art}) RETURN count(*) AS n",
        {"act": act, "art": article},
    )
    assert contains[0]["n"] == 1


async def test_a_code_keeps_its_code_node(graph):
    result = await _lazy_ingest(graph, CODE_CC + "~art2043")

    assert result.fatal_error is None
    (code,) = await _properties(graph, CODE_CC)
    assert code["tipo_documento"] == "codice"
    assert code["titolo"] == "Codice Civile"
    assert "is_stub" not in code
