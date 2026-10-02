"""Retrieval before and after a change to the graph (spec section 9).

The semantic gold standard (Libro IV, 30 graded queries), every source type,
the top 10 articles, scored per article in canonical form. Read-only. Run it
before and after the migration and compare: no metric may drop by more than 0.02.

    python -m merlt.scripts.retrieval_gate

It reads the stores the stack reads, with the stack's configuration: Qdrant at
QDRANT_HOST/QDRANT_PORT, the collection `default_chunks_collection()` names, the
embedding model EmbeddingService picks from the environment. It refuses to score
nothing: a missing or empty collection, no queries, or a query with no relevant
article stops it, because each would read as a score that is not one. So does a
hit rate of 0: a "before" of 0 would let any "after" pass. An exit that is not 0
stops the round.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from typing import Any

import structlog

from merlt.benchmark.metrics import (
    compute_graded_relevance_metrics,
    compute_retrieval_metrics,
    distinct_in_order,
)
from merlt.storage.graph.schema import canonical_urn

log = structlog.get_logger()

# Articles scored per query: NDCG@10 is the deepest metric.
TOP_K = 10


def _articles(urns: list[str]) -> list[str]:
    """The top TOP_K articles of a search, each once, in canonical form; a hit
    without a URN belongs to no article and takes no rank."""
    return distinct_in_order([key for key in (canonical_urn(u) for u in urns) if key])[:TOP_K]


def _canonical_grades(grades: dict[str, int]) -> dict[str, int]:
    canonical: dict[str, int] = {}
    for urn, grade in grades.items():
        key = canonical_urn(urn)
        canonical[key] = max(grade, canonical.get(key, grade))
    return canonical


def summarize(retrieved: list[list[str]], relevant: list[list[str]], graded: list[dict[str, int]]) -> dict[str, Any]:
    """The gate's numbers. Raises instead of scoring no data: with no queries the
    metrics read 0, and a query with nothing relevant reads a perfect recall."""
    if not retrieved:
        raise ValueError("no queries: nothing to score")
    if not len(retrieved) == len(relevant) == len(graded):
        raise ValueError(f"{len(retrieved)} results for {len(relevant)} queries and {len(graded)} gradings")
    for index, (urns, grades) in enumerate(zip(relevant, graded)):
        if not urns or not grades:
            raise ValueError(f"query {index} has no relevant article: it cannot be scored")
    retrieved = [_articles(urns) for urns in retrieved]
    relevant = [[canonical_urn(u) for u in urns] for urns in relevant]
    graded = [_canonical_grades(grades) for grades in graded]
    plain = compute_retrieval_metrics(retrieved, relevant)
    scored = compute_graded_relevance_metrics(retrieved, graded)
    return {
        "queries": len(retrieved),
        "recall_at_5": plain.recall_at_5,
        "mrr": plain.mrr,
        "hit_rate_at_5": plain.hit_rate_at_5,
        "ndcg_at_10": scored.ndcg_at_10,
    }


def require_hits(summary: dict[str, Any]) -> dict[str, Any]:
    """The summary, unless no query found a relevant article in its top 5: then
    retrieval is broken or the gold standard does not match the collection, and a
    "before" of 0 would let any "after" pass."""
    if not summary["hit_rate_at_5"]:
        raise SystemExit(
            f"hit_rate_at_5 is 0 over {summary['queries']} queries: retrieval is broken or the gold "
            f"standard does not match the collection. {json.dumps(summary)}"
        )
    return summary


def require_points(qdrant, collection: str) -> int:
    """The number of points in the collection; stops the gate when there are none.
    Checked before LegalKnowledgeGraph connects: finding no collection, it would
    create an empty one, and the gate would read 0 before and after, and pass."""
    if not qdrant.collection_exists(collection_name=collection):
        raise SystemExit(f"Qdrant collection {collection!r} is missing or empty: nothing to measure")
    points = qdrant.count(collection_name=collection, exact=True).count
    if not points:
        raise SystemExit(f"Qdrant collection {collection!r} is missing or empty: nothing to measure")
    return points


async def run() -> dict[str, Any]:
    import dataclasses

    from qdrant_client import QdrantClient

    from merlt import LegalKnowledgeGraph
    from merlt.benchmark.gold_standard import create_semantic_gold_standard
    from merlt.benchmark.rag_benchmark import CHUNKS_PER_ARTICLE, RAGBenchmark
    from merlt.storage.vectors.collection import default_chunks_collection
    from merlt.storage.vectors.embeddings import EmbeddingService
    from merlt.worker.config import merlt_config_from_env

    gold = create_semantic_gold_standard()
    if not len(gold):
        raise SystemExit("the gold standard has no queries: nothing to measure")
    # The collection the migration migrates and the stack reads. LegalKnowledgeGraph()
    # alone would use its hardcoded development defaults.
    config = dataclasses.replace(merlt_config_from_env(), qdrant_collection=default_chunks_collection())
    qdrant = QdrantClient(host=config.qdrant_host, port=config.qdrant_port)
    try:
        points = require_points(qdrant, config.qdrant_collection)
    finally:
        qdrant.close()
    log.info("retrieval gate", collection=config.qdrant_collection, points=points, queries=len(gold))
    # The stack's model: EmbeddingService reads EMBEDDING_MODEL when it is first built, and
    # LegalKnowledgeGraph.connect would build it with MerltConfig's default instead.
    EmbeddingService.get_instance()
    kg = LegalKnowledgeGraph(config)
    await kg.connect()
    try:
        if kg._qdrant is None or kg._embedding_service is None:
            raise SystemExit("no Qdrant or no embedding model after connect: nothing to measure")
        bench = RAGBenchmark(kg, gold)
        retrieved = []
        for query in gold:
            # A search returns chunks: ask for enough that TOP_K articles survive.
            hits = await bench._search_with_source_filter(query.text, "all", TOP_K * CHUNKS_PER_ARTICLE)
            retrieved.append([hit["urn"] for hit in hits])
    finally:
        await kg.close()
    return require_hits(summarize(retrieved, [q.relevant_urns for q in gold], [q.relevance_scores for q in gold]))


def main() -> None:
    argparse.ArgumentParser(
        description="Score retrieval on the semantic gold standard (read-only); compare a run "
        "before and after a change to the graph.",
    ).parse_args()
    # stdout carries the numbers alone, as JSON; the log goes to stderr.
    structlog.configure(
        logger_factory=structlog.PrintLoggerFactory(sys.stderr),
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    )
    print(json.dumps(asyncio.run(run()), indent=2))


if __name__ == "__main__":
    main()
