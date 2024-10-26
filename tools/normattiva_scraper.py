import logging
from .norma import NormaVisitata
from .sys_op import BaseScraper
from functools import lru_cache
from .config import MAX_CACHE_SIZE
# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

class NormattivaScraper(BaseScraper):
    def __init__(self):
        self.base_url = "https://www.normattiva.it/"
        logging.info("NormattivaScraper initialized")

    def get_document(self, normavisitata: NormaVisitata):
        logging.info(f"Fetching Normattiva document for: {normavisitata}")
        urn = normavisitata.urn
        logging.info(f"Requesting URL: {urn}")

        html_content = self.request_document(urn)

        if not html_content:
            logging.error("Document not found or malformed")
            raise ValueError("Document not found or malformed")

        if normavisitata.numero_articolo:
            return self.estrai_da_html(html_content), urn
        else:
            logging.info("Returning full document text")
            return html_content, urn

    
    def estrai_da_html(self, atto, comma=None):
        try:
            soup = self.parse_document(atto)
            corpo = soup.find('div', class_='bodyTesto')
            if corpo is None:
                logging.warning("Body of the document not found")
                return "Body of the document not found"

            if not comma:
                return corpo.get_text(strip=False, separator="\n")
            
            parsed_corp = corpo.find('div', class_='art-commi-div-akn')
            if parsed_corp is None:
                logging.warning("Parsed body for comma extraction not found")
                return "Parsed body for comma extraction not found"

            commi = parsed_corp.find_all('div', class_='art-comma-div-akn')
            for c in commi:
                comma_text = c.find('span', class_='comma-num-akn').get_text()
                if f'{comma}.' in comma_text:
                    return c.get_text(strip=False)

            logging.info("Specified comma not found")
            return "Specified comma not found"
        except Exception as e:
            logging.error(f"Generic error: {e}", exc_info=True)
            return f"Generic error: {e}"

