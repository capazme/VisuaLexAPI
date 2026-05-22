"""
Dashboard API Models
====================

Modelli Pydantic per Academic Dashboard di MERL-T.
Fornisce modelli per overview, health check, system status e attività recente.
"""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any

from pydantic import BaseModel, Field


# =============================================================================
# ENUMS
# =============================================================================


class ServiceStatus(str, Enum):
    """Stato di un servizio."""
    ONLINE = "online"
    OFFLINE = "offline"
    DEGRADED = "degraded"
    UNKNOWN = "unknown"


class ActivityType(str, Enum):
    """Tipo di attività recente."""
    PIPELINE_START = "pipeline_start"
    PIPELINE_COMPLETE = "pipeline_complete"
    PIPELINE_ERROR = "pipeline_error"
    TRAINING_START = "training_start"
    TRAINING_EPOCH = "training_epoch"
    TRAINING_COMPLETE = "training_complete"
    EXPERT_QUERY = "expert_query"
    FEEDBACK_RECEIVED = "feedback_received"
    FEEDBACK_AGGREGATED = "feedback_aggregated"


# =============================================================================
# KPI MODELS
# =============================================================================


class KnowledgeGraphKPIs(BaseModel):
    """KPI del Knowledge Graph.

    Attributes:
        total_nodes: Numero totale di nodi nel grafo
        total_edges: Numero totale di relazioni
        articles_count: Numero di articoli normativi
        entities_count: Numero di entità estratte (concetti, istituti)
        embeddings_count: Numero di embeddings in Qdrant
        bridge_mappings: Numero di mappings chunk-nodo
    """
    total_nodes: int = 0
    total_edges: int = 0
    articles_count: int = 0
    entities_count: int = 0
    embeddings_count: int = 0
    bridge_mappings: int = 0


class RLCFKPIs(BaseModel):
    """KPI del sistema RLCF.

    Attributes:
        total_feedback: Numero totale di feedback ricevuti
        buffer_size: Dimensione attuale del buffer
        training_epochs: Numero di epoch completate
        avg_authority: Authority media degli utenti
        active_users: Utenti attivi negli ultimi 7 giorni
    """
    total_feedback: int = 0
    buffer_size: int = 0
    training_epochs: int = 0
    avg_authority: float = 0.0
    active_users: int = 0


class ExpertKPIs(BaseModel):
    """KPI del sistema Expert.

    Attributes:
        total_queries: Query processate totali
        avg_latency_ms: Latenza media in ms
        avg_confidence: Confidenza media delle risposte
        agreement_rate: Tasso di accordo tra expert (%)
    """
    total_queries: int = 0
    avg_latency_ms: float = 0.0
    avg_confidence: float = 0.0
    agreement_rate: float = 0.0


# =============================================================================
# HEALTH CHECK MODELS
# =============================================================================


class ServiceHealth(BaseModel):
    """Stato di salute di un singolo servizio.

    Attributes:
        name: Nome del servizio (es. "FalkorDB", "Qdrant")
        status: Stato corrente
        latency_ms: Latenza del ping in ms
        details: Dettagli aggiuntivi (versione, memoria, etc.)
        last_check: Timestamp ultimo check
    """
    name: str
    status: ServiceStatus
    latency_ms: Optional[float] = None
    details: Dict[str, Any] = Field(default_factory=dict)
    last_check: datetime = Field(default_factory=datetime.now)


class SystemHealth(BaseModel):
    """Stato di salute complessivo del sistema.

    Attributes:
        overall_status: Stato generale (online se tutti OK)
        services: Lista stati singoli servizi
        uptime_seconds: Uptime del sistema in secondi
        last_check: Timestamp ultimo check
    """
    overall_status: ServiceStatus = ServiceStatus.UNKNOWN
    services: List[ServiceHealth] = Field(default_factory=list)
    uptime_seconds: int = 0
    last_check: datetime = Field(default_factory=datetime.now)


# =============================================================================
# ACTIVITY MODELS
# =============================================================================


