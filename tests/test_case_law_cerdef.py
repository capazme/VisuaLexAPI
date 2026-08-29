import re

import pytest
import structlog

from tests.conftest import TRANSPORT_ERRORS, skip_if_unreachable
from visualex_api.services.case_law import cerdef as cerdef_module
from visualex_api.services.case_law.cerdef import (
    CerdefAdapter, _ESTREMI, _ROW, _extract_xml,
)

PAGE = (
    "<html><script>var xmlResult = '<?xml version=\\\"1.0\\\"?>"
    "<risultatiRicerca><contatori><contatoreGiurisprudenza>66700"
    "</contatoreGiurisprudenza></contatori><risultati>"
    "<Provvedimento idProvvedimento=\\\"{ABC}\\\">"
    "<estremi link=\\\"true\\\">Sentenza del 18\\/07\\/2026 n. 23488 - "
    "Corte di Cassazione - Sezione\\/Collegio Sezioni unite</estremi>"
    "</Provvedimento></risultati></risultatiRicerca>';</script></html>"
)


def test_extracts_the_embedded_xml():
    xml = _extract_xml(PAGE)
    assert "contatoreGiurisprudenza" in xml
    assert "/" in xml  # escaped slashes are unescaped


async def test_parses_the_issuing_court_out_of_the_estremi(monkeypatch):
    """CeRDEF is not one court: a single answer mixes Cassazione, Corte
    costituzionale and the tax commissions, so the body has to be read off
    each row rather than assumed."""
    adapter = CerdefAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = PAGE
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", fake_request
    )
    result = await adapter.cerca_per_norma("articolo 2043")

    assert result.ok is True
    d = result.decisioni[0]
    assert d.organo == "Corte di Cassazione"
    assert d.numero == "23488"
    assert d.anno == 2026
    assert d.sezione == "Sezioni unite"
    assert d.link_kind.value == "matched"


async def test_cerca_per_norma_reformulates_the_abbreviated_reference(monkeypatch):
    """CeRDEF's index holds the spelled-out form only — measured live,
    "art. 2043 c.c." (what every caller actually sends) returns zero, while
    "articolo 2043" does not. `cerca_per_norma` must send the index the
    phrasing it actually holds, not the reference verbatim."""
    adapter = CerdefAdapter()
    sent: dict = {}

    async def fake_request(method, url, **kwargs):
        if method == "POST":
            sent["parole"] = kwargs["data"]["parole"]
            sent["criterio"] = kwargs["data"]["tipoCriterioRicerca"]

        class R:
            text = PAGE
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", fake_request
    )
    result = await adapter.cerca_per_norma("art. 2043 c.c.")

    assert sent["parole"] == "articolo 2043"
    assert sent["criterio"] == "2"  # still an exact phrase, not "tutte le parole"
    assert result.ok is True
    assert len(result.decisioni) == 1


async def test_cerca_per_norma_extracts_the_number_and_drops_the_act(monkeypatch):
    """A hyphenated ordinal and an EU act name after the number are both real
    shapes callers send. Only the bare number should reach the index — the
    act is dropped deliberately (module docstring), not because it was lost
    by accident."""
    adapter = CerdefAdapter()
    sent: dict = {}

    async def fake_request(method, url, **kwargs):
        if method == "POST":
            sent["parole"] = kwargs["data"]["parole"]

        class R:
            text = PAGE
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", fake_request
    )

    await adapter.cerca_per_norma("art. 5 Regolamento UE 679/2016")
    assert sent["parole"] == "articolo 5", (
        "the capitalised act name must not be swallowed as if it were an "
        "ordinal suffix"
    )

    await adapter.cerca_per_norma("art. 2409-octiesdecies c.c.")
    assert sent["parole"] == "articolo 2409-octiesdecies"


async def test_cerca_per_norma_does_not_swallow_the_acts_first_lowercase_word(monkeypatch):
    """Pins the exact strings `buildCaseLawReference` (frontend) emits today
    for the two act shapes that used to be over-matched: a generic act type
    ("legge") and a named code with no abbreviation ("codice del consumo").
    Before the fix, the space-separated suffix group accepted any run of 2+
    lowercase letters as an ordinal, so it swallowed the act's first word —
    measured live, "articolo 33 codice" returns 0 where "articolo 33"
    returns 10."""
    adapter = CerdefAdapter()
    sent: dict = {}

    async def fake_request(method, url, **kwargs):
        if method == "POST":
            sent["parole"] = kwargs["data"]["parole"]

        class R:
            text = PAGE
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", fake_request
    )

    await adapter.cerca_per_norma("art. 3 legge n. 241 del 1990")
    assert sent["parole"] == "articolo 3"

    await adapter.cerca_per_norma("art. 33 codice del consumo")
    assert sent["parole"] == "articolo 33"

    # The hyphenated ordinal form stays free (any letters after the hyphen),
    # unaffected by the enumerated-ordinal restriction on the space form.
    await adapter.cerca_per_norma("art. 2409-octiesdecies c.c.")
    assert sent["parole"] == "articolo 2409-octiesdecies"


