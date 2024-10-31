import logging
import os
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer
from ..tools.map import EURLEX
from ..tools.sys_op import BaseScraper

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("eurlex_scraper.log"),
                              logging.StreamHandler()])

class EurlexScraper(BaseScraper):
    def __init__(self):
        self.base_url = 'https://eur-lex.europa.eu/eli'
        logging.info("EurlexScraper initialized")

    def get_uri(self, act_type, year, num):
        logging.debug(f"get_uri called with act_type={act_type}, year={year}, num={num}")

        if act_type in EURLEX and EURLEX[act_type].startswith('https'):
            uri = EURLEX[act_type]
            logging.info(f"Act type is a treaty. Using predefined URI: {uri}")
        else:
            uri = f'{self.base_url}/{act_type}/{year}/{num}/oj/ita'
            logging.info(f"Constructed URI for regulation or directive: {uri}")
        
        return uri

    @cached(ttl=86400, cache=Cache.MEMORY, serializer=JsonSerializer())
    async def get_document(self, normavisitata=None, act_type=None, article=None, year=None, num=None, urn=None):
        logging.info(f"Fetching EUR-Lex document with parameters: act_type={act_type}, article={article}, year={year}, num={num}, urn={urn}")

        if normavisitata:
            urn = normavisitata.urn
            act_type = normavisitata.norma.tipo_atto_urn
            year = normavisitata.norma.data
            num = normavisitata.norma.numero_atto
            article = normavisitata.numero_articolo
            logging.debug(f"Using normavisitata with act_type={act_type}, year={year}, num={num}, article={article}")

        if not urn:
            if act_type not in EURLEX:
                logging.error(f"Invalid act_type '{act_type}' not found in EURLEX map")
                raise ValueError("EUR-Lex element not found")
            url = self.get_uri(act_type=act_type, year=year, num=num)
        else:
            url = urn

        html_content = await self.request_document(url)
        soup = self.parse_document(html_content)

        if article:
            logging.info(f"Extracting text for article {article}")
            return await self.extract_article_text(soup, article), url
        else:
            logging.info("Returning full document text")
            return soup.get_text(), url

    async def extract_article_text(self, soup, article):
        logging.info(f"Searching for article {article} in the document")
        search_query = f"Articolo {article}"
        article_section = soup.find(lambda tag: tag.name == 'p' and 'ti-art' in tag.get('class', []) and tag.get_text(strip=True).startswith(search_query))

        if not article_section:
            logging.warning(f"Article {article} not found in the document")
            raise ValueError(f"Article {article} not found")

        logging.debug("Article found, extracting text")
        full_text = [article_section.get_text(strip=True)]
        element = article_section.find_next_sibling()

        while element:
            if element.name == 'p' and 'ti-art' in element.get('class', []):
                logging.debug("Next article section found, stopping extraction")
                break
            if element.name in ['p', 'div']:
                full_text.append(element.get_text(strip=True))
            elif element.name == 'table':
                full_text.extend(self.extract_table_text(element))
            element = element.find_next_sibling()

        logging.info(f"Article {article} text extracted successfully")
        return "\n".join(full_text)

    def extract_table_text(self, table):
        logging.debug("Extracting text from table")
        rows = table.find_all('tr')
        table_text = []

        for row in rows:
            cells = row.find_all('td')
            row_text = ' '.join(cell.get_text(strip=True) for cell in cells)
            table_text.append(row_text)

        logging.debug("Table text extracted successfully")
        return table_text

# Configure production logging differently
if __name__ == "__main__":
    if os.getenv('ENV') == 'production':
        logging.getLogger().setLevel(logging.WARNING)
        for handler in logging.getLogger().handlers:
            if isinstance(handler, logging.StreamHandler):
                handler.setLevel(logging.ERROR)
