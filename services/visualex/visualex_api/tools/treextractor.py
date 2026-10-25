import asyncio
from bs4 import BeautifulSoup
import logging
import re
from urllib.parse import urlparse
from aiocache import cached, Cache
from aiocache.serializers import JsonSerializer
from playwright.async_api import async_playwright

from .cache import PersistentCache
from .cache_manager import get_cache_manager
from .egress import is_allowed
from .exceptions import DocumentNotFoundError, NetworkError
from .logging_config import log_handlers
from ..services.akn_parser import normalize_article_key
from .article_suffixes import ARTICLE_SUFFIX_ALTERNATION
from ..services.http_client import http_client

# Configurazione del logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=log_handlers("norma.log"))

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


# The shortest EUR-Lex page the scraper accepts as an act (EurlexScraper.request_document): a
# shorter one is an error or a challenge page, never stored where the scraper reads.
_EURLEX_MIN_PAGE = 1000


def _full_key(normurn, link):
    """The persistent key of the widest Normattiva tree: section labels and metadata."""
    return f"{normurn}|link={link}|details=True|metadata=True"


def _narrow(result, count, metadata, details, return_metadata):
    """A Normattiva tree as `get_tree(details, return_metadata)` answers it, from the widest
    one (`details=True, return_metadata=True`) of the same page and `link`. The parser builds
    the same article entries and the same metadata whatever `details` and `return_metadata`
    say; `details` only adds the section labels (bare strings) between them, so dropping the
    strings is the narrower parse (tests/test_tree_variants.py)."""
    if not details and isinstance(result, list):
        result = [entry for entry in result if isinstance(entry, dict)]
    if return_metadata:
        return result, count, metadata
    return result, count


async def _eurlex_page(normurn):
    """The EUR-Lex page behind a tree: the copy the scraper keeps (namespace "eurlex", keyed by
    the same URL), else one Playwright visit. The article text is read from that page too, so
    one visit serves the tree, the rubriche and every article of the act."""
    cached_html = await get_cache_manager().get_persistent("eurlex").get(normurn)
    if cached_html:
        logging.info(f"EUR-Lex page from the scraper's cache: {normurn[:80]}")
        return cached_html, True
    return await _fetch_with_playwright(normurn), False


def _source_of(normurn):
    """"normattiva" or "eurlex" by the URL's host (the hosts every URL the app builds uses),
    else None: a word in the path or the query decides nothing."""
    try:
        host = urlparse(normurn).hostname
    except ValueError:
        return None
    return {"www.normattiva.it": "normattiva", "eur-lex.europa.eu": "eurlex"}.get(host)


def _no_tree(result):
    """A failure (a blocked page, a timeout) or an empty tree: (message or [], 0[, {}]). Never kept
    in memory, as the persistent cache never keeps it: the next caller asks the source again
    instead of reading the failure for an hour."""
    return isinstance(result, tuple) and len(result) >= 2 and result[1] == 0


@cached(ttl=3600, cache=Cache.MEMORY, serializer=JsonSerializer(), skip_cache_func=_no_tree)
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
    source = _source_of(normurn)
    is_eurlex = source == "eurlex"
    is_normattiva = source == "normattiva"

    # One Normattiva page, one download: every (details, return_metadata) variant is read
    # from the widest tree of that page. The existence check, a range and the index the web
    # opens ask for three different variants of the same page, and each used to fetch it.
    if is_normattiva:
        full = await _tree_cache.get(_full_key(normurn, link))
        if full:
            logging.info(f"Persistent cache hit for the full tree: {normurn[:50]}")
            return _narrow(full.get("result", []), full.get("count", 0),
                           full.get("metadata", {}), details, return_metadata)

    if is_eurlex:
        # The scraper's copy first; a copy that holds no article (a refused visit the scraper
        # kept) is not trusted, and the page is visited again, as it was before the copy was read.
        answer = await _tree_from_page(normurn, link, details, return_metadata, is_eurlex,
                                       eurlex_copy=True)
        if answer[1] == 0 and answer[-1]:
            answer = await _tree_from_page(normurn, link, details, return_metadata, is_eurlex,
                                           eurlex_copy=False)
    else:
        answer = await _tree_from_page(normurn, link, details, return_metadata, is_eurlex)
    return answer[:-1]


