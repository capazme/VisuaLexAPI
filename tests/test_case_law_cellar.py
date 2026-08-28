import pytest

from visualex_api.services.case_law.cellar import CellarAdapter, _celex_from_riferimento

SPARQL_JSON = """{"head":{"vars":["celex","ecli"]},"results":{"bindings":[
 {"celex":{"value":"62017CJ0496"},"ecli":{"value":"ECLI:EU:C:2019:26"}},
 {"celex":{"value":"62016CC0073"},"ecli":{"value":"ECLI:EU:C:2017:253"}}
]}}"""


def test_maps_a_norm_reference_to_a_celex_number():
    """The adapter is asked about a norm the way the rest of VisuaLex names
    one; CELLAR keys on CELEX, so the mapping happens here."""
    assert _celex_from_riferimento("Regolamento UE 679/2016") == "32016R0679"
    assert _celex_from_riferimento("Direttiva UE 2019/790") == "32019L0790"
    assert _celex_from_riferimento("art. 2043 codice civile") is None


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


@pytest.mark.live
async def test_cellar_answers_for_the_gdpr():
    result = await CellarAdapter().cerca_per_norma("Regolamento UE 679/2016", limite=5)
    assert result.ok is True
    assert len(result.decisioni) > 0
