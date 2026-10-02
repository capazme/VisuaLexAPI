"""What a Normattiva article page says about its own validity.

An article page states, outside the text, the window in which that text was in
force: "Testo in vigore dal: 25-12-2003 al: 29-12-2007". This module reads that
statement, and only that, from the raw page the scraper already keeps in its
persistent cache, so the reader is told which version came back instead of an
echo of the date they typed (`NormaVisitata.data_versione` is the request).

It never touches `article_text`. Every stored highlight and note is pinned to
that text by offset (root CLAUDE.md, rule 23) and the scraper's extraction is
frozen; nothing here may alter, re-derive or "improve" it.

Everything is best effort. A page that cannot be read yields `None`, never a
guess: silence is truer than a default ("Vigente" shown for an article nobody
checked is the defect this replaces). The module does no network I/O and does
not import the scraper.
"""
from __future__ import annotations

import asyncio
import html
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional, Tuple, TypedDict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import structlog
from bs4 import BeautifulSoup, Tag

from ..tools.article_suffixes import ARTICLE_SUFFIX_ALTERNATION
from ..tools.exceptions import ValidationError
from ..tools.text_op import parse_date
from .akn_parser import normalize_article_key

log = structlog.get_logger()

STATES = ("current", "historical", "not_yet", "abrogated")

# The body is parsed from a bounded slice: the page is up to 2.6 MB and the
# scraper has already parsed it once. The label, the "not yet" sentinel and an
# abrogation notice all sit at the very start of the body.
_BODY_SLICE = 200_000

