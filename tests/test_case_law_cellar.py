import pytest

from visualex_api.services.case_law.cellar import CellarAdapter, _celex_from_riferimento

SPARQL_JSON = """{"head":{"vars":["celex","ecli"]},"results":{"bindings":[
 {"celex":{"value":"62017CJ0496"},"ecli":{"value":"ECLI:EU:C:2019:26"}},
 {"celex":{"value":"62016CC0073"},"ecli":{"value":"ECLI:EU:C:2017:253"}}
]}}"""


@pytest.mark.parametrize(
    "riferimento,expected",
    [
        ("Regolamento UE 2016/679", "32016R0679"),
        ("regolamento ue 2016/679", "32016R0679"),
        ("Regolamento UE n. 679/2016", "32016R0679"),
        ("Regolamento UE 679/2016", "32016R0679"),
        ("Direttiva 2019/790/UE", "32019L0790"),
        ("Direttiva UE 2019/790", "32019L0790"),
        ("art. 2043 codice civile", None),
    ],
)
def test_maps_a_norm_reference_to_a_celex_number(riferimento, expected):
    """The adapter is asked about a norm the way the rest of VisuaLex names
    one; CELLAR keys on CELEX, so the mapping happens here. Both digit
    orders must resolve — the modern year/num order is the exact key
    preset_aliases.yaml uses for the GDPR, and the legacy num/year order is
    still common in older references."""
    assert _celex_from_riferimento(riferimento) == expected


async def test_parses_judgments_and_marks_them_cited(monkeypatch):
    adapter = CellarAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = SPARQL_JSON
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cellar.http_client.request", fake_request
    )
    result = await adapter.cerca_per_norma("Regolamento UE 679/2016")

    assert result.ok is True
    assert result.organo == "CGUE"
    assert [d.numero for d in result.decisioni] == ["62017CJ0496", "62016CC0073"]
    # CELLAR declares the citation, so it is a fact, not a guess.
    assert all(d.link_kind.value == "cited" for d in result.decisioni)
    assert result.decisioni[0].ecli == "ECLI:EU:C:2019:26"


async def test_a_norm_with_no_celex_is_not_an_error(monkeypatch):
    """Asking the CGUE adapter about the codice civile is a normal question
    with an empty answer — not a failure to report."""
    adapter = CellarAdapter()
    result = await adapter.cerca_per_norma("art. 2043 codice civile")
    assert result.ok is True
    assert result.decisioni == []


async def test_an_unreachable_endpoint_is_reported_not_swallowed(monkeypatch):
    adapter = CellarAdapter()

    async def boom(method, url, **kwargs):
        raise RuntimeError("connection reset")

    monkeypatch.setattr(
        "visualex_api.services.case_law.cellar.http_client.request", boom
    )
    result = await adapter.cerca_per_norma("Regolamento UE 679/2016")
    assert result.ok is False
    assert "connection reset" in result.error


async def test_leggi_confirms_the_celex_resolves_to_a_real_judgment(monkeypatch):
    """leggi() must never hand back a Decisione it did not verify: link_kind
    stays CITED throughout the package, which readers take as "the publisher
    says so" — so an unconfirmed CELEX would be a fabricated citation."""
    adapter = CellarAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = '{"head":{},"boolean":true}'
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cellar.http_client.request", fake_request
    )
    decisione = await adapter.leggi("62017CJ0496", 2019)
    assert decisione is not None
    assert decisione.numero == "62017CJ0496"
    assert decisione.link_kind.value == "cited"


async def test_leggi_returns_none_for_a_celex_that_does_not_exist(monkeypatch):
    """A plainly nonexistent CELEX must not become a Decisione — this is
    what lets the caller's 404 path fire instead of telling a lawyer a
    fabricated case exists."""
    adapter = CellarAdapter()

    async def fake_request(method, url, **kwargs):
        class R:
            text = '{"head":{},"boolean":false}'
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cellar.http_client.request", fake_request
    )
    decisione = await adapter.leggi("69999CJ9999", 9999)
    assert decisione is None


async def test_cerca_libera_reports_it_is_not_supported():
    adapter = CellarAdapter()
    result = await adapter.cerca_libera("some text")
    assert result.ok is True
    assert result.decisioni == []
    assert result.coverage != ""


@pytest.mark.live
async def test_cellar_answers_for_the_gdpr():
    result = await CellarAdapter().cerca_per_norma("Regolamento UE 679/2016", limite=5)
    assert result.ok is True
    assert len(result.decisioni) > 0
