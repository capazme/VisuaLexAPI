"""One reference in, one outcome out (design 2026-10-01 §2-§3)."""
import base64
import json
import threading
from datetime import date

import pytest

from visualex_api.services.decisions.http import decisions_http_client
from visualex_api.services.decisions.italgiure import ItalgiureReader
from visualex_api.services.decisions.model import Decision, Identity, parse_reference
from visualex_api.services.decisions.resolver import (
    Resolver,
    SourceUnavailable,
    sweep_decision_caches,
)
from visualex_api.services.http_client import HttpResult
from visualex_api.tools.exceptions import NetworkError

TODAY = date(2026, 10, 1)


def _cass(archivio, numero, anno, sezione):
    return Decision(identita=Identity("cassazione", numero, anno, archivio), sezione=sezione,
                    tipo="sentenza", testo={"motivazione": "t"}, fonte={"nome": "f"})


class FakeItalgiure:
    def __init__(self, decisions=(), start=(2021, "2021-02-17"), down=False, pdfs=None):
        self.decisions = {(d.identita.archivio, d.identita.numero, d.identita.anno): d
                          for d in decisions}
        # down: True for the whole source, or the archives that fail
        self.start, self.down, self.calls, self.start_calls = start, down, [], 0
        self.with_pdf_calls = []
        self.pdfs = pdfs or {}  # the PDF bytes of the decisions that were read from theirs

    async def lookup(self, archivio, numero, anno):
        self.calls.append((archivio, numero, anno))
        if self.down is True or (self.down and archivio in self.down):
            raise NetworkError("Exceeded retry budget")
        return self.decisions.get((archivio, numero, anno))

    async def lookup_with_pdf(self, archivio, numero, anno, with_pdf=True):
        self.with_pdf_calls.append(with_pdf)
        decision = await self.lookup(archivio, numero, anno)
        return None if decision is None else (decision, self.pdfs.get((archivio, numero, anno)))

    async def archive_start(self, archivio):
        self.start_calls += 1
        return self.start


class FakeCorteCost:
    def __init__(self, decisions=()):
        self.decisions = {(d.identita.numero, d.identita.anno): d for d in decisions}

    async def lookup(self, numero, anno):
        return self.decisions.get((numero, anno))


class FakeStore(dict):
    async def get(self, key):
        return super().get(key)

    async def set(self, key, value):
        self[key] = value

    async def delete(self, key):
        self.pop(key, None)


class FakeCache:
    def __init__(self):
        self.stores = {}

    def get_persistent(self, ns):
        return self.stores.setdefault(ns, FakeStore())


HOMONYMS = [_cass("civile", 10787, 2024, "3"), _cass("penale", 10787, 2024, "7")]


def _resolver(italgiure=None, corte_cost=None, cache=None):
    return Resolver(italgiure or FakeItalgiure(), corte_cost or FakeCorteCost(),
                    cache=cache or FakeCache(), today=lambda: TODAY)


def ref(**body):
    return parse_reference({"corte": "cassazione", **body}, TODAY)


async def test_the_named_archive_is_read_alone():
    italgiure = FakeItalgiure(HOMONYMS)
    out = await _resolver(italgiure).resolve(ref(numero=10787, anno=2024, archivio="penale"))
    assert out.esito == "trovata" and out.decisione.sezione == "7"
    assert italgiure.calls == [("penale", 10787, 2024)]


async def test_two_homonyms_and_no_section_ask_the_reader():
    out = await _resolver(FakeItalgiure(HOMONYMS)).resolve(ref(numero=10787, anno=2024))
    assert out.esito == "ambigua"
    assert {c.identita.archivio for c in out.candidati} == {"civile", "penale"}


async def test_a_section_that_matches_one_homonym_picks_it_with_a_notice():
    out = await _resolver(FakeItalgiure(HOMONYMS)).resolve(
        ref(numero=10787, anno=2024, sezione="VII"))
    assert out.esito == "trovata" and out.decisione.identita.archivio == "penale"
    assert out.avvisi == [{"tipo": "archivio_dedotto", "archivio": "penale", "sezione": "7"}]


async def test_a_section_that_matches_neither_homonym_asks_the_reader():
    out = await _resolver(FakeItalgiure(HOMONYMS)).resolve(
        ref(numero=10787, anno=2024, sezione="I"))
    assert out.esito == "ambigua"


