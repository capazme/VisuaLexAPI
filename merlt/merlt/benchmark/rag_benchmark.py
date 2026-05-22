"""
RAG Benchmark Framework
=======================

Framework per benchmark sistematici di retrieval-augmented generation
su knowledge graph giuridici.

Uso:
    >>> from merlt.benchmark import RAGBenchmark, GoldStandard
    >>> from merlt import LegalKnowledgeGraph
    >>>
    >>> kg = LegalKnowledgeGraph()
    >>> await kg.connect()
    >>>
    >>> gs = GoldStandard.from_file("gold_standard.json")
    >>> benchmark = RAGBenchmark(kg, gs)
    >>>
    >>> results = await benchmark.run_full_benchmark()
    >>> print(results.overall_metrics.recall_at_5)
"""

import asyncio
import time
import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Callable
from dataclasses import dataclass, field
import structlog

from merlt.benchmark.metrics import (
    RetrievalMetrics,
    LatencyMetrics,
    compute_retrieval_metrics,
    compute_latency_metrics,
    recall_at_k,
    mrr,
)
from merlt.benchmark.gold_standard import GoldStandard, Query, QueryCategory

log = structlog.get_logger()


@dataclass
class QueryResult:
    """
    Risultato di una singola query.

    Attributes:
        query_id: ID della query
        query_text: Testo della query
        retrieved_urns: URN recuperati (ordinati per score)
        relevant_urns: URN rilevanti (ground truth)
        scores: Score per ogni URN recuperato
        source_types: Tipo di source per ogni URN (norma, spiegazione, etc.)
        latency_ms: Latenza totale in millisecondi
        recall_at_5: Recall@5 per questa query
        reciprocal_rank: RR per questa query
    """
    query_id: str
    query_text: str
    retrieved_urns: List[str]
    relevant_urns: List[str]
    scores: List[float]
    source_types: List[str]
    latency_ms: float
    recall_at_5: float
    reciprocal_rank: float
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query_id": self.query_id,
            "query_text": self.query_text,
            "retrieved_urns": self.retrieved_urns,
            "relevant_urns": self.relevant_urns,
            "scores": [round(s, 4) for s in self.scores],
            "source_types": self.source_types,
            "latency_ms": round(self.latency_ms, 2),
            "recall_at_5": round(self.recall_at_5, 4),
            "reciprocal_rank": round(self.reciprocal_rank, 4),
            "metadata": self.metadata,
        }


@dataclass
class SourceComparisonResult:
    """
    Confronto tra diversi source types.

    Attributes:
        source_type: Tipo di source (norma, spiegazione, ratio, massima, all)
        metrics: Metriche di retrieval per questo source
        query_results: Risultati dettagliati per ogni query
    """
    source_type: str
    metrics: RetrievalMetrics
    query_results: List[QueryResult]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_type": self.source_type,
            "metrics": self.metrics.to_dict(),
            "num_queries": len(self.query_results),
        }


@dataclass
class BenchmarkResults:
    """
    Risultati completi di un benchmark.

    Attributes:
        experiment_id: ID dell'esperimento (es. "EXP-015")
        timestamp: Data/ora esecuzione
        overall_metrics: Metriche aggregate
        by_source: Confronto per source type
        by_category: Metriche per categoria query
        latency_metrics: Benchmark di latenza
        query_results: Risultati dettagliati per ogni query
        config: Configurazione usata
    """
    experiment_id: str
    timestamp: str
    overall_metrics: RetrievalMetrics
    by_source: Dict[str, SourceComparisonResult]
    by_category: Dict[str, RetrievalMetrics]
    latency_metrics: Dict[str, LatencyMetrics]
    query_results: List[QueryResult]
    config: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "timestamp": self.timestamp,
            "overall_metrics": self.overall_metrics.to_dict(),
            "by_source": {
                k: v.to_dict() for k, v in self.by_source.items()
            },
            "by_category": {
                k: v.to_dict() for k, v in self.by_category.items()
            },
            "latency_metrics": {
                k: v.to_dict() for k, v in self.latency_metrics.items()
            },
            "query_results": [q.to_dict() for q in self.query_results],
            "config": self.config,
        }

    def to_file(self, path: str) -> None:
        """Salva risultati su file JSON."""
        with open(path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)
        log.info(f"Benchmark results saved to {path}")


