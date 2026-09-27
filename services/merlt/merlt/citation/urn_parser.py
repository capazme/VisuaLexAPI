"""
URN Parser for Italian Legal References
=======================================

Parses Italian legal URNs (Normattiva format) into structured components.

Supported URN patterns:
- urn:nir:stato:codice.civile:1942;art1453
- urn:nir:stato:legge:2020-12-30;178~art1
- urn:nir:stato:decreto.legislativo:2003-06-30;196~art1
- https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:...

Example:
    >>> parsed = parse_urn("urn:nir:stato:codice.civile:1942;art1453")
    >>> print(parsed.act_type)       # "codice.civile"
    >>> print(parsed.codice_abbrev)  # "c.c."
    >>> print(parsed.article)        # "1453"
    >>> print(parsed.is_codice)      # True
"""

import re
from dataclasses import dataclass, field
from typing import Optional, Dict
from urllib.parse import urlparse, parse_qs, unquote


# =============================================================================
# ABBREVIATION MAPPINGS
# =============================================================================

# URN act type -> Italian abbreviation
ACT_TYPE_ABBREVIATIONS: Dict[str, str] = {
    # Standard acts
    "legge": "L.",
    "decreto.legislativo": "D.lgs.",
    "decreto.legge": "D.L.",
    "decreto.del.presidente.della.repubblica": "D.P.R.",
    "regio.decreto": "R.D.",
    "decreto.ministeriale": "D.M.",
    "decreto.del.presidente.del.consiglio.dei.ministri": "D.P.C.M.",
    # Full forms (for reverse lookup)
    "decreto legislativo": "D.lgs.",
    "decreto legge": "D.L.",
    "decreto del presidente della repubblica": "D.P.R.",
    "regio decreto": "R.D.",
    "decreto ministeriale": "D.M.",
}

# Codice name -> standard abbreviation
CODICE_ABBREVIATIONS: Dict[str, str] = {
    "codice.civile": "c.c.",
    "codice.penale": "c.p.",
    "codice.di.procedura.civile": "c.p.c.",
    "codice.di.procedura.penale": "c.p.p.",
    "codice.della.strada": "C.d.S.",
    "codice.del.consumo": "Cod. cons.",
    "codice.dei.contratti.pubblici": "Cod. contr. pubbl.",
    "codice.dell.amministrazione.digitale": "C.A.D.",
    "codice.della.navigazione": "Cod. nav.",
    "codice.della.privacy": "Cod. privacy",
    "codice.in.materia.di.protezione.dei.dati.personali": "Cod. privacy",
    "codice.del.processo.amministrativo": "c.p.a.",
    "codice.del.processo.tributario": "c.p.t.",
    "codice.della.crisi.d.impresa.e.dell.insolvenza": "CCII",
    "codice.antimafia": "Cod. antimafia",
    "costituzione": "Cost.",
    "preleggi": "Prel.",
    # Normalized forms (spaces instead of dots)
    "codice civile": "c.c.",
    "codice penale": "c.p.",
    "codice di procedura civile": "c.p.c.",
    "codice di procedura penale": "c.p.p.",
    "codice della strada": "C.d.S.",
    "codice del consumo": "Cod. cons.",
    "codice dei contratti pubblici": "Cod. contr. pubbl.",
    "codice dell'amministrazione digitale": "C.A.D.",
    "codice della navigazione": "Cod. nav.",
    "codice della privacy": "Cod. privacy",
    "codice in materia di protezione dei dati personali": "Cod. privacy",
    "codice del processo amministrativo": "c.p.a.",
    "codice del processo tributario": "c.p.t.",
    "codice della crisi d'impresa e dell'insolvenza": "CCII",
    "codice antimafia": "Cod. antimafia",
}

