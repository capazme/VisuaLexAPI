"""One reference in, one outcome out (design 2026-10-01 §2-§3).

Lookups are cached per archive, and the answer is composed from them: caching a composed
answer would hide a homonym deposited later in the other archive. Errors are never cached,
and a source that cannot be reached is never reported as "not found". A decision found
without its text is kept for a day and says so in its notices; why it has none travels in its
attributes (`testo_assente`), and only when the source said so.
"""
from __future__ import annotations

import asyncio
import re
import zipfile
import zlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import structlog

from ...tools.cache_manager import get_cache_manager
from ...tools.config import PERSISTENT_CACHE_DIR
from ...tools.exceptions import DocumentNotFoundError, NetworkError
from ...tools.tls import IntermediateCertificateMismatch
from .corte_cost import CorteCostReader
from .italgiure import ItalgiureReader, SourceAnswerError
from .model import Decision, Identity, Reference

log = structlog.get_logger()

ITALGIURE_TIMEOUT = 25.0
CORTE_COST_TIMEOUT = 240.0  # covers the first download of a bundle
FOUND_NS, ABSENT_NS, PENDING_NS = "decisions_found", "decisions_absent", "decisions_pending"
DECISION_CACHE_SWEEP_SECONDS = 6 * 3600
_SOURCE_ERRORS = (NetworkError, DocumentNotFoundError, asyncio.TimeoutError, ValueError,
                  zipfile.BadZipFile, zlib.error, EOFError, SourceAnswerError,
                  IntermediateCertificateMismatch, OSError)
_CITATA = re.compile(r"[\w .\-/]+")
_CITATA_MAX = 20


class SourceUnavailable(Exception):
    def __init__(self, fonte: str, detail: str = ""):
        super().__init__(f"{fonte} non raggiungibile: {detail}")
        self.fonte = fonte


@dataclass
class Outcome:
    esito: str                                  # trovata | ambigua | non_trovata
    decisione: Decision | None = None
    candidati: list[Decision] = field(default_factory=list)
    avvisi: list[dict[str, str]] = field(default_factory=list)
    motivo: str | None = None                   # inesistente | fuori_archivio | anno_parziale
    archivio_dal: str | None = None
    suggerimento: Identity | None = None

    def to_dict(self) -> dict[str, Any]:
        if self.esito == "trovata":
            return {"esito": "trovata", **self.decisione.to_dict(), "avvisi": self.avvisi}
        if self.esito == "ambigua":
            return {"esito": "ambigua", "candidati": [
                {"identita": c.identita.to_dict(), "attributi": c.to_dict()["attributi"]}
                for c in self.candidati]}
        out: dict[str, Any] = {"esito": "non_trovata", "motivo": self.motivo}
        if self.archivio_dal:
            out["archivio_dal"] = self.archivio_dal
        if self.suggerimento:
            out["suggerimento"] = self.suggerimento.to_dict()
        return out


def _withheld(decision: Decision) -> list[dict[str, str]]:
    """The notice for a decision that came without its text: the page says so instead of
    showing an empty text, and reads why from `attributi.testo_assente`, set only when the
    source said so."""
    return [] if decision.testo else [{"tipo": "testo_non_disponibile"}]


def _citata(raw: str | None) -> str | None:
    """The section as cited, when it can be echoed in a notice: short, and only the characters
    a section is written with. The page builds the request from a shareable address, so
    anything else would let a crafted link put its own text inside a VisuaLex notice."""
    if raw is not None and len(raw) <= _CITATA_MAX and _CITATA.fullmatch(raw):
        return raw
    return None


