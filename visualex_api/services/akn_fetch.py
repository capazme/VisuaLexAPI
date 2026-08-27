"""Fetch the article index of an act from Normattiva's Akoma Ntoso export.

Two requests, and the order matters: caricaAKN needs an act-specific session
cookie, so the act landing page must be fetched first on the same client. A cold
or generic session gets a ~32 KB HTML error page instead of XML.

What is cached is the INDEX — title, article keys, order, structure and the
rubriche — never the article texts. That is what keeps this cheap on a shared
server: the codice civile's index is a few hundred KB where its parsed text is
1.9 MB, and its XML is 10.6 MB. The texts are not cached because the reading
surface does not use them; see the module note in akn_parser.py.

The rubriche are why this is worth fetching for a browse at all: Normattiva's
article tree carries bare numbers, so an index built from it can only show
numbers. Measured coverage: 89% of the codice civile and codice penale, 98% of
L. 241/1990. The Costituzione yields none, correctly — its articles have no
rubriche.

Every failure path returns None and logs with context. The caller falls back to
the HTML path, which is the primary source.
"""
from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from datetime import date

import structlog

from ..tools.cache_manager import get_cache_manager
from ..tools.config import AKN_CACHE_MAX_ACTS, AKN_ENABLED
from .akn_parser import parse_akn
from .http_client import http_client

log = structlog.get_logger()

_CARICA_AKN_BASE = "https://www.normattiva.it/do/atto/caricaAKN"

# The cold error page is ~32 KB of HTML; the smallest real export is ~250 KB.
# Measured in characters, which is slightly stricter than bytes for accented text.
_MIN_XML_CHARS = 40000

_AKN_HREF_RE = re.compile(
    r"caricaAKN\?dataGU=(?P<dataGU>\d{8})&(?:amp;)?codiceRedaz=(?P<codice>[A-Z0-9]+)",
    re.IGNORECASE,
)
_ELI_LOCAL_RE = re.compile(r'eli:id_local"\s+content="(?P<codice>[A-Z0-9]+)"', re.IGNORECASE)
_DATA_PUB_RE = re.compile(r"dataPubblicazioneGazzetta=(\d{4})-(\d{2})-(\d{2})")


@dataclass
class AktIndex:
    """What an act's AKN export says about its own structure."""

    title: str
    keys: list[str] = field(default_factory=list)
    structure: str = "flat"
    parts: dict[str, list[str]] = field(default_factory=dict)
    codice_redaz: str = ""
    data_gu: str = ""
    # Article key -> rubrica, for the articles that have one. This is the whole
    # reason the index is worth fetching for a browse: Normattiva's article tree
    # carries bare numbers only. This map covers the DOMINANT part.
    rubriche: dict[str, str] = field(default_factory=dict)
    # Keys of the articles the act declares repealed, dominant part.
    abrogati: list[str] = field(default_factory=list)
    # Per-part breakdown. An act's annexes each have their own article 1, with
    # their own rubrica: art. 1 of the codice civile is "Capacità giuridica",
    # art. 1 of the preleggi is "Indicazione delle fonti", and art. 1 of the
    # Dispositivo is the enacting provision, which has no rubrica at all.
    # Serving only the dominant map made the index label all three with the
    # code body's titles. The caller matches a part to an annex by comparing
    # `keys` against the annex's article numbers.
    parts_detail: list[dict] = field(default_factory=list)


def akn_disabled() -> bool:
    """Read at call time so the switch can be flipped without a restart."""
    import os

    override = os.getenv("AKN_ENABLED")
    if override is not None:
        return override.strip().lower() in {"0", "false", "no"}
    return not AKN_ENABLED


_memory: dict[tuple[str, str, str], AktIndex] = {}
_inflight: dict[tuple[str, str, str], asyncio.Future] = {}


def clear_akn_cache() -> None:
    """Tests only."""
    _memory.clear()
    _inflight.clear()


def _today_vigenza() -> str:
    return date.today().strftime("%Y%m%d")


def _extract_params(html: str) -> tuple[str, str] | None:
    """(codiceRedaz, dataGU) from the act landing page, or None."""
    match = _AKN_HREF_RE.search(html)
    if match:
        return match.group("codice"), match.group("dataGU")

    codice_match = _ELI_LOCAL_RE.search(html)
    data_match = _DATA_PUB_RE.search(html)
    if codice_match and data_match:
        return codice_match.group("codice"), "".join(data_match.groups())
    return None


def _to_index(act, codice: str, data_gu: str) -> AktIndex:
    return AktIndex(
        title=act.title,
        keys=list(act.order),
        structure=act.structure,
        parts={name: list(part.order) for name, part in act.parts.items()},
        codice_redaz=codice,
        data_gu=data_gu,
        rubriche=act.rubriche(),
        abrogati=act.abrogati(),
        parts_detail=[
            {
                "name": name,
                "keys": list(part.order),
                "rubriche": act.rubriche(name),
                "abrogati": act.abrogati(name),
            }
            for name, part in act.parts.items()
        ],
    )


