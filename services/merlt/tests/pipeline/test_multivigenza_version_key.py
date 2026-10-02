"""A past version is written under its own key, never the live article's."""
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from merlt.pipeline.multivigenza import MultivigenzaPipeline

CC = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


async def test_a_version_is_merged_under_version_urn_and_linked_to_the_article():
    client = AsyncMock()
    client.query.return_value = []
    pipeline = MultivigenzaPipeline(falkordb_client=client, scraper=MagicMock())
    pipeline._timestamp = "2026-10-01T00:00:00+00:00"
    # urngenerator appends "!vig=" to a vigente URN: today the key becomes "…!vig=!vig=2020-01-01"
    # and VERSIONE_DI looks for an article keyed "…!vig=", which does not exist.
    await pipeline._save_version(SimpleNamespace(urn=CC + "!vig="), version_label="v1", version_date="2020-01-01", testo="t")
    merge_params, link_params = (call.args[1] for call in client.query.await_args_list[:2])
    assert merge_params["urn"] == CC + "!vig=2020-01-01"
    assert link_params == {"ver_urn": CC + "!vig=2020-01-01", "art_urn": CC}
