"""
Pipeline Monitoring Router
==========================

Endpoints REST e WebSocket per monitoraggio pipeline in real-time.

Questo router espone API per tracking dello stato di pipeline di ingestion/enrichment,
con supporto per aggiornamenti real-time via WebSocket.

Endpoints REST:
- GET /pipeline/runs - Lista tutte le pipeline run (con filtri opzionali)
- GET /pipeline/run/{run_id} - Dettagli singola run
- GET /pipeline/run/{run_id}/errors - Lista errori da checkpoint
- POST /pipeline/run/{run_id}/retry - Retry item falliti (future implementation)

WebSocket:
- WS /pipeline/ws/{run_id} - Progress updates real-time con keep-alive

Example:
    >>> # REST endpoint
    >>> response = await client.get("/api/pipeline/runs?status=running&limit=10")
    >>> runs = response.json()
    >>>
    >>> # WebSocket connection
    >>> async with websockets.connect("ws://localhost:8100/api/pipeline/ws/batch_123") as ws:
    ...     while True:
    ...         message = await ws.recv()
    ...         data = json.loads(message)
    ...         print(f"Progress: {data['data']['progress']}%")
"""

import json
import structlog
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.api.models.pipeline_models import (
    PipelineError,
    PipelineRun,
    RetryRequest,
    RetryResponse,
    StartPipelineRequest,
    StartPipelineResponse,
    DatasetStats,
    DatasetExportRequest,
    DatasetExportResponse,
)
from merlt.pipeline.types import PipelineType, PipelineStatus
from merlt.pipeline.orchestrator import pipeline_orchestrator
from merlt.pipeline.websocket_manager import ws_manager

log = structlog.get_logger()

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


@router.get("/runs", response_model=List[PipelineRun])
async def list_pipeline_runs(
    status: Optional[PipelineStatus] = Query(
        None,
        description="Filtra per status (running, completed, failed, paused)",
    ),
    pipeline_type: Optional[PipelineType] = Query(
        None,
        description="Filtra per tipo (ingestion, enrichment, batch_ingestion)",
    ),
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description="Numero massimo di run da restituire",
    ),
    api_key: ApiKey = Depends(verify_api_key),
) -> List[PipelineRun]:
    """
    Lista tutte le pipeline run con filtri opzionali.

    Recupera run attivi e completati, applica filtri, ordina per data di inizio
    decrescente e limita il numero di risultati.

    Args:
        status: Filtra per PipelineStatus (es. RUNNING, COMPLETED)
        pipeline_type: Filtra per PipelineType (es. BATCH_INGESTION)
        limit: Numero massimo di run da restituire (default 50, max 200)

    Returns:
        Lista di PipelineRun ordinati per started_at DESC

    Example:
        >>> # Tutte le run attive
        >>> GET /api/pipeline/runs?status=running
        [
          {
            "run_id": "batch_cc_libro_iv",
            "type": "batch_ingestion",
            "status": "running",
            "started_at": "2026-01-04T14:30:00Z",
            "progress": 67.3,
            "summary": {"success": 150, "failed": 8}
          }
        ]

        >>> # Ultime 10 run completate
        >>> GET /api/pipeline/runs?status=completed&limit=10
    """
    try:
        runs = pipeline_orchestrator.list_runs(
            status=status,
            pipeline_type=pipeline_type,
            limit=limit,
        )

        # Convert to Pydantic models
        result = []
        for run in runs:
            result.append(
                PipelineRun(
                    run_id=run["run_id"],
                    type=run["type"],
                    status=run["status"],
                    started_at=run["started_at"],
                    completed_at=run.get("completed_at"),
                    progress=run.get("progress", 0.0),
                    summary=run.get("summary", {}),
                    config=run.get("config", {}),
                )
            )

        log.info(
            "Pipeline runs listed",
            status=status,
            pipeline_type=pipeline_type,
            count=len(result),
        )

        return result

    except Exception as e:
        log.error("Failed to list pipeline runs", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to list pipeline runs: {str(e)}",
        )


