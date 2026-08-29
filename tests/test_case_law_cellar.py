import pytest

from visualex_api.services.case_law.cellar import (
    _EXISTS_QUERY,
    CellarAdapter,
    _celex_from_riferimento,
)

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
        ("Regolamento UE 1234/2007", "32007R1234"),
        ("Direttiva UE 1234/2007", "32007L1234"),
        ("art. 2043 codice civile", None),
    ],
)
def test_maps_a_norm_reference_to_a_celex_number(riferimento, expected):
    """The adapter is asked about a norm the way the rest of VisuaLex names
    one; CELLAR keys on CELEX, so the mapping happens here. Both digit
    orders must resolve — the modern year/num order is the exact key
    preset_aliases.yaml uses for the GDPR, and the legacy num/year order is
    still common in older references. Reg. (CE) 1234/2007 (the OCM unica)
    pins the case where both groups could in principle be a four-digit
    number: the year must be picked by plausibility, not by which
    alternative the regex tries first."""
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


async def test_leggi_derives_the_year_from_the_celex_not_from_the_caller(monkeypatch):
    """`anno` arrives from the request body and is not evidence of anything.
    The CELEX carries the year in positions 1-4, and that is the only version
    of it the source stands behind — echoing back the caller's value turned
    `{"numero": "62017CJ0496", "anno": 1900}` into a 1900 judgment."""
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
    decisione = await adapter.leggi("62017CJ0496", 1900)
    assert decisione is not None
    assert decisione.anno == 2017


async def test_leggi_refuses_a_sparql_injection_payload(monkeypatch):
    """`numero` is interpolated into a SPARQL string literal, and it comes
    straight from the body of POST /fetch_decision. This payload closed the
    literal and had the rest executed as query syntax — the same defect class
    `_escape_phrase` closes for Solr in italgiure.py. It must be refused
    before any request leaves the process."""
    adapter = CellarAdapter()
    calls = []

    async def fake_request(method, url, **kwargs):
        calls.append(url)
        class R:
            text = '{"head":{},"boolean":true}'
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cellar.http_client.request", fake_request
    )
    payload = "x' } ASK WHERE { BIND(1 AS ?z) '"
    assert await adapter.leggi(payload, 2019) is None
    assert calls == []


@pytest.mark.parametrize("numero", [
    "32016R0679",           # the GDPR: a regulation, not a judgment
    "32019L0790",           # a directive
    "62017CJ0496 OR 1=1",   # trailing query syntax
    "'",                   # a bare quote
    "",
    "62017CJ",              # truncated
    "art. 2043 c.c.",
])
async def test_leggi_refuses_anything_that_is_not_a_case_law_celex(numero, monkeypatch):
    """Sector 6 is case law. This adapter only ever answers for the CGUE, so a
    regulation coming back as a judgment marked `cited` would break the one
    promise link_kind=CITED makes — the source declared the link. Refused
    client-side, before the query is built."""
    adapter = CellarAdapter()
    calls = []

    async def fake_request(method, url, **kwargs):
        calls.append(url)
        class R:
            text = '{"head":{},"boolean":true}'
            status = 200
            headers = {}
        return R()

    monkeypatch.setattr(
        "visualex_api.services.case_law.cellar.http_client.request", fake_request
    )
    assert await adapter.leggi(numero, 2016) is None
    assert calls == []


async def test_the_existence_query_filters_to_case_law_like_the_search_query():
    """Belt and braces: the regex above refuses a non-case-law CELEX before
    the network, and the endpoint would refuse it too. `_QUERY` has carried
    this FILTER since the start; `_EXISTS_QUERY` did not, which is how a
    regulation could come back as a judgment."""
    assert "STRSTARTS(STR(?celex),'6')" in _EXISTS_QUERY


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


@pytest.mark.live
async def test_leggi_confirms_a_real_judgment_live():
    """The filtered ASK query must still answer `true` for a judgment that
    exists — a filter that silently broke the working path would turn every
    fetch_decision into a 404."""
    decisione = await CellarAdapter().leggi("62017CJ0496", 1900)
    assert decisione is not None
    assert decisione.numero == "62017CJ0496"
    assert decisione.anno == 2017
    assert decisione.link_kind.value == "cited"


@pytest.mark.live
async def test_the_endpoint_itself_refuses_a_regulation():
    """CELEX 32016R0679 is the GDPR. The adapter's regex already refuses it
    before the network, so this test asks CELLAR directly: it proves the
    FILTER in `_EXISTS_QUERY` is a real server-side restriction and not a
    string that happens to parse, which is what makes the two layers
    independent rather than one layer written twice."""
    import json
    import urllib.parse

    from visualex_api.services.case_law.base import http_headers
    from visualex_api.services.case_law.cellar import _ENDPOINT, http_client

    async def ask(celex: str) -> bool:
        url = f"{_ENDPOINT}?{urllib.parse.urlencode({'query': _EXISTS_QUERY % celex})}"
        result = await http_client.request(
            "GET", url, source="cellar",
            headers=http_headers({"Accept": "application/sparql-results+json"}),
        )
        return json.loads(result.text).get("boolean", False)

    assert await ask("62017CJ0496") is True    # a judgment
    assert await ask("32016R0679") is False    # the GDPR, a regulation


@pytest.mark.live
async def test_leggi_refuses_the_gdpr_live():
    """The same claim at the adapter's own boundary: asked of the CGUE
    adapter, a regulation must come back as "not found", never as a
    judgment marked `cited`."""
    assert await CellarAdapter().leggi("32016R0679", 1900) is None
