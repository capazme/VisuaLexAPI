import os
import re
import logging
from urllib.parse import urlparse
from .logging_config import log_handlers
from .text_op import normalize_act_type, parse_date
from .map import EURLEX, codice_urn
from .exceptions import ValidationError
from ..services.eurlex_scraper import EurlexScraper
from ..services.act_dates import complete_year

# Configure logging
logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s %(levelname)s %(message)s',
                    handlers=log_handlers("norma.log"))

# The types whose request may spell its full date in words ("7 agosto 1990"): read
# into ISO before the Norma is built, as the date lookup they once shared did.
_SPELLED_DATE_TYPES = ('legge', 'decreto legge', 'decreto legislativo', 'd.p.r.', 'regio decreto')


async def complete_request_date(act_type, date, act_number):
    """The date a request names, as the Norma takes it.

    A year with a number is completed through Normattiva's resolver and the act's own
    title (`act_dates.complete_year`); when that cannot tell the act for certain, the
    year stands, never another act's date. A full date is read into ISO for the types
    above and passed on unchanged for the others; no date stays no date.
    """
    if date is None or str(date).strip() == '':
        return None
    date = str(date).strip()
    if re.fullmatch(r"\d{4}", date):
        if not act_number:
            return date
        return await complete_year(act_type, date, act_number)
    if act_type in _SPELLED_DATE_TYPES:
        try:
            return parse_date(date)
        except ValueError:
            raise ValidationError(f"Data non valida: {date}")
    return date


