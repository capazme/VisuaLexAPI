import pytest
import structlog

from visualex_api.services.case_law import giustizia_amm as giustizia_amm_module
from visualex_api.services.case_law.giustizia_amm import (
    GiustiziaAmmAdapter, _parse_provvedimento_link, _scrape_session,
)

FORM_PAGE = (
    '<html><a href="/web/guest/dcsnprr?p_auth=HkY3UQTe">x</a>'
    '<div id="_decisioni_pareri_web_DecisioniPareriWebPortlet_INSTANCE_XKc17mrB8J10_x">'
    "</div></html>"
)
RESULTS_PAGE = (
    '<html><a href="https://mdp.giustizia-amministrativa.it/visualizza/'
    '?nrg=202614447&nomeFile=202614447_20.html&schema=cds">Sentenza n. 4447/2026</a>'
    "</html>"
)


def test_scrapes_the_portlet_id_and_the_csrf_token():
    """Both are session-bound. Hardcoding either is how this breaks silently
    the next time the portal is reorganised."""
    portlet, auth = _scrape_session(FORM_PAGE)
    assert portlet.endswith("INSTANCE_XKc17mrB8J10")
    assert auth == "HkY3UQTe"


def test_a_page_without_a_token_raises_rather_than_posting_blind():
    with pytest.raises(ValueError):
        _scrape_session("<html>no token here</html>")


async def test_parses_provvedimenti(monkeypatch):
    adapter = GiustiziaAmmAdapter()
    pages = [FORM_PAGE, RESULTS_PAGE]

    async def fake_request(method, url, **kwargs):
        class R:
            text = pages.pop(0)
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.giustizia_amm.http_client.request",
        fake_request,
    )
    result = await adapter.cerca_per_norma("risarcimento danno")

    assert result.ok is True
    assert len(result.decisioni) == 1
    assert result.decisioni[0].numero == "202614447"
    assert result.decisioni[0].link_kind.value == "matched"
    assert result.decisioni[0].anno == 2026
    # The real href is preserved verbatim (including whatever the portal
    # actually sent, e.g. `schema=cds`), not reconstructed from a guessed
    # query string.
    assert result.decisioni[0].url == (
        "https://mdp.giustizia-amministrativa.it/visualizza/"
        "?nrg=202614447&nomeFile=202614447_20.html&schema=cds"
    )


async def test_failure_is_reported(monkeypatch):
    adapter = GiustiziaAmmAdapter()

    async def boom(method, url, **kwargs):
        raise RuntimeError("403 forbidden")

    monkeypatch.setattr(
        "visualex_api.services.case_law.giustizia_amm.http_client.request", boom
    )
    result = await adapter.cerca_per_norma("risarcimento danno")
    assert result.ok is False
    assert "403" in result.error


# ---------------------------------------------------------------------------
# `leggi()` defect: matching `numero` alone ignores `anno`, so decision N of
# 2020 could satisfy a request for decision N of 2026. Fixed to match both.
# ---------------------------------------------------------------------------


async def test_leggi_matches_both_numero_and_anno(monkeypatch):
    """A search can legitimately return the same `nrg` string attached to
    rows from different years (e.g. a low-numbered nrg re-used across
    registers); `leggi` must not hand back the wrong year's decision just
    because the number matches."""
    adapter = GiustiziaAmmAdapter()

    async def fake_search(self, testo, limite):
        from visualex_api.services.case_law.base import Decisione, LinkKind, SourceResult
        return SourceResult(
            organo=self.organo,
            ok=True,
            coverage=self.coverage,
            decisioni=[
                Decisione(
                    organo=self.organo, numero="12345", anno=2020,
                    link_kind=LinkKind.MATCHED,
                    url="https://mdp.giustizia-amministrativa.it/visualizza/"
                        "?nrg=202012345&nomeFile=x.html",
                ),
                Decisione(
                    organo=self.organo, numero="12345", anno=2026,
                    link_kind=LinkKind.MATCHED,
                    url="https://mdp.giustizia-amministrativa.it/visualizza/"
                        "?nrg=202612345&nomeFile=y.html",
                ),
            ],
        )

    monkeypatch.setattr(GiustiziaAmmAdapter, "_search", fake_search)

    hit_2026 = await adapter.leggi("12345", 2026)
    assert hit_2026 is not None
    assert hit_2026.anno == 2026

    hit_2020 = await adapter.leggi("12345", 2020)
    assert hit_2020 is not None
    assert hit_2020.anno == 2020

    assert await adapter.leggi("12345", 1999) is None


