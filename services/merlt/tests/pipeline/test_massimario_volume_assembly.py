# services/merlt/tests/pipeline/test_massimario_volume_assembly.py
from merlt.pipeline.massimario.rv_bands import RvBands
from merlt.pipeline.massimario.urns import NORMATTIVA_PREFIX
from merlt.pipeline.massimario.volume import build_volume, year_only_acts
from tests.pipeline.massimario_fixture import volume_9001

BANDS = RvBands({("civile", 2024): (669000, 673000)})
RESOLVED = {"urn:nir:stato:legge:1983;184": "urn:nir:stato:legge:1983-05-04;184"}
CC_2043 = NORMATTIVA_PREFIX + "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
CPC_360 = NORMATTIVA_PREFIX + "urn:nir:stato:regio.decreto:1940-10-28;1443:1~art360"


def build(resolved=RESOLVED):
    return build_volume(volume_9001(), resolved=resolved, bands=BANDS)


def nodes_by_id(out):
    return {n["id"]: n for n in out["nodes"]}


def test_year_only_acts_are_listed_for_resolution():
    assert year_only_acts(volume_9001()) == {"urn:nir:stato:legge:1983;184"}


def test_decisions_are_one_node_each_with_unions():
    nodes = nodes_by_id(build())
    d = nodes["cassazione:civile:1234:2024"]
    assert d["labels"] == ["AttoGiudiziario"]
    props = d["properties"]
    assert props["node_id"] == "cassazione:civile:1234:2024"
    assert props["rv"] == ["670001-01", "670001-02"]
    assert props["sezioni"] == ["U"] and props["anni_rassegna"] == [2024]
    assert props["estremi"] == "Cass. civ., n. 1234/2024"
    assert props["fonte"] == "Ufficio del Massimario" and props["provenance"] == "ingestion"
    assert nodes["cassazione:civile:4321:2024"]["properties"]["anno_implicito"] is True
    assert "corte_costituzionale:12:2024" in nodes


def test_norm_stubs_for_every_cited_norm():
    nodes = nodes_by_id(build())
    stub = nodes[CC_2043]
    assert stub["labels"] == ["Norma"] and stub["properties"]["is_stub"] is True
    assert NORMATTIVA_PREFIX + "urn:nir:stato:legge:1983-05-04;184" in nodes
    assert not any("~sez2" in key for key in nodes)


def test_weak_edges_only_inside_a_paragraph():
    edges = {(e["start"], e["end"]): e for e in build()["edges"]}
    edge = edges[("cassazione:civile:1234:2024", CC_2043)]
    assert edge["type"] == "INTERPRETA"
    props = edge["properties"]
    assert (props["tipo"], props["confidenza"], props["paragrafi"]) == ("co-citazione", 0.5, 2)
    assert props["anni_rassegna"] == [2024] and props["volumi"] == [9001] and props["_mass_key"]
    assert props["paragrafi_per_volume"] == ["9001:2"]
    assert ("cassazione:civile:567:2023", CC_2043) not in edges  # different paragraphs


def test_chunks_payload_and_bridge_rows():
    chunks = build()["extras"]["chunks"]
    first = chunks[0]
    assert first["piece"] == 0 and first["paragraph_key"] == "massimario|9001|9111|0"
    payload = first["payload"]
    assert payload["source_type"] == "rassegna" and payload["fonte"] == "Ufficio del Massimario"
    assert payload["anno"] == 2024 and payload["archivio"] == "civile"
    assert payload["capitolo"] == {"nome": "CAPITOLO I", "titolo": "LA RESPONSABILITÀ"}
    assert payload["sezione"] == {"id": 9111, "numero": "1", "titolo": "Il danno."}
    assert payload["autori"] == ["Anna Rossi", "Bruno Verdi"]
    assert payload["url"].endswith("/rassegneAnnuali/9001/dettaglio.do#9111")
    (norm,) = payload["norme"]
    assert payload["text"][norm["start"]:norm["end"]] == "art. 2043 c.c."
    assert payload["decisioni"][0]["key"] == "cassazione:civile:1234:2024"
    rows = {(r["relation_type"], r["graph_node_urn"]) for r in first["bridge"]}
    assert rows == {("CITA_NORMA", CC_2043), ("CITA_PRONUNCIA", "cassazione:civile:1234:2024")}
    assert all(r["confidence"] == 1.0 and r["metadata"]["anno"] == 2024 for r in first["bridge"])
    assert all(r["metadata"]["fonte"] == "Ufficio del Massimario" for r in first["bridge"])


def test_comma_and_markup():
    chunks = build()["extras"]["chunks"]
    second = chunks[1]["payload"]
    assert second["norme"][0] == {**second["norme"][0], "urn": CPC_360, "comma": "com1-num5"}
    script = chunks[2]["payload"]["text"]
    assert script == "La l. n. 184 del 1983 resta ferma."


def test_report():
    report = build()["report"]
    assert report["urn_conflicts"] == [] and report["stats"]["nodes_total"] == len(build()["nodes"])
    m = report["massimario"]
    assert m["volume"]["anno"] == 2024 and m["paragrafi"] == 6
    assert m["citazioni"]["rv_totali"] == 5 and m["citazioni"]["rv_riconosciute"] == 5
    assert m["norme"]["partizioni"] == 1 and m["norme"]["date_completate"] == 1
    assert m["sezioni_fuori_capitolo"] == 1


def test_unresolved_year_only_act_is_reported_not_linked():
    out = build(resolved={})
    assert out["report"]["massimario"]["norme"]["non_risolte"] == 1
    assert not any("legge" in n["id"] for n in out["nodes"])


def test_build_is_deterministic():
    assert build() == build()


def test_a_decision_linked_as_a_law_is_no_norm():
    raw = volume_9001()
    section = raw["capitoli"][9102]["sezioni"][0]
    section["testo"] += (
        '<p>Così Sez. 6 - <a href="http://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2022;9522">'
        "L, n. 09952/2022</a>, Rv. 670900-01.</p>"
    )
    assert year_only_acts(raw) == {"urn:nir:stato:legge:1983;184"}
    out = build_volume(raw, resolved={**RESOLVED, "urn:nir:stato:legge:2022;9522": "urn:nir:stato:legge:2022-12-01;9522"},
                       bands=BANDS)
    assert not any("9522" in n["id"] for n in out["nodes"])
    assert out["report"]["massimario"]["norme"]["link_a_pronunce"] == 1
    assert "cassazione:civile:9952:2022" in {n["id"] for n in out["nodes"]}


def test_a_repeated_rv_is_stored_once():
    raw = volume_9001()
    raw["sezioni"][9201]["testo"] += "<p>Sez. 3, n. 777/2024, Rv. 670200-01, Rv. 670200-01.</p>"
    nodes = nodes_by_id(build_volume(raw, resolved=RESOLVED, bands=BANDS))
    assert nodes["cassazione:civile:777:2024"]["properties"]["rv"] == ["670200-01"]
