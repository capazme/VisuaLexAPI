"""
Natural language input parser for Italian legal norm queries.

Converts free-form strings like "art. 2043 cc" or "d.lgs. 196/2003, art. 7"
into structured data for the VisuaLex API.
"""

import re
from dataclasses import dataclass
from datetime import date as _date
from typing import Optional

from .act_resolver import resolve_atto
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

# One article: digits, an optional bis/ter/... suffix, or a range ("1-10").
_ART_ITEM = (
    r"\d+(?:\s*[-‑]?\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?"
    r"(?:\s*[-‑]\s*\d+)?"
)
# A list of them, separated by "," or "e": "artt. 1, 2 e 3". The API takes
# lists as "1,2,3" and ranges as "1-10"; "5 e 6" it rejects as invalid.
_ART_SEPARATOR_RE = re.compile(r"\s*(?:,|\be\b)\s*", re.IGNORECASE)
_ART_NUM_RE = re.compile(
    r"(" + _ART_ITEM + r")(?:" + _ART_SEPARATOR_RE.pattern + r"(" + _ART_ITEM + r"))*",
    re.IGNORECASE,
)
# "comma 1", "co. 3", "comma 1, lett. b)": qualifies the article, is not the
# act number, and hides the act name from the resolver if left in place.
_COMMA_CLAUSE_RE = re.compile(
    r"\s*,?\s*(?:comma|co\.|c\.)\s*\d+(?:\s*,?\s*(?:lett\.?|lettera)\s*[a-z]\b\)?)?",
    re.IGNORECASE,
)

# Act number patterns: "241/90", "241/1990", "n. 241", "241 del 1990"
_ACT_NUM_DATE_PATTERNS = [
    # "196/2003" or "241/90" — the year has two or four digits ("241/456" is
    # not an act of the year 456), and neither half may be part of a
    # day/month/year triple ("31/13/1990" is a bad date, not act 31 of 2013)
    re.compile(r"(?<![\d/])\b(\d+)\s*/\s*(\d{4}|\d{2})\b(?!\s*/\s*\d)"),
    # "n. 241" or "n 241"
    re.compile(r"\bn\.?\s*(\d+)\b"),
    # "241 del 1990" or "241 del 7 agosto 1990"
    re.compile(r"\b(\d+)\s+del\s+(\d{1,2}\s+\w+\s+\d{4}|\d{4})\b", re.IGNORECASE),
]

# EU acts: "Regolamento (UE) 2016/679", "Reg. UE 2024/2847", "Regolamento (CE)
# n. 1/2003", "Direttiva 2002/58/CE", "dir. ue 2555/2022". Parentheses around
# the marker are tolerated, "n." may precede the pair, and the pair comes in
# either order — see resolve_eu_year_and_number. A third numeric group after
# the pair is a day/month/year date, never an act: "direttiva 1/2/2016" is not
# directive 1 of the year 2.
#
# The marker is optional for directives (nothing else is "direttiva
# 2016/680"); for regulations the caller decides: a lawyer typing
# "regolamento 2016/679" in the palette means the EU act, while in an article
# body a bare "regolamento n. 5/2020" is usually a national one, so the
# in-text linker (citation_linker.py) requires it, as the client matcher does.
# Groups: act word, marker, first half, second half, trailing marker.
_EU_MARKER = r"(?:cee|ce|ue|euratom)"
_EU_QUALIFIER = r"(?:\s+(?:di\s+esecuzione|di\s+attuazione|delegat[oa]))?"
_EU_ACT_TYPES = {"regolamento": "regolamento ue", "direttiva": "direttiva ue"}


def build_eu_act_pattern() -> str:
    """Regex source for an EU citation, with the five groups listed above.

    The marker is always optional in the pattern; a caller that wants it
    mandatory for regulations checks the captured group afterwards through
    ``eu_act_from_groups`` — a group that exists in only one alternative cannot
    be told apart from an empty one.
    """
    head = (
        r"\b((?:regolamento" + _EU_QUALIFIER + r"|reg\.?|direttiva" + _EU_QUALIFIER + r"|dir\.?))"
        r"\s*(?:\(?\s*(" + _EU_MARKER + r")\s*\)?)?"
    )
    return (
        head
        + r"\s*(?:n\.?\s*)?"
        r"(\d{1,4})\s*/\s*(\d{1,4})(\s*/\s*" + _EU_MARKER + r")?(?!\s*/\s*\d)\b"
    )


