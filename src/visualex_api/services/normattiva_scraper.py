import logging
import re
from bs4 import BeautifulSoup
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

    async def estrai_da_html(self, atto, comma=None):
        try:
            soup = self.parse_document(atto)
            corpo = soup.find('div', class_='bodyTesto')
            if corpo is None:
                logging.warning("Body of the document not found")
                return "Body of the document not found"

            # Riconoscimento del tipo di formattazione
            if corpo.find(class_='art-comma-div-akn'):
                # SCENARIO 1: Formattazione AKN Dettagliata
                return self._estrai_testo_akn_dettagliato(corpo)
            elif corpo.find(class_='art-just-text-akn'):
                # SCENARIO 2: Formattazione Semplice con `akn-just-text`
                return self._estrai_testo_akn_semplice(corpo)
            elif corpo.find(class_='attachment-just-text'):
                # SCENARIO 3: Allegato o Testo senza Formattazione AKN
                return self._estrai_testo_allegato(corpo)
            else:
                logging.warning("Unknown formatting structure")
                return "Unknown formatting structure"
        except Exception as e:
            logging.error(f"Generic error: {e}", exc_info=True)
            return f"Generic error: {e}"

    def _estrai_testo_akn_dettagliato(self, corpo):
        try:
            # Estrarre il numero dell'articolo
            article_number_tag = corpo.find('h2', class_='article-num-akn')
            article_number = article_number_tag.get_text(strip=True) if article_number_tag else "Articolo non trovato"

            # Estrarre il titolo dell'articolo
            article_title_tag = corpo.find('div', class_='article-heading-akn')
            article_title = article_title_tag.get_text(strip=True) if article_title_tag else "Titolo non trovato"

            # Inizializza il testo finale con il numero e il titolo dell'articolo
            final_text = [f"{article_number}\n{article_title}"]

            # Estrazione di tutti i commi
            commi = corpo.find_all('div', class_='art-comma-div-akn')

            for c in commi:
                # Rimuove i link e sostituisce i <br> con uno spazio all'interno del comma
                for a_tag in c.find_all('a'):
                    a_tag.replace_with(a_tag.get_text())
                for br in c.find_all('br'):
                    br.replace_with(' ')

                # Ottiene il testo del comma e lo pulisce
                comma_text = c.get_text(separator=' ').strip()
                final_text.append(comma_text)

            # Unisce il testo finale con una singola linea vuota tra ogni elemento
            return '\n\n'.join(final_text)

        except Exception as e:
            logging.error(f"Error in _estrai_testo_akn_dettagliato: {e}", exc_info=True)
            return f"Error in _estrai_testo_akn_dettagliato: {e}"

    def _estrai_testo_akn_semplice(self, corpo):
        final_text = []
        # Estrarre il numero e il titolo dell'articolo
        article_number_tag = corpo.find('h2', class_='article-num-akn')
        article_title_tag = corpo.find('div', class_='article-heading-akn')
        article_number = article_number_tag.get_text(strip=True) if article_number_tag else ""
        article_title = article_title_tag.get_text(strip=True) if article_title_tag else ""
        final_text.append(f"{article_number}\n{article_title}")

        # Estrazione del contenuto semplice
        just_text = corpo.find('span', class_='art-just-text-akn')
        if just_text:
            # Rimuove i link e sostituisce i <br> con newline
            for a_tag in just_text.find_all('a'):
                a_tag.replace_with(a_tag.get_text())
            for br in just_text.find_all('br'):
                br.replace_with('\n')
            text_content = just_text.get_text(separator='\n', strip=True)
            final_text.append(text_content)

        output_text = '\n\n'.join(final_text)
        output_text = re.sub(r'\n{3,}', '\n\n', output_text)
        output_text = re.sub(r' +', ' ', output_text)
        return output_text.strip()

    def _estrai_testo_allegato(self, corpo):
        final_text = []
        # Estrazione del contenuto dell'allegato
        attachment_text = corpo.find('span', class_='attachment-just-text')
        if attachment_text:
            # Rimuove i link e sostituisce i <br> con newline
            for a_tag in attachment_text.find_all('a'):
                a_tag.replace_with(a_tag.get_text())
            for br in attachment_text.find_all('br'):
                br.replace_with('\n')
            text_content = attachment_text.get_text(separator='\n', strip=True)
            final_text.append(text_content)

        # Sezione degli aggiornamenti
        aggiornamenti = corpo.find_all('div', class_='art_aggiornamento-akn')
        for aggiornamento in aggiornamenti:
            separator_tag = aggiornamento.find('div', class_='art_aggiornamento_separator-akn')
            title_tag = aggiornamento.find('div', class_='art_aggiornamento_title-akn')
            text_tag = aggiornamento.find('div', class_='art_aggiornamento_testo-akn')

            separator = separator_tag.get_text(strip=True) if separator_tag else ""
            title = title_tag.get_text(strip=True) if title_tag else ""
            text = text_tag.get_text(separator=' ', strip=True) if text_tag else ""

            if separator:
                final_text.append(separator)
            if title:
                final_text.append(title)
            if text:
                final_text.append(f"    {text}")

        output_text = '\n\n'.join(final_text)
        output_text = re.sub(r'\n{3,}', '\n\n', output_text)
        output_text = re.sub(r' +', ' ', output_text)
        return output_text.strip()

    def parse_document(self, atto):
        # Parsing del documento HTML con BeautifulSoup
        return BeautifulSoup(atto, 'html.parser')