@dataclass
class BenchmarkConfig:
    """
    Configurazione del benchmark.

    Attributes:
        top_k: Numero di risultati da recuperare
        source_types: Tipi di source da testare
        latency_iterations: Iterazioni per benchmark latenza
        latency_warmup: Iterazioni di warmup
        include_hybrid: Include test hybrid retrieval
    """
    top_k: int = 10
    source_types: List[str] = field(
        default_factory=lambda: ["norma", "spiegazione", "ratio", "massima", "all"]
    )
    latency_iterations: int = 100
    latency_warmup: int = 10
    include_hybrid: bool = True


class RAGBenchmark:
    """
    Framework di benchmark per RAG su knowledge graph giuridico.

    Example:
        >>> kg = LegalKnowledgeGraph()
        >>> await kg.connect()
        >>>
        >>> gs = GoldStandard.from_file("gold_standard.json")
        >>> benchmark = RAGBenchmark(kg, gs)
        >>>
        >>> # Benchmark completo
        >>> results = await benchmark.run_full_benchmark()
        >>>
        >>> # Solo retrieval per source type
        >>> results = await benchmark.run_source_comparison()
        >>>
        >>> # Solo latency
        >>> latency = await benchmark.run_latency_benchmark()
    """

    def __init__(
        self,
        kg: "LegalKnowledgeGraph",
        gold_standard: GoldStandard,
        config: Optional[BenchmarkConfig] = None
    ):
        """
        Inizializza il benchmark.

        Args:
            kg: LegalKnowledgeGraph connesso
            gold_standard: Dataset di query annotate
            config: Configurazione benchmark (default: standard)
        """
        self.kg = kg
        self.gold_standard = gold_standard
        self.config = config or BenchmarkConfig()

        log.info(
            f"RAGBenchmark initialized - "
            f"{len(gold_standard)} queries, "
            f"top_k={self.config.top_k}"
        )

    async def run_full_benchmark(
        self,
        experiment_id: str = "EXP-015"
    ) -> BenchmarkResults:
        """
        Esegue benchmark completo.

        Include:
        1. Confronto source types (norma vs spiegazione vs ratio vs massima)
        2. Metriche per categoria query
        3. Benchmark latenza

        Args:
            experiment_id: ID esperimento per tracciamento

        Returns:
            BenchmarkResults completo
        """
        log.info(f"Starting full benchmark - {experiment_id}")
        start_time = time.time()

        # 1. Source comparison
        log.info("Phase 1: Source comparison")
        by_source = await self.run_source_comparison()

        # 2. Overall metrics (using 'all' source type)
        all_results = by_source.get("all")
        if all_results:
            overall_metrics = all_results.metrics
            query_results = all_results.query_results
        else:
            # Fallback: usa il primo source disponibile
            first_source = list(by_source.values())[0]
            overall_metrics = first_source.metrics
            query_results = first_source.query_results

        # 3. Metriche per categoria
        by_category = self._compute_category_metrics(query_results)

        # 4. Latency benchmark
        log.info("Phase 2: Latency benchmark")
        latency_metrics = await self.run_latency_benchmark()

        elapsed = time.time() - start_time
        log.info(f"Full benchmark completed in {elapsed:.1f}s")

        return BenchmarkResults(
            experiment_id=experiment_id,
            timestamp=datetime.now().isoformat(),
            overall_metrics=overall_metrics,
            by_source=by_source,
            by_category=by_category,
            latency_metrics=latency_metrics,
            query_results=query_results,
            config={
                "top_k": self.config.top_k,
                "source_types": self.config.source_types,
                "latency_iterations": self.config.latency_iterations,
                "num_queries": len(self.gold_standard),
            }
        )

    async def run_source_comparison(self) -> Dict[str, SourceComparisonResult]:
        """
        Confronta performance per source type.

        Returns:
            Dizionario source_type → SourceComparisonResult
        """
        results = {}

        for source_type in self.config.source_types:
            log.info(f"Testing source type: {source_type}")

            query_results = await self._run_queries_for_source(source_type)

            # Calcola metriche
            all_retrieved = [qr.retrieved_urns for qr in query_results]
            all_relevant = [qr.relevant_urns for qr in query_results]
            categories = [
                self._get_query_category(qr.query_id)
                for qr in query_results
            ]

            metrics = compute_retrieval_metrics(
                all_retrieved,
                all_relevant,
                categories=categories
            )

            results[source_type] = SourceComparisonResult(
                source_type=source_type,
                metrics=metrics,
                query_results=query_results,
            )

            log.info(
                f"  {source_type}: "
                f"Recall@5={metrics.recall_at_5:.3f}, "
                f"MRR={metrics.mrr:.3f}"
            )

        return results

    async def _run_queries_for_source(
        self,
        source_type: str
    ) -> List[QueryResult]:
        """
        Esegue tutte le query per un source type.

        Args:
            source_type: Tipo di source (norma, spiegazione, etc.)

        Returns:
            Lista di QueryResult
        """
        results = []

        for query in self.gold_standard:
            start = time.time()

            # Cerca nel knowledge graph
            search_results = await self._search_with_source_filter(
                query.text,
                source_type=source_type,
                top_k=self.config.top_k
            )

            latency_ms = (time.time() - start) * 1000

            # Estrai URN e score
            retrieved_urns = [r.get("urn", "") for r in search_results]
            scores = [r.get("score", 0.0) for r in search_results]
            source_types = [r.get("source_type", "unknown") for r in search_results]

            # Calcola metriche per questa query
            r_at_5 = recall_at_k(retrieved_urns, query.relevant_urns, k=5)
            rr = self._reciprocal_rank(retrieved_urns, query.relevant_urns)

            results.append(QueryResult(
                query_id=query.id,
                query_text=query.text,
                retrieved_urns=retrieved_urns,
                relevant_urns=query.relevant_urns,
                scores=scores,
                source_types=source_types,
                latency_ms=latency_ms,
                recall_at_5=r_at_5,
                reciprocal_rank=rr,
                metadata={"category": query.category.value}
            ))

        return results

    async def _search_with_source_filter(
        self,
        query: str,
        source_type: str,
        top_k: int
    ) -> List[Dict[str, Any]]:
        """
        Cerca nel knowledge graph con filtro per source type.

        Args:
            query: Testo della query
            source_type: Filtro source (norma, spiegazione, ratio, massima, all)
            top_k: Numero risultati

        Returns:
            Lista di risultati con urn, score, source_type
        """
        from qdrant_client.models import Filter, FieldCondition, MatchValue

        # Encode query
        query_embedding = await self.kg._embedding_service.encode_query_async(query)

        # Prepara filtro per Qdrant
        query_filter = None
        if source_type != "all":
            query_filter = Filter(
                must=[
                    FieldCondition(
                        key="source_type",
                        match=MatchValue(value=source_type)
                    )
                ]
            )

        # Search Qdrant using query_points API
        response = self.kg._qdrant.query_points(
            collection_name=self.kg.config.qdrant_collection,
            query=query_embedding,
            query_filter=query_filter,
            limit=top_k,
        )
        results = response.points

        # Format results
        formatted = []
        for hit in results:
            formatted.append({
                "urn": hit.payload.get("article_urn", hit.payload.get("urn", "")),
                "score": hit.score,
                "source_type": hit.payload.get("source_type", "unknown"),
                "text": hit.payload.get("text", "")[:200],
                "numero_articolo": hit.payload.get("numero_articolo", ""),
            })

        return formatted

    async def run_latency_benchmark(self) -> Dict[str, LatencyMetrics]:
        """
        Benchmark di latenza per ogni componente.

        Returns:
            Dizionario operazione → LatencyMetrics
        """
        results = {}

        # Warmup
        log.info(f"Latency warmup ({self.config.latency_warmup} iterations)")
        for _ in range(self.config.latency_warmup):
            await self.kg._embedding_service.encode_query_async("test query")

        # 1. Query embedding
        latencies = []
        for i in range(self.config.latency_iterations):
            start = time.time()
            await self.kg._embedding_service.encode_query_async(
                f"Test query {i} per benchmark latenza"
            )
            latencies.append((time.time() - start) * 1000)

        results["query_embedding"] = compute_latency_metrics(
            latencies, "query_embedding"
        )

        # 2. Qdrant search
        test_embedding = await self.kg._embedding_service.encode_query_async(
            "Test query"
        )
        latencies = []
        for _ in range(self.config.latency_iterations):
            start = time.time()
            self.kg._qdrant.query_points(
                collection_name=self.kg.config.qdrant_collection,
                query=test_embedding,
                limit=10,
            )
            latencies.append((time.time() - start) * 1000)

        results["qdrant_search"] = compute_latency_metrics(
            latencies, "qdrant_search"
        )

        # 3. Bridge lookup (se disponibile)
        if hasattr(self.kg, '_bridge') and self.kg._bridge:
            latencies = []
            # Get a sample chunk_id
            sample_response = self.kg._qdrant.query_points(
                collection_name=self.kg.config.qdrant_collection,
                query=test_embedding,
                limit=1,
            )
            sample_results = sample_response.points
            if sample_results:
                sample_id = sample_results[0].id
                for _ in range(self.config.latency_iterations):
                    start = time.time()
                    await self.kg._bridge.get_nodes_for_chunk(sample_id)
                    latencies.append((time.time() - start) * 1000)

                results["bridge_lookup"] = compute_latency_metrics(
                    latencies, "bridge_lookup"
                )

        # 4. Full pipeline
        latencies = []
        for i in range(min(self.config.latency_iterations, 50)):  # Limita per tempo
            start = time.time()
            await self.kg.search(f"Test query {i}", top_k=10)
            latencies.append((time.time() - start) * 1000)

        results["full_pipeline"] = compute_latency_metrics(
            latencies, "full_pipeline"
        )

        # Log risultati
        for op, metrics in results.items():
            log.info(
                f"  {op}: p50={metrics.median_ms:.1f}ms, "
                f"p99={metrics.p99_ms:.1f}ms"
            )

        return results

    def _compute_category_metrics(
        self,
        query_results: List[QueryResult]
    ) -> Dict[str, RetrievalMetrics]:
        """Calcola metriche disaggregate per categoria."""
        by_category = {}

        for cat in QueryCategory:
            cat_results = [
                qr for qr in query_results
                if qr.metadata.get("category") == cat.value
            ]

            if cat_results:
                all_retrieved = [qr.retrieved_urns for qr in cat_results]
                all_relevant = [qr.relevant_urns for qr in cat_results]

                by_category[cat.value] = compute_retrieval_metrics(
                    all_retrieved, all_relevant
                )

        return by_category

    def _get_query_category(self, query_id: str) -> str:
        """Trova la categoria di una query dato l'ID."""
        for query in self.gold_standard:
            if query.id == query_id:
                return query.category.value
        return "unknown"

    def _reciprocal_rank(
        self,
        retrieved: List[str],
        relevant: List[str]
    ) -> float:
        """Calcola reciprocal rank."""
        relevant_set = set(relevant)
        for i, urn in enumerate(retrieved, start=1):
            if urn in relevant_set:
                return 1.0 / i
        return 0.0


async def run_benchmark_cli(
    gold_standard_path: str,
    output_path: str,
    experiment_id: str = "EXP-015"
) -> BenchmarkResults:
    """
    Entry point per esecuzione da CLI.

    Args:
        gold_standard_path: Percorso al file gold_standard.json
        output_path: Percorso per salvare i risultati
        experiment_id: ID esperimento

    Returns:
        BenchmarkResults
    """
    from merlt import LegalKnowledgeGraph

    # Carica gold standard
    gs = GoldStandard.from_file(gold_standard_path)
    log.info(f"Loaded gold standard: {len(gs)} queries")

    # Connetti al knowledge graph
    kg = LegalKnowledgeGraph()
    await kg.connect()
    log.info("Connected to knowledge graph")

    # Esegui benchmark
    benchmark = RAGBenchmark(kg, gs)
    results = await benchmark.run_full_benchmark(experiment_id)

    # Salva risultati
    results.to_file(output_path)

    return results