# ---------------------------------------------------------------------------
# `_parse_provvedimento_link`: verified against realistic result markup
# rather than transcribed. A regex anchored on one fixed field order silently
# drops every row shaped the other way.
# ---------------------------------------------------------------------------


def test_link_parses_nrg_before_nomefile():
    href = (
        "https://mdp.giustizia-amministrativa.it/visualizza/"
        "?nrg=202614447&nomeFile=202614447_20.html&schema=cds"
    )
    assert _parse_provvedimento_link(href) == ("202614447", "202614447_20.html")


def test_link_parses_nomefile_before_nrg():
    """The reference implementation's regex required `nrg=` to appear first
    in the href. A real TAR result page is not guaranteed to order its query
    parameters the same way as a Consiglio di Stato one."""
    href = (
        "https://mdp.giustizia-amministrativa.it/visualizza/"
        "?nomeFile=202000123_10.html&subDir=Provvedimenti&nrg=202000123"
        "&schema=tar_lazio"
    )
    assert _parse_provvedimento_link(href) == ("202000123", "202000123_10.html")


def test_link_tolerates_extra_query_parameters_between_the_two_keys():
    href = (
        "https://mdp.giustizia-amministrativa.it/visualizza/"
        "?nrg=202399887&sede=CGA&anno=2026&nomeFile=202399887_5.html"
    )
    assert _parse_provvedimento_link(href) == ("202399887", "202399887_5.html")


def test_link_unescapes_html_entity_ampersands():
    """HTML-valid markup encodes `&` between query parameters as `&amp;`.
    Parsing the raw, un-unescaped string turns `nomeFile` into the key
    `amp;nomeFile`, which never matches and the row silently vanishes."""
    href = (
        "https://mdp.giustizia-amministrativa.it/visualizza/"
        "?nrg=202611111&amp;nomeFile=202611111_1.html&amp;schema=cds"
    )
    assert _parse_provvedimento_link(href) == ("202611111", "202611111_1.html")


def test_link_missing_either_key_is_reported_as_unparsable():
    href = "https://mdp.giustizia-amministrativa.it/visualizza/?nrg=202600001"
    assert _parse_provvedimento_link(href) is None


def test_link_rejects_an_nrg_that_is_not_at_least_four_digits():
    """`nrg` always carries a four-digit year prefix; a shorter or
    non-numeric capture is a mis-parse, not a valid register number, and
    must not be handed back as though it were one."""
    href = "https://mdp.giustizia-amministrativa.it/visualizza/?nrg=123&nomeFile=x.html"
    assert _parse_provvedimento_link(href) is None


# ---------------------------------------------------------------------------
# The host check is the one security-relevant line in this file: it decides
# whether a scraped href is followed as a document link at all. Nothing else
# in this file pins it — every other link-parsing test uses a valid-host
# fixture, so these must fail on their own if the check is ever weakened or
# deleted (verified by hand: commenting out
# `if parsed.hostname != _MDP_HOSTNAME: return None` makes every test below
# fail, because each of these hrefs otherwise carries a well-formed
# `nrg`/`nomeFile` pair that would happily parse).
# ---------------------------------------------------------------------------


