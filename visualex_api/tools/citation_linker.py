"""
Contextual norm linking engine.

Scans legal text to detect normative references (explicit and contextual),
returning annotated citations with position metadata for frontend rendering.

Uses a state-machine approach: tracks the "active norm" as the parser moves
through text, so bare article references (e.g., "art. 5") resolve to the
last mentioned act.
"""

import re
from dataclasses import dataclass
from typing import Optional

from .map import NORMATTIVA_SEARCH

# Pre-build lowercase lookup for case-insensitive resolution
_SEARCH_LOWER = {k.lower(): v for k, v in NORMATTIVA_SEARCH.items()}

# Act type abbreviations that can follow an article reference
# Sorted by length (longest first) for greedy matching
_ACT_ABBREVS = sorted(
    [k for k in NORMATTIVA_SEARCH.keys() if len(k) >= 2],
    key=len,
    reverse=True,
)

# Build a combined regex pattern for act abbreviations
_ACT_ABBREV_PATTERN = "|".join(re.escape(a) for a in _ACT_ABBREVS)

# Pattern: "art. N [suffix] [comma N] <act_abbrev>"
_EXPLICIT_CITE_RE = re.compile(
    r"(artt?\.?\s+)"  # group 1: article prefix
    r"(\d+(?:\s*-\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)"  # group 2: article number
    r"(?:\s*,\s*comm[ai]\.?\s*\d+)?"  # optional comma clause (non-capturing)
    r"(?:\s*(?:e|,)\s*\d+(?:\s*-\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)*"  # optional additional articles
    r"\s+"  # separator
    r"(?:del\s+|della\s+|dello\s+|dell['']\s*)?"  # optional preposition
    r"(" + _ACT_ABBREV_PATTERN + r")"  # group 3: act abbreviation
    r"(?:\s+(\d+)\s*/\s*(\d{2,4}))?"  # group 4,5: optional act_number/year
    ,
    re.IGNORECASE,
)

# Pattern: "art. N del <act_type> N/YYYY" (article before act with "del")
_ART_DEL_ACT_RE = re.compile(
    r"(artt?\.?\s+)"
    r"(\d+(?:\s*-\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)"
    r"(?:\s*,\s*comm[ai]\.?\s*\d+)?"
    r"\s+del\s+"
    r"(" + _ACT_ABBREV_PATTERN + r")"
    r"(?:\s+(\d+)\s*/\s*(\d{2,4}))?"
    ,
    re.IGNORECASE,
)

# Pattern: standalone act reference without article: "d.lgs. 196/2003"
_STANDALONE_ACT_RE = re.compile(
    r"(?:^|(?<=[\s\u00a0])|(?<=[''(]))"
    r"(" + _ACT_ABBREV_PATTERN + r")"  # group 1: act abbreviation
    r"\s+(\d+)\s*/\s*(\d{2,4})"  # group 2,3: number/year
    ,
    re.IGNORECASE,
)

# Pattern: bare article reference (no act specified)
_BARE_ART_RE = re.compile(
    r"(artt?\.?\s+)"
    r"(\d+(?:\s*-\s*(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)"
    r"(?:\s*,\s*comm[ai]\.?\s*\d+)?"
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
    """
    if not text or not text.strip():
        return []

    if len(text) > _MAX_TEXT_LENGTH:
        return []

    citations: list[Citation] = []
    used_ranges: list[tuple[int, int]] = []

    def _overlaps(start: int, end: int) -> bool:
        return any(s < end and start < e for s, e in used_ranges)

    def _register(c: Citation) -> None:
        if not _overlaps(c.start, c.end):
            citations.append(c)
            used_ranges.append((c.start, c.end))

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

    # Single context-propagation pass: walk in text order, propagate act_type
    current_context = context_act_type
    for c in citations:
        if c.act_type:
            current_context = c.act_type
        elif current_context:
            c.act_type = current_context

    return citations
