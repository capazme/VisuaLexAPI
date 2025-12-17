import os
import re
import structlog
from playwright.async_api import async_playwright

from ..tools.map import EURLEX
from ..tools.sys_op import BaseScraper
from ..tools.exceptions import DocumentNotFoundError, NetworkError
from ..tools.cache_manager import get_cache_manager
from ..tools.selectors import EURLexSelectors

# Configure structured logger
log = structlog.get_logger()


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

    def get_uri(self, act_type, year, num):
        log.debug(f"get_uri called with act_type={act_type}, year={year}, num={num}")

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

        # Check persistent cache first
        cache_key = url
        cached_html = await self.cache.get(cache_key)
        if cached_html:
            log.info("Cache hit", source="eurlex_persistent")
            soup = self.parse_document(cached_html)
        else:
            html_content = await self.request_document(url)
            await self.cache.set(cache_key, html_content)
            soup = self.parse_document(html_content)

        if article:
            log.info(f"Extracting text for article {article}")
            return await self.extract_article_text(soup, article), url
        else:
            log.info("Returning full document text")
            return soup.get_text(), url

    async def extract_article_text(self, soup, article):
        log.info(f"Searching for article {article} in the document")

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