async def _tree_from_page(normurn, link, details, return_metadata, is_eurlex, eurlex_copy=False):
    """`get_tree`'s answer read from the page, plus whether the page was the EUR-Lex scraper's
    copy (the last element, dropped by `get_tree`)."""
    from_copy = False

    def failure(message):
        return (message, 0, {}, from_copy) if return_metadata else (message, 0, from_copy)

    # `normurn` comes from the caller (POST /fetch_tree): only a declared host is visited, by
    # the browser as by the client, and only Normattiva's or EUR-Lex's host.
    if not is_allowed(normurn):
        logging.error(f"Tree refused for an undeclared host: {normurn[:80]}")
        return failure(f"Host non consentito: {normurn[:80]}")
    if not is_eurlex and _source_of(normurn) != "normattiva":
        logging.warning(f"Unrecognized norm URN format: {normurn}")
        return failure("Unrecognized norm URN format")

    try:
        if is_eurlex:
            # EUR-Lex requires Playwright to bypass WAF
            if eurlex_copy:
                text, from_copy = await _eurlex_page(normurn)
            else:
                text = await _fetch_with_playwright(normurn)
        else:
            # Normattiva through the shared client, as its article pages: its rate limit and
            # its host check. One attempt, as when the tree had a session of its own: the
            # retry budget toward the source is not raised here.
            text = (await http_client.request("GET", normurn, source="normattiva",
                                              max_retries=0)).text
    except (NetworkError, DocumentNotFoundError) as e:
        logging.error(f"HTTP error while fetching page: {e}")
        return failure(f"Failed to retrieve the page: {e}")
    except Exception as e:
        logging.error(f"Unexpected error: {e}", exc_info=True)
        return failure(f"Unexpected error: {e}")

    if not text or len(text) < 500:
        logging.error(f"Empty or too short response from {normurn[:50]}")
        return failure("Empty response from server")

    soup = BeautifulSoup(text, 'html.parser')

    if not is_eurlex:
        result, count, metadata = await _parse_normattiva_tree(
            soup, normurn, link, True, return_metadata=True)
        if count > 0:
            await _tree_cache.set(_full_key(normurn, link),
                                  {"result": result, "count": count, "metadata": metadata})
            logging.info(f"Stored full tree in persistent cache: {normurn[:50]}, {count} articles")
        return _narrow(result, count, metadata, details, return_metadata) + (from_copy,)
    else:
        # No annexes on EUR-Lex, but the parse does yield article titles.
        result, count, metadata = await _parse_eurlex_tree(soup, normurn, link, details)
        if count > 0 and not from_copy and len(text) >= _EURLEX_MIN_PAGE:
            # A page that parsed into articles is the act's: kept where the scraper reads it.
            await get_cache_manager().get_persistent("eurlex").set(normurn, text)

    # Store in persistent cache for future restarts
    if count > 0:
        cache_key = f"{normurn}|link={link}|details={details}|metadata={return_metadata}"
        cache_data = {"result": result, "count": count}
        if return_metadata:
            cache_data["metadata"] = metadata
        await _tree_cache.set(cache_key, cache_data)
        logging.info(f"Stored tree in persistent cache: {normurn[:50]}, {count} articles")

    if return_metadata:
        return result, count, metadata, from_copy
    return result, count, from_copy


# "art. 1" in the tree's links, or "art 1" without the dot, as some annexes write it
# (d.lgs. 36/2023, Allegato I.4): the dotless ones used to be dropped from the tree.
_ARTICLE_LABEL_PREFIX = re.compile(r'^\s*art(?:\.\s*|\s+)', re.IGNORECASE)


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
            article_num = _ARTICLE_LABEL_PREFIX.sub('', text_content).strip().rstrip('.')

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
    text_content = _ARTICLE_LABEL_PREFIX.sub('', text_content)

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

    # Normalize article_number: rimuovi spazi e trattini, converti in minuscolo.
    # "270 bis.1" -> art270bis.1, "19-bis.1" -> art19bis.1, "314/2" -> art314/2,
    # "135 sex decies" -> art135sexdecies. A bare digit after an ordinal is a
    # dotted sub-number in Normattiva's URN grammar: "171 octies 1" (l.
    # 633/1941) is ~art171octies.1 — ~art171octies1, which this used to build,
    # makes Normattiva answer Art. 1 (gotcha 24). Same rule as
    # text_op._canonicalise_article_token.
    article_number = article_number.lower()
    article_number = re.sub(r'(?<=[a-z])[\s-]+(?=\d+$)', '.', article_number)
    article_number = article_number.replace(' ', '').replace('-', '')

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


