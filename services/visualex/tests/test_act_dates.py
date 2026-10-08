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


# --- A search that names an act by its year (complete_year, complete_request_date) ------------
#
# Until 9 October 2026 the year was completed by `complete_date`, which typed the act into the
# portal's search with Playwright and took the first hit unread: d.lgs. 231/2001 came back dated
# 2025-12-31 and d.lgs. 163/2006 2024-06-28, other acts' days (live, 2 October).

import asyncio  # noqa: E402
from pathlib import Path  # noqa: E402

from visualex_api.tools.urngenerator import complete_request_date  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "normattiva"


def real_page(name):
    """The resolver's page for the act, its <title> as Normattiva served it (9 Oct 2026)."""
    return HttpResult(text=(FIXTURES / name).read_text(encoding="utf-8"), status=200, headers={})


class TestCompleteYear:
    @pytest.mark.parametrize("act_type,year,number,fixture,expected", [
        ("decreto legislativo", "2001", "231", "resolver_dlgs231_2001_title_trimmed.html", "2001-06-08"),
        ("decreto legislativo", "2006", "163", "resolver_dlgs163_2006_title_trimmed.html", "2006-04-12"),
        ("legge", "1990", "241", "resolver_l241_1990_title_trimmed.html", "1990-08-07"),
    ])
    async def test_the_acts_own_page_gives_its_day(self, cache, act_type, year, number, fixture, expected):
        request = AsyncMock(return_value=real_page(fixture))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.complete_year(act_type, year, number) == expected
        assert request.await_count == 1

    @pytest.mark.parametrize("act_type,urn", [
        ("decreto legislativo", "urn:nir:stato:decreto.legislativo:2001;231"),
        ("decreto legge", "urn:nir:stato:decreto.legge:2001;231"),
        ("d.p.r.", "urn:nir:stato:decreto.del.presidente.della.repubblica:2001;231"),
        ("decreto del presidente della repubblica", "urn:nir:stato:decreto.del.presidente.della.repubblica:2001;231"),
        ("regio decreto", "urn:nir:stato:regio.decreto:2001;231"),
        ("legge costituzionale", "urn:nir:stato:legge.costituzionale:2001;231"),
        ("regio decreto legge", "urn:nir:stato:regio.decreto.legge:2001;231"),
    ])
    async def test_each_kind_asks_the_resolver_for_its_own_urn(self, cache, act_type, urn):
        request = AsyncMock(return_value=HttpResult(text="<html></html>", status=200, headers={}))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.complete_year(act_type, "2001", "231") == "2001"
        assert request.await_args.args[1] == act_dates.RESOLVER + urn

    @pytest.mark.parametrize("year,number,title", [
        # What the old search took first, live on 2 October: never its day.
        ("2001", "231", "DECRETO LEGISLATIVO 31 Dicembre 2025, n. 210"),
        ("2006", "163", "DECRETO 28 Giugno 2024, n. 127"),
        # The same number in another year, the same year and number of another type.
        ("2001", "231", "DECRETO LEGISLATIVO 8 giugno 2002, n. 231"),
        ("2001", "231", "LEGGE 8 giugno 2001, n. 231"),
    ])
    async def test_another_acts_page_keeps_the_year(self, cache, year, number, title):
        request = AsyncMock(return_value=ok_page(title))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.complete_year("decreto legislativo", year, number) == year
        assert cache.data == {}

    @pytest.mark.parametrize("failure", [NetworkError("down", status_code=503), RuntimeError("bug")])
    async def test_a_failure_keeps_the_year(self, cache, failure):
        with patch.object(act_dates.http_client, "request", new=AsyncMock(side_effect=failure)):
            assert await act_dates.complete_year("decreto legislativo", "2001", "231") == "2001"

    async def test_a_slow_lookup_keeps_the_year(self, cache, monkeypatch):
        monkeypatch.setattr(act_dates, "LOOKUP_BUDGET", 0.05)

        async def slow(*args, **kwargs):
            await asyncio.sleep(5)

        with patch.object(act_dates.http_client, "request", new=AsyncMock(side_effect=slow)):
            assert await act_dates.complete_year("decreto legislativo", "2001", "231") == "2001"

    @pytest.mark.parametrize("act_type,year,number", [
        ("decreto ministeriale", "2014", "55"),            # a kind the titles do not cover
        ("decreto legislativo luogotenenziale", "1945", "2"),
        ("regolamento ue", "2016", "679"),
        ("decreto legislativo", "2001", "231-bis"),       # not plain digits
        ("decreto legislativo", "2001", ""),
        ("decreto legislativo", "01", "231"),             # not a year
    ])
    async def test_what_cannot_be_told_keeps_the_year_without_a_request(self, cache, act_type, year, number):
        request = AsyncMock(side_effect=AssertionError("no request may be made"))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.complete_year(act_type, year, number) == year

    async def test_a_day_found_once_needs_no_request(self, cache):
        cache.data["urn:nir:stato:decreto.legislativo:2001;231"] = "urn:nir:stato:decreto.legislativo:2001-06-08;231"
        request = AsyncMock(side_effect=AssertionError("no request may be made"))
        with patch.object(act_dates.http_client, "request", new=request):
            assert await act_dates.complete_year("decreto legislativo", "2001", "231") == "2001-06-08"


