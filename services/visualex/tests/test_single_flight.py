"""Concurrent identical reads share one run (T133).

Fifty readers opening the same article on an empty cache sent 79 requests to Normattiva (fifty
article pages, twenty-nine copies of the code's index), queued behind our own limit: measured with
scripts/replay_load.py, p95 170 s and 27 of 50 timed out. The shared client's identical GETs, a
Normattiva document and an act's tree are now read once for every caller waiting on them, and no
result outlives its run.
"""
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from visualex_api.services import http_client as http_module
from visualex_api.services.http_client import HttpResult, ThrottledHttpClient
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.tools import treextractor
from visualex_api.tools.cache import PersistentCache
from visualex_api.tools.cache_manager import get_cache_manager
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.single_flight import SingleFlight

pytestmark = pytest.mark.asyncio

FIXTURES = Path(__file__).parent / "fixtures"


# --- the helper ------------------------------------------------------------------------------

async def test_callers_that_arrive_together_share_one_run():
    flights, runs = SingleFlight(), []
    gate = asyncio.Event()

    async def work():
        runs.append(1)
        await gate.wait()
        return "page"

    waiting = [asyncio.create_task(flights.run("k", work)) for _ in range(20)]
    await asyncio.sleep(0)
    gate.set()
    assert await asyncio.gather(*waiting) == ["page"] * 20
    assert runs == [1]
    assert len(flights) == 0


async def test_nothing_outlives_its_run():
    flights, runs = SingleFlight(), []

    async def work():
        runs.append(1)
        return len(runs)

    assert await flights.run("k", work) == 1
    assert await flights.run("k", work) == 2


async def test_different_keys_run_apart():
    flights, gate = SingleFlight(), asyncio.Event()

    async def work(value):
        await gate.wait()
        return value

    a = asyncio.create_task(flights.run("a", lambda: work("a")))
    b = asyncio.create_task(flights.run("b", lambda: work("b")))
    await asyncio.sleep(0)
    gate.set()
    assert await asyncio.gather(a, b) == ["a", "b"]


async def test_an_error_reaches_every_caller_and_is_not_kept():
    flights, gate, runs = SingleFlight(), asyncio.Event(), []

    async def failing():
        runs.append(1)
        await gate.wait()
        raise ValueError("source down")

    waiting = [asyncio.create_task(flights.run("k", failing)) for _ in range(3)]
    await asyncio.sleep(0)
    gate.set()
    results = await asyncio.gather(*waiting, return_exceptions=True)
    assert all(isinstance(r, ValueError) for r in results)
    assert runs == [1]

    async def working():
        return "back"

    assert await flights.run("k", working) == "back"


async def test_a_caller_who_leaves_does_not_stop_the_others():
    flights, gate, runs = SingleFlight(), asyncio.Event(), []

    async def work():
        runs.append(1)
        await gate.wait()
        return "page"

    first = asyncio.create_task(flights.run("k", work))
    second = asyncio.create_task(flights.run("k", work))
    await asyncio.sleep(0)
    first.cancel()  # the first reader closes the tab
    await asyncio.sleep(0)
    gate.set()
    assert await second == "page"
    assert first.cancelled()
    assert runs == [1]


async def test_a_run_nobody_waits_for_any_more_is_stopped_before_it_reaches_the_source():
    """A caller whose time limit passes while its request is still queued behind our limit:
    before, its request was cancelled with it and never sent; it must stay so (review of #T133)."""
    flights, queue, sent = SingleFlight(), asyncio.Event(), []

    async def queued_request():
        await queue.wait()  # our limit toward the source is busy
        sent.append(1)
        return "page"

    with pytest.raises(TimeoutError):
        await asyncio.wait_for(flights.run("k", queued_request), 0.01)
    queue.set()
    await asyncio.sleep(0.01)
    assert sent == []
    assert len(flights) == 0


async def test_a_caller_who_comes_after_the_last_one_left_starts_a_fresh_run():
    flights, gate, runs = SingleFlight(), asyncio.Event(), []

    async def work():
        runs.append(1)
        await gate.wait()
        return "page"

    leaving = asyncio.create_task(flights.run("k", work))
    await asyncio.sleep(0)
    leaving.cancel()
    await asyncio.sleep(0)
    arriving = asyncio.create_task(flights.run("k", work))
    await asyncio.sleep(0)
    gate.set()
    assert await arriving == "page"
    assert runs == [1, 1]


async def test_every_caller_gets_what_share_makes_of_the_result():
    flights, gate = SingleFlight(), asyncio.Event()
    result = {"articles": [1, 2]}

    async def work():
        await gate.wait()
        return result

    leader = asyncio.create_task(flights.run("k", work, share=lambda r: dict(r, copy=True)))
    follower = asyncio.create_task(flights.run("k", work, share=lambda r: dict(r, copy=True)))
    await asyncio.sleep(0)
    gate.set()
    first, second = await leader, await follower
    assert first == second == {"articles": [1, 2], "copy": True}
    assert first is not result and second is not result and first is not second


# --- the shared client -----------------------------------------------------------------------

class CountingClient(ThrottledHttpClient):
    """The client with `_send` counted and held until released."""

    def __init__(self):
        super().__init__()
        self.sent = []
        self.delivered = []
        self.gate = asyncio.Event()

    async def _send(self, method, url, **kwargs):
        self.sent.append((method, url, kwargs.get("session"), kwargs.get("data")))
        await self.gate.wait()  # queued behind our limit
        self.delivered.append(url)
        return HttpResult(text="<html>page</html>", status=200, headers={"Content-Type": "text/html"})


