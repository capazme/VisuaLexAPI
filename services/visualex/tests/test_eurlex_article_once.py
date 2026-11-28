"""An EU article's text is extracted once per stored page, not at every read (T133).

The act's page (824 KB for the GDPR) was parsed again for every article read: about 100 ms of CPU
each, the heaviest warm read (scripts/replay_load.py and cProfile,
docs/superpowers/specs/2026-11-28-collectors-speed-design.md). The text is the extractor's on the
page the persistent cache holds, kept under that entry's write time and the article.
"""
import time
from pathlib import Path

import pytest

from visualex_api.services.eurlex_scraper import EurlexScraper
from visualex_api.tools.cache import PersistentCache
from visualex_api.tools.exceptions import DocumentNotFoundError
from visualex_api.tools.page_memo import PAGE_MEMO

pytestmark = pytest.mark.asyncio

GDPR = (Path(__file__).parent / "fixtures" / "eurlex" / "gdpr_oj_trimmed.html").read_text(encoding="utf-8")
URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"


@pytest.fixture
def scraper(tmp_path):
    cache = PersistentCache("eurlex")
    cache.directory = tmp_path / "eurlex"
    cache.directory.mkdir(parents=True, exist_ok=True)
    instance = EurlexScraper.__new__(EurlexScraper)
    instance.cache = cache
    PAGE_MEMO.clear()
    yield instance
    PAGE_MEMO.clear()


def counting_parses(scraper):
    parses = []
    original = scraper.parse_document

    def parse(html):
        parses.append(len(html))
        return original(html)

    scraper.parse_document = parse
    return parses


async def test_the_text_is_the_extractors_and_the_page_is_parsed_once(scraper):
    await scraper.cache.set(URL, GDPR)
    expected = scraper.article_text_of(scraper.parse_document(GDPR), "2")
    parses = counting_parses(scraper)
    for _ in range(5):
        assert await scraper._article_text(URL, "2") == expected
    assert len(parses) == 1


async def test_each_article_is_its_own_answer(scraper):
    await scraper.cache.set(URL, GDPR)
    two = await scraper._article_text(URL, "2")
    seventeen = await scraper._article_text(URL, "17")
    assert two != seventeen
    assert await scraper._article_text(URL, "2") == two


async def test_a_page_written_again_is_read_again(scraper):
    await scraper.cache.set(URL, GDPR)
    await scraper._article_text(URL, "2")
    time.sleep(0.002)
    await scraper.cache.set(URL, GDPR)
    parses = counting_parses(scraper)
    await scraper._article_text(URL, "2")
    assert len(parses) == 1


async def test_a_copy_that_is_no_acts_page_is_fetched_as_before_and_kept_from_the_next_read(scraper):
    await scraper.cache.set(URL, "<html>a firewall's challenge</html>")
    fetched = []

    async def request_document(url, *, source="eurlex"):
        fetched.append(url)
        return GDPR

    scraper.request_document = request_document
    first = await scraper._article_text(URL, "2")
    assert fetched == [URL]
    parses = counting_parses(scraper)
    assert await scraper._article_text(URL, "2") == first  # the kept page, parsed once
    assert await scraper._article_text(URL, "2") == first  # then the memo
    assert fetched == [URL]
    assert len(parses) == 1


async def test_an_article_not_in_the_act_is_an_error_every_time_and_nothing_is_kept(scraper):
    await scraper.cache.set(URL, GDPR)
    for _ in range(2):
        with pytest.raises(DocumentNotFoundError):
            await scraper._article_text(URL, "9999")
    assert len(PAGE_MEMO) == 0


async def test_get_document_answers_from_the_memo(scraper):
    await scraper.cache.set(URL, GDPR)
    text, url = await scraper.get_document(urn=URL, article="2")
    assert url == URL
    assert text == scraper.article_text_of(scraper.parse_document(GDPR), "2")