async def test_a_wrong_section_opens_the_decision_with_a_notice():
    out = await _resolver(FakeItalgiure(HOMONYMS)).resolve(
        ref(numero=10787, anno=2024, archivio="civile", sezione="I"))
    assert out.esito == "trovata"
    assert out.avvisi == [{"tipo": "sezione_diversa", "citata": "I", "effettiva": "3"}]


async def test_an_unreadable_section_is_ignored_with_a_notice():
    out = await _resolver(FakeItalgiure(HOMONYMS)).resolve(
        ref(numero=10787, anno=2024, archivio="civile", sezione="6-3"))
    assert out.esito == "trovata"
    assert {"tipo": "sezione_non_riconosciuta", "citata": "6-3"} in out.avvisi


@pytest.mark.parametrize("sezione", ["x" * 200, "<b>x</b>"], ids=["200 characters", "markup"])
async def test_a_notice_never_echoes_text_that_is_not_a_section(sezione):
    # the page builds the request from a shareable address: a crafted link must not put its
    # own text inside a VisuaLex notice
    out = await _resolver(FakeItalgiure(HOMONYMS)).resolve(
        ref(numero=10787, anno=2024, archivio="civile", sezione=sezione))
    assert out.esito == "trovata"
    assert {"tipo": "sezione_non_riconosciuta"} in out.avvisi


async def test_a_wrong_section_that_cannot_be_echoed_keeps_its_notice_without_it():
    # read as the Sezioni Unite, but a control character is never echoed
    out = await _resolver(FakeItalgiure(HOMONYMS)).resolve(
        ref(numero=10787, anno=2024, archivio="civile", sezione="sezioni\tunite"))
    assert out.avvisi == [{"tipo": "sezione_diversa", "effettiva": "3"}]


async def test_tributaria_reads_the_civil_archive_only():
    italgiure = FakeItalgiure([_cass("civile", 5, 2022, "5")])
    out = await _resolver(italgiure).resolve(ref(numero=5, anno=2022, sezione="T"))
    assert out.esito == "trovata" and italgiure.calls == [("civile", 5, 2022)]


@pytest.mark.parametrize("anno,motivo,dal", [
    (2024, "inesistente", None),
    (2021, "anno_parziale", "2021-02-17"),
    (2019, "fuori_archivio", "2021-02-17"),
])
async def test_not_found_says_why(anno, motivo, dal):
    out = await _resolver().resolve(ref(numero=1, anno=anno, archivio="civile"))
    assert (out.esito, out.motivo, out.archivio_dal) == ("non_trovata", motivo, dal)


async def test_a_penal_miss_suggests_the_next_year():
    italgiure = FakeItalgiure([_cass("penale", 1399, 2024, "6")])
    out = await _resolver(italgiure).resolve(ref(numero=1399, anno=2023, archivio="penale"))
    assert out.esito == "non_trovata"
    assert out.suggerimento == Identity("cassazione", 1399, 2024, "penale")


async def test_a_civil_miss_suggests_nothing():
    italgiure = FakeItalgiure([_cass("penale", 1399, 2024, "6")])
    out = await _resolver(italgiure).resolve(ref(numero=1399, anno=2023, archivio="civile"))
    assert out.suggerimento is None


async def test_a_source_that_is_down_is_never_not_found():
    with pytest.raises(SourceUnavailable) as e:
        await _resolver(FakeItalgiure(down=True)).resolve(ref(numero=1, anno=2024))
    assert e.value.fonte == "cassazione"


@pytest.mark.parametrize("civil", [[_cass("civile", 1, 2024, "3")], []],
                         ids=["civil found", "civil absent"])
async def test_one_archive_down_is_never_a_lone_hit_nor_not_found(civil):
    # the penal archive could hold a homonym, or the very decision: no answer stands on half
    # the search
    italgiure = FakeItalgiure(civil, down={"penale"})
    with pytest.raises(SourceUnavailable) as e:
        await _resolver(italgiure).resolve(ref(numero=1, anno=2024))
    assert e.value.fonte == "cassazione"
    assert italgiure.calls == [("civile", 1, 2024), ("penale", 1, 2024)]


