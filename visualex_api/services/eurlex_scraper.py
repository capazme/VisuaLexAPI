import copy
import os
import re
import structlog
from playwright.async_api import async_playwright

from ..tools.map import EURLEX
from ..tools.sys_op import BaseScraper
from ..tools.exceptions import DocumentNotFoundError, NetworkError, ValidationError
from ..tools.cache_manager import get_cache_manager
from ..tools.selectors import EURLexSelectors
from ..tools.treextractor import strip_amendment_markers
from .akn_parser import normalize_article_key

# Configure structured logger
log = structlog.get_logger()

# A consolidated version's CELEX: sector 0, year, type letter, act number,
# then the consolidation date. "02002L0058-20091219" is Dir. 2002/58/CE as
# amended up to 19 December 2009. Sector 3 ("32002L0058") is the OJ act and
# is what the ELI URL already serves, so it is not accepted here. Matched
# with fullmatch and ASCII digits: `$` would let "…-20091219\n" through, and
# `\d` alone accepts other scripts' digits — neither belongs in a URL.
_CONSOLIDATED_CELEX = re.compile(r"0\d{4}[A-Z]\d{4}-\d{8}", re.ASCII)


# --- Recitals -------------------------------------------------------------
#
# Two markups. The modern OJ page (acts published since ~2014) wraps every
# recital in <div class="eli-subdivision" id="rct_N"> holding a two-cell table:
# "(N)" on the left, the text on the right. Older acts are served class-less:
# a run of <p>(N) …</p> between "considerando quanto segue:" and the enacting
# formula ("HA/HANNO ADOTTATO …"). Consolidated texts have no preamble at all.
_RECITAL_DIV_ID = re.compile(r"^rct_(\d+)$")
_RECITAL_NUMBER_ONLY = re.compile(r"^\(\d+\)$")
_LEGACY_RECITAL = re.compile(r"^\((\d+)\)\s+(.*)$", re.S)
_LEGACY_PREAMBLE_MARKER = re.compile(r"considerando quanto segue", re.I)
_LEGACY_ENACTING_FORMULA = re.compile(r"^HA(?:NNO)?\s+ADOTTAT[OA]\b", re.I)


def _strip_footnote_marks(element) -> None:
    """Remove "(18)"-style footnote call-outs in place.

    EUR-Lex renders them as <a>(<span class="oj-note-tag">18</span>)</a>; the
    anchor's whole text is the parenthesised number, so dropping the anchor
    leaves the sentence intact. The soup is built per request from the cached
    HTML, so mutating it here is local to this call.
    """
    for span in element.find_all("span", class_="oj-note-tag"):
        anchor = span.find_parent("a")
        target = anchor if anchor is not None else span
        if _RECITAL_NUMBER_ONLY.match(target.get_text(strip=True) or ""):
            target.decompose()


def _extract_recitals_modern(soup) -> list[dict]:
    recitals = []
    for div in soup.find_all("div", id=_RECITAL_DIV_ID):
        number = _RECITAL_DIV_ID.match(div["id"]).group(1)
        _strip_footnote_marks(div)
        paragraphs = []
        for p in div.find_all("p"):
            text = p.get_text(" ", strip=True)
            if not text or _RECITAL_NUMBER_ONLY.match(text):
                continue  # the "(N)" cell
            paragraphs.append(text)
        if paragraphs:
            recitals.append({"number": number, "text": "\n".join(paragraphs)})
    return recitals


def _extract_recitals_legacy(soup) -> list[dict]:
    marker = soup.find("p", string=_LEGACY_PREAMBLE_MARKER)
    if marker is None:
        return []
    recitals = []
    expected = 1
    for p in marker.find_all_next("p"):
        text = p.get_text(" ", strip=True)
        if _LEGACY_ENACTING_FORMULA.match(text):
            break
        match = _LEGACY_RECITAL.match(text)
        if not match:
            continue
        number, body = match.group(1), match.group(2).strip()
        # Footnote paragraphs also read "(4) …"; a recital number is the next
        # one in the sequence, nothing else.
        if int(number) != expected:
            continue
        recitals.append({"number": number, "text": body})
        expected += 1
    return recitals


