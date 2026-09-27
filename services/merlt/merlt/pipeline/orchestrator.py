"""
Pipeline Orchestrator
====================

Orchestratore centrale per tracking e monitoring pipeline MERL-T.

Responsabilità:
- Tracking stato run_id
- Emissione eventi WebSocket
- Calcolo progresso e ETA
- Gestione stati (running, completed, failed)

Example:
    >>> from merlt.pipeline.orchestrator import pipeline_orchestrator
    >>>
    >>> # Registra nuova run
    >>> run = pipeline_orchestrator.register_run(
    ...     run_id="batch_123",
    ...     pipeline_type=PipelineType.BATCH_INGESTION,
    ...     total_items=100,
    ...     config={"libro": "IV"}
    ... )
    >>>
    >>> # Emetti progress updates
    >>> await pipeline_orchestrator.emit_progress(
    ...     run_id="batch_123",
    ...     processed=45,
    ...     current_item="art. 1453 c.c."
    ... )
    >>>
    >>> # Completa run
    >>> pipeline_orchestrator.complete_run(
    ...     run_id="batch_123",
    ...     final_stats={"success": 98, "failed": 2}
    ... )
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import structlog

from merlt.pipeline.types import PipelineType, PipelineStatus

log = structlog.get_logger()


class PipelineOrchestrator:
    """
    Orchestratore centrale per tracking pipeline.

    Mantiene stato in-memory dei run attivi e completati.
    Emette eventi via WebSocket per aggiornamenti real-time.

    Attributes:
        _active_runs: Dizionario run_id -> metadata per run in esecuzione
        _completed_runs: Dizionario run_id -> metadata per run completati
        _max_completed: Numero massimo di run completati da mantenere in memoria

    Example:
        >>> orchestrator = PipelineOrchestrator()
        >>> run = orchestrator.register_run(
        ...     run_id="batch_123",
        ...     pipeline_type=PipelineType.BATCH_INGESTION,
        ...     total_items=100
        ... )
        >>> orchestrator.get_active_count()
        1
    """

    def __init__(self):
        """Inizializza l'orchestratore con dizionari vuoti."""
        self._active_runs: Dict[str, Dict[str, Any]] = {}
        self._completed_runs: Dict[str, Dict[str, Any]] = {}
        self._max_completed = 100  # Keep last N completed runs

    def register_run(
        self,
        run_id: str,
        pipeline_type: PipelineType,
        total_items: int,
        config: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Registra nuovo run per tracking.

        Crea una nuova entry nel dizionario dei run attivi con stato iniziale.

        Args:
            run_id: Identificativo univoco della run (es. "batch_123")
            pipeline_type: Tipo di pipeline (INGESTION, ENRICHMENT, BATCH_INGESTION)
            total_items: Numero totale di item da processare
            config: Configurazione opzionale della run (es. {"libro": "IV"})

        Returns:
            Metadata della run appena creata con campi:
            - run_id: ID univoco
            - type: Tipo di pipeline
            - status: PipelineStatus.RUNNING
            - started_at: Timestamp UTC di inizio
            - total_items: Numero totale di item
            - processed: Contatore item processati (iniziale: 0)
            - errors: Contatore errori (iniziale: 0)
            - progress: Percentuale completamento (iniziale: 0.0)
            - config: Configurazione fornita

        Example:
            >>> run = orchestrator.register_run(
            ...     run_id="batch_cc_libro_iv",
            ...     pipeline_type=PipelineType.BATCH_INGESTION,
            ...     total_items=232,
            ...     config={"libro": "IV", "tipo_atto": "codice civile"}
            ... )
            >>> run["status"]
            <PipelineStatus.RUNNING: 'running'>
            >>> run["processed"]
            0
        """
        run = {
            "run_id": run_id,
            "type": pipeline_type,
            "status": PipelineStatus.RUNNING,
            "started_at": datetime.now(timezone.utc),
            "completed_at": None,
            "total_items": total_items,
            "processed": 0,
            "errors": 0,
            "config": config or {},
            "progress": 0.0,
        }
        self._active_runs[run_id] = run

        log.info(
            "Pipeline run registered",
            run_id=run_id,
            type=pipeline_type.value,
            total=total_items,
            config=config,
        )

        return run

    async def emit_progress(
        self,
        run_id: str,
        processed: int,
        current_item: Optional[str] = None,
        step_progress: Optional[Dict[str, Any]] = None,
    ):
        """
        Emetti progress update via WebSocket.

        Aggiorna i contatori della run e calcola metriche di progresso
        (percentuale, velocità, ETA). Invia il messaggio a tutti i client
        WebSocket connessi a questa run.

        Args:
            run_id: ID della run
            processed: Numero totale di item processati finora
            current_item: Nome dell'item corrente (es. "art. 1453 c.c.")
            step_progress: Dettagli del progresso del singolo item (opzionale)
                          es. {"parsing": "done", "embedding": "in_progress"}

        Note:
            Se run_id non esiste tra i run attivi, la funzione ritorna silenziosamente
            senza fare nulla (fail gracefully).

        Example:
            >>> await orchestrator.emit_progress(
            ...     run_id="batch_123",
            ...     processed=45,
            ...     current_item="art. 1453 c.c.",
            ...     step_progress={"parsing": "done", "embedding": "in_progress"}
            ... )
            # Messaggio WebSocket inviato:
            # {
            #   "event": "progress_update",
            #   "data": {
            #     "run_id": "batch_123",
            #     "processed": 45,
            #     "total": 100,
            #     "progress": 45.0,
            #     "current_item": "art. 1453 c.c.",
            #     "speed_per_sec": 2.3,
            #     "eta_seconds": 24,
            #     "elapsed_seconds": 20,
            #     "step_progress": {...}
            #   }
            # }
        """
        if run_id not in self._active_runs:
            return

        run = self._active_runs[run_id]
        run["processed"] = processed

        # Calcola progress percentage
        total = run["total_items"]
        run["progress"] = (processed / total * 100) if total > 0 else 0

        # Calcola velocità e ETA
        elapsed = (datetime.now(timezone.utc) - run["started_at"]).total_seconds()
        speed = processed / elapsed if elapsed > 0 else 0
        remaining = total - processed
        eta = remaining / speed if speed > 0 else 0

        message = {
            "event": "progress_update",
            "data": {
                "run_id": run_id,
                "processed": processed,
                "total": total,
                "progress": round(run["progress"], 2),
                "current_item": current_item or "",
                "speed_per_sec": round(speed, 2),
                "eta_seconds": int(eta),
                "elapsed_seconds": int(elapsed),
                "step_progress": step_progress or {},
            },
        }

        # Import here to avoid circular
        from merlt.pipeline.websocket_manager import ws_manager

        await ws_manager.broadcast(run_id, message)

    async def emit_error(self, run_id: str, error: Dict[str, Any]):
        """
        Emetti error event via WebSocket.

        Incrementa il contatore errori della run e invia il messaggio di errore
        a tutti i client connessi.

        Args:
            run_id: ID della run
            error: Dizionario con dettagli dell'errore:
                   - item_id: ID dell'item che ha causato l'errore
                   - phase: Fase in cui è avvenuto (es. "parsing", "embedding")
                   - error_message: Messaggio di errore
                   - stack_trace: Stack trace completo (opzionale)
                   - timestamp: Quando è avvenuto

        Example:
            >>> await orchestrator.emit_error(
            ...     run_id="batch_123",
            ...     error={
            ...         "item_id": "art_1453_cc",
            ...         "phase": "embedding",
            ...         "error_message": "Qdrant connection timeout",
            ...         "timestamp": datetime.now(timezone.utc)
            ...     }
            ... )
        """
        if run_id in self._active_runs:
            self._active_runs[run_id]["errors"] += 1

        message = {"event": "error", "data": error}

        from merlt.pipeline.websocket_manager import ws_manager

        await ws_manager.broadcast(run_id, message)

    def complete_run(
        self, run_id: str, final_stats: Optional[Dict[str, Any]] = None
    ):
        """
        Marca run come completato.

        Sposta la run dai run attivi ai run completati, aggiorna lo stato
        a COMPLETED e salva statistiche finali.

        Args:
            run_id: ID della run da completare
            final_stats: Statistiche finali opzionali (es. {"success": 98, "failed": 2})

        Note:
            Mantiene solo gli ultimi N run completati (definito da _max_completed).
            I run più vecchi vengono automaticamente rimossi.

        Example:
            >>> orchestrator.complete_run(
            ...     run_id="batch_123",
            ...     final_stats={
            ...         "success": 98,
            ...         "failed": 2,
            ...         "skipped": 0,
            ...         "total_duration_seconds": 125.3
            ...     }
            ... )
            >>> run = orchestrator.get_run("batch_123")
            >>> run["status"]
            <PipelineStatus.COMPLETED: 'completed'>
            >>> run["progress"]
            100.0
        """
        if run_id not in self._active_runs:
            return

        run = self._active_runs.pop(run_id)
        run["status"] = PipelineStatus.COMPLETED
        run["completed_at"] = datetime.now(timezone.utc)
        run["summary"] = final_stats or {}
        run["progress"] = 100.0

        self._completed_runs[run_id] = run

        # Cleanup old completed runs
        if len(self._completed_runs) > self._max_completed:
            oldest = sorted(self._completed_runs.keys())[0]
            del self._completed_runs[oldest]

        log.info(
            "Pipeline run completed",
            run_id=run_id,
            stats=final_stats,
            duration=(run["completed_at"] - run["started_at"]).total_seconds(),
        )

    def fail_run(self, run_id: str, error_message: str):
        """
        Marca run come fallito.

        Sposta la run dai run attivi ai run completati, aggiorna lo stato
        a FAILED e salva il messaggio di errore.

        Args:
            run_id: ID della run da marcare come fallita
            error_message: Messaggio descrittivo dell'errore critico

        Example:
            >>> orchestrator.fail_run(
            ...     run_id="batch_123",
            ...     error_message="FalkorDB connection lost after 3 retries"
            ... )
            >>> run = orchestrator.get_run("batch_123")
            >>> run["status"]
            <PipelineStatus.FAILED: 'failed'>
            >>> run["error_message"]
            'FalkorDB connection lost after 3 retries'
        """
        if run_id not in self._active_runs:
            return

        run = self._active_runs.pop(run_id)
        run["status"] = PipelineStatus.FAILED
        run["completed_at"] = datetime.now(timezone.utc)
        run["error_message"] = error_message

        self._completed_runs[run_id] = run

        log.error(
            "Pipeline run failed",
            run_id=run_id,
            error=error_message,
            processed=run["processed"],
            total=run["total_items"],
        )

    def get_run(self, run_id: str) -> Optional[Dict[str, Any]]:
        """
        Recupera metadata run (attivo o completato).

        Cerca prima nei run attivi, poi nei completati.

        Args:
            run_id: ID della run da recuperare

        Returns:
            Dizionario con metadata della run, oppure None se non esiste

        Example:
            >>> run = orchestrator.get_run("batch_123")
            >>> if run:
            ...     print(f"Status: {run['status']}, Progress: {run['progress']}%")
            Status: running, Progress: 67.3%
        """
        return self._active_runs.get(run_id) or self._completed_runs.get(run_id)

    def list_runs(
        self,
        status: Optional[PipelineStatus] = None,
        pipeline_type: Optional[PipelineType] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        Lista run con filtri opzionali.

        Recupera run attivi e completati, applica filtri, ordina per data di inizio
        decrescente e limita il numero di risultati.

        Args:
            status: Filtra per status (es. PipelineStatus.RUNNING)
            pipeline_type: Filtra per tipo (es. PipelineType.BATCH_INGESTION)
            limit: Numero massimo di run da restituire

        Returns:
            Lista di dizionari con metadata run, ordinati per started_at DESC

        Example:
            >>> # Tutte le run attive
            >>> active = orchestrator.list_runs(status=PipelineStatus.RUNNING)
            >>>
            >>> # Tutte le batch ingestion
            >>> batches = orchestrator.list_runs(pipeline_type=PipelineType.BATCH_INGESTION)
            >>>
            >>> # Ultime 10 run completate
            >>> completed = orchestrator.list_runs(
            ...     status=PipelineStatus.COMPLETED,
            ...     limit=10
            ... )
        """
        all_runs = list(self._active_runs.values()) + list(
            self._completed_runs.values()
        )

        if status:
            all_runs = [r for r in all_runs if r["status"] == status]
        if pipeline_type:
            all_runs = [r for r in all_runs if r["type"] == pipeline_type]

        # Sort by started_at DESC
        all_runs.sort(key=lambda r: r["started_at"], reverse=True)
        return all_runs[:limit]

    def get_active_count(self) -> int:
        """
        Numero di run attivi.

        Returns:
            Numero di run con status RUNNING

        Example:
            >>> count = orchestrator.get_active_count()
            >>> print(f"Pipeline attive: {count}")
            Pipeline attive: 3
        """
        return len(self._active_runs)


# Global singleton
pipeline_orchestrator = PipelineOrchestrator()
