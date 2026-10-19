"""The article-entities reader names a node by its key, never by FalkorDB's internal id."""
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.api.graph_router import get_article_entities

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1322"


async def test_article_entities_are_named_by_urn_or_node_id():
    client = MagicMock(connect=AsyncMock(), close=AsyncMock(), query=AsyncMock(return_value=[]), ro_query=AsyncMock(return_value=[]))
    with patch("merlt.api.graph_router.FalkorDBClient", return_value=client):
        await get_article_entities(CC, validation_status=None, api_key=None)
    cypher = (client.query.await_args or client.ro_query.await_args).args[0]
    assert "COALESCE(e.URN, e.node_id) as entity_id" in cypher
    assert "id(e)" not in cypher  # an internal id changes when a node is recreated: no client can keep it
