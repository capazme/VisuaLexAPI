"""The label backfill of the source convention: its plan (pure) and one run on a test graph."""
from __future__ import annotations

import pytest
import pytest_asyncio

from merlt.scripts.backfill_source_labels import plan_decision, plan_norm, run
from merlt.storage.graph.client import FalkorDBClient

N = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
CC = N + "regio.decreto:1942-03-16;262:2"
LAW = N + "legge:1992-02-17;154"


def test_an_article_gets_its_short_label_and_loses_a_titolo_that_repeated_its_extremes():
    props = {"URN": CC + "~art2043", "tipo_documento": "articolo", "estremi": "Art. 2043 c.c.", "titolo": "Art. 2043 c.c.",
             "autorita_emanante": "Regio Decreto"}
    assert plan_norm(props) == {"estremi": "art. 2043 c.c.", "titolo": None, "autorita_emanante": "Re"}


def test_an_article_of_an_ordinary_act():
    props = {"URN": LAW + "~art11", "estremi": "Art. 11 LEGGE 17 febbraio 1992, n. 154", "autorita_emanante": "Parlamento"}
    assert plan_norm(props) == {"estremi": "art. 11 l. 154/1992"}


def test_a_code_node_gets_its_heading_and_its_authority():
    props = {"URN": CC, "tipo_documento": "codice", "titolo": "Codice Civile", "autorita_emanante": "Regio Decreto"}
    assert plan_norm(props) == {"titolo": "Codice civile", "autorita_emanante": "Re"}


def test_an_ordinary_act_node():
    props = {"URN": LAW, "tipo_documento": "legge", "titolo": "Legge n. 154 del 17/02/1992",
             "estremi": "LEGGE 17 febbraio 1992, n. 154", "autorita_emanante": "Parlamento"}
    assert plan_norm(props) == {"titolo": "l. 17 febbraio 1992, n. 154", "estremi": "l. 17 febbraio 1992, n. 154"}


def test_a_stub_keeps_the_one_stub_shape_only_its_estremi_change():
    assert plan_norm({"URN": CC + "~art771", "estremi": "Art. 771 c.c.", "is_stub": True}) == {"estremi": "art. 771 c.c."}
    assert plan_norm({"URN": LAW, "is_stub": True}) == {}  # an act's stub gets no titolo, no authority


def test_an_authority_the_convention_does_not_infer_is_removed():
    eu = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.ministeriale:2014-03-10;55"
    assert plan_norm({"URN": eu, "titolo": "d.m. 10 marzo 2014, n. 55", "autorita_emanante": "Ministro"}) == {}
    unknown = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.del.presidente.del.consiglio.dei.ministri:2020-03-08"
    assert plan_norm({"URN": unknown, "titolo": "d.p.c.m. 8 marzo 2020", "autorita_emanante": "Stato"}) \
        == {"autorita_emanante": None}


def test_structure_nodes_and_unreadable_keys_are_left_alone():
    assert plan_norm({"URN": CC + "~libro4~tit3~capo26", "tipo_documento": "capo", "titolo": "Della cessione"}) == {}
    # a partition with no type, or a type in capitals, is still a partition
    assert plan_norm({"URN": CC + "~libro4", "titolo": "Delle obbligazioni"}) == {}
    assert plan_norm({"URN": CC + "~libro4", "tipo_documento": "Libro", "titolo": "Delle obbligazioni"}) == {}
    assert plan_norm({"URN": "urn:test:cod", "estremi": "Codice civile"}) == {}
    assert plan_norm({"URN": N + "legge:1983;184~art6", "estremi": "Art. 6"}) == {}  # year-only: no identity


def test_a_label_already_in_the_convention_is_not_rewritten():
    assert plan_norm({"URN": CC + "~art2043", "estremi": "art. 2043 c.c."}) == {}
    assert plan_norm({"URN": CC, "titolo": "Codice civile", "autorita_emanante": "Re"}) == {}


def test_decisions():
    assert plan_decision({"node_id": "cassazione:civile:31310:2024", "estremi": "Cass. civ., n. 31310/2024",
                          "sezioni": ["U"]}) == {"estremi": "Cass. civ., sez. un., n. 31310/2024"}
    # two sections recorded: the label names none rather than one at random
    assert plan_decision({"node_id": "cassazione:civile:5:2020", "sezioni": ["1", "3"]}) == {"estremi": "Cass. civ., n. 5/2020"}
    assert plan_decision({"node_id": "corte_costituzionale:71:2020", "estremi": "Corte cost., n. 71/2020"}) == {}
    assert plan_decision({"node_id": "massima_cassazione_civile_2633_1982", "estremi": "Cassazione civile 2633/1982",
                          "organo_emittente": "Cassazione civile", "numero_sentenza": "2633", "anno": "1982"}) \
        == {"estremi": "Cass. civ., n. 2633/1982"}
    assert plan_decision({"node_id": "massima_consiglio_di_stato_12_2020", "estremi": "Consiglio di Stato 12/2020",
                          "organo_emittente": "Consiglio di Stato", "numero_sentenza": "12", "anno": "2020"}) == {}


TEST_GRAPH = "merlt_test_backfill_labels"


@pytest_asyncio.fixture
async def graph(monkeypatch):
    monkeypatch.setenv("FALKORDB_GRAPH_NAME", TEST_GRAPH)
    client = FalkorDBClient(graph_name=TEST_GRAPH)
    await client.connect()
    await client.query("MATCH (n) DETACH DELETE n", {})
    yield client
    try:
        await client.query("MATCH (n) DETACH DELETE n", {})
    finally:
        await client.close()


@pytest.mark.integration
async def test_a_dry_run_writes_nothing_and_a_run_converges(graph):
    await graph.query(
        "CREATE (:Norma {URN: $art, estremi: 'Art. 2043 c.c.', titolo: 'Art. 2043 c.c.', tipo_documento: 'articolo'}), "
        "(:Norma {URN: $cc, titolo: 'Codice Civile', autorita_emanante: 'Regio Decreto', tipo_documento: 'codice'}), "
        "(:AttoGiudiziario {node_id: 'cassazione:civile:31310:2024', estremi: 'Cass. civ., n. 31310/2024', sezioni: ['U']})",
        {"art": CC + "~art2043", "cc": CC},
    )

    dry = await run(apply=False)
    assert (dry["norms_changed"], dry["decisions_changed"]) == (2, 1)
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.estremi AS e", {"u": CC + "~art2043"}) == [{"e": "Art. 2043 c.c."}]

    await run(apply=True)
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.estremi AS e, n.titolo AS t", {"u": CC + "~art2043"}) \
        == [{"e": "art. 2043 c.c.", "t": None}]
    assert await graph.query("MATCH (n:Norma {URN: $u}) RETURN n.titolo AS t, n.autorita_emanante AS a", {"u": CC}) \
        == [{"t": "Codice civile", "a": "Re"}]
    assert await graph.query("MATCH (d:AttoGiudiziario) RETURN d.estremi AS e", {}) == [{"e": "Cass. civ., sez. un., n. 31310/2024"}]

    again = await run(apply=False)
    assert (again["norms_changed"], again["decisions_changed"]) == (0, 0)
