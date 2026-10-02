"""The identity of a court decision (design 2026-10-01 §1)."""
from datetime import date

import pytest

from visualex_api.services.decisions.model import (
    Decision,
    Identity,
    InvalidReference,
    Section,
    normalize_section,
    parse_reference,
)

TODAY = date(2026, 10, 1)


@pytest.mark.parametrize("raw,code", [
    ("3", "3"), ("III", "3"), ("iii", "3"), ("VII", "7"), ("7", "7"),
    ("SU", "U"), ("U", "U"), ("s.u.", "U"), ("unite", "U"),
    ("L", "L"), ("lav.", "L"), ("lavoro", "L"), ("F", "F"), ("feriale", "F"),
    ("T", "5"), ("trib.", "5"), ("tributaria", "5"),
])
def test_section_forms(raw, code):
    section = normalize_section(raw)
    assert section.code == code and section.recognised


def test_only_tributaria_implies_the_civil_archive():
    assert normalize_section("T").civil_only
    assert not normalize_section("5").civil_only


def test_an_unknown_section_is_kept_for_a_notice_never_an_error():
    assert normalize_section("6-3") == Section(None, "6-3", recognised=False)


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_no_section(raw):
    assert normalize_section(raw) == Section(None, None)


def test_a_cassazione_reference():
    ref = parse_reference(
        {"corte": "cassazione", "numero": "010787", "anno": 2024, "sezione": "III"}, TODAY)
    assert (ref.corte, ref.numero, ref.anno, ref.archivio) == ("cassazione", 10787, 2024, None)
    assert ref.sezione.code == "3"


def test_tributaria_reads_the_civil_archive():
    ref = parse_reference({"corte": "cassazione", "numero": 5, "anno": 2022, "sezione": "T"},
                          TODAY)
    assert ref.archivio == "civile" and ref.sezione.code == "5"


def test_the_corte_costituzionale_ignores_archive_and_section():
    ref = parse_reference({"corte": "corte_costituzionale", "numero": 1, "anno": 2014,
                           "archivio": "civile", "sezione": "III"}, TODAY)
    assert (ref.archivio, ref.sezione.code) == (None, None)


@pytest.mark.parametrize("body,field", [
    ({"corte": "tar", "numero": 1, "anno": 2024}, "corte"),
    ({"numero": 1, "anno": 2024}, "corte"),
    ({"corte": "cassazione", "numero": 0, "anno": 2024}, "numero"),
    ({"corte": "cassazione", "numero": "12a", "anno": 2024}, "numero"),
    ({"corte": "cassazione", "numero": 1234567, "anno": 2024}, "numero"),
    ({"corte": "cassazione", "numero": True, "anno": 2024}, "numero"),
    ({"corte": "cassazione", "numero": 1, "anno": 2027}, "anno"),
    ({"corte": "cassazione", "numero": 1, "anno": 1899}, "anno"),
    ({"corte": "corte_costituzionale", "numero": 1, "anno": 1950}, "anno"),
    ({"corte": "cassazione", "numero": 1, "anno": 2024, "archivio": "amministrativo"},
     "archivio"),
])
def test_invalid_references_name_the_field(body, field):
    with pytest.raises(InvalidReference) as e:
        parse_reference(body, TODAY)
    assert field in e.value.errors


def test_the_body_must_be_an_object():
    with pytest.raises(InvalidReference) as e:
        parse_reference(["cassazione"], TODAY)
    assert "body" in e.value.errors


def test_identity_keys_are_the_shared_contract():
    assert Identity("cassazione", 10787, 2024, "penale").key() == "cassazione:penale:10787:2024"
    assert Identity("corte_costituzionale", 1, 2014).key() == "corte_costituzionale:1:2014"


def test_a_decision_survives_its_own_dict():
    d = Decision(identita=Identity("cassazione", 10787, 2024, "civile"), sezione="3",
                 tipo="ordinanza", data_deposito="2024-04-22", testo={"motivazione": "x"},
                 fonte={"nome": "f"})
    assert Decision.from_dict(d.to_dict()) == d
    assert d.to_dict()["attributi"] == {"sezione": "3", "tipo": "ordinanza",
                                        "data_deposito": "2024-04-22"}
