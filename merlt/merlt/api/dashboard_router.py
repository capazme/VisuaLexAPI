"""
Dashboard Router
================

Endpoints REST per Academic Dashboard di MERL-T.

Questo router espone API per:
- Overview KPIs del sistema
- Health check di tutti i servizi
- Diagramma architettura
- Activity feed

Endpoints:
- GET /dashboard/overview - KPIs aggregati e status
- GET /dashboard/health - Health check servizi
- GET /dashboard/architecture - Dati per diagramma react-flow
- GET /dashboard/architecture/node/{node_id} - Dettagli singolo nodo
- GET /dashboard/activity - Activity feed recente

Example:
    >>> response = await client.get("/api/v1/dashboard/overview")
    >>> overview = response.json()
    >>> print(f"Nodes: {overview['knowledge_graph']['total_nodes']}")
"""

import asyncio
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query

from merlt.api.auth import verify_api_key
from merlt.experts.models import ApiKey

from merlt.api.models.dashboard_models import (
    ServiceStatus,
    ActivityType,
    KnowledgeGraphKPIs,
    RLCFKPIs,
    ExpertKPIs,
    ServiceHealth,
    SystemHealth,
    ActivityEntry,
    ActivityFeed,
    DashboardOverview,
    ArchitectureNode,
    ArchitectureEdge,
    ArchitectureDiagram,
    NodeDetails,
)

log = structlog.get_logger()

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# Start time per uptime calculation
_start_time = time.time()

# Use explicit IN for index-friendly query (avoids full table scan on != operator).
# NOTE: For optimal performance on large tables, ensure a partial index exists:
# CREATE INDEX idx_qa_traces_public ON qa_traces (created_at) WHERE consent_level != 'anonymous';
_PUBLIC_CONSENT_LEVELS = ("basic", "full")


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


async def _check_falkordb_health() -> ServiceHealth:
    """Check FalkorDB connection and get metrics."""
    start = time.time()
    try:
        from merlt.storage.graph.client import FalkorDBClient
        client = FalkorDBClient()
        await client.connect()

        # Test with health_check method
        is_healthy = await client.health_check()
        latency = (time.time() - start) * 1000

        if is_healthy:
            return ServiceHealth(
                name="FalkorDB",
                status=ServiceStatus.ONLINE,
                latency_ms=latency,
                details={
                    "database": "merl_t_dev",
                    "connected": True,
                }
            )
        else:
            return ServiceHealth(
                name="FalkorDB",
                status=ServiceStatus.DEGRADED,
                latency_ms=latency,
                details={"error": "Health check returned false"}
            )
    except Exception as e:
        log.warning("FalkorDB health check failed", error=str(e))
        return ServiceHealth(
            name="FalkorDB",
            status=ServiceStatus.OFFLINE,
            details={"error": str(e)}
        )


async def _check_qdrant_health() -> ServiceHealth:
    """Check Qdrant connection and get metrics."""
    start = time.time()
    try:
        from qdrant_client import QdrantClient
        import os

        # Connect directly to Qdrant
        qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6343")
        client = QdrantClient(url=qdrant_url)

        # Check collections
        collections = client.get_collections()
        latency = (time.time() - start) * 1000

        return ServiceHealth(
            name="Qdrant",
            status=ServiceStatus.ONLINE,
            latency_ms=latency,
            details={
                "collections_count": len(collections.collections),
                "url": qdrant_url,
            }
        )
    except Exception as e:
        log.warning("Qdrant health check failed", error=str(e))
        return ServiceHealth(
            name="Qdrant",
            status=ServiceStatus.OFFLINE,
            details={"error": str(e)}
        )


async def _check_postgres_health() -> ServiceHealth:
    """Check PostgreSQL connection."""
    start = time.time()
    try:
        from merlt.storage.bridge.bridge_table import BridgeTable
        bridge = BridgeTable()
        await bridge.connect()

        # Test connection with count method
        count = await bridge.count()
        latency = (time.time() - start) * 1000

        return ServiceHealth(
            name="PostgreSQL",
            status=ServiceStatus.ONLINE,
            latency_ms=latency,
            details={
                "database": "rlcf_dev",
                "bridge_mappings": count,
            }
        )
    except Exception as e:
        log.warning("PostgreSQL health check failed", error=str(e))
        return ServiceHealth(
            name="PostgreSQL",
            status=ServiceStatus.OFFLINE,
            details={"error": str(e)}
        )


