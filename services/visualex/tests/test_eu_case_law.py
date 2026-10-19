"""POST /search_eu_case_law: the Union's decisions that cite an article (design 2026-10-12 §D1).

The CELLAR endpoint is never reached: the HTTP client or the query function is replaced. The
real source is read by hand when the TTL is measured (see the PR's report).
"""
import asyncio
import json
import re

import pytest

from app import NormaController
from visualex_api.services.decisions import eu_case_law
from visualex_api.services.decisions.eu_case_law import (
    ROW_LIMIT,
    decisions_from_sparql,
    search_eu_case_law,
    sparql_query,
    validate,
)
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import NetworkError

TYPE = "http://publications.europa.eu/resource/authority/resource-type/"


def _row(celex, type_name="JUDG", day="2024-05-02", ecli="ECLI:EU:C:2024:1"):
    row = {"celex": {"value": celex}, "date": {"value": day},
           "type": {"type": "uri", "value": TYPE + type_name}}
    if ecli is not None:
        row["ecli"] = {"value": ecli}
    return row


def _payload(*rows):
    return {"results": {"bindings": list(rows)}}


class DictCache:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


@pytest.fixture
def cache(monkeypatch):
    cache = DictCache()
    monkeypatch.setattr(eu_case_law, "get_cache", lambda: cache)
    return cache


def _answers(monkeypatch, payload=None, error=None):
    """Replace the query function; the list collects the SPARQL texts it was given."""
    asked = []

    async def query(sparql):
        asked.append(sparql)
        if error:
            raise error
        return payload
    monkeypatch.setattr(eu_case_law, "_query", query)
    return asked


# --- the query ----------------------------------------------------------------------------------

def _fragment_pattern(query):
    return re.search(r'REGEX\(STR\(\?fragment\), "([^"]+)"\)', query).group(1)


def test_the_query_names_the_act_the_axiom_and_the_order():
    q = sparql_query("32016R0679", "6")
    assert 'cdm:resource_legal_id_celex "32016R0679"^^<http://www.w3.org/2001/XMLSchema#string>' in q
    assert "owl:annotatedTarget ?act" in q and "owl:annotatedSource ?dec" in q
    assert "annotation:fragment_cited_target ?fragment" in q
    assert "SELECT DISTINCT" in q and "ORDER BY DESC(?date)" in q and f"LIMIT {ROW_LIMIT}" in q
    # only the three kinds of decision the answer carries
    assert q.count(TYPE) == 3
    for name in ("JUDG", "ORDER", "OPIN_AG"):
        assert f"<{TYPE}{name}>" in q


@pytest.mark.parametrize("fragment,matches", [
    ("A6", True), ("A06", True), ("A06P1", True), ("A06P1LB", True), ("A6P1L1LB", True),
    ("A06L1", True),
    ("A60", False), ("A060", False), ("A16", False), ("A006", False), ("A06A", False),
    ("A66", False), ("A6BIS", False), ("a06", False), ("XA06", False),
])
def test_the_fragment_matches_the_article_and_never_a_longer_number(fragment, matches):
    pattern = _fragment_pattern(sparql_query("32016R0679", "6"))
    assert bool(re.search(pattern, fragment)) is matches


def test_a_two_digit_article_is_not_matched_by_its_first_digit():
    pattern = _fragment_pattern(sparql_query("32016R0679", "17"))
    assert re.search(pattern, "A17P1") and re.search(pattern, "A017")
    assert not re.search(pattern, "A1") and not re.search(pattern, "A170")


@pytest.mark.parametrize("celex", [
    "32016R0679", "32011L0083", "32012R1215", "12012E/TXT", "31995L0046", "32019R2088",
])
def test_celex_of_an_act_is_accepted(celex):
    assert validate(celex, "6") == {}


@pytest.mark.parametrize("celex", [
    None, 32016, "", "  32016R0679", "32016R0679 ", '32016R0679" } #', "32016R0679\n", "3201R0679",
    "32016R067", "32016r0679", "32016R0679-20160504", "０２０１６R0679", "32016R0679'", "<x>",
    "12012E/TXTX", "12012E/tx", "12012E/",
])
def test_a_celex_that_is_not_an_act_is_refused(celex):
    assert "celex" in validate(celex, "6")