def extract_recitals(soup) -> list[dict]:
    """Recitals of an EU act as ``[{"number": "1", "text": "…"}, …]``.

    Modern markup first; the legacy paragraph walk only when the page has no
    ``rct_N`` divs. A consolidated text yields ``[]``: it has no preamble.
    """
    recitals = _extract_recitals_modern(soup)
    if recitals:
        return recitals
    return _extract_recitals_legacy(soup)


# --- Consolidated texts ---------------------------------------------------
#
# EUR-Lex renders a consolidated version with a markup of its own: the number
# is <p class="title-article-norm">Articolo 5</p> (an ordinal suffix as
# <span class="norm">bis</span>), the rubrica <p class="stitle-article-norm">
# (bare, or inside <div class="eli-title">), the body in `norm` paragraphs or
# divs with `no-parag` numbers and `grid-list` tables for lettered points,
# and <p class="modref">▼M1</p> markers naming the amending act before each
# changed block. Recent consolidations wrap every article in
# <div class="eli-subdivision" id="art_N">; older ones are flat.
_CONS_ARTICLE_CLASS = "title-article-norm"
_CONS_RUBRICA_CLASS = "stitle-article-norm"
_CONS_SKIP_CLASSES = {"modref", "separator", "separator-short", "hd-modifiers", "footnote", "arrow"}
_CONS_BODY_CLASSES = {"norm", "grid-container", "grid-list", "list", "no-parag"}


def is_consolidated_markup(soup) -> bool:
    return soup.find("p", class_=_CONS_ARTICLE_CLASS) is not None


def _element_classes(element) -> set:
    return set(element.get("class", []) or [])


def _cons_text(element) -> str:
    # A `modref` marker ("▼M2", or "▼M2 —————" for a deleted point) is a
    # sibling of the article title only on older pages; a recent consolidation
    # nests it inside `div.norm` and the point grids, where a class check on
    # the sibling cannot see it. The soup is parsed per request, so removing
    # the markers in place is local to this call.
    for marker in element.find_all(class_="modref"):
        marker.decompose()
    # A separator between child nodes: "1." sits in its own span next to the
    # paragraph text, and NBSP is EUR-Lex's favourite space.
    text = strip_amendment_markers(element.get_text(" ", strip=True))
    # The separator also lands before punctuation when EUR-Lex closes a span
    # early: <span class="no-parag">1 <span class="italics">quater</span>. </span>
    # read "1 quater ." while "1 bis." elsewhere keeps the period inside the
    # span, and "lettera a )" / "articolo 14 bis , paragrafo 2" likewise.
    # Consolidated path only: the OJ extractor never comes through here.
    text = re.sub(r"\s+([.,;:)])", r"\1", text)
    # The same separator lands after an opening bracket: a footnote reference
    # is literal parens around a superscript link, (<a><span>1</span></a>),
    # and read "( 1 )" — the page shows "(1)".
    return re.sub(r"([(«])\s+", r"\1", text)


def _is_cons_point(element) -> bool:
    """A lettered or numbered point: a `grid-list` div on recent pages
    ("a) " in `grid-list-column-1`, the text in `grid-list-column-2`), a
    table row on older ones."""
    if element.name == "tr":
        return True
    return element.name == "div" and "grid-list" in _element_classes(element)


def _cons_points(element) -> list:
    """The outermost point containers below `element`, in document order.

    A point nested in another point (art. 3 n. 16 of eIDAS lists a) to d)
    inside the definition) belongs to that point's own lines, so the walk
    stops at the first point it meets on each branch.
    """
    points = []
    for child in element.find_all(recursive=False):
        if _is_cons_point(child):
            points.append(child)
        else:
            points.extend(_cons_points(child))
    return points


