"""
Modelli Pydantic per Pipeline Monitoring API.

Definisce i modelli per tracking delle pipeline di ingestion/enrichment
con supporto per WebSocket real-time updates.
"""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Literal, Dict, Optional, List, Any

# Import tipi dalla source-of-truth in pipeline/ per evitare import circolari
from merlt.pipeline.types import PipelineType, PipelineStatus


class PipelineRun(BaseModel):
    """
    Rappresenta una esecuzione di pipeline.

    Attributes:
        run_id: Identificativo univoco della run
        type: Tipo di pipeline
        status: Stato corrente
        started_at: Timestamp di inizio
        completed_at: Timestamp di completamento (se terminata)
        progress: Percentuale di completamento (0-100)
        summary: Contatori aggregati (es. {"success": 42, "failed": 3})
        config: Configurazione usata per la run

    Example:
        >>> run = PipelineRun(
        ...     run_id="batch_123",
        ...     type=PipelineType.BATCH_INGESTION,
        ...     status=PipelineStatus.RUNNING,
        ...     started_at=datetime.now(),
        ...     progress=45.5,
        ...     summary={"success": 100, "failed": 5, "total": 232}
        ... )
    """
    run_id: str
    type: PipelineType
    status: PipelineStatus
    started_at: datetime
    completed_at: Optional[datetime] = None
    progress: float = Field(ge=0, le=100, default=0)
    summary: Dict[str, int] = Field(default_factory=dict)
    config: Dict[str, Any] = Field(default_factory=dict)


class ProgressUpdate(BaseModel):
    """
    Messaggio WebSocket per aggiornamento progresso.

    Attributes:
        event: Tipo di evento (sempre "progress_update")
        data: Dati dell'aggiornamento (progress, summary, ecc.)

    Example:
        >>> update = ProgressUpdate(
        ...     event="progress_update",
        ...     data={
        ...         "progress": 67.3,
        ...         "summary": {"success": 150, "failed": 8},
        ...         "current_item": "art. 1453 c.c."
        ...     }
        ... )
    """
    event: Literal["progress_update"]
    data: Dict[str, Any]


class PipelineError(BaseModel):
    """
    Rappresenta un errore durante una pipeline run.

    Attributes:
        item_id: Identificativo dell'item che ha causato l'errore
        phase: Fase in cui è avvenuto l'errore (es. "parsing", "embedding")
        error_message: Messaggio di errore
        stack_trace: Stack trace completo (opzionale)
        timestamp: Quando è avvenuto l'errore

    Example:
        >>> error = PipelineError(
        ...     item_id="art_1453_cc",
        ...     phase="embedding",
        ...     error_message="Qdrant connection timeout",
        ...     timestamp=datetime.now()
        ... )
    """
    item_id: str
    phase: str
    error_message: str
    stack_trace: Optional[str] = None
    timestamp: datetime


class RetryRequest(BaseModel):
    """
    Richiesta di retry per item falliti.

    Attributes:
        item_ids: Lista di item_id da ritentare. Se None, riprova tutti i falliti.

    Example:
        >>> # Retry item specifici
        >>> retry = RetryRequest(item_ids=["art_1453_cc", "art_1454_cc"])

        >>> # Retry tutti i falliti
        >>> retry_all = RetryRequest()
    """
    item_ids: Optional[List[str]] = None


class RetryResponse(BaseModel):
    """
    Risposta ad una richiesta di retry.

    Attributes:
        retried: Numero di item ritentati
        message: Messaggio descrittivo

    Example:
        >>> response = RetryResponse(
        ...     retried=15,
        ...     message="Ritentati 15 item falliti"
        ... )
    """
    retried: int
    message: str = ""


# =============================================================================
# START PIPELINE
# =============================================================================