# Codice URN type -> full Italian name
CODICE_FULL_NAMES: Dict[str, str] = {
    "codice.civile": "Codice Civile",
    "codice.penale": "Codice Penale",
    "codice.di.procedura.civile": "Codice di Procedura Civile",
    "codice.di.procedura.penale": "Codice di Procedura Penale",
    "codice.della.strada": "Codice della Strada",
    "codice.del.consumo": "Codice del Consumo",
    "codice.dei.contratti.pubblici": "Codice dei Contratti Pubblici",
    "codice.dell.amministrazione.digitale": "Codice dell'Amministrazione Digitale",
    "codice.della.navigazione": "Codice della Navigazione",
    "codice.della.privacy": "Codice della Privacy",
    "codice.in.materia.di.protezione.dei.dati.personali": "Codice della Privacy",
    "codice.del.processo.amministrativo": "Codice del Processo Amministrativo",
    "codice.del.processo.tributario": "Codice del Processo Tributario",
    "codice.della.crisi.d.impresa.e.dell.insolvenza": "Codice della Crisi d'Impresa",
    "codice.antimafia": "Codice Antimafia",
    "costituzione": "Costituzione della Repubblica Italiana",
    "preleggi": "Preleggi",
}

# Italian month names for date formatting
ITALIAN_MONTHS = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"
]


# =============================================================================
# DATA CLASSES
# =============================================================================


@dataclass
class ParsedURN:
    """
    Structured representation of a parsed Italian legal URN.

    Attributes:
        raw_urn: Original URN string
        authority: Issuing authority (e.g., "stato", "regione:lombardia")
        act_type: Type of legal act (e.g., "legge", "decreto.legislativo", "codice.civile")
        date: Date in YYYY-MM-DD format (if present)
        act_number: Act number (if present)
        article: Article number (e.g., "1453", "1453-bis")
        comma: Comma number (if specified)
        is_codice: True if this is a legal code (c.c., c.p., etc.)
        codice_abbrev: Standard abbreviation for codes (e.g., "c.c.")
        codice_full_name: Full name of the code in Italian

    Example:
        >>> parsed = parse_urn("urn:nir:stato:codice.civile:1942;art1453")
        >>> parsed.is_codice
        True
        >>> parsed.codice_abbrev
        "c.c."
        >>> parsed.article
        "1453"
    """
    raw_urn: str
    authority: str = ""
    act_type: str = ""
    date: Optional[str] = None
    act_number: Optional[str] = None
    article: Optional[str] = None
    comma: Optional[str] = None
    is_codice: bool = False
    codice_abbrev: Optional[str] = None
    codice_full_name: Optional[str] = None
    year: Optional[str] = None
    parsed_successfully: bool = False
    parse_errors: list = field(default_factory=list)


# =============================================================================
# PARSING FUNCTIONS
# =============================================================================


def _extract_urn_from_url(url: str) -> str:
    """
    Extract URN from Normattiva URL format.

    Handles:
    - https://www.normattiva.it/uri-res/N2Ls?urn:nir:...
    - https://www.normattiva.it/atto/...?urn=...

    Args:
        url: Normattiva URL

    Returns:
        Extracted URN string or original input if not a URL
    """
    if not url.startswith(("http://", "https://")):
        return url

    # Try query string format: ?urn:nir:...
    if "?" in url:
        query_part = url.split("?", 1)[1]
        if query_part.startswith("urn:"):
            return unquote(query_part)

        # Try urn= parameter
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        if "urn" in params:
            return unquote(params["urn"][0])

    return url


def _normalize_act_type(act_type: str) -> str:
    """
    Normalize act type string for consistent matching.

    Args:
        act_type: Raw act type from URN

    Returns:
        Normalized act type (lowercase, dots replaced with spaces for lookup)
    """
    return act_type.lower().replace(".", " ").strip()


