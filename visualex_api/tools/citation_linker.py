"""
Contextual norm linking engine.

Scans legal text to detect normative references (explicit and contextual),
returning annotated citations with position metadata for frontend rendering.

Uses a state-machine approach: tracks the "active norm" as the parser moves
through text, so bare article references (e.g., "art. 5") resolve to the
last mentioned act.
"""

import re
from bisect import bisect_right
from dataclasses import dataclass
from typing import Optional

from .map import NORMATTIVA_SEARCH
from .nl_parser import build_eu_act_pattern, eu_act_from_groups

# Pre-build lowercase lookup for case-insensitive resolution
_SEARCH_LOWER = {k.lower(): v for k, v in NORMATTIVA_SEARCH.items()}

# Act type abbreviations that can follow an article reference
# Sorted by length (longest first) for greedy matching
_ACT_ABBREVS = sorted(
    [k for k in NORMATTIVA_SEARCH.keys() if len(k) >= 2],
    key=len,
    reverse=True,
)

# Build a combined regex pattern for act abbreviations. An abbreviation is a
# whole word: without the guard, "comma" matched the "com" of the codice
# dell'ordinamento militare and "costituzionalmente" the "cost" of the
# Costituzione, and the false act poisoned the context of every bare
# "art. N" that followed.
_ACT_ABBREV_PATTERN = "(?:" + "|".join(re.escape(a) for a in _ACT_ABBREVS) + r")(?![A-Za-z'\u2019])"

# Acts that cannot be opened without a number. One that comes out of a
# pattern number-less ("art. 17 della legge 23 agosto 1988, n. 400" — a form
# no pattern reads) stays in the result, but must not take over the context
# of the bare articles after it: they would inherit an act nobody can open.
_NUMBERED_ACT_TYPES = frozenset({
    "legge", "decreto legge", "decreto legislativo",
    "decreto del presidente della repubblica", "regio decreto",
    "decreto ministeriale", "regolamento ue", "direttiva ue",
})

# One article: a number, an optional bis/ter/... suffix or a range ("1-10").
_ARTICLE_NUMBER_RE = re.compile(
    r"\d+(?:\s*-\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies|\d+))?",
    re.IGNORECASE,
)
# "articoli 8 e 9", "artt. 1, 2 e 3": every number of the list is an article
# of the act it is attached to.
_ARTICLE_LIST_SOURCE = (
    _ARTICLE_NUMBER_RE.pattern
    + r"(?:\s*(?:,|\be\b)\s*" + _ARTICLE_NUMBER_RE.pattern + r")*"
)
# "comma 1", "co. 3", "commi 1 e 2", "comma 1, lett. b)": qualifies the
# article, never the act. The closing comma ("art. 5, comma 1, del …") is
# ordinary Italian punctuation and is consumed by the act-binding patterns.
_COMMA_CLAUSE_SOURCE = (
    r"(?:\s*,?\s*(?:comm[ai]|co)\.?\s*\d+(?:\s*(?:,|\be\b)\s*\d+)*)?"
    r"(?:\s*,?\s*(?:lett\.?|lettera)\s*[a-z]\b\)?)?"
)

# Pattern: "art. N [suffix] [comma N] <act_abbrev>"
_EXPLICIT_CITE_RE = re.compile(
    r"((?:artt?\.?|articol[oi])\s+)"  # group 1: article prefix
    r"(" + _ARTICLE_NUMBER_RE.pattern + r")"  # group 2: article number
    r"(?:\s*(?:e|,)\s*" + _ARTICLE_NUMBER_RE.pattern + r")*"  # optional additional articles
    + _COMMA_CLAUSE_SOURCE +
    r"\s*,?\s+"  # separator — ", comma 1, c.c." closes the clause with a comma
    r"(?:del\s+|della\s+|dello\s+|dell['']\s*)?"  # optional preposition
    r"(" + _ACT_ABBREV_PATTERN + r")"  # group 3: act abbreviation
    r"(?:\s+(\d+)\s*/\s*(\d{4}|\d{2})\b)?"  # group 4,5: optional act_number/year
    ,
    re.IGNORECASE,
)