async def test_cerca_per_norma_refuses_a_reference_with_no_article_number(monkeypatch):
    """No article number means nothing safe to search — falling back to a
    phrase search on the raw string would just be noise. Mirrors the refusal
    in `italgiure.build_norma_query`; this must not touch the network at
    all."""
    adapter = CerdefAdapter()

    async def boom(method, url, **kwargs):
        raise AssertionError("no article number should never reach the network")

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", boom
    )
    result = await adapter.cerca_per_norma("Statuto dei lavoratori")

    assert result.ok is True
    assert result.decisioni == []


async def test_cerca_libera_is_not_reformulated(monkeypatch):
    """Free text is the caller's own words — `cerca_libera` must send it
    verbatim, unlike `cerca_per_norma`."""
    adapter = CerdefAdapter()
    sent: dict = {}

    async def fake_request(method, url, **kwargs):
        if method == "POST":
            sent["parole"] = kwargs["data"]["parole"]
            sent["criterio"] = kwargs["data"]["tipoCriterioRicerca"]

        class R:
            text = PAGE
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", fake_request
    )
    await adapter.cerca_libera("art. 2043 c.c. risarcimento")

    assert sent["parole"] == "art. 2043 c.c. risarcimento"
    assert sent["criterio"] == "0"


async def test_failure_is_reported(monkeypatch):
    adapter = CerdefAdapter()

    async def boom(method, url, **kwargs):
        raise RuntimeError("service unavailable")

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", boom
    )
    result = await adapter.cerca_per_norma("articolo 2043")
    assert result.ok is False
    assert "service unavailable" in result.error


# ---------------------------------------------------------------------------
# _ROW: verified against real-shaped estremi strings rather than transcribed.
# ---------------------------------------------------------------------------


def test_row_allows_a_multi_word_provvedimento_type():
    r"""`tipo` used to be `\w+`, a single token. A real, common type such as
    "Ordinanza interlocutoria" is two words, so it failed to match at all and
    the row was silently dropped — the same class of bug as the hyphenated
    organo case below, on a different field."""
    testo = ("Ordinanza interlocutoria del 01/01/2020 n. 100 - "
             "Corte di Cassazione - Sezione/Collegio 1")
    m = _ROW.match(testo)
    assert m is not None
    assert m.group("tipo") == "Ordinanza interlocutoria"
    assert m.group("organo").strip() == "Corte di Cassazione"
    assert m.group("sez").strip() == "1"


def test_row_handles_an_organo_name_that_itself_contains_a_hyphen():
    """CeRDEF renders some regional tax commissions with the territory
    joined by a bare hyphen, e.g. "Comm. Trib. Reg. - Abruzzo". A char class
    that excludes '-' from the organo group truncates at that hyphen and
    then fails to match at all (nothing after it reads "Sezione/Collegio"),
    silently dropping the row."""
    testo = ("Sentenza del 05/03/2015 n. 1234 - Comm. Trib. Reg. - Abruzzo "
             "- Sezione/Collegio 3")
    m = _ROW.match(testo)
    assert m is not None
    assert m.group("organo").strip() == "Comm. Trib. Reg. - Abruzzo"
    assert m.group("sez").strip() == "3"
    assert m.group("numero") == "1234"
    assert m.group("anno") == "2015"


def test_row_handles_a_body_name_with_an_apostrophe_and_no_sezione_tail():
    """Not every row carries a "Sezione/Collegio" tail at all — the trailing
    group has to be genuinely optional, not just short in the fixture."""
    testo = "Sentenza del 12/11/1999 n. 45 - Comm. Trib. Reg. per l'Abruzzo"
    m = _ROW.match(testo)
    assert m is not None
    assert m.group("organo").strip() == "Comm. Trib. Reg. per l'Abruzzo"
    assert m.group("sez") is None
    assert m.group("numero") == "45"
    assert m.group("anno") == "1999"