def _extract_article_info(article_part: str) -> tuple[Optional[str], Optional[str]]:
    """
    Extract article and comma from URN article specification.

    Handles:
    - art1453
    - art1453-bis
    - art1453~com1
    - art1~com2

    Args:
        article_part: Article specification string

    Returns:
        Tuple of (article_number, comma_number)
    """
    article = None
    comma = None

    # Remove 'art' prefix
    if article_part.startswith("art"):
        article_part = article_part[3:]

    # Check for comma specification
    if "~com" in article_part:
        parts = article_part.split("~com")
        article = parts[0]
        comma = parts[1] if len(parts) > 1 else None
    elif "~" in article_part:
        # Other ~ separators
        article = article_part.split("~")[0]
    else:
        article = article_part

    return article, comma


def parse_urn(urn: str) -> ParsedURN:
    """
    Parse an Italian legal URN into structured components.

    Supported formats:
    - urn:nir:stato:codice.civile:1942;art1453
    - urn:nir:stato:legge:2020-12-30;178~art1
    - https://www.normattiva.it/uri-res/N2Ls?urn:nir:...

    Args:
        urn: URN string or Normattiva URL

    Returns:
        ParsedURN with extracted components

    Example:
        >>> result = parse_urn("urn:nir:stato:codice.civile:1942;art1453")
        >>> result.act_type
        "codice.civile"
        >>> result.article
        "1453"
        >>> result.is_codice
        True
    """
    result = ParsedURN(raw_urn=urn)

    try:
        # Extract URN from URL if needed
        clean_urn = _extract_urn_from_url(urn)

        # Remove urn:nir: prefix
        if clean_urn.startswith("urn:nir:"):
            clean_urn = clean_urn[8:]
        elif clean_urn.startswith("urn:"):
            clean_urn = clean_urn[4:]

        # Split into main components
        # Format: authority:act_type:date;number~article or authority:act_type:date;article
        parts = clean_urn.split(":")

        if len(parts) < 2:
            result.parse_errors.append("Invalid URN format: too few components")
            return result

        # First part is authority
        result.authority = parts[0]

        # Second part is act type — may contain ;article (e.g. "costituzione;art24")
        act_type_raw = parts[1]

        # If act_type contains a semicolon, split it off
        if ";" in act_type_raw:
            result.act_type, extra = act_type_raw.split(";", 1)
            # Treat the extra part as article info
            if extra.startswith("art"):
                result.article, result.comma = _extract_article_info(extra)
        else:
            result.act_type = act_type_raw

        # Check if it's a codice
        act_type_lower = result.act_type.lower()
        if any(codice_key.replace(".", " ") in act_type_lower.replace(".", " ")
               for codice_key in CODICE_ABBREVIATIONS.keys() if "codice" in codice_key or codice_key in ["costituzione", "preleggi"]):
            result.is_codice = True
            result.codice_abbrev = get_codice_abbreviation(result.act_type)
            result.codice_full_name = CODICE_FULL_NAMES.get(
                result.act_type,
                result.act_type.replace(".", " ").title()
            )

        # Third part contains date/number and article info
        if len(parts) >= 3:
            date_article_part = parts[2]

            # Handle different separators
            # Format variations:
            # - 1942;art1453 (codice with year and article)
            # - 2020-12-30;178~art1 (law with date, number, and article)
            # - 2020-12-30;178 (law with date and number, no article)

            if ";" in date_article_part:
                date_part, remainder = date_article_part.split(";", 1)

                # Extract date/year
                if "-" in date_part and len(date_part) == 10:
                    # Full date: YYYY-MM-DD
                    result.date = date_part
                    result.year = date_part[:4]
                elif date_part.isdigit() and len(date_part) == 4:
                    # Just year
                    result.year = date_part

                # Parse remainder (number and/or article)
                if remainder.startswith("art"):
                    # Direct article reference (may include ~com)
                    result.article, result.comma = _extract_article_info(remainder)
                elif "~" in remainder:
                    # Has number~article separator (e.g. "178~art1")
                    num_art_parts = remainder.split("~", 1)
                    if num_art_parts[0] and num_art_parts[0][0].isdigit():
                        result.act_number = num_art_parts[0]
                    if len(num_art_parts) > 1:
                        result.article, result.comma = _extract_article_info(num_art_parts[1])
                elif remainder.isdigit() or (remainder and remainder[0].isdigit()):
                    # Just number
                    result.act_number = remainder

            elif "~" in date_article_part:
                # No semicolon but has tilde
                parts_tilde = date_article_part.split("~", 1)
                if "-" in parts_tilde[0] and len(parts_tilde[0]) == 10:
                    result.date = parts_tilde[0]
                    result.year = parts_tilde[0][:4]
                if len(parts_tilde) > 1:
                    result.article, result.comma = _extract_article_info(parts_tilde[1])

        # Handle additional components (some URNs have more parts)
        if len(parts) > 3:
            for extra_part in parts[3:]:
                if extra_part.startswith("art"):
                    result.article, result.comma = _extract_article_info(extra_part)

        result.parsed_successfully = True

    except Exception as e:
        result.parse_errors.append(f"Parse error: {str(e)}")

    return result


