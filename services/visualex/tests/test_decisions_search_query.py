"""How an article and a topic become one Solr query (design 2026-10-05 §5.2, §5.4)."""
import json
from pathlib import Path

import pytest

from visualex_api.services.decisions.search import (
    PROXIMITY, IndexCoordinates, UnsupportedAct, article_clause, build_query, cites,
    index_clause, topic_clause)

FIXTURES = Path(__file__).parent / "fixtures" / "decisions"


def test_a_civil_code_article_is_phrased_every_way_and_searched_in_civil():
    clause, archivio = article_clause({"tipo_atto": "codice civile", "numero_articolo": "2043"})
    assert archivio == "civile"
    for phrase in ('"art. 2043 c.c."', '"art. 2043 cod. civ."', '"articolo 2043 c.c."',
                   '"art. 2043 del codice civile"', '"articolo 2043 del codice civile"'):
        assert f"ocr:{phrase}" in clause
    assert 'ocr:"art. 2043"' not in clause  # the bare form catches other acts


def test_the_penal_code_is_searched_in_penal():
    _, archivio = article_clause({"tipo_atto": "codice penale", "numero_articolo": "640"})
    assert archivio == "penale"


def test_the_constitution_is_searched_in_both():
    clause, archivio = article_clause({"tipo_atto": "costituzione", "numero_articolo": "3"})
    assert archivio is None and 'ocr:"art. 3 Cost."' in clause
    assert 'ocr:"art. 3 della Costituzione"' in clause


def test_an_ordinal_is_written_spaced():
    clause, _ = article_clause({"tipo_atto": "codice civile", "numero_articolo": "2051-bis"})
    assert 'ocr:"art. 2051 bis c.c."' in clause


def test_a_numbered_act_is_a_proximity_phrase():
    clause, archivio = article_clause({"tipo_atto": "legge", "numero_atto": "241",
                                       "data": "1990-08-07", "numero_articolo": "2"})
    assert clause == f'ocr:"art 2 241 1990"~{PROXIMITY}' and archivio is None
    assert PROXIMITY == 6


@pytest.mark.parametrize("norma", [
    {"tipo_atto": "regolamento ue", "numero_atto": "679", "data": "2016-04-27", "numero_articolo": "5"},
    {"tipo_atto": "legge", "numero_articolo": "2"},                      # no number
    {"tipo_atto": "codice civile"},                                       # no article
    {"tipo_atto": "codice civile", "numero_articolo": "2043; DROP"},     # not an article
])
def test_what_cannot_be_phrased_is_unsupported(norma):
    with pytest.raises(UnsupportedAct):
        article_clause(norma)


@pytest.mark.parametrize("raw, words", [
    ("perdita di chance", "perdita di chance"),
    ("  danno   ingiusto ", "danno ingiusto"),
    ("dell'avvocato", "dell'avvocato"),
    ("ocr:* OR kind:\"snpen\"", "ocr OR kind snpen"),
    ('{!lucene}x \\ "y"', "lucene x y"),
])
def test_a_topic_keeps_only_words(raw, words):
    assert topic_clause(raw) == f'ocr:"{words}"'


def test_a_topic_is_capped_at_80_characters():
    assert len(topic_clause("a" * 200)) == len('ocr:""') + 80


@pytest.mark.parametrize("raw", ["", "   ", "*:*", "{}[]"])
def test_a_topic_with_no_words_is_refused(raw):
    with pytest.raises(ValueError):
        topic_clause(raw)


def test_the_query_joins_what_it_has_and_filters_the_archive():
    assert build_query('ocr:"a"', 'ocr:"b"', "civile") == 'kind:"snciv" AND (ocr:"a") AND (ocr:"b")'
    assert build_query(None, 'ocr:"b"', None) == '(ocr:"b")'
    with pytest.raises(ValueError):
        build_query(None, None, None)


# --- the index of cited norms -------------------------------------------------------------

@pytest.mark.parametrize("norma, clause, archivio, coords", [
    ({"tipo_atto": "codice civile", "numero_articolo": "2043"},
     'rnc-gen:"CC" AND rnc-art:"2043 00"', "civile", IndexCoordinates("CC", "2043 00")),
    ({"tipo_atto": "codice di procedura civile", "numero_articolo": "360"},
     'rnc-gen:"PC" AND rnc-art:"0360 00"', "civile", IndexCoordinates("PC", "0360 00")),
    ({"tipo_atto": "codice penale", "numero_articolo": "416-bis"},
     'rnc-gen:"CP" AND rnc-art:"0416 02"', "penale", IndexCoordinates("CP", "0416 02")),
    ({"tipo_atto": "codice di procedura penale", "numero_articolo": "606"},
     'rnc-gen:"PV" AND rnc-art:"0606 00"', "penale", IndexCoordinates("PV", "0606 00")),
    ({"tipo_atto": "costituzione", "numero_articolo": "3"},
     'rnc-gen:"LC" AND rnc-art:"0003 00"', None, IndexCoordinates("LC", "0003 00")),
])
def test_a_code_article_is_an_index_clause(norma, clause, archivio, coords):
    assert index_clause(norma) == (clause, archivio, coords)


@pytest.mark.parametrize("norma", [
    {"tipo_atto": "legge", "numero_atto": "241", "data": "1990", "numero_articolo": "2"},
    {"tipo_atto": "decreto legislativo", "numero_atto": "58", "data": "1998", "numero_articolo": "21"},
    {"tipo_atto": "preleggi", "numero_articolo": "12"},
    {"tipo_atto": "codice civile", "numero_articolo": "2051-ter"},
    {"tipo_atto": "codice civile", "numero_articolo": "2051-quater"},
    {"tipo_atto": "codice civile"},
    {"tipo_atto": "codice civile", "numero_articolo": "2043; DROP"},
])
def test_what_the_index_cannot_state_goes_to_the_text(norma):
    with pytest.raises(UnsupportedAct):
        index_clause(norma)


