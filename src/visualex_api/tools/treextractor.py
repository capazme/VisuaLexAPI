import asyncio
import aiohttp
from bs4 import BeautifulSoup
import logging
import re
from aiocache import cached

# Configurazione del logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

@cached(ttl=3600)
async def get_tree(normurn, link=False, details=False):
    """
    Recupera l'albero degli articoli da un URN normativo e ne estrae le informazioni.

    Args:
        normurn (str): URL della norma.
        link (bool): Se includere i link agli articoli.
        details (bool): Se includere i testi delle sezioni.

    Returns:
        tuple: Lista di articoli (e sezioni, se richiesto) estratti e conteggio, oppure un messaggio di errore.
    """
    logging.info(f"Fetching tree for norm URN: {normurn}")
    if not normurn or not isinstance(normurn, str):
        logging.error("Invalid URN provided")
        return "Invalid URN provided", 0

    try:
        async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
            async with session.get(normurn, timeout=30) as response:
                response.raise_for_status()
                text = await response.text()
    except aiohttp.ClientError as e:
        logging.error(f"HTTP error while fetching page: {e}", exc_info=True)
        return f"Failed to retrieve the page: {e}", 0
    except asyncio.TimeoutError:
        logging.error("Request timed out")
        return "Request timed out", 0
    except Exception as e:
        logging.error(f"Unexpected error: {e}", exc_info=True)
        return f"Unexpected error: {e}", 0

    soup = BeautifulSoup(text, 'html.parser')

    if "normattiva" in normurn:
        return await _parse_normattiva_tree(soup, normurn, link, details)
    elif "eur-lex" in normurn:
        return await _parse_eurlex_tree(soup)

    logging.warning(f"Unrecognized norm URN format: {normurn}")
    return "Unrecognized norm URN format", 0


async def _parse_normattiva_tree(soup, normurn, link, details):
    """Parsa la struttura dell'albero degli articoli per Normattiva."""
    logging.info("Parsing Normattiva structure")
    tree = soup.find('div', id='albero')

    if not tree:
        logging.warning("Div with id 'albero' not found")
        return "Div with id 'albero' not found", 0

    uls = tree.find_all('ul')
    if not uls:
        logging.warning("No 'ul' elements found within the 'albero' div")
        return "No 'ul' elements found within the 'albero' div", 0

    result = []
    count_articles = 0  # Contatore solo per gli articoli

    current_attachment = None  # Variabile per tracciare il numero dell'allegato corrente

    for ul in uls:
        for li in ul.find_all('li', recursive=False):
            # Check if the list item is a section/title
            if 'singolo_risultato_collapse' in li.get('class', []):
                if details:
                    section_text = li.get_text(separator=" ", strip=True)
                    result.append(section_text)
                continue  # Skip further processing for section items

            # Check if the list item indicates an allegato
            allegato_tag = li.find('a', class_='link_allegato')  # Supponendo che gli allegati abbiano questa classe
            if allegato_tag:
                # Estrai il numero dell'allegato
                allegato_text = allegato_tag.get_text(strip=True)
                match = re.match(r'Allegato\s+(\d+)', allegato_text, re.IGNORECASE)
                if match:
                    current_attachment = int(match.group(1))
                    logging.info(f"Detected attachment number: {current_attachment}")
                continue  # Passa agli articoli successivi

            # Process regular articles
            a_tag = li.find('a', class_='numero_articolo')
            if a_tag:
                article_data = _extract_normattiva_article(a_tag, normurn, link, attachment_number=current_attachment)
                if article_data:
                    result.append(article_data)
                    count_articles += 1

    logging.info(f"Extracted {count_articles} unique articles from Normattiva")
    return result, count_articles


