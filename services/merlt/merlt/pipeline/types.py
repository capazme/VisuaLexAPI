"""
Pipeline Types
==============

Tipi comuni per pipeline monitoring.
Separati per evitare import circolari tra api/ e pipeline/.

Example:
    >>> from merlt.pipeline.types import PipelineType, PipelineStatus
    >>> status = PipelineStatus.RUNNING
    >>> type_ = PipelineType.BATCH_INGESTION
"""

from enum import Enum


class PipelineType(str, Enum):
    """
    Tipi di pipeline supportati.

    Values:
        INGESTION: Pipeline di ingestion articoli singoli
        ENRICHMENT: Pipeline di enrichment entità
        BATCH_INGESTION: Batch ingestion di articoli multipli
    """

    INGESTION = "ingestion"
    ENRICHMENT = "enrichment"
    BATCH_INGESTION = "batch_ingestion"


class PipelineStatus(str, Enum):
    """
    Stati possibili di una pipeline run.

    Values:
        RUNNING: Pipeline in esecuzione
        COMPLETED: Pipeline completata con successo
        FAILED: Pipeline terminata con errore critico
        PAUSED: Pipeline in pausa (per intervento utente)
    """

    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"


__all__ = ["PipelineType", "PipelineStatus"]
