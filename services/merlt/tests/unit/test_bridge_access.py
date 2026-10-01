"""The two request handlers that open the bridge table: POST /graph/search and the dataset statistics.

Both imported `get_db_url`, which `merlt.rlcf.database` does not define, so `POST /api/v1/graph/search`
always answered 500 and the dataset statistics always reported 0 bridge mappings. Past that import they
built `BridgeTable(db_url=...)`, where the class takes a config, and called `get_nodes_for_chunks` and
`count_mappings`, which it does not have. The class is mocked with an autospec here, so a call the real
class would refuse (a keyword it has not, a method it lacks) fails in these tests too.

No database and no graph: every store is a stand-in.
"""
import importlib
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from merlt.storage.bridge.bridge_table import BridgeTableConfig

ART = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
BRIDGE_CLASS = "merlt.storage.bridge.bridge_table.BridgeTable"


# The configuration ------------------------------------------------------------------------------------


def test_the_bridge_is_reached_where_the_deployment_puts_it(monkeypatch):
    for name, value in {
        "ENRICHMENT_DB_HOST": "postgres", "ENRICHMENT_DB_PORT": "5433", "ENRICHMENT_DB_NAME": "enrich",
        "ENRICHMENT_DB_USER": "u", "ENRICHMENT_DB_PASSWORD": "p",
    }.items():
        monkeypatch.setenv(name, value)
    config = BridgeTableConfig.from_enrichment_env()
    assert (config.host, config.port, config.database, config.user, config.password) == (
        "postgres", 5433, "enrich", "u", "p",
    )
    assert config.get_connection_string() == "postgresql+asyncpg://u:p@postgres:5433/enrich"