# These patterns run on a page the portal served and must stay linear on one it did
# not (a changed or compromised portal): `re` holds the GIL, so a quadratic pattern
# stalls the whole event loop even from a thread. Hence no character class here may run
# past the next "<" or ">", and no pattern searches a repeated word inside an attribute
# value it may have to give back (that is how the first version of the `div` finders
# went quadratic): a tag is found first, then its class attribute is read from that
# one tag's text.
_DIV_OPENING = re.compile(r"<div\b[^<>]*>", re.I)
_CLASS_VALUE = re.compile(r"""\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)
_VIGORE_WORD = re.compile(r"\bvigore\b", re.I)
_BODY_WORD = re.compile(r"\bbodyTesto\b", re.I)
_TAG = re.compile(r"<[^<>]+>")
_DAY = r"(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})"
# "Testo in vigore dal: 25-12-2003 al: 29-12-2007", "... dal: 28-12-2025" or
# "... al: 12-9-2014". Read from the block's text, so it does not depend on
# which element wraps each date.
_WINDOW = re.compile(
    rf"Testo\s+in\s+vigore\s*(?:dal\s*:?\s*{_DAY})?(?:[\s,;–—-]*\bal\s*:?\s*{_DAY})?",
    re.I,
)
# "(Ultimo aggiornamento all'atto pubblicato il 12/06/2026)"; the apostrophe is
# an entity (&#39;) in the served HTML, hence the bounded wildcard.
_ACT_UPDATED = re.compile(
    r"Ultimo\s+aggiornamento\s+all.{1,8}?atto\s+pubblicato\s+il\s+(\d{1,2})/(\d{1,2})/(\d{4})",
    re.I,
)
_VERSION = re.compile(r"art\.versione=(\d+)")
_NOT_YET = "non ancora esistente"
# "Art. 2043.", "Art. 6-bis", "Art. 183 bis", "Codice Penale-art. 524".
_LABEL = re.compile(
    rf"\bart(?:icolo|\.)?\s*(\d+(?:\s*[-\s]\s*(?:{ARTICLE_SUFFIX_ALTERNATION})\b(?:\.\d+)?)?(?:/\d+)?)",
    re.I,
)
# Everything up to and including the label: "Codice Penale-art. 524" is label.
_UP_TO_LABEL = re.compile(r"^.*?" + _LABEL.pattern, re.I | re.S)
# A notice that repeals the whole article says so in so many words; a partial one says
# "COMMA ABROGATO", "LETTERA ... ABROGATA", "PERIODO ...".
_WHOLE_ARTICLE_NOTICE = re.compile(r"\W*ARTICOLO\s+ABROGAT[OA]\b", re.I)
# The note markers the portal leaves in the text: "((178))", "(129a)".
_NOTE_REFERENCE = re.compile(r"\(\(?\s*\d+\s*[a-z]?\s*\)\)?", re.I)


class Validity(TypedDict):
    """The wire shape: `validity` next to `article_text` in the article handlers."""

    state: str
    valid_from: Optional[str]
    valid_to: Optional[str]
    version_number: Optional[int]
    act_updated: Optional[str]
    request_in_window: Optional[bool]


def _iso(day: str, month: str, year: str) -> Optional[str]:
    try:
        return date(int(year), int(month), int(day)).isoformat()
    except ValueError:
        return None


def _iso_day(value: Any) -> Optional[str]:
    """`YYYY-MM-DD` from what the request carried (ISO or the Italian long form), else None."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        text = parse_date(value.strip())
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return None


def _find_div(raw: str, word: re.Pattern[str]) -> Optional[re.Match[str]]:
    """The first `<div ...>` opening whose class attribute holds `word`, or None.

    Linear in the page: the openings come from a pattern that cannot run past the
    next "<" or ">", and the class attribute is read from one opening's text only.
    """
    for opening in _DIV_OPENING.finditer(raw):
        value = _CLASS_VALUE.search(opening.group())
        if value is not None and word.search(value.group(1) or value.group(2) or ""):
            return opening
    return None


def _read_window(raw: str) -> Optional[Tuple[Optional[str], Optional[str]]]:
    """(valid_from, valid_to) from the "Testo in vigore" block, or None when unreadable."""
    opening = _find_div(raw, _VIGORE_WORD)
    if opening is None:
        return None
    end = raw.find("</div>", opening.end())
    if end < 0:
        return None
    text = " ".join(html.unescape(_TAG.sub(" ", raw[opening.end():end])).split())
    found = _WINDOW.search(text)
    if found is None:
        return None
    d1, m1, y1, d2, m2, y2 = found.groups()
    valid_from = _iso(d1, m1, y1) if d1 else None
    valid_to = _iso(d2, m2, y2) if d2 else None
    if (d1 and valid_from is None) or (d2 and valid_to is None):
        return None  # a date that is not a day: do not guess
    if valid_from is None and valid_to is None:
        return None
    return valid_from, valid_to


def _read_version_number(raw: str) -> Optional[int]:
    """`art.versione=N` of the update link; absent when the article was never amended."""
    at = raw.find("vediAggiornamentiAllArticolo")
    if at < 0:
        return None
    found = _VERSION.search(raw, at, at + 1200)
    return int(found.group(1)) if found else None


def _read_act_updated(raw: str) -> Optional[str]:
    found = _ACT_UPDATED.search(raw)
    return _iso(found.group(1), found.group(2), found.group(3)) if found else None


def _read_body(raw: str) -> Optional[Tag]:
    opening = _find_div(raw, _BODY_WORD)
    if opening is None:
        return None
    soup = BeautifulSoup(raw[opening.start():opening.start() + _BODY_SLICE], "html.parser")
    return soup.find("div", class_="bodyTesto")


def _is_abrogated(body: Tag) -> bool:
    """The article is repealed as a whole.

    Two ways, in this order. A notice that says "ARTICOLO ABROGATO" is decisive,
    whatever else sits in the body (a kept heading, note markers, the update notes).
    Otherwise the notice must be all that is left once the label, the update notes
    (`art_aggiornamento-akn`), their markers ("((178))") and punctuation are removed:
    a repealed article keeps its notes on the page, and they are not its text. A
    partial notice ("COMMA ABROGATO") leaves the other commi behind, so it is not
    this state. Consumes the notices and the notes: call it last.
    """
    notices = body.find_all(class_="art_abrogato-akn")
    if not notices:
        return False
    for notice in notices:
        if _WHOLE_ARTICLE_NOTICE.match(" ".join(notice.get_text(" ", strip=True).split())):
            return True
    for node in notices + body.find_all(class_="art_aggiornamento-akn"):
        node.extract()
    # Blanks are collapsed first: a long run of them is quadratic for the label pattern.
    text = " ".join(body.get_text(" ", strip=True).split())
    rest = _NOTE_REFERENCE.sub("", _UP_TO_LABEL.sub("", text, count=1))
    return not re.sub(r"[\W_]+", "", rest)


def _in_window(day: str, valid_from: Optional[str], valid_to: Optional[str]) -> bool:
    return (valid_from is None or valid_from <= day) and (valid_to is None or day <= valid_to)


def extract_validity(
    raw_html: str,
    *,
    article: Optional[str] = None,
    requested_date: Optional[str] = None,
    today: Optional[date] = None,
) -> Optional[Validity]:
    """The validity a Normattiva article page states for itself, or None.

    `article` is the article that was asked for. When given, the page must be
    that article: Normattiva answers HTTP 200 for a URN that names something
    else (the decree approving a code, when the code's annex is missing), and a
    window read off the wrong page would be worse than none. This cannot tell
    art. 1 of a code from art. 1 of its approving decree; the default annex the
    controller adds is what keeps the request off that page.

    `requested_date` is the day the reader asked for (ISO, or the Italian long
    form); it only feeds `request_in_window`.

    The state follows the window against `today` (default: today in Rome; tests
    pass a fixed day). `historical` means the window ended before today. A window
    that ends today or later is the text in force (a later version already
    published with a deferred start closes it in the future): it is `current`,
    and `valid_to` is kept as the source stated it. `not_yet` and `abrogated`
    are decided first and do not depend on the end date.
    """
    if not raw_html:
        return None
    window = _read_window(raw_html)
    body = _read_body(raw_html)
    if window is None or body is None:
        return None
    valid_from, valid_to = window

    text = body.get_text(" ", strip=True)
    if article:
        label = _LABEL.search(text[:400])
        if label is None or normalize_article_key(label.group(1)) != normalize_article_key(article):
            log.info("Validity not read: the page is not the article asked for",
                     asked=article, found=label.group(1) if label else None)
            return None

    if valid_from is None:
        # "al:" alone: the article did not exist yet on the requested day.
        if not (valid_to and _NOT_YET in text.lower()):
            return None
        state = "not_yet"
    elif _is_abrogated(body):
        state = "abrogated"
    elif valid_to is None or valid_to >= (today or _today_in_rome()).isoformat():
        state = "current"
    else:
        state = "historical"

    day = _iso_day(requested_date)
    validity: Validity = {
        "state": state,
        "valid_from": valid_from,
        "valid_to": valid_to,
        "version_number": _read_version_number(raw_html),
        "act_updated": _read_act_updated(raw_html),
        "request_in_window": _in_window(day, valid_from, valid_to) if day else None,
    }
    log.info("Validity read", state=state, valid_from=valid_from, valid_to=valid_to,
             version=validity["version_number"], request_in_window=validity["request_in_window"])
    return validity


async def read_validity(
    cache: Any,
    urn: Optional[str],
    *,
    article: Optional[str] = None,
    requested_date: Optional[str] = None,
) -> Optional[Validity]:
    """The validity of the page the scraper just fetched for `urn`, or None.

    Reads the raw page from the scraper's own persistent cache (key: the URN
    `get_document` returned), so no request is made. Never raises: a cache
    miss, a backend error or a page that cannot be read all mean "no validity".
    """
    if cache is None or not urn:
        return None
    try:
        raw = await cache.get(urn)
        if not isinstance(raw, str) or not raw:
            return None
        return await asyncio.to_thread(
            extract_validity, raw, article=article, requested_date=requested_date,
        )
    except Exception as exc:  # noqa: BLE001 - best effort by contract
        log.warning("Validity could not be read", error=str(exc), urn=str(urn)[:100])
        return None


def is_historical_request(version: Any, version_date: Any) -> bool:
    """Whether the request asks for a past text: the original, or a date.

    This is the request, not the page. It is what decides that Brocardi is not
    fetched: its commentary and massime carry no date.
    """
    if isinstance(version, str) and version.strip().lower() == "originale":
        return True
    return isinstance(version_date, str) and bool(version_date.strip())


def _today_in_rome() -> date:
    try:
        return datetime.now(ZoneInfo("Europe/Rome")).date()
    except ZoneInfoNotFoundError:
        # A slim image can lack the tz database. Use the latest offset Rome ever
        # has, so a valid date is never refused (one a couple of hours early may pass).
        return datetime.now(timezone(timedelta(hours=2))).date()


def reject_future_version_date(version_date: Any, today: Optional[date] = None) -> None:
    """Refuse a `version_date` later than today (Europe/Rome).

    Normattiva answers a future date with the current text and says nothing, so
    the reader would be shown today's text under a date it was not asked for.
    A value that is not a readable date is left to the existing parsing path.
    """
    day = _iso_day(version_date)
    if day is None:
        return
    if date.fromisoformat(day) > (today or _today_in_rome()):
        raise ValidationError(
            "version_date non può essere futura: Normattiva restituirebbe il testo attuale, "
            "non quello alla data richiesta"
        )
