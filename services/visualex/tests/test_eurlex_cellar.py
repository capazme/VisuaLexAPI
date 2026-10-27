"""An EU act's page from CELLAR first, EUR-Lex's site second (`services/eurlex_fetch.py`).

Since 25-26 October 2026 eur-lex.europa.eu answers a server with an AWS WAF challenge (202, an
empty body, `x-amzn-waf-action`). CELLAR serves the same Official Journal page; the extractors
read both alike (root CLAUDE.md, rule 23): the pairs below are real pages of the same act from
the two hosts, and every article's text, the tree, the rubriche, the title and the recitals
must come out the same.
"""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from bs4 import BeautifulSoup

from visualex_api.services import eurlex_fetch
from visualex_api.services.eurlex_scraper import EurlexScraper, extract_recitals
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import DocumentNotFoundError, NetworkError
from visualex_api.tools.treextractor import _extract_eurlex_title, _parse_eurlex_tree

pytestmark = pytest.mark.asyncio

FIXTURES = Path(__file__).parent / "fixtures" / "eurlex"


def _read(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


def soup_of(html):
    return BeautifulSoup(html, "html.parser")


GDPR_URL = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita"
EPRIVACY_URL = "https://eur-lex.europa.eu/eli/dir/2002/58/oj/ita"
EPRIVACY_CONS_URL = "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:02002L0058-20091219"


# --- The same act from both hosts --------------------------------------------------------

PAIRS = [
    # (EUR-Lex's page, CELLAR's page of the same act, the URL the app holds)
    ("eprivacy_oj_legacy.html", "cellar_eprivacy_oj_legacy.html", EPRIVACY_URL),
    ("eprivacy_consolidated_20091219.html", "cellar_eprivacy_consolidated_20091219.html", EPRIVACY_CONS_URL),
]


async def _everything(html, url):
    out = {}
    for details in (False, True):
        result, count, metadata = await _parse_eurlex_tree(soup_of(html), url, link=True, details=details)
        out[details] = (result, count, metadata)
    out["recitals"] = extract_recitals(soup_of(html))
    return out


@pytest.mark.parametrize("eurlex_page,cellar_page,url", PAIRS)
async def test_cellar_and_eurlex_pages_read_alike(eurlex_page, cellar_page, url):
    eurlex_html, cellar_html = _read(eurlex_page), _read(cellar_page)
    eurlex, cellar = await _everything(eurlex_html, url), await _everything(cellar_html, url)
    assert cellar == eurlex
    assert eurlex[False][1] > 0
    numbers = [item["numero"] for item in eurlex[False][0]]
    scraper = EurlexScraper()
    for number in numbers:
        expected = await scraper.extract_article_text(soup_of(eurlex_html), number)
        assert await scraper.extract_article_text(soup_of(cellar_html), number) == expected, number


async def test_cellar_modern_page_reads_as_the_oj_page():
    # CELLAR's XHTML (an XML prolog, its own <head>) around the same OJ markup: the act's
    # title and art. 1 as the EUR-Lex page gives them.
    cellar = _read("cellar_gdpr_oj_head_trimmed.html")
    assert cellar.startswith("<?xml")
    assert eurlex_fetch.is_act_page(cellar)
    assert _extract_eurlex_title(soup_of(cellar)).startswith(
        "relativo alla protezione delle persone fisiche con riguardo al trattamento dei dati personali")
    scraper = EurlexScraper()
    expected = await scraper.extract_article_text(soup_of(_read("gdpr_oj_trimmed.html")), "1")
    assert await scraper.extract_article_text(soup_of(cellar), "1") == expected


# --- Which URL is asked of CELLAR ---------------------------------------------------------

@pytest.mark.parametrize("url,celex", [
    (GDPR_URL, "32016R0679"),
    ("https://eur-lex.europa.eu/eli/reg/2024/1689/oj/ita", "32024R1689"),
    ("https://eur-lex.europa.eu/eli/dir/1985/374/oj/ita", "31985L0374"),
    ("https://eur-lex.europa.eu/eli/reg/1962/17/oj/ita", "31962R0017"),
    ("https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:12016E/TXT", "12016E/TXT"),
    ("https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:12016P/TXT", "12016P/TXT"),
    (EPRIVACY_CONS_URL, "02002L0058-20091219"),
])
async def test_the_celex_of_an_url_the_app_builds(url, celex):
    assert eurlex_fetch.celex_of(url) == celex


@pytest.mark.parametrize("url", [
    "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng",  # another language: CELLAR would answer in Italian
    "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    "https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679",
    "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:32016R0679%0A",
    "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:../../sparql",
    "https://eur-lex.europa.eu",
    "https://www.normattiva.it/eli/reg/2016/679/oj/ita",  # another host
    "https://eur-lex.europa.eu.evil.com/eli/reg/2016/679/oj/ita",
])
async def test_no_celex_for_another_url(url):
    assert eurlex_fetch.celex_of(url) is None


# --- The challenge and the page ----------------------------------------------------------

@pytest.mark.parametrize("status,headers,challenge", [
    (202, {"x-amzn-waf-action": "challenge"}, True),
    (202, {"X-Amzn-Waf-Action": "captcha"}, True),
    (202, {}, False),  # a 202 alone is not the firewall
    (200, {"x-amzn-waf-action": "challenge"}, False),
    (200, {}, False),
])
async def test_the_challenge_is_202_with_the_waf_header(status, headers, challenge):
    assert eurlex_fetch.is_waf_challenge(status, headers) is challenge


@pytest.mark.parametrize("page", [None, "", "<html><body></body></html>",
                                  "<html><body>" + "Request rejected. " * 100 + "</body></html>"])
async def test_a_page_without_an_act_is_not_one(page):
    assert not eurlex_fetch.is_act_page(page)


@pytest.mark.parametrize("name", ["gdpr_oj_trimmed.html", "eprivacy_oj_legacy.html",
                                  "eprivacy_consolidated_20091219.html", "cellar_eprivacy_oj_legacy.html",
                                  "cellar_eprivacy_consolidated_20091219.html", "dir_85_374_eli_legacy_text_trimmed.html"])
async def test_every_real_page_is_an_act(name):
    assert eurlex_fetch.is_act_page(_read(name))


# --- CELLAR through the shared client -----------------------------------------------------

DOC = "https://publications.europa.eu/resource/cellar/3e485e15-11bd-11e6-ba9a-01aa75ed71a1.0013.03/DOC_1"
XHTML = {"Content-Type": "application/xhtml+xml;charset=UTF-8"}
PAGE = _read("cellar_gdpr_oj_head_trimmed.html")


def _client(*answers):
    return AsyncMock(side_effect=list(answers))


def _see_other(location):
    return HttpResult(text="", status=303, headers={"Location": location, **XHTML})


async def test_cellar_is_asked_by_celex_and_its_303_followed_over_https():
    request = _client(_see_other(DOC.replace("https://", "http://")), HttpResult(PAGE, 200, XHTML))
    with patch.object(eurlex_fetch.http_client, "request", request):
        assert await eurlex_fetch.fetch_from_cellar(GDPR_URL) == PAGE
    first, second = request.await_args_list
    assert first.args == ("GET", "https://publications.europa.eu/resource/celex/32016R0679")
    assert second.args == ("GET", DOC)  # CELLAR's http:// moved to https
    for call in (first, second):
        assert call.kwargs["source"] == "cellar" and call.kwargs["allow_redirects"] is False
        assert call.kwargs["headers"]["Accept-Language"] == "it"
        assert "application/xhtml+xml" in call.kwargs["headers"]["Accept"]


async def test_a_treaty_celex_is_quoted():
    request = _client(_see_other(DOC), HttpResult(PAGE, 200, XHTML))
    with patch.object(eurlex_fetch.http_client, "request", request):
        await eurlex_fetch.fetch_from_cellar(
            "https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:12016E/TXT")
    assert request.await_args_list[0].args[1] == "https://publications.europa.eu/resource/celex/12016E%2FTXT"


@pytest.mark.parametrize("location", [
    "http://169.254.169.254/latest/meta-data",
    "https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita",
    "https://publications.europa.eu.evil.com/DOC_1",
])
async def test_a_redirect_off_cellar_is_not_followed(location):
    request = _client(_see_other(location))
    with patch.object(eurlex_fetch.http_client, "request", request):
        with pytest.raises(NetworkError):
            await eurlex_fetch.fetch_from_cellar(GDPR_URL)
    assert request.await_count == 1


@pytest.mark.parametrize("answer", [
    HttpResult("", 200, XHTML),  # an empty 200 is no page
    HttpResult("<html><body>Maintenance</body></html>", 200, {"Content-Type": "text/html"}),
    HttpResult("", 202, {"x-amzn-waf-action": "challenge"}),
    HttpResult(PAGE, 200, {"Content-Type": "application/pdf"}),
    HttpResult("<html>files</html>", 300, {"Content-Type": "text/html"}),
    HttpResult(PAGE.replace("Articolo", "Article"), 200, XHTML),  # not the Italian text
])
async def test_cellar_without_the_act_is_an_error(answer):
    with patch.object(eurlex_fetch.http_client, "request", _client(_see_other(DOC), answer)):
        with pytest.raises(NetworkError):
            await eurlex_fetch.fetch_from_cellar(GDPR_URL)


async def test_endless_redirects_are_an_error():
    request = _client(*[_see_other(DOC)] * 5)
    with patch.object(eurlex_fetch.http_client, "request", request):
        with pytest.raises(NetworkError):
            await eurlex_fetch.fetch_from_cellar(GDPR_URL)
    assert request.await_count == 3


async def test_an_url_with_no_celex_never_reaches_cellar():
    request = AsyncMock()
    with patch.object(eurlex_fetch.http_client, "request", request):
        with pytest.raises(DocumentNotFoundError):
            await eurlex_fetch.fetch_from_cellar("https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng")
    request.assert_not_awaited()


# --- CELLAR first, the browser second -----------------------------------------------------

async def test_cellar_serves_and_no_browser_starts():
    browser = AsyncMock()
    with patch.object(eurlex_fetch, "fetch_from_cellar", AsyncMock(return_value=PAGE)), \
            patch.object(eurlex_fetch, "fetch_with_playwright", browser):
        assert await eurlex_fetch.fetch_act_page(GDPR_URL) == PAGE
    browser.assert_not_awaited()


@pytest.mark.parametrize("failure", [NetworkError("CELLAR down", status_code=503),
                                     DocumentNotFoundError("no Italian expression")])
async def test_the_browser_on_eurlex_when_cellar_fails(failure):
    browser = AsyncMock(return_value=PAGE)
    with patch.object(eurlex_fetch, "fetch_from_cellar", AsyncMock(side_effect=failure)), \
            patch.object(eurlex_fetch, "fetch_with_playwright", browser):
        assert await eurlex_fetch.fetch_act_page(GDPR_URL, timeout_ms=45000) == PAGE
    browser.assert_awaited_once_with(GDPR_URL, 45000)


async def test_a_browser_page_without_the_act_is_an_error():
    challenge = "<html><head><script>/* AWS WAF */</script></head><body>" + "x" * 2000 + "</body></html>"
    with patch.object(eurlex_fetch, "fetch_from_cellar", AsyncMock(side_effect=NetworkError("down"))), \
            patch.object(eurlex_fetch, "fetch_with_playwright", AsyncMock(return_value=challenge)):
        with pytest.raises(DocumentNotFoundError):
            await eurlex_fetch.fetch_act_page(GDPR_URL)


async def test_the_browser_never_visits_an_undeclared_host():
    with patch.object(eurlex_fetch, "async_playwright") as playwright:
        with pytest.raises(NetworkError):
            await eurlex_fetch.fetch_with_playwright("http://169.254.169.254\\@eur-lex.europa.eu/eli/reg/2016/679/oj/ita")
    playwright.assert_not_called()


# --- The scraper's copy -------------------------------------------------------------------

class _Copy:
    def __init__(self, data=None):
        self.data = dict(data or {})

    async def get(self, key):
        return self.data.get(key)

    async def set(self, key, value):
        self.data[key] = value


async def test_the_page_from_cellar_is_kept_under_the_eurlex_url():
    scraper = EurlexScraper()
    scraper.cache = _Copy()
    with patch.object(eurlex_fetch, "fetch_act_page", AsyncMock(return_value=PAGE)):
        text, url = await scraper.get_document(act_type="regolamento ue", year="2016", num="679", article="1")
    assert url == GDPR_URL and text.startswith("Articolo 1\nOggetto e finalità")
    assert scraper.cache.data == {GDPR_URL: PAGE}


async def test_a_copy_that_is_no_act_is_fetched_again():
    # A copy kept before pages were checked (a challenge's body) is not read as the act.
    scraper = EurlexScraper()
    scraper.cache = _Copy({GDPR_URL: "<html><body>" + "Request rejected. " * 100 + "</body></html>"})
    fetch = AsyncMock(return_value=PAGE)
    with patch.object(eurlex_fetch, "fetch_act_page", fetch):
        await scraper.get_document(act_type="regolamento ue", year="2016", num="679", article="1")
    fetch.assert_awaited_once_with(GDPR_URL)
    assert scraper.cache.data[GDPR_URL] == PAGE


async def test_a_failed_fetch_keeps_nothing():
    scraper = EurlexScraper()
    scraper.cache = _Copy()
    with patch.object(eurlex_fetch, "fetch_act_page", AsyncMock(side_effect=DocumentNotFoundError("no act"))):
        with pytest.raises(DocumentNotFoundError):
            await scraper.get_document(act_type="regolamento ue", year="2016", num="679", article="1")
    assert scraper.cache.data == {}


# --- The health probes --------------------------------------------------------------------

@pytest.mark.parametrize("answer,state", [
    (HttpResult("", 202, {"x-amzn-waf-action": "challenge"}), "challenge"),
    (HttpResult("<html>EUR-Lex</html>", 200, {}), "ok"),
    (HttpResult("", 200, {}), "error"),  # an empty 200 is no page
    (HttpResult("", 202, {}), "error"),
])
async def test_the_eurlex_probe_names_the_challenge(answer, state):
    with patch.object(eurlex_fetch.http_client, "request", AsyncMock(return_value=answer)):
        assert await eurlex_fetch.probe_eurlex() == state


async def test_a_probe_that_raises_is_an_error():
    with patch.object(eurlex_fetch.http_client, "request", AsyncMock(side_effect=NetworkError("down"))):
        assert await eurlex_fetch.probe_eurlex() == "error"
        assert await eurlex_fetch.probe_cellar() == "error"


@pytest.mark.parametrize("answer,state", [
    (_see_other(DOC.replace("https://", "http://")), "ok"),
    (HttpResult("not found", 404, {}), "error"),
    (_see_other("https://elsewhere.example/DOC_1"), "error"),
    (HttpResult(PAGE, 200, XHTML), "error"),  # the probe never downloads the page
])
async def test_the_cellar_probe_reads_only_the_303(answer, state):
    request = AsyncMock(return_value=answer)
    with patch.object(eurlex_fetch.http_client, "request", request):
        assert await eurlex_fetch.probe_cellar() == state
    assert request.await_args.kwargs["allow_redirects"] is False


@pytest.mark.parametrize("page", [
    ">" + " " * 300000 + "Articolo" + "\xa0" * 300000 + "x",  # NBSP is both `\s` and a blank
    ">Articolo" + "&nbsp;" * 200000 + "x",
    "Articolo" + "\xa0 " * 300000 + "x",
    "<p " + 'class="' + "x " * 200000 + '"></p>',
    'class="ti-ar" ' * 100000,
])
async def test_the_page_checks_stay_linear(page):
    # A run of blanks with no number after it once backtracked through every way of splitting it.
    import time
    start = time.perf_counter()
    assert not eurlex_fetch.is_act_page(page)
    assert eurlex_fetch._ITALIAN.search(page) is None
    assert time.perf_counter() - start < 0.5
