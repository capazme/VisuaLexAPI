"""Four codes whose text is the decree's annex, keyed like the codice civile (G-350).

Measured live on Normattiva: the codice del turismo, the norme di attuazione del
c.p.p., the regolamento di esecuzione del codice della navigazione and the codici
penali militari are annex 1 of the decree that approves them (the military codes:
peace annex 1, war annex 2), and the decree's own URN answers with the decree's
articles. Like the c.c. and the c.p., the row carries the annex, the norm stores it
(`allegato`), and asking for the dispositivo explicitly (`annex: ""`) still reaches the
decree.
"""
from unittest.mock import AsyncMock, patch

import pytest

from app import NormaController
from visualex_api.tools.map import extract_codice_details
from visualex_api.tools.urngenerator import generate_urn

BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"

CODES = [
    ("codice del turismo", "decreto.legislativo:2011-05-23;79", "1"),
    ("norme di attuazione, di coordinamento e transitorie del codice di procedura penale",
     "decreto.legislativo:1989-07-28;271", "1"),
    ("approvazione del Regolamento per l'esecuzione del Codice della navigazione (Navigazione marittima)",
     "decreto.del.presidente.della.repubblica:1952-02-15;328", "1"),
    ("codici penali militari di pace e di guerra", "regio.decreto:1941-02-20;303", "1"),
]


def _tree(annex):
    # The decree's own articles and the code's: art. 1 in both, art. 50 only in the code.
    return ([{"numero": "1", "allegato": None}, {"numero": "2", "allegato": None},
             {"numero": "1", "allegato": annex}, {"numero": "50", "allegato": annex}], 4, {})


async def _found(act_type, article, annex_tree="1", **extra):
    ctrl = NormaController.__new__(NormaController)
    with patch("app.get_tree", new=AsyncMock(return_value=_tree(annex_tree))):
        return await ctrl.create_norma_visitata_from_data({"act_type": act_type, "article": article, **extra})


@pytest.mark.asyncio
@pytest.mark.parametrize("name,decree,annex", CODES, ids=[c[1] for c in CODES])
@pytest.mark.parametrize("article", ["1", "50"])
async def test_the_code_is_its_annex(name, decree, annex, article):
    found = await _found(name, article)
    assert [(nv.numero_articolo, nv.allegato) for nv in found] == [(article, annex)]
    assert found[0].urn == f"{BASE}{decree}:{annex}~art{article}"


@pytest.mark.asyncio
@pytest.mark.parametrize("name,decree,annex", CODES, ids=[c[1] for c in CODES])
async def test_the_dispositivo_asked_explicitly_is_the_decree(name, decree, annex):
    found = await _found(name, "1", annex="")
    assert [(nv.numero_articolo, nv.allegato) for nv in found] == [("1", None)]
    assert found[0].urn == f"{BASE}{decree}~art1"


@pytest.mark.asyncio
async def test_the_war_code_is_annex_2():
    found = await _found("codici penali militari di pace e di guerra", "50", annex_tree="2", annex="2")
    assert found[0].urn == f"{BASE}regio.decreto:1941-02-20;303:2~art50"


def test_the_military_codes_are_a_regio_decreto():
    # The row said «relazione.e.regio.decreto»: the type token of another document.
    details = extract_codice_details("codici penali militari di pace e di guerra")
    assert details == {"tipo_atto_reale": "regio decreto", "data": "1941-02-20", "numero_atto": "303"}


@pytest.mark.parametrize("name,decree,annex", CODES, ids=[c[1] for c in CODES])
def test_generate_urn_with_the_stored_annex(name, decree, annex):
    assert generate_urn(name, article="5", annex=annex) == f"{BASE}{decree}:{annex}~art5"


@pytest.mark.asyncio
async def test_an_article_of_the_war_code_only_is_found_where_it_is():
    """The row names two codes: an article only in the war code (annex 2) is refused
    naming annex 1 and saying where it is, never «non presente» in the codici."""
    from visualex_api.tools.exceptions import ResourceNotFoundError

    tree = ([{"numero": "1", "allegato": None}, {"numero": "1", "allegato": "1"},
             {"numero": "300", "allegato": "2"}], 3, {})
    ctrl = NormaController.__new__(NormaController)
    with patch("app.get_tree", new=AsyncMock(return_value=tree)), pytest.raises(ResourceNotFoundError) as refused:
        await ctrl.create_norma_visitata_from_data(
            {"act_type": "codici penali militari di pace e di guerra", "article": "300"})
    assert "non presente nell'allegato 1 di" in str(refused.value)
    assert str(refused.value).endswith(": su Normattiva l'art. 300 si trova nell'allegato 2")


@pytest.mark.asyncio
async def test_another_code_keeps_its_plain_refusal():
    from visualex_api.tools.exceptions import ResourceNotFoundError

    tree = ([{"numero": "1", "allegato": None}, {"numero": "1", "allegato": "1"}], 2, {})
    ctrl = NormaController.__new__(NormaController)
    with patch("app.get_tree", new=AsyncMock(return_value=tree)), pytest.raises(ResourceNotFoundError) as refused:
        await ctrl.create_norma_visitata_from_data({"act_type": "codice del turismo", "article": "300"})
    assert str(refused.value).startswith("Articolo 300 non presente in ")


@pytest.mark.parametrize("norm,citation", [
    ({"tipo_atto": "codice del turismo", "allegato": "1", "numero_articolo": "5"},
     "art. 5, d.lgs. 23 maggio 2011, n. 79"),
    # a code cited by its sigla, like the c.c. (G-360, G-366)
    ({"tipo_atto": "codice del processo amministrativo", "allegato": "2", "numero_articolo": "29"},
     "art. 29 c.p.a."),
    ({"tipo_atto": "codice della navigazione", "allegato": "1", "numero_articolo": "69"}, "art. 69 cod. nav."),
    ({"tipo_atto": "codice postale e delle telecomunicazioni", "allegato": "1", "numero_articolo": "20"},
     "art. 20 cod. post."),
    ({"tipo_atto": "codice di giustizia contabile", "allegato": "1", "numero_articolo": "52"}, "art. 52 c.g.c."),
    # another annex of a code's decree is not the code: cited by the decree, its annex named
    ({"tipo_atto": "codice del processo amministrativo", "allegato": "3", "numero_articolo": "1"},
     "art. 1, d.lgs. 2 luglio 2010, n. 104 (Allegato 3)"),
    ({"tipo_atto": "codice civile", "allegato": "1", "numero_articolo": "12"},
     "art. 12, r.d. 16 marzo 1942, n. 262 (Allegato 1)"),
    # the name as a stored norm may carry it, capitalised and with a double space
    ({"tipo_atto": "Codice  del processo amministrativo", "allegato": "3", "numero_articolo": "1"},
     "art. 1, d.lgs. 2 luglio 2010, n. 104 (Allegato 3)"),
    # an annex other than the code's default is still named, for a code cited by its decree
    ({"tipo_atto": "codice del turismo", "allegato": "2", "numero_articolo": "5"},
     "art. 5, d.lgs. 23 maggio 2011, n. 79 (Allegato 2)"),
    ({"tipo_atto": "decreto legislativo", "numero_atto": "81", "data": "2008-04-09", "allegato": "A",
      "numero_articolo": "1"}, "art. 1, d.lgs. 9 aprile 2008, n. 81 (Allegato A)"),
])
def test_a_codes_default_annex_is_never_named(norm, citation):
    # The code is its annex, as the c.c. is Allegato 2 of r.d. 262/1942 (owner, G-351's spirit).
    from visualex_api.tools.sources import cite_article
    assert cite_article(norm) == citation
