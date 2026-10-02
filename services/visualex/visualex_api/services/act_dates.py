# services/visualex/visualex_api/services/act_dates.py
"""Completes the date of acts cited by year only (`urn:nir:stato:legge:1983;184`).

The Massimario portal links acts the way Normattiva resolves them, often with
the year alone; the graph and VisuaLex key acts by their full date. Normattiva's
resolver answers a year-only URN with the act's page, whose title carries the
type, the date and the number ("LEGGE 4 maggio 1983, n. 184 - Normattiva"). One
plain request per act: no browser, unlike `complete_date` in urngenerator, which
drives Playwright.

The resolver does not check what it is asked: a regional law's URN comes back
as the page of the State's act with the same year and number. So only State
acts of a kind in `_TITLES` are resolved, and the date is read from the title
only when its type, year and number are all the URN's. A found date is cached
for a year (dates do not change); a miss is not cached, since it may be a
transient error page.
"""
from __future__ import annotations

import html
import re
import time
from datetime import date
from typing import Optional

import structlog

from ..tools.cache_manager import get_cache_manager
from ..tools.exceptions import DocumentNotFoundError, NetworkError, ValidationError
from .http_client import http_client
from .massimario_portal import USER_AGENT

log = structlog.get_logger()

RESOLVER = "https://www.normattiva.it/uri-res/N2Ls?"
MAX_URNS = 20
# The caller (MERL-T) waits at most 180 s for a batch: stop starting new requests at 120.
BATCH_BUDGET = 120.0
_YEAR_ONLY = re.compile(r"urn:nir:([a-z.]{1,60}):([a-z.]{1,60}):([0-9]{4});([0-9]{1,6})", re.ASCII)
_MESI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
# The URN's kind -> the type a Normattiva page title opens with. Any other kind is not resolved.
_TITLES = {
    "legge": "LEGGE",
    "decreto.legislativo": "DECRETO LEGISLATIVO",
    "decreto.legge": "DECRETO-LEGGE",
    "decreto.del.presidente.della.repubblica": "DECRETO DEL PRESIDENTE DELLA REPUBBLICA",
    "regio.decreto": "REGIO DECRETO",
    "regio.decreto.legge": "REGIO DECRETO-LEGGE",
    "regio.decreto.legislativo": "REGIO DECRETO LEGISLATIVO",
    "legge.costituzionale": "LEGGE COSTITUZIONALE",
    "decreto": "DECRETO",
}
# Bounded on both sides, so a hostile page costs a constant per "<title", not a rescan of the rest.
_TITLE_TAG = re.compile(r"<title[^>]{0,200}>([^<]{0,400})</title>", re.IGNORECASE)
# The type is followed by a space and the day's digit: "DECRETO" never matches
# "DECRETO LEGISLATIVO ..." and "LEGGE" never matches "LEGGE COSTITUZIONALE ...".
_TITLE_DATE = {
    kind: re.compile(
        re.escape(title_type)
        + r" ([0-9]{1,2})[º°]? ((?i:" + "|".join(_MESI) + r")) ([0-9]{4}), n\. ([0-9]{1,6})\b"
    )
    for kind, title_type in _TITLES.items()
}


def date_from_title(page: str, kind: str, year: str, number: str) -> Optional[str]:
    """The ISO date in the page's title, when it names the act of that kind, year and number."""
    pattern = _TITLE_DATE.get(kind)
    tag = _TITLE_TAG.search(page)
    if pattern is None or tag is None:
        return None
    title = " ".join(html.unescape(tag.group(1)).split())
    found = pattern.match(title)
    if found is None:
        return None
    day, month, found_year, found_number = found.groups()
    if int(found_year) != int(year) or int(found_number) != int(number):
        return None
    try:
        return date(int(found_year), _MESI[month.lower()], int(day)).isoformat()
    except ValueError:
        return None


async def _resolve_one(urn: str) -> Optional[str]:
    authority, kind, year, number = _YEAR_ONLY.fullmatch(urn).groups()
    if authority != "stato" or kind not in _TITLES:
        log.info("act_dates.not_resolvable", urn=urn)
        return None
    cache = get_cache_manager().get_persistent("act_dates")
    cached = await cache.get(urn)
    if cached:
        return cached
    try:
        result = await http_client.request(
            "GET", RESOLVER + urn, source="normattiva", headers={"User-Agent": USER_AGENT}
        )
    except DocumentNotFoundError:
        return None
    found = date_from_title(result.text, kind, year, number)
    if found is None:
        log.info("act_dates.not_found", urn=urn)
        return None
    full = f"urn:nir:{authority}:{kind}:{found};{int(number)}"
    await cache.set(urn, full)
    return full


async def resolve_many(urns) -> dict[str, Optional[str]]:
    """Validate every URN first, then resolve them one by one (the client paces requests).

    An act that cannot be resolved is None, never an error: a network failure on
    one act leaves the others, and past BATCH_BUDGET seconds the rest are None
    without a request.
    """
    if not isinstance(urns, list) or not urns:
        raise ValidationError("urns: attesa una lista non vuota")
    if len(urns) > MAX_URNS:
        raise ValidationError(f"urns: al massimo {MAX_URNS} per richiesta")
    for urn in urns:
        if not isinstance(urn, str) or not _YEAR_ONLY.fullmatch(urn):
            raise ValidationError(
                "urns: atteso urn:nir:<autorità>:<tipo>:<anno>;<numero>, senza data completa né articolo"
            )
    started = time.monotonic()
    resolved: dict[str, Optional[str]] = {}
    for urn in dict.fromkeys(urns):
        if time.monotonic() - started >= BATCH_BUDGET:
            log.warning("act_dates.budget_spent", urn=urn, budget=BATCH_BUDGET)
            resolved[urn] = None
            continue
        try:
            resolved[urn] = await _resolve_one(urn)
        except NetworkError as exc:
            log.warning("act_dates.network_error", urn=urn, status=exc.status_code, error=str(exc))
            resolved[urn] = None
    return resolved