@pytest.mark.parametrize("articolo", ["6", "17", "267", "9999", 6, 267])
def test_an_article_number_is_accepted(articolo):
    assert validate("32016R0679", articolo) == {}


@pytest.mark.parametrize("articolo", [
    None, "", "0", "06", "10000", "6 ", " 6", "6a", "6-bis", "-1", 0, -5, True, 6.0, [6], {"n": 6},
    '6") } #', "6\n", "٦", "６",
])
def test_an_article_that_is_not_a_number_is_refused(articolo):
    assert "articolo" in validate("32016R0679", articolo)


def test_both_fields_are_reported_at_once():
    assert set(validate(None, None)) == {"celex", "articolo"}


def test_the_query_builder_refuses_what_validation_refuses():
    with pytest.raises(ValueError):
        sparql_query('32016R0679" ) } #', "6")
    with pytest.raises(ValueError):
        sparql_query("12012E/TXT", "267")  # well formed, but not searched
    with pytest.raises(ValueError):
        sparql_query("32016R0679", '6") } #')


# --- the mapping ----------------------------------------------------------------------------------

def test_a_judgment_of_the_court_of_justice():
    decisions, truncated = decisions_from_sparql(_payload(_row("62017CJ0496", "JUDG", "2019-01-16", "ECLI:EU:C:2019:26")))
    assert decisions == [{"corte": "corte_giustizia_ue", "causa": "C-496/17", "ecli": "ECLI:EU:C:2019:26",
                          "data": "2019-01-16", "tipo": "JUDG", "celex": "62017CJ0496",
                          "identita": {"corte": "corte_giustizia_ue", "numero": 496, "anno": 2017}}]
    assert truncated is False


def test_a_judgment_of_the_general_court():
    [d], _ = decisions_from_sparql(_payload(_row("62017TJ0612", "JUDG", "2020-03-04", "ECLI:EU:T:2020:96")))
    assert d["corte"] == "tribunale_ue" and d["causa"] == "T-612/17" and d["tipo"] == "JUDG"
    assert d["identita"] == {"corte": "tribunale_ue", "numero": 612, "anno": 2017}


def test_an_opinion_of_an_advocate_general_is_the_courts():
    [d], _ = decisions_from_sparql(_payload(_row("62021CC0077", "OPIN_AG", "2022-03-31", "ECLI:EU:C:2022:248")))
    assert d["corte"] == "corte_giustizia_ue" and d["causa"] == "C-77/21" and d["tipo"] == "OPIN_AG"
    assert d["identita"] == {"corte": "corte_giustizia_ue", "numero": 77, "anno": 2021}


def test_an_order_of_either_court():
    decisions, _ = decisions_from_sparql(_payload(
        _row("62025CO0214", "ORDER", "2026-06-10"), _row("62019TO0123", "ORDER", "2020-01-01")))
    assert [(d["corte"], d["causa"], d["tipo"]) for d in decisions] == [
        ("corte_giustizia_ue", "C-214/25", "ORDER"), ("tribunale_ue", "T-123/19", "ORDER")]


def test_a_case_before_1989_has_no_letter():
    [d], _ = decisions_from_sparql(_payload(_row("61962CJ0026", "JUDG", "1963-02-05", "ECLI:EU:C:1963:1")))
    assert d["causa"] == "26/62" and d["corte"] == "corte_giustizia_ue"
    assert d["identita"] == {"corte": "corte_giustizia_ue", "numero": 26, "anno": 1962}


def test_what_is_not_a_decision_of_a_court_in_the_table_is_dropped():
    decisions, _ = decisions_from_sparql(_payload(
        _row("62010FJ0001"),               # the Civil Service Tribunal (closed 2016): not in the court table
        _row("32016R0679"),                # a CELEX that is not a decision
        _row("62024CJ0001", "OPIN"),       # a type the answer does not carry
        _row("62024CJ0002", "NOTICE"),
        _row("not-a-celex"),
        _row(None),
        _row("62024CJ0003", "JUDG"),       # the only one kept
    ))
    assert [d["celex"] for d in decisions] == ["62024CJ0003"]


def test_a_row_that_is_not_an_object_is_skipped():
    decisions, _ = decisions_from_sparql(_payload("x", None, 3, _row("62024CJ0003")))
    assert [d["celex"] for d in decisions] == ["62024CJ0003"]