def generate_urn(act_type, date=None, act_number=None, article=None, annex=None, version=None,
                 version_date=None, urn_flag=True, celex_consolidated=None):
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
    celex_consolidated -- Sector-0 CELEX of a consolidated EU version (optional, EU acts only)

    Returns:
    str -- The generated URN
    """
    logging.info(f"Generating URN for act_type: {act_type}, date: {date}, act_number: {act_number}, article: {article}, annex: {annex}, version: {version}, version_date: {version_date}, urn_flag: {urn_flag}")
    base_url = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
    normalized_act_type = normalize_act_type(act_type)
    
    # Check if 'article' is a valid string before attempting to split it.
    # Every token after the number is the extension, joined: "270-bis.1" ->
    # "270" + "bis.1" (~art270bis.1) and "135-sex-decies" -> "135" +
    # "sexdecies" (~art135sexdecies). Unpacking parts[1] alone broke on the
    # compound ordinals. "314/2" has no dash and stays whole (~art314/2).
    extension = None
    if article and '-' in article:
        parts = article.split('-')
        article = parts[0]
        extension = ''.join(parts[1:]) or None
    
    # Handle EURLEX cases (check before replacing spaces with dots)
    if normalized_act_type.lower() in EURLEX:
        eurlex_scraper = EurlexScraper()
        return eurlex_scraper.get_uri(act_type=normalized_act_type.lower(), year=date, num=act_number,
                                      celex_consolidated=celex_consolidated)

    # Handle special codes (codice civile, codice penale, etc.)
    # IMPORTANT: Check BEFORE replacing spaces with dots, as the codici table uses spaces
    codice_fragment = codice_urn(normalized_act_type)
    if codice_fragment:
        urn = codice_fragment
        logging.info(f"URN found in the codici table: {urn}")

        # IMPORTANT: The URN from the codici table may already contain an allegato suffix (e.g., ":1")
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
            # An act with no number (a d.p.c.m.) has no ";": never ";None".
            urn = f"{normalized_act_type_urn}:{formatted_date}" + (f";{act_number}" if act_number else "")
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
    complete_request_date is where a request's year is completed from Normattiva.

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
            parts = article.split("-")
            article, extension = parts[0], ''.join(parts[1:]) or extension
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
    if isinstance(version, str):
        # Read the word the way is_historical_request does: stripped, lower-cased.
        version = version.strip().lower()
    if isinstance(version_date, str) and version_date.strip():
        # A date always asks for the text in force on that day (owner, G-353), with
        # or without «vigente», and over «originale», as the web reads a request
        # (`requestedVersion`). Only «vigente» used to carry it: a date with no
        # version reached Normattiva without it and came back as today's text,
        # shown as the past one.
        urn += "!vig=" + parse_date(version_date)
    elif version == "originale":
        urn += "@originale"
    elif version == "vigente":
        urn += "!vig="
    logging.info(f"Appended version info to URN: {urn}")
    return urn

_UNSAFE_IN_FILENAME = re.compile(r"[^A-Za-z0-9._-]")
_MAX_FILENAME = 150


def _safe_filename(name):
    """
    Makes `name` a file name and nothing else: no directory part, no separator, not hidden.

    The URN a name is built from is written by the caller. The guard on /export_pdf
    only checks the host, so `;../../x` used to become a directory part of the path the
    PDF is read from and copied to.
    """
    safe = _UNSAFE_IN_FILENAME.sub("_", name).lstrip(".")
    if len(safe) > _MAX_FILENAME:
        safe = safe[:_MAX_FILENAME - len(".pdf")] + ".pdf"
    return safe or "document.pdf"


_VERSION_IN_URN = re.compile(r"!vig=\d{4}-\d{2}-\d{2}|@originale")


def pdf_urn_in_force(urn, today):
    """
    The URN an export reads: an undated one at `today` (ISO, Europe/Rome).

    Normattiva answers an undated URN with its latest version, also one not in force
    yet, as it does for an article's text (owner, G-355): the export asks for the
    text in force today instead. A dated URN, or one for the original, is read as asked.
    """
    if _VERSION_IN_URN.search(urn):
        return urn
    if "!vig=" in urn:
        return urn.replace("!vig=", f"!vig={today}", 1)
    return f"{urn}!vig={today}"


# A Normattiva URN as generate_urn writes it, and nothing more: authority, type, date,
# number, annex, article, one version marker. Read whole (fullmatch), ASCII only.
_EXPORTABLE_URN = re.compile(
    r"urn:nir:[a-z]+(?:\.[a-z]+)*:[a-z]+(?:\.[a-z]+)*(?::\d{4}(?:-\d{2}-\d{2})?)?"
    r"(?:;[0-9A-Za-z.-]+)?(?::[0-9A-Za-z]+)?(?:~art[0-9A-Za-z.-]+)?"
    r"(?:!vig=(?:\d{4}-\d{2}-\d{2})?|@originale)?",
    re.ASCII,
)
_N2LS = "https://www.normattiva.it/uri-res/N2Ls?"


def _exported_urn(urn):
    """
    The URN a Normattiva address names, from its query alone: `https://www.normattiva.it/
    uri-res/N2Ls?urn:nir:…`, or a bare `urn:nir:…`, read whole against `_EXPORTABLE_URN`.

    The browser reads the path too, and resolves its `..`: a name read from anywhere in
    the address let `…/x/stato:legge:1990-08-07;241~/../../uri-res/N2Ls?urn:nir:stato:
    decreto.legislativo:2001-06-08;231` cache the d.lgs. 231/2001 as the l. 241/1990, for
    everyone. Any other path, a path parameter, a fragment, or a query with anything more
    (a second version marker, another parameter) is refused (ValueError).
    """
    if not urn.startswith("urn:nir:"):
        parsed = urlparse(urn)
        if parsed.path != "/uri-res/N2Ls" or parsed.params or parsed.fragment:
            raise ValueError("Invalid URN format")
        urn = parsed.query
    if not _EXPORTABLE_URN.fullmatch(urn):
        raise ValueError("Invalid URN format")
    return urn


def export_url(urn, today):
    """
    The address an export opens and caches under: Normattiva's, rebuilt from the URN the
    caller's address names (`_exported_urn`, ValueError otherwise), at `today` when it is
    undated (`pdf_urn_in_force`). The browser never opens what the caller wrote, so the
    page it loads and the cache name it is stored under are read from the same URN.
    """
    return _N2LS + pdf_urn_in_force(_exported_urn(urn), today)


# The parts of an exportable URN, in their places (the grammar of `_EXPORTABLE_URN`).
_URN_PARTS = re.compile(
    r"urn:nir:(?P<authority>[a-z]+(?:\.[a-z]+)*):(?P<kind>[a-z]+(?:\.[a-z]+)*)(?::(?P<date>\d{4}(?:-\d{2}-\d{2})?))?"
    r"(?:;(?P<number>[0-9A-Za-z.-]+))?(?::(?P<annex>[0-9A-Za-z]+))?(?:~art[0-9A-Za-z.-]+)?"
    r"(?P<version>!vig=(?:\d{4}-\d{2}-\d{2})?|@originale)?",
    re.ASCII,
)


def export_version_date(url):
    """The day an export's address asks for (`!vig=<day>`), or None: the original, or no day."""
    match = re.search(r"!vig=(\d{4}-\d{2}-\d{2})", url or "")
    return match.group(1) if match else None


def urn_to_filename(urn):
    """
    Converts a URN to a filename: the act (authority, type, date, number, annex) and its version.

    The article is left out: the export is the act's. Each part has its place, joined by «_»,
    which no part of the grammar holds, so two URNs never share a name: until 21 October 2026
    the name was the number and the year alone, and until 25 October it dropped the authority
    and read «:» and «;» alike. A name over the limit is refused (ValueError), never cut: a
    cut would drop the version.

    Arguments:
    urn -- The URN string

    Returns:
    str -- The generated filename: always a bare file name, safe to join to a directory
    """
    logging.info(f"Converting URN to filename: {urn}")
    parts = _URN_PARTS.fullmatch(_exported_urn(urn))
    if not parts:
        raise ValueError("Invalid URN format")
    version = parts["version"] or ""
    version = "originale" if version == "@originale" else version.replace("!vig=", "vig") if version else ""
    name = "_".join(parts[key] or "" for key in ("authority", "kind", "date", "number", "annex")) + f"_{version}.pdf"
    if len(name) > _MAX_FILENAME:
        raise ValueError("URN too long for a file name")
    filename = _safe_filename(name)
    logging.info(f"Generated filename: {filename}")
    return filename


def pdf_cache_path(urn, directory):
    """
    Where the exported PDF of `urn` is cached: a file directly inside `directory`.
    """
    return os.path.join(directory, urn_to_filename(urn))
