import re
import logging
from functools import lru_cache
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait
from .config import MAX_CACHE_SIZE
from .text_op import normalize_act_type, parse_date, estrai_data_da_denominazione
from .map import NORMATTIVA_URN_CODICI, EURLEX
from .sys_op import WebDriverManager
from . import eurlex

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

@lru_cache(maxsize=MAX_CACHE_SIZE)
def complete_date(act_type, date, act_number):
    """
    Completes the date of a legal norm using the Normattiva website.

    Arguments:
    act_type -- Type of the legal act
    date -- Date of the act (year)
    act_number -- Number of the act

    Returns:
    str -- Completed date or error message
    """
    logging.info(f"Completing date for act_type: {act_type}, date: {date}, act_number: {act_number}")

    driver_manager = WebDriverManager()
    try:
        driver = driver_manager.setup_driver()
        driver.get("https://www.normattiva.it/")
        search_box = driver.find_element(By.CSS_SELECTOR, "#testoRicerca")
        search_criteria = f"{act_type} {act_number} {date}"
        logging.info(f"Search criteria: {search_criteria}")
        
        search_box.send_keys(search_criteria)
        WebDriverWait(driver, 5).until(EC.element_to_be_clickable((By.XPATH, "//*[@id=\"button-3\"]"))).click()
        element = WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.XPATH, '//*[@id="heading_1"]/p[1]/a')))
        element_text = element.text
        logging.info(f"Element text found: {element_text}")
        
        completed_date = estrai_data_da_denominazione(element_text)
        logging.info(f"Completed date: {completed_date}")
        return completed_date
    except Exception as e:
        logging.error(f"Error in complete_date: {e}", exc_info=True)
        return f"Errore nel completamento della data, inserisci la data completa: {e}"
    finally:
        driver_manager.close_drivers()

@lru_cache(maxsize=MAX_CACHE_SIZE)
def generate_urn(act_type, date=None, act_number=None, article=None, extension=None, version=None, version_date=None, urn_flag=True):
    """
    Generates the URN for a legal norm.

    Arguments:
    act_type -- Type of the legal act
    date -- Date of the act
    act_number -- Number of the act
    article -- Article number (optional)
    extension -- Article extension (optional)
    version -- Version of the act (optional)
    version_date -- Date of the version (optional)
    urn_flag -- Boolean flag to include full URN or not

    Returns:
    str -- The generated URN
    """
    logging.info(f"Generating URN for act_type: {act_type}, date: {date}, act_number: {act_number}, article: {article}, extension: {extension}, version: {version}, version_date: {version_date}, urn_flag: {urn_flag}")
    codici_urn = NORMATTIVA_URN_CODICI
    base_url = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
    normalized_act_type = normalize_act_type(act_type)

    if normalized_act_type in EURLEX:
        if normalized_act_type in {"CFDUE", "TUE", "TFUE"}:
            logging.info(f"Returning EURLEX URN for trattato: {EURLEX[normalized_act_type]}")
            return EURLEX[normalized_act_type]
        else:
            return eurlex.get_eur_uri(act_type=EURLEX[normalized_act_type], year=date, num=act_number)

    if normalized_act_type in codici_urn:
        urn = codici_urn[normalized_act_type]
        logging.info(f"URN found in codici_urn: {urn}")
    else:
        try:
            formatted_date = complete_date_or_parse(date, act_type, act_number)
            urn = f"{normalized_act_type}:{formatted_date};{act_number}"
            logging.info(f"Generated base URN: {urn}")
        except Exception as e:
            logging.error(f"Error generating URN: {e}", exc_info=True)
            return None

    urn = append_article_info(urn, article, extension)
    urn = append_version_info(urn, version, version_date)

    final_urn = base_url + urn
    result = final_urn if urn_flag else final_urn.split("~")[0]
    logging.info(f"Final URN: {result}")
    
    return result

def complete_date_or_parse(date, act_type, act_number):
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
        full_date = complete_date(act_type=act_type_for_search, date=date, act_number=act_number)
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
