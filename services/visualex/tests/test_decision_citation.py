"""Decisions in words (design 2026-10-12 §2.1): `read_decision_citation` and `POST /parse_decision`.

The cases are the convention's golden file (`decision_citations`), which the web palette's
`decisionCitationParser.test.ts` asserts too: the two readers cannot drift apart.
"""
import json
import random
import string
import time
from datetime import date
from pathlib import Path

import pytest

from app import NormaController
from visualex_api.services.decisions.citation import MAX_SCANNED, read_decision_citation
from visualex_api.services.decisions.model import parse_reference


def _golden() -> dict:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "conventions" / "sources" / "golden.json"
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("conventions/sources/golden.json not found above " + __file__)


_SECTION = _golden()["decision_citations"]
TODAY = date.fromisoformat(_SECTION["today"])
ASSERTED = ("decided", "current", "proposed")
CASES = [c for c in _SECTION["cases"] if c["reference"]["status"] in ASSERTED]
OPEN = [c for c in _SECTION["cases"] if c["reference"]["status"] not in ASSERTED]


def test_the_golden_file_has_the_cases():
    assert len(CASES) > 30


@pytest.mark.parametrize("case", CASES, ids=[c["input"] for c in CASES])
def test_the_words_read_as_the_golden_file_says(case):
    reading = read_decision_citation(case["input"], TODAY)
    assert reading.riferimento == case["reference"]["value"]
    court = case.get("unsupported_court")
    if court and court["status"] in ASSERTED:
        assert reading.corte_non_supportata == court["value"]
    elif reading.riferimento is None:
        assert reading.corte_non_supportata is None


@pytest.mark.parametrize("case", OPEN, ids=[c["input"] for c in OPEN])
def test_open_cases_wait_for_the_owner(case):
    pytest.skip(f"{case['reference']['status']}: not asserted until the owner answers")


@pytest.mark.parametrize("case", [c for c in CASES if c["reference"]["value"]],
                         ids=[c["input"] for c in CASES if c["reference"]["value"]])
def test_every_reference_is_one_fetch_decision_takes(case):
    reference = parse_reference(read_decision_citation(case["input"], TODAY).riferimento, TODAY)
    assert reference.numero == case["reference"]["value"]["numero"]


def test_the_courts_of_the_union_are_read_by_their_case():
    assert read_decision_citation("CGUE, C-634/21", TODAY).riferimento == {
        "corte": "corte_giustizia_ue", "numero": 634, "anno": 2021}
    # the letter names the court, whatever name precedes it
    assert read_decision_citation("CGUE, T-612/17", TODAY).riferimento == {
        "corte": "tribunale_ue", "numero": 612, "anno": 2017}
    # a date in the citation is the judgment's, never the case's year
    assert read_decision_citation("Corte giust. UE, 7 dicembre 2023, causa C-634/21", TODAY).riferimento["anno"] == 2021
    # a court of the Union named without a case it can read is not recognised, never another court
    assert read_decision_citation("Corte di giustizia UE, sentenza del 2023", TODAY).to_dict() == {"non_riconosciuta": True}
    assert read_decision_citation("Trib. UE, causa 26/62", TODAY).to_dict() == {"non_riconosciuta": True}


@pytest.mark.parametrize("words,court", [
    # the Italian tax courts, so named since l. 130/2022: never the Court of Justice
    ("Corte di giustizia tributaria di primo grado di Milano, n. 5/2023", "Corte di giustizia tributaria"),
    ("C. giust. trib. 5/2023", "Corte di giustizia tributaria"),
    ("Corte giust. trib. Lombardia, n. 5/2023", "Corte di giustizia tributaria"),
    ("Garante della privacy, provv. n. 5/2021", "Garante per la protezione dei dati personali"),
    ("Corte EDU, ric. n. 30562/04", "Corte europea dei diritti dell'uomo"),
    ("CEDU, 4 dicembre 2008", "Corte europea dei diritti dell'uomo"),
])
def test_a_court_without_a_reader_is_named(words, court):
    assert read_decision_citation(words, TODAY).corte_non_supportata == court


@pytest.mark.parametrize("words", ["Garante del contribuente, n. 5/2021", "Garante della concorrenza, provv. 5/2021",
                                   "CEDU, art. 8", "CEDU art. 6"])
def test_what_names_no_court_is_not_named_as_one(words):
    assert read_decision_citation(words, TODAY).corte_non_supportata is None


