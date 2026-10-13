"""POST /search_decisions (design 2026-10-05 §5)."""
import asyncio

import pytest

from app import NormaController
from visualex_api.services.decisions.italgiure import SearchHit, SearchPage
from visualex_api.services.decisions.model import Identity
from visualex_api.tools.exceptions import NetworkError

HIT = SearchHit(Identity("cassazione", 24908, 2026, "civile"),
                {"sezione": "L", "tipo": "ordinanza", "data_deposito": "2026-09-01"}, "indice",
                {"testo": "ex art. 2043 c.c.", "evidenziati": [[3, 17]]})


class FakeSearcher:
    def __init__(self, page=None, error=None):
        self.page, self.error, self.queries = page, error, []

    async def search(self, q, pagina, rows=20, *, coords=None, hl_query=None, anni=None):
        self.queries.append((q, pagina, coords, hl_query, rows, anni))
        if self.error:
            raise self.error
        return self.page


class DictCache:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


@pytest.fixture
def client():
    return NormaController().app.test_client()


def _use(monkeypatch, searcher, start="2021-01-04", cache=None):
    """`start`: one date for both archives, or a dict by archive (a missing one is unknown)."""
    mod = "visualex_api.services.decisions.search_route."
    cache = searcher.cache = cache or DictCache()
    monkeypatch.setattr(mod + "get_searcher", lambda: searcher)
    monkeypatch.setattr(mod + "get_cache", lambda: cache)

    async def archive_start(archivio):
        return start.get(archivio) if isinstance(start, dict) else start
    monkeypatch.setattr(mod + "archive_start", archive_start)
    return searcher


async def test_an_article_gives_a_page(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(939, [HIT])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "codice civile", "numero_articolo": "2043"}})
    assert resp.status_code == 200
    body = await resp.get_json()
    assert body["esito"] == "risultati" and body["totale"] == 939 and body["pagina"] == 1
    assert body["archivio"] == "civile" and body["archivio_dal"] == "2021-01-04"
    assert body["decisioni"][0]["identita"] == {"corte": "cassazione", "numero": 24908,
                                                "anno": 2026, "archivio": "civile"}
    assert s.queries[0][0] == 'kind:"snciv" AND (rnc-gen:"CC" AND rnc-art:"2043 00")'
    assert s.queries[0][2] is not None and 'art. 2043 c.c.' in s.queries[0][3]
    assert s.queries[0][4] == 20
    assert body["modo"] == "indice" and body["decisioni"][0]["trovata"] == "indice"
    assert "totale_approssimato" not in body


async def test_the_text_way_is_chosen_on_request(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(939, [])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "codice civile", "numero_articolo": "2043"}, "modo": "testo"})
    body = await resp.get_json()
    assert body["modo"] == "testo" and s.queries[0][2] is None and 'ocr:"art. 2043 c.c."' in s.queries[0][0]


async def test_an_act_the_index_cannot_express_is_searched_in_the_text(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(5, [])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "legge", "numero_atto": "241", "data": "1990", "numero_articolo": "2"}})
    assert (await resp.get_json())["modo"] == "testo" and s.queries[0][2] is None


async def test_an_act_that_cannot_be_phrased_is_unsupported(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(SearchPage(0, [])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "regolamento ue", "numero_atto": "679", "data": "2016", "numero_articolo": "5"}})
    assert resp.status_code == 200 and (await resp.get_json()) == {"esito": "non_supportata"}


@pytest.mark.parametrize("body, field", [
    ({}, "norma"),
    ({"tema": "   "}, "tema"),
    ({"tema": "x y", "pagina": 11}, "pagina"),
    ({"tema": "x y", "pagina": 0}, "pagina"),
    ({"tema": "x y", "archivio": "tributario"}, "archivio"),
    ({"tema": "x y", "modo": "altro"}, "modo"),
    ({"tema": "x y", "pagina": True}, "pagina"),
    ({"tema": "x y", "pagina": 1.0}, "pagina"),
    ({"tema": 5}, "tema"),
    ({"tema": ["x"]}, "tema"),
    ({"norma": {"tipo_atto": ["codice civile"], "numero_articolo": "2043"}}, "norma"),
    ({"norma": {"tipo_atto": "codice civile", "numero_articolo": {"a": 1}}}, "norma"),
    ({"norma": "codice civile"}, "norma"),
    ([], "norma"),
])
async def test_a_bad_request_says_which_field(client, monkeypatch, body, field):
    _use(monkeypatch, FakeSearcher(SearchPage(0, [])))
    resp = await client.post("/search_decisions", json=body)
    assert resp.status_code == 400
    out = await resp.get_json()
    assert out["esito"] == "richiesta_non_valida" and field in out["errori"]