async def test_found_and_absent_are_cached_per_archive_errors_are_not():
    cache, italgiure = FakeCache(), FakeItalgiure(HOMONYMS)
    resolver = _resolver(italgiure, cache=cache)
    await resolver.resolve(ref(numero=10787, anno=2024, archivio="civile"))
    await resolver.resolve(ref(numero=10787, anno=2024, archivio="civile"))
    await resolver.resolve(ref(numero=2, anno=2024, archivio="civile"))
    await resolver.resolve(ref(numero=2, anno=2024, archivio="civile"))
    assert italgiure.calls == [("civile", 10787, 2024), ("civile", 2, 2024)]
    assert "italgiure:v4:civile:10787:2024" in cache.stores["decisions_found"]
    assert "italgiure:v4:civile:2:2024" in cache.stores["decisions_absent"]
    italgiure.down = True
    with pytest.raises(SourceUnavailable):
        await resolver.resolve(ref(numero=3, anno=2024, archivio="civile"))
    assert "italgiure:v4:civile:3:2024" not in cache.stores["decisions_absent"]


async def test_a_decision_without_its_text_says_so_and_is_kept_a_day():
    withheld = Decision(identita=Identity("cassazione", 10787, 2024, "civile"), sezione="3",
                        tipo="ordinanza", testo_assente="oscuramento", fonte={"nome": "f"})
    cache, italgiure = FakeCache(), FakeItalgiure([withheld])
    resolver = _resolver(italgiure, cache=cache)
    out = await resolver.resolve(ref(numero=10787, anno=2024, archivio="civile"))
    assert out.esito == "trovata" and out.avvisi == [{"tipo": "testo_non_disponibile"}]
    assert "italgiure:v4:civile:10787:2024" in cache.stores["decisions_pending"]
    assert "italgiure:v4:civile:10787:2024" not in cache.stores["decisions_found"]
    again = await resolver.resolve(ref(numero=10787, anno=2024, archivio="civile"))
    assert again.avvisi == [{"tipo": "testo_non_disponibile"}]
    assert italgiure.calls == [("civile", 10787, 2024)]
    # read back from decisions_pending, it still says why the text is missing
    assert again.decisione.testo_assente == "oscuramento"
    assert again.to_dict()["attributi"]["testo_assente"] == "oscuramento"


async def test_an_unreadable_archive_start_is_asked_again_on_the_next_miss():
    italgiure = FakeItalgiure(start=None)
    resolver = _resolver(italgiure)
    first = await resolver.resolve(ref(numero=1, anno=2019, archivio="civile"))
    await resolver.resolve(ref(numero=2, anno=2019, archivio="civile"))
    assert (first.motivo, first.archivio_dal) == ("fuori_archivio", None)
    assert italgiure.start_calls == 2


async def test_the_corte_costituzionale():
    sentenza = Decision(identita=Identity("corte_costituzionale", 1, 2014), tipo="sentenza")
    resolver = _resolver(corte_cost=FakeCorteCost([sentenza]))
    found = await resolver.resolve(parse_reference(
        {"corte": "corte_costituzionale", "numero": 1, "anno": 2014}, TODAY))
    missing = await resolver.resolve(parse_reference(
        {"corte": "corte_costituzionale", "numero": 999, "anno": 2014}, TODAY))
    assert found.esito == "trovata" and (missing.esito, missing.motivo) == ("non_trovata",
                                                                            "inesistente")


async def test_a_search_sends_at_most_ten_requests_to_italgiure(monkeypatch):
    # the owner's ceiling (2026-10-04), through the real reader: the worst case is no archive
    # named, a number below 10000, a miss, the first of the day, and the penal next year. The
    # client's own retries of a failed request are not counted.
    methods = []
    start = json.dumps({"response": {"docs": [{"datdep": "20210217"}]}})
    empty = json.dumps({"response": {"numFound": 0, "docs": []}})

    async def fake_request(method, url, **kwargs):
        methods.append(method)
        if method == "GET":
            return HttpResult(text="", status=200, headers={})
        return HttpResult(text=start if "sort" in kwargs["data"] else empty, status=200,
                          headers={})

    monkeypatch.setattr(decisions_http_client, "request", fake_request)
    resolver = _resolver(ItalgiureReader())
    out = await resolver.resolve(ref(numero=123, anno=2023))
    assert (out.esito, out.motivo) == ("non_trovata", "inesistente")
    assert methods == ["POST"] * 5
    methods.clear()
    await resolver.resolve(ref(numero=124, anno=2023))  # each archive's start: once a day
    assert methods == ["POST"] * 3


