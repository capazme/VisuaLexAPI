"""A regional law is never read as a State law (G-577).

The parser read «l.r. 65/2014», «legge regionale 12 marzo 2015, n. 3» or «L. 65/2014 (Toscana)»
as the State's legge of that number, and «l. reg. 3/2015» as a regulation of the Union. Every
form below is refused by the search's reading, and no address is built for a regional act type.
The forms are mcp-legal-it's (pull request 191, LI-086), where a review looked for the spellings
of «legge» the State's patterns take.
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
from visualex_api.tools.regional_law import REGIONAL_LAW_REFUSAL, cites_regional_law, is_regional_act_type

REGIONAL = [
    "l.r. Toscana 65/2014",
    "l.r. 65/2014",
    "L.R. n. 3/2015",
    "l. r. 65/2014",
    "LR 65/2014",
    "L.R.T. 65/2014",
    "legge regionale 12 marzo 2015, n. 3",
    "legge regionale n. 3/2015",
    "legge reg. Lazio 3/2015",
    "legge regionale Lombardia 12 marzo 2015, n. 3",
    "legge della Regione Toscana 10 novembre 2014, n. 65",
    "legge Regione Toscana 65/2014",
    "legge regione lombardia 12/2005",
    "legge 10 novembre 2014, n. 65 della Regione Toscana",
    "legge 65/2014 della Regione Toscana",
    "legge 65/2014 (Regione Toscana)",
    "legge 10 novembre 2014, n. 65 (Toscana)",
    "legge 65/2014 della Toscana",
    "legge 3/2015 della Regione autonoma della Sardegna",
    "L.R. Toscana n. 65 del 10 novembre 2014",
    "della l.r. Toscana 65/2014",
    "L. 65/2014 della Regione Toscana",
    "L. 65/2014 (Regione Toscana)",
    "l. n. 65/2014 Regione Toscana",
    "L. 65/2014 Toscana",
    "l. 10 novembre 2014, n. 65 Regione Toscana",
    "legge 65/2014 Reg. Toscana",
    "legge 65/2014 R. Toscana",
    "L 65/2014 Regione Toscana",
    "L.65/2014 Regione Toscana",
    "legge n. 65 del 2014 della Regione Toscana",
    "l. Regione Toscana 65/2014",
    "l. reg. 3/2015",
    "legge reg. 3/2015",
    # Found by the review of this PR: missing from mcp-legal-it's forms as well.
    "l. regionale 3/2015",
    "L. Regionale n. 3/2015",
    "legge reg.le 3/2015",
    "legge Toscana 65/2014",
    "legge Emilia-Romagna 24/2017",
]
STATE = ["legge 65/2014", "L. 65/2014", "legge 10 novembre 2014, n. 65", "legge 241/1990", "l. 3/2015",
         "L 241/1990", "L.241/1990", "legge 241/1990, che si applica alle regioni"]
LOOK_ALIKE = ["legge costituzionale 3/2001", "legge fallimentare", "LRT", "lrt", "regolamento (UE) 2016/679",
              "art. 1 reg. ue 2016/679", "s.r.l. 3/2020", "statuto della regione siciliana", "art. 117 cost.",
              # «reg.» after a State law is a regulation or a register unless a Region follows.
              "art. 5 l. 241/1990 reg. UE 2016/679", "art. 1 l. 449/1997 reg. imprese", "legge regolamento"]


@pytest.mark.parametrize("name", REGIONAL)
def test_a_regional_law_is_recognised_as_one(name):
    assert cites_regional_law(name)
    assert cites_regional_law(f"art. 3 {name}")


@pytest.mark.parametrize("query", REGIONAL + [f"art. 3 {name}" for name in REGIONAL])
def test_the_search_refuses_it_and_reads_no_state_law(query):
    assert read_norm_query(query) == ({"refusal": "regional_law"}, "regional")
    assert parse_nl_query(query) is None
    assert resolve_alias(query) is None
    assert resolve_atto(query) is None


def test_a_recital_of_a_regional_law_is_the_regional_refusal():
    assert read_norm_query("considerando 3 l.r. 65/2014") == ({"refusal": "regional_law"}, "regional")


@pytest.mark.parametrize("name", STATE)
def test_the_state_laws_still_read(name):
    assert not cites_regional_law(name)
    params, _ = read_norm_query(f"art. 3 {name}")
    assert params["act_type"] == "legge" and params["article"] == "3"


@pytest.mark.parametrize("name", LOOK_ALIKE)
def test_names_that_only_look_alike_are_not_regional(name):
    assert not cites_regional_law(name)


@pytest.mark.parametrize("act_type,regional", [
    ("legge regionale", True), ("l.r.", True), ("L.R.", True), ("regione.toscana:legge", True),
    ("urn:nir:regione.toscana:legge", True), ("legge della regione toscana", True),
    ("legge", False), ("regio decreto", False), ("regolamento ue", False), ("decreto legislativo", False),
    (None, False), ("", False),
])
def test_a_regional_act_type(act_type, regional):
    assert is_regional_act_type(act_type) is regional


@pytest.mark.parametrize("text", [" " * 100_000, "l" + " " * 100_000 + "x", "legge 1/2000" + " " * 100_000 + "x",
                                  "l. 10 novembre 2014," + " ," * 50_000, "legge regione" * 10_000, "l " * 50_000,
                                  "legge 65/2014 della " * 5_000])
def test_a_long_query_is_read_in_linear_time(text):
    # /parse_query has no length limit and reads this first.
    started = time.perf_counter()
    cites_regional_law(text)
    assert time.perf_counter() - started < 0.5


# --- The citations in a text (/extract_citations, read by MERL-T) -------------------------------

TEXT = ("Ai sensi dell'art. 3 della l.r. Toscana 65/2014 e dell'art. 2 della legge regionale 12 marzo 2015, "
        "n. 3. Vedi anche l'art. 4 della legge 10 novembre 2014, n. 65 della Regione Toscana. E l'art. 5 "
        "l. 241/1990, l'art. 3 L. 65/2014 (Toscana), l'art. 1 legge Toscana 65/2014. Poi l'art. 9.")


def test_no_citation_in_a_text_reads_a_regional_law_as_a_state_one():
    found = [(c.display_text, c.act_type, c.act_number) for c in extract_citations(TEXT)]
    assert found == [("art. 5 l. 241/1990", "legge", "241"), ("art. 9", None, None)]


def test_a_bare_article_after_a_regional_law_does_not_fall_to_the_act_before_it():
    text = "Visto l'art. 5 l. 241/1990 e l'art. 2 della l.r. 3/2015, l'art. 4 si applica; l'art. 6 l. 241/1990."
    found = [(c.display_text, c.act_number) for c in extract_citations(text)]
    assert found == [("art. 5 l. 241/1990", "241"), ("art. 4", None), ("art. 6 l. 241/1990", "241")]


DLGS_152 = ("d.lgs. 152/2006", "decreto legislativo", "152")


@pytest.mark.parametrize("text,context,expected", [
    ("Visto il d.lgs. 152/2006. Gli artt. 3 e 4 della l.r. Toscana 65/2014 si applicano.", None, [DLGS_152]),
    ("Visto il d.lgs. 152/2006 e gli articoli 3 e 4 della legge 65/2014 della Regione Toscana.", None, [DLGS_152]),
    # MERL-T's ingestion passes the act being read: a bare article after the regional law is no one's.
    ("Art. 4 bis della L.R. 3/2015 e art. 7", "decreto legislativo", [("art. 7", None, None)]),
])
def test_a_list_or_a_suffixed_article_before_a_regional_law_is_not_the_state_acts(text, context, expected):
    # The second review of this PR: the article before the regional law was left bare, and took the
    # act named before it, or the act being read.
    found = [(c.display_text, c.act_type, c.act_number) for c in extract_citations(text, context_act_type=context)]
    assert found == expected


def test_a_long_text_with_regional_laws_is_read_in_linear_time():
    started = time.perf_counter()
    extract_citations("art. 3 della l.r. 65/2014 e art. 5 l. 241/1990. " * 5_000)
    assert time.perf_counter() - started < 2


# --- The routes ---------------------------------------------------------------------------------

@pytest.fixture
def controller():
    return NormaController()


async def test_parse_query_refuses_it_with_no_reading(controller):
    response = await controller.app.test_client().post("/parse_query", json={"query": "art. 3 l.r. Toscana 65/2014"})
    assert await response.get_json() == {"parsed": None, "recognized": False, "identifies_act": False,
                                         "refusal": "regional_law"}


async def test_the_batch_answers_it_as_not_recognised(controller):
    response = await controller.app.test_client().post(
        "/parse_query_batch", json={"queries": ["art. 3 legge 65/2014 della Regione Toscana", "art. 3 l. 65/2014"]})
    regional, state = (await response.get_json())["results"]
    assert regional == {"recognized": False, "parsed": None, "source": None, "identifies_act": False}
    assert state["parsed"]["act_type"] == "legge"


async def test_the_fetch_refuses_a_regional_act_type_before_any_request(controller):
    with patch("visualex_api.tools.urngenerator.lookup_year", new=AsyncMock(side_effect=AssertionError("no request"))):
        response = await controller.app.test_client().post("/fetch_norma_data", json={
            "act_type": "legge regionale", "act_number": "65", "date": "2014-11-10", "article": "3"})
    assert response.status_code == 400
    assert REGIONAL_LAW_REFUSAL in str(await response.get_json())


async def test_a_link_to_a_regional_law_is_not_linkable_with_no_request(controller):
    failing = AsyncMock(side_effect=AssertionError("no request"))
    with patch("app.get_tree", new=failing), patch("visualex_api.tools.urngenerator.lookup_year", new=failing):
        response = await controller.app.test_client().post("/fetch_norm_links", json={"norms": [
            {"act_type": "legge regionale", "act_number": "65", "date": "2014-11-10", "article": "3"}]})
    assert (await response.get_json())["results"] == [{"href": None, "reason": "not_linkable"}]


def test_the_server_says_the_same_sentence():
    # apps/server answers a reference to a regional law with the API's sentence (resolveReference.ts).
    for directory in Path(__file__).resolve().parents:
        source = directory / "apps" / "server" / "src" / "norms" / "resolveReference.ts"
        if source.is_file():
            assert f"'{REGIONAL_LAW_REFUSAL}'" in source.read_text(encoding="utf-8")
            return
    pytest.skip("apps/server is not beside this API")