@router.get("/run/{run_id}")
async def get_pipeline_run(run_id: str):
    """
    Recupera dettagli di una singola pipeline run.

    Args:
        run_id: Identificativo univoco della run

    Returns:
        Dizionario con metadata completi della run

    Raises:
        HTTPException: 404 se la run non esiste

    Example:
        >>> GET /api/pipeline/run/batch_cc_libro_iv
        {
          "run_id": "batch_cc_libro_iv",
          "type": "batch_ingestion",
          "status": "running",
          "started_at": "2026-01-04T14:30:00Z",
          "progress": 67.3,
          "total_items": 232,
          "processed": 156,
          "errors": 8,
          "config": {"libro": "IV", "tipo_atto": "codice civile"}
        }
    """
    try:
        run = pipeline_orchestrator.get_run(run_id)

        if not run:
            log.warning("Pipeline run not found", run_id=run_id)
            raise HTTPException(
                status_code=404,
                detail=f"Pipeline run '{run_id}' not found",
            )

        log.info("Pipeline run retrieved", run_id=run_id, status=run["status"])

        return run

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to get pipeline run", run_id=run_id, error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get pipeline run: {str(e)}",
        )


@router.get("/run/{run_id}/errors", response_model=List[PipelineError])
async def get_pipeline_errors(run_id: str) -> List[PipelineError]:
    """
    Recupera lista errori da checkpoint per una pipeline run.

    Cerca checkpoint file in diverse directory standard:
    - data/checkpoints/enrichment/
    - data/checkpoints/ingestion/

    Args:
        run_id: Identificativo univoco della run

    Returns:
        Lista di PipelineError (vuota se nessun checkpoint o nessun errore)

    Note:
        Non solleva errore se il checkpoint non esiste - ritorna semplicemente
        lista vuota (la run potrebbe essere solo in-memory).

    Example:
        >>> GET /api/pipeline/run/batch_cc_libro_iv/errors
        [
          {
            "item_id": "art_1453_cc",
            "phase": "embedding",
            "error_message": "Qdrant connection timeout after 3 retries",
            "stack_trace": "Traceback (most recent call last)...",
            "timestamp": "2026-01-04T14:35:12Z"
          }
        ]
    """
    try:
        # Cerca checkpoint in diverse directory standard
        checkpoint_dirs = [
            Path("data/checkpoints/enrichment"),
            Path("data/checkpoints/ingestion"),
            Path("data/checkpoints/batch"),
        ]

        for checkpoint_dir in checkpoint_dirs:
            checkpoint_path = checkpoint_dir / f"{run_id}.json"

            if checkpoint_path.exists():
                log.info(
                    "Found checkpoint file",
                    run_id=run_id,
                    path=str(checkpoint_path),
                )

                try:
                    with open(checkpoint_path, "r", encoding="utf-8") as f:
                        data = json.load(f)

                    errors_data = data.get("errors", [])

                    # Convert to Pydantic models
                    errors = [PipelineError(**e) for e in errors_data]

                    log.info(
                        "Pipeline errors retrieved",
                        run_id=run_id,
                        count=len(errors),
                    )

                    return errors

                except json.JSONDecodeError as e:
                    log.error(
                        "Failed to parse checkpoint JSON",
                        run_id=run_id,
                        path=str(checkpoint_path),
                        error=str(e),
                    )
                    raise HTTPException(
                        status_code=500,
                        detail=f"Checkpoint file corrupted: {str(e)}",
                    )
                except Exception as e:
                    log.error(
                        "Failed to read checkpoint",
                        run_id=run_id,
                        error=str(e),
                    )
                    raise HTTPException(
                        status_code=500,
                        detail=f"Failed to read checkpoint: {str(e)}",
                    )

        # No checkpoint found - return empty list (run might be in-memory only)
        log.info(
            "No checkpoint found for run",
            run_id=run_id,
            message="Returning empty error list",
        )

        return []

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to get pipeline errors", run_id=run_id, error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get pipeline errors: {str(e)}",
        )