class ActivityEntry(BaseModel):
    """Singola entry di attività recente.

    Attributes:
        id: Identificativo univoco
        type: Tipo di attività
        message: Messaggio descrittivo
        details: Dettagli strutturati
        timestamp: Quando è avvenuta
        severity: Livello (info, warning, error)
    """
    id: str
    type: ActivityType
    message: str
    details: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime
    severity: str = "info"  # info, warning, error


class ActivityFeed(BaseModel):
    """Feed di attività recenti.

    Attributes:
        entries: Lista di entry ordinate per timestamp (desc)
        total_count: Numero totale di entry disponibili
        has_more: Se ci sono altre entry da caricare
    """
    entries: List[ActivityEntry] = Field(default_factory=list)
    total_count: int = 0
    has_more: bool = False


# =============================================================================
# OVERVIEW RESPONSE
# =============================================================================


class DashboardOverview(BaseModel):
    """Response completa per overview dashboard.

    Attributes:
        knowledge_graph: KPI del Knowledge Graph
        rlcf: KPI del sistema RLCF
        experts: KPI del sistema Expert
        health: Stato di salute del sistema
        recent_activity: Attività recente
        last_updated: Timestamp ultimo aggiornamento
    """
    knowledge_graph: KnowledgeGraphKPIs = Field(default_factory=KnowledgeGraphKPIs)
    rlcf: RLCFKPIs = Field(default_factory=RLCFKPIs)
    experts: ExpertKPIs = Field(default_factory=ExpertKPIs)
    health: SystemHealth = Field(default_factory=SystemHealth)
    recent_activity: ActivityFeed = Field(default_factory=ActivityFeed)
    last_updated: datetime = Field(default_factory=datetime.now)


# =============================================================================
# ARCHITECTURE DIAGRAM MODELS
# =============================================================================


class ArchitectureNode(BaseModel):
    """Nodo nel diagramma architettura.

    Attributes:
        id: Identificativo univoco
        label: Etichetta visualizzata
        type: Tipo componente (source, pipeline, storage, expert, rlcf)
        metrics: Metriche associate al nodo
        status: Stato del componente
    """
    id: str
    label: str
    type: str  # source, pipeline, storage, expert, rlcf
    metrics: Dict[str, Any] = Field(default_factory=dict)
    status: ServiceStatus = ServiceStatus.ONLINE


class ArchitectureEdge(BaseModel):
    """Connessione nel diagramma architettura.

    Attributes:
        source: ID nodo sorgente
        target: ID nodo destinazione
        label: Etichetta (opzionale)
        animated: Se l'edge è animato (dati in movimento)
    """
    source: str
    target: str
    label: Optional[str] = None
    animated: bool = False


class ArchitectureDiagram(BaseModel):
    """Dati per diagramma architettura react-flow.

    Attributes:
        nodes: Lista nodi
        edges: Lista connessioni
        selected_node: ID nodo selezionato (per dettagli)
    """
    nodes: List[ArchitectureNode] = Field(default_factory=list)
    edges: List[ArchitectureEdge] = Field(default_factory=list)
    selected_node: Optional[str] = None


class NodeDetails(BaseModel):
    """Dettagli per un nodo selezionato.

    Attributes:
        node_id: ID del nodo
        label: Etichetta
        description: Descrizione del componente
        metrics: Metriche dettagliate
        config: Configurazione attuale
        links: Link a documentazione/codice
    """
    node_id: str
    label: str
    description: str = ""
    metrics: Dict[str, Any] = Field(default_factory=dict)
    config: Dict[str, Any] = Field(default_factory=dict)
    links: Dict[str, str] = Field(default_factory=dict)


# =============================================================================
# EXPORTS
# =============================================================================


__all__ = [
    # Enums
    "ServiceStatus",
    "ActivityType",
    # KPIs
    "KnowledgeGraphKPIs",
    "RLCFKPIs",
    "ExpertKPIs",
    # Health
    "ServiceHealth",
    "SystemHealth",
    # Activity
    "ActivityEntry",
    "ActivityFeed",
    # Overview
    "DashboardOverview",
    # Architecture
    "ArchitectureNode",
    "ArchitectureEdge",
    "ArchitectureDiagram",
    "NodeDetails",
]
