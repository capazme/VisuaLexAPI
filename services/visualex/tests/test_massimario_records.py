"""A volume's paragraph records and parse report (design 2026-10-30-rassegne-without-merlt §3.1,
§5), on the synthetic volume. The counts are the ones MERL-T's assembly test asserts on the same
volume (`services/merlt/tests/pipeline/test_massimario_volume_assembly.py`)."""
import json

import pytest

from tests.massimario_fixture import N, volume_9001
from tests.test_sources_golden import GOLDEN
from visualex_api.services.massimario.records import PARSER_VERSION, build_records
from visualex_api.services.massimario.rv_bands import RvBands
from visualex_api.services.massimario.urns import NORMATTIVA_PREFIX, parse_portal_urn, to_canonical
from visualex_api.services.massimario.volume import year_only_acts
from visualex_api.tools.sources import normalize_norm_urn

BANDS = RvBands({("civile", 2024): (669000, 673000)})
RESOLVED = {"urn:nir:stato:legge:1983;184": "urn:nir:stato:legge:1983-05-04;184"}
CC_2043 = NORMATTIVA_PREFIX + "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"
CPC_360 = NORMATTIVA_PREFIX + "urn:nir:stato:regio.decreto:1940-10-28;1443:1~art360"


def build(raw=None, resolved=RESOLVED):
    return build_records(raw or volume_9001(), resolved=resolved, bands=BANDS)


def test_records_in_reading_order_with_their_context():
    records = build().records
    assert [r["paragraph_key"] for r in records] == [
        "massimario|9001|9111|0", "massimario|9001|9111|1", "massimario|9001|9112|0",
        "massimario|9001|9112|1", "massimario|9001|9121|0", "massimario|9001|9201|0",
    ]
    assert [r["ordine"] for r in records] == [9001_000_000 + i for i in range(6)]
    first = records[0]
    assert (first["anno"], first["archivio"], first["fonte"]) == (2024, "civile", "Ufficio del Massimario")
    assert first["volume"] == {"id": 9001, "numero": 1, "titolo": "Massimario 2024 CIVILE Vol. 1"}
    assert first["parte"] == {"nome": "PARTE PRIMA", "titolo": "I DIRITTI"}
    assert first["capitolo"] == {"id": 9101, "nome": "CAPITOLO I", "titolo": "LA RESPONSABILITÀ",
                                 "autori": ["Anna Rossi", "Bruno Verdi"],
                                 "materie": ["danno", "responsabilità civile"]}
    assert first["sezione"] == {"id": 9111, "numero": "1", "titolo": "Il danno."}
    assert first["url"].endswith("/rassegneAnnuali/9001/dettaglio.do#9111")
    assert first["pieces"] == [[0, len(first["text"])]]
    assert records[-1]["capitolo"] is None and records[-1]["parte"] is None


def test_norm_spans_are_keyed_by_the_norms_identity():
    first, second, third = build().records[:3]
    (norm,) = first["norme"]
    assert norm == {"urn": CC_2043, "start": norm["start"], "end": norm["end"],
                    "citazione": "art. 2043 c.c.", "comma": None, "articolo": True}
    assert first["text"][norm["start"]:norm["end"]] == "art. 2043 c.c."
    assert second["norme"][0]["urn"] == CPC_360 and second["norme"][0]["comma"] == "com1-num5"
    assert third["text"] == "La l. n. 184 del 1983 resta ferma."  # the script is gone
    assert third["norme"][0]["urn"] == NORMATTIVA_PREFIX + "urn:nir:stato:legge:1983-05-04;184"
    assert third["norme"][0]["articolo"] is False


def test_decisions_with_their_fields():
    records = build().records
    first = records[0]["decisioni"][0]
    assert first == {
        "key": "cassazione:civile:1234:2024", "motivo_senza_identita": None, "corte": "cassazione",
        "archivio": "civile", "numero": 1234, "anno": 2024, "sezione": "U", "rv": ["670001-01"],
        "relatore": "Bianchi", "data_udienza": None, "anno_implicito": False, "forma": "slash",
    }
    implicit = records[4]["decisioni"][0]  # "Sez. 2, n. 4321 (Rv. 670500-01)": the review's year, in the band
    assert implicit["key"] == "cassazione:civile:4321:2024" and implicit["anno_implicito"] is True
    consulta = records[5]["decisioni"][0]
    assert consulta["key"] == "corte_costituzionale:12:2024" and consulta["archivio"] is None


def test_a_decision_cited_twice_in_a_paragraph_is_one_entry_with_both_massime():
    raw = volume_9001()
    raw["sezioni"][9201]["testo"] = "<p>Sez. 3, n. 777/2024, Rv. 670200-01; e ancora Sez. 3, n. 777/2024, Rv. 670200-02.</p>"
    (record,) = [r for r in build(raw).records if r["sezione"]["id"] == 9201]
    (entry,) = record["decisioni"]
    assert entry["key"] == "cassazione:civile:777:2024" and entry["rv"] == ["670200-01", "670200-02"]


def test_a_reference_without_identity_says_why():
    raw = volume_9001()
    raw["sezioni"][9201]["testo"] = "<p>Sez. 3, n. 2103 (Rv. 599999) resta isolata.</p>"
    (record,) = [r for r in build(raw).records if r["sezione"]["id"] == 9201]
    (entry,) = record["decisioni"]
    assert entry["key"] is None and entry["motivo_senza_identita"] == "anno_non_verificato"


