"""POST /fetch_norm_links: the source's address of each norm, for the links of a filing, null
with a reason instead of any guess (design docs/superpowers/specs/2026-10-31-document-hyperlinks-design.md
§3.1). The logging test, with the network faked at the HTTP layer, is test_fetch_norm_links_logs.py.
"""
import asyncio
import json
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

import app as app_module
from app import NormaController

pytestmark = pytest.mark.asyncio

TODAY = date(2026, 10, 31)
CODE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262"
L241 = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"


def _tree(entries, annexes=None):
    """get_tree's (articles, count, metadata) for `entries` [(article, annex or None)]."""
    parts = {}
    for number, annex in entries:
        parts.setdefault(annex, []).append(number)
    metadata = {"annexes": [
        {"number": annex, "label": "", "article_count": len(numbers), "article_numbers": numbers}
        for annex, numbers in (annexes or parts).items()
    ]}
    return ([{"numero": n, "allegato": a} for n, a in entries], len(entries), metadata)


@pytest.fixture
def controller():
    with patch.object(app_module, "today_in_rome", return_value=TODAY):
        yield NormaController()


async def _post(controller, body, raw=None):
    client = controller.app.test_client()
    if raw is not None:
        response = await client.post("/fetch_norm_links", data=raw, headers={"Content-Type": "application/json"})
    else:
        response = await client.post("/fetch_norm_links", json=body)
    return response.status_code, await response.get_json()


async def _links(controller, norms, tree=None, pin_day=None, date_lookup=None):
    """The results for `norms`, with get_tree answering `tree` (a value, or a function of the
    act's URL) and the year lookup answering `date_lookup` (the year itself by default)."""
    body = {"norms": norms}
    if pin_day is not None:
        body["pin_day"] = pin_day

    async def fake_tree(url, *args, **kwargs):
        value = tree(url) if callable(tree) else tree
        if isinstance(value, Exception):
            raise value
        return value

    async def fake_complete_year(act_type, year, act_number):
        return date_lookup(act_type, year, act_number) if date_lookup else year

    with patch("app.get_tree", new=AsyncMock(side_effect=fake_tree)) as get_tree, \
            patch("visualex_api.tools.urngenerator.complete_year", new=AsyncMock(side_effect=fake_complete_year)):
        status, answer = await _post(controller, body)
    assert status == 200, answer
    return answer["results"], get_tree


# --- the answer -------------------------------------------------------------------------


async def test_a_code_links_its_annex_with_todays_day(controller):
    results, _ = await _links(controller, [{"act_type": "codice civile", "article": "2043"}],
                              tree=_tree([("2043", "2"), ("1", None)]))
    assert results == [{"href": f"{CODE}:2~art2043!vig=2026-10-31", "reason": "ok"}]


async def test_pin_day_fixes_the_text_in_force_to_that_day(controller):
    results, _ = await _links(controller, [{"act_type": "codice civile", "article": "2043"}],
                              tree=_tree([("2043", "2")]), pin_day="2026-09-01")
    assert results[0]["href"].endswith("~art2043!vig=2026-09-01")


async def test_a_full_date_links_the_act_text_with_the_act_spelling(controller):
    # «21-novies» asked, the act spells «21 nonies»: the address is the act's.
    norm = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "21-novies"}
    results, _ = await _links(controller, [norm], tree=_tree([("21 nonies", None), ("1", None)]))
    assert results == [{"href": f"{L241}~art21nonies!vig=2026-10-31", "reason": "ok"}]


async def test_a_year_completed_by_the_lookup_links(controller):
    norm = {"act_type": "legge", "date": "1990", "act_number": "241", "article": "3"}
    results, _ = await _links(controller, [norm], tree=_tree([("3", None)]),
                              date_lookup=lambda *_: "1990-08-07")
    assert results == [{"href": f"{L241}~art3!vig=2026-10-31", "reason": "ok"}]


async def test_a_year_the_lookup_cannot_complete_is_date_incomplete_and_no_index_is_read(controller):
    norm = {"act_type": "legge", "date": "1990", "act_number": "241", "article": "3"}
    results, get_tree = await _links(controller, [norm], tree=_tree([("3", None)]))
    assert results == [{"href": None, "reason": "date_incomplete"}]
    # The «1990-01-01» fallback is never looked up, nor sent.
    assert get_tree.await_count == 0


async def test_an_article_only_in_one_annex_links_that_annex(controller):
    norm = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "7"}
    results, _ = await _links(controller, [norm], tree=_tree([("1", None), ("7", "1")]))
    assert results == [{"href": f"{L241}:1~art7!vig=2026-10-31", "reason": "ok"}]