@router.post("/run/{run_id}/retry", response_model=RetryResponse)
async def retry_failed_items(
    run_id: str,
    request: RetryRequest,
    api_key: ApiKey = Depends(require_role("admin")),
) -> RetryResponse:
    """
    Riprova item falliti per una pipeline run.

    NOTA: Feature non ancora completamente implementata. Richiede integrazione
    con checkpoint manager per ricaricare stato e riprocessare item specifici.

    Args:
        run_id: Identificativo univoco della run
        request: RetryRequest con lista opzionale di item_id da riprovare

    Returns:
        RetryResponse con numero di item ritentati

    Future Implementation:
        1. Caricare checkpoint file
        2. Filtrare item falliti (o item_id specifici)
        3. Riprocessare con pipeline originale
        4. Aggiornare checkpoint con nuovi risultati

    Example:
        >>> # Retry tutti gli item falliti
        >>> POST /api/pipeline/run/batch_cc_libro_iv/retry
        >>> {}
        {
          "retried": 8,
          "message": "Ritentati 8 item falliti"
        }

        >>> # Retry item specifici
        >>> POST /api/pipeline/run/batch_cc_libro_iv/retry
        >>> {"item_ids": ["art_1453_cc", "art_1454_cc"]}
        {
          "retried": 2,
          "message": "Ritentati 2 item specificati"
        }
    """
    try:
        # Check se la run esiste
        run = pipeline_orchestrator.get_run(run_id)

        if not run:
            log.warning("Cannot retry - run not found", run_id=run_id)
            raise HTTPException(
                status_code=404,
                detail=f"Pipeline run '{run_id}' not found",
            )

        # TODO: Implementazione completa richiede:
        # 1. CheckpointManager per caricare stato
        # 2. Pipeline factory per ricreare pipeline con stesso config
        # 3. Filtraggio item falliti
        # 4. Riprocessamento con error handling

        log.warning(
            "Retry endpoint called but not fully implemented",
            run_id=run_id,
            item_ids=request.item_ids,
        )

        return RetryResponse(
            retried=0,
            message=f"Retry not yet implemented for run '{run_id}'. "
            f"Full implementation requires checkpoint manager integration.",
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to retry items", run_id=run_id, error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to retry items: {str(e)}",
        )


# =============================================================================
# START PIPELINE
# =============================================================================

@router.post("/start", response_model=StartPipelineResponse)
async def start_pipeline(
    request: StartPipelineRequest,
    api_key: ApiKey = Depends(require_role("admin")),
) -> StartPipelineResponse:
    """
    Avvia una nuova pipeline di batch ingestion.

    Questa operazione è asincrona: la pipeline viene avviata in background
    e il client può monitorare il progresso via WebSocket o polling REST.

    Args:
        request: Configurazione della pipeline (tipo_atto, libro, batch_size, ecc.)

    Returns:
        StartPipelineResponse con run_id per tracking

    Example:
        >>> POST /api/v1/pipeline/start
        >>> {
        >>>     "tipo_atto": "codice civile",
        >>>     "libro": "IV",
        >>>     "batch_size": 10,
        >>>     "with_enrichment": true
        >>> }
        >>>
        >>> Response:
        >>> {
        >>>     "success": true,
        >>>     "run_id": "batch_cc_libro_iv_20260108_143000",
        >>>     "message": "Pipeline avviata per Codice Civile Libro IV",
        >>>     "estimated_items": 232
        >>> }
    """
    import asyncio
    from datetime import datetime, timezone
    from uuid import uuid4

    try:
        # Genera run_id univoco
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        tipo_short = request.tipo_atto.lower().replace(" ", "_")[:10]
        libro_suffix = f"_libro_{request.libro.lower()}" if request.libro else ""
        run_id = f"batch_{tipo_short}{libro_suffix}_{timestamp}"

        log.info(
            "Starting pipeline",
            run_id=run_id,
            tipo_atto=request.tipo_atto,
            libro=request.libro,
            batch_size=request.batch_size,
        )

        # Stima numero articoli (basato su libro se specificato)
        # TODO: Query reale per contare articoli disponibili
        estimated_items = _estimate_articles_count(request.tipo_atto, request.libro)

        # Registra la run nell'orchestrator
        pipeline_orchestrator.register_run(
            run_id=run_id,
            pipeline_type=PipelineType.BATCH_INGESTION,
            total_items=estimated_items,
            config={
                "tipo_atto": request.tipo_atto,
                "libro": request.libro,
                "articoli": request.articoli,
                "batch_size": request.batch_size,
                "skip_existing": request.skip_existing,
                "with_enrichment": request.with_enrichment,
            },
        )

        # Avvia pipeline in background
        asyncio.create_task(_run_batch_pipeline(run_id, request))

        libro_msg = f" Libro {request.libro}" if request.libro else ""
        return StartPipelineResponse(
            success=True,
            run_id=run_id,
            message=f"Pipeline avviata per {request.tipo_atto.title()}{libro_msg}",
            estimated_items=estimated_items,
        )

    except Exception as e:
        log.error("Failed to start pipeline", error=str(e), exc_info=True)
        return StartPipelineResponse(
            success=False,
            message=f"Errore nell'avvio della pipeline: {str(e)}",
        )


