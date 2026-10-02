# services/visualex/visualex_api/services/act_dates.py
"""Completes the date of acts cited by year only (`urn:nir:stato:legge:1983;184`).

The Massimario portal links acts the way Normattiva resolves them, often with
the year alone; the graph and VisuaLex key acts by their full date. Normattiva's
resolver answers a year-only URN with the act's page, whose title carries the
date ("LEGGE 4 maggio 1983, n. 184"). One plain request per act: no browser,
unlike `complete_date` in urngenerator, which drives Playwright. A found date is
cached for a year (dates do not change); a miss is not cached, since it may be a
transient error page.
"""
from __future__ import annotations

import re
from typing import Optional

import structlog

from ..tools.cache_manager import get_cache_manager
from ..tools.exceptions import DocumentNotFoundError, ValidationError
from .http_client import http_client
from .massimario_portal import USER_AGENT

log = structlog.get_logger()

RESOLVER = "https://www.normattiva.it/uri-res/N2Ls?"
MAX_URNS = 20
_YEAR_ONLY = re.compile(r"urn:nir:([a-z.]{1,60}):([a-z.]{1,60}):([0-9]{4});([0-9]{1,6})", re.ASCII)
_MESI = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
_TITLE_DATE = re.compile(
    r"\b([0-9]{1,2})[º°]?\s+(" + "|".join(_MESI) + r")\s+([0-9]{4}),\s*n\.\s*([0-9]{1,6})\b",
    re.IGNORECASE,
)


def date_from_page(page: str, year: str, number: str) -> Optional[str]:
    """The ISO date in the act's title, when its year and number match the URN's."""
    for day, month, found_year, found_number in _TITLE_DATE.findall(page):
        if found_year == year and found_number.lstrip("0") == number.lstrip("0"):
            return f"{found_year}-{_MESI[month.lower()]:02d}-{int(day):02d}"
    return None


async def _resolve_one(urn: str) -> Optional[str]:
    cache = get_cache_manager().get_persistent("act_dates")
    cached = await cache.get(urn)
    if cached:
        return cached
    authority, kind, year, number = _YEAR_ONLY.fullmatch(urn).groups()
    try:
        result = await http_client.request(
            "GET", RESOLVER + urn, source="normattiva", headers={"User-Agent": USER_AGENT}
        )
    except DocumentNotFoundError:
        return None
    date = date_from_page(result.text, year, number)
    if date is None:
        log.info("act_dates.not_found", urn=urn)
        return None
    full = f"urn:nir:{authority}:{kind}:{date};{number}"
    await cache.set(urn, full)
    return full


async def resolve_many(urns) -> dict[str, Optional[str]]:
    """Validate every URN first, then resolve them one by one (the client paces requests)."""
    if not isinstance(urns, list) or not urns:
        raise ValidationError("urns: attesa una lista non vuota")
    if len(urns) > MAX_URNS:
        raise ValidationError(f"urns: al massimo {MAX_URNS} per richiesta")
    for urn in urns:
        if not isinstance(urn, str) or not _YEAR_ONLY.fullmatch(urn):
            raise ValidationError(
                "urns: atteso urn:nir:<autorità>:<tipo>:<anno>;<numero>, senza data completa né articolo"
            )
    return {urn: await _resolve_one(urn) for urn in dict.fromkeys(urns)}
