"""Italgiure's search for the decision search route (design 2026-10-05 §5)."""
import json
import pathlib

import pytest

from visualex_api.services.decisions import italgiure
from visualex_api.services.decisions.italgiure import ItalgiureReader, SourceAnswerError, fragment_ranges
from visualex_api.services.decisions.search import IndexCoordinates
from visualex_api.services.http_client import HttpResult

FIX = pathlib.Path(__file__).parent / "fixtures" / "decisions"


def _serve(monkeypatch, answers):
    calls, bodies = [], iter(answers)

    async def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "GET":
            return HttpResult(text="", status=200, headers={})
        return HttpResult(text=next(bodies), status=200, headers={})

    monkeypatch.setattr(italgiure.decisions_http_client, "request", fake_request)
    return calls


async def test_a_page_of_results_carries_identity_attributes_and_fragment(monkeypatch):
    _serve(monkeypatch, [(FIX / "italgiure_search_2043_cc.json").read_text()])
    page = await ItalgiureReader().search('kind:"snciv" AND (ocr:"art. 2043 c.c.")', pagina=1)
    assert page.totale > 3 and len(page.decisioni) == 3
    hit = page.decisioni[0]
    assert hit.identita.corte == "cassazione" and hit.identita.archivio == "civile"
    assert hit.attributi.get("data_deposito")
    assert "<" not in hit.frammento["testo"]
    assert hit.frammento["evidenziati"]


async def test_the_request_is_sorted_paged_and_highlighted(monkeypatch):
    calls = _serve(monkeypatch, [(FIX / "italgiure_search_empty.json").read_text()])
    await ItalgiureReader().search('kind:"snciv" AND (ocr:"x")', pagina=3)
    data = calls[-1][2]["data"]
    assert data["sort"] == "pd desc" and data["start"] == "40" and data["rows"] == "20"
    assert data["hl"] == "true" and data["hl.fl"] == "ocr"
    assert "ocr" not in data["fl"].split(",")  # never the whole text in a list


async def test_an_index_page_keeps_only_records_that_cite_the_article(monkeypatch):
    calls = _serve(monkeypatch, [(FIX / "italgiure_index_2043_cc.json").read_text()])
    coords = IndexCoordinates("CC", "2043 00")
    page = await ItalgiureReader().search('kind:"snciv" AND (rnc-gen:"CC" AND rnc-art:"2043 00")', pagina=1,
                                          coords=coords, hl_query='ocr:"art. 2043 c.c."')
    data = calls[-1][2]["data"]
    assert "rnc-art" in data["fl"] and data["hl.q"] == 'ocr:"art. 2043 c.c."'
    assert page.decisioni and all(h.trovata == "indice" for h in page.decisioni)


async def test_a_record_matching_two_different_citations_is_dropped(monkeypatch):
    doc = {"id": "x", "numdec": "1", "anno": "2025", "kind": "snciv", "datdep": ["20250101"],
           "rnc-gen": ["CC", "LS"], "rnc-art": ["1227 00", "2043 00"]}
    _serve(monkeypatch, [json.dumps({"response": {"numFound": 1, "docs": [doc]}})])
    page = await ItalgiureReader().search("q", pagina=1, coords=IndexCoordinates("CC", "2043 00"))
    assert page.decisioni == [] and page.totale == 1


async def test_the_homepage_is_fetched_once_per_reader(monkeypatch):
    empty = (FIX / "italgiure_search_empty.json").read_text()
    calls = _serve(monkeypatch, [empty, empty])
    reader = ItalgiureReader()
    await reader.search('(ocr:"x")', pagina=1)
    await reader.search('(ocr:"y")', pagina=1)
    assert [c[0] for c in calls] == ["GET", "POST", "POST"]


async def test_a_non_solr_answer_reopens_the_session(monkeypatch):
    empty = (FIX / "italgiure_search_empty.json").read_text()
    calls = _serve(monkeypatch, ["<html>Verifica</html>", empty])
    reader = ItalgiureReader()
    with pytest.raises(SourceAnswerError):
        await reader.search('(ocr:"x")', pagina=1)
    await reader.search('(ocr:"x")', pagina=1)
    assert [c[0] for c in calls] == ["GET", "POST", "GET", "POST"]


def test_fragment_markers_become_ranges_and_the_text_stays_plain():
    out = fragment_ranges('danno ex <em>art</em>. <em>2043</em> c.c. & <b>x</b>')
    assert out["testo"] == "danno ex art. 2043 c.c. & <b>x</b>"
    assert out["evidenziati"] == [[9, 12], [14, 18]]



async def test_a_pdf_refused_as_an_anti_bot_page_reopens_the_session(monkeypatch):
    record = {"id": "snciv2026012345O", "numdec": "12345", "anno": "2026", "kind": "snciv",
              "datdep": "20260101", "ocr": "testo " * 50,
              "filename": "./20260101/snciv@s10@a2026@n12345@tO.pdf"}
    calls = []

    async def fake_request(method, url, **kwargs):
        calls.append(method + (" pdf" if "verbo=attach" in url else ""))
        if method == "POST":
            return HttpResult(text=json.dumps({"response": {"numFound": 1, "docs": [record]}}),
                              status=200, headers={})
        if "verbo=attach" in url:
            return HttpResult(text="<html>Verifica</html>", status=200, headers={})
        return HttpResult(text="", status=200, headers={})

    monkeypatch.setattr(italgiure.decisions_http_client, "request", fake_request)
    reader = ItalgiureReader()
    await reader.lookup("civile", 12345, 2026)
    await reader.lookup("civile", 12345, 2026)
    assert calls.count("GET") == 2