def _is_bare_point_wrapper(element) -> bool:
    """A class-less `<div style="margin-left: 24pt">` holding a `p.norm`: how
    the older flat pages (02002L0058) render "a) «utente»: …". Without it
    the 13 lettered points of art. 2, 4 and 10 of the ePrivacy directive were
    not text at all."""
    return (element.name == "div" and not _element_classes(element)
            and element.find(class_="norm") is not None)


def _cons_lines(element) -> list[str]:
    """One line per point, whatever the markup nests.

    A paragraph whose points sit inside its own `div.norm` yields its lead-in
    first ("3. Il quadro di interoperabilità risponde ai seguenti criteri:")
    and then one line per point; a point holding sub-points does the same;
    an element with no points is one line. This is the shape the OJ path
    gives through `extract_table_text` — one row, one line — and the archive
    anchors on it (gotcha 23), so it must not depend on where EUR-Lex chose
    to put the grid.
    """
    points = _cons_points(element)
    if not points:
        text = _cons_text(element)
        return [text] if text else []
    # The lead-in is the element's text with the points taken out. A copy is
    # detached from the soup, so the points stay in place for the lines below.
    lead = copy.copy(element)
    for point in _cons_points(lead):
        point.decompose()
    lines = []
    head = _cons_text(lead)
    if head:
        lines.append(head)
    for point in points:
        lines.extend(_cons_lines(point))
    return lines


def _cons_find_title(soup, article):
    wanted = normalize_article_key(str(article))
    for marker in soup.find_all("p", class_=_CONS_ARTICLE_CLASS):
        if normalize_article_key(marker.get_text(" ", strip=True)) == wanted:
            return marker
    return None


def extract_article_consolidated(soup, article) -> "str | None":
    """Article text from a consolidated page, or None when the page lacks it.

    Same line structure as the OJ extractor — "Articolo N", the rubrica, one
    line per paragraph, one line per lettered point — so a client sees the
    same shape whichever version it asked for. Modification markers are not
    text and are dropped.
    """
    title = _cons_find_title(soup, article)
    if title is None:
        return None
    lines = [_cons_text(title)]
    for sibling in title.find_next_siblings():
        classes = _element_classes(sibling)
        # Stop at the next article, the next chapter or annex heading, or
        # the amendments table. The `eli-subdivision` stop is for a flat page
        # whose next article is wrapped; on a subdivision page the walk ends
        # with the article's own div, since the title has no later siblings.
        if (_CONS_ARTICLE_CLASS in classes or "eli-subdivision" in classes
                or "hd-modifiers" in classes
                or any(c.startswith(("title-division", "title-annex")) for c in classes)):
            break
        if _CONS_RUBRICA_CLASS in classes:
            lines.append(_cons_text(sibling))
            continue
        if "eli-title" in classes:
            rubrica = sibling.find("p", class_=_CONS_RUBRICA_CLASS)
            if rubrica is not None:
                lines.append(_cons_text(rubrica))
            continue
        if classes & _CONS_SKIP_CLASSES:
            continue
        if (sibling.name == "table" or classes & _CONS_BODY_CLASSES
                or _is_bare_point_wrapper(sibling)):
            lines.extend(_cons_lines(sibling))
    return "\n".join(lines)