def test_cites_on_the_recorded_index_records():
    docs = json.loads((FIXTURES / "italgiure_index_2043_cc.json").read_text())["response"]["docs"]
    c = IndexCoordinates("CC", "2043 00")
    assert docs and all(cites(d, c) for d in docs)
    assert not any(cites(d, IndexCoordinates("CC", "9999 00")) for d in docs
                   if len(d["rnc-gen"]) == len(d["rnc-art"]))


def test_cites_rejects_the_article_of_another_act_on_an_aligned_record():
    doc = {"rnc-gen": ["CC", "LS"], "rnc-art": ["1227 00", "2043 00"], "rnc-sp": ["COD", "DLG"]}
    assert not cites(doc, IndexCoordinates("CC", "2043 00"))
    assert cites(doc, IndexCoordinates("CC", "1227 00"))


def test_cites_keeps_a_record_whose_lists_are_not_aligned():
    doc = {"rnc-gen": ["CC", "LS", "PC"], "rnc-art": ["1227 00", "2043 00"]}
    assert cites(doc, IndexCoordinates("CC", "2043 00"))


# --- fix round 1 ----------------------------------------------------------------------------

@pytest.mark.parametrize("norma, short, long_, archivio", [
    ({"tipo_atto": "disposizioni per l'attuazione del Codice civile e disposizioni transitorie",
      "numero_articolo": "66"}, "disp. att. c.c.", "disp. att. cod. civ.", "civile"),
    ({"tipo_atto": "disposizioni per l’attuazione del Codice di procedura civile e disposizioni transitorie",
      "numero_articolo": "118"}, "disp. att. c.p.c.", "disp. att. cod. proc. civ.", "civile"),
    ({"tipo_atto": "regio decreto", "numero_atto": "318", "data": "1942-03-30",
      "numero_articolo": "66"}, "disp. att. c.c.", "disp. att. cod. civ.", "civile"),
    ({"tipo_atto": "regio decreto", "numero_atto": "1368", "data": "1941-12-18",
      "numero_articolo": "118"}, "disp. att. c.p.c.", "disp. att. cod. proc. civ.", "civile"),
    ({"tipo_atto": "disp. att. c.c.", "numero_articolo": "66"},
     "disp. att. c.c.", "disp. att. cod. civ.", "civile"),
])
def test_the_disp_att_are_phrased_in_the_text(norma, short, long_, archivio):
    clause, found = article_clause(norma)
    n = norma["numero_articolo"]
    assert found == archivio
    for phrase in (f"art. {n} {short}", f"art. {n} {long_}", f"articolo {n} {short}"):
        assert f'ocr:"{phrase}"' in clause


def test_the_disp_att_never_reach_the_index():
    for norma in ({"tipo_atto": "regio decreto", "numero_atto": "318", "data": "1942", "numero_articolo": "66"},
                  {"tipo_atto": "disp. att. c.c.", "numero_articolo": "66"}):
        with pytest.raises(UnsupportedAct):
            index_clause(norma)


def test_another_regio_decreto_is_unsupported():
    with pytest.raises(UnsupportedAct):
        article_clause({"tipo_atto": "regio decreto", "numero_atto": "262", "data": "1942-03-16",
                        "numero_articolo": "1"})


@pytest.mark.parametrize("number", ["2²", "２０４３"])
def test_unicode_digits_are_not_article_numbers(number):
    with pytest.raises(UnsupportedAct):
        article_clause({"tipo_atto": "codice civile", "numero_articolo": number})
    with pytest.raises(UnsupportedAct):
        index_clause({"tipo_atto": "codice civile", "numero_articolo": number})


def test_unicode_digits_are_not_an_act_number():
    with pytest.raises(UnsupportedAct):
        article_clause({"tipo_atto": "legge", "numero_atto": "²⁴", "data": "1990", "numero_articolo": "2"})


def test_a_typographic_apostrophe_in_a_topic_is_kept_as_a_plain_one():
    assert topic_clause("dell’avvocato") == 'ocr:"dell\'avvocato"'


@pytest.mark.parametrize("raw", ["“danno” ingiusto", "„danno” ingiusto", "＂danno＂ ingiusto"])
def test_lookalike_quotes_in_a_topic_cannot_close_the_phrase(raw):
    assert topic_clause(raw) == 'ocr:"danno ingiusto"'


def test_an_unknown_archive_is_a_value_error():
    with pytest.raises(ValueError, match="unknown archive"):
        build_query('ocr:"a"', None, "amministrativo")


def test_a_dotted_number_is_phrased_in_the_text_and_not_in_the_index():
    clause, _ = article_clause({"tipo_atto": "codice di procedura penale", "numero_articolo": "270-bis.1"})
    assert 'ocr:"art. 270 bis.1 c.p.p."' in clause
    with pytest.raises(UnsupportedAct):
        index_clause({"tipo_atto": "codice di procedura penale", "numero_articolo": "270-bis.1"})


def test_the_preleggi_are_phrased_in_the_text():
    clause, archivio = article_clause({"tipo_atto": "preleggi", "numero_articolo": "12"})
    assert archivio is None and 'ocr:"art. 12 preleggi"' in clause and 'ocr:"art. 12 disp. prel."' in clause


def test_a_decreto_legge_is_a_proximity_phrase():
    clause, _ = article_clause({"tipo_atto": "decreto legge", "numero_atto": "18", "data": "2020-03-17",
                                "numero_articolo": "1"})
    assert clause == f'ocr:"art 1 18 2020"~{PROXIMITY}'