async def test_a_source_that_does_not_answer_is_503_never_empty(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(error=NetworkError("down")))
    resp = await client.post("/search_decisions", json={"tema": "perdita di chance"})
    assert resp.status_code == 503
    assert await resp.get_json() == {"esito": "fonte_non_raggiungibile", "fonte": "cassazione"}


async def test_the_same_page_is_served_from_the_cache(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])))
    for _ in range(2):
        await client.post("/search_decisions", json={"tema": "perdita di chance", "pagina": 2})
    assert len(s.queries) == 1
    await client.post("/search_decisions", json={"tema": "perdita di chance", "pagina": 3})
    assert len(s.queries) == 2


async def test_a_bug_is_a_fixed_500(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(error=RuntimeError("boom")))
    resp = await client.post("/search_decisions", json={"tema": "x y"})
    assert resp.status_code == 500 and await resp.get_json() == {"esito": "errore_interno"}


async def test_explicit_nulls_are_the_same_as_left_out(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "codice civile", "numero_articolo": "2043"},
        "modo": None, "archivio": None, "pagina": None})
    body = await resp.get_json()
    assert resp.status_code == 200 and body["modo"] == "indice" and body["pagina"] == 1
    assert body["archivio"] == "civile" and s.queries[0][1] == 1


async def test_a_long_topic_is_searched_as_its_first_80_characters(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(0, [])))
    resp = await client.post("/search_decisions", json={"tema": "danno " * 2000})
    assert resp.status_code == 200
    assert s.queries[0][0] == "(ocr:\"" + ("danno " * 14)[:80].strip() + "\")"


async def test_a_source_error_is_not_cached(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(error=NetworkError("down")))
    for _ in range(2):
        resp = await client.post("/search_decisions", json={"tema": "perdita di chance"})
        assert resp.status_code == 503
    assert len(s.queries) == 2 and s.cache.data == {}


async def test_the_index_and_the_text_do_not_share_a_cache_entry(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])))
    norma = {"tipo_atto": "codice civile", "numero_articolo": "2043"}
    for modo in ("indice", "testo"):
        await client.post("/search_decisions", json={"norma": norma, "modo": modo})
    assert len(s.queries) == 2 and len(s.cache.data) == 2


async def test_an_unknown_code_suffix_falls_back_to_the_text(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [])))
    resp = await client.post("/search_decisions", json={
        "norma": {"tipo_atto": "codice civile", "numero_articolo": "2043-zzzzz"}})
    assert (await resp.get_json())["modo"] == "testo" and s.queries[0][2] is None


async def test_both_archives_give_the_earlier_start(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])), start={"civile": "2021-01-04", "penale": "2020-06-01"})
    body = await (await client.post("/search_decisions", json={"tema": "perdita di chance"})).get_json()
    assert body["archivio"] is None and body["archivio_dal"] == "2020-06-01"


async def test_one_archive_gives_its_own_start(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])), start={"civile": "2021-01-04", "penale": "2020-06-01"})
    body = await (await client.post("/search_decisions", json={
        "tema": "perdita di chance", "archivio": "penale"})).get_json()
    assert body["archivio_dal"] == "2020-06-01"


async def test_an_unknown_start_is_null_not_an_error_and_not_cached(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])), start={"civile": "2021-01-04"})
    for _ in range(2):
        resp = await client.post("/search_decisions", json={"tema": "perdita di chance"})
        assert resp.status_code == 200 and (await resp.get_json())["archivio_dal"] is None
    assert len(s.queries) == 2 and s.cache.data == {}


async def test_a_start_that_raises_never_turns_a_page_into_an_error(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])))

    async def boom(archivio):
        raise NetworkError("down")
    monkeypatch.setattr("visualex_api.services.decisions.search_route.archive_start", boom)
    resp = await client.post("/search_decisions", json={"tema": "perdita di chance"})
    assert resp.status_code == 200 and (await resp.get_json())["archivio_dal"] is None


async def test_a_search_that_hangs_is_a_503(client, monkeypatch):
    class Hanging(FakeSearcher):
        async def search(self, *a, **k):
            await asyncio.sleep(60)

    _use(monkeypatch, Hanging())
    monkeypatch.setattr("visualex_api.services.decisions.search_route.ITALGIURE_TIMEOUT", 0.05)
    resp = await client.post("/search_decisions", json={"tema": "perdita di chance"})
    assert resp.status_code == 503


async def test_a_broken_cache_costs_a_request_not_the_answer(client, monkeypatch):
    class Broken:
        async def get(self, key):
            raise OSError("disk")

        async def set(self, key, value):
            raise OSError("disk")

    _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])), cache=Broken())
    resp = await client.post("/search_decisions", json={"tema": "perdita di chance"})
    assert resp.status_code == 200 and (await resp.get_json())["totale"] == 1