class StartPipelineRequest(BaseModel):
    """
    Richiesta per avviare una nuova pipeline di ingestion.

    Attributes:
        tipo_atto: Tipo di atto da ingestire (es. "codice civile", "decreto legislativo")
        libro: Libro da ingestire per codici (opzionale, es. "IV")
        articoli: Lista specifica di articoli da ingestire (opzionale)
        batch_size: Dimensione batch per elaborazione parallela
        skip_existing: Se True, salta articoli già presenti nel grafo

    Example:
        >>> request = StartPipelineRequest(
        ...     tipo_atto="codice civile",
        ...     libro="IV",
        ...     batch_size=10
        ... )
    """
    tipo_atto: str = Field(..., description="Tipo di atto (es. 'codice civile', 'codice penale')")
    libro: Optional[str] = Field(None, description="Libro da ingestire (es. 'I', 'IV')")
    articoli: Optional[List[str]] = Field(None, description="Lista specifica di articoli")
    batch_size: int = Field(10, ge=1, le=50, description="Dimensione batch")
    skip_existing: bool = Field(True, description="Salta articoli già presenti")
    with_enrichment: bool = Field(True, description="Esegui anche enrichment Brocardi")


class StartPipelineResponse(BaseModel):
    """
    Risposta all'avvio di una pipeline.

    Attributes:
        success: Se la pipeline è stata avviata con successo
        run_id: Identificativo univoco della run (per tracking)
        message: Messaggio descrittivo
        estimated_items: Numero stimato di item da processare

    Example:
        >>> response = StartPipelineResponse(
        ...     success=True,
        ...     run_id="batch_cc_libro_iv_20260108_143000",
        ...     message="Pipeline avviata",
        ...     estimated_items=232
        ... )
    """
    success: bool
    run_id: Optional[str] = None
    message: str
    estimated_items: Optional[int] = None


# =============================================================================
# DATASET STATS & EXPORT
# =============================================================================

class DatasetStats(BaseModel):
    """
    Statistiche del dataset nel knowledge graph.

    Attributes:
        total_nodes: Numero totale di nodi nel grafo
        total_edges: Numero totale di relazioni
        articles_count: Numero di articoli (nodi Norma/Article)
        entities_count: Numero di entità estratte
        embeddings_count: Numero di embeddings in Qdrant
        bridge_mappings: Numero di mappings chunk-nodo

    Example:
        >>> stats = DatasetStats(
        ...     total_nodes=27740,
        ...     total_edges=43935,
        ...     articles_count=1250,
        ...     entities_count=8500,
        ...     embeddings_count=5926
        ... )
    """
    total_nodes: int = 0
    total_edges: int = 0
    articles_count: int = 0
    entities_count: int = 0
    relations_by_type: Dict[str, int] = Field(default_factory=dict)
    embeddings_count: int = 0
    bridge_mappings: int = 0
    last_updated: Optional[datetime] = None
    storage_size_mb: Optional[float] = None


class DatasetExportRequest(BaseModel):
    """
    Richiesta di export del dataset.

    Attributes:
        format: Formato di export (json, csv, cypher)
        include_embeddings: Se includere gli embeddings (aumenta molto la dimensione)
        filter_tipo_atto: Filtra per tipo di atto (opzionale)
        limit: Limite massimo di nodi da esportare

    Example:
        >>> request = DatasetExportRequest(
        ...     format="json",
        ...     filter_tipo_atto="codice civile",
        ...     limit=1000
        ... )
    """
    format: Literal["json", "csv", "cypher"] = "json"
    include_embeddings: bool = False
    filter_tipo_atto: Optional[str] = None
    limit: int = Field(10000, ge=1, le=100000)


class DatasetExportResponse(BaseModel):
    """
    Risposta con link al file esportato.

    Attributes:
        success: Se l'export è stato completato
        download_url: URL per scaricare il file (valido per 1 ora)
        format: Formato del file
        records_count: Numero di record esportati
        file_size_mb: Dimensione del file in MB
        message: Messaggio descrittivo

    Example:
        >>> response = DatasetExportResponse(
        ...     success=True,
        ...     download_url="/api/v1/pipeline/dataset/download/export_123.json",
        ...     format="json",
        ...     records_count=1250,
        ...     file_size_mb=15.3
        ... )
    """
    success: bool
    download_url: Optional[str] = None
    format: str = "json"
    records_count: int = 0
    file_size_mb: Optional[float] = None
    message: str = ""
