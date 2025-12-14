import structlog
import re
import os
from typing import Optional, Tuple, Union, Dict, Any, List

import requests
from bs4 import BeautifulSoup
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer

from ..tools.map import BROCARDI_CODICI
from ..tools.norma import NormaVisitata
from ..tools.text_op import normalize_act_type
from ..tools.sys_op import BaseScraper
from ..tools.cache_manager import get_cache_manager
from .http_client import http_client
from ..tools.exceptions import DocumentNotFoundError
from ..tools.selectors import BrocardiSelectors

# Configure structured logger
log = structlog.get_logger()

# Costante per il base URL
BASE_URL: str = "https://brocardi.it"


class BrocardiScraper(BaseScraper):
    def __init__(self) -> None:
        log.info("Initializing BrocardiScraper")
        self.knowledge: List[Dict[str, Any]] = [BROCARDI_CODICI]
        self.cache = get_cache_manager().get_persistent("brocardi")
        self.selectors = BrocardiSelectors()

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def do_know(self, norma_visitata: NormaVisitata) -> Optional[Tuple[str, str]]:
        log.info(f"Checking if knowledge exists for norma: {norma_visitata}")

        norma_str: Optional[str] = self._build_norma_string(norma_visitata)
        if norma_str is None:
            log.error("Invalid norma format")
            raise DocumentNotFoundError(
                "Invalid norma format for Brocardi lookup",
                urn=str(norma_visitata)
            )

        search_str = norma_str.lower()
        for txt, link in self.knowledge[0].items():
            if search_str in txt.lower():
                log.info(f"Knowledge found for norma: {norma_visitata}")
                return txt, link

        log.warning(f"No knowledge found for norma: {norma_visitata}")
        return None

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def look_up(self, norma_visitata: NormaVisitata) -> Optional[str]:
        log.info(f"Looking up norma: {norma_visitata}")

        norma_info = await self.do_know(norma_visitata)
        if not norma_info:
            return None

        link: str = norma_info[1]
        # Recupera il contenuto della pagina principale
        soup = await self._fetch_soup(link, cache_suffix="main", source="brocardi_main")
        if soup is None:
            log.error(f"Failed to retrieve content for norma link: {link}")
            return None

        numero_articolo: Optional[str] = (
            norma_visitata.numero_articolo.replace('-', '')
            if norma_visitata.numero_articolo else None
        )
        if numero_articolo:
            article_link = await self._find_article_link(soup, BASE_URL, numero_articolo)
            return article_link
        log.info("No article number provided")
        return None

    async def _find_article_link(self, soup: BeautifulSoup, base_url: str, numero_articolo: str) -> Optional[str]:
        # Compila il pattern una sola volta
        pattern = re.compile(rf'href=["\']([^"\']*art{re.escape(numero_articolo)}\.html)["\']')
        log.info("Searching for target link in the main page content")

        # Utilizza str(soup) invece di prettify per migliorare le performance
        matches = pattern.findall(str(soup))
        if matches:
            return requests.compat.urljoin(base_url, matches[0])

        log.info("No direct match found, searching in 'section-title' divs")
        section_titles = soup.find_all('div', class_='section-title')
        for section in section_titles:
            for a_tag in section.find_all('a', href=True):
                sub_link = requests.compat.urljoin(base_url, a_tag.get('href', ''))
                sub_soup = await self._fetch_soup(sub_link, cache_suffix="section", source="brocardi_section")
                if not sub_soup:
                    continue
                sub_matches = pattern.findall(str(sub_soup))
                if sub_matches:
                    return requests.compat.urljoin(base_url, sub_matches[0])

        log.info("No matching article found")
        return None

    async def get_info(self, norma_visitata: NormaVisitata) -> Tuple[Optional[str], Dict[str, Any], Optional[str]]:
        log.info(f"Getting info for norma: {norma_visitata}")

        norma_link = await self.look_up(norma_visitata)
        if not norma_link:
            return None, {}, None

        soup = await self._fetch_soup(norma_link, cache_suffix="article", source="brocardi_article")
        if soup is None:
            log.error(f"Failed to retrieve content for norma link: {norma_link}")
            return None, {}, None

        info: Dict[str, Any] = {}
        info['Position'] = self._extract_position(soup)
        self._extract_sections(soup, info)
        return info.get('Position'), info, norma_link

    def _extract_position(self, soup: BeautifulSoup) -> Optional[str]:
        position_tag = soup.find('div', id='breadcrumb', recursive=True)
        if position_tag:
            # Mantiene la logica originale di slicing
            return position_tag.get_text(strip=False).replace('\n', '').replace('  ', '')[17:]
        log.warning("Breadcrumb position not found")
        return None

    def _extract_sections(self, soup: BeautifulSoup, info: Dict[str, Any]) -> None:
        corpo = soup.find('div', class_='panes-condensed panes-w-ads content-ext-guide content-mark', recursive=True)
        if not corpo:
            log.warning("Main content section not found")
            return

        brocardi_sections = corpo.find_all('div', class_='brocardi-content')
        if brocardi_sections:
            info['Brocardi'] = [section.get_text(strip=False) for section in brocardi_sections]

        ratio_section = corpo.find('div', class_='container-ratio')
        if ratio_section:
            ratio_text = ratio_section.find('div', class_='corpoDelTesto')
            if ratio_text:
                info['Ratio'] = ratio_text.get_text(strip=False)

        spiegazione_header = corpo.find('h3', string=lambda text: text and "Spiegazione dell'art" in text)
        if spiegazione_header:
            spiegazione_content = spiegazione_header.find_next_sibling('div', class_='text')
            if spiegazione_content:
                info['Spiegazione'] = spiegazione_content.get_text(strip=False)

        massime_header = corpo.find('h3', string=lambda text: text and "Massime relative all'art" in text)
        if massime_header:
            massime_content = massime_header.find_next_sibling('div', class_='text')
            if massime_content:
                info['Massime'] = [massima.get_text(strip=False) for massima in massime_content]

    def _build_norma_string(self, norma_visitata: Union[NormaVisitata, str]) -> Optional[str]:
        if isinstance(norma_visitata, NormaVisitata):
            norma = norma_visitata.norma
            tipo_norm = normalize_act_type(norma.tipo_atto_str, True, 'brocardi')
            components = [tipo_norm]
            if norma.data:
                components.append(f"{norma.data},")
            if norma.numero_atto:
                components.append(f"n. {norma.numero_atto}")
            return " ".join(components).strip()
        elif isinstance(norma_visitata, str):
            return norma_visitata.strip()
        return None

    async def _fetch_soup(self, url: str, *, cache_suffix: str, source: str) -> Optional[BeautifulSoup]:
        cache_key = f"{cache_suffix}:{url}"
        cached_html = await self.cache.get(cache_key)
        if cached_html:
            log.info(f"Serving cached Brocardi content for {url}")
            return BeautifulSoup(cached_html, 'html.parser')

        try:
            result = await http_client.request("GET", url, source=source)
        except Exception as exc:
            log.error(f"Failed to retrieve content for {url}: {exc}")
            return None

        await self.cache.set(cache_key, result.text)
        return BeautifulSoup(result.text, 'html.parser')
