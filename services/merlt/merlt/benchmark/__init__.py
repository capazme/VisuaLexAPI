"""
MERL-T Benchmark Module
=======================

Framework per benchmark sistematici di RAG su knowledge graph giuridici.

Componenti:
- metrics: Metriche IR (Recall@K, MRR, Hit Rate, NDCG)
- gold_standard: Gestione dataset di query annotate
- rag_benchmark: Framework di benchmark completo

Uso:
    >>> from merlt.benchmark import RAGBenchmark, GoldStandard
    >>> from merlt.benchmark.metrics import recall_at_k, mrr
    >>>
    >>> # Carica gold standard
    >>> gs = GoldStandard.from_file("gold_standard.json")
    >>>
    >>> # Esegui benchmark
    >>> benchmark = RAGBenchmark(kg, gs)
    >>> results = await benchmark.run_full_benchmark()
"""

from merlt.benchmark.metrics import (
    RetrievalMetrics,
    LatencyMetrics,
    GradedRelevanceMetrics,
    recall_at_k,
    precision_at_k,
    hit_at_k,
    reciprocal_rank,
    mrr,
    hit_rate,
    dcg_at_k,
    ndcg_at_k,
    compute_latency_metrics,
    compute_retrieval_metrics,
    graded_relevance_at_k,
    has_score_at_least,
    compute_graded_relevance_metrics,
)

from merlt.benchmark.gold_standard import (
    Query,
    QueryCategory,
    GoldStandard,
    create_libro_iv_gold_standard,
    create_semantic_gold_standard,
)

from merlt.benchmark.rag_benchmark import (
    RAGBenchmark,
    BenchmarkConfig,
    BenchmarkResults,
    QueryResult,
    SourceComparisonResult,
    run_benchmark_cli,
)

__all__ = [
    # Metrics
    "RetrievalMetrics",
    "LatencyMetrics",
    "GradedRelevanceMetrics",
    "recall_at_k",
    "precision_at_k",
    "hit_at_k",
    "reciprocal_rank",
    "mrr",
    "hit_rate",
    "dcg_at_k",
    "ndcg_at_k",
    "compute_latency_metrics",
    "compute_retrieval_metrics",
    "graded_relevance_at_k",
    "has_score_at_least",
    "compute_graded_relevance_metrics",
    # Gold Standard
    "Query",
    "QueryCategory",
    "GoldStandard",
    "create_libro_iv_gold_standard",
    "create_semantic_gold_standard",
    # Benchmark
    "RAGBenchmark",
    "BenchmarkConfig",
    "BenchmarkResults",
    "QueryResult",
    "SourceComparisonResult",
    "run_benchmark_cli",
]