def test_a_binding_that_is_not_an_object_is_a_row_without_that_field():
    # {"celex": "62017CJ0496"} instead of {"celex": {"value": …}}: skipped, not an AttributeError
    rows = [{"celex": "62017CJ0496", "date": {"value": "2019-01-16"}, "type": {"value": TYPE + "JUDG"}},
            {"celex": {"value": "62024CJ0003"}, "date": "2024-01-01", "type": {"value": TYPE + "JUDG"},
             "ecli": ["x"]},
            _row("62024CJ0004")]
    decisions, _ = decisions_from_sparql(_payload(*rows))
    assert [d["celex"] for d in decisions] == ["62024CJ0004", "62024CJ0003"]
    assert decisions[1]["data"] is None and decisions[1]["ecli"] is None


def test_a_decision_comes_once_whatever_the_rows_and_newest_first():
    decisions, _ = decisions_from_sparql(_payload(
        _row("62020CJ0001", day="2021-01-01"),
        _row("62023CJ0002", day="2024-06-01"),
        _row("62023CJ0002", day="2024-06-01", ecli="ECLI:EU:C:2024:9"),  # the same decision, another ECLI row
        _row("62023CC0002", "OPIN_AG", day="2024-06-01"),                  # same day: the CELEX decides, stably
        _row("62022CJ0003", day="2023-02-02"),
    ))
    assert [d["celex"] for d in decisions] == ["62023CJ0002", "62023CC0002", "62022CJ0003", "62020CJ0001"]
    assert decisions[0]["ecli"] == "ECLI:EU:C:2024:1"  # the first row of a decision stands


def test_missing_ecli_and_a_date_that_is_not_a_date_are_none():
    [d], _ = decisions_from_sparql(_payload(_row("62024CJ0003", day="soon", ecli=None)))
    assert d["ecli"] is None and d["data"] is None


def test_a_decision_without_a_date_sorts_last():
    rows = [_row("62024CJ0003", day="2024-01-01"), _row("62024CJ0004", day="soon")]
    decisions, _ = decisions_from_sparql(_payload(*rows))
    assert [d["celex"] for d in decisions] == ["62024CJ0003", "62024CJ0004"]


def test_a_full_page_of_rows_is_marked_truncated():
    rows = [_row(f"62020CJ{n:04d}", day=f"2020-01-{1 + n % 28:02d}") for n in range(1, ROW_LIMIT + 1)]
    decisions, truncated = decisions_from_sparql(_payload(*rows))
    assert truncated is True and len(decisions) == ROW_LIMIT
    _, truncated = decisions_from_sparql(_payload(*rows[:-1]))
    assert truncated is False


@pytest.mark.parametrize("payload", [None, [], "x", {}, {"results": None}, {"results": {}}, {"results": {"bindings": {}}}])
def test_a_payload_that_is_not_an_answer_raises(payload):
    with pytest.raises(ValueError):
        decisions_from_sparql(payload)


def test_an_empty_answer_is_an_empty_list():
    assert decisions_from_sparql(_payload()) == ([], False)


# --- the route's logic ---------------------------------------------------------------------------

async def test_an_answer_is_listed_and_cached(cache, monkeypatch):
    asked = _answers(monkeypatch, _payload(_row("62017CJ0496", day="2019-01-16"), _row("62021CC0077", "OPIN_AG", "2022-03-31")))
    answer, status = await search_eu_case_law("32016R0679", 6)
    assert status == 200
    assert answer["esito"] == "risultati" and answer["celex"] == "32016R0679" and answer["articolo"] == "6"
    assert answer["totale"] == 2 and answer["troncato"] is False
    assert [d["celex"] for d in answer["decisioni"]] == ["62021CC0077", "62017CJ0496"]
    assert len(asked) == 1 and len(cache.data) == 1
    again, status = await search_eu_case_law("32016R0679", "6")  # the integer and the string are one key
    assert status == 200 and again == answer and len(asked) == 1


async def test_an_article_and_an_act_are_cached_apart(cache, monkeypatch):
    asked = _answers(monkeypatch, _payload())
    await search_eu_case_law("32016R0679", "6")
    await search_eu_case_law("32016R0679", "17")
    await search_eu_case_law("32011L0083", "6")
    assert len(asked) == 3 and len(cache.data) == 3


