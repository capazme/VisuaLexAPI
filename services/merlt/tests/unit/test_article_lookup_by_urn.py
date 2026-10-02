"""An article is found by its canonical URN, never by its number alone."""
from unittest.mock import AsyncMock

import pytest

from merlt.storage.graph.client import FalkorDBClient
from merlt.tools.external_source import ExternalSourceTool

BASE = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:"
CP52 = BASE + "regio.decreto:1930-10-19;1398:1~art52"
CC1453 = BASE + "regio.decreto:1942-03-16;262:2~art1453"
CPC52 = BASE + "regio.decreto:1940-10-28;1443:1~art52"
CPP52 = BASE + "decreto.del.presidente.della.repubblica:1988-09-22;447~art52"
CC2BIS = BASE + "regio.decreto:1942-03-16;262:2~art2bis"


async def test_related_nodes_are_looked_up_by_the_canonical_urn():
    client = FalkorDBClient.__new__(FalkorDBClient)  # no connection: the calls are replaced
    client.ro_query = AsyncMock(return_value=[])  # a pure read
    client.query = AsyncMock(return_value=[])
    await client.get_related_nodes_for_article(CP52 + "!vig=2024-01-01")
    client.query.assert_not_awaited()
    cypher, params = client.ro_query.await_args.args
    assert params == {"urn": CP52}
    assert "numero_articolo" not in cypher


@pytest.mark.parametrize("query, urn", [
    ("art. 52 c.p.", CP52),
    ("articolo 1453 codice civile", CC1453),
    ("art. 2-bis c.p.", BASE + "regio.decreto:1930-10-19;1398:1~art2bis"),
    ("art. 2 bis c.p.", BASE + "regio.decreto:1930-10-19;1398:1~art2bis"),
    ("art. 5 terzo comma c.p.", BASE + "regio.decreto:1930-10-19;1398:1~art5"),
    ("art. 52 c.p.c.", BASE + "regio.decreto:1940-10-28;1443:1~art52"),
    ("art. 52 c.p.p.", BASE + "decreto.del.presidente.della.repubblica:1988-09-22;447~art52"),
    ("urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453", CC1453),
    (CC1453 + "@originale", CC1453),
    # a code written without its final dot, spaced, or run together
    ("art. 52 c.p.c", CPC52),
    ("art. 52 c.p.p", CPP52),
    ("art. 52 c. p. c.", CPC52),
    ("art. 52 cpc", CPC52),
    ("art. 52 cpp", CPP52),
    ("art. 52 cp", CP52),
    ("art. 1453 cc", CC1453),
    ("art. 52 C.P.C.", CPC52),
    # the code that follows the article, not the first one in the string
    ("art. 1453 c.c. e c.p.c.", CC1453),
    ("art. 1453 c.c. c.p.c.", CC1453),
    ("art. 52 c.p. c.c.", CP52),
    # an implementing provision is not the code
    ("art. 52 disp. att. c.c.", None),
    ("art. 52 disposizioni attuative c.c.", None),
    # the code written before the article
    ("c.c. art. 1453", CC1453),
    ("codice civile, art. 1453", CC1453),
    ("Codice civile - art. 1453", CC1453),
    ("c.p.c.: art. 52", CPC52),
    ("codice di procedura civile, art. 52", CPC52),
    ("codice di procedura penale art. 52", CPP52),
    ("codice penale, art. 52", CP52),
    ("c.p. c.c. art. 1453", CC1453),
    # a code that follows still wins over one that comes before
    ("c.p. art. 1453 c.c.", CC1453),
    ("c.c. art. 1453 e art. 52 c.p.", CC1453),
    # the Costituzione has no pinned graph key
    ("Cost. art. 2", None),
    ("art. 2 Cost.", None),
    # the implementing provisions are never the code, whichever side the code stands
    ("c.c. disp. att. art. 5", None),
    ("c.c. disp. trans. art. 5", None),
    ("c.c. art. 52 disp. att. c.p.", None),
    # a code that belongs to another act
    ("art. 2 della legge 241/1990, art. 3 c.c.", BASE + "regio.decreto:1942-03-16;262:2~art3"),
    ("art. 2 della legge 241/1990 c.c.", None),
    ("art. 2 d.lgs. 231 c.c.", None),
    ("art. 2 dlgs 231/2001 c.p.", None),
    ("art. 2 del d.p.r. 447 c.p.p.", None),
    ("art. 2 dpr c.c.", None),
    ("art. 2 del decreto ministeriale c.c.", None),
    ("art. 2 l. 241 c.c.", None),
    ("art. 2 e art. 3 c.c.", BASE + "regio.decreto:1942-03-16;262:2~art3"),
    # the article token
    ("part 5 c.c.", None),
    ("art. 2 - bis c.c.", CC2BIS),
    ("art. 2bis c.c.", CC2BIS),
    ("art. 5 terzo comma c.c.", BASE + "regio.decreto:1942-03-16;262:2~art5"),
])
def test_a_citation_becomes_the_graph_key(query, urn):
    assert ExternalSourceTool()._parse_urn_from_query(query) == urn


