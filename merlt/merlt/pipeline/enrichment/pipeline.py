"""
Enrichment Pipeline
===================

Orchestratore principale per la pipeline di enrichment.

Coordina:
- Fetch contenuti da fonti (Sources)
- Estrazione entità (Extractors)
- Linking e deduplicazione (Linkers)
- Scrittura nel grafo (Writers)

Esempio:
    from merlt.pipeline.enrichment import EnrichmentPipeline, EnrichmentConfig

    pipeline = EnrichmentPipeline(
        graph_client=falkordb_client,
        embedding_service=embedding_service,
        llm_service=llm_service,
        config=config,
    )

    result = await pipeline.run()
"""

import asyncio
import hashlib
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Dict, List, Optional

from merlt.pipeline.enrichment.checkpoint import CheckpointManager
from merlt.pipeline.enrichment.config import EnrichmentConfig
from merlt.pipeline.enrichment.models import (
    EnrichmentContent,
    EnrichmentResult,
    ExtractedEntity,
    LinkedEntity,
)
from merlt.pipeline.orchestrator import pipeline_orchestrator
from merlt.pipeline.types import PipelineType

if TYPE_CHECKING:
    from merlt.storage.graph import FalkorDBClient
    from merlt.storage.vectors import EmbeddingService
    from merlt.storage.bridge import BridgeBuilder
    from merlt.rlcf.ai_service import OpenRouterService
    from qdrant_client import QdrantClient

logger = logging.getLogger(__name__)


