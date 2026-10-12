"""The resolver for the administrative courts (design 2026-10-12-administrative-courts §5, D2-D3)."""
import asyncio
from datetime import date

import pytest

from visualex_api.services.decisions import giustizia_amministrativa as ga
from visualex_api.services.decisions.giustizia_amministrativa import Result
from visualex_api.services.decisions.model import parse_reference
from visualex_api.services.decisions.resolver import Resolver, SourceUnavailable
from visualex_api.tools.exceptions import NetworkError

TODAY = date(2026, 10, 12)
URL = "https://mdp.giustizia-amministrativa.it/visualizza/?nodeRef=&schema=cds&nrg=1&nomeFile=209900042_11.html&subDir=Provvedimenti"


def r(kind: str, numero=42, anno=2020, sezione="SEZIONE 6") -> Result:
    return Result(kind, "x", sezione, anno, numero, "1", f"ECLI:IT:CDS:{anno}:{numero}{kind}", URL)


class MemoryCache:
    def __init__(self):
        self.data = {}

    def get_persistent(self, name):
        cache = self

        class NS:
            async def get(self, key):
                return cache.data.get((name, key))

            async def set(self, key, value):
                cache.data[(name, key)] = value
        return NS()


class FakeAdmin:
    """The portal: what each seat lists, and a text for every document."""

    def __init__(self, by_seat=None, error=None):
        self.by_seat, self.error = by_seat or {}, error
        self.searches, self.texts = [], 0

    async def search(self, sede, numero, anno):
        self.searches.append(sede)
        if self.error:
            raise self.error
        return self.by_seat.get(sede, [])

    async def text(self, result):
        self.texts += 1
        return {"motivazione": "Il testo."}, "2020-03-04"


def resolver(admin, cache=None):
    return Resolver(None, None, cache=cache or MemoryCache(), today=lambda: TODAY, curia=object(), admin=admin)


def ref(**body):
    return parse_reference({"numero": 42, "anno": 2020, **body}, TODAY)


async def test_no_kind_named_is_the_sentenza_with_its_text():
    admin = FakeAdmin({"Consiglio di Stato": [r("OCAU"), r("SENT"), r("PINTE")]})
    outcome = await resolver(admin).resolve(ref(corte="consiglio_di_stato"))
    assert outcome.esito == "trovata"
    d = outcome.decisione
    assert d.identita.key() == "consiglio_di_stato:sent:42:2020"
    assert (d.sezione, d.tipo, d.data_deposito, d.testo) == ("VI", "sentenza", "2020-03-04", {"motivazione": "Il testo."})


async def test_a_year_without_a_sentenza_lists_what_it_holds_and_never_picks_one():
    admin = FakeAdmin({"Consiglio di Stato": [r("OCAU"), r("DCAU"), r("PINTE")]})
    outcome = await resolver(admin).resolve(ref(corte="consiglio_di_stato"))
    assert outcome.esito == "ambigua"
    assert sorted(c.identita.provvedimento for c in outcome.candidati) == ["dcau", "ocau"]  # never the parere
    assert admin.texts == 0


async def test_a_family_named_is_its_kinds_and_two_of_them_are_ambiguous():
    admin = FakeAdmin({"Consiglio di Stato": [r("OCAU"), r("OCOL"), r("SENT")]})
    outcome = await resolver(admin).resolve(ref(corte="consiglio_di_stato", tipo="ordinanza"))
    assert outcome.esito == "ambigua" and len(outcome.candidati) == 2
    outcome = await resolver(admin).resolve(ref(corte="consiglio_di_stato", provvedimento="ocol"))
    assert outcome.esito == "trovata" and outcome.decisione.identita.provvedimento == "ocol"


async def test_nothing_of_the_kind_named_is_not_found():
    admin = FakeAdmin({"Consiglio di Stato": [r("OCAU")]})
    outcome = await resolver(admin).resolve(ref(corte="consiglio_di_stato", tipo="sentenza"))
    assert (outcome.esito, outcome.motivo) == ("non_trovata", "inesistente")
    outcome = await resolver(FakeAdmin()).resolve(ref(corte="consiglio_di_stato"))
    assert outcome.esito == "non_trovata"


async def test_a_tar_named_by_its_region_searches_every_seat_and_says_which_one():
    admin = FakeAdmin({"Latina": [r("SENT")]})
    outcome = await resolver(admin).resolve(ref(corte="tar", regione="Lazio"))
    assert admin.searches == ["Roma", "Latina"]
    assert outcome.decisione.identita.key() == "tar:latina:sent:42:2020"
    assert {"tipo": "sede_dedotta", "sede": "Latina"} in outcome.avvisi


async def test_two_seats_of_a_region_holding_the_number_are_ambiguous():
    admin = FakeAdmin({"Roma": [r("SENT")], "Latina": [r("SENT")]})
    outcome = await resolver(admin).resolve(ref(corte="tar", regione="Lazio"))
    assert outcome.esito == "ambigua"
    assert sorted(c.identita.sede for c in outcome.candidati) == ["latina", "roma"]


async def test_a_tar_named_by_its_seat_searches_that_seat_alone_and_says_nothing():
    admin = FakeAdmin({"Roma": [r("SENT")]})
    outcome = await resolver(admin).resolve(ref(corte="tar", sede="roma"))
    assert admin.searches == ["Roma"] and outcome.avvisi == []


async def test_the_search_and_the_text_are_kept():
    cache = MemoryCache()
    admin = FakeAdmin({"Consiglio di Stato": [r("SENT")]})
    for _ in range(2):
        await resolver(admin, cache).resolve(ref(corte="consiglio_di_stato"))
    assert len(admin.searches) == 1 and admin.texts == 1
    assert ("decisions_found", "ga:v1:consiglio_di_stato:sent:42:2020") in cache.data


@pytest.mark.parametrize("error", [NetworkError("down"), ga.SourceChanged("modulo"), asyncio.TimeoutError()])
async def test_a_source_that_fails_or_changed_is_unreachable_never_not_found(error):
    cache = MemoryCache()
    with pytest.raises(SourceUnavailable):
        await resolver(FakeAdmin(error=error), cache).resolve(ref(corte="consiglio_di_stato"))
    assert cache.data == {}
