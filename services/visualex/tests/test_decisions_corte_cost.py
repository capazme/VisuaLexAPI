"""The Corte costituzionale reader: open data, one bundle on disk, one year read out of it
(design 2026-10-01 §3)."""
import asyncio
import io
import json
import os
import pathlib
import threading
import time
import zipfile
from datetime import date

import pytest

from visualex_api.services.decisions import corte_cost
from visualex_api.services.decisions.corte_cost import CorteCostReader, clean
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import NetworkError

SAMPLE = json.loads((pathlib.Path(__file__).parent / "fixtures" / "decisions"
                     / "corte_cost_2014_sample.json").read_text(encoding="utf-8"))


def make_bundle(years: dict[int, list[dict]], encoding: str = "latin-1") -> bytes:
    """A range bundle as the court publishes it: a zip of per-year zips of JSON, latin-1
    unless told otherwise."""
    outer_buf = io.BytesIO()
    with zipfile.ZipFile(outer_buf, "w") as outer:
        for year, records in years.items():
            inner_buf = io.BytesIO()
            with zipfile.ZipFile(inner_buf, "w") as inner:
                inner.writestr(f"Cc_Opendata_Pronunce_{year}.json",
                               json.dumps({"elenco_pronunce": records},
                                          ensure_ascii=False).encode(encoding))
            outer.writestr(f"Cc_Opendata_Pronunce_{year}_json.zip", inner_buf.getvalue())
    return outer_buf.getvalue()


def _serve(monkeypatch, bundle: bytes):
    calls = []

    async def fake_request(method, url, **kwargs):
        calls.append(url)
        await asyncio.sleep(0)
        assert kwargs["text_encoding"] == "latin-1"
        return HttpResult(text=bundle.decode("latin-1"), status=200, headers={})

    monkeypatch.setattr(corte_cost.decisions_http_client, "request", fake_request)
    return calls


def _reader(tmp_path, today=date(2026, 10, 1)):
    return CorteCostReader(tmp_path, today=lambda: today)


async def test_a_sentenza_with_its_particulars(monkeypatch, tmp_path):
    _serve(monkeypatch, make_bundle({2014: SAMPLE}))
    d = await _reader(tmp_path).lookup(1, 2014)
    assert d.identita.key() == "corte_costituzionale:1:2014"
    assert (d.tipo, d.data_decisione, d.data_deposito, d.ecli) == (
        "sentenza", "2013-12-04", "2014-01-13", "ECLI:IT:COST:2014:1")
    assert set(d.testo) <= {"epigrafe", "motivazione", "dispositivo"}
    assert "&#13;" not in "".join(d.testo.values())
    assert d.fonte == {"nome": "Corte costituzionale — dati aperti", "licenza": "CC BY-SA 3.0",
                       "url": "https://www.cortecostituzionale.it/scheda-pronuncia/2014/1"}
    assert (d.relatore, d.presidente) == ("Giuseppe Tesauro", "SILVESTRI")
    assert d.testo["epigrafe"].startswith("ha pronunciato la seguente\nnel giudizio di legittimità")
    assert d.testo["motivazione"].startswith("1.- Con ordinanza del 17 maggio 2013")
    assert d.testo["dispositivo"].startswith("per questi motivi\n LA CORTE COSTITUZIONALE")


async def test_an_ordinanza(monkeypatch, tmp_path):
    _serve(monkeypatch, make_bundle({2014: SAMPLE}))
    ordinanza = next(r for r in SAMPLE if r["tipologia_pronuncia"] == "O")
    d = await _reader(tmp_path).lookup(int(ordinanza["numero_pronuncia"]), 2014)
    assert d.tipo == "ordinanza"


async def test_not_found(monkeypatch, tmp_path):
    _serve(monkeypatch, make_bundle({2014: SAMPLE}))
    assert await _reader(tmp_path).lookup(9999, 2014) is None


async def test_a_record_matches_on_its_own_year(monkeypatch, tmp_path):
    misfiled = dict(SAMPLE[0], anno_pronuncia="2013")  # filed under 2014, says 2013
    _serve(monkeypatch, make_bundle({2014: [misfiled]}))
    assert await _reader(tmp_path).lookup(1, 2014) is None