def is_quoted_heading(element) -> bool:
    """An article heading quoted inside the act's text, not one of its own articles.

    An amending act's OJ page sets the articles it replaces or inserts in another act in a
    table cell, the first of a run opening with «: dir. 2009/136 (six articles) quotes art.
    21, 22, 23, 23 bis and 27 of dir. 2002/22, and they were listed and served as its own.
    The act's own articles never sit in a table cell (checked on every EUR-Lex test page).
    """
    return (element.get_text(strip=True).startswith(("«", "“"))
            or element.find_parent("td") is not None)


# An ordinal after a heading's number: a whole word («15 bis», «15 BIS», «15-bis»), or a lower-case
# ordinal glued to the capital that opens the text after it, as a class-less page whose heading and
# text share an element reads «Articolo 15 bisTesto». A capital after a lower-case ordinal never
# starts a word of it; «Articolo 1 Bisogna» and «Articolo 1Terzi» stay art. 1.
HEADING_ORDINAL = (rf"(?:(?:{ARTICLE_SUFFIX_ALTERNATION})(?![^\W\d_])"
                   rf"|(?-i:(?:{ARTICLE_SUFFIX_ALTERNATION})(?=[A-ZÀ-Ý])))")

# An OJ heading's number with its ordinal, read as one article: «Articolo 15 bis» is «15-bis».
_EURLEX_HEADING_NUMBER = re.compile(
    rf"^(?:Articolo|Article)\s+(\d+)(?:[\s\-]*+({HEADING_ORDINAL}))?", re.IGNORECASE)


def eurlex_heading_number(text):
    """The article an OJ heading names («15», «15-bis»), or None when it names none."""
    match = _EURLEX_HEADING_NUMBER.match(text)
    if not match:
        return None
    return f"{match.group(1)}-{match.group(2).lower()}" if match.group(2) else match.group(1)


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

    if soup.find("p", class_="title-article-norm"):
        result, count_articles = _walk_consolidated_tree(soup, normurn, link, details, eli_info)
        rubriche = _extract_eurlex_rubriche(soup)
        logging.info(f"Consolidated EUR-Lex tree: {count_articles} articles, {len(rubriche)} rubriche")
        return result, count_articles, {"rubriche": rubriche, "title": _extract_eurlex_title(soup)}

    # Pattern per identificare strutture gerarchiche
    title_pattern = re.compile(r'^(TITOLO|TITLE)\s+([IVXLCDM]+|\d+)', re.IGNORECASE)
    chapter_pattern = re.compile(r'^(CAPO|CHAPTER)\s+([IVXLCDM]+|\d+)', re.IGNORECASE)
    section_pattern = re.compile(r'^(SEZIONE|SECTION)\s+(\d+|\w+)', re.IGNORECASE)

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
                article_num = None if is_quoted_heading(elem) else eurlex_heading_number(text)
                if article_num:
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
            article_num = None if is_quoted_heading(elem) else eurlex_heading_number(text)
            if article_num:
                if article_num not in seen_articles:
                    seen_articles.add(article_num)
                    article_data = _format_eurlex_article(article_num, normurn, eli_info, link)
                    result.append(article_data)
                    count_articles += 1

    logging.info(f"Extracted {count_articles} unique articles and {len(seen_sections)} sections from Eur-Lex")
    # Article titles come free with this page: EUR-Lex marks the number with
    # `oj-ti-art` ("Articolo 1") and the title with `oj-sti-art` ("Oggetto e
    # finalità") right after it. Unlike Normattiva — whose tree carries bare
    # numbers and whose titles live in a separate 10 MB export — here the whole
    # index can be labelled without a single extra request, so it is built
    # during the same parse rather than behind another fetch.
    rubriche = _extract_eurlex_rubriche(soup)
    logging.info(f"EUR-Lex rubriche extracted: {len(rubriche)} of {count_articles} articles")

    return result, count_articles, {"rubriche": rubriche, "title": _extract_eurlex_title(soup)}


_EURLEX_ARTICLE_NUM = re.compile(r"^(?:Articolo|Article)\s+([\w.-]+)", re.IGNORECASE)


