import pytest

from visualex_api.services.case_law.cerdef import CerdefAdapter, _ROW, _extract_xml

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


@pytest.mark.live
async def test_cerdef_answers_and_mixes_courts():
    result = await CerdefAdapter().cerca_libera("accertamento", limite=10)
    assert result.ok is True, result.error
    assert len(result.decisioni) > 0
