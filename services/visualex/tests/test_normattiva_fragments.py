"""The first article of an act from its whole page, the following ones from the fragment (G-652; T133).

The comparison the owner asked for came first: the extractor's text on the fragment equals the
whole page's on all 29 Normattiva articles of the timing harness, and so do the update notes; the
validity differs only in `act_updated`, taken from the index. These tests hold the mechanism: the
session per act, the link the index gives, the checks, and every way back to the whole page.
"""
import asyncio
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app import NormaController
from visualex_api.services import normattiva_scraper as scraper_module
from visualex_api.services.normattiva_fragments import ActSessions, act_of, fragment_link, fragment_meta_key
from visualex_api.services.normattiva_parts import extract_parts
from visualex_api.services.normattiva_scraper import NormattivaScraper
from visualex_api.services.normattiva_validity import read_validity
from visualex_api.tools.cache import PersistentCache
from visualex_api.tools.cache_manager import get_cache_manager
from visualex_api.tools.exceptions import NetworkError
from visualex_api.tools.norma import Norma, NormaVisitata
from visualex_api.tools.page_memo import PAGE_MEMO

pytestmark = pytest.mark.asyncio

PAGES = Path(__file__).parent / "fixtures" / "normattiva"
FRAGMENT_2043 = (PAGES / "art2043_cc_fragment.html").read_text(encoding="utf-8")
FRAGMENT_2044 = (PAGES / "art2044_cc_fragment.html").read_text(encoding="utf-8")


def anchor(article_id, label, version=1, sub=1, update=False):
    path = (f"/atto/caricaArticolo?art.versione={version}&art.idGruppo=258&art.flagTipoArticolo=2"
            f"&art.codiceRedazionale=042U0262&art.idArticolo={article_id}&art.idSottoArticolo={sub}"
            f"&art.idSottoArticolo1=10&art.dataPubblicazioneGazzetta=1942-04-04&art.progressivo=0&"
            + ("art.imUpdate=true&" if update else ""))
    return f"""<a href="" onclick="return showArticle('{path}', this);" class="numero_articolo">{label}</a>"""


INDEX = ('<div class="albero">' + anchor(2043, "art. 2043") + anchor(2044, "art. 2044", version=2)
         + anchor(2044, "orig.", version=1, update=True) + "</div>"
         + "<p>Ultimo aggiornamento all'atto pubblicato il 18/11/2026</p>")
# Art. 2043's whole page: its article and the act's index (a real one weighs 2.6 MB).
WHOLE_2043 = FRAGMENT_2043.replace("<body>", "<body>" + INDEX, 1) if "<body>" in FRAGMENT_2043 else INDEX + FRAGMENT_2043


# --- the link the index gives ----------------------------------------------------------------------

async def test_the_link_is_the_current_versions():
    path = fragment_link(INDEX, "2044")
    assert "art.idArticolo=2044" in path and "art.versione=2" in path and "imUpdate" not in path


async def test_a_suffix_and_a_bare_number_are_read():
    index = anchor(612, "art. 612 bis", version=5, sub=2) + anchor(612, "agg.3", version=4, sub=2, update=True) + anchor(3, "3")
    assert "art.idSottoArticolo=2" in fragment_link(index, "612-bis")
    assert "art.idArticolo=3&" in fragment_link(index, "3")


async def test_two_candidates_an_article_in_parts_or_none_give_no_link():
    twice = anchor(1, "art. 1") + anchor(1, "art. 1", sub=1, version=3)
    assert fragment_link(twice, "1") is None                              # body and annex alike
    parts = anchor(1, "art. 1 (commi 1-100)") + anchor(1, "art. 1 (commi 101-200)")
    assert fragment_link(parts, "1") is None                              # split into parts
    assert fragment_link(INDEX, "2045") is None
    assert fragment_link(None, "2043") is None


async def test_the_act_of_an_article():
    assert act_of("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043") \
        == "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2"
    assert act_of("https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241") is None


# --- the sessions ----------------------------------------------------------------------------------

async def test_a_session_is_kept_a_while_bounded_and_closed_at_the_end():
    sessions = ActSessions(idle=60, size=2)
    first, second, third = sessions.new(), sessions.new(), sessions.new()
    sessions.keep("a", first, "a~art1")
    sessions.keep("b", second, "b~art1")
    assert sessions.get("a").session is first
    sessions.keep("c", third, "c~art1")           # «b», the least recently used, goes
    assert sessions.get("b") is None and len(sessions) == 2
    sessions.get("a").used_at = time.monotonic() - 120
    assert sessions.get("a") is None              # idle too long
    await asyncio.sleep(0)
    assert first.closed and second.closed
    await sessions.close_all()
    assert third.closed and len(sessions) == 0