async def test_the_start_is_read_while_the_search_runs(client, monkeypatch):
    order = []

    class Slow(FakeSearcher):
        async def search(self, *a, **k):
            order.append("search-begin")
            await asyncio.sleep(0.05)
            order.append("search-end")
            return self.page

    _use(monkeypatch, Slow(SearchPage(1, [HIT])))

    async def start(archivio):
        order.append("start")
        return "2021-01-04"
    monkeypatch.setattr("visualex_api.services.decisions.search_route.archive_start", start)
    await client.post("/search_decisions", json={"tema": "perdita di chance", "archivio": "civile"})
    assert order.index("start") < order.index("search-end")


# --- the deposit years (design 2026-10-12 D4, plan Task B1)

@pytest.fixture(autouse=True)
def _year_2026(monkeypatch):
    monkeypatch.setattr("visualex_api.services.decisions.search_route.current_year", lambda: 2026)


@pytest.mark.parametrize("body, anni", [
    ({"anno_dal": 2022, "anno_al": 2024}, (2022, 2024)),
    ({"anno_dal": 2022}, (2022, None)),
    ({"anno_al": 2024}, (None, 2024)),
    ({"anno_dal": 2024, "anno_al": 2024}, (2024, 2024)),
    ({"anno_dal": 1900, "anno_al": 2026}, (1900, 2026)),
    ({"anno_dal": None, "anno_al": None}, None),
    ({}, None),
])
async def test_the_year_range_reaches_the_search(client, monkeypatch, body, anni):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])))
    resp = await client.post("/search_decisions", json={"tema": "perdita di chance", **body})
    assert resp.status_code == 200
    # the range is never a clause of the query: it travels as the archive's filter
    assert s.queries[0][5] == anni and s.queries[0][0] == '(ocr:"perdita di chance")'


@pytest.mark.parametrize("body, fields", [
    ({"anno_dal": 1899}, {"anno_dal"}),
    ({"anno_al": 2027}, {"anno_al"}),
    ({"anno_dal": 0, "anno_al": 3000}, {"anno_dal", "anno_al"}),
    ({"anno_dal": -2024}, {"anno_dal"}),
    ({"anno_dal": "2024"}, {"anno_dal"}),
    ({"anno_al": 2024.0}, {"anno_al"}),
    ({"anno_al": True}, {"anno_al"}),
    ({"anno_dal": [2024]}, {"anno_dal"}),
    ({"anno_dal": 2025, "anno_al": 2024}, {"anno_dal"}),
])
async def test_a_bad_year_says_which_field_in_italian(client, monkeypatch, body, fields):
    s = _use(monkeypatch, FakeSearcher(SearchPage(0, [])))
    resp = await client.post("/search_decisions", json={"tema": "perdita di chance", **body})
    assert resp.status_code == 400
    out = await resp.get_json()
    assert out["esito"] == "richiesta_non_valida" and set(out["errori"]) == fields
    assert all(isinstance(m, str) and m.startswith("L'anno") for m in out["errori"].values())
    assert s.queries == []


async def test_the_current_year_is_the_last_one_accepted(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(SearchPage(0, [])))
    monkeypatch.setattr("visualex_api.services.decisions.search_route.current_year", lambda: 2027)
    resp = await client.post("/search_decisions", json={"tema": "x y", "anno_al": 2027})
    assert resp.status_code == 200


async def test_each_range_has_its_own_cache_entry(client, monkeypatch):
    s = _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])))
    ranges = [{}, {"anno_dal": 2022}, {"anno_al": 2022}, {"anno_dal": 2022, "anno_al": 2024},
              {"anno_dal": 2022, "anno_al": 2025}]
    for body in ranges * 2:
        await client.post("/search_decisions", json={"tema": "perdita di chance", **body})
    assert len(s.queries) == len(ranges) and len(s.cache.data) == len(ranges)


async def test_the_counts_per_year_come_with_the_page_when_there_are_some(client, monkeypatch):
    counts = [{"anno": 2024, "n": 779}, {"anno": 2023, "n": 816}]
    _use(monkeypatch, FakeSearcher(SearchPage(1595, [HIT], counts)))
    body = await (await client.post("/search_decisions", json={"tema": "perdita di chance"})).get_json()
    assert body["anni"] == counts and body["totale"] == 1595


async def test_without_counts_the_answer_has_no_anni(client, monkeypatch):
    _use(monkeypatch, FakeSearcher(SearchPage(1, [HIT])))
    body = await (await client.post("/search_decisions", json={"tema": "perdita di chance"})).get_json()
    assert "anni" not in body
