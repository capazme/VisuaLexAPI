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
from visualex_api.services.decisions.corte_cost import (
    CorteCostReader,
    clean,
    line_paragraphs,
    split_epigrafe,
    to_decision,
)
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
    # the recorded epigrafe is cut to two lines, too few to measure a block: its break stays one
    assert d.testo["epigrafe"].startswith("ha pronunciato la seguente\nnel giudizio di legittimità")
    assert d.testo["motivazione"].startswith("1.- Con ordinanza del 17 maggio 2013")
    # each short line of the dispositivo is a paragraph (its lines are long: not a typewriter wrap)
    assert d.testo["dispositivo"].startswith(
        "per questi motivi\n\n LA CORTE COSTITUZIONALE\n\n 1) dichiara l'illegittimità")


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


async def test_a_stale_copy_confirms_a_decision_it_holds_and_never_denies_one(monkeypatch,
                                                                              tmp_path):
    _copy_aged(tmp_path, hours=25)
    _source_down(monkeypatch)
    reader = _reader(tmp_path)
    # the copy cannot say that a number does not exist: it may predate the decision, and a
    # source that cannot be reached is never reported as "not found"
    with pytest.raises(ValueError):
        await reader.lookup(9999, 2014)
    assert (await reader.lookup(1, 2014)).ecli == "ECLI:IT:COST:2014:1"


async def test_a_copy_written_during_a_year_cannot_deny_that_years_later_decisions(monkeypatch,
                                                                                   tmp_path):
    # written during 2026, when only decisions 1 and 2 were out; it is now January 2027, so
    # 2026 is a past year the copy would be served for, and the refresh fails
    records = [dict(SAMPLE[0], numero_pronuncia="1", anno_pronuncia="2026"),
               dict(SAMPLE[1], numero_pronuncia="2", anno_pronuncia="2026")]
    path = tmp_path / "P_json2001_oggi.zip"
    path.write_bytes(make_bundle({2026: records}))
    expired = time.time() - 25 * 3600
    os.utime(path, (expired, expired))
    _source_down(monkeypatch)
    reader = _reader(tmp_path, today=date(2027, 1, 3))
    with pytest.raises(ValueError):  # n. 250 of 2026 may have been deposited after the copy
        await reader.lookup(250, 2026)
    assert (await reader.lookup(1, 2026)).identita.key() == "corte_costituzionale:1:2026"


async def test_a_copy_is_judged_stale_at_every_lookup_not_when_its_year_was_read(monkeypatch,
                                                                                 tmp_path):
    _copy_aged(tmp_path, hours=1)  # within the 24 hours: it may deny a number
    reader = _reader(tmp_path)
    assert (await reader.lookup(1, 2014)).ecli == "ECLI:IT:COST:2014:1"  # 2014 now in memory
    assert await reader.lookup(9999, 2014) is None
    monkeypatch.setattr(corte_cost, "OPEN_TTL", 0)  # the same copy expires, still in memory
    _source_down(monkeypatch)
    with pytest.raises(ValueError):  # the records in memory do not carry the old verdict
        await reader.lookup(9999, 2014)
    assert (await reader.lookup(1, 2014)).ecli == "ECLI:IT:COST:2014:1"


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


# The owner's rule of 2026-10-04: when the open data leave `testo` empty, the reasoning sits in
# the epigrafe. One case per shape, on short synthetic texts.
HEAD = "ha pronunciato la seguente\nORDINANZA\nnel giudizio di legittimità costituzionale"