def test_without_the_environment_the_bridge_is_the_enrichment_database_on_localhost(monkeypatch):
    for name in ("ENRICHMENT_DB_HOST", "ENRICHMENT_DB_PORT", "ENRICHMENT_DB_NAME", "ENRICHMENT_DB_USER", "ENRICHMENT_DB_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    config = BridgeTableConfig.from_enrichment_env()
    assert (config.host, config.port, config.database) == ("localhost", 5432, "merlt")


# The dataset statistics -------------------------------------------------------------------------------


async def test_the_dataset_statistics_count_the_bridge_mappings():
    pipeline_router = importlib.import_module("merlt.api.pipeline_router")
    # the graph and the vector store are down in this test: each section of the statistics is optional
    with patch("merlt.storage.graph.client.FalkorDBClient", side_effect=RuntimeError("no graph")), \
            patch("qdrant_client.QdrantClient", side_effect=RuntimeError("no vector store")), \
            patch(BRIDGE_CLASS, autospec=True) as bridge_class:
        bridge = bridge_class.return_value
        bridge.count.return_value = 27114
        stats = await pipeline_router.get_dataset_stats()
    assert stats.bridge_mappings == 27114
    (config,), _ = bridge_class.call_args
    assert isinstance(config, BridgeTableConfig)
    bridge.connect.assert_awaited_once()
    bridge.close.assert_awaited_once()  # and the connection is closed when the count is read


async def test_the_bridge_is_closed_when_the_count_fails():
    pipeline_router = importlib.import_module("merlt.api.pipeline_router")
    with patch("merlt.storage.graph.client.FalkorDBClient", side_effect=RuntimeError("no graph")), \
            patch("qdrant_client.QdrantClient", side_effect=RuntimeError("no vector store")), \
            patch(BRIDGE_CLASS, autospec=True) as bridge_class:
        bridge = bridge_class.return_value
        bridge.count.side_effect = RuntimeError("the table is not there")
        stats = await pipeline_router.get_dataset_stats()
    assert stats.bridge_mappings == 0  # a section that fails reads as 0, the others still answer
    bridge.close.assert_awaited_once()


# POST /graph/search -----------------------------------------------------------------------------------


def _search_environment(chunk_ids, mappings, graph_rows):
    """The stand-ins of a search: the embedding service, Qdrant (answering `chunk_ids`), the bridge
    table (answering `mappings` for every chunk) and the graph (answering `graph_rows`)."""
    embeddings = SimpleNamespace(encode_query_async=AsyncMock(return_value=[0.1, 0.2]))
    qdrant = MagicMock()
    qdrant.search.return_value = [SimpleNamespace(id=chunk_id, score=0.9) for chunk_id in chunk_ids]
    graph = MagicMock()
    graph.connect = AsyncMock()
    graph.close = AsyncMock()
    graph.ro_query = AsyncMock(return_value=graph_rows)
    return embeddings, qdrant, graph, mappings


def _article_row():
    return {"n": {"properties": {"URN": ART, "nome": "Art. 2043"}, "labels": ["Norma"], "id": 7}, "rel_type": None, "connected": None}


async def _search(chunk_ids, mappings, graph_rows):
    graph_router = importlib.import_module("merlt.api.graph_router")
    embeddings, qdrant, graph, mappings = _search_environment(chunk_ids, mappings, graph_rows)
    with patch("merlt.storage.vectors.embeddings.EmbeddingService.get_instance", return_value=embeddings), \
            patch("qdrant_client.QdrantClient", return_value=qdrant), \
            patch("merlt.api.graph_router.FalkorDBClient", return_value=graph), \
            patch(BRIDGE_CLASS, autospec=True) as bridge_class:
        bridge = bridge_class.return_value
        bridge.get_nodes_for_chunk.return_value = mappings
        response = await graph_router.search_graph(graph_router.GraphSearchRequest(query="responsabilita"), api_key=None)
    return response, bridge_class, bridge, graph


def _mapping(confidence=0.8):
    return {"graph_node_urn": ART, "node_type": "Norma", "relation_type": "PRIMARY", "confidence": confidence, "metadata": None}


async def test_graph_search_maps_the_chunks_it_finds_to_graph_nodes_through_the_bridge_table():
    chunk = str(uuid.uuid4())
    response, bridge_class, bridge, graph = await _search([chunk], [_mapping(0.8)], [_article_row()])
    assert [node.urn for node in response.subgraph.nodes] == [ART]
    assert response.relevance_scores == {ART: pytest.approx(0.9 * 0.8)}  # similarity x the mapping's confidence
    (config,), _ = bridge_class.call_args
    assert isinstance(config, BridgeTableConfig)
    bridge.connect.assert_awaited_once()
    bridge.close.assert_awaited_once()
    assert [call.args[0] for call in bridge.get_nodes_for_chunk.await_args_list] == [uuid.UUID(chunk)]
    assert graph.ro_query.await_args.args[1]["urns"] == [ART]  # the graph is asked for the nodes the bridge named


async def test_a_mapping_without_a_confidence_counts_in_full():
    response, *_ = await _search([str(uuid.uuid4())], [_mapping(None)], [_article_row()])
    assert response.relevance_scores == {ART: pytest.approx(0.9)}


async def test_a_chunk_the_bridge_does_not_know_leaves_the_search_empty_and_the_graph_unasked():
    response, _, bridge, graph = await _search([str(uuid.uuid4())], [], [_article_row()])
    assert response.subgraph.nodes == [] and response.relevance_scores == {}
    graph.ro_query.assert_not_awaited()
    bridge.close.assert_awaited_once()


async def test_a_point_id_that_is_not_a_uuid_is_skipped_instead_of_failing_the_search():
    # The bridge table keys a chunk by a UUID: a legacy integer point id has no mapping there, and
    # asking for it would fail the query for every chunk of the same search.
    response, _, bridge, _ = await _search([123456789, str(uuid.uuid4())], [_mapping(1.0)], [_article_row()])
    assert bridge.get_nodes_for_chunk.await_count == 1
    assert list(response.relevance_scores) == [ART]