async def _check_redis_health() -> ServiceHealth:
    """Check Redis connection."""
    start = time.time()
    try:
        import redis.asyncio as redis
        client = redis.Redis(
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=int(os.environ.get("REDIS_PORT", "6381")),
            db=0,
        )

        # Ping
        await client.ping()
        latency = (time.time() - start) * 1000

        info = await client.info("memory")
        await client.close()

        return ServiceHealth(
            name="Redis",
            status=ServiceStatus.ONLINE,
            latency_ms=latency,
            details={
                "used_memory_human": info.get("used_memory_human", "N/A"),
            }
        )
    except Exception as e:
        log.warning("Redis health check failed", error=str(e))
        return ServiceHealth(
            name="Redis",
            status=ServiceStatus.OFFLINE,
            details={"error": str(e)}
        )


async def _get_knowledge_graph_kpis() -> KnowledgeGraphKPIs:
    """Get Knowledge Graph KPIs from FalkorDB and Qdrant."""
    total_nodes = 0
    total_edges = 0
    articles_count = 0
    entities_count = 0
    embeddings_count = 0
    bridge_mappings = 0

    # FalkorDB metrics
    try:
        from merlt.storage.graph.client import FalkorDBClient
        client = FalkorDBClient()
        await client.connect()

        # Count nodes
        nodes_result = await client.query("MATCH (n) RETURN count(n) as c")
        total_nodes = nodes_result[0]["c"] if nodes_result else 0

        # Count edges
        edges_result = await client.query("MATCH ()-[r]->() RETURN count(r) as c")
        total_edges = edges_result[0]["c"] if edges_result else 0

        # Count articles (Norma nodes)
        articles_result = await client.query(
            "MATCH (n) WHERE n.tipo_atto IS NOT NULL RETURN count(n) as c"
        )
        articles_count = articles_result[0]["c"] if articles_result else 0

        # Count entities
        entities_result = await client.query(
            "MATCH (n) WHERE n.entity_type IS NOT NULL RETURN count(n) as c"
        )
        entities_count = entities_result[0]["c"] if entities_result else 0
    except Exception as e:
        log.warning("Failed to get FalkorDB KPIs", error=str(e))

    # Embeddings count from Qdrant
    try:
        from qdrant_client import QdrantClient
        import os
        qdrant_url = os.getenv("QDRANT_URL", "http://localhost:6343")
        qdrant = QdrantClient(url=qdrant_url)

        # Get collection info for merl_t_dev_chunks
        try:
            collection_info = qdrant.get_collection("merl_t_dev_chunks")
            embeddings_count = collection_info.points_count or 0
        except Exception as e:
            log.debug("qdrant_collection_unavailable", error=str(e))
            # Collection might not exist
            embeddings_count = 0
    except Exception as e:
        log.warning("Failed to get Qdrant KPIs", error=str(e))

    # Bridge mappings from PostgreSQL
    try:
        from merlt.storage.bridge.bridge_table import BridgeTable
        bridge = BridgeTable()
        await bridge.connect()
        bridge_mappings = await bridge.count()
    except Exception as e:
        log.warning("Failed to get Bridge KPIs", error=str(e))

    return KnowledgeGraphKPIs(
        total_nodes=total_nodes,
        total_edges=total_edges,
        articles_count=articles_count,
        entities_count=entities_count,
        embeddings_count=embeddings_count,
        bridge_mappings=bridge_mappings,
    )


async def _get_rlcf_kpis() -> RLCFKPIs:
    """Get RLCF KPIs from TrainingScheduler."""
    try:
        from merlt.rlcf.training_scheduler import get_scheduler

        scheduler = get_scheduler()
        status = scheduler.get_status()
        buffer_stats = scheduler.get_buffer_stats()

        return RLCFKPIs(
            total_feedback=buffer_stats.total_added,
            buffer_size=buffer_stats.size,
            training_epochs=status.training_sessions_today,
            avg_authority=buffer_stats.avg_reward,
            active_users=0,  # Not tracked currently
        )
    except ImportError:
        log.debug("TrainingScheduler not available for RLCF KPIs")
        return RLCFKPIs()
    except Exception as e:
        log.warning("Failed to get RLCF KPIs", error=str(e))
        return RLCFKPIs()


