"""Regressions for the data-quality defects found by the Slice 3 / ingestion audit.

Pure python (fake graph clients), so they run everywhere.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.pipeline.mechanical_ingestion.conflict_report import build_conflict_report
from merlt.utils.sources import short_norm
from merlt.storage.retriever.retriever import GraphAwareRetriever
from merlt.utils.urn_labels import article_number_from_urn, derive_article_fields_from_urn


# ---------------------------------------------------------------------------
# urn_labels: the ordered alternation matched "ter" inside "terdecies"
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "segment, expected",
    [
        ("2409bis", "2409-bis"),
        ("2409ter", "2409-ter"),
        ("2409terdecies", "2409-terdecies"),
        ("2409quaterdecies", "2409-quaterdecies"),
        ("2409quinquiesdecies", "2409-quinquiesdecies"),
        ("2409sexiesdecies", "2409-sexiesdecies"),
        ("2409septiesdecies", "2409-septiesdecies"),
        ("2409octiesdecies", "2409-octiesdecies"),
        ("2409noviesdecies", "2409-noviesdecies"),
        ("600ter", "600-ter"),
    ],
)
def test_compound_suffixes_are_read_whole(segment, expected):
    urn = f"https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262~art{segment}"
    assert article_number_from_urn(urn) == expected
    # The key has no annex, so it names the decree, not the codice civile.
    assert derive_article_fields_from_urn(urn) == (expected, f"art. {expected} r.d. 262/1942")


def test_comma_and_version_markers_still_ignored():
    assert article_number_from_urn("urn:x~art1980-com3") == "1980"
    assert article_number_from_urn("urn:x~art2043!vig=2024-01-15") == "2043"
    assert article_number_from_urn("urn:x~art2043bis!vig=") == "2043-bis"


def test_unknown_alphabetic_tail_is_not_a_suffix_and_digits_do_not_backtrack():
    # "xyz" is no ordinal: the number is read without it, never as "240".
    assert article_number_from_urn("urn:x~art2409xyz") == "2409"


# ---------------------------------------------------------------------------
# labels: a code enacted by a decree is cited by its decree, never an initialism
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "act_type, expected",
    [
        ("codice civile", "art. 1 c.c."),
        ("Codice Civile", "art. 1 c.c."),
        ("codice penale", "art. 1 c.p."),
        ("codice di procedura civile", "art. 1 c.p.c."),
        ("codice di procedura penale", "art. 1 c.p.p."),
        # D3 (owner, 4 Oct 2026): by the decree, not "cod. cons." / "cod. privacy"
        ("codice del consumo", "art. 1 d.lgs. 206/2005"),
        ("Codice Del Consumo", "art. 1 d.lgs. 206/2005"),
        ("codice in materia di protezione dei dati personali", "art. 1 d.lgs. 196/2003"),
    ],
)
def test_short_label_of_the_codes(act_type, expected):
    assert short_norm({"tipo_atto": act_type, "numero_articolo": "1"}) == expected


def test_unknown_act_keeps_its_name_instead_of_an_initialism():
    assert short_norm({"tipo_atto": "legge sulla privacy", "numero_articolo": "3"}) == "art. 3 legge sulla privacy"


# ---------------------------------------------------------------------------
# conflict report: a URN-derived stub estremi is an enrichment, not a conflict
# ---------------------------------------------------------------------------

def _fake_falkordb(rows_by_call):
    client = MagicMock()
    client.query = AsyncMock(side_effect=rows_by_call)
    return client


def _node(urn: str, estremi: str) -> dict:
    return {
        "id": urn,
        "labels": ["Norma"],
        "properties": {"URN": urn, "node_id": urn, "estremi": estremi, "tipo_documento": "articolo"},
    }


def test_a_different_wording_of_the_estremi_is_an_update_not_a_conflict():
    # `estremi` is a label derived from the key (source convention): the graph's
    # "Art. 2043" or "Art. 2043 c.c." and the batch's "art. 2043 c.c." are one article.
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
    for live in ("Art. 2043", "Art. 2043 c.c.", "Art. 1 R.D. 25 giugno 1938, n. 1852"):
        nodes = [_node(urn, "art. 2043 c.c.")]
        falkordb = _fake_falkordb([[{"urn": urn, "estremi": live, "tipo_documento": "articolo"}], []])

        report = asyncio.run(build_conflict_report(falkordb, nodes, edges=[]))

        assert report["urn_conflicts"] == [], live
        assert report["node_updates"] == [urn]


def test_a_different_type_of_document_is_still_a_conflict():
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1"
    nodes = [_node(urn, "art. 1 c.c.")]
    falkordb = _fake_falkordb([[{"urn": urn, "estremi": "art. 1 c.c.", "tipo_documento": "capo"}], []])

    report = asyncio.run(build_conflict_report(falkordb, nodes, edges=[]))

    assert len(report["urn_conflicts"]) == 1


# ---------------------------------------------------------------------------
# retriever: shortest_path length sits next to "path", not inside it
# ---------------------------------------------------------------------------

def _retriever(path_result):
    graph = MagicMock()
    graph.shortest_path = AsyncMock(return_value=path_result)
    return GraphAwareRetriever(vector_db=MagicMock(), graph_db=graph, bridge_table=MagicMock())


def test_path_length_is_read_from_the_client_shape():
    r = _retriever({"path": {"edges": ["cita", "modifica"]}, "length": 2})
    path = asyncio.run(r._find_shortest_path("a", "b", max_hops=3))
    assert path is not None
    assert path.length == 2
    assert path.edges == ["cita", "modifica"]


def test_one_hop_scores_above_two_hops_with_the_same_edges():
    one = asyncio.run(_retriever({"path": {"edges": ["cita"]}, "length": 1})._find_shortest_path("a", "b", 3))
    two = asyncio.run(
        _retriever({"path": {"edges": ["cita", "cita"]}, "length": 2})._find_shortest_path("a", "b", 3)
    )
    r = _retriever(None)
    s1 = asyncio.run(r._score_path(one, query_embedding=None))
    s2 = asyncio.run(r._score_path(two, query_embedding=None))
    assert s1 > s2


# ---------------------------------------------------------------------------
# FalkorDBClient.shortest_path: a reader, and a failure is said, never swallowed
# ---------------------------------------------------------------------------

def _path_client(ro_query):
    from merlt.storage.graph.client import FalkorDBClient

    client = FalkorDBClient.__new__(FalkorDBClient)  # no connection: the calls are replaced
    client.ro_query = ro_query
    client.query = AsyncMock(side_effect=AssertionError("shortest_path is a reader: it never calls query"))
    return client


def test_shortest_path_reads_with_ro_query():
    client = _path_client(AsyncMock(return_value=[{"rel_type": "RINVIA"}]))
    assert asyncio.run(client.shortest_path("a", "b")) == {"path": {"edges": ["RINVIA"]}, "length": 1}
    client.query.assert_not_awaited()


def test_shortest_path_logs_a_failure_with_its_type_and_message():
    # A node that is not found gives no rows, not an exception: any exception is a real failure.
    from structlog.testing import capture_logs

    client = _path_client(AsyncMock(side_effect=ConnectionError("graph unreachable")))
    with capture_logs() as logs:
        assert asyncio.run(client.shortest_path("a", "b")) is None
    warnings = [entry for entry in logs if entry["log_level"] == "warning"]
    assert len(warnings) == 1
    assert warnings[0]["error_type"] == "ConnectionError" and warnings[0]["error"] == "graph unreachable"


def test_a_real_path_is_never_a_self_loop():
    r = _retriever({"path": {"edges": ["cita"]}})  # no length anywhere
    path = asyncio.run(r._find_shortest_path("a", "b", 3))
    assert path is not None and path.length == 1
