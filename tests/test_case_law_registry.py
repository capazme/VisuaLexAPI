import asyncio

import pytest

from visualex_api.services.case_law import registry
from visualex_api.services.case_law.base import Decisione, LinkKind, SourceResult


class _Adapter:
    def __init__(self, organo, ok=True, boom=False):
        self.organo, self._ok, self._boom = organo, ok, boom
        self.coverage = ""

    async def cerca_per_norma(self, riferimento, limite=10):
        if self._boom:
            raise RuntimeError("adapter exploded")
        return SourceResult(
            organo=self.organo, ok=self._ok,
            decisioni=[Decisione(organo=self.organo, numero="1", anno=2024,
                                 link_kind=LinkKind.MATCHED, url="u")],
        )

    async def cerca_libera(self, testo, limite=10):
        return await self.cerca_per_norma(testo, limite)

    async def leggi(self, numero, anno):
        return None


class _HangingAdapter:
    """Sleeps far longer than the (patched, short) timeout — never a real
    ten-second wait in the test suite."""

    def __init__(self, organo, sleep):
        self.organo = organo
        self.coverage = "covers everything, eventually"
        self._sleep = sleep

    async def cerca_per_norma(self, riferimento, limite=10):
        await asyncio.sleep(self._sleep)
        return SourceResult(organo=self.organo, ok=True)

    async def cerca_libera(self, testo, limite=10):
        return await self.cerca_per_norma(testo, limite)

    async def leggi(self, numero, anno):
        return None


async def test_one_dead_source_does_not_empty_the_others(monkeypatch):
    """The whole point of returning per-source results: a source that is down
    must cost its own section, not the panel."""
    monkeypatch.setattr(registry, "ADAPTERS", {
        "vivo": _Adapter("vivo"),
        "morto": _Adapter("morto", boom=True),
    })
    results = await registry.cerca_per_norma("art. 2043 c.c.")

    per_organo = {r.organo: r for r in results}
    assert per_organo["vivo"].ok is True
    assert len(per_organo["vivo"].decisioni) == 1
    assert per_organo["morto"].ok is False
    assert "adapter exploded" in per_organo["morto"].error


async def test_every_source_is_represented_even_when_empty(monkeypatch):
    """A source missing from the response is indistinguishable from a source
    with nothing to say. Both must appear."""
    monkeypatch.setattr(registry, "ADAPTERS", {
        "a": _Adapter("a"), "b": _Adapter("b", boom=True),
    })
    results = await registry.cerca_per_norma("x")
    assert {r.organo for r in results} == {"a", "b"}


async def test_lookup_targets_one_source(monkeypatch):
    monkeypatch.setattr(registry, "ADAPTERS", {"a": _Adapter("a")})
    assert await registry.leggi("a", "1", 2024) is None
    with pytest.raises(KeyError):
        await registry.leggi("inesistente", "1", 2024)


async def test_a_hanging_source_times_out_without_stalling_the_others(monkeypatch):
    """A source that never answers must not block the whole fan-out. It costs
    its own `ok=False` section — never an empty success, which would read as
    "this court has nothing on your article"."""
    monkeypatch.setattr(registry, "_SOURCE_TIMEOUT", 0.05)
    monkeypatch.setattr(registry, "ADAPTERS", {
        "vivo": _Adapter("vivo"),
        "lento": _HangingAdapter("lento", sleep=1.0),
    })

    results = await registry.cerca_per_norma("art. 2043 c.c.")

    per_organo = {r.organo: r for r in results}
    assert per_organo["vivo"].ok is True
    assert len(per_organo["vivo"].decisioni) == 1
    assert per_organo["lento"].ok is False
    assert "timed out" in per_organo["lento"].error.lower()
    assert per_organo["lento"].coverage == "covers everything, eventually"
