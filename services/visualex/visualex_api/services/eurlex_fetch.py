"""Where an EU act's page comes from: CELLAR first, EUR-Lex's own site second.

Since the night of 25-26 October 2026 eur-lex.europa.eu answers every request that is not a
browser with an AWS WAF challenge: HTTP 202, an empty body and `x-amzn-waf-action: challenge`.
The same Office's repository, CELLAR (publications.europa.eu), serves the same Official Journal
page by CELEX: asked for XHTML in Italian it answers a 303 to the expression's document, then
the page. The extractors read both alike — the tree, the rubriche, the title, the recitals and
every article's text came out identical on 23 real acts, 1962 to 2024, the Treaties and two
consolidations (root CLAUDE.md, rule 23) — so CELLAR is asked first, always, through the
shared client: its host check, its per-source pause, no browser. EUR-Lex's page, through the
browser that can pass the challenge, is the second chance, for a URL with no CELEX to ask
CELLAR for or a CELLAR that does not serve it.

The URL a caller holds stays EUR-Lex's: it is what the reader is shown and what the copies
are keyed by. Only the fetch moves.
"""
from __future__ import annotations

import re
from urllib.parse import parse_qs, quote, urljoin, urlparse

import structlog
from playwright.async_api import async_playwright

from ..tools.egress import is_allowed
from ..tools.exceptions import DocumentNotFoundError, NetworkError
from .decisions.http import http_headers
from .http_client import http_client

log = structlog.get_logger()

CELLAR_CELEX = "https://publications.europa.eu/resource/celex/"
_CELLAR_HOST = "publications.europa.eu"
_EURLEX_HOST = "eur-lex.europa.eu"

# The act the health probe asks CELLAR for (the GDPR): its 303 is enough, the page is not read.
_PROBE_CELEX = "32016R0679"

# The Official Journal page the scraper builds (`EurlexScraper.get_uri`): /eli/reg/2016/679/oj/ita.
_ELI_OJ_ITA = re.compile(r"/eli/(reg|dir)/(\d{4})/(\d{1,4})/oj/ita/?", re.ASCII)
# A CELEX the app writes in a legal-content URL: an act (32016R0679), a Treaty (12016E/TXT), a
# consolidation (02002L0058-20091219). Anything else is not asked of CELLAR.
_CELEX = re.compile(r"[0-9]{5}[A-Z]{1,2}[0-9]{0,4}(?:/TXT|-[0-9]{8})?", re.ASCII)

# What a page must carry to be an EU act's, on either host: an OJ article heading's class
# (`oj-ti-art`, the Treaties' `ti-art`), a consolidation's (`title-article-norm`), or, on a
# class-less legacy page, the first article's heading. An empty 200, a challenge or an error page
# carries none, and is neither served nor kept.
# The blanks are matched possessively and `\s` already holds NBSP: a long run of blanks with no
# number after it costs one pass, not a backtrack through every way of splitting it.
_ACT_MARKER = re.compile(
    r'class="[^"]*\bti-art\b|title-article-norm'
    r'|>\s*+(?:Articolo|Article|Art\.)(?:\s|&nbsp;|&#160;)++(?:1|primo|unico)\b',
    re.IGNORECASE)

# CELLAR is asked for Italian; an act it held only in other languages must not come back as
# another language's text. Every Italian page, whatever its markup, names its articles so.
_ITALIAN = re.compile(r"\bArticolo(?:\s|&nbsp;|&#160;)++\d")

_REDIRECTS = {301, 302, 303, 307, 308}
_MAX_HOPS = 3


def is_waf_challenge(status: int, headers) -> bool:
    """EUR-Lex's firewall asking for a browser: status 202 with the `x-amzn-waf-action` header.
    Nothing else is read as a challenge, and a challenge is never read as a page."""
    return status == 202 and any(key.lower() == "x-amzn-waf-action" for key in (headers or {}))


def is_act_page(html) -> bool:
    """True when `html` is an EU act's page (`_ACT_MARKER`): the test before a page is served
    or kept in a copy."""
    return isinstance(html, str) and _ACT_MARKER.search(html) is not None


def celex_of(url: str) -> str | None:
    """The CELEX behind an Italian EUR-Lex URL the app builds, or None: the OJ page by ELI
    (`/eli/reg/2016/679/oj/ita` → 32016R0679) or a `legal-content/IT` page by CELEX. Another
    language, another host or another shape is not asked of CELLAR, which would answer in
    Italian or not at all."""
    try:
        parsed = urlparse(url)
    except (TypeError, ValueError):
        return None
    if parsed.hostname != _EURLEX_HOST:
        return None
    eli = _ELI_OJ_ITA.fullmatch(parsed.path)
    if eli:
        kind, year, number = eli.groups()
        return f"3{year}{'R' if kind == 'reg' else 'L'}{int(number):04d}"
    if parsed.path.rstrip("/") == "/legal-content/IT/TXT/HTML":
        uri = parse_qs(parsed.query).get("uri", [""])[0]
        if uri.startswith("CELEX:") and _CELEX.fullmatch(uri[len("CELEX:"):]):
            return uri[len("CELEX:"):]
    return None


