# services/visualex/tests/test_act_dates.py
"""Year-only URNs completed through Normattiva's resolver."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.services import act_dates
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import NetworkError, ValidationError

# The shape Normattiva gives every act page's title (measured on eight kinds, 2 Oct 2026).
PAGE = """<html><head><title>LEGGE 4 maggio 1983, n. 184 - Normattiva</title></head><body>
<p>Gazzetta Ufficiale 17 maggio 1983</p>
<h2>LEGGE 4 maggio 1983, n. 184</h2>
<p>Disciplina dell'adozione</p></body></html>"""

LEGGE_184 = "urn:nir:stato:legge:1983;184"


def page_titled(title):
    return f"<html><head><title>{title} - Normattiva</title></head><body><h2>{title}</h2></body></html>"


def ok_page(title):
    return HttpResult(text=page_titled(title), status=200, headers={})


def serve(answers):
    """A client double answering by the URN in the request: a page, or an exception to raise."""

    async def request(method, url, **kwargs):
        answer = answers[url.rsplit("?", 1)[1]]
        if isinstance(answer, Exception):
            raise answer
        return answer

    return AsyncMock(side_effect=request)


class FakeCache:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


@pytest.fixture
def cache(monkeypatch):
    fake = FakeCache()
    manager = type("M", (), {"get_persistent": lambda self, ns: fake})()
    monkeypatch.setattr(act_dates, "get_cache_manager", lambda: manager)
    return fake


@pytest.fixture
def client():
    return NormaController().app.test_client()


# kind, title (without the " - Normattiva" tail), year, number, ISO date.
EIGHT_KINDS = [
    ("legge", "LEGGE 4 maggio 1983, n. 184", "1983", "184", "1983-05-04"),
    ("decreto.legislativo", "DECRETO LEGISLATIVO 23 febbraio 2006, n. 109", "2006", "109", "2006-02-23"),
    ("decreto.legge", "DECRETO-LEGGE 4 giugno 2013, n. 61", "2013", "61", "2013-06-04"),
    (
        "decreto.del.presidente.della.repubblica",
        "DECRETO DEL PRESIDENTE DELLA REPUBBLICA 23 gennaio 1973, n. 43",
        "1973", "43", "1973-01-23",
    ),
    ("regio.decreto", "REGIO DECRETO 18 giugno 1931, n. 773", "1931", "773", "1931-06-18"),
    ("legge.costituzionale", "LEGGE COSTITUZIONALE 18 ottobre 2001, n. 3", "2001", "3", "2001-10-18"),
    ("regio.decreto.legge", "REGIO DECRETO-LEGGE 4 ottobre 1935, n. 1827", "1935", "1827", "1935-10-04"),
    ("decreto", "DECRETO 28 marzo 2003, n. 123", "2003", "123", "2003-03-28"),
    # The table's ninth entry: not among the eight measured, a synthetic title of the same shape.
    ("regio.decreto.legislativo", "REGIO DECRETO LEGISLATIVO 5 maggio 1948, n. 77", "1948", "77", "1948-05-05"),
]