class TestCompleteRequestDate:
    NO_LOOKUP = AsyncMock(side_effect=AssertionError("no lookup may be made"))

    @pytest.mark.parametrize("given", [None, "", "  "])
    async def test_no_date_stays_no_date(self, given):
        with patch("visualex_api.tools.urngenerator.complete_year", new=self.NO_LOOKUP):
            assert await complete_request_date("legge", given, "241") is None

    async def test_a_year_with_a_number_is_looked_up(self):
        lookup = AsyncMock(return_value="2001-06-08")
        with patch("visualex_api.tools.urngenerator.complete_year", new=lookup):
            assert await complete_request_date("decreto legislativo", " 2001 ", "231") == "2001-06-08"
        lookup.assert_awaited_once_with("decreto legislativo", "2001", "231")

    async def test_a_year_without_a_number_stays_a_year(self):
        # It was a 500 ("Formato data non valido") for the five spelled types.
        with patch("visualex_api.tools.urngenerator.complete_year", new=self.NO_LOOKUP):
            assert await complete_request_date("legge", "1990", None) == "1990"

    @pytest.mark.parametrize("act_type,given,expected", [
        ("legge", "1990-08-07", "1990-08-07"),
        ("legge", "7 agosto 1990", "1990-08-07"),
        ("decreto ministeriale", "10 marzo 2014", "10 marzo 2014"),
    ])
    async def test_a_full_date_is_never_looked_up(self, act_type, given, expected):
        with patch("visualex_api.tools.urngenerator.complete_year", new=self.NO_LOOKUP):
            assert await complete_request_date(act_type, given, "1") == expected

    async def test_a_malformed_date_is_the_callers_error(self):
        with pytest.raises(ValidationError):
            await complete_request_date("legge", "31/02/1990x", "241")


class TestTheNormBuiltFromAYear:
    async def _norm(self, lookup, date="2001"):
        controller = NormaController()
        with patch("visualex_api.tools.urngenerator.complete_year", new=lookup), \
                patch.object(controller, "_article_exists_in_tree", new=AsyncMock(return_value=True)):
            return await controller.create_norma_visitata_from_data(
                {"act_type": "decreto legislativo", "act_number": "231", "date": date, "article": "5", "annex": ""})

    async def test_the_act_gets_its_own_day(self):
        [nv] = await self._norm(AsyncMock(return_value="2001-06-08"))
        assert nv.norma.data == "2001-06-08"
        assert "decreto.legislativo:2001-06-08;231~art5" in nv.urn

    async def test_an_act_that_cannot_be_told_keeps_its_year(self):
        [nv] = await self._norm(AsyncMock(return_value="2001"))
        assert nv.norma.data == "2001"
        assert "2025-12-31" not in nv.urn

    async def test_a_malformed_date_answers_400(self, client):
        response = await client.post("/fetch_norma_data", json={
            "act_type": "legge", "act_number": "241", "date": "7 agostissimo 1990", "article": "2"})
        assert response.status_code == 400