def _estimate_articles_count(tipo_atto: str, libro: Optional[str]) -> int:
    """Stima il numero di articoli da processare."""
    # Stime approssimative basate su dati noti
    estimates = {
        "codice civile": {
            "I": 142,
            "II": 455,
            "III": 215,
            "IV": 232,
            "V": 235,
            "VI": 310,
            None: 2969,  # Totale
        },
        "codice penale": {
            "I": 240,
            "II": 412,
            "III": 82,
            None: 734,
        },
    }

    tipo_lower = tipo_atto.lower()
    if tipo_lower in estimates:
        libro_key = libro.upper() if libro else None
        return estimates[tipo_lower].get(libro_key, 100)

    return 100  # Default


async def _run_batch_pipeline(run_id: str, request: StartPipelineRequest):
    """
    Esegue la pipeline di batch ingestion in background.

    Questo task viene avviato da start_pipeline e aggiorna il progresso
    via pipeline_orchestrator per WebSocket updates.
    """
    import asyncio

    try:
        log.info("Background pipeline started", run_id=run_id)

        # Import lazy per evitare circular imports
        from merlt import LegalKnowledgeGraph
        from merlt.pipeline.batch_ingestion import BatchIngestionPipeline

        # Connetti al knowledge graph
        kg = LegalKnowledgeGraph()
        await kg.connect()

        try:
            # Crea pipeline
            pipeline = BatchIngestionPipeline(
                kg=kg,
                batch_size=request.batch_size,
            )

            # Determina articoli da processare
            if request.articoli:
                articles = request.articoli
            else:
                # TODO: Recupera lista articoli da Normattiva
                # Per ora usa lista di esempio
                articles = _get_articles_for_libro(request.tipo_atto, request.libro)

            # Aggiorna totale effettivo
            pipeline_orchestrator._active_runs[run_id]["total_items"] = len(articles)

            # Esegui batch ingestion con progress updates
            result = await pipeline.ingest_batch(
                articles=articles,
                tipo_atto=request.tipo_atto,
                libro=request.libro,
                run_id=run_id,
                with_enrichment=request.with_enrichment,
            )

            # Completa run
            pipeline_orchestrator.complete_run(
                run_id=run_id,
                final_stats={
                    "success": result.successful,
                    "failed": result.failed,
                    "embeddings": result.embeddings_created,
                    "nodes": result.graph_nodes_created,
                },
            )

            log.info(
                "Pipeline completed",
                run_id=run_id,
                summary=result.summary(),
            )

        finally:
            await kg.close()

    except Exception as e:
        log.error("Pipeline failed", run_id=run_id, error=str(e), exc_info=True)
        pipeline_orchestrator.fail_run(run_id=run_id, error=str(e))


