import logging
import re
from bs4 import BeautifulSoup, NavigableString, Tag
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer
from ..tools.norma import NormaVisitata
from ..tools.sys_op import BaseScraper

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

class NormattivaScraper(BaseScraper):
    def __init__(self):
        self.base_url = "https://www.normattiva.it/"
        logging.info("NormattivaScraper initialized")

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def get_document(self, normavisitata: NormaVisitata):
        logging.info(f"Fetching Normattiva document for: {normavisitata}")
        urn = normavisitata.urn
        logging.info(f"Requesting URL: {urn}")

        html_content = await self.request_document(urn)

        if not html_content:
            logging.error("Document not found or malformed")
            raise ValueError("Document not found or malformed")

        if normavisitata.numero_articolo:
            return await self.estrai_da_html(html_content), urn
        else:
            logging.info("Returning full document text")
            return html_content, urn

    async def estrai_da_html(self, atto, comma=None, get_link_dict=False):
        try:
            soup = self.parse_document(atto)
            corpo = soup.find('div', class_='bodyTesto')
            if corpo is None:
                logging.warning("Body of the document not found")
                return "Body of the document not found"

            # Riconoscimento del tipo di formattazione
            if corpo.find(class_='art-comma-div-akn'):
                # SCENARIO 1: Formattazione AKN Dettagliata
                return self._estrai_testo_akn_dettagliato(corpo, link=get_link_dict)
            elif corpo.find(class_='art-just-text-akn'):
                # SCENARIO 2: Formattazione Semplice con `akn-just-text`
                return self._estrai_testo_akn_semplice(corpo, link=get_link_dict)
            elif corpo.find(class_='attachment-just-text'):
                # SCENARIO 3: Allegato o Testo senza Formattazione AKN
                return self._estrai_testo_allegato(corpo, link=get_link_dict)
            else:
                logging.warning("Unknown formatting structure")
                return "Unknown formatting structure"
        except Exception as e:
            logging.error(f"Generic error: {e}", exc_info=True)
            return f"Generic error: {e}"

    def extract_text_recursive(self, element, link=False, link_dict=None):
        if link_dict is None:
            link_dict = {}
        text_parts = []

        for child in element.children:
            if isinstance(child, NavigableString):
                text_parts.append(str(child))
            elif isinstance(child, Tag):
                if child.name == 'br':
                    text_parts.append('\n')
                elif child.name == 'p':
                    # Gestione dei paragrafi
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(inner_text + '\n')
                elif child.name == 'li':
                    # Gestione delle liste
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(' - ' + inner_text + '\n')
                elif child.name == 'a':
                    link_text = ''.join(child.stripped_strings)
                    link_url = child.get('href', '').strip()
                    if link:
                        link_dict[link_text] = link_url
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(inner_text)
                else:
                    # Recurse into other tags
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(inner_text)
        return ''.join(text_parts), link_dict

    def _estrai_testo_akn_dettagliato(self, corpo, link=False):
        try:
            link_dict = {}

            # Estrarre il numero e il titolo dell'articolo
            article_number_tag = corpo.find('h2', class_='article-num-akn')
            article_title_tag = corpo.find('div', class_='article-heading-akn')
            article_number = article_number_tag.get_text(strip=True) if article_number_tag else "Articolo non trovato"
            article_title = article_title_tag.get_text(strip=True) if article_title_tag else ""

            # Aggiungi il numero e il titolo
            final_text = f"{article_number}\n{article_title}\n\n"

            # Estrazione dei commi
            commi = corpo.find_all('div', class_='art-comma-div-akn')
            for comma_div in commi:
                comma_text, _ = self.extract_text_recursive(comma_div, link=link, link_dict=link_dict)
                final_text += comma_text.strip() + '\n\n'

            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text

        except Exception as e:
            logging.error(f"Error in _estrai_testo_akn_dettagliato: {e}", exc_info=True)
            return f"Error in _estrai_testo_akn_dettagliato: {e}"

    def _estrai_testo_akn_semplice(self, corpo, link=False):
        try:
            link_dict = {}

            # Estrarre il numero e il titolo dell'articolo
            article_number_tag = corpo.find('h2', class_='article-num-akn')
            article_title_tag = corpo.find('div', class_='article-heading-akn')
            article_number = article_number_tag.get_text(strip=True) if article_number_tag else ""
            article_title = article_title_tag.get_text(strip=True) if article_title_tag else ""

            final_text = f"{article_number}\n{article_title}\n\n"

            # Estrazione del contenuto
            just_text = corpo.find('span', class_='art-just-text-akn')
            if just_text:
                content_text, _ = self.extract_text_recursive(just_text, link=link, link_dict=link_dict)
                final_text += content_text.strip()

            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text

        except Exception as e:
            logging.error(f"Error in _estrai_testo_akn_semplice: {e}", exc_info=True)
            return f"Error in _estrai_testo_akn_semplice: {e}"

    def _estrai_testo_allegato(self, corpo, link=False):
        try:
            link_dict = {}

            # Estrazione del contenuto dell'allegato
            attachment_text = corpo.find('span', class_='attachment-just-text')
            final_text = ""

            if attachment_text:
                content_text, _ = self.extract_text_recursive(attachment_text, link=link, link_dict=link_dict)
                final_text += content_text.strip()

            # Sezione degli aggiornamenti (se presente)
            aggiornamenti = corpo.find_all('div', class_='art_aggiornamento-akn')
            for aggiornamento in aggiornamenti:
                agg_text, _ = self.extract_text_recursive(aggiornamento, link=link, link_dict=link_dict)
                final_text += '\n\n' + agg_text.strip()

            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text

        except Exception as e:
            logging.error(f"Error in _estrai_testo_allegato: {e}", exc_info=True)
            return f"Error in _estrai_testo_allegato: {e}"

    def parse_document(self, atto):
        # Parsing del documento HTML con BeautifulSoup
        return BeautifulSoup(atto, 'html.parser')