EU_ACT_RE = re.compile(build_eu_act_pattern(), re.IGNORECASE)
_EU_YEAR_FLOOR = 1950
_EU_NEW_NUMBERING_FROM = 2015

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

    # 1b. EU acts read their pair in their own order. Resolve them before the
    #     Italian number/year rule can read "2024/2847" as act 2024 of 2847.
    text, eu_type, eu_number, eu_year = _extract_eu_act(text)
    if eu_type:
        result.act_type = eu_type
        result.act_number = eu_number
        result.date = eu_year
        return result

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
    known = _identify_known_act(text)
    if known:
        result.act_type = known["tipo_atto"]
        if known.get("numero_atto") and not result.act_number:
            result.act_number = known["numero_atto"]
        if known.get("data") and not result.date:
            result.date = known["data"]
    else:
        act_type = _identify_act_type(text)
        if act_type:
            result.act_type = act_type

    if not result.is_valid:
        return None

    return result


def _normalize(text: str) -> str:
    """Normalize whitespace, lowercase, clean up punctuation."""
    text = text.strip().lower()
    # "(UE)" is the official spelling of the marker, not noise: with the
    # parentheses in place "regolamento (ue)" matched no act at all.
    text = re.sub(r"[()\[\]]+", " ", text)
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

    # Hand the API its own shapes: "2 bis" → "2-bis", "1 - 10" → "1-10",
    # "5 e 6" → "5,6".
    items = []
    for item in _ART_SEPARATOR_RE.split(num_match.group(0).strip()):
        item = re.sub(r"(\d+)\s*[-‑]?\s*(bis|ter|quater|quinquies|sexies|septies|octies|novies|decies)",
                      r"\1-\2", item.strip(), flags=re.IGNORECASE)
        item = re.sub(r"(\d+)\s*[-‑]\s*(\d+)", r"\1-\2", item)
        items.append(item)
    full_match_str = ",".join(items)

    # Remove the article portion from text, and the comma clause behind it
    consumed_end = match.start() + len(match.group(0)) + len(num_match.group(0))
    clause = _COMMA_CLAUSE_RE.match(text, consumed_end)
    if clause:
        consumed_end = clause.end()
    remaining = text[:match.start()] + " " + text[consumed_end:]
    remaining = re.sub(r"\s+", " ", remaining).strip()

    return remaining, full_match_str


def _is_eu_year_like(half: str, ceiling: int) -> bool:
    return len(half) == 4 and half.isdigit() and _EU_YEAR_FLOOR <= int(half) <= ceiling


def _can_be_year(half: str) -> bool:
    """Only a two-digit or a four-digit half can be the year of an act."""
    return len(half) in (2, 4)


def resolve_eu_year_and_number(
    first: str,
    second: str,
    *,
    kind: str = "regolamento",
    trailing_marker: bool = False,
    old_marker: bool = False,
    current_year: Optional[int] = None,
) -> Optional[tuple[str, str]]:
    """Return ``(year, act_number)`` for the EU pair ``first/second``, or
    ``None`` when neither half can be the year.

    The Official Journal numbers EU acts year-first since 2015 ("2016/679",
    "2024/2847"), directives always did ("95/46/CE", "2002/58/CE"), pre-2015
    regulations are number-first ("1/2003", "2913/92") and Italian practice
    writes any of them the Italian way round ("679/2016"). The rules, in
    order:

    - a trailing marker on a directive ("2002/58/CE") is the old directive
      format: year first; on a regulation ("1049/2001/CE") it says nothing
      about the order, which the rules below decide;
    - one half looks like a year and the other does not: that one is the year;
    - both look like years: year first from 2015 on, number first before
      ("Regolamento (CE) n. 2006/2004" is number 2006 of 2004) — and a
      "(CE)"/"(CEE)" act is always number first, because those Communities
      ended in 2009 ("Regolamento (CE) n. 2015/2006" is number 2015 of 2006);
    - a two-digit year is in play otherwise: "2913/92" is number first,
      "95/46" is year first, and two two-digit halves follow the kind —
      directives were always year first, regulations number first.

    The frontend mirrors this in ``utils/euCitation.ts``.
    """
    ceiling = (current_year or _date.today().year) + 1
    first_is_year = _is_eu_year_like(first, ceiling)
    second_is_year = _is_eu_year_like(second, ceiling)
    year_first = (_expand_year(first), second) if _can_be_year(first) else None
    number_first = (_expand_year(second), first) if _can_be_year(second) else None

    if trailing_marker and kind == "direttiva":
        return year_first
    if first_is_year and not second_is_year:
        return year_first
    if second_is_year and not first_is_year:
        return number_first
    if first_is_year and second_is_year:
        if not old_marker and int(first) >= _EU_NEW_NUMBERING_FROM:
            return year_first
        return number_first
    if len(first) == 2 and len(second) == 2:
        return year_first if kind == "direttiva" else number_first
    if len(first) == 2:
        return year_first
    return number_first


