import re
import asyncio
import structlog
from functools import lru_cache
from selenium.webdriver.common.by import By
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from merlt.sources.utils.config import MAX_CACHE_SIZE
from merlt.sources.utils.text import normalize_act_type, parse_date, estrai_data_da_denominazione
from merlt.sources.utils.map import NORMATTIVA_URN_CODICI, EURLEX
from merlt.sources.utils.sys_op import web_driver_manager

# Lazy import to avoid circular dependency
# EurlexScraper will be imported only when needed (for EU legislation)
EurlexScraper = None

# Configure logging
log = structlog.get_logger()

lru_cache(maxsize=MAX_CACHE_SIZE)
async def complete_date(act_type, date, act_number):
    """
    Completes the date of a legal norm using the Normattiva website.

    Arguments:
    act_type -- Type of the legal act
    date -- Date of the act (year)
    act_number -- Number of the act

    Returns:
    str -- Completed date or error message
    """
    log.info(f"Completing date for act_type: {act_type}, date: {date}, act_number: {act_number}")

    loop = asyncio.get_running_loop()

    def run_selenium_sync():
        driver = web_driver_manager.get_driver()
        try:
            driver.get("https://www.normattiva.it/")

            # Handle cookie consent banner
            try:
                cookie_banner = WebDriverWait(driver, 5).until(
                    EC.element_to_be_clickable((By.ID, "cookie_poilicy_mobile_close"))
                )
                cookie_banner.click()
                log.info("Closed cookie consent banner.")
            except TimeoutException:
                log.info("Cookie consent banner not found or already closed.")

            search_box = driver.find_element(By.CSS_SELECTOR, "#testoRicerca")
            search_criteria = f"{normalize_act_type(input_type=act_type, search=False, source='normattiva')} {act_number} {date}"
            log.info(f"Search criteria: {search_criteria}")
            
            search_box.clear()
            search_box.send_keys(search_criteria)
            
            # Using the new search button selector
            search_button = WebDriverWait(driver, 5).until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "button.btn.btn-primary[type='submit']"))
            )
            search_button.click()

            # Small delay to allow page transition
            import time
            time.sleep(2)

            # Wait for search results and try multiple selectors for the first result link
            element = None
            selectors_to_try = [
                (By.XPATH, '//*[@id="heading_1"]/p[1]/a'),  # Original selector
                (By.CSS_SELECTOR, '.card-body a'),  # New structure selector
                (By.CSS_SELECTOR, '.risultati-ricerca a'),  # Alternative selector
                (By.XPATH, '//div[contains(@class, "card-body")]//a[1]'),  # First link in card body
            ]

            for selector_type, selector in selectors_to_try:
                try:
                    element = WebDriverWait(driver, 5).until(
                        EC.presence_of_element_located((selector_type, selector))
                    )
                    log.info(f"Found search result using selector: {selector}")
                    break
                except TimeoutException:
                    continue

            if element is None:
                raise TimeoutException("No search results found with any selector")
            element_text = element.text
            log.info(f"Element text found: {element_text}")
            
            completed_date = estrai_data_da_denominazione(element_text)
            log.info(f"Completed date: {completed_date}")
            return completed_date
        except TimeoutException:
            log.error("Timeout while waiting for search results.", exc_info=True)
            return f"Timeout: Elemento non trovato. La ricerca non ha prodotto risultati."
        except Exception as e:
            log.error(f"Error in complete_date: {e}", exc_info=True)
            return f"Errore nel completamento della data, inserisci la data completa: {e}"

    return await loop.run_in_executor(None, run_selenium_sync)

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
    log.info(f"Generating URN for act_type: {act_type}, date: {date}, act_number: {act_number}, article: {article}, annex: {annex}, version: {version}, version_date: {version_date}, urn_flag: {urn_flag}")
    codici_urn = NORMATTIVA_URN_CODICI  
    base_url = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
    normalized_act_type = normalize_act_type(act_type)  
    
    # Check if 'article' is a valid string before attempting to split it
    extension = None
    if article and '-' in article:
        parts = article.split('-')
        article = parts[0]
        extension = parts[1]
    
    # Handle EURLEX cases
    if normalized_act_type.lower() in EURLEX:
        # Lazy import to avoid circular dependency
        global EurlexScraper
        if EurlexScraper is None:
            try:
                from merlt.sources.eurlex import EurlexScraper as _EurlexScraper
                EurlexScraper = _EurlexScraper
            except ImportError:
                # Fallback for older import path
                EurlexScraper = None
                log.warning("EurlexScraper not available")
                return None

        if EurlexScraper:
            eurlex_scraper = EurlexScraper()
            return eurlex_scraper.get_uri(act_type=normalized_act_type.lower(), year=date, num=act_number)
        return None

    # Handle other cases with codici_urn
    if normalized_act_type in codici_urn:
        urn = codici_urn[normalized_act_type]
        log.info(f"URN found in codici_urn: {urn}")
    else:
        try:
            # Create a coroutine and run it in a new thread to avoid blocking the event loop
            import concurrent.futures

            async def run_async():
                return await complete_date_or_parse(date, act_type, act_number)

            try:
                # Check if we're in an async context
                loop = asyncio.get_running_loop()
                # Run in a thread pool to avoid blocking the current event loop
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(asyncio.run, run_async())
                    formatted_date = future.result()
            except RuntimeError:
                # No running loop, safe to use asyncio.run() directly
                formatted_date = asyncio.run(run_async())

            urn = f"{normalized_act_type}:{formatted_date};{act_number}"
            log.info(f"Generated base URN: {urn}")
        except Exception as e:
            log.error(f"Error generating URN: {e}", exc_info=True)
            return None
    
    if annex:
        urn = urn + f':{annex.strip()}'
    
    # Assuming these functions are defined elsewhere
    urn = append_article_info(urn, article, extension)  
    urn = append_version_info(urn, version, version_date)

    final_urn = base_url + urn
    result = final_urn if urn_flag else final_urn.split("~")[0]
    log.info(f"Final URN: {result}")
    
    return result

