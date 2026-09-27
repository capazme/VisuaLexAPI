"""
Batch Ingestion Pipeline - Optimized for Parallelization
=========================================================

Ottimizzazioni implementate:
1. Parallel HTTP fetches (Normattiva + Brocardi in parallelo)
2. Batch embedding generation (tutti i testi insieme)
3. Batch database operations (upsert in blocchi)

Performance:
- Sequenziale: ~8-18s per articolo
- Ottimizzato: ~1-3s per articolo (5-10x speedup)

Usage:
    from merlt.pipeline.batch_ingestion import BatchIngestionPipeline

    pipeline = BatchIngestionPipeline(kg, batch_size=10)
    results = await pipeline.ingest_batch(article_numbers)
"""

import asyncio
import structlog
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
from datetime import datetime, timezone
from uuid import uuid4

from merlt.pipeline.visualex import VisualexArticle, NormaMetadata
from merlt.pipeline.ingestion import IngestionPipelineV2, IngestionResult
from merlt.clients import NormaVisitata, Norma
from merlt.models import BridgeMapping
from merlt.pipeline.orchestrator import pipeline_orchestrator
from merlt.pipeline.types import PipelineType

log = structlog.get_logger()


@dataclass
class ArticleFetchResult:
    """Result of fetching a single article's data."""
    article_num: str
    norma_visitata: NormaVisitata
    article_text: Optional[str] = None
    article_url: Optional[str] = None
    brocardi_info: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

    @property
    def success(self) -> bool:
        return self.article_text is not None and self.error is None


@dataclass
class BatchIngestionResult:
    """Result of batch ingestion."""
    total_articles: int
    successful: int
    failed: int
    embeddings_created: int
    graph_nodes_created: int
    bridge_mappings_created: int
    duration_seconds: float
    errors: List[str] = field(default_factory=list)
    articles_processed: List[str] = field(default_factory=list)

    @property
    def success_rate(self) -> float:
        return self.successful / self.total_articles if self.total_articles > 0 else 0.0

    def summary(self) -> str:
        return (
            f"BatchIngestion: {self.successful}/{self.total_articles} "
            f"({self.success_rate:.1%}) in {self.duration_seconds:.1f}s | "
            f"Embeddings: {self.embeddings_created} | "
            f"Nodes: {self.graph_nodes_created} | "
            f"Bridge: {self.bridge_mappings_created}"
        )


