import asyncio
import aiohttp
from bs4 import BeautifulSoup
import logging
import re
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer
from playwright.async_api import async_playwright

from .cache import PersistentCache

# Configurazione del logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

# Persistent cache for tree structures (survives restarts)
_tree_cache = PersistentCache("tree", ttl=86400)  # 24 hours


async def _fetch_with_playwright(url: str) -> str:
    """
    Fetch URL using Playwright to bypass CloudFront WAF protection.
    Used for EUR-Lex which blocks simple HTTP requests.
    """
    logging.info(f"Fetching with Playwright (WAF bypass): {url[:80]}...")
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage']
        )
        try:
            context = await browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            page = await context.new_page()
            await page.goto(url, wait_until='networkidle', timeout=45000)
            html = await page.content()
            await context.close()
            return html
        finally:
            await browser.close()


@cached(ttl=3600, cache=Cache.MEMORY, serializer=JsonSerializer())
async def get_tree(normurn, link=False, details=False, return_metadata=False):
    """
    Recupera l'albero degli articoli da un URN normativo e ne estrae le informazioni.

    Args:
        normurn (str): URL della norma.
        link (bool): Se includere i link agli articoli.
        details (bool): Se includere i testi delle sezioni.
        return_metadata (bool): Se includere i metadati sugli allegati (disponibile solo per Normattiva).

    Returns:
        tuple: Se return_metadata=True: (articles, count, metadata)
               Altrimenti: (articles, count)
    """
    logging.info(f"Fetching tree for norm URN: {normurn} (metadata={return_metadata})")
    if not normurn or not isinstance(normurn, str):
        logging.error("Invalid URN provided")
        if return_metadata:
            return "Invalid URN provided", 0, {}
        return "Invalid URN provided", 0

    # Build cache key including options
    cache_key = f"{normurn}|link={link}|details={details}|metadata={return_metadata}"

    # Check persistent cache first (survives server restarts)
    cached_result = await _tree_cache.get(cache_key)
    if cached_result:
        logging.info(f"Persistent cache hit for tree: {normurn[:50]}")
        if return_metadata:
            return (cached_result.get("result", []),
                   cached_result.get("count", 0),
                   cached_result.get("metadata", {}))
        return cached_result.get("result", []), cached_result.get("count", 0)

    # Use different fetch methods based on source
    is_eurlex = "eur-lex" in normurn

    try:
        if is_eurlex:
            # EUR-Lex requires Playwright to bypass WAF
            text = await _fetch_with_playwright(normurn)
        else:
            # Normattiva and others use simple HTTP
            async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=False)) as session:
                async with session.get(normurn, timeout=30) as response:
                    response.raise_for_status()
                    text = await response.text()
    except aiohttp.ClientError as e:
        logging.error(f"HTTP error while fetching page: {e}", exc_info=True)
        error_msg = f"Failed to retrieve the page: {e}"
        if return_metadata:
            return error_msg, 0, {}
        return error_msg, 0
    except asyncio.TimeoutError:
        logging.error("Request timed out")
        if return_metadata:
            return "Request timed out", 0, {}
        return "Request timed out", 0
    except Exception as e:
        logging.error(f"Unexpected error: {e}", exc_info=True)
        error_msg = f"Unexpected error: {e}"
        if return_metadata:
            return error_msg, 0, {}
        return error_msg, 0

    if not text or len(text) < 500:
        logging.error(f"Empty or too short response from {normurn[:50]}")
        if return_metadata:
            return "Empty response from server", 0, {}
        return "Empty response from server", 0

    soup = BeautifulSoup(text, 'html.parser')

    if "normattiva" in normurn:
        if return_metadata:
            result, count, metadata = await _parse_normattiva_tree(soup, normurn, link, details, return_metadata=True)
        else:
            result, count = await _parse_normattiva_tree(soup, normurn, link, details, return_metadata=False)
            metadata = {}
    elif is_eurlex:
        result, count = await _parse_eurlex_tree(soup, normurn, link, details)
        metadata = {}  # EUR-Lex doesn't support annex metadata yet
    else:
        logging.warning(f"Unrecognized norm URN format: {normurn}")
        if return_metadata:
            return "Unrecognized norm URN format", 0, {}
        return "Unrecognized norm URN format", 0

    # Store in persistent cache for future restarts
    if count > 0:
        cache_data = {"result": result, "count": count}
        if return_metadata:
            cache_data["metadata"] = metadata
        await _tree_cache.set(cache_key, cache_data)
        logging.info(f"Stored tree in persistent cache: {normurn[:50]}, {count} articles")

    if return_metadata:
        return result, count, metadata
    return result, count


