"""
Natural language input parser for Italian legal norm queries.

Converts free-form strings like "art. 2043 cc" or "d.lgs. 196/2003, art. 7"
into structured data for the VisuaLex API.
"""

import re
from dataclasses import dataclass
from typing import Optional

from .map import NORMATTIVA_SEARCH

# Italian month names → month number
_MESI = {
    "gennaio": "01", "febbraio": "02", "marzo": "03", "aprile": "04",
    "maggio": "05", "giugno": "06", "luglio": "07", "agosto": "08",
    "settembre": "09", "ottobre": "10", "novembre": "11", "dicembre": "12",
}

# Article prefix patterns (order matters — longest first)
_ART_RE = re.compile(
    r"\b(artt?\.?|articol[oi])\s+",
    re.IGNORECASE,
)

# Article number: digits with optional bis/ter/quater suffix and comma-separated lists
_ART_NUM_RE = re.compile(
    r"(\d+(?:\s*[-‑]?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)"
    r"(?:\s*[,e]\s*(\d+(?:\s*[-‑]?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?))*",
    re.IGNORECASE,
)

# Act number patterns: "241/90", "241/1990", "n. 241", "241 del 1990"
_ACT_NUM_DATE_PATTERNS = [
    # "196/2003" or "241/90"
    re.compile(r"\b(\d+)\s*/\s*(\d{2,4})\b"),
    # "n. 241" or "n 241"
    re.compile(r"\bn\.?\s*(\d+)\b"),
    # "241 del 1990" or "241 del 7 agosto 1990"
    re.compile(r"\b(\d+)\s+del\s+(\d{1,2}\s+\w+\s+\d{4}|\d{4})\b", re.IGNORECASE),
]

# Date patterns
_DATE_PATTERNS = [
    # "7/8/1990" or "07/08/1990" or "7-8-1990"
    (re.compile(r"\b(\d{1,2})\s*[/\-]\s*(\d{1,2})\s*[/\-]\s*(\d{4})\b"), "dmy"),
    # "7 agosto 1990"
    (re.compile(r"\b(\d{1,2})\s+(" + "|".join(_MESI.keys()) + r")\s+(\d{4})\b", re.IGNORECASE), "d_month_y"),
    # "1990-08-07" (ISO)
    (re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), "iso"),
    # standalone year "1990" (only 4 digits, at word boundary)
    (re.compile(r"\b(\d{4})\b"), "year"),
]


@dataclass
class ParsedQuery:
    """Structured result from natural language input parsing."""
    act_type: Optional[str] = None
    date: Optional[str] = None
    act_number: Optional[str] = None
    article: Optional[str] = None

    def to_api_params(self) -> dict:
        """Convert to API request parameters, omitting None values."""
        params = {}
        if self.act_type:
            params["act_type"] = self.act_type
        if self.date:
            params["date"] = self.date
        if self.act_number:
            params["act_number"] = self.act_number
        if self.article:
            params["article"] = self.article
        return params

    @property
    def is_valid(self) -> bool:
        """A query needs at least an act_type and an article to be useful."""
        return bool(self.act_type)


def parse_nl_query(raw_input: str) -> Optional[ParsedQuery]:
    """
    Parse a natural language legal query into structured parameters.

    Returns ParsedQuery if the input was recognized, None if it couldn't be parsed
    (caller should fall back to existing parser).

    Examples:
        "art. 2043 cc"                → ParsedQuery(act_type="codice civile", article="2043")
        "d.lgs. 196/2003, art. 7"     → ParsedQuery(act_type="decreto legislativo", act_number="196", date="2003", article="7")
        "articolo 3 codice civile"     → ParsedQuery(act_type="codice civile", article="3")
        "l. 241/1990 art. 1"          → ParsedQuery(act_type="legge", act_number="241", date="1990", article="1")
    """
    if not raw_input or not raw_input.strip():
        return None

    # Cap input length to prevent regex processing on excessively long strings
    if len(raw_input) > 500:
        return None

    text = _normalize(raw_input)

    result = ParsedQuery()

    # 1. Extract article numbers (remove from text for cleaner act matching)
    text, articles = _extract_articles(text)
    if articles:
        result.article = articles

    # 2. Extract explicit full dates (d/m/y, Italian, ISO) BEFORE act numbers
    #    to avoid "7/8/1990" being partially consumed as act number "8/1990"
    text, found_date = _extract_full_date(text)
    if found_date:
        result.date = found_date

    # 3. Extract act number + date from patterns like "196/2003"
    text, act_number, date_from_num = _extract_act_number(text)
    if act_number:
        result.act_number = act_number
    if date_from_num and not result.date:
        result.date = date_from_num

    # 4. Extract standalone year if no date found yet
    if not result.date:
        text, year_date = _extract_year(text)
        if year_date:
            result.date = year_date

    # 5. Identify act type from remaining text
    act_type = _identify_act_type(text)
    if act_type:
        result.act_type = act_type

    if not result.is_valid:
        return None

    return result


def _normalize(text: str) -> str:
    """Normalize whitespace, lowercase, clean up punctuation."""
    text = text.strip().lower()
    # Normalize multiple spaces
    text = re.sub(r"\s+", " ", text)
    # Normalize dashes (en-dash, em-dash → hyphen)
    text = text.replace("–", "-").replace("—", "-").replace("\u2011", "-")
    return text