async def test_an_article_with_no_decisions_is_an_empty_list_not_an_error(cache, monkeypatch):
    _answers(monkeypatch, _payload())
    answer, status = await search_eu_case_law("32016R0679", "99")
    assert status == 200 and answer["esito"] == "risultati" and answer["totale"] == 0 and answer["decisioni"] == []


@pytest.mark.parametrize("celex", [
    "12012E/TXT",   # a treaty: the source gave no row for it, which would read as «no case law»
    "12016E/TXT", "02016R0679", "32016H0001", "52016PC0001", "62017CJ0496",
])
async def test_an_act_that_is_not_searched_is_not_supported_not_empty(cache, monkeypatch, celex):
    asked = _answers(monkeypatch, _payload())
    answer, status = await search_eu_case_law(celex, "267")
    assert status == 200 and answer == {"esito": "non_supportata"}
    assert asked == [] and cache.data == {}


@pytest.mark.parametrize("celex", ["32016R0679", "32011L0083", "32019D0001", "31995L0046"])
def test_regulations_directives_and_decisions_are_searched(celex):
    assert eu_case_law.is_searchable(celex)


async def test_a_request_that_is_not_valid_never_reaches_the_source(cache, monkeypatch):
    asked = _answers(monkeypatch, _payload())
    answer, status = await search_eu_case_law('32016R0679" } #', "6; DROP")
    assert status == 400 and answer["esito"] == "richiesta_non_valida"
    assert set(answer["errori"]) == {"celex", "articolo"}
    assert asked == [] and cache.data == {}


@pytest.mark.parametrize("error", [
    NetworkError("down", status_code=503),
    asyncio.TimeoutError(),
    ValueError("SPARQL: risposta parziale"),
    json.JSONDecodeError("bad", "x", 0),
    OSError("reset"),
])
async def test_a_source_that_fails_is_not_an_empty_list_and_is_not_cached(cache, monkeypatch, error):
    _answers(monkeypatch, error=error)
    answer, status = await search_eu_case_law("32016R0679", "6")
    assert status == 503 and answer == {"esito": "fonte_non_raggiungibile", "fonte": "curia"}
    assert cache.data == {}


async def test_an_answer_that_is_not_sparql_is_a_failure_of_the_source(cache, monkeypatch):
    _answers(monkeypatch, {"unexpected": True})
    answer, status = await search_eu_case_law("32016R0679", "6")
    assert status == 503 and answer["esito"] == "fonte_non_raggiungibile" and cache.data == {}


async def test_a_slow_endpoint_is_cut_off(cache, monkeypatch):
    async def slow(sparql):
        await asyncio.sleep(5)
    monkeypatch.setattr(eu_case_law, "_query", slow)
    monkeypatch.setattr(eu_case_law, "EU_TIMEOUT", 0.05)
    answer, status = await search_eu_case_law("32016R0679", "6")
    assert status == 503 and answer["esito"] == "fonte_non_raggiungibile" and cache.data == {}


async def test_a_failure_after_a_cached_answer_does_not_touch_it(cache, monkeypatch):
    _answers(monkeypatch, _payload(_row("62017CJ0496")))
    first, _ = await search_eu_case_law("32016R0679", "6")
    _answers(monkeypatch, error=NetworkError("down", status_code=503))
    again, status = await search_eu_case_law("32016R0679", "6")
    assert status == 200 and again == first


class BrokenCache:
    async def get(self, key):
        raise RuntimeError("disk")

    async def set(self, key, value):
        raise RuntimeError("disk")


async def test_a_broken_cache_costs_a_request_not_the_answer(monkeypatch):
    monkeypatch.setattr(eu_case_law, "get_cache", lambda: BrokenCache())
    asked = _answers(monkeypatch, _payload(_row("62017CJ0496")))
    answer, status = await search_eu_case_law("32016R0679", "6")
    assert status == 200 and answer["totale"] == 1 and len(asked) == 1


# --- the HTTP step ---------------------------------------------------------------------------------

def _http(monkeypatch, result=None, error=None):
    calls = []

    async def request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if error:
            raise error
        return result
    monkeypatch.setattr(eu_case_law.decisions_http_client, "request", request)
    return calls