async def test_one_download_serves_many_lookups_and_concurrent_misses(monkeypatch, tmp_path):
    calls = _serve(monkeypatch, make_bundle({2014: SAMPLE, 2015: []}))
    reader = _reader(tmp_path)
    await asyncio.gather(reader.lookup(1, 2014), reader.lookup(2, 2014), reader.lookup(1, 2015))
    await reader.lookup(1, 2014)
    assert calls == [f"{corte_cost.BASE_URL}/P_json2001_oggi.zip"]


async def test_the_open_bundle_expires_after_a_day_a_closed_one_after_thirty(monkeypatch, tmp_path):
    calls = _serve(monkeypatch, make_bundle({2014: SAMPLE, 1990: []}))
    reader = _reader(tmp_path)
    await reader.lookup(1, 2014)
    await reader.lookup(1, 1990)
    two_days_ago = time.time() - 2 * 24 * 3600
    for name in ("P_json2001_oggi.zip", "P_json1981_2000.zip"):
        os.utime(tmp_path / name, (two_days_ago, two_days_ago))
    reader = _reader(tmp_path)  # a new process: nothing in memory
    await reader.lookup(1, 2014)
    await reader.lookup(1, 1990)
    assert [c.rsplit("/", 1)[1] for c in calls] == [
        "P_json2001_oggi.zip", "P_json1981_2000.zip", "P_json2001_oggi.zip"]


async def test_something_that_is_not_a_zip_is_refused(monkeypatch, tmp_path):
    _serve(monkeypatch, b"<html>manutenzione</html>")
    with pytest.raises(ValueError):
        await _reader(tmp_path).lookup(1, 2014)
    assert not (tmp_path / "P_json2001_oggi.zip").exists()