async def _get_expert_kpis() -> ExpertKPIs:
    """Get Expert System KPIs from QATrace data."""
    try:
        from merlt.rlcf.database import get_async_session
        from merlt.experts.models import QATrace
        from sqlalchemy import select, func

        async with get_async_session() as session:
            result = await session.execute(
                select(
                    func.count(QATrace.trace_id),
                    func.avg(QATrace.execution_time_ms),
                    func.avg(QATrace.confidence),
                )
            )
            row = result.one()
            total = row[0] or 0
            avg_lat = row[1] or 0.0
            avg_conf = row[2] or 0.0

            # Count divergent for agreement rate
            div_result = await session.execute(
                select(func.count(QATrace.trace_id))
                .where(QATrace.synthesis_mode == "divergent")
            )
            divergent = div_result.scalar() or 0

        agreement = ((total - divergent) / total * 100) if total > 0 else 0.0

        return ExpertKPIs(
            total_queries=total,
            avg_latency_ms=round(avg_lat, 1),
            avg_confidence=round(avg_conf, 4),
            agreement_rate=round(agreement, 1),
        )
    except Exception as e:
        log.warning("Failed to get Expert KPIs", error=str(e))
        return ExpertKPIs()


async def _get_activity_feed(
    limit: int = 20,
    offset: int = 0,
    activity_type: Optional[ActivityType] = None,
) -> ActivityFeed:
    """Get recent activity from QATrace entries with DB-level pagination."""
    try:
        from merlt.rlcf.database import get_async_session
        from merlt.experts.models import QATrace
        from sqlalchemy import select, func

        async with get_async_session() as session:
            # Total count for pagination
            count_result = await session.execute(
                select(func.count(QATrace.trace_id))
                .where(QATrace.consent_level.in_(_PUBLIC_CONSENT_LEVELS))
            )
            total_count = count_result.scalar() or 0

            # Paginated query
            result = await session.execute(
                select(QATrace)
                .where(QATrace.consent_level.in_(_PUBLIC_CONSENT_LEVELS))
                .order_by(QATrace.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
            traces = result.scalars().all()

        entries = []
        for t in traces:
            entries.append(ActivityEntry(
                id=t.trace_id,
                type=ActivityType.QUERY,
                title=f"Query: {t.query_type or 'general'}",
                description=f"{', '.join(t.selected_experts or [])} → {t.synthesis_mode or 'unknown'}",
                timestamp=t.created_at,
                metadata={
                    "confidence": t.confidence,
                    "execution_time_ms": t.execution_time_ms,
                },
            ))

        return ActivityFeed(
            entries=entries,
            total_count=total_count,
            has_more=offset + limit < total_count,
        )
    except Exception as e:
        log.warning("Failed to get activity feed", error=str(e))
        return ActivityFeed(entries=[], total_count=0, has_more=False)


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/overview", response_model=DashboardOverview)
async def get_dashboard_overview(
    api_key: ApiKey = Depends(verify_api_key),
) -> DashboardOverview:
    """
    Recupera overview completo della dashboard.

    Aggrega KPIs da tutti i componenti del sistema:
    - Knowledge Graph (FalkorDB, Qdrant)
    - RLCF (buffer, training, authority)
    - Expert System (queries, latency, confidence)
    - System Health (tutti i servizi)
    - Activity Feed (eventi recenti)

    Returns:
        DashboardOverview con tutti i KPIs e status

    Example:
        >>> GET /api/v1/dashboard/overview
        {
          "knowledge_graph": {"total_nodes": 27740, ...},
          "rlcf": {"buffer_size": 847, ...},
          "experts": {"total_queries": 1247, ...},
          "health": {"overall_status": "online", ...},
          "recent_activity": {"entries": [...], ...}
        }
    """
    log.info("Getting dashboard overview")

    # Fetch all data in parallel
    kg_kpis, rlcf_kpis, expert_kpis, health, activity = await asyncio.gather(
        _get_knowledge_graph_kpis(),
        _get_rlcf_kpis(),
        _get_expert_kpis(),
        get_system_health(),
        _get_activity_feed(),
    )

    return DashboardOverview(
        knowledge_graph=kg_kpis,
        rlcf=rlcf_kpis,
        experts=expert_kpis,
        health=health,
        recent_activity=activity,
        last_updated=datetime.now(),
    )


@router.get("/health", response_model=SystemHealth)
async def get_system_health(
    api_key: ApiKey = Depends(verify_api_key),
) -> SystemHealth:
    """
    Health check di tutti i servizi.

    Controlla la connettività e lo stato di:
    - FalkorDB (graph database)
    - Qdrant (vector database)
    - PostgreSQL (RLCF persistence)
    - Redis (cache)

    Returns:
        SystemHealth con status di ogni servizio

    Example:
        >>> GET /api/v1/dashboard/health
        {
          "overall_status": "online",
          "services": [
            {"name": "FalkorDB", "status": "online", "latency_ms": 12.3},
            ...
          ],
          "uptime_seconds": 3600
        }
    """
    log.info("Checking system health")

    # Check all services in parallel
    services = await asyncio.gather(
        _check_falkordb_health(),
        _check_qdrant_health(),
        _check_postgres_health(),
        _check_redis_health(),
    )

    # Determine overall status
    statuses = [s.status for s in services]
    if all(s == ServiceStatus.ONLINE for s in statuses):
        overall = ServiceStatus.ONLINE
    elif all(s == ServiceStatus.OFFLINE for s in statuses):
        overall = ServiceStatus.OFFLINE
    else:
        overall = ServiceStatus.DEGRADED

    uptime = int(time.time() - _start_time)

    return SystemHealth(
        overall_status=overall,
        services=list(services),
        uptime_seconds=uptime,
        last_check=datetime.now(),
    )


@router.get("/architecture", response_model=ArchitectureDiagram)
async def get_architecture_diagram(
    api_key: ApiKey = Depends(verify_api_key),
) -> ArchitectureDiagram:
    """
    Dati per diagramma architettura react-flow.

    Returns:
        ArchitectureDiagram con nodi e edges per visualizzazione

    Example:
        >>> GET /api/v1/dashboard/architecture
        {
          "nodes": [{"id": "normattiva", "label": "Normattiva", "type": "source"}, ...],
          "edges": [{"source": "normattiva", "target": "pipeline"}, ...]
        }
    """
    # Define architecture nodes
    nodes = [
        # Sources
        ArchitectureNode(
            id="normattiva",
            label="Normattiva",
            type="source",
            metrics={"description": "Testi ufficiali delle leggi italiane"},
        ),
        ArchitectureNode(
            id="brocardi",
            label="Brocardi",
            type="source",
            metrics={"description": "Enrichment: spiegazioni, massime, ratio legis"},
        ),
        ArchitectureNode(
            id="eurlex",
            label="EUR-Lex",
            type="source",
            metrics={"description": "Normativa europea (futuro)", "status": "planned"},
        ),

        # Pipeline
        ArchitectureNode(
            id="pipeline",
            label="Pipeline",
            type="pipeline",
            metrics={"stages": ["Fetch", "Parse", "Chunk", "Embed", "Store"]},
        ),

        # Storage
        ArchitectureNode(
            id="falkordb",
            label="FalkorDB",
            type="storage",
            metrics={"description": "Knowledge Graph (nodi e relazioni)"},
        ),
        ArchitectureNode(
            id="qdrant",
            label="Qdrant",
            type="storage",
            metrics={"description": "Vector DB (embeddings semantici)"},
        ),
        ArchitectureNode(
            id="postgresql",
            label="PostgreSQL",
            type="storage",
            metrics={"description": "Bridge Table, RLCF metadata"},
        ),
        ArchitectureNode(
            id="redis",
            label="Redis",
            type="storage",
            metrics={"description": "Cache layer"},
        ),

        # Experts
        ArchitectureNode(
            id="literal",
            label="LiteralExpert",
            type="expert",
            metrics={"description": "Interpretazione letterale (Art. 12 Preleggi)"},
        ),
        ArchitectureNode(
            id="systemic",
            label="SystemicExpert",
            type="expert",
            metrics={"description": "Interpretazione sistematica"},
        ),
        ArchitectureNode(
            id="principles",
            label="PrinciplesExpert",
            type="expert",
            metrics={"description": "Intenzione del legislatore"},
        ),
        ArchitectureNode(
            id="precedent",
            label="PrecedentExpert",
            type="expert",
            metrics={"description": "Giurisprudenza applicativa"},
        ),

        # RLCF
        ArchitectureNode(
            id="gating",
            label="GatingPolicy",
            type="rlcf",
            metrics={"description": "Neural routing tra expert"},
        ),
        ArchitectureNode(
            id="traversal",
            label="TraversalPolicy",
            type="rlcf",
            metrics={"description": "Graph traversal ottimizzato"},
        ),
        ArchitectureNode(
            id="authority",
            label="Authority",
            type="rlcf",
            metrics={"description": "Peso feedback utenti"},
        ),
    ]

    # Define connections
    edges = [
        # Sources -> Pipeline
        ArchitectureEdge(source="normattiva", target="pipeline", animated=True),
        ArchitectureEdge(source="brocardi", target="pipeline", animated=True),

        # Pipeline -> Storage
        ArchitectureEdge(source="pipeline", target="falkordb"),
        ArchitectureEdge(source="pipeline", target="qdrant"),
        ArchitectureEdge(source="pipeline", target="postgresql"),

        # Storage -> Experts
        ArchitectureEdge(source="falkordb", target="literal"),
        ArchitectureEdge(source="falkordb", target="systemic"),
        ArchitectureEdge(source="qdrant", target="literal"),
        ArchitectureEdge(source="qdrant", target="systemic"),

        # RLCF -> Experts
        ArchitectureEdge(source="gating", target="literal"),
        ArchitectureEdge(source="gating", target="systemic"),
        ArchitectureEdge(source="gating", target="principles"),
        ArchitectureEdge(source="gating", target="precedent"),

        # Authority -> Gating
        ArchitectureEdge(source="authority", target="gating"),

        # Cache
        ArchitectureEdge(source="redis", target="pipeline", label="cache"),
    ]

    return ArchitectureDiagram(nodes=nodes, edges=edges)


@router.get("/architecture/node/{node_id}", response_model=NodeDetails)
async def get_node_details(
    node_id: str,
    api_key: ApiKey = Depends(verify_api_key),
) -> NodeDetails:
    """
    Dettagli per un nodo specifico del diagramma.

    Args:
        node_id: ID del nodo (es. "falkordb", "literal")

    Returns:
        NodeDetails con metriche dettagliate per il nodo

    Example:
        >>> GET /api/v1/dashboard/architecture/node/falkordb
        {
          "node_id": "falkordb",
          "label": "FalkorDB",
          "description": "Graph database...",
          "metrics": {"nodes": 27740, "edges": 43935, ...}
        }
    """
    # Base node configs (no metrics - fetched dynamically)
    node_configs = {
        "falkordb": {
            "label": "FalkorDB",
            "description": "Graph database Redis-compatible per il Knowledge Graph legale. Memorizza nodi (articoli, entità, concetti) e relazioni (citazioni, modifiche, correlazioni).",
            "config": {"host": "localhost", "port": 6380, "db": "merl_t_dev"},
            "links": {
                "docs": "https://docs.falkordb.com",
                "code": "merlt/storage/graph/client.py",
            },
        },
        "qdrant": {
            "label": "Qdrant",
            "description": "Vector database per embeddings semantici. Permette ricerca per similarità sui chunk di testo.",
            "config": {"host": "localhost", "port": 6333, "collection": "merl_t_dev_chunks"},
            "links": {"docs": "https://qdrant.tech/documentation"},
        },
        "literal": {
            "label": "LiteralExpert",
            "description": "Interpreta la norma secondo il significato proprio delle parole (Art. 12 Preleggi). Fornisce il testo esatto e struttura dell'articolo.",
            "config": {"model": "openrouter/claude-3-sonnet"},
            "links": {"code": "merlt/experts/literal.py"},
        },
        "systemic": {
            "label": "SystemicExpert",
            "description": "Interpretazione sistematica della norma nel contesto dell'ordinamento giuridico.",
            "config": {"model": "openrouter/claude-3-sonnet"},
            "links": {"code": "merlt/experts/systemic.py"},
        },
        "principles": {
            "label": "PrinciplesExpert",
            "description": "Individua l'intenzione del legislatore e i principi sottesi alla norma.",
            "config": {"model": "openrouter/claude-3-sonnet"},
            "links": {"code": "merlt/experts/principles.py"},
        },
        "precedent": {
            "label": "PrecedentExpert",
            "description": "Analizza la giurisprudenza applicativa della norma.",
            "config": {"model": "openrouter/claude-3-sonnet"},
            "links": {"code": "merlt/experts/precedent.py"},
        },
        "gating": {
            "label": "GatingPolicy",
            "description": "Rete neurale che determina il peso di ogni expert nella risposta finale. Apprende dai feedback utente via policy gradient.",
            "config": {"hidden_size": 128, "learning_rate": 0.0001},
            "links": {"code": "merlt/rlcf/policy_gradient.py"},
        },
        "traversal": {
            "label": "TraversalPolicy",
            "description": "Ottimizza la navigazione del grafo per trovare i nodi più rilevanti.",
            "config": {"max_depth": 3, "max_width": 5},
            "links": {"code": "merlt/rlcf/policy_gradient.py"},
        },
        "authority": {
            "label": "Authority",
            "description": "Calcola il peso del feedback utente in base alla competenza dimostrata.",
            "config": {},
            "links": {"code": "merlt/rlcf/authority.py"},
        },
        "pipeline": {
            "label": "Pipeline",
            "description": "Orchestrazione ingestion: Fetch → Parse → Chunk → Embed → Store.",
            "config": {},
            "links": {"code": "merlt/pipeline/ingestion.py"},
        },
        "normattiva": {
            "label": "Normattiva",
            "description": "Fonte ufficiale dei testi legislativi italiani.",
            "config": {},
            "links": {"docs": "https://www.normattiva.it"},
        },
        "brocardi": {
            "label": "Brocardi",
            "description": "Enrichment con spiegazioni, massime, ratio legis.",
            "config": {},
            "links": {"docs": "https://www.brocardi.it"},
        },
        "eurlex": {
            "label": "EUR-Lex",
            "description": "Normativa europea (pianificato).",
            "config": {"status": "planned"},
            "links": {"docs": "https://eur-lex.europa.eu"},
        },
        "postgresql": {
            "label": "PostgreSQL",
            "description": "Database relazionale per Bridge Table e RLCF metadata.",
            "config": {"host": "localhost", "port": 5433, "db": "rlcf_dev"},
            "links": {},
        },
        "redis": {
            "label": "Redis",
            "description": "Cache layer per performance.",
            "config": {"host": "localhost", "port": 6379},
            "links": {},
        },
    }

    config = node_configs.get(node_id, {
        "label": node_id.title(),
        "description": f"Componente {node_id}",
        "config": {},
        "links": {},
    })

    # Fetch real metrics based on node type
    metrics = {}
    if node_id == "falkordb":
        try:
            kg_kpis = await _get_knowledge_graph_kpis()
            metrics = {
                "total_nodes": kg_kpis.total_nodes,
                "total_edges": kg_kpis.total_edges,
                "articles_count": kg_kpis.articles_count,
            }
        except Exception as e:
            log.warning("Could not fetch FalkorDB metrics", error=str(e))
    elif node_id == "qdrant":
        try:
            kg_kpis = await _get_knowledge_graph_kpis()
            metrics = {"embeddings_count": kg_kpis.embeddings_count}
        except Exception as e:
            log.warning("Could not fetch Qdrant metrics", error=str(e))
    elif node_id == "postgresql":
        try:
            kg_kpis = await _get_knowledge_graph_kpis()
            metrics = {"bridge_mappings": kg_kpis.bridge_mappings}
        except Exception as e:
            log.warning("Could not fetch PostgreSQL metrics", error=str(e))

    return NodeDetails(
        node_id=node_id,
        label=config["label"],
        description=config["description"],
        metrics=metrics,
        config=config.get("config", {}),
        links=config.get("links", {}),
    )


@router.get("/activity", response_model=ActivityFeed)
async def get_activity_feed(
    limit: int = Query(20, ge=1, le=100, description="Numero massimo di entry"),
    offset: int = Query(0, ge=0, description="Offset per paginazione"),
    activity_type: Optional[ActivityType] = Query(None, description="Filtra per tipo"),
    api_key: ApiKey = Depends(verify_api_key),
) -> ActivityFeed:
    """
    Feed di attività recenti.

    Args:
        limit: Numero massimo di entry
        offset: Offset per paginazione
        activity_type: Filtro opzionale per tipo

    Returns:
        ActivityFeed con entry recenti

    Example:
        >>> GET /api/v1/dashboard/activity?limit=10
        {
          "entries": [...],
          "total_count": 100,
          "has_more": true
        }
    """
    return await _get_activity_feed(
        limit=limit,
        offset=offset,
        activity_type=activity_type,
    )
