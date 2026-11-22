"""A law of the Province of Trento or Bolzano is never read as a State law (G-577, as regional laws
are: tests/test_regional_law.py).

«legge provinciale 9/2018», «l.p. 9/2018» or «legge 9/2018 della Provincia autonoma di Trento»
were read as the State's legge 9/2018. Every form below is refused by the search's reading with
`refusal: "provincial_law"` and its own sentence, and no address is built for a provincial act
type. The golden cases are PROVINCIAL, each alone and after an article.
"""
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.tools.act_resolver import resolve_atto
from visualex_api.tools.alias_resolver import resolve_alias
from visualex_api.tools.citation_linker import extract_citations
from visualex_api.tools.nl_parser import parse_nl_query
from visualex_api.tools.norm_query import read_norm_query
from visualex_api.tools.regional_law import (
    PROVINCIAL_LAW_REFUSAL,
    REGIONAL_LAW_REFUSAL,
    cites_provincial_law,
    local_act_type_refusal,
    local_law,
)

PROVINCIAL = [
    # The sigle
    "legge provinciale 9/2018",
    "l.p. 9/2018",
    "L.P. 9/2018",
    "l. p. 9/2018",
    "LP 9/2018",
    "l. prov. 9/2018",
    "legge prov. Trento 9/2018",
    "L. Provinciale n. 9/2018",
    "legge provinciale 9 agosto 2018, n. 9",
    "legge provinciale di Bolzano 10 luglio 2018, n. 9",
    "L.P. Trento n. 9 del 2018",
    "Landesgesetz vom 10. Juli 2018, Nr. 9",
    # «legge (della) Provincia …», «legge Trento …»
    "legge della Provincia autonoma di Trento 9/2018",
    "legge Provincia autonoma di Bolzano 9/2018",
    "legge Trento 9/2018",
    "legge Bolzano 9/2018",
    # The State's spelling followed by the Province
    "legge 9/2018 della Provincia autonoma di Trento",
    "legge 9 agosto 2018, n. 9 della Provincia autonoma di Bolzano",
    "legge 9/2018 (Trento)",
    "L. 9/2018 (Bolzano)",
    "legge 9/2018 Prov. Bolzano",
    "legge 9/2018 P.A. Trento",
    "legge 9/2018 della Provincia di Bolzano",
    "legge 9/2018 Alto Adige",
    "legge 9/2018 Bolzano - Alto Adige",
    "l. 9/2018 provincia autonoma di Trento",
    # Found by the review of this PR
    "legge 9/2018 Prov. aut. Trento",
    "legge 9/2018 della Prov. aut. di Trento",
    "legge 9 agosto 2018 n. 9 Prov. aut. Trento",
    "legge 9/2018 P.A.T.",
    "l. 9/2018 P.A.B.",
    "legge 9/2018 della PAT",
    "legge 9 agosto 2018 n. 9 della P.A.T.",
    "legge P.A.T. 9/2018",
    "legge prov.le 9/2018",
    "legge prov.le Trento 9/2018",
]
STATE = ["legge 9/2018", "l. 9/2018", "legge 56/2014", "legge 56/2014 sulle province", "L. 241/1990"]
LOOK_ALIKE = ["legge provvedimento", "art. 1 l. pres.", "art. 1 l. 241/1990 provvedimenti", "d.lgs. 267/2000",
              "legge costituzionale 3/2001", "legge fallimentare",
              # «P.A.» alone is the public administration; «pa», «patente» are words.
              "legge 241/1990 P.A.", "legge 241/1990 pa", "legge 241/1990 patente"]


@pytest.mark.parametrize("query", PROVINCIAL + [f"art. 3 {name}" for name in PROVINCIAL])
def test_the_search_refuses_it_as_a_provincial_law(query):
    assert cites_provincial_law(query)
    assert local_law(query) == "provincial_law"
    assert read_norm_query(query) == ({"refusal": "provincial_law"}, "provincial")
    assert parse_nl_query(query) is None
    assert resolve_alias(query) is None
    assert resolve_atto(query) is None


@pytest.mark.parametrize("name", STATE)
def test_the_state_laws_still_read(name):
    assert local_law(name) is None
    params, _ = read_norm_query(f"art. 3 {name}")
    assert params["act_type"] == "legge" and params["article"] == "3"


@pytest.mark.parametrize("name", LOOK_ALIKE)
def test_names_that_only_look_alike_are_not_provincial(name):
    assert not cites_provincial_law(name)


@pytest.mark.parametrize("name", ["l.r. 65/2014", "legge regionale Trentino-Alto Adige 3/2015",
                                  "legge 65/2014 della Regione Toscana"])
