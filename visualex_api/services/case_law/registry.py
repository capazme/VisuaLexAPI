"""Fans a question out to every source and keeps their failures apart.

`asyncio.gather(..., return_exceptions=True)`: one source raising must not lose
the others' answers, and a source that failed comes back as `ok=False` rather
than as an absence. A missing section and an empty section look identical to a
reader, and only one of them means "there is nothing here".

Each call is also bounded by `_SOURCE_TIMEOUT`. These are four external
government websites reached over the network on every request; without a
per-source ceiling, one of them hanging would stall the whole fan-out — and
the user-facing request behind it — with no upper bound. A timeout is just
another way a source can fail, so it surfaces the same way: `ok=False` with an
error naming the timeout, never a silent empty success (which would read to
the user as "this court has nothing on your article").
"""
from __future__ import annotations

import asyncio

import structlog

from .base import CaseLawAdapter, Decisione, SourceResult
from .cellar import CellarAdapter
from .cerdef import CerdefAdapter
from .giustizia_amm import GiustiziaAmmAdapter
from .italgiure import ItalgiureAdapter

log = structlog.get_logger()

ADAPTERS: dict[str, CaseLawAdapter] = {
    "cgue": CellarAdapter(),
    "cassazione": ItalgiureAdapter(),
    "cerdef": CerdefAdapter(),
    "giustizia-amm": GiustiziaAmmAdapter(),
}

#: Recon showed every live source answering in well under ten seconds, CeRDEF
#: the slowest at roughly three. 10s leaves headroom for a normal slow
#: response while still bounding the worst case for a user-facing request.
_SOURCE_TIMEOUT = 10.0


async def _call_one(key: str, adapter: CaseLawAdapter, method: str, args: tuple,
                     limite: int) -> SourceResult:
    """Runs one adapter call under `_SOURCE_TIMEOUT`, translating both a raised
    exception and a timeout into the same `ok=False` shape the caller already
    expects from an adapter's own error handling — this is a second net, not
    the primary one (every adapter already catches its own exceptions).

    `key` is the `ADAPTERS` dict key this adapter is registered under. It is
    stamped onto the result (and every `Decisione` inside it) here, at the one
    place that actually knows the mapping, rather than duplicated as an
    attribute on each adapter class — an adapter itself has no reason to know
    which key it was registered under, and a value copied into four files
    would eventually drift from the dict that is the actual source of truth.
    """
    try:
        result = await asyncio.wait_for(
            getattr(adapter, method)(*args, limite=limite), timeout=_SOURCE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        log.warning("Case-law adapter timed out", organo=adapter.organo,
                    timeout=_SOURCE_TIMEOUT)
        result = SourceResult(
            organo=adapter.organo, ok=False,
            error=f"Timed out after {_SOURCE_TIMEOUT}s",
            coverage=getattr(adapter, "coverage", ""),
        )
    except Exception as exc:  # noqa: BLE001 — reported, never swallowed
        log.warning("Case-law adapter raised", organo=adapter.organo,
                    error=str(exc))
        result = SourceResult(
            organo=adapter.organo, ok=False, error=str(exc),
            coverage=getattr(adapter, "coverage", ""),
        )
    result.fonte = key
    for decisione in result.decisioni:
        decisione.fonte = key
    return result


async def _fan_out(method: str, *args, limite: int) -> list[SourceResult]:
    results = await asyncio.gather(
        *(_call_one(key, adapter, method, args, limite)
          for key, adapter in ADAPTERS.items()),
    )
    return list(results)


async def cerca_per_norma(riferimento: str, limite: int = 10) -> list[SourceResult]:
    return await _fan_out("cerca_per_norma", riferimento, limite=limite)


async def cerca_libera(testo: str, limite: int = 10) -> list[SourceResult]:
    return await _fan_out("cerca_libera", testo, limite=limite)


def _resolve_key(organo: str) -> str:
    """Resolve a client-supplied `organo` to an `ADAPTERS` key, tolerant of
    case and of the human-readable label a client reads off `SourceResult.
    organo` / `Decisione.organo` in `/fetch_case_law`.

    The keys ("cgue", "cassazione", "cerdef", "giustizia-amm") and the labels
    ("CGUE", "Cassazione", "CeRDEF", "Giustizia amministrativa") are not the
    same strings — three happen to fold to the same value once lower-cased,
    "giustizia-amm" does not — so this checks both, not just the key
    case-folded. Raises `KeyError(organo)` for anything that matches neither,
    mirroring plain dict indexing so callers (the `/fetch_decision` handler)
    keep treating it as a 400 without a second except clause.
    """
    normalized = organo.strip().lower()
    if normalized in ADAPTERS:
        return normalized
    for key, adapter in ADAPTERS.items():
        if adapter.organo.strip().lower() == normalized:
            return key
    raise KeyError(organo)


async def leggi(organo: str, numero: str, anno: int) -> Decisione | None:
    """Raises `KeyError` for an unknown source and `asyncio.TimeoutError` if
    the source does not answer within `_SOURCE_TIMEOUT` — the caller turns
    both into an HTTP error (400 for the former, 504/503 for the latter). Not
    routed through `_fan_out`: this targets exactly one source, so there is
    nothing to fan out to and no other source's result to preserve. The
    timeout is bounded the same way the fan-out is, for the same reason: the
    shared HTTP client's own retry budget runs to roughly 150s, and
    `CerdefAdapter.leggi` makes several calls internally, so an unwrapped
    await here could leave a lawyer waiting nearly three minutes for a
    single decision.

    A timeout here is deliberately NOT swallowed into `None` — this
    signature's `None` already means "not found", and telling the caller
    "we could not reach the source in time" is a different and worse claim
    than "the decision does not exist". Letting `asyncio.TimeoutError`
    propagate keeps those two outcomes distinguishable.

    `organo` is resolved through `_resolve_key` — case-insensitive, and
    tolerant of the display label — but the `Decisione.fonte` this returns is
    always the canonical key, never an echo of whatever the caller sent.
    """
    key = _resolve_key(organo)
    decisione = await asyncio.wait_for(
        ADAPTERS[key].leggi(numero, anno), timeout=_SOURCE_TIMEOUT,
    )
    if decisione is not None:
        decisione.fonte = key
    return decisione
