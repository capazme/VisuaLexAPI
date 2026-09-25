"""Provenance lookup for the Q&A sources: provisional nodes are found by
``source_url`` and an exact URN / node_id hit always wins over a URL hit.

Before: only ``n.URN = u OR n.node_id = u`` matched, but a provisional node's
URN is its ``live:<hash>`` node_id while the served id is the article URL, so
no provisional node was ever labelled and "ricorda nel grafo" had no target.
"""

from __future__ import annotations

import asyncio
import importlib

# `merlt.api` re-exports the APIRouter under the module's name, so reach the
# real module object via importlib (same trap as tests/api/test_graph_ingest.py).
er = importlib.import_module("merlt.api.experts_router")


class _FakeClient:
    def __init__(self, rows):
        self.rows = rows
        self.queries = []

    async def query(self, cypher, params=None):
        self.queries.append((cypher, params))
        return self.rows


def _run(rows, urns):
    async def _go():
        async def fake_client():
            return _FakeClient(rows)

        original = er._get_provenance_graph_client
        er._get_provenance_graph_client = fake_client
        try:
            return await er._lookup_provenance_batch(urns)
        finally:
            er._get_provenance_graph_client = original

    return asyncio.run(_go())


def test_live_source_matched_by_source_url_beats_a_norma_matched_by_url():
    url = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2001;231~art5"
    rows = [
        {"urn": url, "provenance": "seed", "trust": 1.0, "node_id": "n1", "source_url": url, "exact": False, "labels": ["Norma"]},
        {"urn": url, "provenance": "live_unconfirmed", "trust": 0.6, "node_id": "live:abc", "source_url": url, "exact": False, "labels": ["LiveSource"]},
    ]
    out = _run(rows, [url])
    assert out[url]["node_id"] == "live:abc"
    assert out[url]["provenance"] == "live_unconfirmed"


def test_exact_urn_hit_beats_a_live_source_url_hit_whatever_the_row_order():
    u = "urn:nir:stato:codice.civile:1942~art2043"
    rows = [
        {"urn": u, "provenance": "live_unconfirmed", "trust": 0.6, "node_id": "live:z", "source_url": u, "exact": False, "labels": ["LiveSource"]},
        {"urn": u, "provenance": "seed", "trust": 1.0, "node_id": u, "source_url": None, "exact": True, "labels": ["Norma"]},
    ]
    out = _run(rows, [u])
    assert out[u]["node_id"] == u
    assert out[u]["provenance"] == "seed"


def test_query_matches_on_source_url_too():
    client_rows: list = []
    _run(client_rows, ["x"])  # no rows: nothing to assert on the output
    # the Cypher itself is what changed: it must include the third clause
    out = None

    async def _go():
        nonlocal out
        fc = _FakeClient([])

        async def fake_client():
            return fc

        original = er._get_provenance_graph_client
        er._get_provenance_graph_client = fake_client
        try:
            await er._lookup_provenance_batch(["x"])
        finally:
            er._get_provenance_graph_client = original
        out = fc.queries[0][0]

    asyncio.run(_go())
    assert "n.source_url = u" in out


def test_empty_input_short_circuits():
    assert _run([], []) == {}
