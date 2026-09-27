"""Unit tests for mechanical-ingestion promotion gating + merge (design doc §5-6).

Run inside the MERL-T env:
    pip install -e ".[dev]" && pytest tests/pipeline/test_mechanical_ingestion_promote.py
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.pipeline.mechanical_ingestion.promote import (
    PromotionBlockedError,
    _sanitize_batch_nodes,
    promote_batch,
)

_URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art1"
_URN2 = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art2"
_EXTERNAL = (
    "https://www.normattiva.it/uri-res/N2Ls?" "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
)


def _fake_falkordb(rows_by_call):
    client = MagicMock()
    client.query = AsyncMock(side_effect=rows_by_call)
    return client


def _node(urn: str, *, estremi: str = "Art. 1 Legge 20 maggio 1970, n. 300") -> dict:
    return {
        "id": urn,
        "labels": ["Norma"],
        "properties": {
            "URN": urn,
            "node_id": urn,
            "estremi": estremi,
            "tipo_documento": "articolo",
        },
    }


@pytest.mark.asyncio
async def test_refuses_promotion_on_urn_conflict_without_force():
    nodes = [_node(_URN)]
    falkordb = _fake_falkordb(
        [
            # batch URN lookup: graph has a DIFFERENT estremi -> conflict
            [
                {
                    "urn": _URN,
                    "estremi": "Art. 1 R.D. 25 giugno 1938, n. 1852",
                    "tipo_documento": "articolo",
                }
            ],
        ]
    )

    with pytest.raises(PromotionBlockedError) as exc_info:
        await promote_batch(falkordb, nodes, edges=[], force=False)

    assert len(exc_info.value.conflict_report["urn_conflicts"]) == 1
    # No merge Cypher must have been issued past the conflict-report check.
    assert falkordb.query.await_count == 1


@pytest.mark.asyncio
async def test_force_true_bypasses_urn_conflict_and_merges():
    nodes = [_node(_URN)]
    falkordb = _fake_falkordb(
        [
            [
                {
                    "urn": _URN,
                    "estremi": "Art. 1 R.D. 25 giugno 1938, n. 1852",
                    "tipo_documento": "articolo",
                }
            ],  # conflict
            [],  # _merge_nodes MERGE query response (unused)
        ]
    )

    result = await promote_batch(falkordb, nodes, edges=[], force=True)

    assert result["nodes_merged"] == 1
    assert result["edges_merged"] == 0
    assert result["conflict_report"]["urn_conflicts"]


@pytest.mark.asyncio
async def test_promotes_cleanly_with_no_conflicts_and_no_edges():
    nodes = [_node(_URN)]
    falkordb = _fake_falkordb(
        [
            [],  # batch URN lookup: not in graph -> node_new, no conflict
            [],  # _merge_nodes response
        ]
    )

    result = await promote_batch(falkordb, nodes, edges=[], force=False)

    assert result["nodes_merged"] == 1
    assert result["edges_merged"] == 0
    assert result["edges_skipped"] == 0
    assert result["conflict_report"]["urn_conflicts"] == []


@pytest.mark.asyncio
async def test_internal_edge_merges_between_batch_nodes():
    nodes = [_node(_URN), _node(_URN2)]
    edges = [{"start": _URN, "end": _URN2, "type": "RINVIA", "properties": {}}]
    falkordb = _fake_falkordb(
        [
            [],  # batch URN lookup (both new)
            [],  # external edge-endpoint lookup during conflict report (none external)
            [],  # _merge_nodes call #1
            [],  # _merge_nodes call #2
            [],  # _merge_edges call #1
        ]
    )

    result = await promote_batch(falkordb, nodes, edges, force=False)

    assert result["nodes_merged"] == 2
    assert result["edges_merged"] == 1
    assert result["edges_skipped"] == 0


@pytest.mark.asyncio
async def test_external_edge_resolves_when_target_already_in_graph():
    """Design §5: an edge to a URN outside the batch is NOT orphan if the
    graph already has that node — it must still be merged (via a read-only
    id_to_key augmentation, no stub node creation)."""
    nodes = [_node(_URN)]
    edges = [{"start": _URN, "end": _EXTERNAL, "type": "RINVIA", "properties": {}}]
    falkordb = _fake_falkordb(
        [
            [],  # batch URN lookup (new)
            [
                {
                    "urn": _EXTERNAL,
                    "estremi": "Art. 2043 c.c.",
                    "tipo_documento": "articolo",
                }
            ],  # conflict-report external lookup: exists
            [
                {
                    "urn": _EXTERNAL,
                    "estremi": "Art. 2043 c.c.",
                    "tipo_documento": "articolo",
                }
            ],  # promote's own external-resolution lookup
            [],  # _merge_nodes call
            [],  # _merge_edges call (resolves, MATCHes existing external node)
        ]
    )

    result = await promote_batch(falkordb, nodes, edges, force=False)

    assert result["nodes_merged"] == 1
    assert result["edges_merged"] == 1
    assert result["edges_skipped"] == 0


@pytest.mark.asyncio
async def test_edge_skipped_when_target_missing_everywhere():
    missing = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1970-05-20;300~art999"
    nodes = [_node(_URN)]
    edges = [{"start": _URN, "end": missing, "type": "RINVIA", "properties": {}}]
    falkordb = _fake_falkordb(
        [
            [],  # batch URN lookup
            [],  # conflict-report external lookup: missing target not found
            [],  # promote's own external-resolution lookup: still not found
            [],  # _merge_nodes call
            # no _merge_edges call: id_to_key has no entry for `missing` -> skipped
        ]
    )

    result = await promote_batch(falkordb, nodes, edges, force=False)

    assert result["nodes_merged"] == 1
    assert result["edges_merged"] == 0
    assert result["edges_skipped"] == 1


def test_sanitize_batch_nodes_strips_none_valued_properties():
    """Adversarial-review item #3: `_merge_nodes` runs `SET x += $props`, and
    Cypher's `+=` treats a `null` property value as "remove this property".
    A sparse batch node (e.g. `rubrica` never populated) must not NULL OUT an
    already-populated live property."""
    nodes = [
        {
            "id": _URN,
            "labels": ["Norma"],
            "properties": {"URN": _URN, "rubrica": None, "testo_vigente": "testo", "titolo": None},
        }
    ]

    sanitized = _sanitize_batch_nodes(nodes)

    assert sanitized[0]["properties"] == {"URN": _URN, "testo_vigente": "testo"}
    assert "rubrica" not in sanitized[0]["properties"]
    assert "titolo" not in sanitized[0]["properties"]
    # The original batch list (as staged on `MerltIngestionBatch.nodes`) must
    # be untouched — sanitization only applies to the copy sent to the merge.
    assert nodes[0]["properties"]["rubrica"] is None


@pytest.mark.asyncio
async def test_promote_batch_never_sends_none_valued_properties_to_merge():
    """End-to-end: a batch node with a `None` property must reach
    `_merge_nodes`'s Cypher `SET x += $props` without that key at all."""
    nodes = [
        {
            "id": _URN,
            "labels": ["Norma"],
            "properties": {
                "URN": _URN,
                "node_id": _URN,
                "estremi": "Art. 1 Legge 20 maggio 1970, n. 300",
                "tipo_documento": "articolo",
                "rubrica": None,
            },
        }
    ]
    falkordb = _fake_falkordb(
        [
            [],  # batch URN lookup: not in graph
            [],  # _merge_nodes MERGE query
        ]
    )

    await promote_batch(falkordb, nodes, edges=[], force=False)

    merge_call = falkordb.query.call_args_list[-1]
    sent_props = merge_call.args[1]["props"]
    assert "rubrica" not in sent_props
    assert sent_props["estremi"] == "Art. 1 Legge 20 maggio 1970, n. 300"
