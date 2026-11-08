"""Acts whose text is annex 1 of the decree that approves them, like the TULPS (G-351).

The legge fallimentare (r.d. 267/1942), the c.p.p. minorile (d.P.R. 448/1988) and the testo
unico sulle successioni e donazioni (d.lgs. 346/1990): on Normattiva the decree's own article 1
is «È approvato il testo, allegato…», and «…;448~art1» answered it as the act's art. 1, the
wrong article. Keyed by the annex (`ANNEXED_ACTS`), cited with no «(Allegato 1)».
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.tools.map import act_default_annex
from visualex_api.tools.sources import cite_article

ACTS = [
    ("regio decreto", "1942-03-16", "267", "regio.decreto", "art. 1, r.d. 16 marzo 1942, n. 267"),
    ("decreto del presidente della repubblica", "1988-09-22", "448", "decreto.del.presidente.della.repubblica",
     "art. 1, d.p.r. 22 settembre 1988, n. 448"),
    ("decreto legislativo", "1990-10-31", "346", "decreto.legislativo", "art. 1, d.lgs. 31 ottobre 1990, n. 346"),
]
IDS = [a[2] for a in ACTS]


def _tree():
    # The decree's own article 1 (the approval) and the act's, in annex 1.
    return ([{"numero": "1", "allegato": None}, {"numero": "1", "allegato": "1"}, {"numero": "40", "allegato": "1"}], 3, {})


async def _found(kind, date, number, **extra):
    ctrl = NormaController.__new__(NormaController)
    with patch("app.get_tree", new=AsyncMock(return_value=_tree())):
        return await ctrl.create_norma_visitata_from_data(
            {"act_type": kind, "date": date, "act_number": number, **extra})


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,date,number,urn_kind,citation", ACTS, ids=IDS)
@pytest.mark.parametrize("article", ["1", "40"])
async def test_the_act_is_its_annex(kind, date, number, urn_kind, citation, article):
    found = await _found(kind, date, number, article=article)
    assert [(nv.numero_articolo, nv.allegato) for nv in found] == [(article, "1")]
    assert found[0].urn.endswith(f"{urn_kind}:{date};{number}:1~art{article}")


@pytest.mark.asyncio
@pytest.mark.parametrize("kind,date,number,urn_kind,citation", ACTS, ids=IDS)
async def test_the_decree_asked_explicitly_is_the_decree(kind, date, number, urn_kind, citation):
    found = await _found(kind, date, number, article="1", annex="")
    assert found[0].urn.endswith(f"{urn_kind}:{date};{number}~art1")


@pytest.mark.parametrize("kind,date,number,urn_kind,citation", ACTS, ids=IDS)
def test_the_label_names_no_annex(kind, date, number, urn_kind, citation):
    assert act_default_annex(f"{urn_kind}:{date};{number}") == "1"
    norm = {"tipo_atto": kind, "numero_atto": number, "data": date, "allegato": "1", "numero_articolo": "1"}
    assert cite_article(norm) == citation
    assert cite_article({**norm, "allegato": "2"}) == citation + " (Allegato 2)"
