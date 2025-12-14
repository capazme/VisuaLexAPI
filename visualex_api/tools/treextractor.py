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
        return await _parse_eurlex_tree(soup, normurn, link, details)

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


async def _parse_eurlex_tree(soup, normurn, link=False, details=False):
    """
    Parsa la struttura dell'albero degli articoli per Eur-Lex.

    Args:
        soup: BeautifulSoup object del documento
        normurn (str): URL base del documento EUR-Lex
        link (bool): Se includere i link agli articoli
        details (bool): Se includere i titoli di Capi/Sezioni/Titoli

    Returns:
        tuple: Lista di articoli estratti e conteggio
    """
    logging.info("Parsing Eur-Lex structure")
    result = []
    seen_articles = set()
    count_articles = 0

    # Estrai anno e numero dall'URL per generare link ELI
    eli_info = _extract_eli_info(normurn)

    # Pattern per identificare strutture gerarchiche
    title_pattern = re.compile(r'^(TITOLO|TITLE)\s+([IVXLCDM]+|\d+)', re.IGNORECASE)
    chapter_pattern = re.compile(r'^(CAPO|CHAPTER)\s+([IVXLCDM]+|\d+)', re.IGNORECASE)
    section_pattern = re.compile(r'^(SEZIONE|SECTION)\s+(\d+|\w+)', re.IGNORECASE)
    article_pattern = re.compile(r'^(Articolo|Article)\s+(\d+)', re.IGNORECASE)

    # Strategia 1: Cerca nel TOC (table of contents) se presente
    toc = soup.find('div', class_='eli-toc') or soup.find('div', id='toc')
    if toc:
        logging.info("Found TOC, parsing from table of contents")
        for item in toc.find_all(['a', 'li', 'p']):
            text = item.get_text(strip=True)

            # Estrai titoli/capi/sezioni se details=True
            if details:
                if title_pattern.match(text) or chapter_pattern.match(text) or section_pattern.match(text):
                    result.append(text)
                    continue

            # Estrai articoli
            article_match = article_pattern.match(text)
            if article_match:
                article_num = article_match.group(2)
                if article_num not in seen_articles:
                    seen_articles.add(article_num)
                    article_data = _format_eurlex_article(article_num, normurn, eli_info, link)
                    result.append(article_data)
                    count_articles += 1

    # Strategia 2: Cerca direttamente nel documento se TOC non presente o vuoto
    if count_articles == 0:
        logging.info("TOC not found or empty, searching in document body")

        # Cerca elementi con classe ti-art (titoli articoli) o pattern simili
        article_elements = soup.find_all(['p', 'div', 'span'], class_=lambda c: c and ('ti-art' in c or 'art' in c.lower()))

        if not article_elements:
            # Fallback: cerca qualsiasi elemento con testo "Articolo X"
            article_elements = soup.find_all(string=article_pattern)

        for elem in article_elements:
            text = elem.get_text(strip=True) if hasattr(elem, 'get_text') else str(elem)
            article_match = article_pattern.match(text)
            if article_match:
                article_num = article_match.group(2)
                if article_num not in seen_articles:
                    seen_articles.add(article_num)
                    article_data = _format_eurlex_article(article_num, normurn, eli_info, link)
                    result.append(article_data)
                    count_articles += 1

    # Strategia 3: Fallback sui link <a> (metodo originale)
    if count_articles == 0:
        logging.info("Falling back to anchor tag search")
        for a_tag in soup.find_all('a'):
            text = a_tag.get_text(strip=True)
            article_match = article_pattern.match(text)
            if article_match:
                article_num = article_match.group(2)
                if article_num not in seen_articles:
                    seen_articles.add(article_num)
                    article_data = _format_eurlex_article(article_num, normurn, eli_info, link)
                    result.append(article_data)
                    count_articles += 1

    # Ordina per numero articolo
    result = _sort_eurlex_results(result, link)

    logging.info(f"Extracted {count_articles} unique articles from Eur-Lex")
    return result, count_articles


def _extract_eli_info(normurn):
    """
    Estrae informazioni ELI dall'URL per generare link agli articoli.

    Args:
        normurn (str): URL EUR-Lex

    Returns:
        dict: Dizionario con tipo, anno, numero dell'atto
    """
    eli_info = {'type': None, 'year': None, 'num': None, 'base_url': normurn}

    # Pattern ELI: /eli/reg/2016/679/oj o /eli/dir/2019/790/oj
    eli_match = re.search(r'/eli/(reg|dir)/(\d{4})/(\d+)', normurn)
    if eli_match:
        eli_info['type'] = eli_match.group(1)
        eli_info['year'] = eli_match.group(2)
        eli_info['num'] = eli_match.group(3)
        return eli_info

    # Pattern CELEX: CELEX:32016R0679 o CELEX:32019L0790
    celex_match = re.search(r'CELEX:3(\d{4})([RL])(\d+)', normurn)
    if celex_match:
        eli_info['year'] = celex_match.group(1)
        eli_info['type'] = 'reg' if celex_match.group(2) == 'R' else 'dir'
        eli_info['num'] = str(int(celex_match.group(3)))  # Rimuovi zeri iniziali
        return eli_info

    return eli_info


def _format_eurlex_article(article_num, normurn, eli_info, link):
    """
    Formatta i dati dell'articolo con o senza link.

    Args:
        article_num (str): Numero dell'articolo
        normurn (str): URL base
        eli_info (dict): Info ELI estratte
        link (bool): Se includere il link

    Returns:
        str or dict: Numero articolo o dizionario {numero: url}
    """
    if not link:
        return article_num

    # Genera URL ELI per l'articolo specifico
    if eli_info['type'] and eli_info['year'] and eli_info['num']:
        article_url = f"https://eur-lex.europa.eu/eli/{eli_info['type']}/{eli_info['year']}/{eli_info['num']}/art_{article_num}/oj"
    else:
        # Fallback: usa URL base con ancora
        article_url = f"{normurn}#art_{article_num}"

    return {article_num: article_url}


def _sort_eurlex_results(results, link):
    """
    Ordina i risultati per numero articolo.

    Args:
        results (list): Lista di articoli
        link (bool): Se i risultati contengono link

    Returns:
        list: Lista ordinata
    """
    def get_sort_key(item):
        if isinstance(item, dict):
            key = list(item.keys())[0]
        else:
            key = item
        # Estrai numero per ordinamento
        match = re.match(r'(\d+)', str(key))
        return int(match.group(1)) if match else 0

    try:
        return sorted(results, key=get_sort_key)
    except Exception:
        return results

# Funzione principale per test
async def main():
    # Test Normattiva
    normurn = 'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:2010-12-13;220'
    result, count = await get_tree(normurn, link=True, details=True)
    print(f"Normattiva - Found {count} articles.")
    print(result[:5] if result else "No results")

    # Test EUR-Lex (GDPR)
    eurlex_url = 'https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita'
    result, count = await get_tree(eurlex_url, link=True, details=False)
    print(f"EUR-Lex - Found {count} articles.")
    print(result[:5] if result else "No results")


if __name__ == "__main__":
    asyncio.run(main())