def eu_act_from_groups(
    head: str,
    marker: Optional[str],
    first: str,
    second: str,
    trailing: Optional[str],
    *,
    marker_required_for_regulation: bool = False,
) -> Optional[tuple[str, str, str]]:
    """Turn the five groups of ``build_eu_act_pattern`` into
    ``(act_type, act_number, year)``, or ``None`` when the pair cannot be read
    or a regulation lacks the marker the caller requires."""
    kind = "direttiva" if head.lower().lstrip().startswith("dir") else "regolamento"
    # "regolamento 1049/2001/CE": the marker may trail the pair instead of
    # following the act word, and it counts the same.
    marker_text = (marker or re.sub(r"[^a-z]", "", (trailing or "").lower())).lower()
    if marker_required_for_regulation and kind == "regolamento" and not marker_text:
        return None
    resolved = resolve_eu_year_and_number(
        first, second, kind=kind, trailing_marker=bool(trailing),
        old_marker=marker_text in ("ce", "cee"),
    )
    if resolved is None:
        return None
    year, number = resolved
    return _EU_ACT_TYPES[kind], number, year


def _extract_eu_act(text: str) -> tuple[str, Optional[str], Optional[str], Optional[str]]:
    """Extract an EU act. Returns (remaining_text, act_type, act_number, year)."""
    m = EU_ACT_RE.search(text)
    if not m:
        return text, None, None, None

    resolved = eu_act_from_groups(*m.groups())
    if resolved is None:
        return text, None, None, None

    act_type, number, year = resolved
    remaining = re.sub(r"\s+", " ", text[:m.start()] + " " + text[m.end():]).strip()
    return remaining, act_type, number, year


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


def _plausible_day_month(day: str, month: str) -> bool:
    return 1 <= int(day) <= 31 and 1 <= int(month) <= 12


def _extract_full_date(text: str) -> tuple[str, Optional[str]]:
    """Extract a full date (d/m/y, Italian, ISO) from text. Does NOT match
    standalone years. A shape that cannot be a date ("31/13/1990") is
    skipped and the search goes on, on the same pattern first."""
    for pattern, fmt in _DATE_PATTERNS:
        if fmt == "year":
            continue  # standalone years handled separately
        for m in pattern.finditer(text):
            if fmt == "dmy":
                d, mo, y = m.group(1), m.group(2), m.group(3)
                if not _plausible_day_month(d, mo):
                    continue
                date = f"{y}-{int(mo):02d}-{int(d):02d}"
            elif fmt == "d_month_y":
                d, month_name, y = m.group(1), m.group(2).lower(), m.group(3)
                mo = _MESI[month_name]  # the pattern is built from _MESI's keys
                if not _plausible_day_month(d, mo):
                    continue
                date = f"{y}-{mo}-{int(d):02d}"
            elif fmt == "iso":
                if not _plausible_day_month(m.group(3), m.group(2)):
                    continue
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


def _identify_known_act(text: str) -> Optional[dict]:
    """Resolve a full act name to type + number + date, or None.

    Runs before the substring scan so a denominato ("statuto dei lavoratori")
    yields its number and date rather than just a type.
    """
    return resolve_atto(text)


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
