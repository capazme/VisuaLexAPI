"""The administrative courts' identity (design 2026-10-12-administrative-courts §2, D1)."""
import json
from datetime import date
from pathlib import Path

import pytest

from visualex_api.services.decisions.model import Decision, Identity, InvalidReference, parse_reference
from visualex_api.services.decisions.tar_seats import BY_SLUG, SEATS, region_named, seat_named, seats_of

TODAY = date(2026, 10, 12)


def _seats_file() -> dict:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "conventions" / "sources" / "tar-seats.json"
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("conventions/sources/tar-seats.json not found above " + __file__)


def test_the_seats_are_the_conventions_copy():
    assert [(s.slug, s.sede, s.regione, s.principale, s.organo) for s in SEATS] == [
        (s["slug"], s["sede"], s["regione"], s["principale"], s["organo"]) for s in _seats_file()["seats"]]


def test_every_region_has_one_main_seat_listed_first():
    for regione in {s.regione for s in SEATS}:
        seats = seats_of(regione)
        assert seats[0].principale and sum(s.principale for s in seats) == 1


def test_seats_and_regions_are_read_without_case_accents_or_punctuation():
    assert seat_named("reggio calabria") is BY_SLUG["reggio-calabria"]
    assert seat_named("L’AQUILA") is BY_SLUG["l-aquila"]
    assert region_named("valle d'aosta") == "Valle d'Aosta"
    assert region_named("Emilia Romagna") == "Emilia-Romagna"
    assert region_named("Atlantide") is None


def test_the_key_carries_the_kind_and_a_tars_seat():
    assert Identity("consiglio_di_stato", 2270, 2019, provvedimento="sent").key() == "consiglio_di_stato:sent:2270:2019"
    assert Identity("cgars", 5, 2020, provvedimento="ocau").key() == "cgars:ocau:5:2020"
    assert Identity("tar", 1234, 2020, sede="roma", provvedimento="ocau").key() == "tar:roma:ocau:1234:2020"


def test_an_identity_travels_through_the_cache_whole():
    decision = Decision(identita=Identity("tar", 1234, 2020, sede="roma", provvedimento="ocau"), tipo="ordinanza")
    assert Decision.from_dict(decision.to_dict()).identita == decision.identita


def test_a_reference_to_a_tar_takes_a_seat_or_a_region():
    ref = parse_reference({"corte": "tar", "numero": 1234, "anno": 2020, "sede": "roma", "sezione": "I"}, TODAY)
    assert (ref.sede, ref.regione, ref.sezione.raw) == ("roma", None, "I")
    ref = parse_reference({"corte": "tar", "numero": 1234, "anno": 2020, "regione": "lazio", "tipo": "ordinanza"}, TODAY)
    assert (ref.sede, ref.regione, ref.tipo) == (None, "Lazio", "ordinanza")


@pytest.mark.parametrize("body,field", [
    ({"corte": "tar", "numero": 1, "anno": 2020}, "sede"),
    ({"corte": "tar", "numero": 1, "anno": 2020, "sede": "atlantide"}, "sede"),
    ({"corte": "tar", "numero": 1, "anno": 2020, "regione": "Atlantide"}, "regione"),
    ({"corte": "consiglio_di_stato", "numero": 1, "anno": 2020, "sede": "roma"}, "sede"),
    ({"corte": "consiglio_di_stato", "numero": 100000, "anno": 2020}, "numero"),
    ({"corte": "consiglio_di_stato", "numero": 1, "anno": 1989}, "anno"),
    ({"corte": "consiglio_di_stato", "numero": 1, "anno": 2020, "provvedimento": "SENT'"}, "provvedimento"),
    ({"corte": "consiglio_di_stato", "numero": 1, "anno": 2020, "tipo": "parere"}, "tipo"),
])
def test_a_bad_reference_names_its_field(body, field):
    with pytest.raises(InvalidReference) as raised:
        parse_reference(body, TODAY)
    assert field in raised.value.errors