async def test_a_corte_costituzionale_decision_cached_before_the_split_is_never_served():
    # pull request A cached what its reader returned, the epigrafe unsplit, for up to 30 days:
    # the key carries a version, so this reader never meets those entries
    unsplit = Decision(identita=Identity("corte_costituzionale", 3, 2014), tipo="ordinanza",
                       testo={"epigrafe": "ha pronunciato la seguente\nRitenuto che"})
    split = Decision(identita=Identity("corte_costituzionale", 3, 2014), tipo="ordinanza",
                     testo={"epigrafe": "ha pronunciato la seguente", "motivazione": "Ritenuto che"})
    cache = FakeCache()
    cache.get_persistent("decisions_found")["corte_cost:3:2014"] = unsplit.to_dict()
    out = await _resolver(corte_cost=FakeCorteCost([split]), cache=cache).resolve(
        parse_reference({"corte": "corte_costituzionale", "numero": 3, "anno": 2014}, TODAY))
    assert out.decisione.testo == split.testo
    assert "corte_cost:v2:3:2014" in cache.stores["decisions_found"]


async def test_a_cassazione_decision_cached_before_the_paragraphs_is_never_served():
    # pull request A cached what its reader returned for up to 30 days: a notice of the source
    # as the court's reasons, and texts of one line. The key carries a version, so this reader
    # never meets those entries.
    notice = Decision(identita=Identity("cassazione", 10787, 2024, "civile"), sezione="3",
                      tipo="sentenza", testo={"motivazione": "in fase di valutazione oscuramento"},
                      fonte={"nome": "f"})
    text = Decision(identita=Identity("cassazione", 10787, 2024, "civile"), sezione="3",
                    tipo="sentenza", testo={"motivazione": "Premessa. \n\nFATTI DI CAUSA Il fatto."},
                    fonte={"nome": "f"})
    cache, italgiure = FakeCache(), FakeItalgiure([text])
    cache.get_persistent("decisions_found")["italgiure:civile:10787:2024"] = notice.to_dict()
    out = await _resolver(italgiure, cache=cache).resolve(
        ref(numero=10787, anno=2024, archivio="civile"))
    assert out.decisione.testo == text.testo
    assert italgiure.calls == [("civile", 10787, 2024)]  # the reader was asked, not the old entry
    assert "italgiure:v4:civile:10787:2024" in cache.stores["decisions_found"]


async def test_a_text_read_from_the_pdf_has_no_notice_and_keeps_the_pdf():
    d = _cass("civile", 5, 2022, "1")
    d.testo_origine = "pdf"
    cache = FakeCache()
    out = await _resolver(FakeItalgiure([d], pdfs={("civile", 5, 2022): b"%PDF-1.4 bytes"}),
                          cache=cache).resolve(ref(numero=5, anno=2022, archivio="civile"))
    assert out.avvisi == [] and out.decisione.testo_origine == "pdf"
    assert out.to_dict()["attributi"]["testo_origine"] == "pdf"
    assert "italgiure:v4:civile:5:2022" in cache.stores["decisions_found"]
    assert base64.b64decode(cache.stores["decisions_pdf"]["cassazione:civile:5:2022"]) == b"%PDF-1.4 bytes"


async def test_a_text_from_the_archive_says_so_and_is_kept_a_day_only():
    d = _cass("civile", 5, 2022, "1")
    d.testo_origine = "archivio"
    cache, italgiure = FakeCache(), FakeItalgiure([d])
    resolver = _resolver(italgiure, cache=cache)
    out = await resolver.resolve(ref(numero=5, anno=2022, archivio="civile"))
    assert out.avvisi == [{"tipo": "testo_da_archivio"}] and out.decisione.testo
    assert "italgiure:v4:civile:5:2022" in cache.stores["decisions_pending"]
    assert "italgiure:v4:civile:5:2022" not in cache.stores.get("decisions_found", {})
    assert "decisions_pdf" not in cache.stores or not cache.stores["decisions_pdf"]
    again = await resolver.resolve(ref(numero=5, anno=2022, archivio="civile"))
    assert again.avvisi == [{"tipo": "testo_da_archivio"}]  # the notice survives the cache
    assert len(italgiure.calls) == 1