class EnrichmentPipeline:
    """
    Pipeline di enrichment per estrarre entità strutturate.

    Riproducibile, scalabile, robusto.

    Attributes:
        graph: Client FalkorDB
        embeddings: Servizio embeddings
        llm: Servizio LLM per estrazione
        config: Configurazione enrichment
        qdrant: Client Qdrant per storage vettori (opzionale)
        bridge_builder: Builder per Bridge Table (opzionale)

    Example:
        >>> pipeline = EnrichmentPipeline(graph, embeddings, llm, config)
        >>> result = await pipeline.run()
        >>> print(result.summary())
    """

    def __init__(
        self,
        graph_client: "FalkorDBClient",
        embedding_service: "EmbeddingService",
        llm_service: "OpenRouterService",
        config: EnrichmentConfig,
        qdrant_client: Optional["QdrantClient"] = None,
        bridge_builder: Optional["BridgeBuilder"] = None,
        qdrant_collection: Optional[str] = None,
    ):
        """
        Inizializza la pipeline.

        Args:
            graph_client: Client FalkorDB per lettura/scrittura grafo
            embedding_service: Servizio per embeddings (dedup semantico)
            llm_service: Servizio LLM per estrazione entità
            config: Configurazione dell'enrichment
            qdrant_client: Client Qdrant per storage chunk vettoriali (opzionale)
            bridge_builder: Builder per Bridge Table mappings (opzionale)
            qdrant_collection: Nome collection Qdrant (default: config-based)
        """
        self.graph = graph_client
        self.embeddings = embedding_service
        self.llm = llm_service
        self.config = config
        self.qdrant = qdrant_client
        self.bridge_builder = bridge_builder
        self.qdrant_collection = qdrant_collection

        # Componenti (inizializzati lazy)
        self._extractors = None
        self._linker = None
        self._writer = None

        # Checkpoint
        self.checkpoint = CheckpointManager(
            checkpoint_dir=config.checkpoint_dir,
            run_id=self._generate_run_id(),
        )

    def _generate_run_id(self) -> str:
        """Genera run_id basato su config."""
        # Hash della config per identificare esecuzioni equivalenti
        config_str = str(self.config.to_dict())
        config_hash = hashlib.md5(config_str.encode(), usedforsecurity=False).hexdigest()[:8]
        timestamp = datetime.now().strftime("%Y%m%d")
        return f"enrichment_{timestamp}_{config_hash}"

    def _config_hash(self) -> str:
        """Hash della config per validazione checkpoint."""
        config_str = str(self.config.to_dict())
        return hashlib.md5(config_str.encode(), usedforsecurity=False).hexdigest()

    async def _init_components(self) -> None:
        """Inizializza componenti lazy."""
        if self._extractors is None:
            from merlt.pipeline.enrichment.extractors import create_extractor

            # Usa la factory per creare l'extractor appropriato per ogni tipo
            # Questo supporta tutti i 17 tipi di entità dello schema
            self._extractors = {}
            for entity_type in self.config.entity_types:
                self._extractors[entity_type] = create_extractor(self.llm, entity_type)

            logger.info(
                f"Inizializzati {len(self._extractors)} extractors: "
                f"{[t.value for t in self._extractors.keys()]}"
            )

        if self._linker is None:
            from merlt.pipeline.enrichment.linkers import EntityLinker

            self._linker = EntityLinker(
                graph_client=self.graph,
                similarity_threshold=self.config.similarity_threshold,
                merge_strategy=self.config.merge_strategy,
            )

        if self._writer is None:
            from merlt.pipeline.enrichment.writers import EnrichmentGraphWriter

            self._writer = EnrichmentGraphWriter(
                graph_client=self.graph,
                schema_version=self.config.schema_version,
            )

    async def run(self) -> EnrichmentResult:
        """
        Esegue la pipeline di enrichment.

        Processa tutte le fonti configurate, estrae entità,
        deduplica e scrive nel grafo.

        Returns:
            EnrichmentResult con statistiche e errori

        Example:
            >>> result = await pipeline.run()
            >>> print(f"Creati {result.stats.total_entities_created} entità")
        """
        result = EnrichmentResult()
        result.started_at = datetime.now()

        # Inizializza componenti
        await self._init_components()

        # Inizia checkpoint
        self.checkpoint.start_run(self._config_hash())

        # Carica già processati
        processed = self.checkpoint.load()
        result.contents_skipped = len(processed)

        # Raggruppa fonti per fase
        sources_by_phase: Dict[int, List] = defaultdict(list)
        for source in self.config.sources:
            sources_by_phase[source.phase].append(source)

        total_phases = len(sources_by_phase)

        # Stima totale items per orchestrator
        total_items = len(self.config.sources) * 10  # Stima conservativa

        # Registra run nell'orchestrator per monitoring real-time
        run_id = self.checkpoint.run_id
        pipeline_orchestrator.register_run(
            run_id=run_id,
            pipeline_type=PipelineType.ENRICHMENT,
            total_items=total_items,
            config={
                "sources": len(self.config.sources),
                "phases": total_phases,
                "entity_types": [t.value for t in self.config.entity_types],
            }
        )

        logger.info(
            f"Avvio enrichment: {len(self.config.sources)} fonti in {total_phases} fasi, "
            f"{len(processed)} già processati"
        )

        try:
            # Esegui fase per fase (ordine crescente)
            for phase_num in sorted(sources_by_phase.keys()):
                phase_sources = sources_by_phase[phase_num]
                logger.info(
                    f"=== FASE {phase_num}/{total_phases}: "
                    f"{[s.source_name for s in phase_sources]} ==="
                )

                # Processa ogni fonte nella fase
                for source in phase_sources:
                    logger.info(f"Processing fonte: {source.source_name}")

                    try:
                        async for content in source.fetch(self.config.scope):
                            # Skip se già processato
                            if content.id in processed:
                                continue

                            # Processa content
                            await self._process_content(content, result)
                            result.contents_processed += 1

                            # Emit progress via WebSocket
                            await pipeline_orchestrator.emit_progress(
                                run_id=run_id,
                                processed=result.contents_processed,
                                current_item=content.id,
                                step_progress={
                                    "phase": phase_num,
                                    "source": source.source_name,
                                    "entities_created": len(result.entities_created),
                                }
                            )

                    except Exception as e:
                        logger.error(f"Errore fonte {source.source_name}: {e}")
                        result.add_error(
                            content_id=f"source:{source.source_name}",
                            phase="fetch",
                            error=e,
                        )

                        # Emit error via WebSocket
                        await pipeline_orchestrator.emit_error(
                            run_id=run_id,
                            error={
                                "item_id": f"source:{source.source_name}",
                                "phase": "fetch",
                                "error_message": str(e),
                                "timestamp": datetime.now(timezone.utc).isoformat(),
                            }
                        )

                logger.info(f"=== FASE {phase_num} completata ===")

            # Finalizza
            result.completed_at = datetime.now()
            self.checkpoint.finalize()

            # Completa run nell'orchestrator
            pipeline_orchestrator.complete_run(
                run_id=run_id,
                final_stats={
                    "contents_processed": result.contents_processed,
                    "entities_created": len(result.entities_created),
                    "errors": len(result.errors),
                }
            )

            logger.info(result.summary())
            return result

        except Exception as e:
            # Segna run come fallita
            pipeline_orchestrator.fail_run(run_id=run_id, error_message=str(e))
            raise

    async def _process_content(
        self,
        content: EnrichmentContent,
        result: EnrichmentResult,
    ) -> None:
        """
        Processa un singolo contenuto.

        Flow:
        1. Embed chunk → Qdrant (se configurato)
        2. Estrai entità → FalkorDB
        3. Link e dedup
        4. Scrivi nel grafo
        5. Crea bridge entries → chunk_id ↔ entity_node_id

        Args:
            content: Contenuto da processare
            result: Risultato da aggiornare
        """
        try:
            chunk_id = None

            # 1. Embed chunk in Qdrant (se configurato)
            if self.qdrant and self.embeddings and not self.config.dry_run:
                chunk_id = await self._embed_chunk(content)
                if self.config.verbose:
                    logger.debug(f"Chunk {content.id} embedded: {chunk_id}")

            # 2. Estrai entità
            entities = await self._extract_entities(content)

            if self.config.verbose:
                logger.debug(
                    f"Estratte {len(entities)} entità da {content.id}"
                )

            # 3. Link e dedup
            linked = await self._linker.link_batch(entities)

            # 4. Scrivi nel grafo (se non dry_run)
            if not self.config.dry_run:
                written = await self._writer.write_batch(linked, content)
                self._update_stats(result, written)

                # 5. Crea bridge entries (se configurato)
                if chunk_id and self.bridge_builder:
                    await self._create_bridge_entries(chunk_id, written, content)
                    if self.config.verbose:
                        logger.debug(
                            f"Bridge entries create per {len(written)} entità"
                        )
            else:
                # Dry run: simula scrittura
                for le in linked:
                    result.entities_created.append(le.node_id)

            # 6. Checkpoint
            self.checkpoint.mark_done(
                content.id,
                stats_update={"processed": 1}
            )

        except Exception as e:
            logger.error(f"Errore processing {content.id}: {e}")
            result.add_error(content.id, "processing", e)
            self.checkpoint.mark_error(content.id)

    async def _extract_entities(
        self,
        content: EnrichmentContent,
    ) -> List[ExtractedEntity]:
        """
        Estrae entità da un contenuto usando tutti gli extractor.

        Args:
            content: Contenuto da processare

        Returns:
            Lista di entità estratte
        """
        all_entities = []

        # Esegui extractors in parallelo
        tasks = []
        for entity_type, extractor in self._extractors.items():
            tasks.append(extractor.extract(content))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, res in enumerate(results):
            if isinstance(res, Exception):
                logger.warning(f"Extractor error: {res}")
                continue
            all_entities.extend(res)

        return all_entities

    def _update_stats(
        self,
        result: EnrichmentResult,
        written: List[LinkedEntity],
    ) -> None:
        """Aggiorna statistiche in base a entità scritte."""
        from merlt.pipeline.enrichment.models import EntityType

        for le in written:
            result.entities_created.append(le.node_id)

            if le.entity.tipo == EntityType.CONCETTO:
                if le.is_new:
                    result.stats.concepts_created += 1
                else:
                    result.stats.concepts_merged += 1
            elif le.entity.tipo == EntityType.PRINCIPIO:
                if le.is_new:
                    result.stats.principles_created += 1
                else:
                    result.stats.principles_merged += 1
            elif le.entity.tipo == EntityType.DEFINIZIONE:
                if le.is_new:
                    result.stats.definitions_created += 1
                else:
                    result.stats.definitions_merged += 1

    async def _embed_chunk(
        self,
        content: EnrichmentContent,
    ) -> Optional[str]:
        """
        Embed chunk text e store in Qdrant.

        Args:
            content: Contenuto da embeddare

        Returns:
            chunk_id (UUID string) se successo, None altrimenti
        """
        from uuid import uuid4
        from qdrant_client.models import PointStruct

        try:
            # Genera embedding (usa "passage: " prefix per documenti)
            embedding = self.embeddings.encode_document(content.text)

            # Genera UUID per chunk
            chunk_id = str(uuid4())

            # Prepara metadata
            metadata = {
                "content_id": content.id,
                "source": content.source,
                "content_type": content.content_type,
                "article_refs": content.article_refs[:10],  # Limita per size
                "text_preview": content.text[:500],
                "source_type": "enrichment",
            }

            # Upsert in Qdrant
            self.qdrant.upsert(
                collection_name=self.qdrant_collection,
                points=[
                    PointStruct(
                        id=chunk_id,
                        vector=embedding,  # encode_document già ritorna lista
                        payload=metadata,
                    )
                ],
            )

            logger.debug(f"Chunk embedded: {chunk_id}")
            return chunk_id

        except Exception as e:
            logger.error(f"Errore embedding chunk {content.id}: {e}")
            return None

    async def _create_bridge_entries(
        self,
        chunk_id: str,
        entities: List[LinkedEntity],
        content: EnrichmentContent,
    ) -> int:
        """
        Crea bridge table entries linking chunk → entities.

        Args:
            chunk_id: UUID del chunk in Qdrant
            entities: Entità scritte nel grafo
            content: Contenuto originale

        Returns:
            Numero di entries create
        """
        from uuid import UUID
        from merlt.models import BridgeMapping

        mappings = []

        for entity in entities:
            # Determina mapping_type in base al tipo entità
            if entity.entity.tipo.value == "concetto":
                mapping_type = "CONCEPT"
            elif entity.entity.tipo.value == "principio":
                mapping_type = "CONCEPT"
            elif entity.entity.tipo.value == "definizione":
                mapping_type = "CONCEPT"
            elif entity.entity.tipo.value == "dottrina":
                mapping_type = "DOCTRINE"
            else:
                mapping_type = "CONCEPT"

            mapping = BridgeMapping(
                chunk_id=UUID(chunk_id),
                graph_node_urn=entity.node_id,  # Il node_id è l'URN/identificatore
                mapping_type=mapping_type,
                confidence=entity.entity.confidence,
                chunk_text=content.text[:2000] if content.text else None,  # Primi 2000 char
                metadata={
                    "source": content.source,
                    "content_id": content.id,
                    "entity_name": entity.entity.nome,
                    "entity_type": entity.entity.tipo.value,
                    "extraction_source": "enrichment_pipeline",
                },
            )
            mappings.append(mapping)

        if mappings:
            try:
                inserted = await self.bridge_builder.insert_mappings(mappings)
                logger.debug(f"Bridge entries create: {inserted}")
                return inserted
            except Exception as e:
                logger.error(f"Errore bridge entries: {e}")
                return 0

        return 0

    async def cleanup_existing_dottrina(self) -> int:
        """
        Cancella nodi Dottrina esistenti (pre-enrichment).

        ATTENZIONE: Operazione distruttiva!

        Returns:
            Numero di nodi cancellati
        """
        logger.warning("Cancellazione nodi Dottrina esistenti...")

        query = """
            MATCH (d:Dottrina)
            WITH d LIMIT 1000
            DETACH DELETE d
            RETURN count(d) as deleted
        """

        total_deleted = 0
        while True:
            result = await self.graph.query(query)
            deleted = result[0]["deleted"] if result else 0
            total_deleted += deleted

            if deleted < 1000:
                break

            logger.info(f"Cancellati {total_deleted} nodi Dottrina...")

        logger.info(f"Totale nodi Dottrina cancellati: {total_deleted}")
        return total_deleted