def _get_articles_for_libro(tipo_atto: str, libro: Optional[str]) -> List[str]:
    """Restituisce lista di numeri articolo per un libro specifico."""
    # TODO: Query reale a Normattiva per lista articoli
    # Per ora restituisce range di esempio

    if tipo_atto.lower() == "codice civile":
        ranges = {
            "I": range(1, 143),
            "II": range(143, 598),
            "III": range(599, 814),
            "IV": range(1173, 1405),
            "V": range(2060, 2295),
            "VI": range(2643, 2953),
        }
        if libro and libro.upper() in ranges:
            return [str(i) for i in ranges[libro.upper()]]
        return [str(i) for i in range(1, 100)]  # Default sample

    elif tipo_atto.lower() == "codice penale":
        ranges = {
            "I": range(1, 241),
            "II": range(241, 653),
            "III": range(653, 735),
        }
        if libro and libro.upper() in ranges:
            return [str(i) for i in ranges[libro.upper()]]
        return [str(i) for i in range(1, 100)]

    return [str(i) for i in range(1, 50)]  # Default


# =============================================================================
# DATASET STATS & EXPORT
# =============================================================================

@router.get("/dataset/stats", response_model=DatasetStats)
async def get_dataset_stats() -> DatasetStats:
    """
    Recupera statistiche del dataset nel knowledge graph.

    Esegue query a FalkorDB per contare nodi e relazioni,
    e a Qdrant per contare embeddings.

    Returns:
        DatasetStats con contatori aggregati

    Example:
        >>> GET /api/v1/pipeline/dataset/stats
        >>> {
        >>>     "total_nodes": 27740,
        >>>     "total_edges": 43935,
        >>>     "articles_count": 1250,
        >>>     "entities_count": 8500,
        >>>     "relations_by_type": {
        >>>         "DISCIPLINA": 5420,
        >>>         "ESPRIME_PRINCIPIO": 3200,
        >>>         ...
        >>>     },
        >>>     "embeddings_count": 5926,
        >>>     "bridge_mappings": 27114
        >>> }
    """
    from datetime import datetime, timezone
    import os

    try:
        stats = DatasetStats(last_updated=datetime.now(timezone.utc))

        # === Query FalkorDB ===
        try:
            from merlt.storage.graph.client import FalkorDBClient

            graph_client = FalkorDBClient()
            await graph_client.connect()

            try:
                # Conta nodi totali
                result = await graph_client.query("MATCH (n) RETURN count(n) as count")
                if result:
                    stats.total_nodes = result[0].get("count", 0)

                # Conta relazioni totali
                result = await graph_client.query("MATCH ()-[r]->() RETURN count(r) as count")
                if result:
                    stats.total_edges = result[0].get("count", 0)

                # Conta articoli (nodi Norma o Article)
                result = await graph_client.query(
                    "MATCH (n) WHERE 'Norma' IN labels(n) OR 'Article' IN labels(n) RETURN count(n) as count"
                )
                if result:
                    stats.articles_count = result[0].get("count", 0)

                # Conta entità
                result = await graph_client.query(
                    "MATCH (n:Entity) RETURN count(n) as count"
                )
                if result:
                    stats.entities_count = result[0].get("count", 0)

                # Conta relazioni per tipo
                result = await graph_client.query(
                    "MATCH ()-[r]->() RETURN type(r) as rel_type, count(r) as count ORDER BY count DESC LIMIT 20"
                )
                if result:
                    stats.relations_by_type = {
                        row["rel_type"]: row["count"]
                        for row in result
                        if row.get("rel_type")
                    }

            finally:
                await graph_client.close()

        except Exception as e:
            log.warning(f"Failed to query FalkorDB stats: {e}")

        # === Query Qdrant ===
        try:
            from qdrant_client import QdrantClient

            qdrant_client = QdrantClient(
                host=os.getenv("QDRANT_HOST", "localhost"),
                port=int(os.getenv("QDRANT_PORT", "6333")),
            )

            collection_name = os.getenv("QDRANT_COLLECTION", "merl_t_dev_chunks")
            collection_info = qdrant_client.get_collection(collection_name)
            stats.embeddings_count = collection_info.points_count or 0

        except Exception as e:
            log.warning(f"Failed to query Qdrant stats: {e}")

        # === Query Bridge Table (PostgreSQL) ===
        try:
            from merlt.storage.bridge.bridge_table import BridgeTable
            from merlt.rlcf.database import get_db_url

            bridge = BridgeTable(db_url=get_db_url())
            await bridge.connect()

            try:
                count = await bridge.count_mappings()
                stats.bridge_mappings = count
            finally:
                await bridge.close()

        except Exception as e:
            log.warning(f"Failed to query Bridge Table stats: {e}")

        log.info(
            "Dataset stats retrieved",
            nodes=stats.total_nodes,
            edges=stats.total_edges,
            embeddings=stats.embeddings_count,
        )

        return stats

    except Exception as e:
        log.error("Failed to get dataset stats", error=str(e), exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to get dataset stats: {str(e)}",
        )


