"""The resolver must resolve to the RIGHT act, not merely resolve."""
import pytest

from visualex_api.tools.act_resolver import (
    known_act_names,
    resolve_atto,
    strip_leading_particles,
    suggest_acts,
)


def assert_act(name, tipo, numero):
    got = resolve_atto(name)
    assert got is not None, f"{name!r} did not resolve"
    assert got["numero_atto"] == numero, f"{name!r} -> n. {got['numero_atto']}, expected {numero}"
    assert tipo in got["tipo_atto"].lower()


class TestDenominati:
    @pytest.mark.parametrize("name,tipo,numero", [
        ("statuto dei lavoratori", "legge", "300"),
        ("legge fallimentare", "regio decreto", "267"),
        ("legge fornero", "legge", "92"),
        ("tusl", "decreto legislativo", "81"),
        ("testo unico sulla sicurezza sul lavoro", "decreto legislativo", "81"),
        ("legge biagi", "decreto legislativo", "276"),
    ])
    def test_resolves(self, name, tipo, numero):
        assert_act(name, tipo, numero)


class TestLeadingParticles:
    @pytest.mark.parametrize("name", [
        "lo statuto dei lavoratori",
        "dello statuto dei lavoratori",
        "del lo statuto dei lavoratori",
    ])
    def test_articles_and_prepositions_are_stripped(self, name):
        assert_act(name, "legge", "300")

    def test_legge_is_not_eaten_by_the_le_article(self):
        # The trailing \s+ in the leading-words pattern is what protects this.
        assert strip_leading_particles("legge fallimentare") == "legge fallimentare"


class TestCodici:
    @pytest.mark.parametrize("name", ["codice civile", "il codice civile", "c.c."])
    def test_codice_keeps_its_name_as_tipo_atto(self, name):
        got = resolve_atto(name)
        assert got is not None
        # Load-bearing: generate_urn keys the default allegato off the codice
        # NAME. Rewriting it to the underlying regio decreto loses the ":2".
        assert "codice civile" in got["tipo_atto"].lower()

    def test_capitalised_codice_resolves(self):
        assert resolve_atto("codice del Terzo settore")["numero_atto"] == "117"


class TestDottedAcronyms:
    @pytest.mark.parametrize("name", ["c.p.p.", "cpp"])
    def test_dots_are_optional(self, name):
        assert resolve_atto(name) is not None

    def test_dot_removal_does_not_touch_names_with_numbers(self):
        # "d.lgs. 196/2003" has digits, so it must not be de-dotted into a
        # lookup key — it belongs to the citation-pattern path.
        got = resolve_atto("d.lgs. 196/2003")
        assert got is None or got.get("numero_atto") == "196"


class TestNeverGuesses:
    def test_unknown_returns_none(self):
        assert resolve_atto("legge sulle unicorno") is None

    def test_empty_returns_none(self):
        assert resolve_atto("") is None

    def test_typo_gets_a_suggestion(self):
        assert "legge fallimentare" in suggest_acts("legge fallimentre")

    def test_suggestions_are_bounded(self):
        assert len(suggest_acts("codice", limit=3)) <= 3


class TestKnownNames:
    def test_covers_every_table(self):
        names = set(known_act_names())
        assert "statuto dei lavoratori" in names
        assert "codice civile" in names
        assert len(names) >= 380


@pytest.mark.live
@pytest.mark.asyncio
async def test_every_denominato_resolves_on_normattiva():
    """Drift detector, not a correctness certificate.

    A wrong number on an act of the same date would still pass. It catches the
    table going stale, which is the realistic failure.
    """
    import asyncio

    import aiohttp

    from visualex_api.tools.map import _ATTI_DENOMINATI_SPEC

    base = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
    sem = asyncio.Semaphore(4)
    failures = []

    async def check(session, tipo, data, numero):
        urn = f"{base}{tipo.replace(' ', '.')}:{data};{numero}"
        async with sem:
            try:
                async with session.get(urn, timeout=aiohttp.ClientTimeout(total=45)) as r:
                    body = await r.text()
            except Exception as exc:  # noqa: BLE001
                failures.append((tipo, data, numero, type(exc).__name__))
                return
        if f"n. {numero}" not in body:
            failures.append((tipo, data, numero, "numero non trovato nel titolo"))

    async with aiohttp.ClientSession() as session:
        await asyncio.gather(*[
            check(session, tipo, data, numero)
            for tipo, data, numero, _ in _ATTI_DENOMINATI_SPEC
        ])

    assert not failures, f"{len(failures)} acts drifted: {failures[:10]}"