async def test_a_cut_download_is_refused_and_not_kept(monkeypatch, tmp_path):
    bundle = make_bundle({2014: SAMPLE})
    _serve(monkeypatch, bundle[: len(bundle) // 2])
    with pytest.raises(ValueError):
        await _reader(tmp_path).lookup(1, 2014)
    assert not (tmp_path / "P_json2001_oggi.zip").exists()


async def test_a_damaged_copy_on_disk_is_fetched_again(monkeypatch, tmp_path):
    good = make_bundle({2014: SAMPLE})
    (tmp_path / "P_json2001_oggi.zip").write_bytes(good[: len(good) // 2])  # fresh, but cut
    calls = _serve(monkeypatch, good)
    reader = _reader(tmp_path)
    with pytest.raises(zipfile.BadZipFile):
        await reader.lookup(1, 2014)
    assert (await reader.lookup(1, 2014)).ecli == "ECLI:IT:COST:2014:1"
    assert len(calls) == 1


async def test_a_past_year_missing_from_its_bundle_is_a_source_error(monkeypatch, tmp_path):
    _serve(monkeypatch, make_bundle({2014: SAMPLE}))
    with pytest.raises(ValueError):
        await _reader(tmp_path).lookup(1, 2015)


async def test_the_current_year_before_its_first_decision_is_not_found(monkeypatch, tmp_path):
    _serve(monkeypatch, make_bundle({2014: SAMPLE}))
    assert await _reader(tmp_path).lookup(1, 2026) is None


async def test_a_year_that_is_not_the_courts_shape_is_a_source_error(monkeypatch, tmp_path):
    outer_buf = io.BytesIO()
    with zipfile.ZipFile(outer_buf, "w") as outer:
        inner_buf = io.BytesIO()
        with zipfile.ZipFile(inner_buf, "w") as inner:
            inner.writestr("Cc_Opendata_Pronunce_2014.json", b'{"altro": []}')
        outer.writestr("Cc_Opendata_Pronunce_2014_json.zip", inner_buf.getvalue())
    _serve(monkeypatch, outer_buf.getvalue())
    with pytest.raises(ValueError):
        await _reader(tmp_path).lookup(1, 2014)


async def test_before_1956_there_is_nothing_to_download(monkeypatch, tmp_path):
    calls = _serve(monkeypatch, make_bundle({}))
    assert await _reader(tmp_path).lookup(1, 1950) is None
    assert calls == []


def _source_down(monkeypatch):
    calls = []

    async def fake_request(method, url, **kwargs):
        calls.append(url)
        raise NetworkError("Exceeded retry budget")

    monkeypatch.setattr(corte_cost.decisions_http_client, "request", fake_request)
    return calls


def _copy_aged(tmp_path, hours: float):
    """A good copy of the 2001-today bundle on disk, last written `hours` ago."""
    path = tmp_path / "P_json2001_oggi.zip"
    path.write_bytes(make_bundle({2014: SAMPLE}))
    aged = time.time() - hours * 3600
    os.utime(path, (aged, aged))


async def test_a_failed_refresh_serves_a_past_year_from_the_copy_on_disk(monkeypatch, tmp_path):
    _copy_aged(tmp_path, hours=25)  # past the 24 hours of the bundle holding the current year
    calls = _source_down(monkeypatch)
    warnings = []

    class Log:
        def warning(self, event, **fields):
            warnings.append((event, fields))

    monkeypatch.setattr(corte_cost, "log", Log())
    d = await _reader(tmp_path).lookup(1, 2014)
    assert d.ecli == "ECLI:IT:COST:2014:1"
    assert len(calls) == 1  # the refresh was tried first
    assert warnings == [("Corte costituzionale bundle refresh failed; serving the copy on disk",
                         {"bundle": "P_json2001_oggi.zip", "error": "Exceeded retry budget"})]


async def test_a_failed_refresh_never_serves_the_current_year_from_an_old_copy(monkeypatch,
                                                                                tmp_path):
    _copy_aged(tmp_path, hours=25)
    _source_down(monkeypatch)
    with pytest.raises(NetworkError):
        await _reader(tmp_path).lookup(1, 2026)


async def test_a_failed_refresh_without_a_copy_is_still_an_error(monkeypatch, tmp_path):
    _source_down(monkeypatch)
    with pytest.raises(NetworkError):
        await _reader(tmp_path).lookup(1, 2014)


async def test_the_download_is_checked_and_written_off_the_event_loop(monkeypatch, tmp_path):
    _serve(monkeypatch, make_bundle({2014: SAMPLE}))
    threads = []
    store = corte_cost._store_bundle

    def recording_store(*args):
        threads.append(threading.get_ident())
        return store(*args)

    monkeypatch.setattr(corte_cost, "_store_bundle", recording_store)
    assert (await _reader(tmp_path).lookup(1, 2014)).ecli == "ECLI:IT:COST:2014:1"
    assert len(threads) == 1 and threads[0] != threading.get_ident()  # ~56 MB in production


async def test_a_bundle_in_utf8_reads_as_the_latin1_one(monkeypatch, tmp_path):
    # the court's JSON is latin-1 today; a switch to UTF-8 must not become mojibake
    _serve(monkeypatch, make_bundle({2014: SAMPLE}, encoding="utf-8"))
    utf8 = await _reader(tmp_path / "utf8").lookup(1, 2014)
    _serve(monkeypatch, make_bundle({2014: SAMPLE}))
    latin1 = await _reader(tmp_path / "latin1").lookup(1, 2014)
    assert utf8 == latin1
    assert "legittimità" in utf8.testo["epigrafe"]


def test_the_text_as_the_page_receives_it():
    # pinned: once notes on decisions exist this output is a data contract (gotcha 23)
    assert clean("ha pronunciato&#13;la seguente\r\n  SENTENZA\r\n\r\n\r\n\r\nnel   giudizio") == (
        "ha pronunciato\nla seguente\n SENTENZA\n\nnel giudizio")


def test_the_text_is_decoded_once_and_composed():
    # pinned with the test above: references, NFC, C1 controls, whitespace-only lines
    assert clean("&laquo;x&raquo; &#8210; e&#768; &#8364; 5 &amp; C\r\n \r\n \r\nfine  \nR&S") == (
        "«x» ‒ è € 5 & C\n\nfine\nR&S")
    assert clean("\x8a\x9a &#160;x") == "Šš \xa0x"


@pytest.mark.live
@pytest.mark.asyncio(loop_scope="session")
async def test_the_fixed_public_cases_from_the_real_bundle(tmp_path):
    # the spec's live cases 1/2014 and 194/2018: one reader, so one download
    from tests.conftest import TRANSPORT_ERRORS, skip_if_unreachable
    reader = CorteCostReader(tmp_path)
    try:
        d = await reader.lookup(1, 2014)
        d194 = await reader.lookup(194, 2018)
    except TRANSPORT_ERRORS as exc:
        skip_if_unreachable("dati.cortecostituzionale.it", exc)
    assert d.ecli == "ECLI:IT:COST:2014:1" and len(d.testo["motivazione"]) > 25000
    assert (d194.ecli, d194.tipo) == ("ECLI:IT:COST:2018:194", "sentenza")