@router.post("/dataset/export", response_model=DatasetExportResponse)
async def export_dataset(
    request: DatasetExportRequest,
    api_key: ApiKey = Depends(require_role("admin")),
) -> DatasetExportResponse:
    """
    Esporta il dataset in vari formati (JSON, CSV, Cypher).

    L'export viene eseguito in modo sincrono per dataset piccoli (<10k nodi)
    o schedulato in background per dataset grandi.

    Args:
        request: Configurazione export (formato, filtri, limite)

    Returns:
        DatasetExportResponse con URL di download

    Example:
        >>> POST /api/v1/pipeline/dataset/export
        >>> {
        >>>     "format": "json",
        >>>     "filter_tipo_atto": "codice civile",
        >>>     "limit": 1000
        >>> }
        >>>
        >>> Response:
        >>> {
        >>>     "success": true,
        >>>     "download_url": "/api/v1/pipeline/dataset/download/export_abc123.json",
        >>>     "format": "json",
        >>>     "records_count": 1000,
        >>>     "file_size_mb": 15.3
        >>> }
    """
    import json
    import csv
    import os
    import tempfile
    from datetime import datetime, timezone
    from uuid import uuid4

    try:
        log.info(
            "Exporting dataset",
            format=request.format,
            filter_tipo_atto=request.filter_tipo_atto,
            limit=request.limit,
        )

        # === Query FalkorDB per i dati ===
        from merlt.storage.graph.client import FalkorDBClient

        graph_client = FalkorDBClient()
        await graph_client.connect()

        try:
            # Build query con filtri opzionali
            where_clause = ""
            if request.filter_tipo_atto:
                where_clause = f"WHERE n.tipo_atto = '{request.filter_tipo_atto}'"

            query = f"""
            MATCH (n)
            {where_clause}
            RETURN n
            LIMIT {request.limit}
            """

            result = await graph_client.query(query)

            if not result:
                return DatasetExportResponse(
                    success=True,
                    format=request.format,
                    records_count=0,
                    message="Nessun dato trovato con i filtri specificati",
                )

            # Prepara directory export
            export_dir = Path(tempfile.gettempdir()) / "merl_t_exports"
            export_dir.mkdir(exist_ok=True)

            # Genera filename univoco
            export_id = uuid4().hex[:8]
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            filename = f"merl_t_export_{timestamp}_{export_id}.{request.format}"
            filepath = export_dir / filename

            # Esporta nel formato richiesto
            records_count = len(result)

            if request.format == "json":
                # Esporta JSON
                export_data = []
                for row in result:
                    node = row.get("n", {})
                    props = node.get("properties", node)
                    labels = node.get("labels", [])
                    export_data.append({
                        "id": props.get("id") or props.get("URN") or props.get("urn"),
                        "labels": labels,
                        "properties": props,
                    })

                with open(filepath, "w", encoding="utf-8") as f:
                    json.dump(export_data, f, ensure_ascii=False, indent=2, default=str)

            elif request.format == "csv":
                # Esporta CSV (flattened)
                rows = []
                for row in result:
                    node = row.get("n", {})
                    props = node.get("properties", node)
                    labels = node.get("labels", [])
                    rows.append({
                        "id": props.get("id") or props.get("URN") or props.get("urn"),
                        "labels": "|".join(labels),
                        "nome": props.get("nome", ""),
                        "tipo_atto": props.get("tipo_atto", ""),
                        "rubrica": props.get("rubrica", ""),
                        "testo": (props.get("testo", "") or "")[:500],  # Trunca per CSV
                    })

                if rows:
                    fieldnames = rows[0].keys()
                    with open(filepath, "w", encoding="utf-8", newline="") as f:
                        writer = csv.DictWriter(f, fieldnames=fieldnames)
                        writer.writeheader()
                        writer.writerows(rows)

            elif request.format == "cypher":
                # Esporta come statements Cypher per reimport
                with open(filepath, "w", encoding="utf-8") as f:
                    for row in result:
                        node = row.get("n", {})
                        props = node.get("properties", node)
                        labels = node.get("labels", ["Node"])
                        label_str = ":".join(labels)

                        # Escape properties per Cypher
                        props_str = json.dumps(props, ensure_ascii=False, default=str)
                        f.write(f"CREATE (:{label_str} {props_str});\n")

            # Calcola dimensione file
            file_size = filepath.stat().st_size / (1024 * 1024)  # MB

            log.info(
                "Dataset exported",
                format=request.format,
                records=records_count,
                file_size_mb=file_size,
                filepath=str(filepath),
            )

            return DatasetExportResponse(
                success=True,
                download_url=f"/api/v1/pipeline/dataset/download/{filename}",
                format=request.format,
                records_count=records_count,
                file_size_mb=round(file_size, 2),
                message=f"Export completato: {records_count} record",
            )

        finally:
            await graph_client.close()

    except Exception as e:
        log.error("Failed to export dataset", error=str(e), exc_info=True)
        return DatasetExportResponse(
            success=False,
            format=request.format,
            message=f"Errore nell'export: {str(e)}",
        )


