"""POST /search_decisions (design 2026-10-05 §5)."""
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

    async def search(self, q, pagina, rows=20, *, coords=None, hl_query=None):
        self.queries.append((q, pagina, coords, hl_query, rows))
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


def _use(monkeypatch, searcher, start="2021-01-04"):
    mod = "visualex_api.services.decisions.search_route."
    cache = DictCache()
    monkeypatch.setattr(mod + "get_searcher", lambda: searcher)
    monkeypatch.setattr(mod + "get_cache", lambda: cache)

    async def archive_start(archivio):
        return start
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
