import logging
import aiohttp
import requests
from bs4 import BeautifulSoup
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer
from ..tools.map import BROCARDI_CODICI
from ..tools.norma import NormaVisitata
from ..tools.text_op import normalize_act_type
from ..tools.sys_op import BaseScraper
import re
import os

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("brocardi_scraper.log"),
                              logging.StreamHandler()])

class BrocardiScraper(BaseScraper):
    def __init__(self):
        logging.info("Initializing BrocardiScraper")
        self.knowledge = [BROCARDI_CODICI]

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def do_know(self, norma_visitata: NormaVisitata):
        logging.info(f"Checking if knowledge exists for norma: {norma_visitata}")

        strcmp = self._build_norma_string(norma_visitata)
        if strcmp is None:
            logging.error("Invalid norma format")
            raise ValueError("Invalid norma format")

        for txt, link in self.knowledge[0].items():
            if strcmp.lower() in txt.lower():
                logging.info(f"Knowledge found for norma: {norma_visitata}")
                return txt, link

        logging.warning(f"No knowledge found for norma: {norma_visitata}")
        return None

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def look_up(self, norma_visitata: NormaVisitata):
        logging.info(f"Looking up norma: {norma_visitata}")

        norma_info = await self.do_know(norma_visitata)
        if not norma_info:
            return None

        base_url = "https://brocardi.it"
        link = norma_info[1]

        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
            try:
                logging.info(f"Requesting main link: {link}")
                async with session.get(link) as response:
                    response.raise_for_status()
                    soup = BeautifulSoup(await response.text(), 'html.parser')
            except aiohttp.ClientError as e:
                logging.error(f"Failed to retrieve content for norma link: {link}: {e}")
                return None

        numero_articolo = norma_visitata.numero_articolo.replace('-', '') if norma_visitata.numero_articolo else None
        if numero_articolo:
            article_link = await self._find_article_link(soup, base_url, numero_articolo)
            return article_link if article_link else None

        logging.info("No article number provided")
        return None

    async def _find_article_link(self, soup, base_url, numero_articolo):
        pattern = re.compile(rf'href=["\']([^"\']*art{re.escape(numero_articolo)}\.html)["\']')

        logging.info("Searching for target link in the main page content")
        matches = pattern.findall(soup.prettify())
        
        if matches:
            return requests.compat.urljoin(base_url, matches[0])

        logging.info("No direct match found, searching in 'section-title' divs")
        section_titles = soup.find_all('div', class_='section-title')

        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
            for section in section_titles:
                for a_tag in section.find_all('a', href=True):
                    sub_link = requests.compat.urljoin(base_url, a_tag['href'])

                    try:
                        async with session.get(sub_link) as sub_response:
                            sub_response.raise_for_status()
                            sub_soup = BeautifulSoup(await sub_response.text(), 'html.parser')
                            sub_matches = pattern.findall(sub_soup.prettify())
                            if sub_matches:
                                return requests.compat.urljoin(base_url, sub_matches[0])
                    except aiohttp.ClientError as e:
                        logging.warning(f"Failed to retrieve content for subsection link: {sub_link}: {e}")
                        continue

        logging.info("No matching article found")
        return None

    async def get_info(self, norma_visitata: NormaVisitata):
        logging.info(f"Getting info for norma: {norma_visitata}")

        norma_link = await self.look_up(norma_visitata)
        if not norma_link:
            return None, {}, None

        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
            try:
                async with session.get(norma_link) as response:
                    response.raise_for_status()
                    soup = BeautifulSoup(await response.text(), 'html.parser')
            except aiohttp.ClientError as e:
                logging.error(f"Failed to retrieve content for norma link: {norma_link}: {e}")
                return None, {}, None

        info = {}
        info['Position'] = self._extract_position(soup)
        self._extract_sections(soup, info)
        return info.get('Position'), info, norma_link

    def _extract_position(self, soup):
        position = soup.find('div', id='breadcrumb', recursive=True)
        if position:
            return position.get_text(strip=False).replace('\n', '').replace('  ', '')[17:]
        logging.warning("Breadcrumb position not found")
        return None

    def _extract_sections(self, soup, info):
        corpo = soup.find('div', class_='panes-condensed panes-w-ads content-ext-guide content-mark', recursive=True)
        if not corpo:
            logging.warning("Main content section not found")
            return

        brocardi_sections = corpo.find_all('div', class_='brocardi-content')
        if brocardi_sections:
            info['Brocardi'] = [section.get_text(strip=False) for section in brocardi_sections]

        ratio_section = corpo.find('div', class_='container-ratio')
        if ratio_section:
            ratio_text = ratio_section.find('div', class_='corpoDelTesto')
            if ratio_text:
                info['Ratio'] = ratio_text.get_text(strip=False)

        spiegazione_header = corpo.find('h3', string=lambda text: 'Spiegazione dell\'art' in text)
        if spiegazione_header:
            spiegazione_content = spiegazione_header.find_next_sibling('div', class_='text')
            if spiegazione_content:
                info['Spiegazione'] = spiegazione_content.get_text(strip=False)

        massime_header = corpo.find('h3', string=lambda text: 'Massime relative all\'art' in text)
        if massime_header:
            massime_content = massime_header.find_next_sibling('div', class_='text')
            if massime_content:
                info['Massime'] = [massima.get_text(strip=False) for massima in massime_content]

    def _build_norma_string(self, norma_visitata: NormaVisitata):
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
