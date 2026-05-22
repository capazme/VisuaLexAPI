"""
Legal Knowledge Graph
=====================

Core orchestration class that coordinates all MERL-T components:
- FalkorDB (graph storage)
- Qdrant (vector embeddings)
- PostgreSQL Bridge Table (chunk <-> node mapping)
- Multivigenza Pipeline (amendment tracking)
- Multi-Expert Interpreter (legal hermeneutics)

This class provides a unified API for legal knowledge management,
integrating components that were previously managed by separate scripts.

Usage:
    from merlt import LegalKnowledgeGraph, MerltConfig

    config = MerltConfig(
        falkordb_host="localhost",
        falkordb_port=6380,
        graph_name="merl_t_test",
        qdrant_host="localhost",
        qdrant_port=6333,
        postgres_url="postgresql://...",
    )

    kg = LegalKnowledgeGraph(config)
    await kg.connect()

    # Ingest a single article with all integrations
    result = await kg.ingest_norm(
        tipo_atto="codice penale",
        articolo="1",
        include_brocardi=True,
        include_embeddings=True,
        include_bridge=True,
        include_multivigenza=True,
    )

    # Search with hybrid retrieval
    results = await kg.search("Cos'è la legittima difesa?", top_k=5)

    # Interpret a legal question with multi-expert system
    interpretation = await kg.interpret("Cos'è la legittima difesa?")
    print(interpretation.synthesis)

    await kg.close()
"""

import structlog
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Tuple
from uuid import UUID

# Storage
from merlt.storage import (
    FalkorDBClient,
    FalkorDBConfig,
    BridgeTable,
    BridgeTableConfig,
    GraphAwareRetriever,
    RetrieverConfig,
)
from merlt.storage.bridge import BridgeBuilder

# Pipeline
from merlt.pipeline.ingestion import (
    IngestionPipelineV2,
    IngestionResult,
    BridgeMapping,
)
from merlt.pipeline.multivigenza import (
    MultivigenzaPipeline,
    MultivigenzaResult,
)
from merlt.pipeline.enrichment import (
    EnrichmentPipeline,
    EnrichmentConfig,
    EnrichmentResult,
)
from merlt.pipeline.visualex import VisualexArticle, NormaMetadata

# Sources
from merlt.clients import NormattivaScraper, BrocardiScraper, NormaVisitata, Norma, NormTree

# TODO: Implement locally or copy from visualex-api
# from merlt.utils.urngenerator import generate_urn
# from merlt.utils.treextractor import NormTree, get_article_position, get_hierarchical_tree

# Embeddings (optional, loaded lazily)
try:
    from merlt.storage.vectors.embeddings import EmbeddingService
    HAS_EMBEDDING_SERVICE = True
except ImportError:
    HAS_EMBEDDING_SERVICE = False

# Qdrant (optional, loaded lazily)
try:
    from qdrant_client import QdrantClient
    from qdrant_client.models import PointStruct, VectorParams, Distance
    HAS_QDRANT = True
except ImportError:
    HAS_QDRANT = False

log = structlog.get_logger()


@dataclass
class MerltConfig:
    """
    Configuration for LegalKnowledgeGraph.

    All URLs/hosts default to localhost development setup.
    """
    # FalkorDB
    falkordb_host: str = "localhost"
    falkordb_port: int = 6380
    graph_name: str = "merl_t_test"

    # Qdrant
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: Optional[str] = None  # Defaults to graph_name

    # PostgreSQL Bridge Table
    postgres_host: str = "localhost"
    postgres_port: int = 5433
    postgres_database: str = "rlcf_dev"
    postgres_user: str = "dev"
    postgres_password: str = "devpassword"

    # Embedding model
    embedding_model: str = "intfloat/multilingual-e5-large"
    embedding_dimension: int = 1024

    # Rate limiting for scrapers
    delay_between_articles: float = 1.0
    batch_size: int = 10
    delay_between_batches: float = 3.0

    def __post_init__(self):
        if self.qdrant_collection is None:
            # Convention: qdrant collection is {graph_name}_chunks
            self.qdrant_collection = f"{self.graph_name}_chunks"


@dataclass
class UnifiedIngestionResult:
    """
    Result of ingesting a norm with all integrations.

    Combines results from:
    - IngestionPipelineV2 (graph + chunks)
    - Bridge Table insertions
    - Qdrant vector upserts
    - MultivigenzaPipeline (amendments)
    """
    article_urn: str
    article_url: str

    # Graph
    nodes_created: List[str] = field(default_factory=list)
    relations_created: List[str] = field(default_factory=list)
    brocardi_enriched: bool = False

    # Chunks and embeddings
    chunks_created: int = 0
    embeddings_upserted: int = 0

    # Bridge table
    bridge_mappings_inserted: int = 0

    # Multivigenza
    modifiche_count: int = 0
    atti_modificanti_created: List[str] = field(default_factory=list)
    multivigenza_relations: List[str] = field(default_factory=list)

    # Errors
    errors: List[str] = field(default_factory=list)

    def summary(self) -> Dict[str, Any]:
        """Return summary for logging."""
        return {
            "article_urn": self.article_urn,
            "nodes": len(self.nodes_created),
            "relations": len(self.relations_created),
            "chunks": self.chunks_created,
            "embeddings": self.embeddings_upserted,
            "bridge_mappings": self.bridge_mappings_inserted,
            "modifiche": self.modifiche_count,
            "atti_modificanti": len(self.atti_modificanti_created),
            "brocardi": self.brocardi_enriched,
            "errors": len(self.errors),
        }


