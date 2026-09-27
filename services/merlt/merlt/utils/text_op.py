"""
Text Operations for Legal Text Processing
==========================================

Pure utility functions for text processing without external dependencies.
These don't require HTTP calls or Playwright - just text manipulation.

Copied from visualex-api, stripped of treextractor dependency.
"""

import re
import datetime
from typing import Optional

from .map import NORMATTIVA, NORMATTIVA_SEARCH, BROCARDI_SEARCH


def nospazi(text: str) -> str:
    """
    Removes multiple spaces from a string.

    Arguments:
        text: The input text string

    Returns:
        The text with single spaces between words
    """
    return ' '.join(text.split())


def parse_date(input_date: str) -> str:
    """
    Converts a date string in extended format or YYYY-MM-DD to the format YYYY-MM-DD.
    Supports month names in Italian.

    Arguments:
        input_date: The input date string

    Returns:
        The formatted date string in YYYY-MM-DD

    Raises:
        ValueError: If the date format is invalid
    """
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
            raise ValueError("Mese non valido")
        return f"{year}-{month}-{day.zfill(2)}"

    try:
        datetime.datetime.strptime(input_date, "%Y-%m-%d")
        return input_date
    except ValueError:
        raise ValueError("Formato data non valido")


def format_date_to_extended(input_date: str) -> str:
    """
    Converts a date string in the format YYYY-MM-DD to its extended format in Italian.

    Arguments:
        input_date: The input date string in the format YYYY-MM-DD

    Returns:
        The date in extended format (e.g., "12 settembre 2024")

    Raises:
        ValueError: If the date format is invalid
    """
    month_map = {
        "01": "gennaio", "02": "febbraio", "03": "marzo", "04": "aprile",
        "05": "maggio", "06": "giugno", "07": "luglio", "08": "agosto",
        "09": "settembre", "10": "ottobre", "11": "novembre", "12": "dicembre"
    }

    try:
        date_obj = datetime.datetime.strptime(input_date, "%Y-%m-%d")
        day = date_obj.day
        month = month_map[date_obj.strftime("%m")]
        year = date_obj.year
        return f"{day} {month} {year}"
    except ValueError:
        raise ValueError("Formato data non valido")


def normalize_act_type(input_type: str, search: bool = False, source: str = 'normattiva') -> str:
    """
    Normalizes the type of legislative act based on the input.

    Arguments:
        input_type: The input act type string
        search: Boolean flag to indicate if the input is for search purposes
        source: Source dictionary to use for normalization (default: 'normattiva')

    Returns:
        The normalized act type or the original input if not found
    """
    act_types = NORMATTIVA_SEARCH if source == 'normattiva' and search else NORMATTIVA
    if source == 'brocardi':
        act_types = BROCARDI_SEARCH if search else {}

    if input_type in {"TUE", "TFUE", "CDFUE"}:
        return input_type

    return act_types.get(input_type.lower().strip().replace(" ", ""), input_type.lower().strip())


def estrai_data_da_denominazione(denominazione: str) -> str:
    """
    Extracts a date from a denomination string.

    Arguments:
        denominazione: The input string containing a date

    Returns:
        The extracted date or the original denomination if no date is found
    """
    pattern = r"\b(\d{1,2})\s([Gg]ennaio|[Ff]ebbraio|[Mm]arzo|[Aa]prile|[Mm]aggio|[Gg]iugno|[Ll]uglio|[Aa]gosto|[Ss]ettembre|[Oo]ttobre|[Nn]ovembre|[Dd]icembre)\s(\d{4})\b"
    match = re.search(pattern, denominazione)

    if match:
        return match.group(0)

    return denominazione


def estrai_numero_da_estensione(estensione: Optional[str]) -> int:
    """
    Extracts the corresponding number from an extension (e.g., 'bis', 'tris').

    Arguments:
        estensione: The input extension string

    Returns:
        The extracted number or 0 if the extension is not found
    """
    estensioni_numeriche = {
        None: 0, 'bis': 2, 'tris': 3, 'ter': 3, 'quater': 4, 'quinquies': 5,
        'quinques': 5, 'sexies': 6, 'septies': 7, 'octies': 8, 'novies': 9,
        'decies': 10, 'undecies': 11, 'duodecies': 12, 'terdecies': 13,
        'quaterdecies': 14, 'quindecies': 15, 'sexdecies': 16,
        'septiesdecies': 17, 'duodevicies': 18, 'undevicies': 19,
        'vices': 20, 'vicessemel': 21, 'vicesbis': 22, 'vicester': 23,
        'vicesquater': 24, 'vicesquinquies': 25, 'vicessexies': 26,
        'vicessepties': 27, 'duodetricies': 28, 'undetricies': 29,
        'tricies': 30, 'triciessemel': 31, 'triciesbis': 32, 'triciester': 33,
        'triciesquater': 34, 'triciesquinquies': 35, 'triciessexies': 36,
        'triciessepties': 37, 'duodequadragies': 38, 'undequadragies': 39,
        'quadragies': 40, 'quadragiessemel': 41, 'quadragiesbis': 42,
        'quadragiester': 43, 'quadragiesquater': 44, 'quadragiesquinquies': 45,
        'quadragiessexies': 46, 'quadragiessepties': 47, 'duodequinquagies': 48,
        'undequinquagies': 49,
    }

    return estensioni_numeriche.get(estensione, 0)


def get_annex_from_urn(urn: str) -> Optional[str]:
    """
    Extracts the annex from a URN.

    Arguments:
        urn: The input URN string

    Returns:
        The annex number if found, otherwise None
    """
    ann_num = re.search(r":(\d+)(!vig=|@originale)$", urn)
    if ann_num:
        return ann_num.group(1)
    return None


def parse_article_number(article: str) -> tuple[int, Optional[str]]:
    """
    Parse an article number into base number and extension.

    Arguments:
        article: Article string like "1453", "2-bis", "168bis"

    Returns:
        Tuple of (base_number, extension) e.g. (1453, None), (2, "bis"), (168, "bis")
    """
    # Normalize: "168bis" -> "168-bis"
    normalized = re.sub(r'^(\d+)([a-z]+)$', r'\1-\2', article, flags=re.IGNORECASE)

    match = re.match(r'^(\d+)(?:-([a-z]+))?$', normalized, re.IGNORECASE)
    if match:
        base = int(match.group(1))
        ext = match.group(2).lower() if match.group(2) else None
        return base, ext

    return 0, None


def normalize_article_format(article: str) -> str:
    """
    Normalize article format to standard form with hyphen.

    Arguments:
        article: Article string like "168bis", "2 bis", "2-bis"

    Returns:
        Normalized form like "168-bis", "2-bis", "2-bis"
    """
    # "2 bis" -> "2-bis"
    article = re.sub(r'(\d+)\s+([a-z]+)', r'\1-\2', article, flags=re.IGNORECASE)
    # "168bis" -> "168-bis"
    article = re.sub(r'^(\d+)([a-z]+)$', r'\1-\2', article, flags=re.IGNORECASE)
    return article


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "nospazi",
    "parse_date",
    "format_date_to_extended",
    "normalize_act_type",
    "estrai_data_da_denominazione",
    "estrai_numero_da_estensione",
    "get_annex_from_urn",
    "parse_article_number",
    "normalize_article_format",
]
