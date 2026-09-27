"""Regressions for the data-quality defects found by the Slice 3 / ingestion audit.

Pure python (fake graph clients), so they run everywhere.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.pipeline.mechanical_ingestion.conflict_report import build_conflict_report
from merlt.pipeline.mechanical_ingestion.parser import _CODE_ABBREVIATIONS, _code_abbreviation
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
    assert derive_article_fields_from_urn(urn) == (expected, f"Art. {expected}")


def test_comma_and_version_markers_still_ignored():
    assert article_number_from_urn("urn:x~art1980-com3") == "1980"
    assert article_number_from_urn("urn:x~art2043!vig=2024-01-15") == "2043"
    assert article_number_from_urn("urn:x~art2043bis!vig=") == "2043-bis"


def test_unknown_alphabetic_tail_is_not_a_suffix_and_digits_do_not_backtrack():
    # "xyz" is no ordinal: the number is read without it, never as "240".
    assert article_number_from_urn("urn:x~art2409xyz") == "2409"


# ---------------------------------------------------------------------------
# mechanical parser: explicit code abbreviations
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "act_type, expected",
    [
        ("codice civile", "c.c."),
        ("Codice Civile", "c.c."),
        ("codice penale", "c.p."),
        ("codice di procedura civile", "c.p.c."),
        ("codice di procedura penale", "c.p.p."),
        ("codice del consumo", "cod. cons."),
        ("Codice Del Consumo", "cod. cons."),
        ("codice in materia di protezione dei dati personali", "cod. privacy"),
    ],
)
def test_code_abbreviation_table(act_type, expected):
    assert _code_abbreviation(act_type) == expected


def test_unknown_act_keeps_its_name_instead_of_an_initialism():
    assert _code_abbreviation("legge sulla privacy") == "legge sulla privacy"


def test_no_two_codes_share_an_abbreviation():
    by_abbrev: dict[str, set[str]] = {}
    for name, abbrev in _CODE_ABBREVIATIONS.items():
        by_abbrev.setdefault(abbrev, set()).add(name.replace("'", "à").replace("proprietà", "proprieta"))
    # The only duplicates allowed are spelling variants of the same act.
    for abbrev, names in by_abbrev.items():
        stems = {n.split()[0:4].__str__() for n in names}
        assert len(stems) <= 2, (abbrev, names)


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


def test_stub_estremi_from_a2_or_backfill_is_an_update_not_a_conflict():
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262~art2043"
    nodes = [_node(urn, "Art. 2043 c.c.")]
    falkordb = _fake_falkordb([[{"urn": urn, "estremi": "Art. 2043", "tipo_documento": None}], []])

    report = asyncio.run(build_conflict_report(falkordb, nodes, edges=[]))

    assert report["urn_conflicts"] == []
    assert report["node_updates"] == [urn]


def test_a_real_divergence_is_still_a_conflict():
    urn = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262~art1"
    nodes = [_node(urn, "Art. 1 c.c.")]
    falkordb = _fake_falkordb(
        [[{"urn": urn, "estremi": "Art. 1 R.D. 25 giugno 1938, n. 1852", "tipo_documento": "articolo"}], []]
    )

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


def test_a_real_path_is_never_a_self_loop():
    r = _retriever({"path": {"edges": ["cita"]}})  # no length anywhere
    path = asyncio.run(r._find_shortest_path("a", "b", 3))
    assert path is not None and path.length == 1
