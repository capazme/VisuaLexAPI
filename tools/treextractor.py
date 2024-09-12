import requests
from bs4 import BeautifulSoup
from functools import lru_cache
import logging
import re
from .config import MAX_CACHE_SIZE

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

@lru_cache(maxsize=MAX_CACHE_SIZE)
def get_tree(normurn, link=False):
    """
    Retrieves the article tree from a given norm URN and extracts article information.
    
    Arguments:
    normurn -- The URL of the norm page
    link -- Boolean flag indicating if URLs should be included in the result
    
    Returns:
    tuple -- List of extracted article information and their count, or an error message
    """
    logging.info(f"Fetching tree for norm URN: {normurn}")
    try:
        # Sending HTTP GET request to the provided URL
        response = requests.get(normurn, timeout=30)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to retrieve the page: {e}", exc_info=True)
        return f"Failed to retrieve the page: {e}"
    
    soup = BeautifulSoup(response.text, 'html.parser')

    if "normattiva" in normurn:
        return _parse_normattiva_tree(soup, normurn, link)
    elif "eur-lex" in normurn:
        return _parse_eurlex_tree(soup)

    logging.warning(f"Unrecognized norm URN format: {normurn}")
    return "Unrecognized norm URN format"

@lru_cache(maxsize=MAX_CACHE_SIZE)
def _parse_normattiva_tree(soup, normurn, link):
    """Parses the Normattiva-specific tree structure."""
    logging.info("Parsing Normattiva structure")
    tree = soup.find('div', id='albero')
    
    if not tree:
        logging.warning("Div with id 'albero' not found")
        return "Div with id 'albero' not found", 0

    uls = tree.find_all('ul')
    if not uls:
        logging.warning("No 'ul' element found within the 'albero' div")
        return "No 'ul' element found within the 'albero' div", 0

    article_part_pattern = re.compile(r'art\d+')
    result = []
    count = 0

    for ul in uls:
        list_items = ul.find_all('a', class_='numero_articolo')
        for a in list_items:
            parent_li = a.find_parent('li')
            if parent_li and any(cls.startswith('agg') or 'collapse' in cls for cls in parent_li.get('class', [])):
                continue

            text_content = a.get_text(separator=" ", strip=True).replace("art. ", "")
            
            if link:
                article_part = article_part_pattern.search(normurn)
                modified_url = normurn.replace(article_part.group(), 'art' + text_content.split()[0]) if article_part else normurn
                result.append({text_content: modified_url})
            else:
                result.append(text_content)
            
            count += 1

    logging.info(f"Extracted {count} articles from Normattiva")
    return result, count

@lru_cache(maxsize=MAX_CACHE_SIZE)
def _parse_eurlex_tree(soup):
    """Parses the Eurlex-specific tree structure."""
    logging.info("Parsing Eurlex structure")
    result = []

    for a_tag in soup.find_all('a'):
        if 'Articolo' in a_tag.text:
            match = re.search(r'Articolo\s+(\d+\s*\w*)', a_tag.get_text(strip=True))
            if match:
                result.append(match.group(1).strip())
    
    count = len(result)
    logging.info(f"Extracted {count} articles from Eurlex")
    return result, count