class Resolver:
    def __init__(self, italgiure, corte_cost, cache=None,
                 today: Callable[[], date] = date.today):
        self.italgiure, self.corte_cost, self.today = italgiure, corte_cost, today
        manager = cache or get_cache_manager()
        self.found = manager.get_persistent(FOUND_NS)
        self.absent = manager.get_persistent(ABSENT_NS)
        self.pending = manager.get_persistent(PENDING_NS)
        self._starts: dict[tuple[str, date], tuple[int, str] | None] = {}

    async def _lookup(self, key: str, fonte: str, timeout: float,
                      call: Callable[[], Awaitable[Decision | None]]) -> Decision | None:
        cached = await self.found.get(key)
        if cached is None:
            cached = await self.pending.get(key)
        if cached is not None:
            return Decision.from_dict(cached)
        if await self.absent.get(key) is not None:
            return None
        try:
            decision = await asyncio.wait_for(call(), timeout)
        except _SOURCE_ERRORS as exc:
            log.warning("Decision source failed", fonte=fonte, key=key, error=str(exc),
                        error_type=type(exc).__name__)
            raise SourceUnavailable(fonte, str(exc)) from exc
        if decision is None:
            await self.absent.set(key, True)
        elif decision.testo:
            await self.found.set(key, decision.to_dict())
        else:
            # found without its text (the source withholds it while personal data are
            # removed, or the record lacks it): kept for a day, not a month, so the text shows
            # up once the source releases it
            await self.pending.set(key, decision.to_dict())
        return decision

    def _cass(self, archivio: str, numero: int, anno: int) -> Awaitable[Decision | None]:
        return self._lookup(f"italgiure:{archivio}:{numero}:{anno}", "cassazione",
                            ITALGIURE_TIMEOUT,
                            lambda: self.italgiure.lookup(archivio, numero, anno))

    async def _start(self, archivio: str) -> tuple[int, str] | None:
        key = (archivio, self.today())
        if key not in self._starts:
            try:
                start = await asyncio.wait_for(
                    self.italgiure.archive_start(archivio), ITALGIURE_TIMEOUT)
            except _SOURCE_ERRORS as exc:
                log.warning("Italgiure archive start unknown", archivio=archivio,
                            error=str(exc))
                return None  # not cached: tried again on the next miss
            if start is None:
                return None  # unreadable: not kept either
            self._starts[key] = start
        return self._starts[key]

    async def resolve(self, ref: Reference) -> Outcome:
        if ref.corte == "corte_costituzionale":
            # v2 since the reader splits an epigrafe that holds the reasoning (2026-10-04): the
            # entries cached before, under "corte_cost:<numero>:<anno>", keep it unsplit for up
            # to 30 days, and a new key never serves them (the sweep deletes them once expired).
            # Raise the version whenever the reader changes the shape of what it returns.
            decision = await self._lookup(
                f"corte_cost:v2:{ref.numero}:{ref.anno}", "corte_costituzionale",
                CORTE_COST_TIMEOUT, lambda: self.corte_cost.lookup(ref.numero, ref.anno))
            if decision is None:
                return Outcome("non_trovata", motivo="inesistente")
            return Outcome("trovata", decisione=decision, avvisi=_withheld(decision))

        archivi = [ref.archivio] if ref.archivio else ["civile", "penale"]
        # one archive after the other: the client throttles anyway, and a failure leaves no
        # orphan request behind
        hits = []
        for archivio in archivi:
            decision = await self._cass(archivio, ref.numero, ref.anno)
            if decision:
                hits.append(decision)
        avvisi: list[dict[str, str]] = []
        citata = _citata(ref.sezione.raw)
        echo = {"citata": citata} if citata is not None else {}
        if ref.sezione.raw and not ref.sezione.recognised:
            avvisi.append({"tipo": "sezione_non_riconosciuta", **echo})
        if len(hits) == 2:
            matching = [d for d in hits if ref.sezione.code and d.sezione == ref.sezione.code]
            if len(matching) != 1:
                return Outcome("ambigua", candidati=hits)
            chosen = matching[0]
            avvisi.append({"tipo": "archivio_dedotto", "archivio": chosen.identita.archivio,
                           "sezione": chosen.sezione})
            avvisi += _withheld(chosen)
            return Outcome("trovata", decisione=chosen, avvisi=avvisi)
        if len(hits) == 1:
            decision = hits[0]
            if ref.sezione.code and decision.sezione and decision.sezione != ref.sezione.code:
                avvisi.append({"tipo": "sezione_diversa", **echo, "effettiva": decision.sezione})
            avvisi += _withheld(decision)
            return Outcome("trovata", decisione=decision, avvisi=avvisi)
        return await self._not_found(ref, archivi)

    async def _not_found(self, ref: Reference, archivi: list[str]) -> Outcome:
        starts = [s for s in [await self._start(a) for a in archivi] if s]
        if starts:
            # the later start: before it, at least one searched archive is incomplete
            year, iso = max(starts, key=lambda s: s[1])
        else:
            year, iso = self.today().year - 5, None  # the window, when the probe failed
        if ref.anno < year:
            motivo = "fuori_archivio"
        elif ref.anno == year:
            motivo = "anno_parziale"
        else:
            motivo, iso = "inesistente", None
        suggestion = None
        if "penale" in archivi and ref.anno < self.today().year:
            try:
                # a penal number belongs to the year of deposit: a December hearing is
                # deposited the next year
                hit = await self._cass("penale", ref.numero, ref.anno + 1)
                suggestion = hit.identita if hit else None
            except SourceUnavailable:
                suggestion = None  # the answer stands without its suggestion
        return Outcome("non_trovata", motivo=motivo, archivio_dal=iso, suggerimento=suggestion)


async def sweep_decision_caches(manager=None) -> int:
    """Delete the expired entries of the three decision caches and return how many went.

    The filesystem cache deletes an expired entry only when its key is read again: without
    a sweep, `decisions_found` would keep whole texts (with whatever personal data the source
    left) and `decisions_absent` a file per number ever missed, on disk for good. A backend
    without `sweep_expired` (Redis) expires its keys itself. The app runs this at start and
    every DECISION_CACHE_SWEEP_SECONDS.
    """
    manager = manager or get_cache_manager()
    removed = 0
    for namespace in (FOUND_NS, ABSENT_NS, PENDING_NS):
        sweep = getattr(manager.get_persistent(namespace), "sweep_expired", None)
        if sweep is not None:
            removed += await asyncio.to_thread(sweep)
    log.info("Decision caches swept", removed=removed)
    return removed


_resolver: Resolver | None = None


def get_resolver() -> Resolver:
    global _resolver
    if _resolver is None:
        _resolver = Resolver(ItalgiureReader(),
                             CorteCostReader(Path(PERSISTENT_CACHE_DIR) / "corte_cost"))
    return _resolver