def _extract_articles(text: str) -> tuple[str, Optional[str]]:
    """Extract article numbers from text. Returns (remaining_text, article_string)."""
    match = _ART_RE.search(text)
    if not match:
        return text, None

    after_prefix = text[match.end():]
    num_match = _ART_NUM_RE.match(after_prefix)
    if not num_match:
        return text, None

    # Collect all matched article numbers
    full_match_str = num_match.group(0).strip()
    # Normalize: "2 bis" → "2-bis"
    full_match_str = re.sub(r"(\d+)\s+(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)",
                            r"\1-\2", full_match_str, flags=re.IGNORECASE)

    # Remove the article portion from text
    consumed_end = match.start() + len(match.group(0)) + len(num_match.group(0))
    remaining = text[:match.start()] + " " + text[consumed_end:]
    remaining = re.sub(r"\s+", " ", remaining).strip()

    return remaining, full_match_str


def _extract_act_number(text: str) -> tuple[str, Optional[str], Optional[str]]:
    """Extract act number and optional date. Returns (remaining_text, act_number, date)."""
    # Pattern: "196/2003" or "241/90"
    m = _ACT_NUM_DATE_PATTERNS[0].search(text)
    if m:
        num = m.group(1)
        year_raw = m.group(2)
        year = _expand_year(year_raw)
        remaining = text[:m.start()] + " " + text[m.end():]
        return remaining.strip(), num, year

    # Pattern: "241 del 1990" or "241 del 7 agosto 1990"
    m = _ACT_NUM_DATE_PATTERNS[2].search(text)
    if m:
        num = m.group(1)
        date_str = m.group(2)
        date = _parse_date_string(date_str)
        remaining = text[:m.start()] + " " + text[m.end():]
        return remaining.strip(), num, date

    # Pattern: "n. 241" (no date)
    m = _ACT_NUM_DATE_PATTERNS[1].search(text)
    if m:
        num = m.group(1)
        remaining = text[:m.start()] + " " + text[m.end():]
        return remaining.strip(), num, None

    return text, None, None


def _extract_full_date(text: str) -> tuple[str, Optional[str]]:
    """Extract a full date (d/m/y, Italian, ISO) from text. Does NOT match standalone years."""
    for pattern, fmt in _DATE_PATTERNS:
        if fmt == "year":
            continue  # standalone years handled separately
        m = pattern.search(text)
        if not m:
            continue

        if fmt == "dmy":
            d, mo, y = m.group(1), m.group(2), m.group(3)
            date = f"{y}-{int(mo):02d}-{int(d):02d}"
        elif fmt == "d_month_y":
            d, month_name, y = m.group(1), m.group(2).lower(), m.group(3)
            mo = _MESI.get(month_name, "01")
            date = f"{y}-{mo}-{int(d):02d}"
        elif fmt == "iso":
            date = m.group(0)
        else:
            continue

        remaining = text[:m.start()] + " " + text[m.end():]
        return remaining.strip(), date

    return text, None


def _extract_year(text: str) -> tuple[str, Optional[str]]:
    """Extract a standalone 4-digit year from text."""
    for pattern, fmt in _DATE_PATTERNS:
        if fmt != "year":
            continue
        m = pattern.search(text)
        if m:
            remaining = text[:m.start()] + " " + text[m.end():]
            return remaining.strip(), m.group(1)
    return text, None


def _identify_act_type(text: str) -> Optional[str]:
    """Identify the act type from remaining text using NORMATTIVA_SEARCH map."""
    # Clean up leading/trailing comma and semicolons (but NOT dots — they're part of abbreviations)
    text = re.sub(r"[,;:]+$", "", text).strip()
    text = re.sub(r"^[,;:]+\s*", "", text).strip()

    if not text:
        return None

    # Try exact match first, then with trailing dot stripped (for cases like "cost.")
    if text in NORMATTIVA_SEARCH:
        return NORMATTIVA_SEARCH[text]
    text_no_dot = text.rstrip(".")
    if text_no_dot and text_no_dot in NORMATTIVA_SEARCH:
        return NORMATTIVA_SEARCH[text_no_dot]

    # Try matching each known abbreviation/name as a substring
    # Sort by length (longest first) to prefer specific matches
    candidates = sorted(NORMATTIVA_SEARCH.keys(), key=len, reverse=True)
    for abbrev in candidates:
        # Word-boundary match within text
        pattern = r"(?:^|\s)" + re.escape(abbrev) + r"(?:\s|$|[,;:])"
        if re.search(pattern, " " + text + " "):
            return NORMATTIVA_SEARCH[abbrev]

    return None


def _expand_year(year_str: str) -> str:
    """Expand 2-digit year to 4-digit: '90' → '1990', '03' → '2003'."""
    if len(year_str) == 4:
        return year_str
    y = int(year_str)
    if y >= 0 and y <= 30:
        return str(2000 + y)
    return str(1900 + y)


def _parse_date_string(date_str: str) -> Optional[str]:
    """Parse a date string like '1990' or '7 agosto 1990' into ISO format."""
    date_str = date_str.strip()

    # Year only
    if re.match(r"^\d{4}$", date_str):
        return date_str

    # "7 agosto 1990"
    m = re.match(r"(\d{1,2})\s+(\w+)\s+(\d{4})", date_str)
    if m:
        d, month_name, y = m.group(1), m.group(2).lower(), m.group(3)
        mo = _MESI.get(month_name)
        if mo:
            return f"{y}-{mo}-{int(d):02d}"

    return None