class TestDateFromTitle:
    def test_reads_the_title_not_the_gazette_date(self):
        assert act_dates.date_from_title(PAGE, "legge", "1983", "184") == "1983-05-04"

    @pytest.mark.parametrize("kind,title,year,number,iso", EIGHT_KINDS)
    def test_every_kind_reads_its_own_title(self, kind, title, year, number, iso):
        assert act_dates.date_from_title(page_titled(title), kind, year, number) == iso

    def test_every_resolvable_kind_is_in_the_table_test(self):
        assert {row[0] for row in EIGHT_KINDS} == set(act_dates._TITLES)

    def test_number_must_match(self):
        assert act_dates.date_from_title(PAGE, "legge", "1983", "185") is None

    def test_year_must_match(self):
        assert act_dates.date_from_title(PAGE, "legge", "1984", "184") is None

    def test_a_longer_number_is_not_the_same_number(self):
        assert act_dates.date_from_title(page_titled("LEGGE 4 maggio 1983, n. 1841"), "legge", "1983", "184") is None

    def test_number_and_year_compare_as_integers(self):
        assert act_dates.date_from_title(PAGE, "legge", "1983", "0184") == "1983-05-04"

    def test_the_act_type_must_match(self):
        title = page_titled("DECRETO-LEGGE 19 febbraio 2001, n. 17")
        assert act_dates.date_from_title(title, "legge", "2001", "17") is None
        assert act_dates.date_from_title(title, "decreto.legge", "2001", "17") == "2001-02-19"

    def test_a_short_type_does_not_claim_a_longer_one(self):
        decree = page_titled("DECRETO LEGISLATIVO 23 febbraio 2006, n. 109")
        assert act_dates.date_from_title(decree, "decreto", "2006", "109") is None
        constitutional = page_titled("LEGGE COSTITUZIONALE 18 ottobre 2001, n. 3")
        assert act_dates.date_from_title(constitutional, "legge", "2001", "3") is None
        royal = page_titled("REGIO DECRETO-LEGGE 4 ottobre 1935, n. 1827")
        assert act_dates.date_from_title(royal, "decreto.legge", "1935", "1827") is None

    def test_ordinal_day_and_capitals(self):
        page = page_titled("DECRETO LEGISLATIVO 1º Febbraio 2006, n. 109")
        assert act_dates.date_from_title(page, "decreto.legislativo", "2006", "109") == "2006-02-01"

    def test_degree_sign_day(self):
        page = page_titled("LEGGE 1° agosto 2003, n. 206")
        assert act_dates.date_from_title(page, "legge", "2003", "206") == "2003-08-01"

    def test_entities_and_whitespace_in_the_title_are_normalised(self):
        page = "<html><head><title>\n  LEGGE&nbsp;4  maggio\n1983,\tn.&#32;184 - Normattiva </title></head></html>"
        assert act_dates.date_from_title(page, "legge", "1983", "184") == "1983-05-04"

    def test_a_title_tag_with_attributes_is_read(self):
        page = '<head><TITLE lang="it">LEGGE 4 maggio 1983, n. 184 - Normattiva</TITLE></head>'
        assert act_dates.date_from_title(page, "legge", "1983", "184") == "1983-05-04"

    def test_the_act_must_open_the_title(self):
        page = page_titled("Testo coordinato: LEGGE 4 maggio 1983, n. 184")
        assert act_dates.date_from_title(page, "legge", "1983", "184") is None

    def test_a_date_in_the_body_is_not_the_title(self):
        page = "<html><head><title>Normattiva</title></head><body><h2>LEGGE 4 maggio 1983, n. 184</h2></body></html>"
        assert act_dates.date_from_title(page, "legge", "1983", "184") is None

    def test_no_title_no_date(self):
        assert act_dates.date_from_title("<html></html>", "legge", "1983", "184") is None

    def test_an_unknown_month_is_not_a_date(self):
        page = page_titled("LEGGE 4 maggi 1983, n. 184")
        assert act_dates.date_from_title(page, "legge", "1983", "184") is None

    @pytest.mark.parametrize("title", ["LEGGE 31 febbraio 1983, n. 184", "LEGGE 0 maggio 1983, n. 184"])
    def test_a_day_that_does_not_exist_is_not_a_date(self, title):
        assert act_dates.date_from_title(page_titled(title), "legge", "1983", "184") is None

    def test_a_kind_outside_the_table_has_no_title_to_match(self):
        assert act_dates.date_from_title(PAGE, "ordinanza", "1983", "184") is None

    def test_a_hostile_page_is_read_in_linear_time(self):
        page = "<title " * 20000 + "LEGGE " * 20000
        assert act_dates.date_from_title(page, "legge", "1983", "184") is None


