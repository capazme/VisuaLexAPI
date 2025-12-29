import re
import logging
import asyncio
from .config import MAX_CACHE_SIZE
from .text_op import normalize_act_type, parse_date, estrai_data_da_denominazione
from .map import NORMATTIVA_URN_CODICI, EURLEX
from .sys_op import get_playwright_manager
from ..services.eurlex_scraper import EurlexScraper

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

# Cache for completed dates (since we can't use lru_cache with async)
_date_cache: dict[tuple, str] = {}


async def complete_date(act_type: str, date: str, act_number: str) -> str:
    """
    Completes the date of a legal norm using the Normattiva website.

    Arguments:
    act_type -- Type of the legal act
    date -- Date of the act (year)
    act_number -- Number of the act

    Returns:
    str -- Completed date or error message
    """
    cache_key = (act_type, date, act_number)
    if cache_key in _date_cache:
        logging.info(f"Date found in cache: {_date_cache[cache_key]}")
        return _date_cache[cache_key]

    logging.info(f"Completing date for act_type: {act_type}, date: {date}, act_number: {act_number}")

    playwright_manager = get_playwright_manager()
    context = None
    try:
        context = await playwright_manager.new_context()
        page = await context.new_page()

        await page.goto("https://www.normattiva.it/", wait_until="domcontentloaded")

        search_criteria = f"{normalize_act_type(input_type=act_type, search=False, source='normattiva')} {act_number} {date}"
        logging.info(f"Search criteria: {search_criteria}")

        # Fill search box and submit
        await page.fill("#testoRicerca", search_criteria)
        await page.click("#button-3")

        # Wait for results
        await page.wait_for_selector('#heading_1 p a', timeout=10000)
        element = await page.query_selector('#heading_1 p a')

        if element:
            element_text = await element.inner_text()
            logging.info(f"Element text found: {element_text}")

            completed_date = estrai_data_da_denominazione(element_text)
            logging.info(f"Completed date: {completed_date}")

            # Cache the result
            _date_cache[cache_key] = completed_date
            return completed_date
        else:
            raise Exception("Result element not found")

    except Exception as e:
        logging.error(f"Error in complete_date: {e}", exc_info=True)
        return f"Errore nel completamento della data, inserisci la data completa: {e}"
    finally:
        if context:
            await context.close()

def generate_urn(act_type, date=None, act_number=None, article=None, annex=None, version=None, version_date=None, urn_flag=True):
    """
    Generates the URN for a legal norm.

    Arguments:
    act_type -- Type of the legal act
    date -- Date of the act
    act_number -- Number of the act
    article -- Article number (optional)
    annex -- Annex to the law (optional)
    version -- Version of the act (optional)
    version_date -- Date of the version (optional)
    urn_flag -- Boolean flag to include full URN or not

    Returns:
    str -- The generated URN
    """
    logging.info(f"Generating URN for act_type: {act_type}, date: {date}, act_number: {act_number}, article: {article}, annex: {annex}, version: {version}, version_date: {version_date}, urn_flag: {urn_flag}")
    codici_urn = NORMATTIVA_URN_CODICI
    base_url = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
    normalized_act_type = normalize_act_type(act_type)
    
    # Check if 'article' is a valid string before attempting to split it
    extension = None
    if article and '-' in article:
        parts = article.split('-')
        article = parts[0]
        extension = parts[1]
    
    # Handle EURLEX cases (check before replacing spaces with dots)
    if normalized_act_type.lower() in EURLEX:
        eurlex_scraper = EurlexScraper()
        return eurlex_scraper.get_uri(act_type=normalized_act_type.lower(), year=date, num=act_number)

    # Handle special codes (codice civile, codice penale, etc.)
    # IMPORTANT: Check BEFORE replacing spaces with dots, as codici_urn uses spaces
    if normalized_act_type in codici_urn:
        urn = codici_urn[normalized_act_type]
        logging.info(f"URN found in codici_urn: {urn}")

        # IMPORTANT: The URN from codici_urn may already contain an allegato suffix (e.g., ":1")
        # Pattern: "regio.decreto:1930-10-19;1398:1" where the final ":1" is the allegato
        # We need to strip this default allegato so we can control it via the `annex` parameter
        # This allows requesting dispositivo (annex=None) even for codici that default to an allegato
        allegato_match = re.match(r'^(.+;\d+):(\d+)$', urn)
        if allegato_match:
            base_urn = allegato_match.group(1)  # URN without allegato
            default_allegato = allegato_match.group(2)  # The default allegato from the map
            logging.info(f"Stripped default allegato {default_allegato} from codice URN, base: {base_urn}")

            # If annex is explicitly None, use the base URN (dispositivo)
            # If annex is provided, it will be added later in the code
            # If annex is None but we want the default, the caller should pass the allegato explicitly
            urn = base_urn
    else:
        # For regular act types, replace spaces with dots for NIR URN format
        # (e.g., "regio decreto" -> "regio.decreto")
        normalized_act_type_urn = normalized_act_type.replace(' ', '.')
        try:
            formatted_date = complete_date_or_parse(date, act_type, act_number)
            urn = f"{normalized_act_type_urn}:{formatted_date};{act_number}"
            logging.info(f"Generated base URN: {urn}")
        except Exception as e:
            logging.error(f"Error generating URN: {e}", exc_info=True)
            return None
    
    if annex:
        urn = urn + f':{annex.strip()}'
    
    # Assuming these functions are defined elsewhere
    urn = append_article_info(urn, article, extension)  
    urn = append_version_info(urn, version, version_date)

    final_urn = base_url + urn
    result = final_urn if urn_flag else final_urn.split("~")[0]
    logging.info(f"Final URN: {result}")
    
    return result

