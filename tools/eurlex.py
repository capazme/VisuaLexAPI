import logging
from .config import MAX_CACHE_SIZE
from functools import lru_cache
from .map import EURLEX
import requests
from bs4 import BeautifulSoup

def get_eur_uri(act_type, year, num):
    """
    Constructs the EUR-Lex URI for a given act type, year, and number.

    Arguments:
    act_type -- Type of the act (e.g., TUE, TFUE)
    year -- Year of the act
    num -- Number of the act

    Returns:
    str -- The constructed URI
    """
    logging.debug(f"Constructing URI for act_type: {act_type}, year: {year}, num: {num}")
    base_url = 'https://eur-lex.europa.eu/eli'
    uri = f'{base_url}/{act_type}/{year}/{num}/oj/ita'
    logging.info(f"Constructed URI: {uri}")
    return uri

@lru_cache(maxsize=MAX_CACHE_SIZE)
def get_eurlex(act_type=None, article=None, year=None, num=None, urn=None):
    """
    Fetches and parses the EUR-Lex document for a given act type and optional article.

    Arguments:
    act_type -- Type of the act (default: 'TUE')
    article -- Article number to search for (optional)
    year -- Year of the act (optional)
    num -- Number of the act (optional)
    urn -- URI to the document (optional)

    Returns:
    tuple -- (Text of the document or article, URL of the document)
    """
    logging.info(f"Fetching EUR-Lex document for act_type: {act_type}, article: {article}, year: {year}, num: {num}")
    
    if not urn:
        if act_type not in EURLEX:
            logging.error(f"Act type '{act_type}' not found in EURLEX")
            raise ValueError("Elemento EUR-Lex non trovato")

        norma = EURLEX[act_type]
        url = get_eur_uri(act_type=norma, year=year, num=num) if 'https' not in norma else norma
    else:
        url = urn

    logging.info(f"Requesting URL: {url}")
    response = requests.get(url)
    if response.status_code != 200:
        logging.error(f"Failed to download document. Status code: {response.status_code}")
        raise ConnectionError("Problema nel download")

    soup = BeautifulSoup(response.text, 'html.parser')
    if not soup:
        logging.error("Document not found or malformed")
        raise ValueError("Documento non trovato o malformattato")

    if article:
        return extract_article_text(soup, article), url
    else:
        logging.info("Returning full document text")
        return soup.get_text(), url

def extract_article_text(soup, article):
    """
    Extracts the text of a specific article from the parsed EUR-Lex document.

    Arguments:
    soup -- BeautifulSoup object of the document
    article -- Article number to search for

    Returns:
    str -- The extracted text of the article
    """
    logging.info(f"Searching for article: {article}")
    search_query = f"Articolo {article}"
    article_section = soup.find(lambda tag: tag.name == 'p' and 'ti-art' in tag.get('class', []) and tag.get_text(strip=True).startswith(search_query))

    if not article_section:
        logging.warning(f"Article '{article}' not found in document")
        raise ValueError("Articolo non trovato")

    full_text = [article_section.get_text(strip=True)]  # Include the title in the output
    element = article_section.find_next_sibling()

    while element:
        if element.name == 'p' and 'ti-art' in element.get('class', []):
            break  # Stop if another article title is found
        if element.name == 'p' or element.name == 'div':
            full_text.append(element.get_text(strip=True))
        elif element.name == 'table':
            full_text.extend(extract_table_text(element))
        element = element.find_next_sibling()

    logging.info("Article text extracted successfully")
    return "\n".join(full_text)

def extract_table_text(table):
    """
    Extracts text from a table element.

    Arguments:
    table -- BeautifulSoup table element

    Returns:
    list -- A list of text rows extracted from the table
    """
    rows = table.find_all('tr')
    table_text = []
    for row in rows:
        cells = row.find_all('td')
        row_text = ' '.join(cell.get_text(strip=True) for cell in cells)
        table_text.append(row_text)
    return table_text