# EUR-Lex marks amended passages inline as well as with block markers:
# "►M2 … ◄" (amending act), "►C2 … ◄" (corrigendum), "►B" (base act), and
# "▼M2" / "▼B" at the head of a replaced block. The glyphs are never part of
# the legal text.
# A marker with the whitespace on both sides. The leading run is matched only from its first
# character (`(?<!\s)`), or a search restarted at every blank of a long run and scanned the
# rest of it each time: 0.85 s on 20,000 blanks. A marker right after an earlier match, whose
# trailing run took the blanks, is the second branch. Same matches as `\s*[►◄▼]…\s*`.
_AMENDMENT_MARK = re.compile(r"(?:(?<!\s)\s++)?[►◄▼](?:[A-Z]\d*)?\s*")


def strip_amendment_markers(text: str) -> str:
    """Drop inline "►M2 … ◄" / "▼M2" markers and collapse the whitespace they leave."""
    return re.sub(r"[ \t\xa0]+", " ", _AMENDMENT_MARK.sub(" ", text or "")).strip()


def _next_non_modref_sibling(element):
    """The next sibling that is not a `modref` marker.

    EUR-Lex drops a "▼M2" / "▼B" paragraph before every block an amendment
    touched, so the element that logically follows a title — its rubrica,
    or the heading text after a heading number — may sit one marker away.
    """
    sibling = element.find_next_sibling()
    while sibling is not None and "modref" in (sibling.get("class", []) or []):
        sibling = sibling.find_next_sibling()
    return sibling


def _cons_rubrica_of(marker):
    """The rubrica element that follows a consolidated article marker.

    Bare `stitle-article-norm` (flat pages) or inside `div.eli-title`
    (subdivision pages); a `modref` marker may sit in between.
    """
    sibling = _next_non_modref_sibling(marker)
    if sibling is None:
        return None
    classes = sibling.get("class", []) or []
    if "stitle-article-norm" in classes:
        return sibling
    if "eli-title" in classes:
        return sibling.find("p", class_="stitle-article-norm")
    return None


def _extract_consolidated_rubriche(soup):
    rubriche = {}
    for marker in soup.find_all("p", class_="title-article-norm"):
        key = normalize_article_key(marker.get_text(" ", strip=True))
        if not key:
            continue
        rubrica = _cons_rubrica_of(marker)
        if rubrica is None:
            continue
        title = strip_amendment_markers(rubrica.get_text(" ", strip=True))
        if title:
            rubriche[key] = title
    return rubriche


def _walk_consolidated_tree(soup, normurn, link, details, eli_info):
    """Articles and (with details) chapter headings of a consolidated page.

    `title-division-1` is the heading number ("CAPO I", "SEZIONE 1") and the
    `title-division-2` right after it the heading text; both are kept so the
    index reads "CAPO I DISPOSIZIONI GENERALI". Article numbers are
    canonicalised through the shared suffix table: "Articolo 14 bis" is
    14-bis, not a second 14.
    """
    result = []
    seen = set()
    count = 0
    for elem in soup.find_all("p", class_=["title-division-1", "title-article-norm"]):
        classes = elem.get("class", []) or []
        if "title-division-1" in classes:
            if not details:
                continue
            heading = elem.get_text(" ", strip=True)
            nxt = _next_non_modref_sibling(elem)
            if nxt is not None and "title-division-2" in (nxt.get("class", []) or []):
                heading = f"{heading} {nxt.get_text(' ', strip=True)}"
            result.append(strip_amendment_markers(heading))
            continue
        key = normalize_article_key(elem.get_text(" ", strip=True))
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(_format_eurlex_article(key, normurn, eli_info, link))
        count += 1
    return result, count


def _extract_eurlex_rubriche(soup):
    """Article number -> title, from an EUR-Lex document.

    The title is the `oj-sti-art` sibling that follows each `oj-ti-art`. Some
    documents label it `eli-title` instead, so both are accepted; an article
    with neither is simply absent from the map.
    """
    if soup.find("p", class_="title-article-norm"):
        return _extract_consolidated_rubriche(soup)
    rubriche = {}
    for marker in soup.find_all(class_=lambda c: c and "ti-art" in str(c).lower()
                                and "sti-art" not in str(c).lower()):
        if is_quoted_heading(marker):
            continue
        heading = marker.get_text(" ", strip=True)
        number = eurlex_heading_number(heading)
        if not number:
            # A heading with no number in figures («Articolo unico») keeps its own word.
            match = _EURLEX_ARTICLE_NUM.match(heading)
            if not match:
                continue
            number = match.group(1)
        sibling = marker.find_next_sibling()
        if sibling is None:
            continue
        classes = " ".join(sibling.get("class", []) or []).lower()
        if "sti-art" not in classes and "eli-title" not in classes:
            continue
        title = sibling.get_text(" ", strip=True)
        if title:
            rubriche[number] = title
    return rubriche