class BatchIngestionPipeline:
    """
    Ottimizza ingestion parallelizzando I/O e batching embeddings.

    Strategia:
    1. Fetch parallelo: N articoli contemporaneamente (Normattiva + Brocardi)
    2. Batch embeddings: tutti i testi di un batch insieme
    3. Batch DB ops: upsert in blocchi

    Args:
        kg: LegalKnowledgeGraph connesso
        batch_size: Articoli per batch (default: 10)
        max_concurrent_fetches: Max fetch paralleli (default: 5)
        embedding_batch_size: Testi per batch embedding (default: 32)
    """

    def __init__(
        self,
        kg,  # LegalKnowledgeGraph
        batch_size: int = 10,
        max_concurrent_fetches: int = 5,
        embedding_batch_size: int = 32,
    ):
        self.kg = kg
        self.batch_size = batch_size
        self.max_concurrent_fetches = max_concurrent_fetches
        self.embedding_batch_size = embedding_batch_size

        # Semaphore per limitare concorrenza HTTP
        self._fetch_semaphore = asyncio.Semaphore(max_concurrent_fetches)

        log.info(
            f"BatchIngestionPipeline initialized",
            batch_size=batch_size,
            max_concurrent=max_concurrent_fetches,
            embedding_batch=embedding_batch_size,
        )

    async def ingest_batch(
        self,
        tipo_atto: str,
        article_numbers: List[str],
        include_brocardi: bool = True,
        include_multivigenza: bool = True,
    ) -> BatchIngestionResult:
        """
        Ingest batch di articoli con ottimizzazioni.

        Args:
            tipo_atto: Tipo atto (es. "codice civile")
            article_numbers: Lista numeri articoli
            include_brocardi: Include enrichment Brocardi
            include_multivigenza: Include tracking modifiche

        Returns:
            BatchIngestionResult con statistiche
        """
        start_time = datetime.now(timezone.utc)
        total = len(article_numbers)

        # Genera run_id per orchestrator
        run_id = f"batch_{tipo_atto.replace(' ', '_')}_{uuid4().hex[:8]}"

        # Registra run nell'orchestrator per monitoring real-time
        pipeline_orchestrator.register_run(
            run_id=run_id,
            pipeline_type=PipelineType.BATCH_INGESTION,
            total_items=total,
            config={
                "tipo_atto": tipo_atto,
                "batch_size": self.batch_size,
                "include_brocardi": include_brocardi,
                "include_multivigenza": include_multivigenza,
                "articles": article_numbers[:10],  # Preview primi 10
            }
        )

        log.info(f"Starting batch ingestion: {total} articles", run_id=run_id)

        result = BatchIngestionResult(
            total_articles=total,
            successful=0,
            failed=0,
            embeddings_created=0,
            graph_nodes_created=0,
            bridge_mappings_created=0,
            duration_seconds=0,
        )

        try:
            # Process in batches
            for i in range(0, total, self.batch_size):
                batch = article_numbers[i:i + self.batch_size]
                batch_num = i // self.batch_size + 1
                total_batches = (total + self.batch_size - 1) // self.batch_size

                log.info(f"Processing batch {batch_num}/{total_batches}: articles {batch[0]}-{batch[-1]}")

                try:
                    batch_result = await self._process_batch(
                        tipo_atto=tipo_atto,
                        article_numbers=batch,
                        include_brocardi=include_brocardi,
                        include_multivigenza=include_multivigenza,
                    )

                    result.successful += batch_result["successful"]
                    result.failed += batch_result["failed"]
                    result.embeddings_created += batch_result["embeddings"]
                    result.graph_nodes_created += batch_result["nodes"]
                    result.bridge_mappings_created += batch_result["bridge"]
                    result.articles_processed.extend(batch_result["processed"])
                    result.errors.extend(batch_result["errors"])

                    # Emit progress via WebSocket
                    await pipeline_orchestrator.emit_progress(
                        run_id=run_id,
                        processed=result.successful + result.failed,
                        current_item=f"Batch {batch_num}/{total_batches}",
                        step_progress={
                            "batch_num": batch_num,
                            "total_batches": total_batches,
                            "embeddings": result.embeddings_created,
                            "nodes": result.graph_nodes_created,
                            "errors": len(result.errors),
                        }
                    )

                    # Emit errors se ce ne sono nel batch
                    for error_msg in batch_result["errors"]:
                        await pipeline_orchestrator.emit_error(
                            run_id=run_id,
                            error={
                                "item_id": f"batch_{batch_num}",
                                "phase": "batch_processing",
                                "error_message": error_msg,
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            }
                        )

                except Exception as e:
                    log.error(f"Batch {batch_num} failed: {e}")
                    result.failed += len(batch)
                    result.errors.append(f"Batch {batch_num}: {str(e)}")

                    # Emit error via WebSocket
                    await pipeline_orchestrator.emit_error(
                        run_id=run_id,
                        error={
                            "item_id": f"batch_{batch_num}",
                            "phase": "batch_processing",
                            "error_message": str(e),
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                    )

            result.duration_seconds = (datetime.now(timezone.utc) - start_time).total_seconds()

            # Completa run nell'orchestrator
            pipeline_orchestrator.complete_run(
                run_id=run_id,
                final_stats={
                    "successful": result.successful,
                    "failed": result.failed,
                    "embeddings_created": result.embeddings_created,
                    "graph_nodes_created": result.graph_nodes_created,
                    "bridge_mappings_created": result.bridge_mappings_created,
                    "duration_seconds": result.duration_seconds,
                    "success_rate": result.success_rate,
                }
            )

            log.info(result.summary())
            return result

        except Exception as e:
            # Segna run come fallita
            pipeline_orchestrator.fail_run(run_id=run_id, error_message=str(e))
            raise

    async def _process_batch(
        self,
        tipo_atto: str,
        article_numbers: List[str],
        include_brocardi: bool,
        include_multivigenza: bool,
    ) -> Dict[str, Any]:
        """Process single batch of articles."""

        # ═══════════════════════════════════════════════════════════════
        # STEP 1: Parallel HTTP Fetches
        # ═══════════════════════════════════════════════════════════════
        fetch_results = await self._fetch_articles_parallel(
            tipo_atto=tipo_atto,
            article_numbers=article_numbers,
            include_brocardi=include_brocardi,
        )

        successful_fetches = [r for r in fetch_results if r.success]
        failed_fetches = [r for r in fetch_results if not r.success]

        if failed_fetches:
            log.warning(f"Failed fetches: {len(failed_fetches)}")

        if not successful_fetches:
            return {
                "successful": 0,
                "failed": len(article_numbers),
                "embeddings": 0,
                "nodes": 0,
                "bridge": 0,
                "processed": [],
                "errors": [f.error for f in failed_fetches if f.error],
            }

        # ═══════════════════════════════════════════════════════════════
        # STEP 2: Graph Ingestion (può essere parallelizzato)
        # ═══════════════════════════════════════════════════════════════
        ingestion_results = await self._ingest_to_graph_parallel(
            fetch_results=successful_fetches,
            tipo_atto=tipo_atto,
        )

        # ═══════════════════════════════════════════════════════════════
        # STEP 3: Batch Embeddings (OTTIMIZZAZIONE PRINCIPALE)
        # ═══════════════════════════════════════════════════════════════
        embeddings_count = await self._generate_embeddings_batch(
            fetch_results=successful_fetches,
            ingestion_results=ingestion_results,
        )

        # ═══════════════════════════════════════════════════════════════
        # STEP 4: Batch Bridge Table Insert
        # ═══════════════════════════════════════════════════════════════
        bridge_count = await self._insert_bridge_mappings_batch(
            ingestion_results=ingestion_results,
        )

        # ═══════════════════════════════════════════════════════════════
        # STEP 5: Multivigenza (parallel)
        # ═══════════════════════════════════════════════════════════════
        if include_multivigenza:
            await self._process_multivigenza_parallel(
                fetch_results=successful_fetches,
            )

        # Conta nodi creati
        total_nodes = sum(
            len(r.nodes_created) for r in ingestion_results.values()
        )

        return {
            "successful": len(successful_fetches),
            "failed": len(failed_fetches),
            "embeddings": embeddings_count,
            "nodes": total_nodes,
            "bridge": bridge_count,
            "processed": [f.article_num for f in successful_fetches],
            "errors": [f.error for f in failed_fetches if f.error],
        }

    async def _fetch_articles_parallel(
        self,
        tipo_atto: str,
        article_numbers: List[str],
        include_brocardi: bool,
    ) -> List[ArticleFetchResult]:
        """Fetch multiple articles in parallel."""

        async def fetch_single(article_num: str) -> ArticleFetchResult:
            async with self._fetch_semaphore:
                return await self._fetch_single_article(
                    tipo_atto=tipo_atto,
                    article_num=article_num,
                    include_brocardi=include_brocardi,
                )

        tasks = [fetch_single(num) for num in article_numbers]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to error results
        fetch_results = []
        for i, res in enumerate(results):
            if isinstance(res, Exception):
                fetch_results.append(ArticleFetchResult(
                    article_num=article_numbers[i],
                    norma_visitata=None,
                    error=str(res),
                ))
            else:
                fetch_results.append(res)

        return fetch_results

    async def _fetch_single_article(
        self,
        tipo_atto: str,
        article_num: str,
        include_brocardi: bool,
    ) -> ArticleFetchResult:
        """Fetch single article with Normattiva + Brocardi in parallel."""

        norma = Norma(tipo_atto=tipo_atto, data=None, numero_atto=None)
        nv = NormaVisitata(norma=norma, numero_articolo=article_num.replace(' ', '-'))

        result = ArticleFetchResult(
            article_num=article_num,
            norma_visitata=nv,
        )

        try:
            # Fetch Normattiva e Brocardi in parallelo
            tasks = [self.kg._normattiva_scraper.get_document(nv)]

            if include_brocardi:
                tasks.append(self.kg._brocardi_scraper.get_info(nv))

            responses = await asyncio.gather(*tasks, return_exceptions=True)

            # Process Normattiva response
            normattiva_response = responses[0]
            if isinstance(normattiva_response, Exception):
                result.error = f"Normattiva: {str(normattiva_response)}"
                return result

            result.article_text, result.article_url = normattiva_response

            # Process Brocardi response (if requested)
            if include_brocardi and len(responses) > 1:
                brocardi_response = responses[1]
                if not isinstance(brocardi_response, Exception):
                    position, info_dict, brocardi_url = brocardi_response
                    result.brocardi_info = info_dict

            return result

        except Exception as e:
            result.error = str(e)
            return result

    async def _ingest_to_graph_parallel(
        self,
        fetch_results: List[ArticleFetchResult],
        tipo_atto: str,
    ) -> Dict[str, IngestionResult]:
        """Ingest articles to graph in parallel."""

        results = {}

        async def ingest_single(fetch: ArticleFetchResult) -> Tuple[str, IngestionResult]:
            metadata = NormaMetadata(
                tipo_atto=tipo_atto,
                data=None,
                numero_atto=None,
                numero_articolo=fetch.article_num.replace(' ', '-'),
            )

            visualex_article = VisualexArticle(
                metadata=metadata,
                article_text=fetch.article_text,
                url=fetch.article_url,
                brocardi_info=fetch.brocardi_info,
            )

            # Get cached norm tree
            cached_tree = await self.kg._get_cached_norm_tree(tipo_atto)

            ingestion_result = await self.kg._ingestion_pipeline.ingest_article(
                article=visualex_article,
                create_graph_nodes=True,
                norm_tree=cached_tree,
            )

            return fetch.article_num, ingestion_result

        tasks = [ingest_single(f) for f in fetch_results]
        task_results = await asyncio.gather(*tasks, return_exceptions=True)

        for res in task_results:
            if isinstance(res, tuple):
                article_num, ingestion_result = res
                results[article_num] = ingestion_result

        return results

    async def _generate_embeddings_batch(
        self,
        fetch_results: List[ArticleFetchResult],
        ingestion_results: Dict[str, IngestionResult],
    ) -> int:
        """
        Generate embeddings in batch (OTTIMIZZAZIONE PRINCIPALE).

        Invece di generare embeddings uno alla volta:
        1. Raccoglie tutti i testi da tutti gli articoli
        2. Genera embeddings in un singolo batch
        3. Upsert a Qdrant in blocco
        """
        if not self.kg._qdrant or not self.kg._embedding_service:
            return 0

        # Collect all texts to embed with metadata
        texts_to_embed = []
        text_metadata = []  # Parallel list with metadata for each text

        for fetch in fetch_results:
            if fetch.article_num not in ingestion_results:
                continue

            ingestion = ingestion_results[fetch.article_num]
            article_urn = ingestion.article_urn

            base_meta = {
                "article_urn": article_urn,
                "tipo_atto": fetch.norma_visitata.norma.tipo_atto,
                "numero_articolo": fetch.article_num,
            }

            # 1. Article text (norma)
            if fetch.article_text and len(fetch.article_text.strip()) > 20:
                texts_to_embed.append(fetch.article_text)
                text_metadata.append({
                    **base_meta,
                    "source_type": "norma",
                    "point_id_suffix": "norma",
                    "text_preview": fetch.article_text[:2000],
                })

            # 2-4. Brocardi content
            if fetch.brocardi_info:
                # Spiegazione
                spiegazione = fetch.brocardi_info.get("Spiegazione", "")
                if spiegazione and len(spiegazione.strip()) > 50:
                    texts_to_embed.append(spiegazione)
                    text_metadata.append({
                        **base_meta,
                        "source_type": "spiegazione",
                        "point_id_suffix": "spiegazione",
                        "text_preview": spiegazione[:2000],
                    })

                # Ratio
                ratio = fetch.brocardi_info.get("Ratio", "")
                if ratio and len(ratio.strip()) > 50:
                    texts_to_embed.append(ratio)
                    text_metadata.append({
                        **base_meta,
                        "source_type": "ratio",
                        "point_id_suffix": "ratio",
                        "text_preview": ratio[:2000],
                    })

                # Massime (top 5)
                massime = fetch.brocardi_info.get("Massime", [])
                if isinstance(massime, list):
                    for i, massima in enumerate(massime[:5]):
                        if isinstance(massima, str):
                            testo = massima
                        elif isinstance(massima, dict):
                            testo = massima.get("massima", massima.get("testo", ""))
                        else:
                            continue

                        if testo and len(testo.strip()) > 50:
                            texts_to_embed.append(testo)
                            text_metadata.append({
                                **base_meta,
                                "source_type": "massima",
                                "massima_index": i,
                                "point_id_suffix": f"massima:{i}",
                                "text_preview": testo[:2000],
                            })

        if not texts_to_embed:
            return 0

        log.info(f"Batch embedding {len(texts_to_embed)} texts from {len(fetch_results)} articles")

        # BATCH ENCODING - Much faster than sequential!
        embeddings = await self.kg._embedding_service.encode_batch_async(
            texts_to_embed,
            is_query=False,
            show_progress_bar=len(texts_to_embed) > 50,
        )

        # Build points for Qdrant
        from qdrant_client.models import PointStruct

        points = []
        for i, (embedding, meta) in enumerate(zip(embeddings, text_metadata)):
            point_id = hash(f"{meta['article_urn']}:{meta['point_id_suffix']}") % (2**63)

            payload = {
                "article_urn": meta["article_urn"],
                "tipo_atto": meta["tipo_atto"],
                "numero_articolo": meta["numero_articolo"],
                "source_type": meta["source_type"],
                "text": meta["text_preview"],
            }

            if "massima_index" in meta:
                payload["massima_index"] = meta["massima_index"]

            points.append(PointStruct(
                id=point_id,
                vector=embedding,
                payload=payload,
            ))

        # Batch upsert to Qdrant
        self.kg._qdrant.upsert(
            collection_name=self.kg.config.qdrant_collection,
            points=points,
        )

        log.info(f"Upserted {len(points)} embeddings to Qdrant")
        return len(points)

    async def _insert_bridge_mappings_batch(
        self,
        ingestion_results: Dict[str, IngestionResult],
    ) -> int:
        """Insert all bridge mappings in batch."""

        if not self.kg._bridge_builder:
            return 0

        all_mappings = []
        for ingestion in ingestion_results.values():
            all_mappings.extend(ingestion.bridge_mappings)

        if not all_mappings:
            return 0

        try:
            inserted = await self.kg._bridge_builder.insert_mappings(all_mappings)
            return inserted
        except Exception as e:
            log.error(f"Bridge batch insert failed: {e}")
            return 0

    async def _process_multivigenza_parallel(
        self,
        fetch_results: List[ArticleFetchResult],
    ) -> None:
        """Process multivigenza for articles in parallel."""

        if not self.kg._multivigenza_pipeline:
            return

        async def process_single(fetch: ArticleFetchResult):
            try:
                await self.kg._multivigenza_pipeline.ingest_with_history(
                    fetch.norma_visitata,
                    fetch_all_versions=False,
                    create_modifying_acts=True,
                )
            except Exception as e:
                log.warning(f"Multivigenza failed for {fetch.article_num}: {e}")

        tasks = [process_single(f) for f in fetch_results]
        await asyncio.gather(*tasks, return_exceptions=True)


# Export
__all__ = [
    "BatchIngestionPipeline",
    "BatchIngestionResult",
    "ArticleFetchResult",
]