def test_a_long_paragraph_carries_its_pieces():
    raw = volume_9001()
    raw["sezioni"][9201]["testo"] = "<p>" + "Una frase sintetica abbastanza lunga. " * 120 + "</p>"
    (record,) = [r for r in build(raw).records if r["sezione"]["id"] == 9201]
    pieces = record["pieces"]
    assert len(pieces) > 1 and pieces[0][0] == 0 and pieces[-1][1] == len(record["text"])
    assert all(end - start <= 2000 for start, end in pieces)


def test_report():
    out = build()
    report = out.report
    assert report["volume"] == {"id": 9001, "titolo": "Massimario 2024 CIVILE Vol. 1", "anno": 2024,
                                "archivio": "civile", "numero": 1}
    assert report["parser_version"] == PARSER_VERSION
    assert report["paragrafi"] == 6 and report["frammenti"] == 6
    assert report["citazioni"]["rv_totali"] == 5 and report["citazioni"]["rv_riconosciute"] == 5
    assert report["citazioni"]["copertura_pct"] == 100.0
    assert report["pronunce"]["totali"] == 5 and report["pronunce"]["anno_implicito"] == 1
    norme = report["norme"]
    assert (norme["partizioni"], norme["date_completate"], norme["non_risolte"]) == (1, 1, 0)
    assert (norme["riferimenti"], norme["articoli"], norme["atti"], norme["normalizzate"]) == (7, 4, 1, 0)
    assert report["sezioni_fuori_capitolo"] == 1
    # what only the graph knows is MERL-T's to add at staging
    assert "stub" not in norme and "gia_nel_grafo" not in norme and "gia_nel_grafo" not in report["pronunce"]
    json.dumps(report)  # stored as JSON


def test_a_decision_with_two_sections_is_reported():
    raw = volume_9001()
    raw["sezioni"][9201]["testo"] = "<p>Sez. 3, n. 1234/2024, Rv. 670001-03.</p>"
    report = build(raw).report
    assert report["pronunce"]["chiavi_con_piu_sezioni"] == [{"key": "cassazione:civile:1234:2024", "sezioni": ["3", "U"]}]


def test_an_unresolved_year_only_act_is_counted_not_linked():
    out = build(resolved={})
    assert year_only_acts(volume_9001()) == {"urn:nir:stato:legge:1983;184"}
    assert out.report["norme"]["non_risolte"] == 1
    assert not any("legge" in n["urn"] for r in out.records for n in r["norme"])


def test_a_decision_linked_as_a_law_is_no_norm():
    raw = volume_9001()
    raw["capitoli"][9102]["sezioni"][0]["testo"] += (
        f'<p>Così Sez. 6 - <a href="{N}stato:legge:2022;9522">L, n. 09952/2022</a>, Rv. 670900-01.</p>')
    out = build(raw, resolved={**RESOLVED, "urn:nir:stato:legge:2022;9522": "urn:nir:stato:legge:2022-12-01;9522"})
    assert not any("9522" in n["urn"] for r in out.records for n in r["norme"])
    assert out.report["norme"]["link_a_pronunce"] == 1
    assert "cassazione:civile:9952:2022" in {d["key"] for r in out.records for d in r["decisioni"]}


def test_build_is_deterministic():
    assert build().records == build().records and build().report == build().report


# --- §5: the norms' identity ------------------------------------------------------------------

def test_every_stored_urn_is_a_fixed_point_of_normalize_norm_urn():
    raw = volume_9001()
    raw["sezioni"][9201]["testo"] += (
        f'<p>Il <a href="{N}ministero.giustizia:decreto:2014-03-10;55~art4">d.m. n. 55 del 2014</a> '
        f'e il <a href="{N}presidente.repubblica:decreto:1973-03-29;156~art20">codice postale</a>.</p>')
    out = build(raw)
    urns = [n["urn"] for r in out.records for n in r["norme"]]
    assert urns and all(normalize_norm_urn(u) == u for u in urns)
    assert NORMATTIVA_PREFIX + "urn:nir:stato:decreto.ministeriale:2014-03-10;55~art4" in urns
    assert out.report["norme"]["normalizzate"] == 1  # the ministry-form decree: MERL-T keys it otherwise today


_GOLDEN_NORMS = {c["id"]: c["identity"]["article"]["value"] for c in GOLDEN["norms"]
                 if c["identity"].get("article", {}).get("status") == "current"}
# A golden article as the portal links it: the codes by their code form, the c.p.a. and the
# codice postale by their decree without the annex, a ministerial decree by its ministry.
_PORTAL_FORMS = {
    "cc-2043": "stato:codice.civile:1942-03-16;262~art2043",
    "cc-2645-bis": "stato:codice.civile:1942-03-16;262~art2645bis",
    "cost-81": "stato:costituzione:1947-12-27~art81",
    "cpc-183-bis": "stato:codice.procedura.civile:1940-10-28;1443~art183bis",
    "cpp-191": "stato:codice.procedura.penale:1988-09-22;447~art191",
    "cpa-29": "stato:decreto.legislativo:2010-07-02;104~art29",
    "cgc-52": "stato:decreto.legislativo:2016-08-26;174~art52",
    "cod-postale-20": "presidente.repubblica:decreto:1973-03-29;156~art20",
    "l-241-1990-2": "stato:legge:1990-08-07;241~art2",
    "dm-55-2014-4": "ministero.giustizia:decreto:2014-03-10;55~art4",
}


@pytest.mark.parametrize("case", sorted(_PORTAL_FORMS))
def test_the_golden_articles_land_on_their_identity(case):
    canonical = to_canonical(parse_portal_urn(N + _PORTAL_FORMS[case]), {})
    assert normalize_norm_urn(canonical) == _GOLDEN_NORMS[case]
    if case != "dm-55-2014-4":
        assert canonical == _GOLDEN_NORMS[case]  # urns.py puts the codes there by itself