@pytest.mark.parametrize("query, parsed", [
    ("art. 52 c.p.c.", {"tipo_atto": "codice di procedura civile", "articolo": "52"}),
    ("art. 52 c.p.p", {"tipo_atto": "codice di procedura penale", "articolo": "52"}),
    ("art. 2 bis c.c.", {"tipo_atto": "codice civile", "articolo": "2bis"}),
    ("art. 5 terzo comma c.p.", {"tipo_atto": "codice penale", "articolo": "5"}),
    ("art. 1453 c.c. e c.p.c.", {"tipo_atto": "codice civile", "articolo": "1453"}),
    ("art. 52 disp. att. c.c.", None),
    ("art. 2 Cost.", {"tipo_atto": "costituzione", "articolo": "2"}),
    ("Cost. art. 2", {"tipo_atto": "costituzione", "articolo": "2"}),
    ("c.c. art. 1453", {"tipo_atto": "codice civile", "articolo": "1453"}),
    ("codice civile, art. 1453", {"tipo_atto": "codice civile", "articolo": "1453"}),
    ("c.c. disp. att. art. 5", None),
    ("art. 2 della legge 241/1990, art. 3 c.c.", {"tipo_atto": "codice civile", "articolo": "3"}),
    ("art. 2 della legge 241/1990 c.c.", None),
    ("articolo 2 della Costituzione", {"tipo_atto": "costituzione", "articolo": "2"}),
    ("risoluzione per inadempimento", None),
])
def test_a_citation_becomes_a_normattiva_request(query, parsed):
    assert ExternalSourceTool()._parse_normattiva_query(query) == parsed


def test_a_query_without_a_citation_has_no_urn():
    assert ExternalSourceTool()._parse_urn_from_query("risoluzione per inadempimento") is None


class _Graph:
    """A graph that answers read-only calls; a call to `query`, which may write, is recorded."""

    def __init__(self):
        self.ro_query = AsyncMock(return_value=[{"text": "t", "urn": CC1453, "estremi": "Art. 1453 c.c.", "numero": "1453"}])
        self.query = AsyncMock(return_value=[])


@pytest.mark.parametrize("query, params", [
    ("art. 1453 c.c.", {"urn": CC1453}),
    # the text an LLM could pass after reading a hostile document
    ("x' }) DETACH DELETE a //", {"query": "x' }) DETACH DELETE a //"}),
])
async def test_the_graph_lookup_is_read_only_and_takes_the_query_as_a_parameter(query, params):
    graph = _Graph()
    found = await ExternalSourceTool(graph_db=graph)._search_graph(query)
    graph.query.assert_not_awaited()
    cypher, sent = graph.ro_query.await_args.args
    assert sent == params
    assert query not in cypher and "DETACH" not in cypher
    assert "coalesce(a.testo, a.testo_vigente)" in cypher
    assert found["urn"] == CC1453