def complete_date_or_parse(date, act_type, act_number):
    """
    Parses the date synchronously. For year-only dates, converts to YYYY-01-01.
    Use complete_date_or_parse_async for actual date lookup from Normattiva.

    Arguments:
    date -- Date of the act
    act_type -- Type of the legal act
    act_number -- Number of the act

    Returns:
    str -- Formatted date (YYYY-MM-DD)
    """
    # Handle None or empty date for special codes (e.g., codice civile)
    if date is None or date == '':
        return None
    # For year-only, default to January 1st (sync fallback, URN will still work)
    if re.match(r"^\d{4}$", date):
        return f"{date}-01-01"
    return parse_date(date)


async def complete_date_or_parse_async(date, act_type, act_number):
    """
    Completes the date if necessary using Normattiva lookup, or parses the date.
    Use this async version when you need the actual complete date.

    Arguments:
    date -- Date of the act
    act_type -- Type of the legal act
    act_number -- Number of the act

    Returns:
    str -- Formatted date (YYYY-MM-DD) with real day/month from Normattiva lookup
    """
    # Handle None or empty date for special codes (e.g., codice civile)
    if date is None or date == '':
        return None
    if re.match(r"^\d{4}$", date) and act_number:
        act_type_for_search = normalize_act_type(act_type, search=True)
        full_date = await complete_date(act_type=act_type_for_search, date=date, act_number=act_number)
        return parse_date(full_date)
    return parse_date(date)

def append_article_info(urn, article, extension):
    """
    Appends article information to the URN.

    Arguments:
    urn -- The base URN
    article -- Article number (optional)
    extension -- Article extension (optional)

    Returns:
    str -- The URN with article information appended
    """
    if article:
        if "-" in article:
            article, extension = article.split("-")
        article = re.sub(r'\b[Aa]rticoli?\b|\b[Aa]rt\.?\b', "", article).strip()
        urn += f"~art{article}"
        if extension:
            urn += extension
        logging.info(f"Appended article info to URN: {urn}")
    return urn

def append_version_info(urn, version, version_date):
    """
    Appends version information to the URN.

    Arguments:
    urn -- The base URN with article information
    version -- Version of the act (optional)
    version_date -- Date of the version (optional)

    Returns:
    str -- The URN with version information appended
    """
    if version == "originale":
        urn += "@originale"
    elif version == "vigente":
        urn += "!vig="
        if version_date:
            formatted_version_date = parse_date(version_date)
            urn += formatted_version_date
        logging.info(f"Appended version info to URN: {urn}")
    return urn

def urn_to_filename(urn):
    """
    Converts a URN to a filename.

    Arguments:
    urn -- The URN string

    Returns:
    str -- The generated filename
    """
    logging.info(f"Converting URN to filename: {urn}")
    try:
        act_type_section = urn.split('stato:')[1].split('~')[0]
    except IndexError:
        logging.error("Invalid URN format")
        raise ValueError("Invalid URN format")
    
    if ':' in act_type_section and ';' in act_type_section:
        type_and_date, number = act_type_section.split(';')
        year = type_and_date.split(':')[1].split('-')[0]
        filename = f"{number}_{year}.pdf"
        logging.info(f"Generated filename: {filename}")
        return filename

    act_type = act_type_section.split('/')[-1]
    filename = f"{act_type.capitalize()}.pdf"
    logging.info(f"Generated filename: {filename}")
    return filename
