"""
URN Generator for Italian Legal Norms
=====================================

Generates URNs (Uniform Resource Names) for Italian legal acts.

This is a simplified version that works locally without Playwright.
For full date completion (year-only to YYYY-MM-DD), use visualex-api.

Examples:
    - generate_urn("codice civile", article="1453")
      -> "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"

    - generate_urn("legge", date="1990-08-07", act_number="241", article="1")
      -> "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241~art1"
"""

import re
import logging
from typing import Optional

from .map import NORMATTIVA_URN_CODICI, EURLEX
from .text_op import normalize_act_type, parse_date

log = logging.getLogger(__name__)


def generate_urn(
    act_type: str,
    date: Optional[str] = None,
    act_number: Optional[str] = None,
    article: Optional[str] = None,
    annex: Optional[str] = None,
    version: Optional[str] = None,
    version_date: Optional[str] = None,
    urn_flag: bool = True,
) -> Optional[str]:
    """
    Generates the URN for a legal norm.

    Args:
        act_type: Type of the legal act (e.g., "codice civile", "legge")
        date: Date of the act (YYYY-MM-DD or YYYY)
        act_number: Number of the act (e.g., "241")
        article: Article number (e.g., "1453", "2-bis")
        annex: Annex to the law (optional)
        version: Version of the act ("vigente", "originale")
        version_date: Date of the version (for "vigente")
        urn_flag: If True, include full URN; if False, exclude article part

    Returns:
        The generated URN string, or None if generation fails

    Examples:
        >>> generate_urn("codice civile", article="1453")
        'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453'

        >>> generate_urn("legge", date="1990-08-07", act_number="241")
        'https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:legge:1990-08-07;241'
    """
    log.info(f"Generating URN for act_type={act_type}, date={date}, act_number={act_number}, article={article}")

    base_url = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
    normalized_act_type = normalize_act_type(act_type)

    # Handle article extension (e.g., "1453-bis" -> article="1453", extension="bis")
    extension = None
    if article and '-' in article:
        parts = article.split('-')
        article = parts[0]
        extension = parts[1]

    # Handle EURLEX cases - not supported locally, return None
    if normalized_act_type.lower() in EURLEX:
        log.warning(f"EURLEX URN generation not supported locally for {act_type}")
        return None

    # Check if it's a known codice (codice civile, codice penale, etc.)
    if normalized_act_type in NORMATTIVA_URN_CODICI:
        urn = NORMATTIVA_URN_CODICI[normalized_act_type]
        log.info(f"URN found in codici_urn: {urn}")

        # Strip default allegato suffix if present (e.g., ":2" from codice civile)
        # This allows explicit control via the `annex` parameter
        allegato_match = re.match(r'^(.+;\d+):(\d+)$', urn)
        if allegato_match:
            base_urn = allegato_match.group(1)
            default_allegato = allegato_match.group(2)
            log.info(f"Stripped default allegato {default_allegato}, base: {base_urn}")
            urn = base_urn
    else:
        # For regular act types, generate URN from components
        if not date or not act_number:
            log.error(f"Date and act_number required for non-codice acts: {act_type}")
            return None

        normalized_act_type_urn = normalized_act_type.replace(' ', '.')
        formatted_date = _complete_date_or_parse(date, act_type, act_number)

        if formatted_date is None:
            log.error(f"Could not parse date: {date}")
            return None

        urn = f"{normalized_act_type_urn}:{formatted_date};{act_number}"
        log.info(f"Generated base URN: {urn}")

    # Add annex if specified
    if annex:
        urn = urn + f':{annex.strip()}'

    # Add article info
    urn = _append_article_info(urn, article, extension)

    # Add version info
    urn = _append_version_info(urn, version, version_date)

    final_urn = base_url + urn
    result = final_urn if urn_flag else final_urn.split("~")[0]
    log.info(f"Final URN: {result}")

    return result


def _complete_date_or_parse(
    date: Optional[str],
    act_type: str,
    act_number: Optional[str]
) -> Optional[str]:
    """
    Parse date, using fallback for year-only dates.

    For year-only dates (YYYY), defaults to January 1st.
    Full date lookup from Normattiva requires visualex-api.

    Args:
        date: Date string (YYYY-MM-DD or YYYY)
        act_type: Type of act
        act_number: Act number

    Returns:
        Formatted date (YYYY-MM-DD) or None
    """
    if date is None or date == '':
        return None

    # For year-only, default to January 1st
    # (Full lookup requires Playwright/visualex-api)
    if re.match(r"^\d{4}$", date):
        log.warning(f"Year-only date {date}, defaulting to {date}-01-01")
        return f"{date}-01-01"

    return parse_date(date)


def _append_article_info(
    urn: str,
    article: Optional[str],
    extension: Optional[str]
) -> str:
    """
    Appends article information to the URN.

    Args:
        urn: The base URN
        article: Article number
        extension: Article extension (e.g., "bis", "ter")

    Returns:
        URN with article info appended
    """
    if article:
        # Handle case where article still contains "art." prefix
        article = re.sub(r'\b[Aa]rticoli?\b|\b[Aa]rt\.?\b', "", article).strip()

        # Handle inline extension (e.g., "1-bis")
        if "-" in article:
            article, extension = article.split("-", 1)

        urn += f"~art{article}"
        if extension:
            urn += extension

        log.debug(f"Appended article info: {urn}")

    return urn


def _append_version_info(
    urn: str,
    version: Optional[str],
    version_date: Optional[str]
) -> str:
    """
    Appends version information to the URN.

    Args:
        urn: The URN with article info
        version: Version type ("originale" or "vigente")
        version_date: Date for vigente version

    Returns:
        URN with version info appended
    """
    if version == "originale":
        urn += "@originale"
    elif version == "vigente":
        urn += "!vig="
        if version_date:
            try:
                formatted_version_date = parse_date(version_date)
                urn += formatted_version_date
            except ValueError:
                log.warning(f"Could not parse version_date: {version_date}")

        log.debug(f"Appended version info: {urn}")

    return urn


def urn_to_filename(urn: str) -> str:
    """
    Converts a URN to a filename.

    Args:
        urn: The URN string

    Returns:
        Generated filename

    Raises:
        ValueError: If URN format is invalid
    """
    log.debug(f"Converting URN to filename: {urn}")

    try:
        act_type_section = urn.split('stato:')[1].split('~')[0]
    except IndexError:
        raise ValueError("Invalid URN format")

    if ':' in act_type_section and ';' in act_type_section:
        type_and_date, number = act_type_section.split(';')
        year = type_and_date.split(':')[1].split('-')[0]
        filename = f"{number}_{year}.pdf"
        return filename

    act_type = act_type_section.split('/')[-1]
    return f"{act_type.capitalize()}.pdf"


# ============================================================================
# EXPORTS
# ============================================================================

__all__ = [
    "generate_urn",
    "urn_to_filename",
]