# Pattern: "art. N del <act_type> N/YYYY" (article before act with a preposition)
_ART_DEL_ACT_RE = re.compile(
    r"((?:artt?\.?|articol[oi])\s+)"
    r"(" + _ARTICLE_NUMBER_RE.pattern + r")"
    + _COMMA_CLAUSE_SOURCE +
    r"\s*,?\s+(?:del|della|dello|dell['\u2019]\s*)\s*"
    r"(" + _ACT_ABBREV_PATTERN + r")"
    r"(?:\s+(\d+)\s*/\s*(\d{4}|\d{2})\b)?"
    ,
    re.IGNORECASE,
)

# Pattern: standalone act reference without article: "d.lgs. 196/2003"
_STANDALONE_ACT_RE = re.compile(
    r"(?:^|(?<=[\s\u00a0])|(?<=[''(]))"
    r"(" + _ACT_ABBREV_PATTERN + r")"  # group 1: act abbreviation
    r"\s+(\d+)\s*/\s*(\d{4}|\d{2})\b"  # group 2,3: number/year — two or four digits, "241/456" is no year
    ,
    re.IGNORECASE,
)

# EU acts, in the official spelling of an article body: "regolamento (UE)
# 2016/679, art. 5", "direttiva 2002/58/CE", "art. 5 del regolamento (UE)
# 2016/679". The pair is read by nl_parser's rule (year first since 2015,
# "(CE)" always the old numbering); for regulations the marker is mandatory
# here, because a bare "regolamento n. 5/2020" in a text is a national one.
_EU_ACT_SOURCE = build_eu_act_pattern()
# Groups 1-5: the EU act; group 6: the article list that follows it.
_EU_ACT_ART_AFTER_RE = re.compile(
    _EU_ACT_SOURCE
    + r"(?:\s*,?\s*(?:artt?\.?|articol[oi])\s+(" + _ARTICLE_LIST_SOURCE + r"))?",
    re.IGNORECASE,
)
# Group 1: article prefix; group 2: the article list; groups 3-7: the EU act.
# "art. 5, comma 1, del regolamento (UE) 2016/679": the clause closes with a
# comma before "del", and that comma is ordinary Italian punctuation.
_ART_DEL_EU_ACT_RE = re.compile(
    r"((?:artt?\.?|articol[oi])\s+)"
    r"(" + _ARTICLE_LIST_SOURCE + r")"
    + _COMMA_CLAUSE_SOURCE +
    r"\s*,?\s+(?:del|della|dello|dell['\u2019]\s*)\s*"
    + _EU_ACT_SOURCE,
    re.IGNORECASE,
)

# Pattern: bare article reference (no act specified)
_BARE_ART_RE = re.compile(
    r"((?:artt?\.?|articol[oi])\s+)"
    r"(" + _ARTICLE_NUMBER_RE.pattern + r")"
    + _COMMA_CLAUSE_SOURCE
    ,
    re.IGNORECASE,
)

# Maximum text length to process (prevent DoS via large payloads)
_MAX_TEXT_LENGTH = 500_000


@dataclass
class Citation:
    """A detected normative citation in text."""
    start: int
    end: int
    display_text: str
    article: Optional[str] = None
    act_type: Optional[str] = None
    act_number: Optional[str] = None
    date: Optional[str] = None

    def to_dict(self) -> dict:
        result = {
            "start": self.start,
            "end": self.end,
            "display_text": self.display_text,
        }
        if self.article:
            result["article"] = self.article
        if self.act_type:
            result["act_type"] = self.act_type
        if self.act_number:
            result["act_number"] = self.act_number
        if self.date:
            result["date"] = self.date
        return result

    def target_params(self) -> dict:
        """Return API-compatible parameters for this citation's target."""
        params = {}
        if self.act_type:
            params["act_type"] = self.act_type
        if self.article:
            params["article"] = self.article
        if self.act_number:
            params["act_number"] = self.act_number
        if self.date:
            params["date"] = self.date
        return params