async def test_identical_gets_reach_the_source_once():
    client = CountingClient()
    calls = [asyncio.create_task(client.request("GET", "https://www.normattiva.it/x", source="normattiva"))
             for _ in range(50)]
    await asyncio.sleep(0)
    client.gate.set()
    answers = await asyncio.gather(*calls)
    assert len(client.sent) == 1
    assert {a.text for a in answers} == {"<html>page</html>"}
    answers[0].headers["X-Mine"] = "1"  # each caller has its own headers
    assert "X-Mine" not in answers[1].headers


async def test_a_get_on_the_callers_session_a_post_and_another_address_go_alone():
    client = CountingClient()
    session = object()
    calls = [
        client.request("GET", "https://www.normattiva.it/x", source="normattiva", session=session),
        client.request("GET", "https://www.normattiva.it/x", source="normattiva", session=session),
        client.request("POST", "https://www.italgiure.giustizia.it/q", source="italgiure", data={"q": "1"}),
        client.request("POST", "https://www.italgiure.giustizia.it/q", source="italgiure", data={"q": "1"}),
        client.request("GET", "https://www.normattiva.it/x", source="normattiva", params={"a": "1"}),
        client.request("GET", "https://www.normattiva.it/x", source="normattiva", params={"a": "2"}),
    ]
    tasks = [asyncio.create_task(c) for c in calls]
    await asyncio.sleep(0)
    client.gate.set()
    await asyncio.gather(*tasks)
    assert len(client.sent) == 6


async def test_a_get_whose_caller_gave_up_in_the_queue_is_never_sent():
    client = CountingClient()
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(client.request("GET", "https://www.normattiva.it/x", source="normattiva"), 0.01)
    client.gate.set()
    await asyncio.sleep(0.01)
    assert client.delivered == []


async def test_the_host_check_still_refuses_an_undeclared_host():
    client = ThrottledHttpClient()
    with pytest.raises(http_module.NetworkError):
        await client.request("GET", "https://example.org/", source="x")


# --- the Normattiva document -----------------------------------------------------------------



@pytest.fixture
async def cold_scraper(tmp_path, monkeypatch):
    cache = PersistentCache("normattiva")
    cache.directory = tmp_path / "normattiva"
    cache.directory.mkdir(parents=True, exist_ok=True)
    monkeypatch.setitem(get_cache_manager().persistent, "normattiva", cache)
    await NormattivaScraper.get_document.cache.clear()
    yield NormattivaScraper()
    await NormattivaScraper.get_document.cache.clear()


def _page(text):
    return ('<html><body><div class="bodyTesto"><h2 class="article-num-akn">Art. 2043</h2>'
            '<div class="article-heading-akn">Risarcimento per fatto illecito</div>'
            f'<div class="art-comma-div-akn">{text}</div></div></body></html>')


async def test_readers_of_the_same_article_share_one_page_and_one_parse(cold_scraper):
    requested, parsed, gate = [], [], asyncio.Event()

    async def request_document(url, *, source="base_scraper", **kwargs):
        requested.append(url)
        await gate.wait()
        return _page("Qualunque fatto doloso o colposo")

    original = cold_scraper.estrai_da_html

    async def estrai(atto, *args, **kwargs):
        parsed.append(1)
        return await original(atto, *args, **kwargs)

    cold_scraper.request_document = request_document
    cold_scraper.estrai_da_html = estrai
    nv = NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo="2043")
    readers = [asyncio.create_task(cold_scraper.get_document(nv)) for _ in range(30)]
    await asyncio.sleep(0.05)
    gate.set()
    answers = await asyncio.gather(*readers)
    assert len(requested) == 1
    assert len(parsed) == 1
    assert {tuple(a) for a in answers} == {tuple(answers[0])}
    assert "Qualunque fatto doloso o colposo" in answers[0][0]


async def test_readers_of_two_articles_read_two_pages(cold_scraper):
    requested, gate = [], asyncio.Event()

    async def request_document(url, *, source="base_scraper", **kwargs):
        requested.append(url)
        await gate.wait()
        return _page(url[-4:])

    cold_scraper.request_document = request_document
    a = NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo="2043")
    b = NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo="2044")
    readers = [asyncio.create_task(cold_scraper.get_document(nv)) for nv in (a, b, a, b)]
    await asyncio.sleep(0.05)
    gate.set()
    await asyncio.gather(*readers)
    assert len(requested) == 2


# --- the tree --------------------------------------------------------------------------------

LANDING = (FIXTURES / "akn" / "landing_legge_241_1990.html").read_text(encoding="utf-8")
L241 = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241"


class MemoryCache:
    def __init__(self):
        self.data = {}

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


async def test_callers_of_the_same_tree_share_one_page_and_get_their_own_copy():
    visits, gate = [], asyncio.Event()

    async def request(method, url, **kwargs):
        visits.append(url)
        await gate.wait()
        return SimpleNamespace(text=LANDING)

    await treextractor.get_tree.cache.clear()
    with patch.object(treextractor, "_tree_cache", MemoryCache()), \
            patch.object(treextractor.http_client, "request", request):
        callers = [asyncio.create_task(treextractor.get_tree(L241, details=True, return_metadata=True))
                   for _ in range(10)]
        await asyncio.sleep(0.05)
        gate.set()
        trees = await asyncio.gather(*callers)
    await treextractor.get_tree.cache.clear()
    assert len(visits) == 1
    assert all(list(t) == list(trees[0]) for t in trees)
    # a follower's list is its own: changing it changes no other caller's
    trees[1][0].append("mine")
    assert "mine" not in trees[0][0] and "mine" not in trees[2][0]