def test_a_no_break_space_reads_as_a_space():
    assert read_decision_citation("Corte cost.\u00a0n.\u00a071/2020", TODAY).riferimento == {
        "corte": "corte_costituzionale", "numero": 71, "anno": 2020}
    assert read_decision_citation("Cass. civ., sez.\u00a0III, n.\u202f12/2020", TODAY).riferimento == {
        "corte": "cassazione", "archivio": "civile", "sezione": "III", "numero": 12, "anno": 2020}


@pytest.mark.parametrize("words", ["", "   ", "Cass.", "art. 8 CEDU", "tarda giurisprudenza 12/2020",
                                   "Corte d'appello di Milano, n. 12/2020"])
def test_what_is_not_a_decision_is_not_recognised(words):
    assert read_decision_citation(words, TODAY).to_dict() == {"non_riconosciuta": True}


def test_anything_but_a_string_is_not_recognised():
    for value in (None, 12, ["Cass. 1/2020"], {"corte": "cassazione"}):
        assert read_decision_citation(value, TODAY).to_dict() == {"non_riconosciuta": True}


def test_only_the_first_characters_are_read():
    padded = "Cass. civ. " + " " * MAX_SCANNED + "n. 5/2020"
    assert read_decision_citation(padded, TODAY).riferimento is None


# --- hostile input ------------------------------------------------------------------------

HOSTILE = [
    "Cass. " + "n. 1 " * 5000,
    "Cass. " + "1/" * 5000,
    "Cass. civ. " + "sez. " * 5000,
    "Cass. " + "dep. " * 5000 + "2020",
    "Corte cost. " + "del " * 5000,
    "Cass. " + "1" * 10000 + "/2020",
    "Cons. " * 5000,
    "C" + "-1" * 5000 + "/21",
    "Cass. " + "21 aprile " * 3000,
    "S.U. " + " ," * 5000 + "1",
]


@pytest.mark.parametrize("words", HOSTILE, ids=[f"hostile-{i}" for i in range(len(HOSTILE))])
def test_a_hostile_text_is_read_quickly(words):
    start = time.perf_counter()
    read_decision_citation(words, TODAY)
    assert time.perf_counter() - start < 0.2


def test_random_text_is_read_quickly_and_never_raises():
    rng = random.Random(20261012)
    alphabet = string.ascii_letters + string.digits + " .,/-()°àèìòù‑\n\t"
    pieces = ["Cass.", "civ.", "pen.", "sez.", "n.", "del", "dep.", "Corte cost.", "S.U.", "/", "2024",
              "aprile", "Cons. Stato", "C-", "T-", "causa", "CGUE", "1"]
    start = time.perf_counter()
    for _ in range(3000):
        if rng.random() < 0.5:
            words = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 400)))
        else:
            words = " ".join(rng.choice(pieces) for _ in range(rng.randint(1, 80)))
        reading = read_decision_citation(words, TODAY)
        if reading.riferimento is not None:
            parse_reference(reading.riferimento, TODAY)  # always a reference the route takes
    assert time.perf_counter() - start < 10


# --- the route ----------------------------------------------------------------------------

@pytest.fixture
def client():
    return NormaController().app.test_client()


async def test_the_route_answers_one_reading_per_citation_in_order(client):
    resp = await client.post("/parse_decision", json={"citazioni": [
        "Cass. civ., sez. un., n. 31310/2024", "Garante privacy, provv. n. 5/2021", "art. 2043 c.c."]})
    assert resp.status_code == 200
    assert (await resp.get_json()) == {"risultati": [
        {"riferimento": {"corte": "cassazione", "archivio": "civile", "sezione": "U",
                         "numero": 31310, "anno": 2024}},
        {"corte_non_supportata": "Garante per la protezione dei dati personali"},
        {"non_riconosciuta": True},
    ]}


@pytest.mark.parametrize("body", [
    None, [], {}, {"citazioni": []}, {"citazioni": "Cass. 1/2020"}, {"citazioni": ["x"] * 11},
    {"citazioni": [""]}, {"citazioni": ["x" * 301]}, {"citazioni": [12]},
])
async def test_the_route_refuses_what_is_not_1_to_10_short_citations(client, body):
    resp = await client.post("/parse_decision", json=body)
    assert resp.status_code == 400
    assert (await resp.get_json())["esito"] == "richiesta_non_valida"


@pytest.mark.parametrize("words", ["Cons. Stato, n. 2270/2019 e TAR Lazio", "TAR " + "Lazio " * 3000 + "n. 1/2020",
                                   "T.R.G.A. " + "x" * 5000, "Cons. Stato, sez. " * 2000])
def test_an_administrative_citation_is_read_quickly(words):
    start = time.perf_counter()
    read_decision_citation(words, TODAY)
    assert time.perf_counter() - start < 0.2
