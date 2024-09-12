import re
import os
import logging
from bs4 import BeautifulSoup
from functools import lru_cache
from .config import MAX_CACHE_SIZE
from .map import BROCARDI_CODICI
from .norma import NormaVisitata
from .text_op import normalize_act_type
import requests

CURRENT_APP_PATH = os.path.dirname(os.path.abspath(__file__))

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("brocardi_scraper.log"),
                              logging.StreamHandler()])

class BrocardiScraper:
    """
    Scraper for Brocardi.it to search for legal terms and provide links.
    """
    def __init__(self):
        logging.info("Initializing BrocardiScraper")
        self.knowledge = [BROCARDI_CODICI]

    @lru_cache(maxsize=MAX_CACHE_SIZE)
    def do_know(self, norma):
        logging.info(f"Checking if knowledge exists for norma: {norma}")
        
        strcmp = self._build_norma_string(norma)
        if strcmp is None:
            logging.error("Invalid norma format")
            raise ValueError("Formato norma non valido")

        for txt, link in self.knowledge[0].items():
            if strcmp.lower() in txt.lower():
                logging.info(f"Knowledge found for norma: {norma}")
                return txt, link

        logging.warning(f"No knowledge found for norma: {norma}")
        return None

    @lru_cache(maxsize=MAX_CACHE_SIZE)
    def look_up(self, norma):
        logging.info(f"Looking up norma: {norma}")

        if not isinstance(norma, NormaVisitata):
            logging.error("Invalid input type for norma")
            return None

        norma_info = self.do_know(norma)
        if not norma_info:
            return None

        base_url = "https://brocardi.it"
        link = norma_info[1]

        try:
            logging.info(f"Requesting main link: {link}")
            response = requests.get(link)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
        except requests.exceptions.RequestException as e:
            logging.error(f"Failed to retrieve content for norma link: {link}: {e}")
            return None

        numero_articolo = norma.numero_articolo.replace('-', '') if norma.numero_articolo else None
        if numero_articolo:
            return self._find_article_link(soup, base_url, numero_articolo)

        logging.info("No article number provided")
        return None

    def _find_article_link(self, soup, base_url, numero_articolo):
        pattern = re.compile(rf'href=["\']([^"\']*art{re.escape(numero_articolo)}.html)["\']')

        logging.info("Searching for target link in the main page content")
        matches = pattern.findall(soup.prettify())

        if matches:
            return requests.compat.urljoin(base_url, matches[0])

        logging.info("No direct match found, searching in 'section-title' divs")
        section_titles = soup.find_all('div', class_='section-title')

        for section in section_titles:
            for a_tag in section.find_all('a', href=True):
                sub_link = requests.compat.urljoin(base_url, a_tag['href'])

                try:
                    sub_response = requests.get(sub_link)
                    sub_response.raise_for_status()
                    sub_soup = BeautifulSoup(sub_response.text, 'html.parser')
                    sub_matches = pattern.findall(sub_soup.prettify())
                    if sub_matches:
                        return requests.compat.urljoin(base_url, sub_matches[0])
                except requests.exceptions.RequestException as e:
                    logging.warning(f"Failed to retrieve content for subsection link: {sub_link}: {e}")
                    continue

        logging.info("No matching article found")
        return None

    def get_info(self, norma):
        logging.info(f"Getting info for norma: {norma}")

        if not isinstance(norma, NormaVisitata):
            logging.error("Invalid input type for norma")
            return None

        norma_link = self.look_up(norma)
        if not norma_link:
            return None

        try:
            response = requests.get(norma_link)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
        except requests.exceptions.RequestException as e:
            logging.error(f"Failed to retrieve content for norma link: {norma_link}: {e}")
            return None

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

        # Extract Brocardi sections
        brocardi_sections = corpo.find_all('div', class_='brocardi-content')
        if brocardi_sections:
            info['Brocardi'] = [section.get_text(strip=False) for section in brocardi_sections]

        # Extract Ratio section
        ratio_section = corpo.find('div', class_='container-ratio')
        if ratio_section:
            ratio_text = ratio_section.find('div', class_='corpoDelTesto')
            if ratio_text:
                info['Ratio'] = ratio_text.get_text(strip=False)

        # Extract Explanation section
        spiegazione_header = corpo.find('h3', string=lambda text: 'Spiegazione dell\'art' in text)
        if spiegazione_header:
            spiegazione_content = spiegazione_header.find_next_sibling('div', class_='text')
            if spiegazione_content:
                info['Spiegazione'] = spiegazione_content.get_text(strip=False)

        # Extract Maxims section
        massime_header = corpo.find('h3', string=lambda text: 'Massime relative all\'art' in text)
        if massime_header:
            massime_content = massime_header.find_next_sibling('div', class_='text')
            if massime_content:
                info['Massime'] = [massima.get_text(strip=False) for massima in massime_content]

    def _build_norma_string(self, norma):
        if isinstance(norma, NormaVisitata):
            atts = norma.to_dict()
            tipo_norm = normalize_act_type(atts['tipo_atto'], True, 'brocardi')
            components = [tipo_norm]

            if atts['data']:
                components.append(f"{atts['data']},")
            if atts['numero_atto']:
                components.append(f"n. {atts['numero_atto']}")

            return " ".join(components).strip()
        elif isinstance(norma, str):
            return norma.strip()
        return None
