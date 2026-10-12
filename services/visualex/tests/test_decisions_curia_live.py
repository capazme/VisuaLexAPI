"""The CGUE reader against the real source (`-m live`), design 2026-10-12 §4.

Excluded from the default run: it asks the Publications Office's repository for three judgments
(a query and a document each), with the client's own pacing and three seconds between cases. It is
how the reader is re-checked when the source changes its markup or its metadata.

    cd services/visualex && .venv/bin/python -m pytest tests/test_decisions_curia_live.py -m live -q
"""
import asyncio

import pytest

from visualex_api.services.decisions.curia import CuriaReader
from visualex_api.services.decisions.model import Identity

pytestmark = [pytest.mark.live, pytest.mark.asyncio(loop_scope="module")]

PAUSE = 3


@pytest.mark.parametrize("corte,numero,anno,identity,sezione", [
    ("corte_giustizia_ue", 634, 2021, Identity("corte_giustizia_ue", 634, 2021), "I"),
    # a joined case: found under the first one
    ("corte_giustizia_ue", 594, 2012, Identity("corte_giustizia_ue", 293, 2012), "grande"),
    ("tribunale_ue", 612, 2017, Identity("tribunale_ue", 612, 2017), "IX ampliata"),
])
async def test_a_real_judgment_is_read_whole(corte, numero, anno, identity, sezione):
    await asyncio.sleep(PAUSE)
    [decision] = await CuriaReader().lookup(corte, numero, anno)
    assert decision.identita == identity and decision.sezione == sezione
    assert decision.ecli and decision.data_decisione and decision.lingua_processuale
    assert set(decision.testo) == {"epigrafe", "motivazione", "dispositivo"}
    assert decision.testo["dispositivo"].startswith("Per questi motivi")


async def test_a_case_with_no_judgment_is_none():
    await asyncio.sleep(PAUSE)
    assert await CuriaReader().lookup("corte_giustizia_ue", 9999, 2021) == []