@router.get("/dataset/download/{filename}")
async def download_export(filename: str):
    """
    Scarica un file di export precedentemente generato.

    Args:
        filename: Nome del file da scaricare

    Returns:
        FileResponse con il file richiesto

    Example:
        >>> GET /api/v1/pipeline/dataset/download/merl_t_export_20260108_143000_abc123.json
    """
    from fastapi.responses import FileResponse
    import tempfile

    try:
        # Valida filename (previene path traversal)
        if ".." in filename or "/" in filename or "\\" in filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        export_dir = Path(tempfile.gettempdir()) / "merl_t_exports"
        filepath = export_dir / filename

        if not filepath.exists():
            raise HTTPException(status_code=404, detail="Export file not found")

        # Determina media type
        if filename.endswith(".json"):
            media_type = "application/json"
        elif filename.endswith(".csv"):
            media_type = "text/csv"
        elif filename.endswith(".cypher"):
            media_type = "text/plain"
        else:
            media_type = "application/octet-stream"

        return FileResponse(
            path=str(filepath),
            filename=filename,
            media_type=media_type,
        )

    except HTTPException:
        raise
    except Exception as e:
        log.error("Failed to download export", filename=filename, error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Failed to download export: {str(e)}",
        )


@router.websocket("/ws/{run_id}")
async def pipeline_progress_websocket(websocket: WebSocket, run_id: str):
    """
    WebSocket endpoint per progress updates real-time.

    Gestisce connessioni WebSocket per ricevere aggiornamenti live dello stato
    di una pipeline run. Invia stato iniziale al momento della connessione,
    poi processa ping/pong per keep-alive.

    Il broadcast degli aggiornamenti avviene tramite `pipeline_orchestrator.emit_progress()`,
    che usa `ws_manager.broadcast()` per inviare messaggi a tutti i client connessi.

    Args:
        websocket: WebSocket connection
        run_id: Identificativo univoco della run da monitorare

    Message Format (Server → Client):
        ```json
        {
          "event": "initial_state" | "progress_update" | "error",
          "data": {
            "run_id": "batch_123",
            "processed": 156,
            "total": 232,
            "progress": 67.3,
            "status": "running",
            "current_item": "art. 1453 c.c.",
            "speed_per_sec": 2.3,
            "eta_seconds": 34,
            "elapsed_seconds": 68,
            "step_progress": {"parsing": "done", "embedding": "in_progress"}
          }
        }
        ```

    Keep-Alive Protocol:
        - Client invia "ping" → Server risponde "pong"
        - Previene timeout di connessioni idle

    Example Usage (Python):
        >>> import asyncio
        >>> import websockets
        >>> import json
        >>>
        >>> async def monitor_pipeline(run_id):
        ...     uri = f"ws://localhost:8100/api/pipeline/ws/{run_id}"
        ...     async with websockets.connect(uri) as websocket:
        ...         # Ricevi stato iniziale
        ...         initial = await websocket.recv()
        ...         print(json.loads(initial))
        ...
        ...         # Loop aggiornamenti
        ...         while True:
        ...             message = await websocket.recv()
        ...             data = json.loads(message)
        ...             if data["event"] == "progress_update":
        ...                 print(f"Progress: {data['data']['progress']}%")
        >>>
        >>> asyncio.run(monitor_pipeline("batch_cc_libro_iv"))

    Example Usage (JavaScript):
        ```javascript
        const ws = new WebSocket(`ws://localhost:8100/api/pipeline/ws/${runId}`);

        ws.onmessage = (event) => {
          const message = JSON.parse(event.data);
          if (message.event === 'progress_update') {
            console.log(`Progress: ${message.data.progress}%`);
            updateProgressBar(message.data.progress);
          }
        };

        // Keep-alive
        setInterval(() => ws.send('ping'), 30000);
        ```

    Note:
        - Connessioni automaticamente rimosse al disconnect
        - Errori di invio gestiti gracefully (connessioni morte rimosse)
        - Supporta connessioni multiple simultanee per stessa run
    """
    try:
        # Connetti al WebSocket manager
        await ws_manager.connect(run_id, websocket)

        log.info(
            "WebSocket connected",
            run_id=run_id,
            total_connections=ws_manager.get_connected_count(run_id),
        )

        # Invia stato corrente (se run esiste)
        run = pipeline_orchestrator.get_run(run_id)

        if run:
            initial_state = {
                "event": "initial_state",
                "data": {
                    "run_id": run_id,
                    "processed": run.get("processed", 0),
                    "total": run.get("total_items", 0),
                    "progress": run.get("progress", 0.0),
                    "status": run.get("status").value if run.get("status") else "unknown",
                    "type": run.get("type").value if run.get("type") else "unknown",
                    "started_at": run.get("started_at").isoformat() if run.get("started_at") else None,
                    "errors": run.get("errors", 0),
                },
            }

            await websocket.send_json(initial_state)

            log.info("Initial state sent", run_id=run_id)
        else:
            # Run non trovata - invia warning
            await websocket.send_json({
                "event": "warning",
                "data": {
                    "message": f"Pipeline run '{run_id}' not found. Waiting for updates...",
                },
            })

            log.warning(
                "Run not found during WebSocket connect",
                run_id=run_id,
                message="Client will receive updates if run is registered later",
            )

        # Keep-alive loop
        while True:
            try:
                # Ricevi messaggi dal client (principalmente ping)
                data = await websocket.receive_text()

                if data == "ping":
                    await websocket.send_text("pong")
                    log.debug("WebSocket ping/pong", run_id=run_id)
                else:
                    # Ignora altri messaggi (non gestiti)
                    log.debug("Received unknown message", run_id=run_id, message=data)

            except WebSocketDisconnect:
                log.info("WebSocket disconnected normally", run_id=run_id)
                break

    except WebSocketDisconnect:
        log.info("WebSocket disconnected (outer catch)", run_id=run_id)

    except Exception as e:
        log.error(
            "WebSocket error",
            run_id=run_id,
            error=str(e),
            error_type=type(e).__name__,
        )

    finally:
        # Cleanup connessione
        await ws_manager.disconnect(run_id, websocket)

        log.info(
            "WebSocket cleanup completed",
            run_id=run_id,
            remaining_connections=ws_manager.get_connected_count(run_id),
        )