@pytest.mark.parametrize("epigrafe,head,reasoning", [
    (f"{HEAD}\n\nRitenuto che il giudice dubita;\nConsiderato che la questione è infondata.",
     HEAD, "Ritenuto che il giudice dubita;\nConsiderato che la questione è infondata."),
    (f"{HEAD}\nConsiderato che la questione è inammissibile.",
     HEAD, "Considerato che la questione è inammissibile."),
    (f"{HEAD}\nConsiderato in fatto che il giudice dubita;\nRitenuto in diritto che",
     HEAD, "Considerato in fatto che il giudice dubita;\nRitenuto in diritto che"),
    (f"{HEAD}\n ritenuto che il giudice dubita", HEAD, "ritenuto che il giudice dubita"),
    (f"{HEAD}\nRITENUTO IN FATTO\nil giudice dubita", HEAD, "RITENUTO IN FATTO\nil giudice dubita"),
    ("LA CORTE COSTITUZIONALE\nConsiderato il ricorso\nha pronunciato la seguente\nORDINANZA\nRitenuto che",
     "LA CORTE COSTITUZIONALE\nConsiderato il ricorso\nha pronunciato la seguente\nORDINANZA",
     "Ritenuto che"),
    # only a header phrase found in any case passes this one (161/1980, 330/1983)
    ("LA CORTE COSTITUZIONALE\nConsiderato il ricorso\nha pronunciato la Seguente\nORDINANZA\nRitenuto che",
     "LA CORTE COSTITUZIONALE\nConsiderato il ricorso\nha pronunciato la Seguente\nORDINANZA",
     "Ritenuto che"),
    ("LA CORTE COSTITUZIONALE\nnel giudizio promosso dal pretore\nRitenuto che",
     "LA CORTE COSTITUZIONALE\nnel giudizio promosso dal pretore", "Ritenuto che"),
    ("ha pronunciato la seguente\nRitenuto che il giudice dubita",
     "ha pronunciato la seguente", "Ritenuto che il giudice dubita"),
    (" \n\n  Ritenuto che il giudice dubita;\nConsiderato che", "",
     "Ritenuto che il giudice dubita;\nConsiderato che"),
    # 204/1988 and 132/2000: the reasoning opens with the word, but not first on its line
    (f"{HEAD}\n1. - Ritenuto, in fatto, che il giudice dubita;\nudito il Giudice relatore. Considerato che",
     f"{HEAD}\n1. - Ritenuto, in fatto, che il giudice dubita;\nudito il Giudice relatore. Considerato che",
     ""),
    (f"{HEAD}\nRilevato che la questione è già decisa.",
     f"{HEAD}\nRilevato che la questione è già decisa.", ""),
], ids=["Ritenuto", "Considerato only", "Considerato before Ritenuto", "lower case", "capitals",
        "a line inside the header", "the header phrase in another case", "no header phrase",
        "a head of only the header phrase", "a head of only whitespace",
        "the word not first on its line", "no such line"])
def test_an_epigrafe_is_split_where_the_reasoning_starts(epigrafe, head, reasoning):
    assert split_epigrafe(epigrafe) == (head, reasoning)
    # every character stays but the whitespace at the boundary: the two parts, which never
    # overlap, joined by one line break are the epigrafe, up to that whitespace
    gap = epigrafe[len(head):len(epigrafe) - len(reasoning)]
    assert epigrafe.startswith(head) and epigrafe.endswith(reasoning)
    assert len(head) + len(reasoning) <= len(epigrafe) and gap.strip() == ""


def _record(**fields):
    return {"numero_pronuncia": "1", "anno_pronuncia": "2010", "tipologia_pronuncia": "O",
            "testo": "", **fields}


def _said(testo):
    """What each block says, without its line breaks: where they fall is `line_paragraphs`'
    business, tested on its own, and these tests are about which block each part goes to."""
    return {key: value.replace("\n", "") for key, value in testo.items()}


def test_the_reader_splits_only_an_epigrafe_whose_testo_the_source_left_empty():
    epigrafe = f"{HEAD}\nRitenuto che il giudice dubita"
    split = to_decision(_record(epigrafe=epigrafe, dispositivo="per questi motivi"))
    assert _said(split.testo) == _said({"epigrafe": HEAD, "motivazione": "Ritenuto che il giudice dubita",
                                        "dispositivo": "per questi motivi"})
    # the rule is by shape, not by type: a sentenza without its testo is split too
    sentenza = to_decision(_record(epigrafe=epigrafe, tipologia_pronuncia="S"))
    assert sentenza.testo["motivazione"] == "Ritenuto che il giudice dubita"
    # a decision with its testo is never split
    whole = to_decision(_record(epigrafe=epigrafe, testo="1.- Con ordinanza del 2010"))
    assert _said(whole.testo) == _said({"epigrafe": epigrafe, "motivazione": "1.- Con ordinanza del 2010"})
    # nothing before the reasoning: no epigrafe block, only the motivazione
    assert to_decision(_record(epigrafe="Ritenuto che il giudice dubita")).testo == {
        "motivazione": "Ritenuto che il giudice dubita"}


# The open data break lines two ways (measured on 2026-10-04 over the three bundles): since about
# 2001 each line is a paragraph or a heading; before, a typewriter wrap at a measure of at most
# 80 characters. A line break is a paragraph break unless it is such a wrap.
LONG_FIRST = ("1.- Il giudice rimettente dubita della legittimità costituzionale della norma "
              "censurata, in riferimento all'art. 3 Cost.")
LONG_SECOND = ("2.- La questione non è fondata, perché la norma non introduce alcuna disparità "
               "di trattamento tra situazioni omogenee.")