async def complete_date_or_parse(date, act_type, act_number):
    """
    Completes the date if necessary or parses the date.

    Arguments:
    date -- Date of the act
    act_type -- Type of the legal act
    act_number -- Number of the act

    Returns:
    str -- Formatted date
    """
    if re.match(r"^\d{4}$", date) and act_number:
        act_type_for_search = normalize_act_type(act_type, search=True)
        full_date = await complete_date(act_type=act_type_for_search, date=date, act_number=act_number)

        # Check if complete_date returned an error message instead of a date
        if full_date.startswith(("Timeout:", "Errore nel completamento")):
            log.warning(f"complete_date failed: {full_date}, falling back to original date: {date}")
            # Try to parse the original date, if it fails, return a formatted year
            try:
                return parse_date(date)
            except ValueError:
                # If original date is just a year, format it as YYYY-01-01
                if re.match(r"^\d{4}$", date):
                    return f"{date}-01-01"
                raise ValueError(f"Cannot parse date: {date}")

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
        log.info(f"Appended article info to URN: {urn}")
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
        log.info(f"Appended version info to URN: {urn}")
    return urn

def urn_to_filename(urn):
    """
    Converts a URN to a filename.

    Arguments:
    urn -- The URN string

    Returns:
    str -- The generated filename
    """
    log.info(f"Converting URN to filename: {urn}")
    try:
        act_type_section = urn.split('stato:')[1].split('~')[0]
    except IndexError:
        log.error("Invalid URN format")
        raise ValueError("Invalid URN format")
    
    if ':' in act_type_section and ';' in act_type_section:
        type_and_date, number = act_type_section.split(';')
        year = type_and_date.split(':')[1].split('-')[0]
        filename = f"{number}_{year}.pdf"
        log.info(f"Generated filename: {filename}")
        return filename

    act_type = act_type_section.split('/')[-1]
    filename = f"{act_type.capitalize()}.pdf"
    log.info(f"Generated filename: {filename}")
    return filename