async def test_a_pdf_cache_that_cannot_be_written_is_not_an_unreachable_court():
    d = _cass("civile", 5, 2022, "1")
    d.testo_origine = "pdf"

    class Broken(FakeStore):
        async def set(self, key, value):
            raise OSError("disk full")

    cache = FakeCache()
    cache.stores["decisions_pdf"] = Broken()
    out = await _resolver(FakeItalgiure([d], pdfs={("civile", 5, 2022): b"%PDF"}),
                          cache=cache).resolve(ref(numero=5, anno=2022, archivio="civile"))
    assert out.esito == "trovata" and out.decisione.testo


async def test_a_suggestion_reads_the_record_only_and_keeps_nothing():
    d = _cass("penale", 1399, 2025, "1")
    cache, italgiure = FakeCache(), FakeItalgiure([d])
    out = await _resolver(italgiure, cache=cache).resolve(ref(numero=1399, anno=2024, archivio="penale"))
    assert out.suggerimento == d.identita
    assert italgiure.with_pdf_calls[-1] is False
    assert "italgiure:v4:penale:1399:2025" not in cache.stores.get("decisions_found", {})
    assert "italgiure:v4:penale:1399:2025" not in cache.stores.get("decisions_pending", {})


async def test_a_search_with_a_suggestion_hit_stays_within_ten_requests(monkeypatch):
    # the worst cold case ends in a hit of the penal next year: the record is read, its PDF is not
    methods, urls = [], []
    start = json.dumps({"response": {"docs": [{"datdep": "20210217"}]}})
    empty = json.dumps({"response": {"numFound": 0, "docs": []}})
    hit = json.dumps({"response": {"numFound": 1, "docs": [{
        "numdec": "00123", "anno": "2024", "kind": "snpen", "szdec": "1", "ocr": "testo " * 100,
        "filename": "./20240101/snpen@s10@a2024@n123@tO.pdf"}]}})

    async def fake_request(method, url, **kwargs):
        methods.append(method)
        urls.append(url)
        if method == "GET":
            return HttpResult(text="", status=200, headers={})
        data = kwargs["data"]
        body = start if "sort" in data else hit if "anno:2024" in data["q"] else empty
        return HttpResult(text=body, status=200, headers={})

    monkeypatch.setattr(decisions_http_client, "request", fake_request)
    out = await _resolver(ItalgiureReader()).resolve(ref(numero=123, anno=2023))
    assert out.esito == "non_trovata" and out.suggerimento is not None
    assert len(methods) <= 10 and not any("verbo=attach" in u for u in urls)


def test_the_outcomes_as_json():
    from visualex_api.services.decisions.resolver import Outcome
    d = _cass("civile", 10787, 2024, "3")
    assert Outcome("trovata", decisione=d).to_dict() == {"esito": "trovata", **d.to_dict(),
                                                         "avvisi": []}
    amb = Outcome("ambigua", candidati=HOMONYMS).to_dict()
    assert amb["candidati"][0] == {"identita": HOMONYMS[0].identita.to_dict(),
                                   "attributi": HOMONYMS[0].to_dict()["attributi"]}
    miss = Outcome("non_trovata", motivo="fuori_archivio", archivio_dal="2021-02-17").to_dict()
    assert miss == {"esito": "non_trovata", "motivo": "fuori_archivio",
                    "archivio_dal": "2021-02-17"}


class SweptStore(FakeStore):
    """A filesystem backend: it deletes its expired entries when asked."""

    def __init__(self, expired):
        super().__init__()
        self.expired, self.threads = expired, []

    def sweep_expired(self):
        self.threads.append(threading.get_ident())
        return self.expired


async def test_the_sweep_reaches_the_decision_caches_only():
    cache = FakeCache()
    cache.stores.update({
        "decisions_found": SweptStore(3),
        "decisions_absent": SweptStore(2),
        "decisions_pending": FakeStore(),  # like Redis, which expires its keys itself
        "normattiva": SweptStore(7),
    })
    assert await sweep_decision_caches(cache) == 5
    found, absent = cache.stores["decisions_found"], cache.stores["decisions_absent"]
    assert len(found.threads) == len(absent.threads) == 1
    # off the event loop: a sweep reads every file of the cache
    assert threading.get_ident() not in found.threads + absent.threads
    assert cache.stores["normattiva"].threads == []
    assert set(cache.stores) == {"decisions_found", "decisions_absent", "decisions_pending",
                                 "decisions_pdf", "decisions_search", "normattiva"}