class TestResolve:
    async def test_resolves_and_caches(self, cache):
        request = AsyncMock(return_value=HttpResult(text=PAGE, status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            first = await act_dates.resolve_many([LEGGE_184])
            second = await act_dates.resolve_many([LEGGE_184])
        assert first == {LEGGE_184: "urn:nir:stato:legge:1983-05-04;184"}
        assert second == first
        assert request.await_count == 1
        assert request.await_args.args[1] == (
            "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1983;184"
        )

    async def test_each_act_costs_at_most_one_retry(self, cache):
        """Two attempts plus one back-off per act keep the batch inside MERL-T's 180 s."""
        request = AsyncMock(return_value=HttpResult(text=PAGE, status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            await act_dates.resolve_many([LEGGE_184])
        assert request.await_args.kwargs["max_retries"] == 1

    async def test_an_unreadable_page_is_none_and_not_cached(self, cache):
        request = AsyncMock(return_value=HttpResult(text="<html></html>", status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.resolve_many([LEGGE_184]) == {LEGGE_184: None}
        assert request.await_count == 1
        assert cache.data == {}

    async def test_a_page_of_another_act_is_refused(self, cache):
        """Live, 2 Oct: the resolver answered a regional law URN with the state DECRETO-LEGGE 17/2001."""
        urn = "urn:nir:stato:legge:2001;17"
        request = AsyncMock(return_value=ok_page("DECRETO-LEGGE 19 febbraio 2001, n. 17"))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.resolve_many([urn]) == {urn: None}
        assert request.await_count == 1
        assert cache.data == {}

    @pytest.mark.parametrize("urn", [
        "urn:nir:regione.sicilia:legge:2001;17",
        "urn:nir:regione.lombardia:legge:2006;12",
        "urn:nir:unione.europea:regolamento:2016;679",
        "urn:nir:stato:ordinanza:2001;17",
        "urn:nir:stato:codice.civile:1942;262",
    ])
    async def test_what_is_not_a_state_act_of_a_known_kind_is_none_without_a_request(self, cache, urn):
        request = AsyncMock(return_value=ok_page("DECRETO-LEGGE 19 febbraio 2001, n. 17"))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.resolve_many([urn]) == {urn: None}
        request.assert_not_awaited()
        assert cache.data == {}

    async def test_leading_zeros_are_dropped_from_the_full_urn(self, cache):
        urn = "urn:nir:stato:legge:1983;0184"
        request = AsyncMock(return_value=HttpResult(text=PAGE, status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.resolve_many([urn]) == {urn: "urn:nir:stato:legge:1983-05-04;184"}
        assert cache.data == {urn: "urn:nir:stato:legge:1983-05-04;184"}

    @pytest.mark.parametrize("kind,title,year,number,iso", EIGHT_KINDS)
    async def test_every_kind_resolves_through_the_request(self, cache, kind, title, year, number, iso):
        urn = f"urn:nir:stato:{kind}:{year};{number}"
        with patch.object(act_dates.http_client, "request", new=AsyncMock(return_value=ok_page(title))):
            assert await act_dates.resolve_many([urn]) == {urn: f"urn:nir:stato:{kind}:{iso};{number}"}

    async def test_a_network_error_on_one_act_leaves_the_others(self, cache):
        first, broken, third = LEGGE_184, "urn:nir:stato:legge:2006;109", "urn:nir:stato:decreto.legge:2013;61"
        request = serve({
            first: HttpResult(text=PAGE, status=200, headers={}),
            broken: NetworkError("boom", status_code=503),
            third: ok_page("DECRETO-LEGGE 4 giugno 2013, n. 61"),
        })
        with patch.object(act_dates.http_client, "request", new=request):
            result = await act_dates.resolve_many([first, broken, third])
        assert result == {
            first: "urn:nir:stato:legge:1983-05-04;184",
            broken: None,
            third: "urn:nir:stato:decreto.legge:2013-06-04;61",
        }
        assert request.await_count == 3
        assert set(cache.data) == {first, third}

    async def test_the_batch_gives_up_after_its_time_budget(self, cache, monkeypatch):
        now = {"t": 1000.0}
        monkeypatch.setattr(act_dates, "time", SimpleNamespace(monotonic=lambda: now["t"]))
        pages = {
            "urn:nir:stato:legge:1983;184": PAGE,
            "urn:nir:stato:decreto.legge:2013;61": page_titled("DECRETO-LEGGE 4 giugno 2013, n. 61"),
            "urn:nir:stato:legge:2006;109": page_titled("LEGGE 1 gennaio 2006, n. 109"),
        }

        async def slow(method, url, **kwargs):
            now["t"] += act_dates.BATCH_BUDGET / 2
            return HttpResult(text=pages[url.rsplit("?", 1)[1]], status=200, headers={})

        request = AsyncMock(side_effect=slow)
        with patch.object(act_dates.http_client, "request", new=request):
            result = await act_dates.resolve_many(list(pages))
        assert list(result.values()) == [
            "urn:nir:stato:legge:1983-05-04;184",
            "urn:nir:stato:decreto.legge:2013-06-04;61",
            None,
        ]
        assert request.await_count == 2
        assert len(cache.data) == 2

    def test_the_budget_is_120_seconds(self):
        """MERL-T waits at most 180 s for the whole batch."""
        assert act_dates.BATCH_BUDGET == 120.0

    @pytest.mark.parametrize("urns", [
        None, [], "urn:nir:stato:legge:1983;184", [1],
        ["urn:nir:stato:legge:1983-05-04;184"],
        ["urn:nir:stato:legge:1983;184~art1"],
        ["https://evil.example/x"],
        ["urn:nir:stato:legge:1983;184"] * 21,
        [LEGGE_184, "urn:nir:stato:legge:1983;184~art1"],
    ])
    async def test_rejects_bad_input_before_any_request(self, cache, urns):
        request = AsyncMock()
        with patch.object(act_dates.http_client, "request", new=request):
            with pytest.raises(ValidationError):
                await act_dates.resolve_many(urns)
        request.assert_not_awaited()


class TestRoute:
    async def test_returns_the_map(self, client):
        with patch.object(act_dates, "resolve_many", new=AsyncMock(return_value={"u": "v"})):
            response = await client.post("/resolve_act_dates", json={"urns": ["u"]})
        assert response.status_code == 200
        assert await response.get_json() == {"resolved": {"u": "v"}}

    async def test_bad_input_is_400(self, client):
        response = await client.post("/resolve_act_dates", json={"urns": "x"})
        assert response.status_code == 400
