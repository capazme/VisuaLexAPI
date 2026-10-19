"""The benchmark scores articles: one entry per article, with its best chunk's
score and type, and k distinct articles however many chunks an article has."""
import asyncio
from types import SimpleNamespace

from merlt.benchmark.gold_standard import GoldStandard, Query, QueryCategory
from merlt.benchmark.rag_benchmark import (
    CHUNKS_PER_ARTICLE,
    BenchmarkConfig,
    RAGBenchmark,
)

A, B, C = "urn:a", "urn:b", "urn:c"


def _hit(urn, score, source_type):
    payload = {"source_type": source_type, "text": "t"}
    if urn is not None:
        payload["article_urn"] = urn
    return SimpleNamespace(payload=payload, score=score)


class _FakeEmbedding:
    async def encode_query_async(self, text):
        return [0.0]


class _FakeQdrant:
    def __init__(self, points):
        self.points = points
        self.limits = []

    def query_points(self, collection_name, query, query_filter, limit):
        self.limits.append(limit)
        return SimpleNamespace(points=self.points[:limit])


def _benchmark(points, top_k):
    qdrant = _FakeQdrant(points)
    kg = SimpleNamespace(
        _embedding_service=_FakeEmbedding(),
        _qdrant=qdrant,
        config=SimpleNamespace(qdrant_collection="chunks"),
    )
    query = Query(
        id="Q1",
        text="q",
        category=QueryCategory.CONCETTUALE,
        expected_article=A,
        relevant_urns=[A, B],
    )
    gold = GoldStandard(queries=[query])
    return RAGBenchmark(kg, gold, BenchmarkConfig(top_k=top_k)), qdrant


def _run(benchmark):
    return asyncio.run(benchmark._run_queries_for_source("all"))[0]


def test_each_article_keeps_its_first_chunks_score_and_type():
    benchmark, _ = _benchmark(
        [_hit(A, 0.9, "norma"), _hit(A, 0.8, "ratio"), _hit(B, 0.7, "norma")],
        top_k=10,
    )
    result = _run(benchmark)
    assert result.retrieved_urns == [A, B]
    assert result.scores == [0.9, 0.7]
    assert result.source_types == ["norma", "norma"]


def test_top_k_counts_distinct_articles():
    points = [
        _hit(A, 0.9, "norma"), _hit(A, 0.8, "ratio"), _hit(A, 0.7, "massima"),
        _hit(B, 0.6, "norma"), _hit(B, 0.5, "ratio"),
        _hit(C, 0.4, "norma"),
    ]
    benchmark, qdrant = _benchmark(points, top_k=2)
    result = _run(benchmark)
    assert qdrant.limits == [2 * CHUNKS_PER_ARTICLE]
    assert result.retrieved_urns == [A, B]
    assert result.scores == [0.9, 0.6]
    assert CHUNKS_PER_ARTICLE == 3


def test_a_hit_without_a_urn_is_skipped():
    benchmark, _ = _benchmark(
        [_hit(None, 0.95, "norma"), _hit(A, 0.9, "norma"), _hit(None, 0.8, "ratio"),
         _hit(B, 0.7, "norma")],
        top_k=10,
    )
    result = _run(benchmark)
    assert result.retrieved_urns == [A, B]
    assert result.scores == [0.9, 0.7]
    assert result.source_types == ["norma", "norma"]