def _expand_year(year_str: str) -> str:
    """Expand 2-digit year to 4-digit."""
    if len(year_str) == 4:
        return year_str
    y = int(year_str)
    return str(2000 + y) if y <= 30 else str(1900 + y)


def _resolve_act_type(abbrev: str) -> Optional[str]:
    """Resolve an abbreviation to its full act type name (case-insensitive)."""
    key = abbrev.lower().strip().rstrip(".")
    if key in _SEARCH_LOWER:
        return _SEARCH_LOWER[key]
    # Try with trailing dot
    if key + "." in _SEARCH_LOWER:
        return _SEARCH_LOWER[key + "."]
    return None


def extract_citations(
    text: str,
    context_act_type: Optional[str] = None,
) -> list[Citation]:
    """
    Extract all normative citations from legal text.

    Args:
        text: The legal text to scan (max 500KB).
        context_act_type: Optional act type context (e.g., the act being viewed).
            Bare article references will resolve to this act type.

    Returns:
        List of Citation objects sorted by position, with no overlaps.

    Context: a bare "art. N" inherits the last act named before it in the
    text — type, number and year, so "d.lgs. 196/2003 … l'art. 7" is article
    7 of that decree. The context does not reset at a sentence boundary
    ("… c.c. prevede il risarcimento. L'art. 2059 …" stays in the codice),
    which also means a rhetorical "E l'art. 2043?" after "legge 241/1990"
    is read as art. 2043 of that law. Callers that need sentence-scoped
    resolution must split the text themselves.
    """
    if not text or not text.strip():
        return []

    if len(text) > _MAX_TEXT_LENGTH:
        return []

    citations: list[Citation] = []
    # Registered ranges never overlap, so kept sorted by start they are also
    # sorted by end and one bisection answers "is this range free". A linear
    # scan made the per-article emission below quadratic: a 200 KB list of
    # articles held the event loop for half a minute on a public endpoint.
    used_starts: list[int] = []
    used_ends: list[int] = []

    def _overlaps(start: int, end: int) -> bool:
        i = bisect_right(used_starts, start)
        if i > 0 and used_ends[i - 1] > start:
            return True
        return i < len(used_starts) and used_starts[i] < end

    def _register(c: Citation) -> None:
        if not _overlaps(c.start, c.end):
            citations.append(c)
            i = bisect_right(used_starts, c.start)
            used_starts.insert(i, c.start)
            used_ends.insert(i, c.end)

    def _register_eu(m: re.Match, list_group: int, act_start: int, act_end: int,
                     resolved: tuple[str, str, str]) -> None:
        """One Citation for a single article (the whole match, act included);
        for a list, one per article number plus one for the act itself, so
        every number of "articoli 8 e 9 del regolamento (UE) 2016/679" links
        to the regulation and none is left to the act named three lines up."""
        act_type, act_number, year = resolved
        list_text = m.group(list_group)
        numbers = list(_ARTICLE_NUMBER_RE.finditer(list_text)) if list_text else []
        if len(numbers) <= 1:
            _register(Citation(
                start=m.start(), end=m.end(), display_text=m.group(0),
                article=list_text.strip() if list_text else None,
                act_type=act_type, act_number=act_number, date=year,
            ))
            return
        base = m.start(list_group)
        for n in numbers:
            _register(Citation(
                start=base + n.start(), end=base + n.end(), display_text=n.group(0),
                article=n.group(0).strip(), act_type=act_type,
                act_number=act_number, date=year,
            ))
        _register(Citation(
            start=act_start, end=act_end, display_text=text[act_start:act_end],
            article=None, act_type=act_type, act_number=act_number, date=year,
        ))

    # Pass 0: EU acts, before the national patterns so the range is theirs.
    # "art. 5 del regolamento (UE) 2016/679" first, then the act with an
    # article after it (or none, which only sets the context).
    for m in _ART_DEL_EU_ACT_RE.finditer(text):
        resolved = eu_act_from_groups(*m.groups()[2:7], marker_required_for_regulation=True)
        if not resolved:
            continue
        _register_eu(m, 2, m.start(3), m.end(), resolved)

    for m in _EU_ACT_ART_AFTER_RE.finditer(text):
        if _overlaps(m.start(), m.end()):
            continue
        resolved = eu_act_from_groups(*m.groups()[0:5], marker_required_for_regulation=True)
        if not resolved:
            continue
        act_end = m.end(5) if m.group(5) else m.end(4)
        _register_eu(m, 6, m.start(), act_end, resolved)

    # Pass 1: Find explicit citations (article + act abbreviation)
    for m in _EXPLICIT_CITE_RE.finditer(text):
        article = m.group(2).strip()
        act_abbrev = m.group(3)
        act_number = m.group(4)
        year = m.group(5)

        resolved = _resolve_act_type(act_abbrev)
        if not resolved:
            continue

        c = Citation(
            start=m.start(),
            end=m.end(),
            display_text=m.group(0),
            article=article,
            act_type=resolved,
            act_number=act_number,
            date=_expand_year(year) if year else None,
        )
        _register(c)

    # Pass 1b: "art. N del d.lgs. N/YYYY" pattern
    for m in _ART_DEL_ACT_RE.finditer(text):
        if _overlaps(m.start(), m.end()):
            continue
        article = m.group(2).strip()
        act_abbrev = m.group(3)
        act_number = m.group(4)
        year = m.group(5)

        resolved = _resolve_act_type(act_abbrev)
        if not resolved:
            continue

        c = Citation(
            start=m.start(),
            end=m.end(),
            display_text=m.group(0),
            article=article,
            act_type=resolved,
            act_number=act_number,
            date=_expand_year(year) if year else None,
        )
        _register(c)

    # Pass 2: Find standalone act references (no article)
    for m in _STANDALONE_ACT_RE.finditer(text):
        if _overlaps(m.start(), m.end()):
            continue
        act_abbrev = m.group(1)
        act_number = m.group(2)
        year = m.group(3)

        resolved = _resolve_act_type(act_abbrev)
        if not resolved:
            continue

        c = Citation(
            start=m.start(),
            end=m.end(),
            display_text=m.group(0),
            article=None,
            act_type=resolved,
            act_number=act_number,
            date=_expand_year(year) if year else None,
        )
        _register(c)

    # Pass 3: Find bare article references (act_type=None, resolved in context pass)
    for m in _BARE_ART_RE.finditer(text):
        if _overlaps(m.start(), m.end()):
            continue
        article = m.group(2).strip()

        c = Citation(
            start=m.start(),
            end=m.end(),
            display_text=m.group(0),
            article=article,
            act_type=None,  # resolved in context pass below
        )
        _register(c)

    # Sort by position
    citations.sort(key=lambda c: c.start)

    # Single context-propagation pass: walk in text order. A bare "art. 7"
    # after "d.lgs. 196/2003" is article 7 OF THAT DECREE, so the number and
    # the year travel with the act type — with the type alone, an EU act was
    # unreachable and a numbered national one opened the wrong act.
    current_context = (context_act_type, None, None) if context_act_type else None
    for c in citations:
        if c.act_type:
            if c.act_number or c.act_type not in _NUMBERED_ACT_TYPES:
                current_context = (c.act_type, c.act_number, c.date)
        elif current_context:
            c.act_type, c.act_number, c.date = current_context

    return citations