def _extract_normattiva_article(a_tag, normurn, link, attachment_number=None):
    """
    Estrae i dettagli di un articolo da Normattiva, includendo il link se richiesto.

    Args:
        a_tag (bs4.element.Tag): Il tag <a> contenente il numero dell'articolo.
        normurn (str): URN base della norma.
        link (bool): Se includere il link all'articolo.
        attachment_number (int, optional): Numero dell'allegato se l'articolo appartiene a un allegato.

    Returns:
        dict or str: Dizionario con il numero dell'articolo e il link, oppure solo il numero dell'articolo.
    """
    # Rimuove eventuali prefissi come "art. " e spazi
    text_content = a_tag.get_text(separator=" ", strip=True)
    text_content = re.sub(r'^\s*art\.\s*', '', text_content, flags=re.IGNORECASE)

    if link:
        # Estrai eventuali estensioni dall'articolo
        match = re.match(r'^(\d+)([a-zA-Z.]*)$', text_content)
        if match:
            article_number = match.group(1)
            extension = match.group(2).replace('-', '').lower()  # Rimuovi trattini e abbassa il caso
            if extension:
                article_number += extension
        else:
            article_number = text_content  # In caso di formato inatteso

        modified_url = _generate_article_url(normurn, article_number, attachment_number=attachment_number)
        return {text_content: modified_url}
    return text_content


def _generate_article_url(normurn, article_number, attachment_number=None):
    """
    Genera un URL per un articolo specifico basato sull'URN base, sul numero dell'articolo
    e, se presente, sul numero dell'allegato.

    Args:
        normurn (str): URN base della norma.
        article_number (str): Numero dell'articolo, possibili estensioni incluse (es. '27bis').
        attachment_number (int, optional): Numero dell'allegato se l'articolo appartiene a un allegato.

    Returns:
        str: URL completo per l'articolo specifico.
    """
    logging.info(f"Generating article URL for article_number: {article_number}, attachment_number: {attachment_number} based on normurn: {normurn}")

    # Normalize article_number: rimuovi spazi e trattini, converti in minuscolo
    article_number = article_number.lower().replace(' ', '').replace('-', '')

    # Regex per identificare i suffissi di versione e di articolo
    split_pattern = re.compile(r'([~@!])')

    parts = split_pattern.split(normurn, maxsplit=1)

    if len(parts) == 1:
        # Nessun suffisso presente, costruisci l'URN base
        base_urn = normurn
        suffix = ''
    else:
        # Suffisso presente, separa base e suffisso
        base_urn, sep, suffix = parts

    # Aggiungi il numero dell'allegato se fornito
    if attachment_number is not None:
        base_urn = f"{base_urn}:{attachment_number}"
        logging.info(f"Added attachment number to URN: {base_urn}")

    # Costruisci il nuovo URN con l'articolo
    new_urn = f"{base_urn}~art{article_number}{sep}{suffix}" if suffix else f"{base_urn}~art{article_number}"

    logging.info(f"Generated article URL: {new_urn}")
    return new_urn


async def _parse_eurlex_tree(soup, normurn):
    """Parsa la struttura dell'albero degli articoli per Eur-Lex."""
    logging.info("Parsing Eur-Lex structure")
    result, seen = [], set()

    for a_tag in soup.find_all('a'):
        if 'Articolo' in a_tag.text:
            article_number = _extract_eurlex_article(a_tag, seen)
            if article_number:
                result.append(article_number)

    count = len(result)
    logging.info(f"Extracted {count} unique articles from Eur-Lex")
    return result, count


def _extract_eurlex_article(a_tag, seen):
    """Estrae i dettagli di un articolo da Eur-Lex."""
    match = re.search(r'Articolo\s+(\d+\s*\w*)', a_tag.get_text(strip=True))
    if match:
        article_number = match.group(1).strip()
        if article_number not in seen:
            seen.add(article_number)
            return article_number
    return None

# Funzione principale per test
async def main():
    normurn = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2010-12-13;220'
    result, count = await get_tree(normurn, link=True, details=True)
    print(f"Found {count} articles.")
    print(result)

async def main():
    normurn = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2010-12-13;220'
    result, count = await get_tree(normurn, link=True, details=True)
    print(f"Found {count} articles.")
    print(result)