async def test_an_article_absent_from_the_index_is_article_missing(controller):
    norm = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "999"}
    results, _ = await _links(controller, [norm], tree=_tree([("1", None), ("2", None)]))
    assert results == [{"href": None, "reason": "article_missing"}]


async def test_a_code_article_absent_from_its_annex_is_article_missing(controller):
    results, _ = await _links(controller, [{"act_type": "codice civile", "article": "5000"}],
                              tree=_tree([("2043", "2"), ("5000", None)]))
    assert results == [{"href": None, "reason": "article_missing"}]


async def test_an_article_in_the_body_and_an_annex_is_ambiguous_never_the_body(controller):
    norm = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "1"}
    results, _ = await _links(controller, [norm], tree=_tree([("1", None), ("1", "1")]))
    assert results == [{"href": None, "reason": "ambiguous_part"}]


async def test_an_article_in_two_annexes_is_ambiguous_never_the_biggest(controller):
    norm = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "4"}
    tree = _tree([("1", None), ("4", "1"), ("4", "2"), ("5", "2")])
    results, _ = await _links(controller, [norm], tree=tree)
    assert results == [{"href": None, "reason": "ambiguous_part"}]


@pytest.mark.parametrize("annex, href", [("1", f"{L241}:1~art1!vig=2026-10-31"),
                                         ("", f"{L241}~art1!vig=2026-10-31")])
async def test_the_part_the_user_chose_links(controller, annex, href):
    norm = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "1", "annex": annex}
    results, _ = await _links(controller, [norm], tree=_tree([("1", None), ("1", "1")]))
    assert results == [{"href": href, "reason": "ok"}]


async def test_an_unreadable_index_is_source_unavailable_never_the_body(controller):
    norm = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "1"}
    for tree in ("Failed to retrieve the page", ("Failed to retrieve the page", 0, {}), RuntimeError("down")):
        with patch("app.fetch_act_index", new=AsyncMock()) as akn:
            results, _ = await _links(controller, [norm], tree=tree)
        assert results == [{"href": None, "reason": "source_unavailable"}], tree
        assert akn.await_count == 0


async def test_an_unknown_existence_in_a_code_annex_is_source_unavailable(controller):
    # The AKN index lists the act's articles without their part: not asked for a link.
    with patch("app.fetch_act_index", new=AsyncMock()) as akn:
        results, _ = await _links(controller, [{"act_type": "codice civile", "article": "2043"}],
                                  tree=("Failed to retrieve the page", 0, {}))
    assert results == [{"href": None, "reason": "source_unavailable"}]
    assert akn.await_count == 0


async def test_a_reading_that_names_no_act_or_a_range_is_not_linkable(controller):
    norms = [{"act_type": "decreto ministeriale", "article": "5"},
             {"act_type": "codice civile", "article": "1,2"}]
    results, _ = await _links(controller, norms, tree=_tree([("1", "2"), ("2", "2")]))
    assert [r["reason"] for r in results] == ["not_linkable", "not_linkable"]
    assert all(r["href"] is None for r in results)


async def test_an_eu_act_links_its_eurlex_page_when_the_article_is_in_it(controller):
    norms = [{"act_type": "regolamento ue", "date": "2016", "act_number": "679", "article": "6"},
             {"act_type": "regolamento ue", "date": "2016", "act_number": "679", "article": "400"}]
    results, _ = await _links(controller, norms, tree=([{"numero": "6"}, {"numero": "7"}], 2, {}))
    assert results == [
        {"href": "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita", "reason": "ok"},
        {"href": None, "reason": "article_missing"},
    ]


async def test_an_eu_act_eurlex_does_not_serve_is_source_unavailable(controller):
    norm = {"act_type": "direttiva ue", "date": "2019", "act_number": "9999", "article": "1"}
    results, _ = await _links(controller, [norm], tree=("Failed to retrieve the page", 0, {}))
    assert results == [{"href": None, "reason": "source_unavailable"}]


async def test_results_keep_the_order_and_a_repeated_norm_is_settled_once(controller):
    code = {"act_type": "codice civile", "article": "2043"}
    other = {"act_type": "codice civile", "article": "9999"}
    with patch.object(controller, "_norm_link", wraps=controller._norm_link) as settle:
        results, _ = await _links(controller, [code, other, code], tree=_tree([("2043", "2")]))
    assert [r["reason"] for r in results] == ["ok", "article_missing", "ok"]
    assert results[0] == results[2]
    assert settle.await_count == 2


