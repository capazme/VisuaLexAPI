import re
from typing import Tuple, Optional, Union, Dict, Any

from bs4 import BeautifulSoup, NavigableString, Tag
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer
import structlog

from ..tools.norma import NormaVisitata
from ..tools.sys_op import BaseScraper
from ..tools.cache_manager import get_cache_manager
from ..tools.exceptions import DocumentNotFoundError, ParsingError
from ..tools.selectors import NormattivaSelectors

# Configure structured logger
log = structlog.get_logger()


class NormattivaScraper(BaseScraper):
    def __init__(self) -> None:
        self.base_url: str = "https://www.normattiva.it/"
        self.selectors = NormattivaSelectors()
        log.info("Normattiva scraper initialized")
        self.cache = get_cache_manager().get_persistent("normattiva")

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def get_document(self, normavisitata: NormaVisitata) -> Tuple[str, str]:
        log.info("Fetching Normattiva document", norma=str(normavisitata))
        urn: str = normavisitata.urn
        log.info("Requesting URL", urn=urn[:100])

        cache_key = urn
        html_content: str = await self.cache.get(cache_key)
        if html_content:
            log.info("Cache hit", source="normattiva_persistent")
        else:
            html_content = await self.request_document(urn, source="normattiva")
            await self.cache.set(cache_key, html_content)

        if not html_content:
            log.error("Document not found or malformed", urn=urn)
            raise DocumentNotFoundError(
                f"Document not found for {normavisitata}",
                urn=urn
            )

        if normavisitata.numero_articolo:
            document_text = await self.estrai_da_html(html_content)
            return document_text, urn
        else:
            log.info("Returning full document text")
            return html_content, urn

    async def estrai_da_html(
        self, atto: str, comma: Optional[str] = None, get_link_dict: bool = False
    ) -> Union[str, Dict[str, Any]]:
        try:
            soup: BeautifulSoup = self.parse_document(atto)
            corpo: Optional[Tag] = soup.find('div', class_=self.selectors.BODY_TESTO)
            if corpo is None:
                log.warning("Missing expected div.bodyTesto in document")
                raise ParsingError(
                    "Missing expected div.bodyTesto in Normattiva response",
                    html_snippet=atto
                )

            if corpo.find(class_=self.selectors.AKN_COMMA_DIV):
                # SCENARIO 1: Formattazione AKN Dettagliata
                return self._estrai_testo_akn_dettagliato(corpo, link=get_link_dict)
            elif corpo.find(class_=self.selectors.AKN_JUST_TEXT):
                # SCENARIO 2: Formattazione Semplice con `akn-just-text`
                return self._estrai_testo_akn_semplice(corpo, link=get_link_dict)
            elif corpo.find(class_=self.selectors.ATTACHMENT_TEXT):
                # SCENARIO 3: Allegato o Testo senza Formattazione AKN
                return self._estrai_testo_allegato(corpo, link=get_link_dict)
            else:
                # SCENARIO 4: Fallback - estrai tutto il testo visibile
                log.warning("Unknown HTML formatting structure, using fallback extraction")
                return self._estrai_testo_fallback(corpo, link=get_link_dict)
        except ParsingError:
            # Re-raise ParsingError as-is
            raise
        except Exception as e:
            log.error("Failed to extract text from HTML", error=str(e), exc_info=True)
            raise ParsingError(f"Failed to extract text from HTML: {e}", html_snippet=atto)

    def extract_text_recursive(
        self, element: Tag, link: bool = False, link_dict: Optional[Dict[str, str]] = None
    ) -> Tuple[str, Dict[str, str]]:
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
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(inner_text + '\n')
                elif child.name == 'li':
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
                    inner_text, _ = self.extract_text_recursive(child, link=link, link_dict=link_dict)
                    text_parts.append(inner_text)
        return ''.join(text_parts), link_dict

    def _estrai_testo_akn_dettagliato(self, corpo: Tag, link: bool = False) -> Union[str, Dict[str, Any]]:
        try:
            link_dict: Dict[str, str] = {}

            # Estrazione del numero e del titolo dell'articolo
            article_number_tag = corpo.find('h2', class_=self.selectors.AKN_ARTICLE_NUMBER)
            article_title_tag = corpo.find('div', class_=self.selectors.AKN_ARTICLE_TITLE)
            article_number = article_number_tag.get_text(strip=True) if article_number_tag else "Articolo non trovato"
            article_title = article_title_tag.get_text(strip=True) if article_title_tag else ""

            # Composizione del testo iniziale
            final_text = f"{article_number}\n{article_title}\n\n"

            # Estrazione dei commi
            commi = corpo.find_all('div', class_=self.selectors.AKN_COMMA_DIV)
            for comma_div in commi:
                comma_text, _ = self.extract_text_recursive(comma_div, link=link, link_dict=link_dict)
                final_text += comma_text.strip() + '\n\n'

            # Pulizia finale del testo
            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text
        except Exception as e:
            logger.error(f"Error in _estrai_testo_akn_dettagliato: {e}", exc_info=True)
            return f"Error in _estrai_testo_akn_dettagliato: {e}"

    def _estrai_testo_akn_semplice(self, corpo: Tag, link: bool = False) -> Union[str, Dict[str, Any]]:
        try:
            link_dict: Dict[str, str] = {}

            # Estrazione del numero e del titolo dell'articolo
            article_number_tag = corpo.find('h2', class_=self.selectors.AKN_ARTICLE_NUMBER)
            article_title_tag = corpo.find('div', class_=self.selectors.AKN_ARTICLE_TITLE)
            article_number = article_number_tag.get_text(strip=True) if article_number_tag else ""
            article_title = article_title_tag.get_text(strip=True) if article_title_tag else ""

            final_text = f"{article_number}\n{article_title}\n\n"

            # Estrazione del contenuto del testo semplice
            just_text = corpo.find('span', class_=self.selectors.AKN_JUST_TEXT)
            if just_text:
                content_text, _ = self.extract_text_recursive(just_text, link=link, link_dict=link_dict)
                final_text += content_text.strip()

            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text
        except Exception as e:
            logger.error(f"Error in _estrai_testo_akn_semplice: {e}", exc_info=True)
            return f"Error in _estrai_testo_akn_semplice: {e}"

    def _estrai_testo_allegato(self, corpo: Tag, link: bool = False) -> Union[str, Dict[str, Any]]:
        try:
            link_dict: Dict[str, str] = {}

            # Estrazione del contenuto dell'allegato
            attachment_text = corpo.find('span', class_=self.selectors.ATTACHMENT_TEXT)
            final_text = ""
            if attachment_text:
                content_text, _ = self.extract_text_recursive(attachment_text, link=link, link_dict=link_dict)
                final_text += content_text.strip()

            # Estrazione degli aggiornamenti (se presenti)
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
            logger.error(f"Error in _estrai_testo_allegato: {e}", exc_info=True)
            return f"Error in _estrai_testo_allegato: {e}"

    def _estrai_testo_fallback(self, corpo: Tag, link: bool = False) -> Union[str, Dict[str, Any]]:
        """
        Fallback extraction when no specific HTML pattern is recognized.
        Extracts all visible text from the body, useful for abrogated articles
        or articles with unusual structure.
        """
        try:
            link_dict: Dict[str, str] = {}

            # Extract all text content from corpo
            final_text, link_dict = self.extract_text_recursive(corpo, link=link, link_dict=link_dict)

            # Clean up the text
            final_text = re.sub(r'\n{3,}', '\n\n', final_text).strip()
            final_text = re.sub(r'[ \t]+', ' ', final_text)

            # If no text found, indicate the article may be empty/abrogated
            if not final_text.strip():
                final_text = "[Articolo senza contenuto o abrogato]"

            if link:
                return {"testo": final_text, "link": link_dict}
            return final_text
        except Exception as e:
            logger.error(f"Error in _estrai_testo_fallback: {e}", exc_info=True)
            return f"Error in _estrai_testo_fallback: {e}"

    def parse_document(self, atto: str) -> BeautifulSoup:
        return BeautifulSoup(atto, 'html.parser')