async def _parse_normattiva_tree(soup, normurn, link, details, return_metadata=False):
    """
    Parsa la struttura dell'albero degli articoli per Normattiva.

    La struttura di Normattiva per i codici (es. Codice Civile RD 262/1942) è:
    - box_articoli "Articoli" → inizio corpo dell'atto (legge di emanazione)
    - box_articoli "Allegati" → marker che indica inizio sezione allegati
    - box_allegati "Disposizioni sulla legge in generale" → Allegato 1 (Preleggi)
    - box_allegati_small "CODICE CIVILE" → Allegato 2 (Codice Civile vero e proprio)

    URN Normattiva usa :1, :2 per gli allegati:
    - urn:...;262~art2 → art. 2 del corpo dell'atto
    - urn:...;262:1~art2 → art. 2 del primo allegato
    - urn:...;262:2~art7 → art. 7 del secondo allegato
    """
    logging.info("Parsing Normattiva structure (flat stateful iteration)")
    tree_div = soup.find('div', id='albero')

    if not tree_div:
        logging.warning("Div with id 'albero' not found")
        if return_metadata:
            return "Div with id 'albero' not found", 0, {}
        return "Div with id 'albero' not found", 0

    result = []
    count_articles = 0
    annexes_metadata = {}
    annex_labels = {}  # Map annex number -> original label text
    current_attachment = None
    annex_counter = 0
    in_allegati_section = False  # True after we see box_articoli "Allegati"

    # Initialize main text (dispositivo) tracking - will be populated before annexes
    annexes_metadata[None] = {'articles': [], 'count': 0}
    annex_labels[None] = "Dispositivo"

    # Iteriamo su tutti gli elementi <li> nell'ordine in cui appaiono nel DOM
    for li in tree_div.find_all('li'):
        classes = li.get('class', [])

        # 0. Verifica se è un box_articoli (marker di sezione "Articoli" o "Allegati")
        if 'box_articoli' in classes:
            box_text = li.get_text(strip=True).lower()
            if 'allegat' in box_text:  # "Allegati" o simili
                in_allegati_section = True
                logging.info("Entered 'Allegati' section - subsequent box_allegati/box_allegati_small will create annexes")
            continue

        # 1. Verifica se è un'intestazione di allegato esplicita
        # Structure 1: <a class="link_allegato">
        allegato_tag = li.find('a', class_='link_allegato')
        if allegato_tag and allegato_tag.find_parent('li') == li:
            allegato_text = allegato_tag.get_text(strip=True)
            # Preserve the original label text
            original_label = allegato_text

            match = re.search(r'Allegato\s+(\d+)', allegato_text, re.IGNORECASE)
            if match:
                current_attachment = match.group(1)
                annex_counter = max(annex_counter, int(current_attachment))
            else:
                match = re.search(r'Allegato\s+([A-Z])', allegato_text, re.IGNORECASE)
                if match:
                    annex_counter += 1 # We use a numeric counter internally to sync with Normattiva URNs
                    current_attachment = str(annex_counter)
                else:
                    annex_counter += 1
                    current_attachment = str(annex_counter)

            logging.info(f"Detected link_allegato: {current_attachment} (label: {original_label})")
            if current_attachment not in annexes_metadata:
                annexes_metadata[current_attachment] = {'articles': [], 'count': 0}
                annex_labels[current_attachment] = original_label

            if details:
                result.append(allegato_tag.get_text(separator=" ", strip=True))
            continue

        # 2. Verifica se è un box_allegati (es. "Disposizioni sulla legge in generale")
        # Questo crea un NUOVO allegato solo se siamo nella sezione "Allegati"
        if 'box_allegati' in classes and 'box_allegati_small' not in classes:
            span_tag = li.find('span')
            if span_tag and span_tag.find_parent('li') == li:
                original_label = span_tag.get_text(separator=" ", strip=True)

                if in_allegati_section:
                    # Crea nuovo allegato
                    annex_counter += 1
                    current_attachment = str(annex_counter)
                    annexes_metadata[current_attachment] = {'articles': [], 'count': 0}
                    annex_labels[current_attachment] = original_label
                    logging.info(f"Detected box_allegati -> new Allegato {current_attachment}: {original_label}")
                else:
                    logging.info(f"Detected box_allegati (before Allegati section, ignoring): {original_label}")

                if details:
                    result.append(original_label)
                continue

        # 2b. Verifica se è un box_allegati_small (es. "CODICE CIVILE", "Codice Penale")
        # Questo crea SEMPRE un nuovo allegato (indica contenuto principale di un codice)
        if 'box_allegati_small' in classes:
            box_text = li.get_text(strip=True)
            original_label = box_text

            # Crea nuovo allegato
            annex_counter += 1
            current_attachment = str(annex_counter)
            annexes_metadata[current_attachment] = {'articles': [], 'count': 0}
            annex_labels[current_attachment] = original_label
            logging.info(f"Detected box_allegati_small -> new Allegato {current_attachment}: {original_label}")

            if details:
                result.append(original_label)
            continue

        # 3. Verifica se è un'intestazione di sezione
        if 'singolo_risultato_collapse' in li.get('class', []):
            if details:
                section_text = li.get_text(separator=" ", strip=True)
                result.append(section_text)
            continue

        # 4. Processa l'articolo
        a_tag = li.find('a', class_='numero_articolo')
        if a_tag and a_tag.find_parent('li') == li:
            text_content = a_tag.get_text(separator=" ", strip=True)
            # Rimuove "art. ", spazi e punti finali
            article_num = re.sub(r'^\s*art\.\s*', '', text_content, flags=re.IGNORECASE).strip().rstrip('.')

            # Skip invalid article numbers (e.g., "orig", empty strings, non-article text)
            if not article_num or not re.match(r'^[\dIVXLCDM]', article_num, re.IGNORECASE):
                logging.debug(f"Skipping invalid article number: '{article_num}'")
                continue

            article_data = _extract_normattiva_article(a_tag, normurn, link, attachment_number=current_attachment)
            if article_data:
                article_data["numero"] = article_num # Sync cleaned number
                result.append(article_data)
                count_articles += 1

                # Track in metadata
                if return_metadata:
                    key = current_attachment
                    if key not in annexes_metadata:
                        annexes_metadata[key] = {'articles': [], 'count': 0}
                    annexes_metadata[key]['count'] += 1
                    # Store all article numbers for navigation (was limited to 50)
                    annexes_metadata[key]['articles'].append(article_num)

    # Build structured metadata response
    metadata = {}
    if return_metadata and annexes_metadata:
        metadata['annexes'] = []
        # Sort: None (main text) first, then numeric annexes
        sorted_keys = sorted(annexes_metadata.keys(), key=lambda x: (x is not None, int(x) if (x and str(x).isdigit()) else 999))
        for annex_num in sorted_keys:
            data = annexes_metadata[annex_num]
            # Only include if there are articles or it's the main text
            if data['count'] == 0 and annex_num is not None:
                continue
            # Use preserved label or fallback
            label = annex_labels.get(annex_num, f"Allegato {annex_num}" if annex_num is not None else "Dispositivo")
            metadata['annexes'].append({
                'number': annex_num,
                'label': label,
                'article_count': data['count'],
                'article_numbers': data['articles']
            })

    if return_metadata:
        return result, count_articles, metadata
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

    article_data = {
        "numero": text_content,
        "allegato": attachment_number
    }

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
        article_data["url"] = modified_url

    return article_data


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
    seen_sections = set()
    count_articles = 0

    # Estrai anno e numero dall'URL per generare link ELI
    eli_info = _extract_eli_info(normurn)

    # Pattern per identificare strutture gerarchiche
    title_pattern = re.compile(r'^(TITOLO|TITLE)\s+([IVXLCDM]+|\d+)', re.IGNORECASE)
    chapter_pattern = re.compile(r'^(CAPO|CHAPTER)\s+([IVXLCDM]+|\d+)', re.IGNORECASE)
    section_pattern = re.compile(r'^(SEZIONE|SECTION)\s+(\d+|\w+)', re.IGNORECASE)
    article_pattern = re.compile(r'^(Articolo|Article)\s+(\d+)', re.IGNORECASE)

    # Strategia principale: cerca elementi ti-section (sezioni) e ti-art (articoli) in ordine di documento
    # Questo preserva l'ordine gerarchico: CAPO -> Sezione -> Articolo

    # Trova tutti gli elementi strutturali in ordine
    structure_elements = soup.find_all(['p', 'div', 'span'], class_=lambda c: c and any(x in str(c).lower() for x in ['ti-section', 'ti-art']))

    if structure_elements:
        logging.info(f"Found {len(structure_elements)} structure elements (ti-section/ti-art)")

        for elem in structure_elements:
            text = elem.get_text(strip=True)
            class_str = ' '.join(elem.get('class', []))

            # Verifica se è un header di sezione (CAPO, Sezione, TITOLO)
            if 'ti-section' in class_str.lower():
                # Estrai solo il titolo della sezione (CAPO I, Sezione 1, etc.)
                section_match = (title_pattern.match(text) or
                               chapter_pattern.match(text) or
                               section_pattern.match(text))
                if section_match and details:
                    section_title = section_match.group(0)
                    if section_title not in seen_sections:
                        seen_sections.add(section_title)
                        result.append(section_title)
                        logging.debug(f"Found section: {section_title}")

            # Verifica se è un articolo
            elif 'ti-art' in class_str.lower():
                article_match = article_pattern.match(text)
                if article_match:
                    article_num = article_match.group(2)
                    if article_num not in seen_articles:
                        seen_articles.add(article_num)
                        article_data = _format_eurlex_article(article_num, normurn, eli_info, link)
                        result.append(article_data)
                        count_articles += 1

    # Fallback: cerca nel documento con pattern matching se non trovato nulla
    if count_articles == 0:
        logging.info("ti-section/ti-art not found, falling back to pattern search")

        # Cerca tutti gli elementi che potrebbero contenere articoli o sezioni
        for elem in soup.find_all(['p', 'div', 'span', 'h1', 'h2', 'h3', 'h4']):
            text = elem.get_text(strip=True)

            # Check for sections first (when details=True)
            if details:
                section_match = (title_pattern.match(text) or
                               chapter_pattern.match(text) or
                               section_pattern.match(text))
                if section_match:
                    section_title = section_match.group(0)
                    if section_title not in seen_sections:
                        seen_sections.add(section_title)
                        result.append(section_title)
                    continue

            # Check for articles
            article_match = article_pattern.match(text)
            if article_match:
                article_num = article_match.group(2)
                if article_num not in seen_articles:
                    seen_articles.add(article_num)
                    article_data = _format_eurlex_article(article_num, normurn, eli_info, link)
                    result.append(article_data)
                    count_articles += 1

    logging.info(f"Extracted {count_articles} unique articles and {len(seen_sections)} sections from Eur-Lex")
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
    article_data = {
        "numero": article_num
    }

    if link:
        # Genera URL ELI per l'articolo specifico
        if eli_info['type'] and eli_info['year'] and eli_info['num']:
            article_url = f"https://eur-lex.europa.eu/eli/{eli_info['type']}/{eli_info['year']}/{eli_info['num']}/art_{article_num}/oj"
        else:
            # Fallback: usa URL base con ancora
            article_url = f"{normurn}#art_{article_num}"
        article_data["url"] = article_url

    return article_data


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

