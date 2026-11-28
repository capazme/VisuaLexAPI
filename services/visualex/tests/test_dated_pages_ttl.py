"""A text at a past day, or the original, is kept 30 days (owner, G-648; T133).

Such a text does not change, and every reader of it after the first day sent Normattiva the same
request again, for a page of up to 2.6 MB. Its page now carries a lifetime of its own in the
persistent cache; the text in force (no day) and a text at today keep the day they had.
"""
import json
import time
from datetime import date
from unittest.mock import patch

import pytest

from visualex_api.services import normattiva_scraper as scraper_module
from visualex_api.services.normattiva_scraper import DATED_PAGE_TTL, NormattivaScraper, dated_page_ttl
from visualex_api.tools import cache as cache_module
from visualex_api.tools.cache import PersistentCache
from visualex_api.tools.cache_manager import get_cache_manager
from visualex_api.tools.norma import Norma, NormaVisitata

pytestmark = pytest.mark.asyncio

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1284"
TODAY = date(2026, 11, 28)
DAY = 24 * 3600


@pytest.fixture
def today():
    with patch.object(scraper_module, "today_in_rome", return_value=TODAY):
        yield


@pytest.fixture
def cache(tmp_path):
    store = PersistentCache("normattiva")
    store.directory = tmp_path / "normattiva"
    store.directory.mkdir(parents=True, exist_ok=True)
    return store


def written_at(seconds_ago):
    return patch.object(cache_module.time, "time", return_value=time.time() - seconds_ago)


# --- which pages ---------------------------------------------------------------------------------

@pytest.mark.parametrize("urn,expected", [
    (CC + "!vig=2010-01-01", DATED_PAGE_TTL),        # a past day
    (CC + "!vig=2026-11-27", DATED_PAGE_TTL),        # yesterday
    (CC + "@originale", DATED_PAGE_TTL),             # the original
    (CC + "!vig=2010-01-01#commi701-800", DATED_PAGE_TTL),  # a part of a dated article
    (CC + "!vig=2026-11-28", None),                  # today: the next version may start tomorrow
    (CC + "!vig=", None),                            # the text in force
    (CC, None),
    (None, None),
])
async def test_only_a_past_day_or_the_original_lives_30_days(today, urn, expected):
    assert dated_page_ttl(urn) == expected


# --- the persistent cache ------------------------------------------------------------------------

async def test_an_entry_with_its_own_lifetime_outlives_the_namespaces(cache):
    with written_at(5 * DAY):
        await cache.set("dated", "<html>2010</html>", ttl=DATED_PAGE_TTL)
        await cache.set("undated", "<html>today</html>")
    assert await cache.get("dated") == "<html>2010</html>"
    assert await cache.stamp("dated") is not None
    assert await cache.get("undated") is None
    assert await cache.stamp("undated") is None


async def test_an_entry_past_its_own_lifetime_is_gone(cache):
    with written_at(31 * DAY):
        await cache.set("dated", "<html>2010</html>", ttl=DATED_PAGE_TTL)
    assert await cache.stamp("dated") is None
    assert await cache.get("dated") is None


async def test_the_sweep_reads_each_entrys_lifetime_from_its_head(cache):
    with written_at(5 * DAY):
        await cache.set("dated", "<html>2010</html>", ttl=DATED_PAGE_TTL)
        await cache.set("undated", "<html>today</html>")
    removed, _ = cache.sweep_expired_counted()
    assert removed == 1
    assert await cache.get("dated") == "<html>2010</html>"


async def test_the_head_carries_the_lifetime_and_an_old_entry_still_reads(cache):
    await cache.set("dated", "<html>2010</html>", ttl=DATED_PAGE_TTL)
    raw = cache._path_for_key("dated").read_bytes()
    assert raw.startswith(b'{"timestamp": ') and b'"ttl": 2592000, "data": ' in raw[:96]
    assert cache._head_of(cache._path_for_key("dated"))[1] == DATED_PAGE_TTL
    # an entry written before lifetimes existed: the namespace's day
    cache._path_for_key("old").write_text(json.dumps({"timestamp": time.time(), "data": "<html>old</html>"}))
    assert await cache.get("old") == "<html>old</html>"
    assert cache._head_of(cache._path_for_key("old")) == (pytest.approx(time.time(), abs=5), None)


# --- the scraper ---------------------------------------------------------------------------------

def _page():
    return ('<html><body><div class="bodyTesto"><h2 class="article-num-akn">Art. 1284</h2>'
            '<div class="article-heading-akn">Saggio degli interessi</div>'
            '<div class="art-comma-div-akn">Il saggio degli interessi legali</div></div></body></html>')


@pytest.fixture
async def scraper(cache, monkeypatch):
    monkeypatch.setitem(get_cache_manager().persistent, "normattiva", cache)
    await NormattivaScraper.get_document.cache.clear()
    instance = NormattivaScraper()

    async def request_document(url, *, source="base_scraper"):
        return _page()

    instance.request_document = request_document
    yield instance
    await NormattivaScraper.get_document.cache.clear()


def stored_ttl(cache, key):
    return json.loads(cache._path_for_key(key).read_text()).get("ttl")


async def test_a_page_at_a_past_day_is_stored_for_30_days_and_today_s_for_a_day(today, scraper, cache):
    dated = NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo="1284",
                          versione="vigente", data_versione="2010-01-01")
    current = NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo="1284")
    _, dated_url = await scraper.get_document(dated)
    _, current_url = await scraper.get_document(current)
    assert "!vig=2010-01-01" in dated_url
    assert stored_ttl(cache, dated_url) == DATED_PAGE_TTL
    assert stored_ttl(cache, current_url) is None


async def test_a_dated_page_without_the_article_s_text_is_kept_a_day_as_before(today, scraper, cache):
    async def empty_page(url, *, source="base_scraper"):
        return '<html><body>Servizio momentaneamente non disponibile</body></html>'

    async def no_akn(*args, **kwargs):
        return None

    scraper.request_document = empty_page
    dated = NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo="1284",
                          versione="vigente", data_versione="2010-01-01")
    with patch.object(scraper_module, "fetch_act_article", no_akn):
        with pytest.raises(Exception):
            await scraper.get_document(dated)
    assert stored_ttl(cache, dated.urn) is None


async def test_the_original_is_stored_for_30_days(today, scraper, cache):
    original = NormaVisitata(norma=Norma(tipo_atto="codice civile"), numero_articolo="1284", versione="originale")
    _, url = await scraper.get_document(original)
    assert url.endswith("@originale")
    assert stored_ttl(cache, url) == DATED_PAGE_TTL
