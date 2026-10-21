"""The TULPS is annex 1 of r.d. 18 giugno 1931, n. 773 (G-351).

Asked as «r.d. 773/1931, art. 86» it is keyed by its annex, like a code by its default
one: the decree's own article is the approval of the testo unico, and «…;773~art86»
answered its art. 1. The label is the act's, with no «(Allegato 1)».
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.tools.map import act_default_annex
from visualex_api.tools.sources import cite_article

BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1931-06-18;773"
TREE = ([{"numero": "1", "allegato": None}, {"numero": "1", "allegato": "1"},
         {"numero": "86", "allegato": "1"}], 3, {})
ACT = {"act_type": "regio decreto", "date": "1931-06-18", "act_number": "773"}


async def _found(**extra):
    ctrl = NormaController.__new__(NormaController)
    with patch("app.get_tree", new=AsyncMock(return_value=TREE)):
        return await ctrl.create_norma_visitata_from_data({**ACT, **extra})


@pytest.mark.asyncio
@pytest.mark.parametrize("article", ["1", "86"])
async def test_the_tulps_is_its_annex(article):
    found = await _found(article=article)
    assert [(nv.numero_articolo, nv.allegato) for nv in found] == [(article, "1")]
    assert found[0].urn == f"{BASE}:1~art{article}"


@pytest.mark.asyncio
async def test_the_decree_asked_explicitly_is_the_decree():
    found = await _found(article="1", annex="")
    assert found[0].urn == f"{BASE}~art1"


@pytest.mark.parametrize("act,annex", [
    ("regio.decreto:1931-06-18;773", "1"),
    (BASE, "1"),
    (f"{BASE}~art86", "1"),
    ("regio.decreto:1931-06-18;774", None),
    ("legge:1990-08-07;241", None),
])
def test_act_default_annex(act, annex):
    assert act_default_annex(act) == annex


def test_the_label_names_no_annex():
    norm = {"tipo_atto": "regio decreto", "numero_atto": "773", "data": "1931-06-18", "allegato": "1",
            "numero_articolo": "86"}
    assert cite_article(norm) == "art. 86, r.d. 18 giugno 1931, n. 773"
    assert cite_article({**norm, "allegato": "2"}) == "art. 86, r.d. 18 giugno 1931, n. 773 (Allegato 2)"
