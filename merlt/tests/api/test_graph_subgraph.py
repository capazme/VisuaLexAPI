"""Unit tests for GET /api/v1/graph/subgraph and /entities/search (Wave 1, cluster D).

Covers the P1 contract fixes:
- defect #8  — real edge properties serialized (scalars only, hop_level merged)
- defect #9  — ranked deterministic truncation: filters compiled into Cypher,
               ORDER BY hop/certezza before LIMIT, `truncated` flag, node degree
- defect #3a — /entities/search spans all label-bearing node types, Norma first

Handlers are invoked directly with FalkorDBClient mocked (same style as
test_graph_ingest.py) — no live graph needed.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from merlt.api.graph_router import (
    _build_label_search_cypher,
    _edge_properties,
    _SEARCH_LABEL_SPECS,
    get_subgraph,
    search_entities,
)

ROOT_URN = "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


def _node(internal_id: int, label: str, **props) -> dict:
    return {"properties": props, "labels": [label], "id": internal_id}


def _root_row(degree: int = 5) -> dict:
    return {
        "root": _node(1, "Norma", URN=ROOT_URN, estremi="Art. 2043"),
        "degree": degree,
    }


def _edge_row(
    internal_id: int,
    rel_type: str = "DISCIPLINA",
    hop: int = 1,
    rel_props: dict | None = None,
    node_degree: int = 3,
    source_id: int = 1,
) -> dict:
    return {
        "rel_type": rel_type,
        "rel_props": rel_props or {},
        "connected": _node(internal_id, "ConcettoGiuridico", node_id=f"concetto:{internal_id}", nome=f"C{internal_id}"),
        "hop_level": hop,
        "source_id": source_id,
        "target_id": internal_id,
        "node_degree": node_degree,
    }


def _fake_graph_client(query_results: list) -> MagicMock:
    """FalkorDBClient mock: query() pops results in call order."""
    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.query = AsyncMock(side_effect=query_results)
    return client


# ====================================================
# _edge_properties (defect #8)
# ====================================================


def test_edge_properties_keeps_scalars_and_drops_collections():
    props = _edge_properties(
        {
            "certezza": 0.9,
            "fonte": "brocardi",
            "tipo_interpretazione": "estensiva",
            "attested": True,
            "embedding": [0.1, 0.2],
            "nested": {"a": 1},
            "nothing": None,
            "_seed_key": "cc862de5",  # internal plumbing, must not leak
        },
        hop_level=1,
    )
    assert props == {
        "certezza": 0.9,
        "fonte": "brocardi",
        "tipo_interpretazione": "estensiva",
        "attested": True,
    }


def test_edge_properties_merges_hop_level_for_multi_hop():
    props = _edge_properties({"certezza": 0.4}, hop_level=2)
    assert props == {"certezza": 0.4, "hop_level": 2}


def test_edge_properties_handles_null_props():
    assert _edge_properties(None, hop_level=1) == {}
    assert _edge_properties(None, hop_level=3) == {"hop_level": 3}


# ====================================================
# GET /subgraph (defects #8 + #9)
# ====================================================


@pytest.mark.asyncio
async def test_subgraph_serializes_real_edge_properties():
    rel_props = {"certezza": 0.85, "fonte": "seed", "embedding": [1.0, 2.0]}
    client = _fake_graph_client([
        [_root_row()],
        [_edge_row(2, rel_props=rel_props, hop=1)],
    ])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        response = await get_subgraph(root_urn=ROOT_URN, depth=1, api_key=None)

    assert len(response.edges) == 1
    edge = response.edges[0]
    assert edge.properties["certezza"] == 0.85
    assert edge.properties["fonte"] == "seed"
    assert "embedding" not in edge.properties
    assert "hop_level" not in edge.properties  # hop 1 stays implicit


@pytest.mark.asyncio
async def test_subgraph_merges_hop_level_into_edge_properties():
    client = _fake_graph_client([
        [_root_row()],
        [
            _edge_row(2, hop=1, rel_props={"certezza": 0.9}),
            _edge_row(3, hop=2, rel_props={"certezza": 0.7}, source_id=2),
        ],
    ])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        response = await get_subgraph(root_urn=ROOT_URN, depth=2, api_key=None)

    hop2_edges = [e for e in response.edges if e.properties.get("hop_level") == 2]
    assert len(hop2_edges) == 1
    assert hop2_edges[0].properties["certezza"] == 0.7
    assert response.metadata.depth_reached == 2


@pytest.mark.asyncio
async def test_subgraph_filters_compiled_into_cypher():
    client = _fake_graph_client([[_root_row()], []])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await get_subgraph(
            root_urn=ROOT_URN,
            depth=2,
            relation_types="disciplina, esprime_principio",
            entity_types="ConcettoGiuridico",
            api_key=None,
        )

    edge_call = client.query.await_args_list[1]
    cypher, params = edge_call.args
    # Case-insensitive on both sides: the graph mixes "commenta" and "DISCIPLINA"
    assert "toLower(type(r)) IN $allowed_rels" in cypher
    assert "toLower(labels(connected)[0]) IN $allowed_types" in cypher
    assert "toLower(labels(connected)[0]) = 'norma'" in cypher  # Norma carve-out
    assert params["allowed_rels"] == ["disciplina", "esprime_principio"]
    assert params["allowed_types"] == ["concettogiuridico"]
    # Ranked deterministic truncation: ORDER BY must precede LIMIT
    assert "ORDER BY hop ASC, COALESCE(r.certezza, 0.5) DESC" in cypher
    assert cypher.index("ORDER BY") < cypher.index("LIMIT $max_nodes")


@pytest.mark.asyncio
async def test_subgraph_truncated_flag_set_when_limit_hit():
    max_nodes = 3
    client = _fake_graph_client([
        [_root_row()],
        [_edge_row(i) for i in range(2, 2 + max_nodes)],
    ])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        response = await get_subgraph(
            root_urn=ROOT_URN, depth=1, max_nodes=max_nodes, api_key=None
        )

    assert response.metadata.truncated is True


@pytest.mark.asyncio
async def test_subgraph_truncated_flag_false_below_limit():
    client = _fake_graph_client([[_root_row()], [_edge_row(2)]])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        response = await get_subgraph(root_urn=ROOT_URN, depth=1, max_nodes=50, api_key=None)

    assert response.metadata.truncated is False


@pytest.mark.asyncio
async def test_subgraph_node_degree_in_metadata():
    client = _fake_graph_client([
        [_root_row(degree=42)],
        [_edge_row(2, node_degree=7)],
    ])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        response = await get_subgraph(root_urn=ROOT_URN, depth=1, api_key=None)

    root = next(n for n in response.nodes if n.id == ROOT_URN)
    neighbor = next(n for n in response.nodes if n.id != ROOT_URN)
    assert root.metadata["degree"] == 42
    assert neighbor.metadata["degree"] == 7


@pytest.mark.asyncio
async def test_subgraph_root_survives_filters_with_zero_edge_rows():
    # Filters that exclude every edge must NOT drop the root: empty `nodes`
    # is the FE's "not indexed" signal and would trigger a bogus lazy ingest.
    client = _fake_graph_client([[_root_row()], []])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        response = await get_subgraph(
            root_urn=ROOT_URN, depth=2, relation_types="INESISTENTE", api_key=None
        )

    assert len(response.nodes) == 1
    assert response.nodes[0].id == ROOT_URN
    assert response.edges == []


@pytest.mark.asyncio
async def test_subgraph_missing_root_returns_empty():
    client = _fake_graph_client([[]])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        response = await get_subgraph(root_urn="urn:nir:unknown~art1", depth=2, api_key=None)

    assert response.nodes == []
    assert response.edges == []
    assert response.metadata.truncated is False
    # only the root lookup ran — no edge query for a missing root
    assert client.query.await_count == 1


# ====================================================
# /entities/search (defect #3a)
# ====================================================


def test_search_label_specs_cover_the_main_node_types():
    labels = [spec["label"] for spec in _SEARCH_LABEL_SPECS]
    assert labels[0] == "Norma"  # rank 0 comes first
    for expected in ("Norma", "ConcettoGiuridico", "PrincipioGiuridico", "AttoGiudiziario", "Entity"):
        assert expected in labels


def test_build_label_search_cypher_norma():
    spec = _SEARCH_LABEL_SPECS[0]
    cypher = _build_label_search_cypher(spec, with_article_filter=False)
    assert "MATCH (n:Norma)" in cypher
    assert "toLower(n.estremi) CONTAINS toLower($q)" in cypher
    assert "toLower(n.rubrica) CONTAINS toLower($q)" in cypher
    assert "COALESCE(n.URN, n.node_id) as id" in cypher
    assert "LIMIT $limit" in cypher


def test_build_label_search_cypher_article_filter():
    spec = _SEARCH_LABEL_SPECS[0]
    cypher = _build_label_search_cypher(spec, with_article_filter=True)
    assert "n.URN CONTAINS $article_pattern" in cypher


@pytest.mark.asyncio
async def test_search_entities_spans_labels_and_ranks_norma_first():
    def query_side_effect(cypher: str, params: dict):
        if "MATCH (n:Norma)" in cypher:
            return [{
                "id": ROOT_URN,
                "nome": "Art. 2043",
                "tipo": "Norma",
                "article_urn": ROOT_URN,
                "approval_score": 0.0,
                "validation_status": "approved",
            }]
        if "MATCH (n:ConcettoGiuridico)" in cypher:
            return [{
                "id": "concetto:abc",
                "nome": "Responsabilità extracontrattuale",
                "tipo": "ConcettoGiuridico",
                "article_urn": None,
                "approval_score": 2.5,
                "validation_status": "approved",
            }]
        return []

    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.query = AsyncMock(side_effect=query_side_effect)

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        results = await search_entities(
            q="responsabilità",
            include_pending=False,
            session=None,
            api_key=None,
        )

    assert len(results) == 2
    # Norma ranks first despite the concept's higher approval_score
    assert results[0]["tipo"] == "Norma"
    assert results[0]["type"] == "norma"
    assert results[0]["urn"] == ROOT_URN
    assert results[1]["id"] == "concetto:abc"
    # internal ranking key never leaks into the payload
    assert all("_type_rank" not in r for r in results)
    # every configured label was queried
    assert client.query.await_count == len(_SEARCH_LABEL_SPECS)


@pytest.mark.asyncio
async def test_search_entities_exact_match_beats_type_rank():
    def query_side_effect(cypher: str, params: dict):
        if "MATCH (n:Norma)" in cypher:
            return [{
                "id": ROOT_URN,
                "nome": "Art. 2043 — buona fede richiamata",
                "tipo": "Norma",
                "article_urn": ROOT_URN,
                "approval_score": 0.0,
                "validation_status": "approved",
            }]
        if "MATCH (n:PrincipioGiuridico)" in cypher:
            return [{
                "id": "principio:bf",
                "nome": "Buona fede",
                "tipo": "PrincipioGiuridico",
                "article_urn": None,
                "approval_score": 1.0,
                "validation_status": "approved",
            }]
        return []

    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.query = AsyncMock(side_effect=query_side_effect)

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        results = await search_entities(
            q="buona fede",
            include_pending=False,
            session=None,
            api_key=None,
        )

    assert results[0]["id"] == "principio:bf"  # exact name match wins


@pytest.mark.asyncio
async def test_search_entities_article_filter_skips_unfilterable_labels():
    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.query = AsyncMock(return_value=[])

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await search_entities(
            q="buona fede",
            article_urn=ROOT_URN,
            include_pending=False,
            session=None,
            api_key=None,
        )

    queried = [call.args[0] for call in client.query.await_args_list]
    # Only labels with an article-bearing field run under the article filter
    filterable = [s for s in _SEARCH_LABEL_SPECS if s["article_filter_field"]]
    assert len(queried) == len(filterable)
    assert all("$article_pattern" in c for c in queried)


@pytest.mark.asyncio
async def test_search_entities_drops_rows_without_id_or_name():
    def query_side_effect(cypher: str, params: dict):
        if "MATCH (n:Norma)" in cypher:
            return [
                {"id": None, "nome": "senza id", "tipo": "Norma", "article_urn": None,
                 "approval_score": 0.0, "validation_status": "approved"},
                {"id": "urn:x~art1", "nome": None, "tipo": "Norma", "article_urn": None,
                 "approval_score": 0.0, "validation_status": "approved"},
            ]
        return []

    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.query = AsyncMock(side_effect=query_side_effect)

    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        results = await search_entities(
            q="senza",
            include_pending=False,
            session=None,
            api_key=None,
        )

    assert results == []
