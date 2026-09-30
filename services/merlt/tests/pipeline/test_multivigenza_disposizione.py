"""`parse_disposizione` says which part of the modifying act operates the change, and the
writer turns every lettera it returns into a Lettera node: a wrong lettera is a wrong node."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from merlt.clients import Modifica, Norma, NormaVisitata, TipoModifica
from merlt.pipeline.multivigenza import MultivigenzaPipeline, parse_disposizione

ACT = "urn:nir:stato:decreto.legislativo:2001-01-01;1"


def _parsed(numero_articolo, commi, lettere, numeri):
    return {"numero_articolo": numero_articolo, "commi": commi, "lettere": lettere, "numeri": numeri}


@pytest.mark.parametrize(
    "disposizione, expected",
    [
        # the function's own examples: they keep their documented result
        ("art. 12, comma 1, lettera b, numero 3", _parsed("12", ["1"], ["b"], ["3"])),
        ("art. 4, comma 2", _parsed("4", ["2"], [], [])),
        ("art. 22, comma 1, lettera b", _parsed("22", ["1"], ["b"], [])),
        # a list of lettere: the "e" between the last two is the conjunction, not a lettera
        ("art. 5, comma 2, lettere a, b e c", _parsed("5", ["2"], ["a", "b", "c"], [])),
        # the closing parenthesis is not part of the lettera
        ("art. 3, comma 1, lettera a)", _parsed("3", ["1"], ["a"], [])),
        # a lettera with a suffix, and the ones that follow z
        ("art. 7, comma 4, lettera b-bis)", _parsed("7", ["4"], ["b-bis"], [])),
        ("art. 2, comma 1, lettere aa) e bb)", _parsed("2", ["1"], ["aa", "bb"], [])),
        # "e" is also a lettera: the conjunction must not swallow it
        ("art. 4, comma 1, lettera e)", _parsed("4", ["1"], ["e"], [])),
        ("art. 4, comma 1, lettere d) e e)", _parsed("4", ["1"], ["d", "e"], [])),
        # the next part of the disposizione ends the clause, with or without a comma before it
        ("art. 1, comma 2, lettera a), numero 3)", _parsed("1", ["2"], ["a"], ["3"])),
        ("art. 1, comma 2, lettere a) e b) numero 3)", _parsed("1", ["2"], ["a", "b"], ["3"])),
        ("art. 6, comma 1, lettera a), primo periodo", _parsed("6", ["1"], ["a"], [])),
        # the function lowercases and trims what it is given
        ("  Art. 3, Comma 1, Lettera B)  ", _parsed("3", ["1"], ["b"], [])),
    ],
)
def test_parse_disposizione(disposizione, expected):
    assert parse_disposizione(disposizione) == expected


@pytest.mark.parametrize("next_part", ["numero 3", "comma 2", "periodo", "parole da x a y", "art. 5"])
def test_each_keyword_that_starts_another_part_ends_the_lettere_even_without_a_comma(next_part):
    # Without the cut, the last token would be "b) <next part>" and the lettera b would be lost.
    assert parse_disposizione(f"art. 9, comma 1, lettere a) e b) {next_part}")["lettere"] == ["a", "b"]


@pytest.mark.parametrize("empty", ["", "   ", None])
def test_an_empty_disposizione_has_nothing_in_it(empty):
    assert parse_disposizione(empty) == _parsed(None, [], [], [])


class _Recorder:
    def __init__(self):
        self.calls = []

    async def query(self, cypher, params=None):
        self.calls.append((cypher, params or {}))
        return []


async def _write_modification(disposizione):
    """Run the multivigenza pipeline on one amendment whose disposizione is given; return what it wrote."""
    client = _Recorder()
    modifica = Modifica(
        tipo_modifica=TipoModifica.MODIFICA,
        atto_modificante_urn=ACT,
        atto_modificante_estremi="D.Lgs. 1 gennaio 2001, n. 1",
        data_efficacia="2001-02-01",
        data_pubblicazione_gu="2001-01-15",
        disposizione=disposizione,
    )
    scraper = MagicMock(get_amendment_history=AsyncMock(return_value=[modifica]))
    visited = NormaVisitata(
        norma=Norma(tipo_atto="codice civile", data="1942-03-16", numero_atto="262"),
        numero_articolo="1321",
        urn="https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1321",
    )
    result = await MultivigenzaPipeline(falkordb_client=client, scraper=scraper).ingest_with_history(visited)
    return result, client.calls


def _lettera_urns(calls):
    return [params["urn"] for cypher, params in calls if "MERGE (let:Lettera" in cypher]


async def test_a_lettera_followed_by_a_numero_is_one_lettera_node():
    result, calls = await _write_modification("art. 12, comma 1, lettera b, numero 3")
    assert result.errors == []
    assert _lettera_urns(calls) == [f"{ACT}~art12-com1-letb"]  # it used to be b, n, u, m, e, r, o
    numeri = [params["urn"] for cypher, params in calls if "MERGE (num:Numero" in cypher]
    assert numeri == [f"{ACT}~art12-com1-letb-num3"]


async def test_the_lettere_of_a_list_are_one_node_each_and_the_conjunction_is_none():
    result, calls = await _write_modification("art. 5, comma 2, lettere a, b e c")
    assert result.errors == []
    assert _lettera_urns(calls) == [f"{ACT}~art5-com2-let{x}" for x in "abc"]


async def test_a_lettera_with_a_suffix_or_beyond_z_is_a_node_and_does_not_stop_the_article():
    result, calls = await _write_modification("art. 7, comma 4, lettere aa) e b-bis)")
    # `ord()` of a lettera longer than one character used to raise here; the pipeline swallows the
    # exception into `errors` and gives up on every amendment of the article that follows
    assert result.errors == []
    assert _lettera_urns(calls) == [f"{ACT}~art7-com4-letaa", f"{ACT}~art7-com4-letb-bis"]
    # the place of each in its comma: after z come aa, bb…; a suffixed lettera shares its base letter's
    places = [params["ord"] for cypher, params in calls if "(comma)-[r:CONTIENE]->(let)" in cypher]
    assert places == [27, 2]