# --- the court's original PDF (design 2026-10-05 §12.2) ---

class PdfItalgiure:
    def __init__(self, data=b"%PDF-1.4 bytes", error=None):
        self.data, self.error, self.calls = data, error, []

    async def original_pdf(self, archivio, numero, anno):
        self.calls.append((archivio, numero, anno))
        if self.error:
            raise self.error
        return self.data


FOUND_KEY = "italgiure:v4:civile:5:2022"
PDF_KEY = "cassazione:civile:5:2022"


async def test_original_pdf_is_read_from_the_cache_without_a_request():
    cache = FakeCache()
    cache.stores["decisions_found"] = FakeStore({FOUND_KEY: {"text": "kept"}})
    cache.stores["decisions_pdf"] = FakeStore(
        {"cassazione:civile:5:2022": base64.b64encode(b"%PDF-1.4 cached").decode()})
    italgiure = PdfItalgiure()
    out = await _resolver(italgiure, cache=cache).original_pdf(Identity("cassazione", 5, 2022, "civile"))
    assert out == b"%PDF-1.4 cached" and italgiure.calls == []


async def test_original_pdf_is_fetched_once_and_cached():
    cache, italgiure = FakeCache(), PdfItalgiure()
    resolver = _resolver(italgiure, cache=cache)
    identity = Identity("cassazione", 5, 2022, "civile")
    assert await resolver.original_pdf(identity) == b"%PDF-1.4 bytes"
    # the copy is served again only once the decision's text is cached (a lookup does that)
    await resolver.found.set(FOUND_KEY, {"text": "kept"})
    assert await resolver.original_pdf(identity) == b"%PDF-1.4 bytes"
    assert italgiure.calls == [("civile", 5, 2022)]
    assert base64.b64decode(cache.stores["decisions_pdf"]["cassazione:civile:5:2022"]) == b"%PDF-1.4 bytes"


@pytest.mark.parametrize("data", [None, b"<html>", b"%PDF-" + b"0" * (5 * 1024 * 1024)])
async def test_original_pdf_that_is_none_or_not_a_pdf_caches_nothing(data):
    cache = FakeCache()
    out = await _resolver(PdfItalgiure(data), cache=cache).original_pdf(Identity("cassazione", 5, 2022, "civile"))
    assert out is None and not cache.stores.get("decisions_pdf")


async def test_a_cached_entry_that_is_not_a_pdf_is_ignored():
    cache = FakeCache()
    cache.stores["decisions_found"] = FakeStore({FOUND_KEY: {"text": "kept"}})
    cache.stores["decisions_pdf"] = FakeStore(
        {"cassazione:civile:5:2022": base64.b64encode(b"<html>").decode()})
    italgiure = PdfItalgiure()
    await _resolver(italgiure, cache=cache).original_pdf(Identity("cassazione", 5, 2022, "civile"))
    assert italgiure.calls == [("civile", 5, 2022)]


async def test_original_pdf_source_errors_propagate():
    with pytest.raises(NetworkError):
        await _resolver(PdfItalgiure(error=NetworkError("down")), cache=FakeCache()).original_pdf(
            Identity("cassazione", 5, 2022, "civile"))


async def test_a_cached_entry_that_is_not_base64_is_ignored_and_refetched():
    cache = FakeCache()
    cache.stores["decisions_found"] = FakeStore({FOUND_KEY: {"text": "kept"}})
    cache.stores["decisions_pdf"] = FakeStore({PDF_KEY: "!!!"})
    italgiure = PdfItalgiure()
    out = await _resolver(italgiure, cache=cache).original_pdf(Identity("cassazione", 5, 2022, "civile"))
    assert out == b"%PDF-1.4 bytes" and italgiure.calls == [("civile", 5, 2022)]


async def test_a_cached_pdf_without_the_text_entry_is_not_served_and_is_dropped():
    # the court withheld the decision: the source now gives no PDF, and the old copy is gone
    cache = FakeCache()
    cache.stores["decisions_pdf"] = FakeStore({PDF_KEY: base64.b64encode(b"%PDF-1.4 old").decode()})
    italgiure = PdfItalgiure(None)
    out = await _resolver(italgiure, cache=cache).original_pdf(Identity("cassazione", 5, 2022, "civile"))
    assert out is None and italgiure.calls == [("civile", 5, 2022)]
    assert PDF_KEY not in cache.stores["decisions_pdf"]
