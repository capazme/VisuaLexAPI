import re
import datetime
from functools import lru_cache
from .config import MAX_CACHE_SIZE
from .map import NORMATTIVA, NORMATTIVA_SEARCH, BROCARDI_SEARCH
import logging

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=[logging.FileHandler("norma.log"),
                              logging.StreamHandler()])

def nospazi(text):
    """
    Removes multiple spaces from a string.
    
    Arguments:
    text -- The input text string
    
    Returns:
    str -- The text with single spaces between words
    """
    logging.debug("Removing extra spaces from text")
    textout = ' '.join(text.split())
    logging.debug(f"Text after removing spaces: {textout}")
    return textout

@lru_cache(maxsize=MAX_CACHE_SIZE)
def parse_date(input_date):
    """
    Converts a date string in extended format or YYYY-MM-DD to the format YYYY-MM-DD.
    Supports month names in Italian.
    
    Arguments:
    input_date -- The input date string
    
    Returns:
    str -- The formatted date string in YYYY-MM-DD or raises ValueError if invalid
    """
    logging.debug(f"Parsing date: {input_date}")
    
    month_map = {
        "gennaio": "01", "febbraio": "02", "marzo": "03", "aprile": "04",
        "maggio": "05", "giugno": "06", "luglio": "07", "agosto": "08",
        "settembre": "09", "ottobre": "10", "novembre": "11", "dicembre": "12"
    }

    pattern = r"(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})"
    match = re.search(pattern, input_date)
    if match:
        day, month, year = match.groups()
        month = month_map.get(month.lower())
        if not month:
            logging.error("Invalid month found in date string")
            raise ValueError("Mese non valido")
        formatted_date = f"{year}-{month}-{day.zfill(2)}"
        logging.debug(f"Formatted date: {formatted_date}")
        return formatted_date
    
    try:
        datetime.datetime.strptime(input_date, "%Y-%m-%d")
        return input_date
    except ValueError:
        logging.error("Invalid date format")
        raise ValueError("Formato data non valido")

@lru_cache(maxsize=MAX_CACHE_SIZE)
def format_date_to_extended(input_date):
    """
    Converts a date string in the format YYYY-MM-DD to its extended format in Italian.
    
    Arguments:
    input_date -- The input date string in the format YYYY-MM-DD
    
    Returns:
    str -- The date in extended format (e.g., "12 settembre 2024") or raises ValueError if invalid
    """
    logging.debug(f"Formatting date: {input_date}")

    month_map = {
        "01": "gennaio", "02": "febbraio", "03": "marzo", "04": "aprile",
        "05": "maggio", "06": "giugno", "07": "luglio", "08": "agosto",
        "09": "settembre", "10": "ottobre", "11": "novembre", "12": "dicembre"
    }

    try:
        # Controlla il formato della data e prova a fare il parsing
        date_obj = datetime.datetime.strptime(input_date, "%Y-%m-%d")
        day = date_obj.day
        month = month_map[date_obj.strftime("%m")]
        year = date_obj.year
        extended_date = f"{day} {month} {year}"
        logging.debug(f"Extended format date: {extended_date}")
        return extended_date
    except ValueError:
        logging.error("Invalid date format")
        raise ValueError("Formato data non valido")

@lru_cache(maxsize=MAX_CACHE_SIZE)
def normalize_act_type(input_type, search=False, source='normattiva'):
    """
    Normalizes the type of legislative act based on the input.
    
    Arguments:
    input_type -- The input act type string
    search -- Boolean flag to indicate if the input is for search purposes
    source -- Source dictionary to use for normalization (default: 'normattiva')
    
    Returns:
    str -- The normalized act type or the original input if not found
    """
    logging.debug(f"Normalizing act type: {input_type}, search: {search}, source: {source}")
    
    act_types = NORMATTIVA_SEARCH if source == 'normattiva' and search else NORMATTIVA
    if source == 'brocardi':
        act_types = BROCARDI_SEARCH if search else {}

    if input_type in {"TUE", "TFUE", "CDFUE"}:
        return input_type

    normalized_type = act_types.get(input_type.lower().strip().replace(" ", ""), input_type.lower().strip())
    
    logging.debug(f"Normalized act type: {normalized_type}")
    return normalized_type

@lru_cache(maxsize=MAX_CACHE_SIZE)
def estrai_data_da_denominazione(denominazione):
    """
    Extracts a date from a denomination string.
    
    Arguments:
    denominazione -- The input string containing a date
    
    Returns:
    str -- The extracted date or the original denomination if no date is found
    """
    logging.debug(f"Extracting date from denomination")
    
    pattern = r"\b(\d{1,2})\s([Gg]ennaio|[Ff]ebbraio|[Mm]arzo|[Aa]prile|[Mm]aggio|[Gg]iugno|[Ll]uglio|[Aa]gosto|[Ss]ettembre|[Oo]ttobre|[Nn]ovembre|[Dd]icembre)\s(\d{4})\b"
    match = re.search(pattern, denominazione)
    
    if match:
        extracted_date = match.group(0)
        logging.debug(f"Extracted date: {extracted_date}")
        return extracted_date
    
    logging.debug("No date found in denomination")
    return denominazione

@lru_cache(maxsize=MAX_CACHE_SIZE)
def estrai_numero_da_estensione(estensione):
    """
    Extracts the corresponding number from an extension (e.g., 'bis', 'tris').
    
    Arguments:
    estensione -- The input extension string
    
    Returns:
    int -- The extracted number or 0 if the extension is not found
    """
    logging.debug(f"Extracting number from extension: {estensione}")
    
    estensioni_numeriche = {
        None: 0, 'bis': 2, 'tris': 3, 'ter': 3, 'quater': 4, 'quinquies': 5,
        'quinques': 5, 'sexies': 6, 'septies': 7, 'octies': 8, 'novies': 9, 'decies': 10, 'undecies': 11, 'duodecies': 12, 'terdecies': 13, 'quaterdecies': 14,
        'quindecies': 15, 'sexdecies': 16, 'septiesdecies': 17, 'duodevicies': 18, 'undevicies': 19,
        'vices': 20, 'vicessemel': 21, 'vicesbis': 22, 'vicester': 23, 'vicesquater': 24,
        'vicesquinquies': 25, 'vicessexies': 26, 'vicessepties': 27, 'duodetricies': 28, 'undetricies': 29,
        'tricies': 30, 'triciessemel': 31, 'triciesbis': 32, 'triciester': 33, 'triciesquater': 34,
        'triciesquinquies': 35, 'triciessexies': 36, 'triciessepties': 37, 'duodequadragies': 38, 'undequadragies': 39,
        'quadragies': 40, 'quadragiessemel': 41, 'quadragiesbis': 42, 'quadragiester': 43, 'quadragiesquater': 44,
        'quadragiesquinquies': 45, 'quadragiessexies': 46, 'quadragiessepties': 47, 'duodequinquagies': 48, 'undequinquagies': 49,
    }
    
    number = estensioni_numeriche.get(estensione, 0)
    logging.debug(f"Extracted number: {number}")
    return number

def get_annex_from_urn(urn):
    """
    Extracts the annex from a URN.
    
    Arguments:
    urn -- The input URN string
    
    Returns:
    str -- The annex number if found, otherwise None
    """
    logging.debug(f"Extracting annex from URN")
    
    ann_num = re.search(r":(\d+)(!vig=|@originale)$", urn)
    if ann_num:
        annex = ann_num.group(1)
        logging.debug(f"Extracted annex: {annex}")
        return annex
    
    logging.debug("No annex found in URN")
    return None