async def test_the_query_goes_to_cellar_with_an_honest_identity(monkeypatch):
    calls = _http(monkeypatch, HttpResult(json.dumps(_payload()), 200, {"Content-Type": "application/sparql-results+json"}))
    assert await eu_case_law._query("SELECT 1") == _payload()
    [(method, url, kwargs)] = calls
    assert method == "GET" and url == "https://publications.europa.eu/webapi/rdf/sparql"
    assert kwargs["params"] == {"query": "SELECT 1"}
    assert kwargs["headers"]["User-Agent"].startswith("VisuaLex/")
    assert kwargs["headers"]["Accept"] == "application/sparql-results+json"


async def test_a_partial_answer_of_the_endpoint_is_refused(monkeypatch):
    # Virtuoso's «anytime» answer: cut short by its own timeout, possibly empty
    _http(monkeypatch, HttpResult(json.dumps(_payload()), 200, {"X-SQL-State": "S1T00"}))
    with pytest.raises(ValueError):
        await eu_case_law._query("SELECT 1")


async def test_a_body_that_is_not_json_is_refused(monkeypatch):
    _http(monkeypatch, HttpResult("<html>challenge</html>", 200, {}))
    with pytest.raises(ValueError):
        await eu_case_law._query("SELECT 1")


# --- the HTTP route ----------------------------------------------------------------------------------

@pytest.fixture
def client():
    return NormaController().app.test_client()


async def test_the_route_answers_a_list(client, cache, monkeypatch):
    _answers(monkeypatch, _payload(_row("62017CJ0496", day="2019-01-16")))
    resp = await client.post("/search_eu_case_law", json={"celex": "32016R0679", "articolo": "6"})
    assert resp.status_code == 200
    body = await resp.get_json()
    assert body["esito"] == "risultati" and body["decisioni"][0]["causa"] == "C-496/17"
    assert set(body["decisioni"][0]) == {"corte", "causa", "ecli", "data", "tipo", "celex", "identita"}
    assert body["decisioni"][0]["identita"] == {"corte": "corte_giustizia_ue", "numero": 496, "anno": 2017}


async def test_the_route_says_a_treaty_is_not_supported(client, cache, monkeypatch):
    asked = _answers(monkeypatch, _payload())
    resp = await client.post("/search_eu_case_law", json={"celex": "12012E/TXT", "articolo": "267"})
    assert resp.status_code == 200 and await resp.get_json() == {"esito": "non_supportata"}
    assert asked == []


@pytest.mark.parametrize("payload", [None, [], "x", 3])
async def test_the_route_refuses_a_body_that_is_not_an_object(client, cache, monkeypatch, payload):
    asked = _answers(monkeypatch, _payload())
    resp = await client.post("/search_eu_case_law", json=payload)
    assert resp.status_code == 400
    assert (await resp.get_json())["esito"] == "richiesta_non_valida" and asked == []


async def test_the_route_refuses_a_body_that_is_not_json(client, cache, monkeypatch):
    asked = _answers(monkeypatch, _payload())
    resp = await client.post("/search_eu_case_law", data="celex=32016R0679", headers={"Content-Type": "text/plain"})
    assert resp.status_code == 400 and asked == []


async def test_the_route_names_the_bad_fields(client, cache, monkeypatch):
    _answers(monkeypatch, _payload())
    resp = await client.post("/search_eu_case_law", json={"celex": "x", "articolo": 6})
    assert resp.status_code == 400
    assert set((await resp.get_json())["errori"]) == {"celex"}


async def test_the_route_says_the_source_is_unreachable(client, cache, monkeypatch):
    _answers(monkeypatch, error=NetworkError("down", status_code=503))
    resp = await client.post("/search_eu_case_law", json={"celex": "32016R0679", "articolo": "6"})
    assert resp.status_code == 503
    assert await resp.get_json() == {"esito": "fonte_non_raggiungibile", "fonte": "curia"}


async def test_a_bug_is_a_fixed_body_not_the_exceptions_text(client, monkeypatch):
    async def boom(celex, articolo):
        raise RuntimeError("secret detail")
    monkeypatch.setattr("app.search_eu_case_law_route", boom)
    resp = await client.post("/search_eu_case_law", json={"celex": "32016R0679", "articolo": "6"})
    assert resp.status_code == 500
    assert await resp.get_json() == {"esito": "errore_interno"}


async def test_only_post_is_routed(client):
    resp = await client.get("/search_eu_case_law")
    assert resp.status_code == 405