async def _fetch_and_parse(norma, data_vigenza: str) -> AktIndex | None:
    act_url = norma.url
    if not act_url:
        log.warning("AKN skipped: no act URL", norma=str(norma))
        return None

    try:
        landing = await http_client.request("GET", act_url, source="normattiva")
    except Exception as exc:  # noqa: BLE001 - AKN is a fallback; never fail the request
        log.warning("AKN landing page failed", norma=str(norma), error=str(exc))
        return None

    params = _extract_params(landing.text)
    if params is None:
        log.warning("AKN export params not found on landing page",
                    norma=str(norma), url=act_url[:100])
        return None

    codice, data_gu = params
    export_url = (f"{_CARICA_AKN_BASE}?dataGU={data_gu}"
                  f"&codiceRedaz={codice}&dataVigenza={data_vigenza}")
    try:
        export = await http_client.request("GET", export_url, source="normattiva")
    except Exception as exc:  # noqa: BLE001
        log.warning("AKN export request failed", norma=str(norma), error=str(exc))
        return None

    xml = export.text
    if not xml.lstrip().startswith("<?xml"):
        log.warning("AKN export was not XML (cold session?)",
                    norma=str(norma), length=len(xml))
        return None
    if len(xml) < _MIN_XML_CHARS:
        log.warning("AKN export too short to be a real act",
                    norma=str(norma), length=len(xml))
        return None

    # Parsing a 10.6 MB export takes ~250 ms of CPU. On Quart that would stall
    # every concurrent request (CLAUDE.md gotcha 2).
    act = await asyncio.to_thread(parse_akn, xml)
    if not act.article_count:
        log.warning("AKN export parsed to zero articles", norma=str(norma))
        return None

    return _to_index(act, codice, data_gu)


async def fetch_act_index(norma, data_vigenza: str | None = None) -> AktIndex | None:
    """The act's article index from the AKN export, or None on any failure.

    `norma.url` must be the ARTICLE-FREE act URL: the cache and the session both
    key off the act, and an article-level URL would defeat both.
    """
    if akn_disabled():
        return None

    data_vigenza = data_vigenza or _today_vigenza()
    act_url = getattr(norma, "url", "") or ""
    key = (act_url, data_vigenza, "index")

    cached = _memory.get(key)
    if cached is not None:
        return cached

    persistent = get_cache_manager().get_persistent("akn")
    stored = await persistent.get(f"{act_url}|{data_vigenza}")
    if stored:
        index = AktIndex(**stored)
        _memory[key] = index
        return index

    # Single flight: the codice civile is 10.6 MB. Without this, N concurrent
    # cold requests each download and parse it independently.
    inflight = _inflight.get(key)
    if inflight is not None:
        # Shielded on purpose. A follower whose own task is cancelled — a client
        # disconnect or a request timeout, routine on a shared server — would
        # otherwise cancel the shared future, and the leader's set_result would
        # then raise InvalidStateError into a request that was perfectly fine.
        return await asyncio.shield(inflight)

    loop = asyncio.get_running_loop()
    future: asyncio.Future = loop.create_future()
    _inflight[key] = future
    try:
        index = await _fetch_and_parse(norma, data_vigenza)
        if index is not None:
            _memory[key] = index
            while len(_memory) > AKN_CACHE_MAX_ACTS:
                _memory.pop(next(iter(_memory)))
            await persistent.set(f"{act_url}|{data_vigenza}", index.__dict__)
        if not future.done():
            future.set_result(index)
        return index
    except asyncio.CancelledError:
        # CancelledError is a BaseException, so the handler below never sees it.
        # Without this the followers would await a future nobody ever resolves.
        if not future.done():
            future.set_result(None)
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("AKN index fetch failed", norma=str(norma), error=str(exc))
        if not future.done():
            future.set_result(None)
        return None
    finally:
        _inflight.pop(key, None)


async def fetch_act_article(norma, article: str, data_vigenza: str | None = None) -> str | None:
    """One article's AKN text — the LAST-RESORT fallback when HTML extraction fails.

    Deliberately uncached and deliberately not the normal path: this text
    transliterates accents ("attivita'") and carries a markdown heading, so it
    differs from every stored highlight's offset space. The caller must mark the
    response `source="normattiva-akn"` so the surface can say where it came from.
    """
    if akn_disabled():
        return None

    index = await fetch_act_index(norma, data_vigenza)
    if index is None:
        return None

    data_vigenza = data_vigenza or _today_vigenza()
    export_url = (f"{_CARICA_AKN_BASE}?dataGU={index.data_gu}"
                  f"&codiceRedaz={index.codice_redaz}&dataVigenza={data_vigenza}")
    try:
        export = await http_client.request("GET", export_url, source="normattiva")
        act = await asyncio.to_thread(parse_akn, export.text)
    except Exception as exc:  # noqa: BLE001
        log.warning("AKN article fallback failed",
                    norma=str(norma), article=article, error=str(exc))
        return None

    return act.article(article)
