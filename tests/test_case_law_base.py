import pytest

from visualex_api.services.case_law.base import Decisione, LinkKind, SourceResult


def test_decisione_carries_how_it_was_found():
    """`link_kind` is the one field that must survive to the UI: it separates a
    citation the source declares from a string a search engine matched."""
    d = Decisione(
        organo="CGUE",
        numero="C-36/21",
        anno=2022,
        link_kind=LinkKind.CITED,
        url="https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:62021CJ0036",
    )
    assert d.link_kind is LinkKind.CITED
    assert d.to_dict()["link_kind"] == "cited"


def test_source_result_reports_failure_without_pretending_emptiness():
    """A source that is down must not look like a source with no results —
    the panel has to be able to say which one it was (spec: Failure)."""
    ok = SourceResult(organo="CGUE", decisioni=[], ok=True)
    ko = SourceResult(organo="CGUE", decisioni=[], ok=False, error="timeout")

    assert ok.to_dict()["ok"] is True
    assert ko.to_dict()["ok"] is False
    assert ko.to_dict()["error"] == "timeout"


def test_identifies_itself_honestly():
    """Spec D5. `ThrottledHttpClient` sends no User-Agent of its own — aiohttp's
    default — so the adapters supply one. It names the product and carries a
    contact URL; it never impersonates a browser, which is a different posture
    for a shared server than for a personal tool."""
    from visualex_api.services.case_law.base import USER_AGENT, http_headers

    assert USER_AGENT.startswith("VisuaLex/")
    assert "+https://visualex.org" in USER_AGENT
    assert "Mozilla" not in USER_AGENT and "Chrome" not in USER_AGENT

    h = http_headers({"Referer": "https://example.test/"})
    assert h["User-Agent"] == USER_AGENT
    assert h["Referer"] == "https://example.test/"


def test_coverage_note_travels_with_the_result():
    """An empty Cassazione section means "nothing in the last five years",
    never "nothing"."""
    r = SourceResult(organo="Cassazione", decisioni=[], ok=True,
                     coverage="ultimi 5 anni")
    assert r.to_dict()["coverage"] == "ultimi 5 anni"
