"""A recital citation in the search (spec docs/superpowers/specs/2026-11-17-eu-recitals-design.md §3.2):
`read_norm_query`, `POST /parse_query` and `POST /parse_query_batch`."""
import json
from datetime import date
from pathlib import Path

import pytest

from app import NormaController
from visualex_api.services.decisions.citation import read_decision_citation
from visualex_api.tools.norm_query import read_norm_query

GDPR = {"act_type": "regolamento ue", "act_number": "679", "date": "2016"}


def _golden() -> dict:
    for directory in Path(__file__).resolve().parents:
        candidate = directory / "conventions" / "sources" / "golden.json"
        if candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise FileNotFoundError("conventions/sources/golden.json")


def _act(params):
    return {**params, "act_type": str(params["act_type"]).lower()}


@pytest.mark.parametrize("typed", [
    "considerando 26 GDPR",  # the alias path
    "cons. 26 reg. 2016/679",  # the parser path
    "considerando n. 26 del regolamento (UE) 2016/679",
    "considerando (26) GDPR",
    "GDPR, considerando 26",
])
def test_the_gdprs_recital_26(typed):
    params, source = read_norm_query(typed)
    assert _act(params) == {**GDPR, "recital": "26"}
    assert "article" not in params
    assert source in ("alias", "nl_parser")


def test_a_directive_and_a_range():
    assert _act(read_norm_query("considerando 2 direttiva 2002/58/CE")[0]) == {
        "act_type": "direttiva ue", "act_number": "58", "date": "2002", "recital": "2"}
    assert read_norm_query("considerando 26-30 GDPR")[0]["recital"] == "26-30"


def test_a_recital_of_an_italian_act_is_refused():
    params, _ = read_norm_query("considerando 3 l. 241/1990")
    assert params["refusal"] == "recital_not_eu"
    assert "article" not in params


def test_a_recital_and_an_article_together_are_refused_and_the_article_dropped():
    params, _ = read_norm_query("art. 4 e considerando 26 GDPR")
    assert params["refusal"] == "recital_with_article"
    assert "article" not in params


def test_a_recital_with_no_act_is_incomplete():
    assert read_norm_query("considerando 26") == ({"recital": "26"}, "recital")


def test_no_clause_reads_as_today():
    assert read_norm_query("art. 4 GDPR")[0]["article"] == "4"
    assert read_norm_query("considerando il contratto") == (None, None) or "recital" not in (
        read_norm_query("considerando il contratto")[0] or {})


_RECITAL_LABELS = [(c, kind) for c in _golden()["recitals"] for kind in ("citation", "short") if c["labels"].get(kind)]


@pytest.mark.parametrize("case,kind", _RECITAL_LABELS, ids=[f"{c['id']}-{k}" for c, k in _RECITAL_LABELS])
def test_every_recital_label_reads_back_to_its_recital(case, kind):
    params, _ = read_norm_query(case["labels"][kind]["value"])
    n = case["input"]
    assert _act(params) == {"act_type": n["tipo_atto"], "act_number": n["numero_atto"], "date": n["data"],
                            "recital": n["considerando"]}


# --- The routes ---------------------------------------------------------------------------------

@pytest.fixture
def controller():
    return NormaController()


async def _parse(controller, query):
    response = await controller.app.test_client().post("/parse_query", json={"query": query})
    assert response.status_code == 200
    return await response.get_json()


async def test_parse_query_answers_a_ready_recital_with_its_citation_and_no_urn(controller):
    answer = await _parse(controller, "considerando 26 GDPR")
    assert answer["recognized"] is True
    assert answer["identifies_act"] is True
    assert answer["parsed"]["recital"] == "26"
    assert "article" not in answer["parsed"]
    assert answer["display"] == "considerando 26, reg. (UE) 2016/679"
    assert answer["urn"] is None
    assert "refusal" not in answer


async def test_parse_query_answers_a_list_with_the_word_once(controller):
    answer = await _parse(controller, "considerando 26 e 27 GDPR")
    assert answer["display"] == "considerando 26 e 27, reg. (UE) 2016/679"


async def test_parse_query_answers_an_incomplete_recital(controller):
    answer = await _parse(controller, "considerando 26")
    assert answer["recognized"] is True
    assert answer["parsed"] == {"recital": "26"}
    assert answer["identifies_act"] is False
    assert answer["display"] == "considerando 26"


@pytest.mark.parametrize("query,refusal", [
    ("considerando 3 l. 241/1990", "recital_not_eu"),
    ("art. 4 e considerando 26 GDPR", "recital_with_article"),
])
async def test_parse_query_answers_a_refusal_with_no_article_no_urn_and_no_label(controller, query, refusal):
    answer = await _parse(controller, query)
    assert answer["recognized"] is True
    assert answer["refusal"] == refusal
    assert "article" not in answer["parsed"]
    assert "refusal" not in answer["parsed"]
    assert answer["urn"] is None
    assert answer["display"] is None


async def test_the_batch_answers_a_recital_as_not_recognised(controller):
    response = await controller.app.test_client().post(
        "/parse_query_batch", json={"queries": ["considerando 26 GDPR", "art. 4 e considerando 26 GDPR", "art. 4 GDPR"]})
    results = (await response.get_json())["results"]
    assert [r["recognized"] for r in results] == [False, False, True]
    assert results[0] == {"recognized": False, "parsed": None, "source": None, "identifies_act": False}


@pytest.mark.parametrize("words", ["cons. 26 GDPR", "considerando 26 GDPR"])
def test_a_recital_is_not_a_decision(words):
    assert read_decision_citation(words, date(2026, 11, 17)).to_dict() == {"non_riconosciuta": True}


def test_the_consiglio_di_stato_is_still_a_decision():
    decision = read_decision_citation("Cons. St., sez. VI, n. 2270/2019", date(2026, 11, 17))
    assert decision.riferimento["corte"] == "consiglio_di_stato"
    assert read_norm_query("Cons. St., sez. VI, n. 2270/2019")[0] is None or "recital" not in (
        read_norm_query("Cons. St., sez. VI, n. 2270/2019")[0])


@pytest.mark.parametrize("typed,article", [
    ("art. 2043 c.c. considerando 5 anni di prescrizione", "2043"),
    ("considerando 30 giorni art. 1453 cc", "1453"),
])
def test_an_article_of_an_act_with_no_recitals_reads_as_before(typed, article):
    # «considerando» is the gerund there (review of PR 1b): never a refusal that drops the article.
    params, _ = read_norm_query(typed)
    assert params["article"] == article
    assert "recital" not in params and "refusal" not in params


def test_an_article_with_no_act_beside_a_recital_is_refused():
    assert read_norm_query("art. 4 e considerando 26") == ({"recital": "26", "refusal": "recital_with_article"}, "recital")
