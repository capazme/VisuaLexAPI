"""`LegalKnowledgeGraph.ingest_norm` carries the act's date, number and annex.

Before, it built `Norma(tipo_atto, data=None, numero_atto=None)`: codes worked
(VisuaLex finds them by name) and every other act reached VisuaLex as
`legge:None;None` (4 Oct 2026, art. 18 l. 247/2012). VisuaLex is mocked here.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.core.legal_knowledge_graph import LegalKnowledgeGraph

N2LS = "https://www.normattiva.it/uri-res/N2Ls?"


def _kg(fetch: AsyncMock) -> LegalKnowledgeGraph:
    kg = LegalKnowledgeGraph()
    kg._connected = True
    kg._normattiva_scraper = SimpleNamespace(get_document=fetch)
    pipeline = MagicMock()
    pipeline.ingest_article = AsyncMock(
        side_effect=lambda *, article, **_: SimpleNamespace(
            article_urn=article.metadata.to_urn(),
            nodes_created=["n"],
            relations_created=[],
            chunks=[],
            bridge_mappings=[],
        )
    )
    kg._ingestion_pipeline = pipeline
    return kg


async def _ingest(kg, *args, **kwargs):
    return await kg.ingest_norm(
        *args,
        include_brocardi=False,
        include_embeddings=False,
        include_bridge=False,
        include_multivigenza=False,
        **kwargs,
    )


async def test_an_ordinary_act_reaches_visualex_and_the_pipeline_with_its_date_and_number():
    fetch = AsyncMock(return_value=("Testo dell'articolo.", N2LS + "urn:nir:stato:legge:2012-12-31;247~art18!vig="))
    kg = _kg(fetch)

    result = await _ingest(kg, "legge", "18", data="2012-12-31", numero_atto="247")

    nv = fetch.await_args.args[0]
    assert (nv.norma.tipo_atto, nv.norma.data, nv.norma.numero_atto, nv.numero_articolo) == (
        "legge", "2012-12-31", "247", "18",
    )
    meta = kg._ingestion_pipeline.ingest_article.await_args.kwargs["article"].metadata
    assert (meta.data, meta.numero_atto) == ("2012-12-31", "247")
    assert result.article_urn == N2LS + "urn:nir:stato:legge:2012-12-31;247~art18"
    assert result.fatal_error is None


async def test_the_annex_reaches_visualex_and_the_article_urn():
    fetch = AsyncMock(return_value=("Testo.", "u"))
    kg = _kg(fetch)

    result = await _ingest(kg, "decreto legislativo", "3", data="2011-06-23", numero_atto="118", allegato="1")

    assert fetch.await_args.args[0].allegato == "1"
    assert result.article_urn == N2LS + "urn:nir:stato:decreto.legislativo:2011-06-23;118:1~art3"


async def test_a_code_still_travels_by_name_alone():
    fetch = AsyncMock(return_value=("Testo.", "u"))
    kg = _kg(fetch)

    result = await _ingest(kg, "codice civile", "2043")

    nv = fetch.await_args.args[0]
    assert (nv.norma.data, nv.norma.numero_atto, nv.allegato) == (None, None, None)
    assert result.article_urn == N2LS + "urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"


async def test_a_failed_fetch_is_a_fatal_error_in_the_result():
    fetch = AsyncMock(side_effect=Exception("Impossibile estrarre il testo dell'articolo"))
    kg = _kg(fetch)

    result = await _ingest(kg, "legge", "18", data="2012-12-31", numero_atto="247")

    assert result.fatal_error == "Impossibile estrarre il testo dell'articolo"
    kg._ingestion_pipeline.ingest_article.assert_not_awaited()


async def test_no_tree_is_requested():
    # The client's tree never carried a position (it reads `number`/`position`,
    # VisuaLex sends `numero`/`allegato`/`url`): asking for it cost a Normattiva
    # request per ingestion and gave nothing.
    kg = _kg(AsyncMock(return_value=("Testo.", "u")))

    with patch(
        "merlt.clients.visualex_client.VisuaLexClient.fetch_tree", new=AsyncMock()
    ) as fetch_tree, patch(
        "merlt.core.legal_knowledge_graph.get_hierarchical_tree", new=AsyncMock()
    ) as tree:
        for args, kwargs in (
            (("codice civile", "2043"), {}),
            (("legge", "18"), {"data": "2012-12-31", "numero_atto": "247"}),
        ):
            result = await _ingest(kg, *args, **kwargs)
            assert result.fatal_error is None

    fetch_tree.assert_not_awaited()
    tree.assert_not_awaited()
    assert kg._ingestion_pipeline.ingest_article.await_args.kwargs["norm_tree"] is None
