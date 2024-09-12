import requests
from bs4 import BeautifulSoup
import logging
from .config import MAX_CACHE_SIZE
from functools import lru_cache
from .map import EURLEX
from .eurlex import get_eurlex

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

def save_html(html_data, save_html_path):
    """
    Saves HTML data to a specified file path.
    
    Arguments:
    html_data -- The HTML data to save
    save_html_path -- The path to save the HTML file
    
    Returns:
    str -- Path where the HTML is saved or an error message
    """
    try:
        with open(save_html_path, 'w', encoding='utf-8') as file:
            file.write(html_data)
        logging.info(f"HTML saved successfully to: {save_html_path}")
        return f"HTML saved to: {save_html_path}"
    except Exception as e:
        logging.error(f"Error saving HTML: {e}", exc_info=True)
        return f"Error saving HTML: {e}"

@lru_cache(maxsize=MAX_CACHE_SIZE)
def estrai_da_html(atto, comma=None):
    """
    Extracts text of a specific article from an HTML document.
    
    Arguments:
    atto -- The HTML content of the document
    comma -- The comma number to extract (optional)
    
    Returns:
    str -- The extracted text or an error message
    """
    try:
        soup = BeautifulSoup(atto, 'html.parser')
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

def extract_html_article(norma_visitata):
    """
    Extracts an HTML article from a NormaVisitata object.
    
    Arguments:
    norma_visitata -- The NormaVisitata object containing the URN
    
    Returns:
    str -- The extracted article text or None if not found
    """
    urn = norma_visitata.urn
    logging.info(f"Fetching HTML content from URN: {urn}")

    try:
        if "eur-lex" in urn:
            response = get_eurlex(urn=urn, article=norma_visitata.numero_articolo, year=norma_visitata.data, num=norma_visitata.numero_atto)
            return response[0]
        else:
            response = requests.get(urn, timeout=30)
            response.raise_for_status()  # Raise an HTTPError for bad responses
            html_content = response.text
            return estrai_da_html(atto=html_content, comma=None)
    except requests.exceptions.RequestException as e:
        logging.error(f"Network error fetching HTML content: {e}", exc_info=True)
        return None
    except Exception as e:
        logging.error(f"Error fetching HTML content: {e}", exc_info=True)
        return None