def test_link_rejects_a_plainly_foreign_host():
    href = "https://evil.example.com/visualizza/?nrg=202611111&nomeFile=x.html"
    assert _parse_provvedimento_link(href) is None


def test_link_rejects_a_suffix_spoofed_host():
    """`mdp.giustizia-amministrativa.it.evil.com` contains the real hostname
    as a prefix but is a completely different, attacker-controlled domain —
    a `str.endswith`/`in` check would be fooled by this; `hostname !=` is
    not."""
    href = (
        "https://mdp.giustizia-amministrativa.it.evil.com/visualizza/"
        "?nrg=202611111&nomeFile=x.html"
    )
    assert _parse_provvedimento_link(href) is None


def test_link_rejects_a_userinfo_smuggled_host():
    """`https://real-host@evil.com/...` puts the real hostname before an
    `@`, where it is parsed as userinfo (a login), not as the host — the
    host `urllib.parse` actually resolves this to is `evil.com`. A naive
    substring check on the raw URL text would be fooled; `urlsplit(...).hostname`
    is not."""
    href = (
        "https://mdp.giustizia-amministrativa.it@evil.com/visualizza/"
        "?nrg=202611111&nomeFile=x.html"
    )
    assert _parse_provvedimento_link(href) is None


def test_link_rejects_a_mixed_case_foreign_host():
    href = "https://EVIL.example.com/visualizza/?nrg=202611111&nomeFile=x.html"
    assert _parse_provvedimento_link(href) is None


def test_link_accepts_the_real_host_case_insensitively():
    """The rejection tests above are only meaningful alongside a positive
    control: the check must still accept the genuine host, including a
    differently-cased rendering of it (`urlsplit(...).hostname` lower-cases),
    so this isn't accidentally passing by rejecting everything."""
    href = (
        "https://MDP.Giustizia-Amministrativa.IT/visualizza/"
        "?nrg=202611111&nomeFile=x.html"
    )
    assert _parse_provvedimento_link(href) == ("202611111", "x.html")


# ---------------------------------------------------------------------------
# A row this adapter cannot parse must be logged, never silently dropped.
# ---------------------------------------------------------------------------


@pytest.fixture
def structlog_to_stdlib(monkeypatch):
    """Route this module's structlog output into stdlib logging, for `caplog`.

    structlog is configured onto stdlib in the root `app.py`, which this test
    module never imports; the default configuration writes to stdout, where
    `caplog` cannot see it. Configuring it here — and rebinding the module
    logger, since the app configures with `cache_logger_on_first_use=True` —
    mirrors the pattern in `tests/test_case_law_cerdef.py`."""
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
    monkeypatch.setattr(giustizia_amm_module, "log", structlog.get_logger("giustizia_amm"))
    try:
        yield
    finally:
        structlog.configure(**previous)


UNPARSABLE_RESULTS_PAGE = (
    '<html><a href="https://mdp.giustizia-amministrativa.it/visualizza/'
    '?nrg=202688888">Sentenza senza nomeFile</a></html>'
)


async def test_a_row_that_cannot_be_parsed_is_logged_and_skipped(
    monkeypatch, caplog, structlog_to_stdlib
):
    adapter = GiustiziaAmmAdapter()
    pages = [FORM_PAGE, UNPARSABLE_RESULTS_PAGE]

    async def fake_request(method, url, **kwargs):
        class R:
            text = pages.pop(0)
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.giustizia_amm.http_client.request",
        fake_request,
    )
    result = await adapter.cerca_libera("risarcimento danno")

    assert result.ok is True
    assert result.decisioni == []
    assert caplog.records, "a row that could not be parsed was dropped with no log"
    assert any("nrg/nomeFile" in r.message for r in caplog.records)


@pytest.mark.live
async def test_giustizia_amm_answers():
    result = await GiustiziaAmmAdapter().cerca_libera("risarcimento danno", limite=5)
    assert result.ok is True, result.error
    assert len(result.decisioni) > 0