# --- the scraper ---------------------------------------------------------------------------------

@pytest.fixture
async def scraper(tmp_path, monkeypatch):
    cache = PersistentCache("normattiva")
    cache.directory = tmp_path / "normattiva"
    cache.directory.mkdir()
    monkeypatch.setitem(get_cache_manager().persistent, "normattiva", cache)
    await NormattivaScraper.get_document.cache.clear()
    PAGE_MEMO.clear()
    instance = NormattivaScraper()
    yield instance
    await instance.sessions.close_all()
    await NormattivaScraper.get_document.cache.clear()


def cc(article, **kwargs):
    return NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo=article, **kwargs)


class Normattiva:
    """Whole pages through `request_document`, fragments through the shared client."""

    def __init__(self, fragment=FRAGMENT_2044, fail=False):
        self.pages, self.fragments, self.fragment, self.fail = [], [], fragment, fail

    async def request_document(self, url, *, source="base_scraper", **kwargs):
        self.pages.append((url, kwargs.get("session")))
        return WHOLE_2043 if url.endswith("~art2043") else FRAGMENT_2044.replace("<body>", "<body>" + INDEX, 1)

    async def request(self, method, url, **kwargs):
        self.fragments.append((url, kwargs.get("session"), kwargs.get("max_retries")))
        if self.fail:
            raise NetworkError("refused")
        return SimpleNamespace(text=self.fragment, status=200, headers={})


async def test_the_first_article_from_the_whole_page_the_next_from_the_fragment(scraper):
    source = Normattiva()
    scraper.request_document = source.request_document
    with patch.object(scraper_module.http_client, "request", source.request):
        await scraper.get_document(cc("2043"))
        text, url = await scraper.get_document(cc("2044"))
    act = act_of(url)
    session = scraper.sessions.get(act).session
    assert [(u.endswith("~art2043"), s is session) for u, s in source.pages] == [(True, True)]
    assert len(source.fragments) == 1
    fragment_url, used, retries = source.fragments[0]
    assert "art.idArticolo=2044" in fragment_url and used is session and retries == 0
    assert text == scraper.estrai_testo(FRAGMENT_2044)
    assert await scraper.cache.get(url) == FRAGMENT_2044
    meta = await scraper.cache.get(fragment_meta_key(url))
    assert meta["index"].endswith("~art2043") and meta["act_updated"] == "2026-11-18"
    assert meta["parts"] == extract_parts(WHOLE_2043, article="2044")
    validity = await read_validity(scraper.cache, url, article="2044")
    assert validity["act_updated"] == "2026-11-18" and validity["valid_from"] == "2019-05-18"


async def test_the_extras_of_a_fragment_take_the_parts_from_the_index(scraper, monkeypatch):
    source = Normattiva()
    scraper.request_document = source.request_document
    with patch.object(scraper_module.http_client, "request", source.request):
        await scraper.get_document(cc("2043"))
        text, url = await scraper.get_document(cc("2044"))
    monkeypatch.setattr("app.normattiva_scraper", scraper)
    fields = await NormaController._page_extras_for(scraper, cc("2044"), url, text)
    expected = await NormaController._page_extras_for(scraper, cc("2043"), url.replace("2044", "2043"), "x")
    assert fields.keys() == expected.keys()


async def test_a_fragment_that_is_not_the_article_reads_the_whole_page(scraper):
    source = Normattiva(fragment=FRAGMENT_2043)  # Normattiva answers another article
    scraper.request_document = source.request_document
    with patch.object(scraper_module.http_client, "request", source.request):
        await scraper.get_document(cc("2043"))
        _, url = await scraper.get_document(cc("2044"))
    assert [u.endswith("~art2044") for u, _ in source.pages] == [False, True]
    assert await scraper.cache.get(fragment_meta_key(url)) is None


async def test_a_refused_fragment_reads_the_whole_page_and_closes_the_session(scraper):
    source = Normattiva(fail=True)
    scraper.request_document = source.request_document
    with patch.object(scraper_module.http_client, "request", source.request):
        await scraper.get_document(cc("2043"))
        await scraper.get_document(cc("2044"))
    assert len(source.fragments) == 1 and len(source.pages) == 2


async def test_a_dated_article_is_never_read_from_a_fragment(scraper):
    source = Normattiva()
    scraper.request_document = source.request_document
    with patch.object(scraper_module.http_client, "request", source.request):
        await scraper.get_document(cc("2043"))
        await scraper.get_document(cc("2044", versione="vigente", data_versione="2010-01-01"))
    assert source.fragments == []
    assert source.pages[-1][1] is None  # the shared session, as before
