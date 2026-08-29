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


async def _call_one(adapter: CaseLawAdapter, method: str, args: tuple,
                     limite: int) -> SourceResult:
    """Runs one adapter call under `_SOURCE_TIMEOUT`, translating both a raised
    exception and a timeout into the same `ok=False` shape the caller already
    expects from an adapter's own error handling — this is a second net, not
    the primary one (every adapter already catches its own exceptions)."""
    try:
        return await asyncio.wait_for(
            getattr(adapter, method)(*args, limite=limite), timeout=_SOURCE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        log.warning("Case-law adapter timed out", organo=adapter.organo,
                    timeout=_SOURCE_TIMEOUT)
        return SourceResult(
            organo=adapter.organo, ok=False,
            error=f"Timed out after {_SOURCE_TIMEOUT}s",
            coverage=getattr(adapter, "coverage", ""),
        )
    except Exception as exc:  # noqa: BLE001 — reported, never swallowed
        log.warning("Case-law adapter raised", organo=adapter.organo,
                    error=str(exc))
        return SourceResult(
            organo=adapter.organo, ok=False, error=str(exc),
            coverage=getattr(adapter, "coverage", ""),
        )


async def _fan_out(method: str, *args, limite: int) -> list[SourceResult]:
    adapters = list(ADAPTERS.values())
    results = await asyncio.gather(
        *(_call_one(a, method, args, limite) for a in adapters),
    )
    return list(results)


async def cerca_per_norma(riferimento: str, limite: int = 10) -> list[SourceResult]:
    return await _fan_out("cerca_per_norma", riferimento, limite=limite)


async def cerca_libera(testo: str, limite: int = 10) -> list[SourceResult]:
    return await _fan_out("cerca_libera", testo, limite=limite)


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
    """
    return await asyncio.wait_for(
        ADAPTERS[organo].leggi(numero, anno), timeout=_SOURCE_TIMEOUT,
    )