def test_a_regional_law_keeps_its_own_refusal(name):
    assert local_law(name) == "regional_law"


@pytest.mark.parametrize("act_type,sentence", [
    ("legge provinciale", PROVINCIAL_LAW_REFUSAL), ("l.p.", PROVINCIAL_LAW_REFUSAL),
    ("provincia.autonoma.trento:legge", PROVINCIAL_LAW_REFUSAL), ("urn:nir:provincia.autonoma.bolzano:legge", PROVINCIAL_LAW_REFUSAL),
    ("legge regionale", REGIONAL_LAW_REFUSAL), ("regione.toscana:legge", REGIONAL_LAW_REFUSAL),
    ("legge", None), ("regio decreto", None), ("decreto legislativo", None), (None, None), ("", None),
])
def test_a_local_act_type_is_refused_with_its_kinds_sentence(act_type, sentence):
    assert local_act_type_refusal(act_type) == sentence


@pytest.mark.parametrize("text", [" " * 100_000, "l" + " " * 100_000 + "x", "l " * 50_000, "legge prov" * 20_000,
                                  "legge 9/2018 della " * 5_000, "legge 1/2000" + " " * 100_000 + "x"])
def test_a_long_query_is_read_in_linear_time(text):
    # The provincial pattern alone, as test_regional_law.py times the regional one.
    started = time.perf_counter()
    cites_provincial_law(text)
    assert time.perf_counter() - started < 0.5


# --- The citations in a text (/extract_citations) -------------------------------------------------

def test_no_citation_in_a_text_reads_a_provincial_law_as_a_state_one():
    text = ("Visto il d.lgs. 152/2006, l'art. 2 della l.p. 9/2018, gli artt. 3 e 4 della legge 9/2018 della "
            "Provincia autonoma di Trento e l'art. 5 della legge provinciale di Bolzano 10 luglio 2018, n. 9. "
            "Poi l'art. 6 e l'art. 7 l. 241/1990.")
    found = [(c.display_text, c.act_type, c.act_number) for c in extract_citations(text)]
    assert found == [("d.lgs. 152/2006", "decreto legislativo", "152"), ("art. 6", None, None),
                     ("art. 7 l. 241/1990", "legge", "241")]


# --- The routes ---------------------------------------------------------------------------------

@pytest.fixture
def controller():
    return NormaController()


async def test_parse_query_refuses_it_with_no_reading(controller):
    response = await controller.app.test_client().post("/parse_query", json={"query": "art. 3 l.p. 9/2018"})
    assert await response.get_json() == {"parsed": None, "recognized": False, "identifies_act": False,
                                         "refusal": "provincial_law"}


async def test_the_batch_answers_it_as_not_recognised(controller):
    response = await controller.app.test_client().post(
        "/parse_query_batch", json={"queries": ["art. 3 legge 9/2018 della Provincia autonoma di Trento", "art. 3 l. 9/2018"]})
    provincial, state = (await response.get_json())["results"]
    assert provincial == {"recognized": False, "parsed": None, "source": None, "identifies_act": False}
    assert state["parsed"]["act_type"] == "legge"


async def test_the_fetch_refuses_a_provincial_act_type_with_its_sentence(controller):
    with patch("visualex_api.tools.urngenerator.lookup_year", new=AsyncMock(side_effect=AssertionError("no request"))):
        response = await controller.app.test_client().post("/fetch_norma_data", json={
            "act_type": "legge provinciale", "act_number": "9", "date": "2018-08-09", "article": "3"})
    assert response.status_code == 400
    body = str(await response.get_json())
    assert PROVINCIAL_LAW_REFUSAL in body and REGIONAL_LAW_REFUSAL not in body


async def test_a_link_to_a_provincial_law_is_not_linkable_with_no_request(controller):
    failing = AsyncMock(side_effect=AssertionError("no request"))
    with patch("app.get_tree", new=failing), patch("visualex_api.tools.urngenerator.lookup_year", new=failing):
        response = await controller.app.test_client().post("/fetch_norm_links", json={"norms": [
            {"act_type": "legge provinciale", "act_number": "9", "date": "2018-08-09", "article": "3"}]})
    assert (await response.get_json())["results"] == [{"href": None, "reason": "not_linkable"}]


def test_the_server_says_the_same_sentence():
    # apps/server answers a reference to a provincial law with the API's sentence (resolveReference.ts).
    for directory in Path(__file__).resolve().parents:
        source = directory / "apps" / "server" / "src" / "norms" / "resolveReference.ts"
        if source.is_file():
            assert f"'{PROVINCIAL_LAW_REFUSAL}'" in source.read_text(encoding="utf-8")
            return
    pytest.skip("apps/server is not beside this API")
