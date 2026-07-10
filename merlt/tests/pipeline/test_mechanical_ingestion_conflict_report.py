"""Unit tests for the mechanical-ingestion conflict report (design doc §5).

Run inside the MERL-T env:
    pip install -e ".[dev]" && pytest tests/pipeline/test_mechanical_ingestion_conflict_report.py
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.pipeline.mechanical_ingestion.conflict_report import build_conflict_report


def _fake_falkordb(rows_by_call):
    """A MagicMock whose `.query()` returns successive `rows_by_call` entries.

    `rows_by_call` is a list; each `build_conflict_report` call issues at
    most two `query()` invocations (batch URNs, then external edge
    endpoints) — tests provide exactly as many entries as expected.
    """
    client = MagicMock()
    client.query = AsyncMock(side_effect=rows_by_call)
    return client


def _node(urn: str, *, estremi: str, tipo_documento: str = "articolo") -> dict:
    """Article-level `estremi`/`tipo_documento` — matches the graph schema
    (`data/seeds/libro-iv-cc-graph.json`: every `Norma` node has
    `tipo_documento='articolo'`, `estremi` is a per-article string like
    `"Art. 1982 c.c."`, never the act-level value)."""
    return {
        "id": urn,
        "labels": ["Norma"],
        "properties": {
            "URN": urn,
            "node_id": urn,
            "estremi": estremi,
            "tipo_documento": tipo_documento,
        },
    }


@pytest.mark.asyncio
async def test_detects_urn_conflict_when_estremi_diverges():
    """The CC-frammentata-su-decreti-origine case from the design doc §1:
    the same article URN under the consolidated act (`1942;262:2`) reports
    different `estremi` than what a stray fragment-decree batch would carry."""
    urn = (
        "https://www.normattiva.it/uri-res/N2Ls?"
        "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1"
    )
    nodes = [_node(urn, estremi="Art. 1 c.c.")]

    falkordb = _fake_falkordb(
        [
            # batch URNs lookup
            [
                {
                    "urn": urn,
                    "estremi": "Art. 1 R.D. 25 giugno 1938, n. 1852",
                    "tipo_documento": "articolo",
                }
            ],
            # external edge endpoints (none)
            [],
        ]
    )

    report = await build_conflict_report(falkordb, nodes, edges=[])

    assert len(report["urn_conflicts"]) == 1
    assert report["urn_conflicts"][0]["urn"] == urn
    assert report["urn_conflicts"][0]["batch"]["estremi"] == "Art. 1 c.c."
    assert report["urn_conflicts"][0]["graph"]["estremi"] == "Art. 1 R.D. 25 giugno 1938, n. 1852"
    assert report["node_updates"] == [urn]
    assert report["node_new"] == []


@pytest.mark.asyncio
async def test_no_conflict_when_estremi_matches():
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art1"
    nodes = [_node(urn, estremi="Art. 1 Legge 20 maggio 1970, n. 300")]

    falkordb = _fake_falkordb(
        [
            [
                {
                    "urn": urn,
                    "estremi": "Art. 1 Legge 20 maggio 1970, n. 300",
                    "tipo_documento": "articolo",
                }
            ],
            [],
        ]
    )

    report = await build_conflict_report(falkordb, nodes, edges=[])

    assert report["urn_conflicts"] == []
    assert report["node_updates"] == [urn]


@pytest.mark.asyncio
async def test_node_new_when_urn_absent_from_graph():
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2000-01-01;1~art1"
    nodes = [_node(urn, estremi="Art. 1 Legge 1 gennaio 2000, n. 1")]

    falkordb = _fake_falkordb([[], []])  # graph has nothing for this URN

    report = await build_conflict_report(falkordb, nodes, edges=[])

    assert report["node_new"] == [urn]
    assert report["node_updates"] == []
    assert report["urn_conflicts"] == []


@pytest.mark.asyncio
async def test_orphan_edge_when_target_missing_everywhere():
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art1"
    missing_target = (
        "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art999"
    )
    nodes = [_node(urn, estremi="Art. 1 Legge 20 maggio 1970, n. 300")]
    edges = [{"start": urn, "end": missing_target, "type": "RINVIA", "properties": {}}]

    falkordb = _fake_falkordb(
        [
            [
                {
                    "urn": urn,
                    "estremi": "Art. 1 Legge 20 maggio 1970, n. 300",
                    "tipo_documento": "articolo",
                }
            ],
            [],  # missing_target not found in graph either
        ]
    )

    report = await build_conflict_report(falkordb, nodes, edges)

    assert len(report["orphan_edges"]) == 1
    assert report["orphan_edges"][0]["end"] == missing_target
    assert report["stats"]["edges_orphan"] == 1
    assert report["stats"]["edges_new"] == 0


@pytest.mark.asyncio
async def test_edge_not_orphan_when_external_target_exists_in_graph():
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art1"
    external_target = (
        "https://www.normattiva.it/uri-res/N2Ls?"
        "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
    )
    nodes = [_node(urn, estremi="Art. 1 Legge 20 maggio 1970, n. 300")]
    edges = [{"start": urn, "end": external_target, "type": "RINVIA", "properties": {}}]

    falkordb = _fake_falkordb(
        [
            [
                {
                    "urn": urn,
                    "estremi": "Art. 1 Legge 20 maggio 1970, n. 300",
                    "tipo_documento": "articolo",
                }
            ],
            # external endpoint IS already in the graph
            [
                {
                    "urn": external_target,
                    "estremi": "Art. 2043 c.c.",
                    "tipo_documento": "articolo",
                }
            ],
        ]
    )

    report = await build_conflict_report(falkordb, nodes, edges)

    assert report["orphan_edges"] == []
    assert report["stats"]["edges_orphan"] == 0
    assert report["stats"]["edges_new"] == 1


@pytest.mark.asyncio
async def test_detects_duplicate_urns_within_batch():
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art1"
    nodes = [
        _node(urn, estremi="Art. 1 Legge 20 maggio 1970, n. 300"),
        _node(urn, estremi="Art. 1 Legge 20 maggio 1970, n. 300"),
    ]

    falkordb = _fake_falkordb([[], []])

    report = await build_conflict_report(falkordb, nodes, edges=[])

    assert report["duplicates"] == [urn]
    assert report["stats"]["duplicates"] == 1


@pytest.mark.asyncio
async def test_coverage_computed_when_expected_count_given():
    nodes = [_node(f"urn:test~art{i}", estremi="Legge x") for i in range(1, 4)]
    falkordb = _fake_falkordb([[], []])

    report = await build_conflict_report(falkordb, nodes, edges=[], expected_count=6)

    assert report["coverage"] == {"expected": 6, "extracted": 3, "coverage_pct": 50.0}


@pytest.mark.asyncio
async def test_coverage_none_when_expected_count_not_given():
    falkordb = _fake_falkordb([[], []])
    report = await build_conflict_report(falkordb, [_node("u", estremi="x")], edges=[])
    assert report["coverage"] is None


@pytest.mark.asyncio
async def test_no_graph_query_when_batch_and_edges_are_empty():
    """Empty URN sets must not issue a Cypher `IN []` query."""
    falkordb = MagicMock()
    falkordb.query = AsyncMock(side_effect=AssertionError("must not query for an empty URN set"))

    report = await build_conflict_report(falkordb, [], edges=[])

    assert report == {
        "urn_conflicts": [],
        "node_updates": [],
        "node_new": [],
        "orphan_edges": [],
        "duplicates": [],
        "coverage": None,
        "stats": {
            "nodes_total": 0,
            "nodes_new": 0,
            "nodes_update": 0,
            "edges_total": 0,
            "edges_new": 0,
            "edges_orphan": 0,
            "duplicates": 0,
            "coverage_pct": None,
        },
    }
    falkordb.query.assert_not_called()


@pytest.mark.asyncio
async def test_batch_urn_with_vig_marker_matches_canonical_graph_urn():
    """Adversarial-review item #4b: URN normalization must strip the NIR
    `!vig=` version marker before the join, so a batch URN carrying it still
    matches the graph's marker-less canonical URN — otherwise a live node
    would be silently misreported as `node_new` instead of `node_updates`."""
    canonical = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art1"
    batch_urn = canonical + "!vig=2024-01-01"
    nodes = [_node(batch_urn, estremi="Art. 1 Legge 20 maggio 1970, n. 300")]

    falkordb = _fake_falkordb(
        [
            [
                {
                    "urn": canonical,
                    "estremi": "Art. 1 Legge 20 maggio 1970, n. 300",
                    "tipo_documento": "articolo",
                }
            ],
            [],
        ]
    )

    report = await build_conflict_report(falkordb, nodes, edges=[])

    assert report["node_updates"] == [canonical]
    assert report["node_new"] == []
    assert report["urn_conflicts"] == []
    # The graph must be queried with the canonicalized (marker-stripped) URN.
    queried_urns = falkordb.query.call_args_list[0].args[1]["urns"]
    assert queried_urns == [canonical]


@pytest.mark.asyncio
async def test_annex_marker_is_not_stripped_by_normalization():
    """Adversarial-review item #4b: `_canonical_urn` strips ONLY the `!vig=`
    marker, never the `:N` annex — an annex difference must still surface as
    a distinct URN rather than being silently collapsed into a false match
    (anti-regression: CLAUDE.md's "URN version-marker mismatch" gotcha)."""
    with_annex = (
        "https://www.normattiva.it/uri-res/N2Ls?"
        "urn:nir:stato:regio.decreto:1942-03-16;262:2~art1982"
    )
    nodes = [_node(with_annex, estremi="Art. 1982 c.c.")]

    falkordb = _fake_falkordb([[], []])  # graph has nothing under this exact (annexed) URN

    report = await build_conflict_report(falkordb, nodes, edges=[])

    assert report["node_new"] == [with_annex]
    queried_urns = falkordb.query.call_args_list[0].args[1]["urns"]
    assert queried_urns == [with_annex]
