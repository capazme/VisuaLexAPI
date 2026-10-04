# services/merlt/tests/pipeline/test_massimario_promote.py
from unittest.mock import AsyncMock, MagicMock

from merlt.pipeline.massimario import promote
from merlt.pipeline.massimario.promote import merge_decision_props, merge_edge_props, promote_massimario_graph

KEY = "cassazione:civile:1234:2024"
URN = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
NODES = [
    {"id": KEY, "labels": ["AttoGiudiziario"], "properties": {
        "node_id": KEY, "corte": "cassazione", "archivio": "civile", "numero": 1234, "anno": 2024,
        "sezioni": ["T"], "rv": ["670001-02"], "anni_rassegna": [2024], "relatore": "Bianchi",
        "fonte": "Ufficio del Massimario", "provenance": "ingestion", "data_udienza": None,
    }},
    {"id": URN, "labels": ["Norma"], "properties": {"URN": URN, "node_id": URN, "is_stub": True, "provenance": "ingestion"}},
]
EDGES = [{"start": KEY, "end": URN, "type": "INTERPRETA",
          "properties": {"tipo": "co-citazione", "confidenza": 0.5, "_mass_key": "k1", "paragrafi": 2,
                         "anni_rassegna": [2024], "volumi": [9001], "paragrafi_per_volume": ["9001:2"]}}]


def graph(existing_rows, existing_edges=()):
    return MagicMock(query=AsyncMock(side_effect=[existing_rows, list(existing_edges), [], [], []]))


async def test_first_promotion_writes_decisions_stubs_and_edges():
    g = graph([])
    stats = await promote_massimario_graph(g, NODES, EDGES)
    assert stats == {"nodes_merged": 2, "edges_merged": 1, "edges_skipped": 0}
    queries = [call.args[0] for call in g.query.await_args_list]
    assert queries == [promote._EXISTING, promote._EXISTING_EDGES,
                       promote._MERGE_DECISIONS, promote._MERGE_STUBS, promote._MERGE_EDGES]
    decision_props = g.query.await_args_list[2].args[1]["rows"][0]["props"]
    assert "data_udienza" not in decision_props  # None never reaches FalkorDB (it would delete the property)


async def test_second_promotion_unions_lists():
    existing = [{"k": KEY, "sezioni": ["5"], "rv": ["670001-01"], "anni_rassegna": [2023],
                 "relatore": "Rossi", "data_udienza": None, "fonte": "Brocardi.it", "provenance": "seed"}]
    g = graph(existing)
    await promote_massimario_graph(g, NODES, EDGES)
    props = g.query.await_args_list[2].args[1]["rows"][0]["props"]
    assert props["sezioni"] == ["5", "T"]
    assert props["rv"] == ["670001-01", "670001-02"]
    assert props["anni_rassegna"] == [2023, 2024]
    assert (props["relatore"], props["fonte"], props["provenance"]) == ("Rossi", "Brocardi.it", "seed")


def test_stubs_are_created_only_if_missing():
    assert "ON CREATE SET" in promote._MERGE_STUBS
    assert promote._MERGE_STUBS.count("SET") == 1


def test_merge_without_existing_is_the_new_props_without_nulls():
    assert merge_decision_props(None, {"a": 1, "b": None}) == {"a": 1}


async def test_an_edge_seen_in_another_volume_is_merged_not_doubled():
    existing_edge = {"k": "k1", "anni_rassegna": [2023], "volumi": [8001], "paragrafi_per_volume": ["8001:3"]}
    g = graph([], [existing_edge])
    await promote_massimario_graph(g, NODES, EDGES)
    (row,) = g.query.await_args_list[4].args[1]["rows"]
    assert row["k"] == "k1"
    props = row["props"]
    assert props["anni_rassegna"] == [2023, 2024] and props["volumi"] == [8001, 9001]
    assert props["paragrafi_per_volume"] == ["8001:3", "9001:2"] and props["paragrafi"] == 5


def test_rerunning_a_volume_rewrites_its_share():
    existing = {"anni_rassegna": [2024], "volumi": [9001], "paragrafi_per_volume": ["9001:7"]}
    props = merge_edge_props(existing, EDGES[0]["properties"])
    assert props["paragrafi_per_volume"] == ["9001:2"] and props["paragrafi"] == 2
    assert props["volumi"] == [9001]