def _header(headers, name: str) -> str:
    return next((value for key, value in (headers or {}).items() if key.lower() == name), "")


async def fetch_from_cellar(url: str) -> str:
    """The page of the act behind EUR-Lex's `url`, from CELLAR, or an error.

    Two requests: the CELEX resource answers a 303 to the Italian expression's document, then
    the document. The redirect is followed here, not by aiohttp: CELLAR points to plain http,
    and the client does not re-check a redirect's host, so each hop is moved to https and
    checked against the allow-list before it is asked."""
    celex = celex_of(url)
    if celex is None:
        raise DocumentNotFoundError(f"Nessun CELEX da chiedere a CELLAR per {url[:80]}", urn=url)
    target = CELLAR_CELEX + quote(celex, safe="")
    headers = http_headers({"Accept": "application/xhtml+xml,text/html", "Accept-Language": "it"})
    for _ in range(_MAX_HOPS):
        result = await http_client.request("GET", target, source="cellar", max_retries=1,
                                           allow_redirects=False, headers=headers)
        if result.status not in _REDIRECTS:
            break
        location = urlparse(urljoin(target, _header(result.headers, "location")))
        if location.scheme == "http":
            location = location._replace(scheme="https")
        target = location.geturl()
        if location.hostname != _CELLAR_HOST or not is_allowed(target):
            raise NetworkError(f"CELLAR: rinvio fuori dall'archivio ({target[:80]})", status_code=result.status)
    else:
        raise NetworkError(f"CELLAR: troppi rinvii per {celex}")
    content_type = _header(result.headers, "content-type").lower()
    if (result.status != 200 or "html" not in content_type or not is_act_page(result.text)
            or not _ITALIAN.search(result.text)):
        raise NetworkError(f"CELLAR: nessun atto per {celex} ({result.status}, {content_type[:40]})",
                           status_code=result.status)
    log.info("EU act page from CELLAR", celex=celex, size=len(result.text))
    return result.text


async def fetch_with_playwright(url: str, timeout_ms: int = 30000) -> str:
    """EUR-Lex's page through a real browser, which passes the firewall's challenge. Only a
    declared host is visited (`is_allowed`); what the page then loads is not re-checked."""
    if not is_allowed(url):
        raise NetworkError(f"Host non consentito: {url[:80]}", status_code=403)
    log.info("Consulting EUR-Lex with Playwright", url=url)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )
        try:
            context = await browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            page = await context.new_page()
            await page.goto(url, wait_until='networkidle', timeout=timeout_ms)
            html = await page.content()
            await context.close()
            return html
        finally:
            await browser.close()


async def fetch_act_page(url: str, timeout_ms: int = 30000) -> str:
    """The act's page for EUR-Lex's `url`: CELLAR's, else the browser's visit to EUR-Lex. A page
    that is no act's (`is_act_page`) is an error from either, never an answer."""
    try:
        return await fetch_from_cellar(url)
    except (NetworkError, DocumentNotFoundError) as exc:
        log.warning("CELLAR did not serve the act; trying EUR-Lex's site", url=url[:120], error=str(exc))
    html = await fetch_with_playwright(url, timeout_ms)
    if not is_act_page(html):
        raise DocumentNotFoundError(f"EUR-Lex: nessun atto nella pagina (sfida anti-bot?) {url[:80]}", urn=url)
    return html


async def probe_eurlex() -> str:
    """EUR-Lex's site, one request without a browser: "ok", "challenge" or "error"."""
    try:
        result = await http_client.request("GET", f"https://{_EURLEX_HOST}", source="health_check",
                                           max_retries=0)
    except Exception:  # noqa: BLE001 — a probe reports, it does not raise
        return "error"
    if is_waf_challenge(result.status, result.headers):
        return "challenge"
    return "ok" if result.status == 200 and result.text.strip() else "error"


async def probe_cellar() -> str:
    """CELLAR, one request: the GDPR's CELEX resolves to its Italian document ("ok") or not."""
    try:
        result = await http_client.request(
            "GET", CELLAR_CELEX + _PROBE_CELEX, source="health_check", max_retries=0,
            allow_redirects=False,
            headers=http_headers({"Accept": "application/xhtml+xml,text/html", "Accept-Language": "it"}))
    except Exception:  # noqa: BLE001
        return "error"
    location = urlparse(urljoin(CELLAR_CELEX, _header(result.headers, "location")))
    return "ok" if result.status == 303 and location.hostname == _CELLAR_HOST else "error"
