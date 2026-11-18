"""The convention for legal sources, as far as this API holds it today.

`conventions/sources/golden.json` (spec docs/superpowers/specs/2026-10-04-source-convention-design.md)
is read by every suite. Until this API adopts the convention, this test pins what the file
calls `current`: the URN `generate_urn` builds for a norm, and the key of a decision.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from visualex_api.services.decisions.model import Identity
from visualex_api.tools.urngenerator import generate_urn


def _golden() -> dict:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "conventions" / "sources" / "golden.json"
        if candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("conventions/sources/golden.json not found above " + __file__)


GOLDEN = _golden()

# Normattiva identities: an EU act's identity is its CELEX (eu_identity, below), while
# generate_urn keeps building the EUR-Lex page it is read from.
_NORMS = [c for c in GOLDEN["norms"] if c["identity"].get("article", {}).get("status") == "current"
          and not str(c["identity"]["article"]["value"]).startswith("celex:")]
_DECISIONS = [c for c in GOLDEN["decisions"]
              if c["identity"].get("key", {}).get("status") in ("current", "decided", "proposed") and c["identity"]["key"]["value"]]


def test_the_file_has_current_cases():
    assert len(_NORMS) > 10
    assert len(_DECISIONS) > 4


@pytest.mark.parametrize("case", _NORMS, ids=[c["id"] for c in _NORMS])
def test_current_norm_identity_is_what_generate_urn_builds(case):
    n = case["input"]
    urn = generate_urn(n["tipo_atto"], n.get("data"), n.get("numero_atto"), n["numero_articolo"], n.get("allegato"))
    assert urn == case["identity"]["article"]["value"]
    act = case["identity"].get("act")
    if act and act["status"] == "current":
        assert urn.split("~")[0] == act["value"]


@pytest.mark.parametrize("case", _DECISIONS, ids=[c["id"] for c in _DECISIONS])
def test_current_decision_key_is_what_the_model_builds(case):
    ref = case["input"]["reference"]
    identity = Identity(ref["corte"], ref["numero"], ref["anno"], ref.get("archivio"),
                        ref.get("sede"), ref.get("provvedimento"))
    assert identity.key() == case["identity"]["key"]["value"]


# --- What this API adopts of the convention (plan, PR 3a) -------------------------------

from unittest.mock import AsyncMock, patch  # noqa: E402

from visualex_api.tools.norma import Norma, NormaVisitata  # noqa: E402
from visualex_api.tools.sources import cite_article, eu_identity, normalize_norm_urn  # noqa: E402

_ALIASED = [c for c in GOLDEN["norms"] if "aliases" in c["identity"]]
_EU = [c for c in GOLDEN["norms"] if str(c["identity"].get("article", {}).get("value") or "").startswith("celex:")]
_CITED = [c for c in GOLDEN["norms"] if c["labels"].get("citation", {}).get("status") == "decided"]
_NATIONAL = [c for c in GOLDEN["norms"]
             if c not in _EU and c["identity"].get("article", {}).get("value")]


@pytest.mark.parametrize("case", _ALIASED, ids=[c["id"] for c in _ALIASED])
def test_every_spelling_of_a_norm_normalises_to_its_identity(case):
    for alias in case["identity"]["aliases"]["value"]:
        assert normalize_norm_urn(alias) == case["identity"]["article"]["value"], alias


@pytest.mark.parametrize("case", _NATIONAL, ids=[c["id"] for c in _NATIONAL])
def test_an_identity_is_already_normal(case):
    identity = case["identity"]["article"]["value"]
    assert normalize_norm_urn(identity) == identity


def test_what_is_not_a_norm_comes_back_as_it_is():
    for value in ("cassazione:civile:31310:2024", "massima_cassazione_civile_31191_2025", "", "concetto:buona_fede",
                  "see urn:nir:stato:legge:1990-08-07;241 and more", "xurn:nir:foo", "urn:nir:"):
        assert normalize_norm_urn(value) == value


def test_a_year_only_urn_is_no_identity_and_comes_back_as_it_is():
    for value in ("urn:nir:stato:legge:1983;184", "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1983;184~art6"):
        assert normalize_norm_urn(value) == value


def test_the_doubled_url_generate_urn_used_to_write_names_the_inner_act():
    doubled = ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:/uri-res/N2Ls?urn:nir:"
               "ministero.sviluppo.economico:decreto:2010-01-13;33~art1")
    assert normalize_norm_urn(doubled) == \
        "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.ministeriale:2010-01-13;33~art1"


def test_authority_type_and_article_are_lower_case_the_annex_keeps_its_case():
    assert normalize_norm_urn("URN:NIR:STATO:LEGGE:1990-08-07;241~ART2") == \
        "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art2"
    assert normalize_norm_urn("urn:nir:stato:decreto.legislativo:2008-04-09;81:A~art1") == \
        "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2008-04-09;81:A~art1"


@pytest.mark.parametrize("case", _EU, ids=[c["id"] for c in _EU])
def test_an_eu_article_is_identified_by_its_celex(case):
    n = case["input"]
    assert eu_identity(n["tipo_atto"], n.get("data"), n.get("numero_atto")) == case["identity"]["act"]["value"]
    assert eu_identity(n["tipo_atto"], n.get("data"), n.get("numero_atto"), n["numero_articolo"]) \
        == case["identity"]["article"]["value"]


@pytest.mark.parametrize("case", _NATIONAL, ids=[c["id"] for c in _NATIONAL])
def test_no_urn_names_a_missing_number(case):
    n = case["input"]
    urn = generate_urn(n["tipo_atto"], n.get("data"), n.get("numero_atto"), n["numero_articolo"], n.get("allegato"))
    assert "None" not in urn
    assert urn.count("uri-res") == 1, urn


@pytest.mark.parametrize("case", _CITED, ids=[c["id"] for c in _CITED])
def test_a_decided_citation_is_what_cite_article_writes(case):
    assert cite_article(case["input"]) == case["labels"]["citation"]["value"]


def test_cite_article_never_invents_a_part():
    assert cite_article({"tipo_atto": "legge", "numero_articolo": "3"}) == "art. 3, l."
    assert "None" not in cite_article({"tipo_atto": "legge", "numero_atto": None, "data": None, "numero_articolo": "3"})


@pytest.mark.asyncio
async def test_parse_query_displays_the_citation():
    from app import NormaController

    controller = NormaController()
    nv = NormaVisitata(norma=Norma(tipo_atto="legge", data="1990-08-07", numero_atto="241"), numero_articolo="2")
    with patch.object(controller, "create_norma_visitata_from_data", AsyncMock(return_value=[nv])):
        response = await controller.app.test_client().post("/parse_query", json={"query": "art. 2 l. 241/1990"})
    body = await response.get_json()
    assert body["recognized"] is True
    assert body["display"] == "art. 2, l. 7 agosto 1990, n. 241"


async def _display(query: str, nv) -> str:
    from app import NormaController

    controller = NormaController()
    with patch.object(controller, "create_norma_visitata_from_data", AsyncMock(return_value=[nv])):
        response = await controller.app.test_client().post("/parse_query", json={"query": query})
    return (await response.get_json())["display"]


_CC = Norma(tipo_atto="codice civile", data="1942-03-16", numero_atto="262", tipo_atto_reale="regio decreto")


@pytest.mark.asyncio
async def test_parse_query_names_the_act_alone_when_no_article_is_asked():
    # The NormaVisitata carries article 1 only as the probe the URN needs.
    assert await _display("codice civile", NormaVisitata(norma=_CC, numero_articolo="1", allegato="2")) == "c.c."


@pytest.mark.asyncio
async def test_parse_query_writes_artt_for_a_list_or_a_range():
    nv = NormaVisitata(norma=_CC, numero_articolo="1453", allegato="2")
    assert await _display("art 1453-1455 cc", nv) == "artt. 1453-1455 c.c."
    assert await _display("art 1453,1454 cc", nv) == "artt. 1453, 1454 c.c."
    assert await _display("art 2645-bis cc", nv) == "art. 2645-bis c.c."


# --- EU acts before 2015 (G-540) -----------------------------------------------------------------

from visualex_api.tools.sources import cite_act  # noqa: E402


@pytest.mark.parametrize("kind,number,date,act", [
    # A full date tells the Community at the boundaries: Maastricht (1 November 1993), Lisbon (1 December 2009).
    ("direttiva ue", "104", "1993-11-23", "dir. 93/104/CE"),
    ("direttiva ue", "13", "1993-04-05", "dir. 93/13/CEE"),
    ("regolamento ue", "1007", "2009-09-16", "reg. (CE) n. 1007/2009"),
    ("regolamento ue", "1259", "2010-12-20", "reg. (UE) n. 1259/2010"),
    # The full date decides where the year alone would not: December 2009 after Lisbon is UE.
    ("regolamento ue", "1286", "2009-12-22", "reg. (UE) n. 1286/2009"),
    # The year in four digits from 1999, two before.
    ("direttiva ue", "44", "1999", "dir. 1999/44/CE"),
    ("direttiva ue", "34", "1998", "dir. 98/34/CE"),
    # A year alone: 1993 reads as CEE, 2009 as CE, the year's most acts.
    ("direttiva ue", "13", "1993", "dir. 93/13/CEE"),
    ("regolamento ue", "1007", "2009", "reg. (CE) n. 1007/2009"),
    # From 2015 the year comes first, and nothing else changes.
    ("regolamento ue", "1", "2015", "reg. (UE) 2015/1"),
    # A year that is not one names the kind alone, as before.
    ("regolamento ue", "679", "", "reg. (UE)"),
])
def test_an_eu_act_is_cited_as_the_official_journal_numbered_it(kind, number, date, act):
    assert cite_act({"tipo_atto": kind, "numero_atto": number, "data": date}) == act


# --- Recitals (spec docs/superpowers/specs/2026-11-17-eu-recitals-design.md §2) -----------------

from visualex_api.tools.sources import cite_recital  # noqa: E402

_RECITALS = GOLDEN["recitals"]
_RECITALS_CITED = [c for c in _RECITALS if "citation" in c["labels"]]


def test_the_recitals_section_has_its_cases():
    assert {c["id"] for c in _RECITALS} >= {"gdpr-cons-26", "nis2-cons-1", "eprivacy-cons-2"}


@pytest.mark.parametrize("case", _RECITALS, ids=[c["id"] for c in _RECITALS])
def test_a_recitals_identity_is_its_acts_celex_with_rct(case):
    n = case["input"]
    assert eu_identity(n["tipo_atto"], n["data"], n["numero_atto"]) == case["identity"]["act"]["value"]
    assert eu_identity(n["tipo_atto"], n["data"], n["numero_atto"], considerando=n["considerando"]) == (
        case["identity"]["recital"]["value"])


@pytest.mark.parametrize("case", _RECITALS_CITED, ids=[c["id"] for c in _RECITALS_CITED])
def test_a_recitals_citation_is_the_conventions(case):
    assert cite_recital(case["input"]) == case["labels"]["citation"]["value"]


def test_an_article_and_a_recital_together_are_no_one_thing():
    with pytest.raises(ValueError):
        eu_identity("regolamento ue", "2016", "679", "5", "26")


def test_a_treaty_has_no_recital_identity():
    assert eu_identity("TFUE", None, None, considerando="1") is None


@pytest.mark.parametrize("spec,words", [
    ("26,27", "considerando 26 e 27, reg. (UE) 2016/679"),
    ("26,27,30", "considerando 26, 27 e 30, reg. (UE) 2016/679"),
    ("26-30", "considerando 26-30, reg. (UE) 2016/679"),
])
def test_a_list_or_a_range_of_recitals_is_cited_with_the_word_once(spec, words):
    assert cite_recital({"tipo_atto": "regolamento ue", "numero_atto": "679", "data": "2016", "considerando": spec}) == words


def test_only_an_eu_regulation_or_directive_has_recitals():
    with pytest.raises(ValueError):
        cite_recital({"tipo_atto": "legge", "numero_atto": "241", "data": "1990-08-07", "considerando": "3"})