@dataclass
class InterpretationResult:
    """
    Risultato dell'interpretazione multi-expert di una query giuridica.

    Questa dataclass contiene la sintesi interpretativa prodotta dal sistema
    multi-expert basato sui canoni ermeneutici delle Preleggi (artt. 12-14).

    Il sistema usa AdaptiveSynthesizer per decidere automaticamente se:
    - CONVERGENT: Integrare le prospettive in risposta unificata
    - DIVERGENT: Presentare alternative con spiegazione del conflitto

    Attributes:
        query: Query originale
        synthesis: Sintesi interpretativa aggregata
        synthesis_mode: Modalità sintesi (convergent/divergent)
        expert_contributions: Contributi individuali degli expert
        combined_legal_basis: Fonti giuridiche combinate (norme, massime)
        confidence: Confidenza aggregata [0-1]
        routing_decision: Info sul routing (query_type, pesi)
        disagreement_analysis: Analisi del disagreement tra expert
        alternatives: Alternative presentate (solo in divergent mode)
        explanation: Spiegazione del disagreement (se presente)
        execution_time_ms: Tempo di esecuzione in ms
        trace_id: ID per tracciamento
        errors: Eventuali errori durante l'esecuzione

    Example:
        >>> result = await kg.interpret("Cos'è la legittima difesa?")
        >>> print(result.synthesis)
        >>> print(f"Mode: {result.synthesis_mode}")
        >>> if result.synthesis_mode == "divergent":
        ...     for alt in result.alternatives:
        ...         print(f"- {alt['expert']}: {alt['position'][:50]}")
    """
    query: str
    synthesis: str
    synthesis_mode: str = "convergent"  # "convergent" o "divergent"
    expert_contributions: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    combined_legal_basis: List[Dict[str, Any]] = field(default_factory=list)
    confidence: float = 0.0
    routing_decision: Optional[Dict[str, Any]] = None
    disagreement_analysis: Optional[Dict[str, Any]] = None
    alternatives: List[Dict[str, Any]] = field(default_factory=list)
    explanation: Optional[str] = None
    execution_time_ms: float = 0.0
    trace_id: str = ""
    errors: List[str] = field(default_factory=list)

    def summary(self) -> Dict[str, Any]:
        """Ritorna sommario per logging."""
        return {
            "query": self.query[:50] + "..." if len(self.query) > 50 else self.query,
            "synthesis_mode": self.synthesis_mode,
            "experts_used": list(self.expert_contributions.keys()),
            "confidence": round(self.confidence, 3),
            "sources": len(self.combined_legal_basis),
            "has_disagreement": self.disagreement_analysis.get("has_disagreement", False) if self.disagreement_analysis else False,
            "num_alternatives": len(self.alternatives),
            "execution_ms": round(self.execution_time_ms, 1),
            "has_errors": len(self.errors) > 0,
        }

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario per JSON."""
        return {
            "query": self.query,
            "synthesis": self.synthesis,
            "synthesis_mode": self.synthesis_mode,
            "expert_contributions": self.expert_contributions,
            "combined_legal_basis": self.combined_legal_basis,
            "confidence": self.confidence,
            "routing_decision": self.routing_decision,
            "disagreement_analysis": self.disagreement_analysis,
            "alternatives": self.alternatives,
            "explanation": self.explanation,
            "execution_time_ms": self.execution_time_ms,
            "trace_id": self.trace_id,
            "errors": self.errors,
        }


class LegalKnowledgeGraph:
    """
    Unified orchestration layer for MERL-T legal knowledge graph.

    This class coordinates all storage backends and processing pipelines,
    providing a single entry point for:

    1. **Ingestion**: Graph nodes + embeddings + bridge table + multivigenza
    2. **Search**: Hybrid semantic + graph-aware retrieval
    3. **Export**: Data export for training pipelines

    Architecture:
        LegalKnowledgeGraph
        ├── FalkorDBClient (graph storage)
        ├── QdrantClient (vector storage)
        ├── BridgeTable (chunk <-> node mapping)
        ├── IngestionPipelineV2 (graph ingestion)
        ├── MultivigenzaPipeline (amendment tracking)
        ├── EmbeddingService (vector generation)
        ├── NormattivaScraper (official text)
        └── BrocardiScraper (enrichment)
    """

    def __init__(self, config: Optional[MerltConfig] = None):
        """
        Initialize LegalKnowledgeGraph.

        Components are created but not connected until connect() is called.

        Args:
            config: MerltConfig with connection parameters
        """
        self.config = config or MerltConfig()

        # Storage clients (initialized in connect())
        self._falkordb: Optional[FalkorDBClient] = None
        self._qdrant: Optional[Any] = None  # QdrantClient
        self._bridge_table: Optional[BridgeTable] = None

        # Pipelines (initialized in connect())
        self._ingestion_pipeline: Optional[IngestionPipelineV2] = None
        self._multivigenza_pipeline: Optional[MultivigenzaPipeline] = None
        self._bridge_builder: Optional[BridgeBuilder] = None

        # Scrapers
        self._normattiva_scraper: Optional[NormattivaScraper] = None
        self._brocardi_scraper: Optional[BrocardiScraper] = None

        # Services
        self._embedding_service: Optional[Any] = None  # EmbeddingService
        self._ai_service: Optional[Any] = None  # OpenRouterService

        # Expert System (lazy initialized)
        self._orchestrator: Optional[Any] = None  # MultiExpertOrchestrator

        # Hierarchies cache (TODO: re-enable when utilities are implemented)
        self._norm_trees: Dict[str, Any] = {}

        self._connected = False

        log.info(f"LegalKnowledgeGraph initialized with config: {self.config.graph_name}")

    async def connect(self) -> None:
        """
        Connect to all storage backends.

        Must be called before any operations.
        """
        if self._connected:
            log.warning("Already connected")
            return

        log.info("Connecting to storage backends...")

        # FalkorDB
        falkordb_config = FalkorDBConfig(
            host=self.config.falkordb_host,
            port=self.config.falkordb_port,
            graph_name=self.config.graph_name,
        )
        self._falkordb = FalkorDBClient(falkordb_config)
        await self._falkordb.connect()
        log.info(f"FalkorDB connected: {self.config.graph_name}")

        # Qdrant (optional)
        if HAS_QDRANT:
            try:
                self._qdrant = QdrantClient(
                    host=self.config.qdrant_host,
                    port=self.config.qdrant_port,
                )
                # Ensure collection exists
                await self._ensure_qdrant_collection()
                log.info(f"Qdrant connected: {self.config.qdrant_collection}")
            except Exception as e:
                log.warning(f"Qdrant connection failed: {e}")
                self._qdrant = None

        # Bridge Table
        try:
            bridge_config = BridgeTableConfig(
                host=self.config.postgres_host,
                port=self.config.postgres_port,
                database=self.config.postgres_database,
                user=self.config.postgres_user,
                password=self.config.postgres_password,
            )
            self._bridge_table = BridgeTable(bridge_config)
            await self._bridge_table.connect()
            self._bridge_builder = BridgeBuilder(self._bridge_table)
            log.info("Bridge Table connected")
        except Exception as e:
            log.warning(f"Bridge Table connection failed: {e}")
            self._bridge_table = None
            self._bridge_builder = None

        # Initialize pipelines
        self._ingestion_pipeline = IngestionPipelineV2(
            falkordb_client=self._falkordb,
        )

        # Initialize scrapers
        self._normattiva_scraper = NormattivaScraper()
        self._brocardi_scraper = BrocardiScraper()

        # Multivigenza pipeline
        self._multivigenza_pipeline = MultivigenzaPipeline(
            falkordb_client=self._falkordb,
            scraper=self._normattiva_scraper,
        )

        # Embedding service (lazy loaded on first use)
        if HAS_EMBEDDING_SERVICE:
            try:
                self._embedding_service = EmbeddingService.get_instance(
                    model_name=self.config.embedding_model
                )
            except Exception as e:
                log.warning(f"Embedding service initialization failed: {e}")

        self._connected = True
        log.info("LegalKnowledgeGraph connected successfully")

    async def close(self) -> None:
        """Close all connections."""
        if self._falkordb:
            await self._falkordb.close()
        if self._bridge_table:
            await self._bridge_table.close()
        if self._qdrant:
            self._qdrant.close()

        self._connected = False
        log.info("LegalKnowledgeGraph connections closed")

    async def _ensure_qdrant_collection(self) -> None:
        """Ensure Qdrant collection exists with correct parameters."""
        if not self._qdrant:
            return

        collection_name = self.config.qdrant_collection
        collections = self._qdrant.get_collections().collections
        exists = any(c.name == collection_name for c in collections)

        if not exists:
            self._qdrant.create_collection(
                collection_name=collection_name,
                vectors_config=VectorParams(
                    size=self.config.embedding_dimension,
                    distance=Distance.COSINE,
                ),
            )
            log.info(f"Created Qdrant collection: {collection_name}")

    async def ingest_norm(
        self,
        tipo_atto: str,
        articolo: str,
        include_brocardi: bool = True,
        include_embeddings: bool = True,
        include_bridge: bool = True,
        include_multivigenza: bool = True,
        norm_tree: Optional[NormTree] = None,
    ) -> UnifiedIngestionResult:
        """
        Ingest a single legal norm with all integrations.

        This is the main entry point for adding legal content to the knowledge graph.
        All backend operations (graph, vectors, bridge table, multivigenza) are
        handled automatically.

        Args:
            tipo_atto: Type of act (e.g., "codice penale", "codice civile")
            articolo: Article number (e.g., "1", "52", "81 bis")
            include_brocardi: Whether to fetch Brocardi enrichment
            include_embeddings: Whether to generate and store embeddings
            include_bridge: Whether to update bridge table
            include_multivigenza: Whether to track amendments

        Returns:
            UnifiedIngestionResult with all operation results
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        # Normalize article number
        articolo_norm = articolo.replace(' ', '-')

        # Create NormaVisitata reference
        norma = Norma(tipo_atto=tipo_atto, data=None, numero_atto=None)
        nv = NormaVisitata(norma=norma, numero_articolo=articolo_norm)

        log.info(f"Ingesting: {tipo_atto} art. {articolo}")

        # NormaVisitata ha solo .urn, l'URL viene recuperato dopo fetch
        result = UnifiedIngestionResult(
            article_urn=nv.urn,
            article_url="",  # Sarà aggiornato dopo fetch
        )

        try:
            # 1. Fetch from Normattiva
            article_text, article_url = await self._normattiva_scraper.get_document(nv)
            result.article_url = article_url

            # 2. Fetch Brocardi enrichment (optional)
            brocardi_info = None
            if include_brocardi:
                try:
                    # get_info returns (position, info_dict, brocardi_url)
                    position, info_dict, brocardi_url = await self._brocardi_scraper.get_info(nv)
                    if info_dict:
                        brocardi_info = info_dict
                        result.brocardi_enriched = True
                except Exception as e:
                    log.warning(f"Brocardi fetch failed: {e}")
                    result.errors.append(f"Brocardi: {str(e)[:100]}")

            # 3. Build VisualexArticle for pipeline
            metadata = NormaMetadata(
                tipo_atto=tipo_atto,
                data=norma.data,
                numero_atto=norma.numero_atto,
                numero_articolo=articolo_norm,
            )

            visualex_article = VisualexArticle(
                metadata=metadata,
                article_text=article_text,
                url=article_url,
                brocardi_info=brocardi_info,
            )

            # 4. Run ingestion pipeline (graph + chunks)
            cached_tree = norm_tree or await self._get_cached_norm_tree(tipo_atto)
            ingestion_result = await self._ingestion_pipeline.ingest_article(
                article=visualex_article,
                create_graph_nodes=True,
                norm_tree=cached_tree,
            )

            result.nodes_created = ingestion_result.nodes_created
            result.relations_created = ingestion_result.relations_created
            result.chunks_created = len(ingestion_result.chunks)

            # 5. Insert bridge table mappings (optional)
            if include_bridge and self._bridge_builder and ingestion_result.bridge_mappings:
                try:
                    inserted = await self._bridge_builder.insert_mappings(
                        ingestion_result.bridge_mappings
                    )
                    result.bridge_mappings_inserted = inserted
                except Exception as e:
                    log.warning(f"Bridge table insert failed: {e}")
                    result.errors.append(f"Bridge: {str(e)[:100]}")

            # 6. Generate and store embeddings (optional) - MULTI-SOURCE
            if include_embeddings and self._qdrant and self._embedding_service:
                try:
                    upserted = await self._upsert_embeddings_multi_source(
                        article_text=article_text,
                        article_urn=ingestion_result.article_urn,
                        metadata=metadata,
                        brocardi_info=brocardi_info,
                    )
                    result.embeddings_upserted = upserted
                except Exception as e:
                    log.warning(f"Embedding upsert failed: {e}")
                    result.errors.append(f"Embeddings: {str(e)[:100]}")

            # 7. Apply multivigenza (optional)
            if include_multivigenza:
                try:
                    mv_result = await self._multivigenza_pipeline.ingest_with_history(
                        nv,
                        fetch_all_versions=False,
                        create_modifying_acts=True,
                    )
                    result.modifiche_count = len(mv_result.storia.modifiche) if mv_result.storia else 0
                    result.atti_modificanti_created = mv_result.atti_modificanti_creati
                    result.multivigenza_relations = mv_result.relazioni_create
                except Exception as e:
                    log.warning(f"Multivigenza failed: {e}")
                    result.errors.append(f"Multivigenza: {str(e)[:100]}")

            log.info(f"Ingestion complete: {result.summary()}")

        except Exception as e:
            log.error(f"Ingestion failed: {e}", exc_info=True)
            result.errors.append(f"Fatal: {str(e)}")

        return result

    async def _upsert_embeddings_multi_source(
        self,
        article_text: str,
        article_urn: str,
        metadata: NormaMetadata,
        brocardi_info: Optional[Dict[str, Any]] = None,
    ) -> int:
        """
        Generate and upsert multi-source embeddings.

        Creates embeddings for:
        1. Article text (norma) - always
        2. Spiegazione Brocardi - if available
        3. Ratio legis - if available
        4. Massime (top 5) - if available

        This enables semantic search via explanation/ratio, not just exact text.

        Returns number of embeddings upserted.
        """
        if not self._qdrant or not self._embedding_service:
            return 0

        points_to_upsert = []
        base_payload = {
            "article_urn": article_urn,
            "tipo_atto": metadata.tipo_atto,
            "numero_articolo": metadata.numero_articolo,
        }

        # 1. Embedding del testo normativo (sempre)
        if article_text and len(article_text.strip()) > 20:
            embedding = await self._embedding_service.encode_document_async(article_text)
            point_id = hash(f"{article_urn}:norma") % (2**63)
            points_to_upsert.append(PointStruct(
                id=point_id,
                vector=embedding,
                payload={
                    **base_payload,
                    "source_type": "norma",
                    "text": article_text[:2000],
                },
            ))
            log.debug(f"Created embedding for norma: {article_urn}")

        # Process Brocardi info if available
        if brocardi_info:
            # 2. Embedding della Spiegazione
            spiegazione = brocardi_info.get("Spiegazione", "")
            if spiegazione and len(spiegazione.strip()) > 50:
                embedding = await self._embedding_service.encode_document_async(spiegazione)
                point_id = hash(f"{article_urn}:spiegazione") % (2**63)
                points_to_upsert.append(PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        **base_payload,
                        "source_type": "spiegazione",
                        "text": spiegazione[:2000],
                    },
                ))
                log.debug(f"Created embedding for spiegazione: {article_urn}")

            # 3. Embedding della Ratio legis
            ratio = brocardi_info.get("Ratio", "")
            if ratio and len(ratio.strip()) > 50:
                embedding = await self._embedding_service.encode_document_async(ratio)
                point_id = hash(f"{article_urn}:ratio") % (2**63)
                points_to_upsert.append(PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        **base_payload,
                        "source_type": "ratio",
                        "text": ratio[:2000],
                    },
                ))
                log.debug(f"Created embedding for ratio: {article_urn}")

            # 4. Embedding delle Massime (top 5)
            massime = brocardi_info.get("Massime", [])
            massime_added = 0
            if isinstance(massime, list):
                for i, massima in enumerate(massime[:5]):
                    # Handle various formats from Brocardi
                    # Field is "massima" from BrocardiScraper._parse_massima()
                    if isinstance(massima, str):
                        testo = massima
                    elif isinstance(massima, dict):
                        testo = massima.get("massima", massima.get("testo", massima.get("Testo", "")))
                    else:
                        continue

                    if testo and len(testo.strip()) > 50:
                        embedding = await self._embedding_service.encode_document_async(testo)
                        point_id = hash(f"{article_urn}:massima:{i}") % (2**63)
                        points_to_upsert.append(PointStruct(
                            id=point_id,
                            vector=embedding,
                            payload={
                                **base_payload,
                                "source_type": "massima",
                                "massima_index": i,
                                "text": testo[:2000],
                            },
                        ))
                        massime_added += 1

                if massime_added:
                    log.debug(f"Created {massime_added} massima embeddings for: {article_urn}")

        # Upsert all points at once
        if points_to_upsert:
            self._qdrant.upsert(
                collection_name=self.config.qdrant_collection,
                points=points_to_upsert,
            )
            log.info(f"Upserted {len(points_to_upsert)} multi-source embeddings for {article_urn}")

        return len(points_to_upsert)

    async def _get_cached_norm_tree(self, tipo_atto: str) -> Optional[Any]:
        """Get cached NormTree for act type, or fetch and cache it."""
        # TODO: Implement generate_urn and get_hierarchical_tree locally
        log.warning(f"NormTree fetch disabled - utilities not yet implemented")
        return None

        # if tipo_atto not in self._norm_trees:
        #     try:
        #         # Genera URN direttamente (Norma non ha property .urn)
        #         urn = generate_urn(act_type=tipo_atto, urn_flag=True)
        #         if urn:
        #             tree, status = await get_hierarchical_tree(urn)
        #             if status == 200 and isinstance(tree, NormTree):
        #                 self._norm_trees[tipo_atto] = tree
        #     except Exception as e:
        #         log.warning(f"Could not fetch NormTree for {tipo_atto}: {e}")
        #         return None
        #
        # return self._norm_trees.get(tipo_atto)

    async def search(
        self,
        query: str,
        top_k: int = 5,
        include_graph_context: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        Search the knowledge graph with hybrid retrieval.

        Uses semantic search (embeddings) combined with graph context
        for improved legal information retrieval.

        Args:
            query: Natural language query
            top_k: Number of results to return
            include_graph_context: Whether to expand results with graph neighbors

        Returns:
            List of search results with scores and context
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        if not self._qdrant or not self._embedding_service:
            raise RuntimeError("Search requires Qdrant and EmbeddingService")

        # Encode query
        query_embedding = await self._embedding_service.encode_query_async(query)

        # Search Qdrant (using query_points API)
        response = self._qdrant.query_points(
            collection_name=self.config.qdrant_collection,
            query=query_embedding,
            limit=top_k,
        )
        results = response.points

        # Format results
        formatted = []
        for hit in results:
            result = {
                "urn": hit.payload.get("urn"),
                "tipo_atto": hit.payload.get("tipo_atto"),
                "numero_articolo": hit.payload.get("numero_articolo"),
                "text": hit.payload.get("text"),
                "score": hit.score,
            }

            # Optionally add graph context
            if include_graph_context and self._falkordb:
                try:
                    context = await self._get_graph_context(hit.payload.get("urn"))
                    result["graph_context"] = context
                except Exception as e:
                    log.warning(f"Could not fetch graph context: {e}")

            formatted.append(result)

        return formatted

    async def _get_graph_context(self, urn: str) -> Dict[str, Any]:
        """Fetch graph context for a URN (neighbors, hierarchy)."""
        if not self._falkordb or not urn:
            return {}

        # Get parent and related nodes
        result = await self._falkordb.query(
            """
            MATCH (n:Norma {URN: $urn})
            OPTIONAL MATCH (parent)-[:contiene]->(n)
            OPTIONAL MATCH (n)-[:contiene]->(child)
            OPTIONAL MATCH (modifier)-[:modifica|abroga|sostituisce|inserisce]->(n)
            RETURN
                parent.URN as parent_urn,
                parent.titolo as parent_title,
                collect(DISTINCT child.numero_articolo) as children,
                collect(DISTINCT modifier.estremi) as modifiers
            """,
            {"urn": urn}
        )

        if result.result_set:
            row = result.result_set[0]
            return {
                "parent_urn": row[0],
                "parent_title": row[1],
                "children": row[2] or [],
                "modifiers": row[3] or [],
            }

        return {}

    # ═══════════════════════════════════════════════════════════════════════════
    #                           INTERPRETATION API
    # ═══════════════════════════════════════════════════════════════════════════

    async def interpret(
        self,
        query: str,
        include_search: bool = True,
        max_experts: int = 4,
        timeout_seconds: float = 30.0,
    ) -> InterpretationResult:
        """
        Interpreta una domanda giuridica usando il sistema multi-expert.

        Coordina 4 Expert basati sui canoni ermeneutici delle Preleggi:
        - LiteralExpert: "significato proprio delle parole" (art. 12, I)
        - SystemicExpert: "connessione di esse" + storico (art. 12, I + art. 14)
        - PrinciplesExpert: "intenzione del legislatore" (art. 12, II)
        - PrecedentExpert: Prassi applicativa giurisprudenziale

        Il sistema:
        1. Classifica la query (definitional, constitutional, jurisprudential, etc.)
        2. Seleziona gli Expert più appropriati
        3. Esegue gli Expert in parallelo
        4. AdaptiveSynthesizer sintetizza con disagreement detection
        5. Decide automaticamente: CONVERGENT o DIVERGENT

        Args:
            query: Domanda in linguaggio naturale
            include_search: Se True, esegue pre-retrieval semantico
            max_experts: Numero massimo di Expert da invocare
            timeout_seconds: Timeout per ogni Expert

        Returns:
            InterpretationResult con:
            - synthesis: Sintesi interpretativa
            - synthesis_mode: "convergent" o "divergent"
            - disagreement_analysis: Analisi del disagreement
            - alternatives: Alternative (solo in divergent mode)

        Example:
            >>> result = await kg.interpret("Cos'è la legittima difesa?")
            >>> print(result.synthesis)
            >>> print(f"Mode: {result.synthesis_mode}")
            >>> if result.synthesis_mode == "divergent":
            ...     for alt in result.alternatives:
            ...         print(f"- {alt['expert']}: {alt['position'][:50]}")

        Note:
            - Richiede connessione (chiamare connect() prima)
            - Richiede OPENROUTER_API_KEY in env per analisi LLM
            - Senza AI service, usa fallback rule-based
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        errors: List[str] = []

        # Lazy init del MultiExpertOrchestrator
        if self._orchestrator is None:
            try:
                self._orchestrator = await self._init_orchestrator(
                    max_experts=max_experts,
                    timeout_seconds=timeout_seconds,
                )
            except Exception as e:
                log.warning(f"Could not initialize orchestrator with AI: {e}")
                errors.append(f"Orchestrator init: {str(e)[:100]}")
                # Fallback: orchestrator senza AI
                self._orchestrator = await self._init_orchestrator(
                    max_experts=max_experts,
                    timeout_seconds=timeout_seconds,
                    skip_ai=True,
                )

        # Pre-retrieval semantico (opzionale)
        retrieved_chunks = []
        entities: Dict[str, List[str]] = {"norm_references": [], "legal_concepts": []}

        if include_search and self._qdrant and self._embedding_service:
            try:
                search_results = await self.search(query, top_k=5)
                for sr in search_results:
                    retrieved_chunks.append({
                        "text": sr.get("text", ""),
                        "urn": sr.get("urn", ""),
                        "score": sr.get("score", 0.0),
                    })
                    # Estrai URN come norm_references
                    if sr.get("urn"):
                        entities["norm_references"].append(sr["urn"])
            except Exception as e:
                log.warning(f"Pre-retrieval failed: {e}")
                errors.append(f"Pre-retrieval: {str(e)[:100]}")

        # Esegui interpretazione
        try:
            synthesis_result, routing = await self._orchestrator.process_with_routing(
                query=query,
                entities=entities if entities["norm_references"] else None,
                retrieved_chunks=retrieved_chunks if retrieved_chunks else None,
            )

            # Mappa SynthesisResult → InterpretationResult
            result = InterpretationResult(
                query=query,
                synthesis=synthesis_result.synthesis,
                synthesis_mode=synthesis_result.mode.value,
                expert_contributions=synthesis_result.expert_contributions,
                combined_legal_basis=[
                    source.to_dict() if hasattr(source, 'to_dict') else {
                        "source_type": source.source_type,
                        "source_id": source.source_id,
                        "citation": source.citation,
                    }
                    for source in synthesis_result.combined_legal_basis
                ],
                confidence=synthesis_result.confidence,
                routing_decision={
                    "query_type": routing.query_type,
                    "expert_weights": routing.expert_weights,
                    "confidence": routing.confidence,
                    "reasoning": routing.reasoning,
                },
                disagreement_analysis=synthesis_result.disagreement_analysis.to_dict() if synthesis_result.disagreement_analysis else None,
                alternatives=synthesis_result.alternatives,
                explanation=synthesis_result.explanation,
                trace_id=synthesis_result.trace_id,
                errors=errors,
            )

            log.info(f"Interpretation complete: {result.summary()}")
            return result

        except Exception as e:
            log.error(f"Interpretation failed: {e}", exc_info=True)
            return InterpretationResult(
                query=query,
                synthesis=f"Errore durante l'interpretazione: {str(e)}",
                confidence=0.0,
                errors=errors + [str(e)],
            )

    async def _init_orchestrator(
        self,
        max_experts: int = 4,
        timeout_seconds: float = 30.0,
        skip_ai: bool = False,
    ) -> Any:
        """
        Inizializza il MultiExpertOrchestrator con AdaptiveSynthesizer.

        Args:
            max_experts: Numero massimo Expert
            timeout_seconds: Timeout per Expert
            skip_ai: Se True, non inizializza AI service

        Returns:
            MultiExpertOrchestrator configurato con AdaptiveSynthesizer
        """
        from merlt.experts import (
            MultiExpertOrchestrator,
            OrchestratorConfig,
            AdaptiveSynthesizer,
            SynthesisConfig,
        )
        from merlt.tools import SemanticSearchTool, GraphSearchTool

        # Configura tools
        tools = []

        # SemanticSearchTool (richiede retriever + embeddings)
        if self._qdrant and self._embedding_service:
            # Crea retriever se non esiste
            if not hasattr(self, '_retriever') or self._retriever is None:
                try:
                    from merlt.rlcf.policy_manager import get_policy_manager
                    retriever_config = RetrieverConfig()
                    self._retriever = GraphAwareRetriever(
                        vector_db=self._qdrant,
                        graph_db=self._falkordb,
                        bridge_table=self._bridge_table,
                        config=retriever_config,
                        policy_manager=get_policy_manager(),
                    )
                except Exception as e:
                    log.warning(f"Could not create GraphAwareRetriever: {e}")
                    self._retriever = None

            if self._retriever:
                tools.append(SemanticSearchTool(
                    retriever=self._retriever,
                    embeddings=self._embedding_service,
                ))

        # GraphSearchTool
        if self._falkordb:
            tools.append(GraphSearchTool(graph_db=self._falkordb))

        # AI Service (OpenRouter)
        ai_service = None
        if not skip_ai:
            try:
                from merlt.rlcf.ai_service import OpenRouterService
                ai_service = OpenRouterService()
                self._ai_service = ai_service
            except Exception as e:
                log.warning(f"Could not initialize OpenRouterService: {e}")

        # Crea AdaptiveSynthesizer (OBBLIGATORIO)
        synthesis_config = SynthesisConfig(
            convergent_threshold=0.5,
            resolvability_weight=0.3,
            include_disagreement_explanation=True,
            max_alternatives=3,
        )
        synthesizer = AdaptiveSynthesizer(
            config=synthesis_config,
            ai_service=ai_service,
        )

        # Config orchestrator
        config = OrchestratorConfig(
            max_experts=max_experts,
            timeout_seconds=timeout_seconds,
            parallel_execution=True,
        )

        log.info(
            f"Initializing MultiExpertOrchestrator: "
            f"tools={len(tools)}, has_ai={ai_service is not None}, "
            f"synthesis_mode=auto"
        )

        return MultiExpertOrchestrator(
            synthesizer=synthesizer,
            tools=tools,
            ai_service=ai_service,
            config=config,
        )

    @property
    def is_connected(self) -> bool:
        """Check if connected to backends."""
        return self._connected

    @property
    def falkordb(self) -> Optional[FalkorDBClient]:
        """Access FalkorDB client directly."""
        return self._falkordb

    @property
    def qdrant(self) -> Optional[Any]:
        """Access Qdrant client directly."""
        return self._qdrant

    @property
    def bridge_table(self) -> Optional[BridgeTable]:
        """Access Bridge Table directly."""
        return self._bridge_table

    # ═══════════════════════════════════════════════════════════════════════════
    #                           ENRICHMENT API
    # ═══════════════════════════════════════════════════════════════════════════

    async def enrich(
        self,
        config: EnrichmentConfig,
    ) -> EnrichmentResult:
        """
        Arricchisce il Knowledge Graph con entità strutturate.

        Estrae Concetti, Principi, Definizioni e altre entità dalle fonti
        configurate (Brocardi, manuali PDF, etc.) e le collega al backbone
        esistente (Norma, Comma).

        Questa è la funzionalità core per l'enrichment incrementale del grafo,
        progettata per essere:
        - **Riproducibile**: Stessa config → stesso output
        - **Scalabile**: Da Libro IV a tutta la legislazione
        - **Robusto**: Checkpoint, retry, gestione errori
        - **Incrementale**: Eseguibile più volte senza duplicati

        Args:
            config: Configurazione dell'enrichment con:
                - sources: Fonti da cui estrarre (BrocardiSource, ManualSource)
                - entity_types: Tipi di entità da estrarre
                - scope: Filtro articoli (libro, range, URN)
                - llm_model: Modello LLM per estrazione
                - checkpoint_dir: Directory per checkpoint/resume

        Returns:
            EnrichmentResult con statistiche e errori

        Example:
            >>> from merlt.pipeline.enrichment import EnrichmentConfig
            >>> from merlt.pipeline.enrichment.sources import BrocardiSource, ManualSource
            >>>
            >>> config = EnrichmentConfig(
            ...     sources=[
            ...         BrocardiSource(),
            ...         ManualSource(path="data/manuali/libro_iv/"),
            ...     ],
            ...     entity_types=["concetto", "principio", "definizione"],
            ...     scope={"libro": "IV", "articoli": (1173, 2059)},
            ... )
            >>>
            >>> result = await kg.enrich(config)
            >>> print(f"Creati {result.stats.total_entities_created} entità")

        Note:
            - Richiede connessione attiva (chiamare connect() prima)
            - Richiede OPENROUTER_API_KEY in env per estrazione LLM
            - Il progress viene salvato in checkpoint per resume automatico
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        # Lazy import per evitare circular
        from merlt.rlcf.ai_service import OpenRouterService

        log.info(
            f"Starting enrichment: {len(config.sources)} sources, "
            f"scope={config.scope}"
        )

        # Inizializza LLM service
        llm_service = OpenRouterService()

        try:
            # Crea pipeline con integrazione completa:
            # - Qdrant per storage vettoriale dei chunk
            # - BridgeBuilder per collegamento chunk ↔ entità
            pipeline = EnrichmentPipeline(
                graph_client=self._falkordb,
                embedding_service=self._embedding_service,
                llm_service=llm_service,
                config=config,
                qdrant_client=self._qdrant,
                bridge_builder=self._bridge_builder,
                qdrant_collection=self.config.qdrant_collection,
            )

            # Esegui enrichment
            result = await pipeline.run()

            log.info(f"Enrichment completed: {result.stats.total_entities_created} entities created")
            return result

        finally:
            # Cleanup LLM service
            await llm_service.close()

    async def cleanup_dottrina(self, min_version: str = "2.0") -> int:
        """
        Cancella nodi Dottrina con schema vecchio.

        Utile prima di eseguire un nuovo enrichment per rimuovere
        i nodi Dottrina generici creati in versioni precedenti.

        Args:
            min_version: Versione minima schema da mantenere

        Returns:
            Numero di nodi cancellati

        Example:
            >>> deleted = await kg.cleanup_dottrina()
            >>> print(f"Cancellati {deleted} nodi Dottrina obsoleti")
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        from merlt.pipeline.enrichment.writers import EnrichmentGraphWriter

        writer = EnrichmentGraphWriter(self._falkordb)
        return await writer.cleanup_old_dottrina(min_version=min_version)

    # ═══════════════════════════════════════════════════════════════════════════
    #                           BATCH INGESTION API
    # ═══════════════════════════════════════════════════════════════════════════

    async def ingest_batch(
        self,
        tipo_atto: str,
        article_range: Tuple[int, int],
        batch_size: int = 10,
        max_concurrent_fetches: int = 5,
        include_brocardi: bool = True,
        include_multivigenza: bool = True,
    ) -> "BatchIngestionResult":
        """
        Ingest batch di articoli con ottimizzazioni per performance.

        Parallelizza:
        - HTTP fetches (Normattiva + Brocardi)
        - Embedding generation (batch encoding)
        - Database operations (batch upserts)

        Performance: 5-10x più veloce di ingest_norm sequenziale.

        Args:
            tipo_atto: Tipo atto (es. "codice civile")
            article_range: Range articoli (start, end) inclusi
            batch_size: Articoli per batch (default: 10)
            max_concurrent_fetches: Max fetch HTTP paralleli (default: 5)
            include_brocardi: Include enrichment Brocardi
            include_multivigenza: Include tracking modifiche

        Returns:
            BatchIngestionResult con statistiche complete

        Example:
            >>> # Ingest Libro IV (artt. 1173-2059)
            >>> result = await kg.ingest_batch(
            ...     tipo_atto="codice civile",
            ...     article_range=(1173, 2059),
            ...     batch_size=10,
            ... )
            >>> print(result.summary())
        """
        if not self._connected:
            raise RuntimeError("Not connected. Call connect() first.")

        from merlt.pipeline.batch_ingestion import BatchIngestionPipeline

        # Create article numbers list
        start, end = article_range
        article_numbers = [str(n) for n in range(start, end + 1)]

        # Create and run batch pipeline
        pipeline = BatchIngestionPipeline(
            kg=self,
            batch_size=batch_size,
            max_concurrent_fetches=max_concurrent_fetches,
        )

        return await pipeline.ingest_batch(
            tipo_atto=tipo_atto,
            article_numbers=article_numbers,
            include_brocardi=include_brocardi,
            include_multivigenza=include_multivigenza,
        )


# Type hint for return type
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from merlt.pipeline.batch_ingestion import BatchIngestionResult
    from typing import Tuple

__all__ = [
    "LegalKnowledgeGraph",
    "MerltConfig",
    "UnifiedIngestionResult",
    "InterpretationResult",
    "EnrichmentConfig",
    "EnrichmentResult",
]