def get_codice_abbreviation(act_type: str) -> Optional[str]:
    """
    Get the standard Italian abbreviation for a legal code.

    Args:
        act_type: Code type from URN (e.g., "codice.civile")

    Returns:
        Standard abbreviation (e.g., "c.c.") or None if not a recognized code

    Example:
        >>> get_codice_abbreviation("codice.civile")
        "c.c."
        >>> get_codice_abbreviation("codice.penale")
        "c.p."
    """
    # Try exact match first
    if act_type in CODICE_ABBREVIATIONS:
        return CODICE_ABBREVIATIONS[act_type]

    # Try normalized form (replace dots with spaces)
    normalized = act_type.replace(".", " ").lower()
    if normalized in CODICE_ABBREVIATIONS:
        return CODICE_ABBREVIATIONS[normalized]

    # Try partial match for compound names
    for key, abbrev in CODICE_ABBREVIATIONS.items():
        if key.replace(".", " ") == normalized:
            return abbrev

    return None


def get_act_type_abbreviation(act_type: str) -> Optional[str]:
    """
    Get the standard Italian abbreviation for a legal act type.

    Args:
        act_type: Act type from URN (e.g., "decreto.legislativo")

    Returns:
        Standard abbreviation (e.g., "D.lgs.") or None if not recognized

    Example:
        >>> get_act_type_abbreviation("decreto.legislativo")
        "D.lgs."
        >>> get_act_type_abbreviation("legge")
        "L."
    """
    # Try exact match first
    if act_type in ACT_TYPE_ABBREVIATIONS:
        return ACT_TYPE_ABBREVIATIONS[act_type]

    # Try normalized form
    normalized = act_type.replace(".", " ").lower()
    if normalized in ACT_TYPE_ABBREVIATIONS:
        return ACT_TYPE_ABBREVIATIONS[normalized]

    return None


def format_italian_date(date_str: str) -> str:
    """
    Format a date string in Italian legal style.

    Args:
        date_str: Date in YYYY-MM-DD format

    Returns:
        Date in Italian format: "7 agosto 1990"

    Example:
        >>> format_italian_date("1990-08-07")
        "7 agosto 1990"
    """
    try:
        parts = date_str.split("-")
        if len(parts) != 3:
            return date_str

        year = parts[0]
        month = int(parts[1])
        day = int(parts[2])

        if not (1 <= month <= 12):
            return date_str

        month_name = ITALIAN_MONTHS[month - 1]
        return f"{day} {month_name} {year}"
    except (ValueError, IndexError):
        return date_str


# =============================================================================
# EXPORTS
# =============================================================================


__all__ = [
    "ParsedURN",
    "parse_urn",
    "get_codice_abbreviation",
    "get_act_type_abbreviation",
    "format_italian_date",
    "ACT_TYPE_ABBREVIATIONS",
    "CODICE_ABBREVIATIONS",
    "CODICE_FULL_NAMES",
    "ITALIAN_MONTHS",
]