@pytest.mark.parametrize("text,expected", [
    # long lines: each line is a paragraph
    (f"{LONG_FIRST}\n{LONG_SECOND}", f"{LONG_FIRST}\n\n{LONG_SECOND}"),
    # typewritten: a wrap stays a line break, and a paragraph ends where a line stops short
    ("Il Tribunale di Roma ha sollevato questione di legittimita'\n"
     "costituzionale dell'art. 1 della legge, in riferimento agli\n"
     "artt. 3 e 24 della Costituzione.\n"
     "La questione e' manifestamente infondata, come la Corte ha\n"
     "gia' deciso con la sentenza n. 1 del 1960.",
     "Il Tribunale di Roma ha sollevato questione di legittimita'\n"
     "costituzionale dell'art. 1 della legge, in riferimento agli\n"
     "artt. 3 e 24 della Costituzione.\n\n"
     "La questione e' manifestamente infondata, come la Corte ha\n"
     "gia' deciso con la sentenza n. 1 del 1960."),
    # a line that ends a sentence where the next word would still have fit is a paragraph end,
    # though it fills three quarters of the measure
    ("alfa beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron\n"
     "Una frase compiuta che finisce prima del margine destro, qui.\n"
     "Poi segue un nuovo capoverso che si avvolge regolarmente come le altre righe\n"
     "e continua con altre parole fino a riempire anche questa riga del testo ok.",
     "alfa beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron\n"
     "Una frase compiuta che finisce prima del margine destro, qui.\n\n"
     "Poi segue un nuovo capoverso che si avvolge regolarmente come le altre righe\n"
     "e continua con altre parole fino a riempire anche questa riga del testo ok."),
    # one that ends a sentence at the margin, where the next word would not have fit, is a wrap
    ("alfa beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron\n"
     "Una frase compiuta che arriva fino al margine destro del testo scritto a mano.\n"
     "Poi segue un nuovo capoverso che si avvolge regolarmente come le altre righe\n"
     "e continua con altre parole fino a riempire anche questa riga del testo ok.",
     "alfa beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron\n"
     "Una frase compiuta che arriva fino al margine destro del testo scritto a mano.\n"
     "Poi segue un nuovo capoverso che si avvolge regolarmente come le altre righe\n"
     "e continua con altre parole fino a riempire anche questa riga del testo ok."),
    # an old dispositivo: its short lines are paragraphs, its wrapped lines are not
    ("PER QUESTI MOTIVI\n"
     "LA CORTE COSTITUZIONALE\n"
     "dichiara non fondata la questione di legittimita' costituzionale\n"
     "dell'art. 1 della legge, sollevata dal Tribunale di Roma con\n"
     "l'ordinanza indicata in epigrafe.\n"
     "Cosi' deciso in Roma, il 10 gennaio 1960.\n"
     "Il Presidente\n"
     "Il Redattore",
     "PER QUESTI MOTIVI\n\n"
     "LA CORTE COSTITUZIONALE\n\n"
     "dichiara non fondata la questione di legittimita' costituzionale\n"
     "dell'art. 1 della legge, sollevata dal Tribunale di Roma con\n"
     "l'ordinanza indicata in epigrafe.\n\n"
     "Cosi' deciso in Roma, il 10 gennaio 1960.\n\n"
     "Il Presidente\n\n"
     "Il Redattore"),
    # blank lines stay as they are
    ("Premessa breve.\n\nSeconda parte breve.", "Premessa breve.\n\nSeconda parte breve."),
    # one line: nothing to break
    ("Una sola riga.", "Una sola riga."),
], ids=["long lines", "typewritten", "a sentence ends before the margin",
        "a sentence ends at the margin", "an old dispositivo", "blank lines kept", "one line"])
def test_a_line_break_is_a_paragraph_break_unless_it_is_a_typewriter_wrap(text, expected):
    out = line_paragraphs(text)
    assert out == expected
    assert out.replace("\n", "") == text.replace("\n", "")  # only line breaks are added
    assert "\n\n\n" not in out


def test_every_block_of_a_decision_comes_in_paragraphs():
    block = f"{LONG_FIRST}\n{LONG_SECOND}"
    expected = f"{LONG_FIRST}\n\n{LONG_SECOND}"
    d = to_decision(_record(epigrafe=block, testo=block, dispositivo=block))
    assert d.testo == {"epigrafe": expected, "motivazione": expected, "dispositivo": expected}


def test_a_reasoning_left_in_the_epigrafe_is_split_first_and_then_comes_in_paragraphs():
    first = ("Ritenuto che il giudice rimettente dubita della legittimità costituzionale della "
             "norma censurata;")
    second = ("Considerato che la questione non è fondata, perché la norma non introduce alcuna "
              "disparità di trattamento.")
    d = to_decision(_record(epigrafe=f"ha pronunciato la seguente\n{first}\n{second}"))
    assert d.testo == {"epigrafe": "ha pronunciato la seguente",
                       "motivazione": f"{first}\n\n{second}"}


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
