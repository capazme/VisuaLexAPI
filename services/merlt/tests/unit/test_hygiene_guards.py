"""Graph hygiene never deletes a provisional node a user vouched for.

``confirm-source`` stamps ``confirmed_by`` and ``pending_entity_id`` on the
LiveSource node (provenance stays ``live_unconfirmed``) but bumps neither
``positive_feedback_count`` nor ``usage_count``, so the sweep read it as pure
noise: ``reconcile_duplicates`` deleted it on sight when a confirmed twin
existed, and ``prune_faded`` deleted it once old, stale and decayed. The
approved entity then found no node to link back to
(``entity_writer._link_provisional_source`` matches on ``pending_entity_id``).

FalkorDB is a recorder: these tests pin the Cypher each phase sends and the
phase isolation of the sweep. The live behaviour is covered by the
``integration`` suite.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from merlt.pipeline import hygiene


class _RecordingGraph:
    def __init__(self, answers=None):
        self.calls: list[tuple[str, dict]] = []
        self._answers = list(answers or [])

    async def query(self, cypher, params=None):
        self.calls.append((cypher, params or {}))
        return self._answers.pop(0) if self._answers else []


def _norm(text: str) -> str:
    return " ".join(text.split())


VOUCHED_GUARDS = (
    "size(coalesce(n.confirmed_by, [])) > 0",
    "coalesce(n.pending_entity_id, '') <> ''",
)


def test_human_signal_predicate_counts_vouching():
    for guard in VOUCHED_GUARDS:
        assert guard in hygiene.HUMAN_SIGNAL_PREDICATE
    assert "positive_feedback_count" in hygiene.HUMAN_SIGNAL_PREDICATE
    assert "usage_count" in hygiene.HUMAN_SIGNAL_PREDICATE
    assert hygiene.NO_HUMAN_SIGNAL_PREDICATE == f"NOT {hygiene.HUMAN_SIGNAL_PREDICATE}"


async def test_prune_only_deletes_nodes_without_human_signal():
    graph = _RecordingGraph([[{"ids": ["live:noise"]}], []])

    ids = await hygiene.prune_faded(
        graph, ttl_cutoff_iso="2026-01-01", decay_cutoff_iso="2026-02-01", min_trust=0.3
    )

    assert ids == ["live:noise"]
    select_cypher, params = graph.calls[0]
    assert hygiene.NO_HUMAN_SIGNAL_PREDICATE in _norm(select_cypher)
    assert "n.provenance = $prov" in select_cypher
    assert params["prov"] == "live_unconfirmed"
    delete_cypher, delete_params = graph.calls[1]
    assert "DETACH DELETE" in delete_cypher and delete_params == {"ids": ["live:noise"]}


async def test_prune_sends_no_delete_when_nothing_matches():
    graph = _RecordingGraph([[{"ids": []}]])
    assert await hygiene.prune_faded(
        graph, ttl_cutoff_iso="2026-01-01", decay_cutoff_iso="2026-02-01", min_trust=0.3
    ) == []
    assert len(graph.calls) == 1


async def test_quarantine_routes_vouched_nodes_to_human_review():
    graph = _RecordingGraph([[{"flagged": 2}]])

    flagged = await hygiene.quarantine_doubtful(
        graph, ttl_cutoff_iso="2026-01-01", decay_cutoff_iso="2026-02-01",
        min_trust=0.3, timestamp="2026-03-01T00:00:00+00:00",
    )

    assert flagged == 2
    cypher, params = graph.calls[0]
    assert hygiene.HUMAN_SIGNAL_PREDICATE in _norm(cypher)
    assert "SET n.review_status = 'pending_review'" in cypher
    assert "coalesce(n.review_status, '') <> 'pending_review'" in cypher
    assert params["timestamp"] == "2026-03-01T00:00:00+00:00"


async def test_reconcile_spares_a_vouched_twin():
    graph = _RecordingGraph([[{"ids": ["live:twin"]}], []])

    ids = await hygiene.reconcile_duplicates(graph)

    assert ids == ["live:twin"]
    cypher = _norm(graph.calls[0][0])
    assert "size(coalesce(live.confirmed_by, [])) = 0" in cypher
    assert "coalesce(live.pending_entity_id, '') = ''" in cypher
    assert "NOT c:LiveSource" in cypher


async def test_decay_skips_nodes_under_review_and_a_factor_of_one():
    graph = _RecordingGraph([[{"decayed": 3}]])
    assert await hygiene.decay_stale(graph, decay_cutoff_iso="2026-01-01", factor=1.0) == 0
    assert graph.calls == []
    assert await hygiene.decay_stale(graph, decay_cutoff_iso="2026-01-01", factor=0.9) == 3
    assert "coalesce(n.review_status, '') <> 'pending_review'" in graph.calls[0][0]


async def test_sweep_isolates_a_failing_phase(monkeypatch):
    """Quarantine runs BEFORE prune, and one phase blowing up leaves the others."""
    order: list[str] = []
    monkeypatch.setattr(hygiene, "get_runtime_config", lambda: SimpleNamespace(
        get_int=lambda key, fallback: fallback, get_float=lambda key, fallback: fallback,
    ))
    pw = __import__("merlt.pipeline.provisional_writer", fromlist=["x"])
    monkeypatch.setattr(pw, "_get_graph_client", AsyncMock(return_value=object()))
    dropped: list[str] = []
    monkeypatch.setattr(pw, "delete_provisional_chunk", AsyncMock(side_effect=lambda nid: dropped.append(nid)))

    async def reconcile(gc):
        order.append("reconcile")
        return ["live:dup"]

    async def decay(gc, **kw):
        order.append("decay")
        raise RuntimeError("falkordb hiccup")

    async def quarantine(gc, **kw):
        order.append("quarantine")
        return 1

    async def prune(gc, **kw):
        order.append("prune")
        return ["live:noise"]

    monkeypatch.setattr(hygiene, "reconcile_duplicates", reconcile)
    monkeypatch.setattr(hygiene, "decay_stale", decay)
    monkeypatch.setattr(hygiene, "quarantine_doubtful", quarantine)
    monkeypatch.setattr(hygiene, "prune_faded", prune)

    stats = await hygiene.run_graph_hygiene()

    assert order == ["reconcile", "decay", "quarantine", "prune"]
    assert stats == {"reconciled": 1, "decayed": 0, "quarantined": 1, "pruned": 1}
    assert dropped == ["live:dup", "live:noise"]
