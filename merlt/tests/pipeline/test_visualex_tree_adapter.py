"""Unit tests for the VisuaLex tree-extractor adapter (mechanical ingestion,
design doc §8/§9 step 2). The real `VisuaLexClient` is never hit — every
test injects a fake client implementing just the four methods the adapter
calls (`fetch_norma_data`, `fetch_tree`, `fetch_article_text`,
`extract_citations`).

Run inside the MERL-T env:
    pip install -e ".[dev]" && pytest tests/pipeline/test_visualex_tree_adapter.py
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import pytest

from merlt.pipeline.mechanical_ingestion import parser as parser_module
from merlt.pipeline.mechanical_ingestion.parser import VisualexTreeAdapter

_BASE_URL = "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262"
_BASE_URN_WITH_ANNEX = f"{_BASE_URL}:2"


@dataclass
class _FakeNorma:
    url: str
    tipo_atto_reale: Optional[str] = None


@dataclass
class _FakeNormaVisitata:
    norma: _FakeNorma
    allegato: Optional[str] = None


@dataclass
class _FakeTreeResult:
    articles: list
    count: int = 0
    metadata: Optional[dict] = None
    error: Optional[str] = None


@dataclass
class _FakeArticleResult:
    text: str
    url: str = ""
    norma_data: dict = field(default_factory=dict)
    error: Optional[str] = None


class _FakeVisuaLexClient:
    """Configurable fake standing in for `merlt.clients.VisuaLexClient`."""

    def __init__(
        self,
        *,
        tree_articles: list[dict[str, Any]],
        texts: dict[str, str],
        citations: Optional[dict[str, list[dict[str, Any]]]] = None,
        errors: Optional[dict[str, str]] = None,
        allegato: Optional[str] = "2",
        tipo_atto_reale: Optional[str] = "regio decreto",
        act_base_url: str = _BASE_URL,
    ):
        self._tree_articles = tree_articles
        self._texts = texts
        self._citations = citations or {}
        self._errors = errors or {}
        self._allegato = allegato
        self._tipo_atto_reale = tipo_atto_reale
        self._act_base_url = act_base_url
        self.fetch_article_text_calls: list[str] = []

    async def fetch_norma_data(self, act_type: str, article: str):
        return [
            _FakeNormaVisitata(
                norma=_FakeNorma(url=self._act_base_url, tipo_atto_reale=self._tipo_atto_reale),
                allegato=self._allegato,
            )
        ]

    async def fetch_tree(self, urn: str, link: bool, details: bool, return_metadata: bool):
        return _FakeTreeResult(articles=self._tree_articles, count=len(self._tree_articles))

    async def fetch_article_text(
        self, act_type: str, article: str, annex: Optional[str] = None, **_
    ):
        self.fetch_article_text_calls.append(article)
        numeri = article.split(",")
        results = []
        for numero in numeri:
            if numero in self._errors:
                results.append(
                    _FakeArticleResult(
                        text="", norma_data={"numero_articolo": numero}, error=self._errors[numero]
                    )
                )
            else:
                results.append(
                    _FakeArticleResult(
                        text=self._texts.get(numero, ""),
                        url=f"{_BASE_URN_WITH_ANNEX}~art{numero}",
                        norma_data={"numero_articolo": numero},
                    )
                )
        return results

    async def extract_citations(self, text: str, context_act_type: Optional[str] = None):
        for numero, cites in self._citations.items():
            if self._texts.get(numero) == text:
                return cites
        return []


def _make_client(**kwargs) -> _FakeVisuaLexClient:
    defaults = dict(
        tree_articles=[
            {"numero": "1", "allegato": "2"},
            {"numero": "2", "allegato": "2"},
            {"numero": "30 bis", "allegato": "2"},
            {"numero": "1", "allegato": None},  # dispositivo article of the enacting decree
        ],
        texts={
            "1": "Art. 1. \n\n (Delle persone). \n\n Testo dell'articolo 1, richiama l'art. 2.",
            "2": "Art. 2. \n\n (Capacità). \n\n Testo dell'articolo 2.",
            "30-bis": "Art. 30-bis. \n\n Testo senza rubrica.",
        },
    )
    defaults.update(kwargs)
    return _FakeVisuaLexClient(**defaults)


@pytest.mark.asyncio
async def test_norma_node_shape_matches_seed_schema():
    client = _make_client()
    adapter = VisualexTreeAdapter(client=client)

    result = await adapter.parse('{"act_type": "codice civile"}')
    nodes = result["nodes"]
    assert len(nodes) == 3  # articles 1, 2, 30-bis — NOT the dispositivo "1"

    art1 = next(n for n in nodes if n["properties"]["numero_articolo"] == "1")
    assert art1["properties"]["URN"] == f"{_BASE_URN_WITH_ANNEX}~art1"
    assert art1["properties"]["node_id"] == f"{_BASE_URN_WITH_ANNEX}~art1"
    assert art1["properties"]["url"] == f"{_BASE_URN_WITH_ANNEX}~art1"
    assert art1["id"] == f"{_BASE_URN_WITH_ANNEX}~art1"
    assert art1["labels"] == ["Norma"]
    assert art1["properties"]["tipo_documento"] == "articolo"
    assert art1["properties"]["estremi"] == "Art. 1 c.c."
    assert art1["properties"]["titolo"] == "Art. 1 c.c."
    assert art1["properties"]["rubrica"] == "(Delle persone)."
    assert art1["properties"]["vigenza"] == "vigente"
    assert art1["properties"]["autorita_emanante"] == "Regio Decreto"
    assert "Testo dell'articolo 1" in art1["properties"]["testo_vigente"]


@pytest.mark.asyncio
async def test_article_number_suffix_concatenated_in_urn_but_hyphenated_in_property():
    """Mirrors the italia_corpus adapter's convention: URN concatenates
    bis/ter/... (`~art30bis`) while `numero_articolo` stays hyphenated
    ("30-bis") — verified against the real seed."""
    client = _make_client()
    adapter = VisualexTreeAdapter(client=client)
    result = await adapter.parse('{"act_type": "codice civile"}')
    art_bis = next(n for n in result["nodes"] if n["properties"]["numero_articolo"] == "30-bis")
    assert art_bis["properties"]["URN"] == f"{_BASE_URN_WITH_ANNEX}~art30bis"
    assert art_bis["properties"]["estremi"] == "Art. 30-bis c.c."
    assert art_bis["properties"]["rubrica"] == ""  # no rubrica in source text — graceful empty


@pytest.mark.asyncio
async def test_rinvia_edge_from_mocked_citation():
    client = _make_client(
        citations={"1": [{"article": "2", "act_type": "codice civile", "display_text": "art. 2"}]}
    )
    adapter = VisualexTreeAdapter(client=client)
    result = await adapter.parse('{"act_type": "codice civile"}')

    art1_urn = f"{_BASE_URN_WITH_ANNEX}~art1"
    art2_urn = f"{_BASE_URN_WITH_ANNEX}~art2"
    matching = [e for e in result["edges"] if e["start"] == art1_urn and e["end"] == art2_urn]
    assert len(matching) == 1
    assert matching[0]["type"] == "RINVIA"
    assert matching[0]["properties"] == {}


@pytest.mark.asyncio
async def test_cross_act_citation_is_skipped():
    """A citation to a DIFFERENT act (e.g. codice penale) is skipped — resolving
    its base URN would need a per-citation network round-trip, out of scope
    for this mechanical pass (design doc §8)."""
    client = _make_client(
        citations={
            "1": [{"article": "5", "act_type": "codice penale", "display_text": "art. 5 c.p."}]
        }
    )
    adapter = VisualexTreeAdapter(client=client)
    result = await adapter.parse('{"act_type": "codice civile"}')
    assert result["edges"] == []


@pytest.mark.asyncio
async def test_per_article_error_is_isolated_not_fatal():
    client = _make_client(errors={"2": "scraper timeout"})
    adapter = VisualexTreeAdapter(client=client)
    result = await adapter.parse('{"act_type": "codice civile"}')

    numeri = {n["properties"]["numero_articolo"] for n in result["nodes"]}
    assert numeri == {"1", "30-bis"}  # article 2 skipped, run not aborted


@pytest.mark.asyncio
async def test_source_ref_scope_range_limits_articles():
    client = _make_client()
    adapter = VisualexTreeAdapter(client=client)
    result = await adapter.parse('{"act_type": "codice civile", "articles": "1-2"}')

    numeri = {n["properties"]["numero_articolo"] for n in result["nodes"]}
    assert numeri == {"1", "2"}
    # the batch fetch never even requested "30-bis"
    assert all("30-bis" not in call for call in client.fetch_article_text_calls)


@pytest.mark.asyncio
async def test_source_ref_whole_act_when_articles_omitted():
    client = _make_client()
    adapter = VisualexTreeAdapter(client=client)
    result = await adapter.parse('{"act_type": "codice civile"}')

    numeri = {n["properties"]["numero_articolo"] for n in result["nodes"]}
    assert numeri == {"1", "2", "30-bis"}


@pytest.mark.asyncio
async def test_invalid_source_ref_raises_value_error():
    adapter = VisualexTreeAdapter(client=_make_client())
    with pytest.raises(ValueError):
        await adapter.parse("not json")


@pytest.mark.asyncio
async def test_source_ref_missing_act_type_raises_value_error():
    adapter = VisualexTreeAdapter(client=_make_client())
    with pytest.raises(ValueError, match="act_type"):
        await adapter.parse("{}")


@pytest.mark.asyncio
async def test_no_articles_in_target_annex_raises_value_error():
    client = _make_client(
        tree_articles=[{"numero": "1", "allegato": None}],  # nothing under the target annex "2"
    )
    adapter = VisualexTreeAdapter(client=client)
    with pytest.raises(ValueError, match="no articles found"):
        await adapter.parse('{"act_type": "codice civile"}')


@pytest.mark.asyncio
async def test_chunk_fetch_failure_is_isolated_not_fatal(monkeypatch):
    """A whole-chunk network failure (e.g. VisuaLex outage mid-run) must skip
    that chunk's articles, not abort the batch. Chunk size forced to 1 so the
    two articles land in separate chunks and only one of them fails."""
    monkeypatch.setattr(parser_module, "_FETCH_CHUNK_SIZE", 1)

    class _FlakyClient(_FakeVisuaLexClient):
        async def fetch_article_text(self, act_type, article, annex=None, **_):
            self.fetch_article_text_calls.append(article)
            if "30-bis" in article:
                raise RuntimeError("connection reset")
            return await super().fetch_article_text(act_type, article, annex=annex)

    client = _FlakyClient(
        tree_articles=[
            {"numero": "1", "allegato": "2"},
            {"numero": "30 bis", "allegato": "2"},
        ],
        texts={"1": "Art. 1. \n\n Testo.", "30-bis": "Art. 30-bis. \n\n Testo."},
    )
    adapter = VisualexTreeAdapter(client=client)
    result = await adapter.parse('{"act_type": "codice civile"}')

    numeri = {n["properties"]["numero_articolo"] for n in result["nodes"]}
    assert numeri == {"1"}
    assert (
        "30-bis" in client.fetch_article_text_calls
    )  # the failing chunk was attempted, not skipped