# "del 27 aprile 2016", "dell'8 giugno 2000": the line between an act's name and its subject.
# A digit after it: «DEL PARLAMENTO EUROPEO…», an act's name split over two lines, is no date.
_EURLEX_DATE_LINE = re.compile(r"^dell?['’\s]\s*\d", re.IGNORECASE)
# The legacy page's description: "Direttiva 2002/58/CE del Parlamento europeo e del Consiglio, del 12 luglio 2002, relativa al …".
_EURLEX_DESCRIPTION_SUBJECT = re.compile(
    r",\s*dell?['’\s]\s*\d{1,2}[°º]?\s+\S+\s+\d{4}\s*,\s*(.+)$", re.IGNORECASE | re.DOTALL)


def _eurlex_subject(lines):
    """The subject among a title's lines: what follows the date, without a note in brackets
    such as "(Testo rilevante ai fini del SEE)"."""
    lines = [strip_amendment_markers(line) for line in lines if line]
    for i, line in enumerate(lines):
        if _EURLEX_DATE_LINE.match(line):
            lines = lines[i + 1:]
            break
    return " ".join(line for line in lines if not (line.startswith("(") and line.endswith(")")))


def _extract_eurlex_title(soup):
    """The act's title as Normattiva's `presentable_title` gives one: its subject ("relativo alla
    protezione delle persone fisiche …"), without the act's name, its date or the EEA note, which
    the dossier already shows in the act's heading. '' when the page does not say.

    The OJ page names the act in `oj-doc-ti` lines inside `eli-main-title` (an annex's heading uses
    the same class, so only the first consecutive run counts, and only when it holds the date); the
    consolidated page in `title-doc-first` and
    `title-doc-last` (printed twice, the first copy is enough; the subject in `title-doc-first`
    when `title-doc-last` holds only the EEA note); the legacy page in its
    `DC.description` meta, which the `/eli/` address of a legacy act does not carry (dir.
    2002/58): there the ELI metadata names the act in every language, and the Italian
    `eli:title` is read the same way. Never a title from another language.
    """
    container = soup.find(class_="eli-main-title")
    first = (container or soup).find("p", class_="oj-doc-ti")
    if first is not None:
        run = [first]
        for sibling in first.find_next_siblings():
            if sibling.name != "p" or "oj-doc-ti" not in (sibling.get("class") or []):
                break
            run.append(sibling)
        lines = [p.get_text(" ", strip=True) for p in run]
        # The subject is what follows the date: without one (a Treaty's page), no title rather
        # than the act's own name repeated under its heading.
        if not any(_EURLEX_DATE_LINE.match(line) for line in lines):
            return ""
        return _eurlex_subject(lines)
    last = soup.find("p", class_="title-doc-last")
    if last is not None:
        subject = _eurlex_subject([last.get_text(" ", strip=True)])
        if subject:
            return subject
        # The consolidated GDPR (02016R0679-20160504) has only the EEA note there: its subject is
        # in the `title-doc-first` run, after the date line, as on the OJ page.
        first = soup.find("p", class_="title-doc-first")
        run = [first] if first is not None else []
        for sibling in first.find_next_siblings() if first is not None else []:
            if sibling.name != "p" or "title-doc-first" not in (sibling.get("class") or []):
                break
            run.append(sibling)
        lines = [p.get_text(" ", strip=True) for p in run]
        return _eurlex_subject(lines) if any(_EURLEX_DATE_LINE.match(line) for line in lines) else ""
    # The Italian expression of the act: `about` names it (…/oj/ita), the language tag alone
    # could also sit on another resource's meta.
    eli_title = soup.find("meta", attrs={"property": "eli:title", "lang": "it",
                                         "about": lambda about: bool(about) and about.rstrip("/").endswith("/ita")})
    for meta in (soup.find("meta", attrs={"name": "DC.description"}), eli_title):
        match = _EURLEX_DESCRIPTION_SUBJECT.search((meta.get("content") or "") if meta else "")
        if match:
            return " ".join(match.group(1).split())
    return ""


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