async def test_leggi_returns_none_when_nothing_matches(monkeypatch):
    """`leggi()` must never fabricate: a search that returns rows for other
    numbers or years is not a match, and the caller gets `None`, not an
    invented `Decisione` for the number it asked about."""
    adapter = CerdefAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = PAGE  # carries n. 23488/2026 only
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", fake_request
    )
    assert await adapter.leggi("99999", 2020) is None


# ---------------------------------------------------------------------------
# A row `_ROW` cannot parse must be logged, never silently dropped.
# ---------------------------------------------------------------------------


@pytest.fixture
def structlog_to_stdlib(monkeypatch):
    """Route this module's structlog output into stdlib logging, for `caplog`.

    structlog is configured onto stdlib in the root `app.py`, which this test
    module never imports; the default configuration writes to stdout, where
    `caplog` cannot see it. Configuring it here — and rebinding the module
    logger, since the app configures with `cache_logger_on_first_use=True` —
    mirrors the pattern in `tests/test_akn_fetch.py`."""
    previous = structlog.get_config()
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.render_to_log_kwargs,
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=False,
    )
    monkeypatch.setattr(cerdef_module, "log", structlog.get_logger("cerdef"))
    try:
        yield
    finally:
        structlog.configure(**previous)


MALFORMED_PAGE = (
    "<html><script>var xmlResult = '<?xml version=\"1.0\"?>"
    "<risultatiRicerca><risultati>"
    "<Provvedimento idProvvedimento=\"{XYZ}\">"
    "<estremi link=\"true\">testo senza il formato atteso</estremi>"
    "</Provvedimento></risultati></risultatiRicerca>';</script></html>"
)


async def test_a_row_that_cannot_be_parsed_is_logged_and_skipped(
    monkeypatch, caplog, structlog_to_stdlib
):
    """A row CeRDEF sends but `_ROW` cannot read must not vanish with no
    trace (CLAUDE.md gotcha 18) — it should be logged and the rest of the
    answer still returned, rather than the whole search failing."""
    adapter = CerdefAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = MALFORMED_PAGE
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cerdef.http_client.request", fake_request
    )
    result = await adapter.cerca_libera("qualcosa")

    assert result.ok is True
    assert result.decisioni == []
    assert caplog.records, "a row _ROW could not parse was dropped with no log"
    assert any("did not match" in r.message for r in caplog.records)


@pytest.mark.live
async def test_cerdef_answers_and_mixes_courts():
    """Also guards against the class of bug fixed in this task: a `_ROW`
    shape too narrow for a real row silently shrinks the result set with no
    signal. Comparing the number of raw `<estremi>` blocks CeRDEF actually
    sent against how many parse cleanly through `_ROW` turns a parsing gap
    into a test failure instead of a quietly smaller answer.

    CeRDEF itself answers HTTP 500 under repeated querying often enough that
    reaching it is not a safe assumption — a bad afternoon at the Ministry of
    Finance must not fail the build. `_fetch_page` is a thin wrapper around
    the two-request handshake with no parsing in it (see its docstring), so
    the only thing that can raise out of it is `TRANSPORT_ERRORS`; anything
    CeRDEF answers with, however malformed, reaches the assertions below and
    still fails the test."""
    adapter = CerdefAdapter()

    try:
        page = await adapter._fetch_page("accertamento", criterio="0")
    except TRANSPORT_ERRORS as exc:
        skip_if_unreachable("CeRDEF", exc)

    xml = cerdef_module._extract_xml(page)
    raw_rows = _ESTREMI.findall(xml)
    assert raw_rows, "CeRDEF returned no <estremi> rows for a broad free search"

    unparsed = [
        estremi for estremi in raw_rows
        if not _ROW.match(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", estremi)).strip())
    ]
    assert not unparsed, (
        f"{len(unparsed)} of {len(raw_rows)} raw rows did not match _ROW: "
        f"{unparsed[:3]!r}"
    )

    result = await adapter.cerca_libera("accertamento", limite=len(raw_rows))
    if not result.ok:
        # `_search`'s own `try` wraps only the second `_fetch_page` call
        # (see cerdef.py) — parsing never raises, a row it cannot read is
        # logged and skipped, not turned into `ok=False`. So `ok=False` here
        # can only mean the second round-trip hit the same transport
        # failure, never a parsing regression.
        skip_if_unreachable("CeRDEF", result.error)
    assert len(result.decisioni) == len(raw_rows)

    organi = {d.organo for d in result.decisioni}
    assert len(organi) > 1, (
        f"expected more than one issuing body across a broad free search, "
        f"got only {organi}"
    )
