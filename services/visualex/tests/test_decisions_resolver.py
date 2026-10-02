"""One reference in, one outcome out (design 2026-10-01 §2-§3)."""
import threading
from datetime import date

import pytest

from visualex_api.services.decisions.model import Decision, Identity, parse_reference
from visualex_api.services.decisions.resolver import (
    Resolver,
    SourceUnavailable,
    sweep_decision_caches,
)
from visualex_api.tools.exceptions import NetworkError

TODAY = date(2026, 10, 1)


def _cass(archivio, numero, anno, sezione):
    return Decision(identita=Identity("cassazione", numero, anno, archivio), sezione=sezione,
                    tipo="sentenza", testo={"motivazione": "t"}, fonte={"nome": "f"})


class FakeItalgiure:
    def __init__(self, decisions=(), start=(2021, "2021-02-17"), down=False):
        self.decisions = {(d.identita.archivio, d.identita.numero, d.identita.anno): d
                          for d in decisions}
        self.start, self.down, self.calls, self.start_calls = start, down, [], 0

    async def lookup(self, archivio, numero, anno):
        self.calls.append((archivio, numero, anno))
        if self.down:
            raise NetworkError("Exceeded retry budget")
        return self.decisions.get((archivio, numero, anno))

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


async def test_found_and_absent_are_cached_per_archive_errors_are_not():
    cache, italgiure = FakeCache(), FakeItalgiure(HOMONYMS)
    resolver = _resolver(italgiure, cache=cache)
    await resolver.resolve(ref(numero=10787, anno=2024, archivio="civile"))
    await resolver.resolve(ref(numero=10787, anno=2024, archivio="civile"))
    await resolver.resolve(ref(numero=2, anno=2024, archivio="civile"))
    await resolver.resolve(ref(numero=2, anno=2024, archivio="civile"))
    assert italgiure.calls == [("civile", 10787, 2024), ("civile", 2, 2024)]
    assert "italgiure:civile:10787:2024" in cache.stores["decisions_found"]
    assert "italgiure:civile:2:2024" in cache.stores["decisions_absent"]
    italgiure.down = True
    with pytest.raises(SourceUnavailable):
        await resolver.resolve(ref(numero=3, anno=2024, archivio="civile"))
    assert "italgiure:civile:3:2024" not in cache.stores["decisions_absent"]


async def test_a_decision_without_its_text_says_so_and_is_kept_a_day():
    withheld = Decision(identita=Identity("cassazione", 10787, 2024, "civile"), sezione="3",
                        tipo="ordinanza", testo_assente="oscuramento", fonte={"nome": "f"})
    cache, italgiure = FakeCache(), FakeItalgiure([withheld])
    resolver = _resolver(italgiure, cache=cache)
    out = await resolver.resolve(ref(numero=10787, anno=2024, archivio="civile"))
    assert out.esito == "trovata" and out.avvisi == [{"tipo": "testo_non_disponibile"}]
    assert "italgiure:civile:10787:2024" in cache.stores["decisions_pending"]
    assert "italgiure:civile:10787:2024" not in cache.stores["decisions_found"]
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
                                 "normattiva"}