async def test_the_budget_leaves_what_is_not_settled_source_unavailable(controller):
    slow = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "1"}
    fast = {"act_type": "codice civile", "article": "2043"}

    async def tree(url):
        if "legge" in url:
            await asyncio.sleep(5)
        return _tree([("2043", "2"), ("1", None)])

    async def fake_tree(url, *args, **kwargs):
        return await tree(url)

    with patch.object(app_module, "LINKS_BATCH_BUDGET", 0.3), \
            patch("app.get_tree", new=AsyncMock(side_effect=fake_tree)):
        status, answer = await _post(controller, {"norms": [slow, fast]})
    assert status == 200
    assert answer["results"] == [{"href": None, "reason": "source_unavailable"},
                                 {"href": f"{CODE}:2~art2043!vig=2026-10-31", "reason": "ok"}]


async def test_the_fetch_keeps_its_guess_the_link_refuses(controller):
    # One function, two routes: the fetch still goes to the body for an article in the body
    # and an annex; the link refuses it.
    data = {"act_type": "legge", "date": "1990-08-07", "act_number": "241", "article": "1"}
    with patch("app.get_tree", new=AsyncMock(return_value=_tree([("1", None), ("1", "1")]))):
        fetched = await controller.create_norma_visitata_from_data(dict(data))
        address = await controller.resolve_norm_address(dict(data), strict=True)
    assert [(nv.numero_articolo, nv.allegato) for nv in fetched] == [("1", None)]
    assert address.annex_basis == "lookup" and address.parts == {"1": [None, "1"]}


# --- the limits ---------------------------------------------------------------------------


@pytest.mark.parametrize("body, limit", [
    ({}, "non-empty list"),
    ({"norms": []}, "non-empty list"),
    ({"norms": {"act_type": "legge"}}, "non-empty list"),
    ([], "non-empty list"),
    ({"norms": [{"act_type": "codice civile", "article": "1"}] * 201}, "At most 200 norms"),
    ({"norms": ["art. 1 c.c."]}, "must be an object"),
    ({"norms": [{"act_type": "codice civile"}]}, "act_type and article"),
    ({"norms": [{"article": "1"}]}, "act_type and article"),
    ({"norms": [{"act_type": "codice civile", "article": ["1"]}]}, "article must be a string"),
    ({"norms": [{"act_type": "codice civile", "article": True}]}, "article must be a string"),
    ({"norms": [{"act_type": "codice civile", "article": "1" * 41}]}, "article at most 40"),
    ({"norms": [{"act_type": "l" * 121, "article": "1"}]}, "act_type at most 120"),
    ({"norms": [{"act_type": "legge", "date": "2000", "act_number": str(n), "article": "1"}
                for n in range(31)]}, "At most 30 distinct acts"),
    ({"norms": [{"act_type": "codice civile", "article": "1"}], "pin_day": "31/10/2026"}, "ISO day"),
    ({"norms": [{"act_type": "codice civile", "article": "1"}], "pin_day": "2026-02-30"}, "ISO day"),
    ({"norms": [{"act_type": "codice civile", "article": "1"}], "pin_day": "2026-11-01"}, "after today"),
])
async def test_the_limits_are_400s_that_name_them(controller, body, limit):
    with patch("app.get_tree", new=AsyncMock()) as get_tree:
        status, answer = await _post(controller, body)
    assert status == 400 and limit in answer["error"]
    assert get_tree.await_count == 0


async def test_thirty_acts_and_two_hundred_norms_pass(controller):
    norms = [{"act_type": "legge", "date": "2000-01-01", "act_number": str(n % 30 + 1), "article": str(n // 30 + 1)}
             for n in range(200)]
    results, _ = await _links(controller, norms, tree=_tree([("1", None)]))
    assert len(results) == 200


async def test_a_body_over_48_kb_or_not_json_is_a_400(controller):
    status, answer = await _post(controller, None, raw=b"{" + b" " * (48 * 1024) + b"}")
    assert status == 400 and "48 KB" in answer["error"]
    status, answer = await _post(controller, None, raw=b"[" * 40000)
    assert status == 400 and "JSON" in answer["error"]


async def test_an_unexpected_failure_is_a_500_with_no_message(controller):
    with patch.object(controller, "_norm_links", new=AsyncMock(side_effect=RuntimeError("legge 241/1990"))):
        status, answer = await _post(controller, {"norms": [{"act_type": "codice civile", "article": "1"}]})
    assert status == 500 and answer == {"error": "Internal error"}


async def test_the_route_is_registered_for_post_only(controller):
    rules = [r for r in controller.app.url_map.iter_rules() if r.rule == "/fetch_norm_links"]
    assert len(rules) == 1 and "POST" in rules[0].methods and "GET" not in rules[0].methods
    assert json.dumps(app_module.LINK_REASONS)  # the reasons the web reads
