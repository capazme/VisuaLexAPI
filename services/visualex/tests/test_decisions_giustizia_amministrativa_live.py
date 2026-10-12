"""giustizia-amministrativa.it, live (`-m live`): one search and one document, as the reader makes
them. Excluded from the default run; how the reader is re-checked when the portal changes.

    cd services/visualex && .venv/bin/python -m pytest tests/test_decisions_giustizia_amministrativa_live.py -m live -q
"""
import pytest

from visualex_api.services.decisions.giustizia_amministrativa import GiustiziaAmministrativaReader

pytestmark = [pytest.mark.live, pytest.mark.asyncio(loop_scope="module")]


async def test_a_number_of_the_consiglio_di_stato_lists_each_kind_and_reads_the_sentenza():
    reader = GiustiziaAmministrativaReader()
    results = await reader.search("Consiglio di Stato", 2270, 2019)
    kinds = {r.kind for r in results}
    assert {"SENTENZA", "ORDINANZA CAUTELARE"} <= kinds
    assert all((r.anno, r.numero) == (2019, 2270) for r in results)
    sentenza = next(r for r in results if r.kind == "SENTENZA")
    assert sentenza.ecli == "ECLI:IT:CDS:2019:2270SENT"
    testo, published = await reader.text(sentenza)
    assert testo["epigrafe"].startswith("Il Consiglio di Stato")
    assert testo["dispositivo"].startswith("P.Q.M.")
    assert published == "2019-04-08"