class EurlexScraper(BaseScraper):
    def __init__(self):
        self.base_url = 'https://eur-lex.europa.eu/eli'
        self.cache = get_cache_manager().get_persistent("eurlex")
        self.selectors = EURLexSelectors()
        log.info("EUR-Lex scraper initialized with Playwright")

    async def _fetch_with_playwright(self, url: str) -> str:
        """Fetch URL using Playwright to bypass CloudFront WAF protection."""
        log.info(f"Consulting EUR-Lex with Playwright - URL: {url}")
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
                await page.goto(url, wait_until='networkidle', timeout=30000)
                html = await page.content()
                await context.close()
                return html
            finally:
                await browser.close()

    async def request_document(self, url, *, source: str = "eurlex"):
        """Override base request_document to use Playwright for WAF bypass."""
        try:
            html = await self._fetch_with_playwright(url)
            if not html or len(html) < 1000:
                raise DocumentNotFoundError(f"Document not found or empty at {url}", urn=url)
            log.debug("EUR-Lex document fetched successfully with Playwright")
            return html
        except DocumentNotFoundError:
            raise
        except Exception as e:
            log.error(f"Error during EUR-Lex consultation: {e}")
            raise NetworkError(f"Failed to fetch EUR-Lex document: {e}")

    def get_uri(self, act_type, year, num, celex_consolidated=None):
        log.debug(f"get_uri called with act_type={act_type}, year={year}, num={num}, "
                  f"celex_consolidated={celex_consolidated}")

        if celex_consolidated:
            if not _CONSOLIDATED_CELEX.fullmatch(str(celex_consolidated)):
                raise ValidationError(
                    f"celex_consolidated non valido: {celex_consolidated!r} "
                    "(atteso il CELEX di una versione consolidata, es. 02002L0058-20091219)"
                )
            uri = f"https://eur-lex.europa.eu/legal-content/IT/TXT/HTML/?uri=CELEX:{celex_consolidated}"
            log.info(f"Consolidated version requested. URI: {uri}")
            return uri

        # EUR-Lex only needs the year, not full date (YYYY-MM-DD → YYYY)
        if year and '-' in str(year):
            year = str(year).split('-')[0]

        if act_type in EURLEX and EURLEX[act_type].startswith('https'):
            uri = EURLEX[act_type]
            log.info(f"Act type is a treaty. Using predefined URI: {uri}")
        else:
            uri = f'{self.base_url}/{EURLEX[act_type]}/{year}/{num}/oj/ita'
            log.info(f"Constructed URI for regulation or directive: {uri}")

        return uri

    async def _load_soup(self, url: str):
        """The parsed page for ``url``, from the persistent cache when it has it.

        One page carries the whole act — tree, articles, rubriche and recitals
        — so every extractor goes through here and the WAF is crossed once.
        """
        cached_html = await self.cache.get(url)
        if cached_html:
            log.info("Cache hit", source="eurlex_persistent")
            return self.parse_document(cached_html)
        html_content = await self.request_document(url)
        await self.cache.set(url, html_content)
        return self.parse_document(html_content)

    async def get_recitals(self, norma) -> tuple[list[dict], str]:
        """All recitals (considerando) of an EU act, and the page they came from.

        ``norma.url`` is the act page (the OJ version: consolidated texts carry
        no preamble, so a consolidated URL yields an empty list).
        """
        url = norma.url
        log.info("Fetching EUR-Lex recitals", url=url)
        soup = await self._load_soup(url)
        recitals = extract_recitals(soup)
        log.info("EUR-Lex recitals extracted", url=url, count=len(recitals))
        return recitals, url

    async def get_document(self, normavisitata=None, act_type=None, article=None, year=None, num=None, urn=None):
        log.info(f"Fetching EUR-Lex document with parameters {normavisitata.to_dict() if normavisitata else {}}: act_type={act_type}, article={article}, year={year}, num={num}, urn={urn}")

        if normavisitata:
            urn = normavisitata.urn
            act_type = normavisitata.norma.tipo_atto_urn
            year = normavisitata.norma.data
            num = normavisitata.norma.numero_atto
            article = normavisitata.numero_articolo
            log.debug(f"Using normavisitata with act_type={act_type}, year={year}, num={num}, article={article}")

        if not urn:
            if act_type not in EURLEX:
                log.error(f"Invalid act_type '{act_type}' not found in EURLEX map")
                raise DocumentNotFoundError(
                    f"Act type '{act_type}' not found in EUR-Lex mapping",
                    urn=f"eurlex:{act_type}"
                )
            url = self.get_uri(act_type=act_type, year=year, num=num)
        else:
            url = urn

        soup = await self._load_soup(url)

        if article:
            log.info(f"Extracting text for article {article}")
            return await self.extract_article_text(soup, article), url
        else:
            log.info("Returning full document text")
            return soup.get_text(), url

    async def extract_article_text(self, soup, article):
        log.info(f"Searching for article {article} in the document")

        if is_consolidated_markup(soup):
            text = extract_article_consolidated(soup, article)
            if text is None:
                log.warning(f"Article {article} not found in the consolidated document")
                raise DocumentNotFoundError(
                    f"Article {article} not found in EUR-Lex consolidated document",
                    urn=soup.find('link', rel='canonical')['href'] if soup.find('link', rel='canonical') else None
                )
            log.info(f"Article {article} text extracted from consolidated markup")
            return text

        # Multiple patterns to find article header (EUR-Lex structure may vary)
        search_patterns = [
            f"Articolo {article}",
            f"Article {article}",
            f"Art. {article}",
        ]

        article_section = None

        # Strategy 1: Look for <p class="ti-art"> (original selector)
        for pattern in search_patterns:
            article_section = soup.find(lambda tag: tag.name == 'p' and 'ti-art' in tag.get('class', []) and tag.get_text(strip=True).startswith(pattern))
            if article_section:
                log.debug(f"Found article with ti-art class using pattern: {pattern}")
                break

        # Strategy 2: Look for any element with class containing 'art' or 'title'
        if not article_section:
            for pattern in search_patterns:
                article_section = soup.find(lambda tag: tag.get('class') and any('art' in c.lower() or 'title' in c.lower() for c in tag.get('class', [])) and tag.get_text(strip=True).startswith(pattern))
                if article_section:
                    log.debug(f"Found article with art/title class using pattern: {pattern}")
                    break

        # Strategy 3: Look for any element whose text matches article pattern exactly
        if not article_section:
            article_regex = re.compile(rf'^Articolo\s+{re.escape(str(article))}\b', re.IGNORECASE)
            article_section = soup.find(lambda tag: tag.name in ['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] and article_regex.match(tag.get_text(strip=True)))
            if article_section:
                log.debug("Found article using regex text match")

        # Strategy 4: Search in eli-subdivision divs (common EUR-Lex structure)
        if not article_section:
            subdivisions = soup.find_all('div', class_=lambda c: c and 'eli-subdivision' in c)
            for subdiv in subdivisions:
                title_elem = subdiv.find(['p', 'span', 'div'], string=lambda s: s and any(s.strip().startswith(p) for p in search_patterns))
                if title_elem:
                    article_section = subdiv
                    log.debug("Found article in eli-subdivision")
                    break

        if not article_section:
            log.warning(f"Article {article} not found in the document after all strategies")
            raise DocumentNotFoundError(
                f"Article {article} not found in EUR-Lex document",
                urn=soup.find('link', rel='canonical')['href'] if soup.find('link', rel='canonical') else None
            )

        log.debug("Article found, extracting text")
        full_text = [article_section.get_text(strip=True)]
        element = article_section.find_next_sibling()

        # Detect end of article by finding next article
        next_article_pattern = re.compile(r'^Articolo\s+\d+|^Article\s+\d+|^Art\.\s+\d+', re.IGNORECASE)

        while element:
            # Check if we've reached the next article
            if element.name == 'p' and 'ti-art' in element.get('class', []):
                log.debug("Next article section found (ti-art class), stopping extraction")
                break
            elem_text = element.get_text(strip=True) if element.name else ''
            if next_article_pattern.match(elem_text):
                log.debug("Next article section found (text pattern), stopping extraction")
                break
            if element.name in ['p', 'div', 'span']:
                text = element.get_text(strip=True)
                if text:
                    full_text.append(text)
            elif element.name == 'table':
                full_text.extend(self.extract_table_text(element))
            element = element.find_next_sibling()

        log.info(f"Article {article} text extracted successfully")
        return "\n".join(full_text)

    def extract_table_text(self, table):
        log.debug("Extracting text from table")
        rows = table.find_all('tr')
        table_text = []

        for row in rows:
            cells = row.find_all('td')
            row_text = ' '.join(cell.get_text(strip=True) for cell in cells)
            table_text.append(row_text)

        log.debug("Table text extracted successfully")
        return table_text
