"""Italgiure's search for the decision search route (design 2026-10-05 §5)."""
import asyncio
import json
import pathlib

import pytest

from visualex_api.services.decisions import italgiure
from visualex_api.services.decisions.italgiure import ItalgiureReader, SourceAnswerError, fragment_ranges
from visualex_api.services.decisions.search import IndexCoordinates
from visualex_api.services.http_client import HttpResult

FIX = pathlib.Path(__file__).parent / "fixtures" / "decisions"
EMPTY = (FIX / "italgiure_search_empty.json").read_text()


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
    assert not {"ocr", "ocrdis"} & set(data["fl"].split(","))  # never the whole text in a list


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


async def test_a_cold_reader_sends_the_query_without_a_homepage_get(monkeypatch):
    calls = _serve(monkeypatch, [EMPTY])
    await ItalgiureReader().search('(ocr:"x")', pagina=1)
    assert [c[0] for c in calls] == ["POST"]


async def test_a_non_solr_answer_reopens_the_session_and_asks_again(monkeypatch):
    calls = _serve(monkeypatch, ["<html>Verifica</html>", EMPTY])
    page = await ItalgiureReader().search('(ocr:"x")', pagina=1)
    assert page.totale == 0
    assert [c[0] for c in calls] == ["POST", "GET", "POST"]


async def test_two_non_solr_answers_in_a_row_raise(monkeypatch):
    calls = _serve(monkeypatch, ["<html>Verifica</html>", "<html>Verifica</html>"])
    with pytest.raises(SourceAnswerError):
        await ItalgiureReader().search('(ocr:"x")', pagina=1)
    assert [c[0] for c in calls] == ["POST", "GET", "POST"]


async def test_a_json_error_object_raises_at_once(monkeypatch):
    calls = _serve(monkeypatch, [json.dumps({"error": {"code": 500}})])
    with pytest.raises(SourceAnswerError):
        await ItalgiureReader().search('(ocr:"x")', pagina=1)
    assert [c[0] for c in calls] == ["POST"]


async def test_concurrent_failures_share_one_homepage_get(monkeypatch):
    calls = []
    sent = {"POST": 0}
    both_posted = asyncio.Event()

    async def fake_request(method, url, **kwargs):
        calls.append(method)
        if method == "GET":
            await asyncio.sleep(0)
            return HttpResult(text="", status=200, headers={})
        sent["POST"] += 1
        if sent["POST"] == 2:
            both_posted.set()
        if sent["POST"] <= 2:
            await both_posted.wait()  # both first attempts are in flight before either fails
            return HttpResult(text="<html>Verifica</html>", status=200, headers={})
        return HttpResult(text=EMPTY, status=200, headers={})

    monkeypatch.setattr(italgiure.decisions_http_client, "request", fake_request)
    reader = ItalgiureReader()
    pages = await asyncio.gather(reader.search('(ocr:"x")', pagina=1),
                                 reader.search('(ocr:"y")', pagina=1))
    assert [p.totale for p in pages] == [0, 0]
    assert calls.count("GET") == 1 and calls.count("POST") == 4


def test_fragment_markers_become_ranges_and_the_text_stays_plain():
    out = fragment_ranges('danno ex <em>art</em>. <em>2043</em> c.c. & <b>x</b>')
    assert out["testo"] == "danno ex art. 2043 c.c. & <b>x</b>"
    assert out["evidenziati"] == [[9, 12], [14, 18]]


@pytest.mark.parametrize("snippet", [
    "a <em>b", "a b</em> c", "a </em>b<em> c", "<em>a<em>b</em>c</em>", "a <em></em> b",
    "<EM>a</EM> b", "<em>perché</em> <em>x</em><em></em>", "😀 <em>b</em> 😀<em>c</em>", ""])
def test_ranges_are_always_inside_the_text_sorted_and_not_empty(snippet):
    out = fragment_ranges(snippet)
    ranges = out["evidenziati"]
    assert all(0 <= s < e <= len(out["testo"]) for s, e in ranges)
    assert all(a[1] <= b[0] for a, b in zip(ranges, ranges[1:]))


def test_an_uppercase_marker_is_a_marker():
    assert fragment_ranges("<EM>a</EM> b") == {"testo": "a b", "evidenziati": [[0, 1]]}
