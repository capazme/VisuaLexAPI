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
        await asyncio.sleep(self._sleep)
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


async def test_leggi_propagates_timeout_instead_of_claiming_not_found(monkeypatch):
    """`leggi()` has no fan-out to fall back on, so a hanging source must not
    be swallowed into `None` — that already means "not found", a different
    and worse claim than "we could not reach the source in time". The caller
    (Task 8's HTTP layer) is expected to catch `asyncio.TimeoutError` and map
    it to a 504/503, not to receive a plain `None`."""
    monkeypatch.setattr(registry, "_SOURCE_TIMEOUT", 0.05)
    monkeypatch.setattr(registry, "ADAPTERS", {
        "lento": _HangingAdapter("lento", sleep=1.0),
    })

    with pytest.raises(asyncio.TimeoutError):
        await registry.leggi("lento", "1", 2024)


class _LookupAdapter:
    """Like `_Adapter`, but `leggi()` answers a real `Decisione` instead of
    always `None` — needed to assert what the registry stamps onto it."""

    def __init__(self, organo):
        self.organo = organo
        self.coverage = ""

    async def cerca_per_norma(self, riferimento, limite=10):
        return SourceResult(
            organo=self.organo, ok=True,
            decisioni=[Decisione(organo=self.organo, numero="1", anno=2024,
                                 link_kind=LinkKind.MATCHED, url="u")],
        )

    async def cerca_libera(self, testo, limite=10):
        return await self.cerca_per_norma(testo, limite)

    async def leggi(self, numero, anno):
        return Decisione(organo=self.organo, numero=numero, anno=anno,
                         link_kind=LinkKind.MATCHED, url="u")


class TestFonteKey:
    """FIX 1: the key a client reads back from `/fetch_case_law` must be the
    key `/fetch_decision` accepts. This is the registry-level half of that
    contract — `tests/test_case_law_endpoints.py` covers the HTTP round trip.
    """

    async def test_fan_out_stamps_the_registry_key_on_the_source_result(self, monkeypatch):
        monkeypatch.setattr(registry, "ADAPTERS", {
            "cgue": _Adapter("CGUE"), "cassazione": _Adapter("Cassazione"),
        })

        results = await registry.cerca_per_norma("art. 2043 c.c.")
        per_key = {r.fonte: r for r in results}
        assert per_key["cgue"].organo == "CGUE"
        assert per_key["cassazione"].organo == "Cassazione"

    async def test_fan_out_stamps_the_registry_key_on_every_decisione(self, monkeypatch):
        monkeypatch.setattr(registry, "ADAPTERS", {
            "giustizia-amm": _Adapter("Giustizia amministrativa"),
        })
        results = await registry.cerca_per_norma("art. 21-septies")
        result = results[0]
        assert result.fonte == "giustizia-amm"
        assert result.decisioni[0].fonte == "giustizia-amm"
        # `organo` on the row is untouched — CeRDEF depends on this staying
        # the court parsed off the row, not the source's own label.
        assert result.decisioni[0].organo == "Giustizia amministrativa"

    async def test_leggi_stamps_the_canonical_key_not_the_callers_casing(self, monkeypatch):
        monkeypatch.setattr(registry, "ADAPTERS", {"cgue": _LookupAdapter("CGUE")})

        decisione = await registry.leggi("CGUE", "62017CJ0496", 2019)

        assert decisione.fonte == "cgue"

    async def test_leggi_accepts_the_registry_key_case_insensitively(self, monkeypatch):
        monkeypatch.setattr(registry, "ADAPTERS", {"cgue": _LookupAdapter("CGUE")})

        assert (await registry.leggi("cgue", "1", 2019)).fonte == "cgue"
        assert (await registry.leggi("CGUE", "1", 2019)).fonte == "cgue"
        assert (await registry.leggi("CgUe", "1", 2019)).fonte == "cgue"

    async def test_leggi_accepts_the_human_readable_label(self, monkeypatch):
        """A client will inevitably try the label it read off `organo` in
        `/fetch_case_law` instead of `fonte` — this must not 400 either, even
        when the label and the key are not the same string once lower-cased
        (unlike "CGUE"/"cgue", "Giustizia amministrativa" does not fold to
        "giustizia-amm")."""
        monkeypatch.setattr(registry, "ADAPTERS", {
            "giustizia-amm": _LookupAdapter("Giustizia amministrativa"),
        })

        decisione = await registry.leggi("Giustizia amministrativa", "1", 2020)

        assert decisione.fonte == "giustizia-amm"

    async def test_leggi_still_rejects_an_unknown_source(self, monkeypatch):
        monkeypatch.setattr(registry, "ADAPTERS", {"cgue": _LookupAdapter("CGUE")})

        with pytest.raises(KeyError):
            await registry.leggi("corte-costituzionale", "1", 2020)
