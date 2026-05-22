"""
Enrichment API Router (Refactored with PostgreSQL)
===================================================

FastAPI router per live enrichment e validazione granulare.

REFACTORED: Uses PostgreSQL instead of in-memory storage.

Endpoint:
- POST /enrichment/live - Live enrichment articolo
- POST /enrichment/validate-entity - Valida singola entita'
- POST /enrichment/validate-relation - Valida singola relazione
- POST /enrichment/propose-entity - Proponi nuova entita'
- POST /enrichment/propose-relation - Proponi nuova relazione
- GET /enrichment/pending - Lista pending per validazione
"""

import asyncio
import os
import structlog
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
import json

from merlt.api.models.enrichment_models import (
    EntityProposalRequest,
    EntityProposalResponse,
    EntityValidationRequest,
    EntityValidationResponse,
    LiveEnrichmentRequest,
    LiveEnrichmentResponse,
    PendingEntityData,
    PendingQueueRequest,
    PendingQueueResponse,
    PendingRelationData,
    RelationProposalRequest,
    RelationProposalResponse,
    RelationValidationRequest,
    RelationValidationResponse,
    ValidationResult,
    ValidationStatus,
    # Deduplication models
    DuplicateCheckRequest,
    DuplicateCheckResponse,
    DuplicateCandidateData,
    DuplicateConfidenceLevel,
    RelationDuplicateCheckRequest,
    RelationDuplicateCheckResponse,
    RelationDuplicateCandidateData,
    # Issue Reporting models
    IssueType,
    IssueSeverity,
    IssueStatus,
    ReportIssueRequest,
    ReportIssueResponse,
    VoteIssueRequest,
    VoteIssueResponse,
    EntityIssueData,
    EntityDetailsForIssue,
    GetEntityIssuesResponse,
    OpenIssuesRequest,
    OpenIssuesResponse,
    # NER Feedback models
    NERFeedbackRequest,
    NERFeedbackResponse,
    NERConfirmRequest,
)
from merlt.storage.enrichment import (
    get_db_session,
    get_db_session_dependency,
    PendingEntity,
    EntityVote,
    PendingRelation,
    RelationVote,
    # Deduplication
    EntityDeduplicator,
    RelationDeduplicator,
    DuplicateConfidence,
    # Issue Reporting
    EntityIssueReport,
    EntityIssueVote,
)
from merlt.storage.graph.client import FalkorDBClient
from merlt.storage.graph.entity_writer import EntityGraphWriter
from merlt.rlcf.domain_authority import get_user_authority_for_vote
from merlt.rlcf.edit_merge import process_entity_consensus, process_relation_consensus
from merlt.pipeline.enrichment.models import EntityType, RelationType

# Import mapping from local utilities
from merlt.utils import NORMATTIVA_URN_CODICI
from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey

log = structlog.get_logger()

router = APIRouter(prefix="/enrichment", tags=["enrichment"])

# =============================================================================
# RATE LIMITING (In-Memory - per controllo costi API)
# =============================================================================
# Limiti per prevenire consumo eccessivo di token LLM
ENRICHMENT_RATE_LIMIT_PER_USER = 5   # Max enrichments per user per hour
ENRICHMENT_RATE_LIMIT_WINDOW = 3600  # 1 hour in seconds

# In-memory storage per rate limiting (reset al restart server)
# {user_id: [(timestamp1, article_urn1), (timestamp2, article_urn2), ...]}
_user_enrichment_history: Dict[str, List[tuple]] = defaultdict(list)

# Cache articoli già processati (evita ri-estrazione)
# {article_key: timestamp_processato}
_processed_articles_cache: Dict[str, datetime] = {}

# =============================================================================
# CONCURRENT ENRICHMENT PROTECTION (Enterprise Grade)
# =============================================================================
# Pattern "try-acquire" atomico per prevenire race condition in SSE.
#
# L'estrazione una volta avviata CONTINUA IN BACKGROUND anche se il client
# si disconnette - i dati vengono comunque salvati nel DB.
#
# {article_key: ExtractionState} - stato di ogni estrazione in corso

from dataclasses import dataclass, field
from enum import Enum
from typing import Set
import asyncio


class ExtractionStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    SAVING = "saving"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class ExtractionState:
    """Stato di un'estrazione in corso."""
    article_key: str
    article_urn: str
    user_id: str
    status: ExtractionStatus = ExtractionStatus.PENDING
    entities_count: int = 0
    relations_count: int = 0
    progress_message: str = ""
    error: Optional[str] = None
    task: Optional[asyncio.Task] = None


_extractions: Dict[str, ExtractionState] = {}  # article_key -> state
_extractions_lock = asyncio.Lock()

# Per-article locks for concurrent enrichment protection
_article_locks: Dict[str, asyncio.Lock] = {}

async def _get_article_lock(article_key: str) -> asyncio.Lock:
    """Get or create an asyncio.Lock for a specific article."""
    if article_key not in _article_locks:
        _article_locks[article_key] = asyncio.Lock()
    return _article_locks[article_key]


async def _try_start_extraction(article_key: str, article_urn: str, user_id: str) -> tuple[bool, Optional[ExtractionState]]:
    """
    Tenta di iniziare l'estrazione per un articolo (atomico).

    Returns:
        (can_start, existing_state) - True se possiamo iniziare, False se già in corso
    """
    async with _extractions_lock:
        if article_key in _extractions:
            existing = _extractions[article_key]
            # Se completata o fallita, permetti nuova estrazione
            if existing.status in (ExtractionStatus.COMPLETED, ExtractionStatus.FAILED):
                del _extractions[article_key]
            else:
                log.info(f"Article {article_key} already being extracted by {existing.user_id}")
                return False, existing

        # Crea nuovo stato
        state = ExtractionState(
            article_key=article_key,
            article_urn=article_urn,
            user_id=user_id,
            status=ExtractionStatus.PENDING,
        )
        _extractions[article_key] = state
        log.info(f"Article {article_key} extraction registered by {user_id}")
        return True, state


def _get_extraction_state(article_key: str) -> Optional[ExtractionState]:
    """Ottiene lo stato corrente dell'estrazione."""
    return _extractions.get(article_key)


def _update_extraction_state(article_key: str, **kwargs) -> None:
    """Aggiorna lo stato dell'estrazione."""
    if article_key in _extractions:
        state = _extractions[article_key]
        for key, value in kwargs.items():
            if hasattr(state, key):
                setattr(state, key, value)


async def _finish_extraction(article_key: str, success: bool = True, error: str = None) -> None:
    """
    Marca l'estrazione come completata.
    NON rimuove dallo stato - permette ai client di recuperare risultati.
    """
    async with _extractions_lock:
        if article_key in _extractions:
            state = _extractions[article_key]
            state.status = ExtractionStatus.COMPLETED if success else ExtractionStatus.FAILED
            state.error = error
            log.info(f"Article {article_key} extraction finished: {'success' if success else 'failed'}")


def _is_extraction_in_progress(article_key: str) -> bool:
    """Check se estrazione in corso."""
    state = _extractions.get(article_key)
    if not state:
        return False
    return state.status in (ExtractionStatus.PENDING, ExtractionStatus.IN_PROGRESS, ExtractionStatus.SAVING)


async def _run_extraction_background(
    article_key: str,
    article_urn: str,
    tipo_atto: str,
    articolo: str,
    user_id: str,
    user_authority: float,
    include_brocardi: bool,
) -> None:
    """
    Esegue l'estrazione LLM in background.

    IMPORTANTE: Questa funzione continua anche se il client si disconnette.
    I risultati vengono salvati nel DB indipendentemente dalla connessione SSE.
    """
    from merlt.pipeline.live_enrichment import LiveEnrichmentService
    from merlt.api.models.enrichment_models import LiveEnrichmentRequest

    try:
        _update_extraction_state(article_key, status=ExtractionStatus.IN_PROGRESS, progress_message="Avvio estrazione LLM...")

        request = LiveEnrichmentRequest(
            tipo_atto=tipo_atto,
            articolo=articolo,
            user_id=user_id,
            user_authority=user_authority,
            include_brocardi=include_brocardi,
            extract_entities=True,
        )

        service = LiveEnrichmentService()
        entities_to_save = []
        relations_to_save = []

        # Estrazione LLM (può richiedere 1-2 minuti)
        async for event in service.extract_streaming(request):
            event_type = event.get("type", "unknown")

            if event_type == "entity" and "entity" in event:
                entities_to_save.append(event["entity"])
                _update_extraction_state(
                    article_key,
                    entities_count=len(entities_to_save),
                    progress_message=f"Estratte {len(entities_to_save)} entità..."
                )
            elif event_type == "relation" and "relation" in event:
                relations_to_save.append(event["relation"])
                _update_extraction_state(article_key, relations_count=len(relations_to_save))
            elif event_type == "progress":
                _update_extraction_state(article_key, progress_message=event.get("message", ""))

        # Salvataggio nel DB
        _update_extraction_state(article_key, status=ExtractionStatus.SAVING, progress_message="Salvataggio nel database...")

        if entities_to_save:
            saved_entities = await _save_entities_to_db(entities_to_save, article_urn, user_id)
            saved_relations = await _save_relations_to_db(relations_to_save, article_urn, user_id)

            _record_enrichment(user_id, article_urn)
            _mark_article_processed(article_key)

            log.info(
                "Background extraction complete",
                article_urn=article_urn,
                entities=saved_entities,
                relations=saved_relations,
            )

            _update_extraction_state(
                article_key,
                entities_count=saved_entities,
                relations_count=saved_relations,
            )

        await _finish_extraction(article_key, success=True)

    except asyncio.CancelledError:
        # Task cancellato - non dovrebbe succedere ma gestiamo
        log.warning(f"Extraction task cancelled for {article_key}")
        await _finish_extraction(article_key, success=False, error="Task cancelled")
        raise

    except Exception as e:
        log.error(f"Background extraction error for {article_key}: {e}", exc_info=True)
        await _finish_extraction(article_key, success=False, error=str(e))


def _check_rate_limit(user_id: str) -> tuple[bool, int]:
    """
    Verifica se l'utente può fare un nuovo enrichment.

    Returns:
        (allowed, remaining) - Se permesso e quanti ne restano
    """
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=ENRICHMENT_RATE_LIMIT_WINDOW)

    # Pulisci entries vecchie
    _user_enrichment_history[user_id] = [
        (ts, urn) for ts, urn in _user_enrichment_history[user_id]
        if ts > window_start
    ]

    current_count = len(_user_enrichment_history[user_id])
    remaining = ENRICHMENT_RATE_LIMIT_PER_USER - current_count

    return remaining > 0, max(0, remaining)


def _record_enrichment(user_id: str, article_urn: str) -> None:
    """Registra un enrichment effettuato."""
    _user_enrichment_history[user_id].append(
        (datetime.now(timezone.utc), article_urn)
    )


def _is_article_already_processed(article_key: str) -> bool:
    """Verifica se l'articolo è già stato processato (cache in-memory)."""
    return article_key in _processed_articles_cache


def _mark_article_processed(article_key: str) -> None:
    """Marca l'articolo come processato."""
    _processed_articles_cache[article_key] = datetime.now(timezone.utc)


# =============================================================================
# CHECK ARTICLE IN GRAPH
# =============================================================================
@router.get(
    "/check-article",
    summary="Verifica se un articolo e' nel knowledge graph",
)
async def check_article_in_graph(
    tipo_atto: str,
    articolo: str,
    numero_atto: Optional[str] = None,
    data: Optional[str] = None,
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict:
    """Verifica se un articolo esiste nel grafo."""
    log.info(
        "API: check_article_in_graph",
        tipo_atto=tipo_atto,
        articolo=articolo,
    )

    try:
        client = FalkorDBClient()
        await client.connect()

        # Costruisci URN pattern
        urn_pattern = f"{tipo_atto.lower().replace(' ', '_')}%art_{articolo}"

        query = """
        MATCH (a:Norma)
        WHERE toLower(a.URN) CONTAINS $pattern OR a.numero_articolo = $articolo
        OPTIONAL MATCH (a)-[r]->(e:Entity)
        RETURN a, count(DISTINCT e) as entity_count, max(a.updated_at) as last_updated
        LIMIT 1
        """

        result = await client.query(query, {"pattern": urn_pattern, "articolo": articolo})

        await client.close()

        if result and len(result) > 0 and result[0].get("a"):
            return {
                "in_graph": True,
                "node_count": result[0].get("entity_count", 0),
                "has_entities": result[0].get("entity_count", 0) > 0,
                "last_updated": result[0].get("last_updated"),
                "article_urn": result[0]["a"].get("URN"),
            }

        return {
            "in_graph": False,
            "node_count": 0,
            "has_entities": False,
            "last_updated": None,
            "article_urn": None,
        }

    except Exception as e:
        log.warning(f"Check article failed: {e}")
        return {
            "in_graph": False,
            "node_count": 0,
            "has_entities": False,
            "error": str(e),
        }


async def _get_existing_enrichment(
    session: AsyncSession,
    article_key: str,
    request: "LiveEnrichmentRequest",
) -> "LiveEnrichmentResponse":
    """
    Ritorna entità esistenti dal DB senza ri-estrarre con LLM.

    Usato quando l'articolo è già stato processato (cache hit).
    """
    from merlt.api.models.enrichment_models import (
        ArticleData,
        LiveEnrichmentResponse,
    )
    from merlt.pipeline.live_enrichment import LiveEnrichmentService

    # Query existing entities for this article
    tipo_pattern = article_key.replace(":", "_")
    entities_stmt = (
        select(PendingEntity)
        .where(PendingEntity.article_urn.contains(tipo_pattern))
        .order_by(PendingEntity.created_at.desc())
        .limit(50)
    )
    entities_result = await session.execute(entities_stmt)
    entities = entities_result.scalars().all()

    # Convert to PendingEntityData
    pending_entities = [
        PendingEntityData(
            id=entity.entity_id,
            nome=entity.entity_text,
            tipo=entity.entity_type,
            descrizione=entity.descrizione or "",
            articoli_correlati=[entity.article_urn] if entity.article_urn else [],
            ambito=entity.ambito or "",
            fonte=entity.fonte or "unknown",
            llm_confidence=entity.llm_confidence or 0.0,
            raw_context="",
            validation_status=ValidationStatus.PENDING,
            approval_score=entity.approval_score or 0.0,
            rejection_score=entity.rejection_score or 0.0,
            votes_count=entity.votes_count or 0,
            contributed_by=entity.contributed_by or "unknown",
            contributor_authority=entity.contributor_authority or 0.0,
        )
        for entity in entities
    ]

    # Query existing relations
    relations_stmt = (
        select(PendingRelation)
        .where(PendingRelation.article_urn.contains(tipo_pattern))
        .limit(50)
    )
    relations_result = await session.execute(relations_stmt)
    relations = relations_result.scalars().all()

    pending_relations = [
        PendingRelationData(
            id=rel.relation_id,
            source_urn=rel.source_node_urn or "",
            target_urn=rel.target_entity_id or "",
            relation_type=rel.relation_type,
            fonte=rel.fonte if hasattr(rel, 'fonte') else "unknown",
            llm_confidence=rel.llm_confidence or 0.0,
            evidence=rel.relation_description or "",
            validation_status=ValidationStatus.PENDING,
            approval_score=rel.approval_score or 0.0,
            rejection_score=rel.rejection_score or 0.0,
            votes_count=rel.votes_count or 0,
            contributed_by=rel.contributed_by or "unknown",
            contributor_authority=0.5,
        )
        for rel in relations
    ]

    log.info(
        f"Returning {len(pending_entities)} cached entities for {article_key}",
        entities=len(pending_entities),
        relations=len(pending_relations),
    )

    norma_data = request.norma_data or {}
    article_urn = (
        request.article_urn
        or norma_data.get("urn")
        or (entities[0].article_urn if entities else "")
        or f"urn:nir:visualex:{request.tipo_atto.lower().replace(' ', '.')}~art{request.articolo}!vig="
    )
    article = ArticleData(
        urn=article_urn,
        tipo_atto=str(norma_data.get("tipo_atto") or request.tipo_atto),
        numero_articolo=str(norma_data.get("numero_articolo") or request.articolo),
        rubrica=str(norma_data.get("rubrica") or norma_data.get("titolo") or ""),
        testo_vigente=request.article_text or "",
        estremi=str(norma_data.get("estremi") or ""),
        url=str(norma_data.get("url") or article_urn),
    )
    graph_preview = LiveEnrichmentService()._generate_preview(
        article,
        pending_entities,
        pending_relations,
    )
    sources_used = ["database_cache"]
    if request.article_text or request.article_urn or request.norma_data:
        sources_used.append("visualex")

    return LiveEnrichmentResponse(
        success=True,
        article=article,
        pending_entities=pending_entities,
        pending_relations=pending_relations,
        graph_preview=graph_preview,
        extraction_time_ms=0,
        sources_used=sources_used,
    )


# =============================================================================
# LIVE ENRICHMENT (STREAMING SSE) - Enterprise Grade
# =============================================================================

async def _generate_article_urn(tipo_atto: str, articolo: str) -> str:
    """Genera URN articolo in modo consistente."""
    from merlt.utils.urngenerator import generate_urn
    return generate_urn(tipo_atto, article=articolo)


async def _check_article_has_entities_in_db(article_urn: str) -> tuple[bool, List[PendingEntity]]:
    """
    Verifica se l'articolo ha già entità nel DB (fonte di verità).

    Returns:
        (has_entities, entities_list)
    """
    async with get_db_session() as session:
        result = await session.execute(
            select(PendingEntity)
            .where(PendingEntity.article_urn == article_urn)
            .order_by(PendingEntity.created_at.desc())
        )
        entities = result.scalars().all()
        return len(entities) > 0, list(entities)


async def _get_cached_entities_from_db(article_urn: str) -> List[dict]:
    """
    Recupera entità già estratte dal DB.
    Ritorna lista di dict pronti per SSE (NO yield dentro context manager).
    """
    async with get_db_session() as session:
        result = await session.execute(
            select(PendingEntity)
            .where(PendingEntity.article_urn == article_urn)
            .order_by(PendingEntity.created_at.desc())
        )
        entities = result.scalars().all()

        return [
            {
                "id": e.entity_id,
                "nome": e.entity_text,
                "tipo": e.entity_type,
                "descrizione": e.descrizione,
                "ambito": e.ambito,
                "llm_confidence": e.llm_confidence,
                "approval_score": e.approval_score,
                "rejection_score": e.rejection_score,
                "votes_count": e.votes_count,
            }
            for e in entities
        ]


async def _save_entities_to_db(
    entities: List[dict],
    article_urn: str,
    user_id: str,
) -> int:
    """
    Salva entità nel DB in una singola transazione.

    Returns:
        Numero di entità salvate
    """
    if not entities:
        return 0

    async with get_db_session() as session:
        for entity_data in entities:
            entity_type_str = entity_data.get("tipo", "concetto")
            if hasattr(entity_type_str, 'value'):
                entity_type_str = entity_type_str.value

            pending_entity = PendingEntity(
                entity_id=entity_data.get("id", f"pending:{uuid4().hex[:12]}"),
                article_urn=article_urn,
                source_type="article",
                entity_type=entity_type_str,
                entity_text=entity_data.get("nome", ""),
                descrizione=entity_data.get("descrizione", ""),
                ambito=entity_data.get("ambito", "generale"),
                fonte="llm_extraction",
                llm_confidence=entity_data.get("llm_confidence", 0.8),
                validation_status="pending",
                contributed_by=user_id,
                contributor_authority=entity_data.get("contributor_authority", 0.5),
            )
            session.add(pending_entity)

        # Commit esplicito nella transazione
        await session.commit()

    log.info(f"Saved {len(entities)} entities to DB", article_urn=article_urn)
    return len(entities)


async def _save_relations_to_db(
    relations: List[dict],
    article_urn: str,
    user_id: str,
) -> int:
    """
    Salva relazioni nel DB in una singola transazione.

    Returns:
        Numero di relazioni salvate
    """
    if not relations:
        return 0

    async with get_db_session() as session:
        for relation_data in relations:
            relation_type_str = relation_data.get("relation_type", "IMPLICA")
            if hasattr(relation_type_str, 'value'):
                relation_type_str = relation_type_str.value

            target_urn = relation_data.get("target_urn", "")
            target_is_pending = target_urn.startswith("entity:")

            pending_relation = PendingRelation(
                relation_id=relation_data.get("id", f"pending:{uuid4().hex[:12]}"),
                article_urn=article_urn,
                source_type="article",
                relation_type=relation_type_str,
                source_node_urn=relation_data.get("source_urn", ""),
                target_entity_id=target_urn,
                target_is_pending=target_is_pending,
                relation_description=relation_data.get("evidence", ""),
                certezza=relation_data.get("llm_confidence", 0.7),
                llm_confidence=relation_data.get("llm_confidence", 0.7),
                validation_status="pending",
                contributed_by=user_id,
            )
            session.add(pending_relation)

        await session.commit()

    log.info(f"Saved {len(relations)} relations to DB", article_urn=article_urn)
    return len(relations)


@router.get(
    "/live/stream",
    summary="Live enrichment con Server-Sent Events",
)
async def live_enrich_stream(
    tipo_atto: str,
    articolo: str,
    user_id: str,
    user_authority: float = 0.5,
    include_brocardi: bool = True,
    api_key: ApiKey = Depends(verify_api_key),
) -> StreamingResponse:
    """
    Esegue live enrichment in streaming via SSE.

    ENTERPRISE GRADE:
    - DB come fonte di verità (non cache in-memory)
    - Lock per articolo per prevenire duplicazioni
    - Transazioni atomiche per salvataggio
    - Nessun yield dentro context manager DB

    Event types:
    - start: Inizio estrazione con info articolo
    - progress: Messaggio di progresso
    - entity: Singola entità estratta
    - relation: Singola relazione estratta
    - complete: Estrazione completata con summary
    - error: Errore durante estrazione
    - waiting: In attesa che altro utente completi
    """
    # Genera URN articolo (fonte di verità per lookup)
    article_urn = await _generate_article_urn(tipo_atto, articolo)
    article_key = f"{tipo_atto}:{articolo}"

    log.info(
        "API: live_enrich_stream (SSE)",
        tipo_atto=tipo_atto,
        articolo=articolo,
        article_urn=article_urn,
        user_id=user_id,
    )

    # === CHECK 1: Articolo già ha entità nel DB? (fonte di verità) ===
    has_entities, _ = await _check_article_has_entities_in_db(article_urn)

    if has_entities:
        log.info(f"SSE: Article {article_urn} already has entities in DB")

        async def cached_results_generator():
            """Stream entità esistenti dal DB."""
            yield f"event: progress\ndata: {json.dumps({'message': 'Caricamento entità esistenti...'})}\n\n"

            # Recupera PRIMA di yieldarle (no yield in context manager)
            cached_entities = await _get_cached_entities_from_db(article_urn)

            for entity in cached_entities:
                yield f"event: entity\ndata: {json.dumps({'type': 'entity', 'entity': entity})}\n\n"

            yield f"event: complete\ndata: {json.dumps({'cached': True, 'total_entities': len(cached_entities)})}\n\n"

        return StreamingResponse(
            cached_results_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Cached": "true",
            },
        )

    # === CHECK 2: Rate limit ===
    allowed, remaining = _check_rate_limit(user_id)
    if not allowed:
        async def rate_limit_error():
            msg = json.dumps({"message": "Rate limit exceeded. Riprova tra un'ora."})
            yield f"event: error\ndata: {msg}\n\n"
        return StreamingResponse(
            rate_limit_error(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Rate-Limit-Remaining": "0",
            },
        )

    # === CHECK 3: Try-acquire atomico per concurrent enrichment ===
    can_start, existing_state = await _try_start_extraction(article_key, article_urn, user_id)

    if not can_start:
        # Altro utente sta già estraendo - questo utente fa polling sullo stato
        log.info(f"SSE: Article {article_key} extraction in progress, user {user_id} joining")

        async def polling_generator():
            """Fa polling sullo stato dell'estrazione in corso."""
            yield f"event: waiting\ndata: {json.dumps({'message': 'Estrazione già in corso...', 'status': 'waiting', 'elapsed': 0, 'progress': 0})}\n\n"

            max_wait = 300  # 5 minuti max
            interval = 3  # Poll ogni 3 secondi
            elapsed = 0

            while elapsed < max_wait:
                await asyncio.sleep(interval)
                elapsed += interval

                state = _get_extraction_state(article_key)
                if not state:
                    # Estrazione completata e rimossa, recupera dal DB
                    break

                if state.status == ExtractionStatus.COMPLETED:
                    break

                if state.status == ExtractionStatus.FAILED:
                    yield f"event: error\ndata: {json.dumps({'message': state.error or 'Estrazione fallita', 'status': 'failed'})}\n\n"
                    return

                # Invia aggiornamento di progresso
                progress = min(95, int((elapsed / 120) * 100))
                yield f"event: waiting\ndata: {json.dumps({'message': state.progress_message or 'In corso...', 'status': 'waiting', 'elapsed': elapsed, 'progress': progress, 'entities_count': state.entities_count})}\n\n"

            # Timeout o completato - recupera risultati dal DB
            yield f"event: progress\ndata: {json.dumps({'message': 'Caricamento risultati...'})}\n\n"

            cached_entities = await _get_cached_entities_from_db(article_urn)

            for entity in cached_entities:
                yield f"event: entity\ndata: {json.dumps({'type': 'entity', 'entity': entity})}\n\n"

            yield f"event: complete\ndata: {json.dumps({'waited_for_other': True, 'total_entities': len(cached_entities), 'wait_time': elapsed})}\n\n"

        return StreamingResponse(
            polling_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
                "X-Waited": "true",
            },
        )

    # === MAIN EXTRACTION FLOW ===
    # Abbiamo acquisito il "lock" - avviamo estrazione in BACKGROUND
    # L'estrazione continua anche se il client si disconnette!

    # Double-check: forse già processato
    has_entities_now, _ = await _check_article_has_entities_in_db(article_urn)
    if has_entities_now:
        log.info(f"SSE: Article {article_urn} already has entities (double-check)")
        # Rilascia il "lock" visto che non estraiamo
        await _finish_extraction(article_key, success=True)

        async def cached_generator():
            yield f"event: progress\ndata: {json.dumps({'message': 'Entità già presenti...'})}\n\n"
            cached = await _get_cached_entities_from_db(article_urn)
            for entity in cached:
                yield f"event: entity\ndata: {json.dumps({'type': 'entity', 'entity': entity})}\n\n"
            yield f"event: complete\ndata: {json.dumps({'cached': True, 'total_entities': len(cached)})}\n\n"

        return StreamingResponse(
            cached_generator(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

    # Avvia task background (NON await - continua indipendentemente)
    background_task = asyncio.create_task(
        _run_extraction_background(
            article_key=article_key,
            article_urn=article_urn,
            tipo_atto=tipo_atto,
            articolo=articolo,
            user_id=user_id,
            user_authority=user_authority,
            include_brocardi=include_brocardi,
        )
    )

    # Salva riferimento al task nello state
    _update_extraction_state(article_key, task=background_task)

    async def progress_generator():
        """
        Fa polling sullo stato del background task.
        Se il client si disconnette, il task continua in background.
        """
        yield f"event: progress\ndata: {json.dumps({'message': 'Avvio estrazione...'})}\n\n"

        max_wait = 300  # 5 minuti max
        interval = 2  # Poll ogni 2 secondi
        elapsed = 0
        last_entities_count = 0

        try:
            while elapsed < max_wait:
                await asyncio.sleep(interval)
                elapsed += interval

                state = _get_extraction_state(article_key)
                if not state:
                    break

                # Stream nuove entità man mano che arrivano
                if state.entities_count > last_entities_count:
                    # Recupera le entità più recenti dal DB
                    entities = await _get_cached_entities_from_db(article_urn)
                    for entity in entities[last_entities_count:state.entities_count]:
                        yield f"event: entity\ndata: {json.dumps({'type': 'entity', 'entity': entity})}\n\n"
                    last_entities_count = state.entities_count

                if state.status == ExtractionStatus.COMPLETED:
                    yield f"event: complete\ndata: {json.dumps({'total_entities': state.entities_count, 'total_relations': state.relations_count})}\n\n"
                    return

                if state.status == ExtractionStatus.FAILED:
                    yield f"event: error\ndata: {json.dumps({'message': state.error or 'Estrazione fallita'})}\n\n"
                    return

                # Invia progresso
                yield f"event: progress\ndata: {json.dumps({'message': state.progress_message, 'entities_count': state.entities_count})}\n\n"

            # Timeout nel polling (ma il task continua in background)
            timeout_msg = "Polling timeout. L'estrazione continua in background."
            yield f"event: warning\ndata: {json.dumps({'message': timeout_msg})}\n\n"

        except asyncio.CancelledError:
            # Client disconnesso - il task background continua!
            log.info(f"SSE client disconnected for {article_key}, background task continues")
            raise

    return StreamingResponse(
        progress_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "X-Rate-Limit-Remaining": str(remaining),
        },
    )


# =============================================================================
# LIVE ENRICHMENT (BATCH)
# =============================================================================
@router.post(
    "/live",
    response_model=LiveEnrichmentResponse,
    summary="Live enrichment di un articolo (batch)",
)
async def live_enrich(
    request: LiveEnrichmentRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> LiveEnrichmentResponse:
    """Esegue live enrichment per un articolo e salva a DB."""
    log.info(
        "API: live_enrich",
        tipo_atto=request.tipo_atto,
        articolo=request.articolo,
        user_id=request.user_id,
    )

    article_key = f"{request.tipo_atto}:{request.articolo}"

    # === QUICK CHECK (prima del lock) ===
    # 1. Check rapido se articolo già processato (cache in-memory)
    if _is_article_already_processed(article_key):
        log.info(f"Article {article_key} already processed (cache hit)")
        return await _get_existing_enrichment(session, article_key, request)

    # === CONCURRENT ENRICHMENT PROTECTION ===
    # Acquisisce lock per questo articolo specifico.
    # Se un altro utente sta già processando lo stesso articolo,
    # questa richiesta attende e poi riceve i risultati dal DB.
    article_lock = await _get_article_lock(article_key)

    async with article_lock:
        # === DOUBLE-CHECK dopo aver acquisito il lock ===
        # Un altro utente potrebbe aver completato l'enrichment mentre aspettavamo
        if _is_article_already_processed(article_key):
            log.info(f"Article {article_key} processed while waiting for lock")
            return await _get_existing_enrichment(session, article_key, request)

        # 2. Check se articolo ha già entità nel DB (persistente)
        existing_count = await session.execute(
            select(func.count(PendingEntity.id))
            .where(PendingEntity.article_urn.contains(article_key.replace(":", "_")))
        )
        if existing_count.scalar() > 0:
            log.info(f"Article {article_key} has existing entities in DB")
            _mark_article_processed(article_key)
            return await _get_existing_enrichment(session, article_key, request)

        # 3. Check rate limit per user
        allowed, remaining = _check_rate_limit(request.user_id)
        if not allowed:
            log.warning(
                f"Rate limit exceeded for user {request.user_id}",
                user_id=request.user_id,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Hai raggiunto il limite di {ENRICHMENT_RATE_LIMIT_PER_USER} enrichment per ora. Riprova più tardi.",
            )

        log.info(f"Rate limit OK: {remaining} enrichments remaining for user {request.user_id}")

        # === ENRICHMENT (dentro il lock) ===
        try:
            from merlt.pipeline.live_enrichment import LiveEnrichmentService

            service = LiveEnrichmentService()
            response = await service.enrich(request)

            # Registra enrichment per rate limiting
            _record_enrichment(request.user_id, response.article.urn)
            _mark_article_processed(article_key)

            # Save pending entities to DB
            for entity_data in response.pending_entities:
                # Get user authority for this domain
                voter_authority = await get_user_authority_for_vote(
                    session,
                    request.user_id,
                    entity_data.ambito or "generale",
                )

                # Get article_urn from articoli_correlati list (first item)
                article_urn = entity_data.articoli_correlati[0] if entity_data.articoli_correlati else response.article.urn

                # Get entity type as string value
                entity_type_str = entity_data.tipo.value if hasattr(entity_data.tipo, 'value') else str(entity_data.tipo)

                pending_entity = PendingEntity(
                    entity_id=entity_data.id,
                    article_urn=article_urn,
                    source_type="article",
                    entity_type=entity_type_str,
                    entity_text=entity_data.nome,
                    descrizione=entity_data.descrizione,
                    ambito=entity_data.ambito,
                    fonte="llm_extraction",
                    llm_confidence=entity_data.llm_confidence,
                    llm_model=os.environ.get("LLM_ENRICHMENT_MODEL", "google/gemini-2.5-flash"),
                    validation_status="pending",
                    contributed_by=request.user_id,
                    contributor_authority=voter_authority,
                )
                session.add(pending_entity)

            # Save pending relations to DB
            for relation_data in response.pending_relations:
                # Get relation type as string value
                relation_type_str = relation_data.relation_type.value if hasattr(relation_data.relation_type, 'value') else str(relation_data.relation_type)

                pending_relation = PendingRelation(
                    relation_id=relation_data.id,
                    article_urn=response.article.urn,  # Use article URN from response
                    source_type="article",
                    relation_type=relation_type_str,
                    source_node_urn=relation_data.source_urn,
                    target_entity_id=relation_data.target_urn,  # Use target_urn from model
                    relation_description=relation_data.evidence,  # Use evidence as description
                    certezza=relation_data.llm_confidence,  # Use llm_confidence as certezza
                    llm_confidence=relation_data.llm_confidence,
                    validation_status="pending",
                    contributed_by=request.user_id,
                )
                session.add(pending_relation)

            await session.commit()

            log.info(
                "Live enrichment saved to DB",
                entities=len(response.pending_entities),
                relations=len(response.pending_relations),
            )

            return response

        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(e),
            )
        except Exception as e:
            log.error(f"Live enrichment failed: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Enrichment failed: {str(e)}",
            )


# =============================================================================
# ENTITY VALIDATION
# =============================================================================
@router.post(
    "/validate-entity",
    response_model=EntityValidationResponse,
    summary="Valida una singola entita'",
)
async def validate_entity(
    request: EntityValidationRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> EntityValidationResponse:
    """
    Valida una singola entita' con voto pesato per authority.

    Flow:
    1. Check entity exists in DB
    2. Get voter's domain authority
    3. Create EntityVote
    4. Consensus calculated automatically by trigger
    5. If approved, write to FalkorDB
    """
    entity_id = request.entity_id

    log.info(
        "API: validate_entity",
        entity_id=entity_id,
        vote=request.vote,
        user_id=request.user_id,
    )

    # Get entity from DB
    stmt = select(PendingEntity).where(PendingEntity.entity_id == entity_id)
    result = await session.execute(stmt)
    entity = result.scalar_one_or_none()

    if not entity:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entity {entity_id} not found",
        )

    # Check not already finalized
    if entity.validation_status not in ["pending", "needs_revision"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entity already {entity.validation_status}",
        )

    # Get voter's domain authority
    voter_authority = await get_user_authority_for_vote(
        session,
        request.user_id,
        entity.ambito or "generale",
    )

    log.debug(
        "Voter authority",
        user_id=request.user_id,
        domain=entity.ambito,
        authority=voter_authority,
    )

    # Map vote string to value
    # "edit" = approvazione con revisione suggerita (conta come +1 ma con suggerimenti)
    vote_value_map = {
        "approve": 1,
        "reject": -1,
        "edit": 1,  # Edit = approve with suggested changes
    }
    vote_value = vote_value_map.get(request.vote, 1)  # Default approve

    # Check if user has already voted on this entity (upsert behavior)
    existing_vote_stmt = select(EntityVote).where(
        EntityVote.entity_id == entity_id,
        EntityVote.user_id == request.user_id,
        EntityVote.vote_type == "accuracy",
    )
    existing_vote_result = await session.execute(existing_vote_stmt)
    existing_vote = existing_vote_result.scalar_one_or_none()

    # Store suggested_edits as JSON for full edit history
    suggested_edits_json = None
    if request.suggested_edits:
        suggested_edits_json = json.dumps(request.suggested_edits)

    if existing_vote:
        # Update existing vote
        existing_vote.vote_value = vote_value
        existing_vote.voter_authority = voter_authority
        existing_vote.voter_domain_authority = voter_authority
        existing_vote.comment = request.reason
        existing_vote.suggested_revision = suggested_edits_json
        log.info("Updated existing vote", entity_id=entity_id, user_id=request.user_id)
    else:
        # Create new vote
        vote = EntityVote(
            entity_id=entity_id,
            user_id=request.user_id,
            vote_value=vote_value,
            vote_type="accuracy",
            voter_authority=voter_authority,
            voter_domain_authority=voter_authority,  # Same for now
            legal_domain=entity.ambito,
            comment=request.reason,
            suggested_revision=suggested_edits_json,
        )
        session.add(vote)

    await session.commit()

    # Refresh entity to get updated consensus (calculated by trigger)
    await session.refresh(entity)

    log.info(
        "Vote recorded",
        entity_id=entity_id,
        approval_score=entity.approval_score,
        rejection_score=entity.rejection_score,
        consensus=entity.consensus_reached,
    )

    # Initialize merge_result for later use in response
    merge_result = None

    # Calculate net score (approval - rejection) - can be negative
    net_score = (entity.approval_score or 0.0) - (entity.rejection_score or 0.0)

    # Handle consensus reached cases
    if entity.consensus_reached:
        if entity.consensus_type == "rejected":
            # Entity rejected by community
            log.info(
                "Entity rejected by community consensus",
                entity_id=entity_id,
                net_score=net_score,
                approval_score=entity.approval_score,
                rejection_score=entity.rejection_score,
            )

            # === CASCADE LOGIC ===
            # Find all relations that point to this rejected entity and reset them to pending
            # This ensures relations don't point to invalid targets
            try:
                relations_to_reset = await _cascade_reset_relations_for_rejected_entity(
                    session, entity_id
                )
                if relations_to_reset > 0:
                    log.info(
                        f"Cascade reset: {relations_to_reset} relations returned to pending",
                        rejected_entity_id=entity_id,
                        relations_reset=relations_to_reset,
                    )
            except Exception as e:
                log.error(f"Failed to cascade reset relations: {e}", exc_info=True)
                # Don't fail the vote, just log error

        elif entity.consensus_type == "approved" and not entity.written_to_graph_at:
            try:
                # First, process any edit merges (applies community-agreed modifications)
                original_values = {
                    "nome": entity.entity_text,
                    "tipo": entity.entity_type,
                    "descrizione": entity.descrizione,
                    "ambito": entity.ambito,
                }
                merge_result = await process_entity_consensus(session, entity_id, original_values)

                log.info(
                    "Edit merge processed",
                    entity_id=entity_id,
                    should_apply=merge_result.should_apply,
                    consensus_type=merge_result.consensus_type,
                    fields_changed=[f for f in merge_result.merged_fields.keys()]
                    if merge_result.merged_fields else [],
                )

                # Refresh entity after potential edits
                await session.refresh(entity)

                # Then write to graph
                await _write_entity_to_graph(entity, session)
            except Exception as e:
                log.error(f"Failed to process entity consensus: {e}", exc_info=True)
                # Don't fail the vote, just log error

    # Map status back to ValidationStatus enum
    status_map = {
        "pending": ValidationStatus.PENDING,
        "approved": ValidationStatus.APPROVED,
        "rejected": ValidationStatus.REJECTED,
        "needs_revision": ValidationStatus.NEEDS_REVISION,
    }

    # Build merged_edits dict from merge_result if available
    merged_edits = {}
    merge_message = ""
    if merge_result is not None and merge_result.should_apply:
        merged_edits = {
            f.field_name: {
                "original": f.original_value,
                "merged": f.merged_value,
                "confidence": f.confidence,
            }
            for f in merge_result.merged_fields.values()
            if f.merged_value != f.original_value
        }
        merge_message = f" Edits applied: {merge_result.message}"

    # Build validation result
    validation_result = ValidationResult(
        status=status_map.get(entity.validation_status, ValidationStatus.PENDING),
        score=net_score,
        merged_edits=merged_edits,
    )

    return EntityValidationResponse(
        entity_id=entity_id,
        new_status=status_map.get(entity.validation_status, ValidationStatus.PENDING),
        approval_score=entity.approval_score or 0.0,
        rejection_score=entity.rejection_score or 0.0,
        votes_count=entity.votes_count or 0,
        message=f"Vote recorded. Consensus: {entity.consensus_reached}{merge_message}",
        threshold_reached=entity.consensus_reached or False,
    )


async def _write_entity_to_graph(entity: PendingEntity, session: AsyncSession) -> None:
    """Helper to write approved entity to FalkorDB."""
    log.info("Writing approved entity to graph", entity_id=entity.entity_id)

    # Connect to FalkorDB
    falkordb = FalkorDBClient()
    await falkordb.connect()

    try:
        # Write entity with deduplication
        writer = EntityGraphWriter(falkordb)
        result = await writer.write_entity(entity)

        if result.success:
            # Update timestamp (remove timezone for PostgreSQL TIMESTAMP WITHOUT TIME ZONE)
            entity.written_to_graph_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await session.commit()

            log.info(
                "Entity written to graph",
                entity_id=entity.entity_id,
                node_id=result.node_id,
                action=result.action,
            )
        else:
            log.error("Failed to write entity to graph", entity_id=entity.entity_id, error=result.error)

    finally:
        await falkordb.close()


async def _write_relation_to_graph(relation: PendingRelation, session: AsyncSession) -> None:
    """
    Helper to write approved relation to FalkorDB.

    Creates a semantic relation between source and target nodes.
    If target is a pending entity, uses the entity node ID.
    If target is another article/norma, uses the URN.
    """
    log.info(
        "Writing approved relation to graph",
        relation_id=relation.relation_id,
        relation_type=relation.relation_type,
    )

    # Connect to FalkorDB
    falkordb = FalkorDBClient()
    await falkordb.connect()

    try:
        timestamp = datetime.now(timezone.utc).isoformat()

        # Determine target node type
        # If target_entity_id looks like an entity ID (tipo:nome), it's an entity
        # Otherwise, it's likely another article URN
        is_entity_target = ":" in relation.target_entity_id and not relation.target_entity_id.startswith("urn:")

        if is_entity_target:
            # Target is an Entity node
            query = f"""
            MERGE (source:Norma {{URN: $source_urn}})
            ON CREATE SET source.created_at = $timestamp
            WITH source
            MATCH (target:Entity {{id: $target_id}})
            MERGE (source)-[r:{relation.relation_type}]->(target)
            ON CREATE SET
                r.certezza = $certezza,
                r.fonte = 'community_validation',
                r.evidence = $evidence,
                r.community_validated = true,
                r.approval_score = $approval_score,
                r.votes_count = $votes_count,
                r.contributed_by = $contributed_by,
                r.created_at = $timestamp
            RETURN r
            """
        else:
            # Target is another Norma node (inter-article relation)
            query = f"""
            MERGE (source:Norma {{URN: $source_urn}})
            ON CREATE SET source.created_at = $timestamp
            WITH source
            MERGE (target:Norma {{URN: $target_id}})
            ON CREATE SET target.created_at = $timestamp
            WITH source, target
            MERGE (source)-[r:{relation.relation_type}]->(target)
            ON CREATE SET
                r.certezza = $certezza,
                r.fonte = 'community_validation',
                r.evidence = $evidence,
                r.community_validated = true,
                r.approval_score = $approval_score,
                r.votes_count = $votes_count,
                r.contributed_by = $contributed_by,
                r.created_at = $timestamp
            RETURN r
            """

        params = {
            "source_urn": relation.source_node_urn or relation.article_urn,
            "target_id": relation.target_entity_id,
            "certezza": relation.certezza or 1.0,
            "evidence": relation.relation_description or "",
            "approval_score": relation.approval_score or 0.0,
            "votes_count": relation.votes_count or 0,
            "contributed_by": relation.contributed_by or "",
            "timestamp": timestamp,
        }

        result = await falkordb.query(query, params)

        if result is not None:
            # Update timestamp (remove timezone for PostgreSQL TIMESTAMP WITHOUT TIME ZONE)
            relation.written_to_graph_at = datetime.now(timezone.utc).replace(tzinfo=None)
            await session.commit()

            log.info(
                "Relation written to graph",
                relation_id=relation.relation_id,
                relation_type=relation.relation_type,
                source=relation.source_node_urn,
                target=relation.target_entity_id,
            )
        else:
            log.error(
                "Failed to write relation to graph",
                relation_id=relation.relation_id,
                error="Query returned None",
            )

    except Exception as e:
        log.error(
            "Error writing relation to graph",
            relation_id=relation.relation_id,
            error=str(e),
            exc_info=True,
        )
    finally:
        await falkordb.close()


async def _cascade_reset_relations_for_rejected_entity(
    session: AsyncSession,
    rejected_entity_id: str,
) -> int:
    """
    Cascade logic: quando un'entità pending viene rejected,
    tutte le relazioni che puntano a quell'entità tornano pending.

    Questo assicura che le relazioni non puntino a target invalidi.

    Args:
        session: Database session
        rejected_entity_id: ID dell'entità che è stata rejected

    Returns:
        Numero di relazioni resettate a pending
    """
    # Find all relations that have this entity as target
    stmt = select(PendingRelation).where(
        PendingRelation.target_entity_id == rejected_entity_id,
        PendingRelation.target_is_pending == True,  # Only relations pointing to pending entities
    )

    result = await session.execute(stmt)
    relations = result.scalars().all()

    if not relations:
        return 0

    # Reset each relation to pending
    for relation in relations:
        relation.validation_status = "pending"
        relation.consensus_reached = False
        relation.consensus_type = None
        relation.approval_score = 0.0
        relation.rejection_score = 0.0
        relation.net_score = 0.0
        relation.votes_count = 0
        # Clear votes for this relation
        # (keeping them would be misleading since target changed)

    await session.commit()

    log.info(
        f"Cascade reset completed: {len(relations)} relations",
        rejected_entity_id=rejected_entity_id,
    )

    return len(relations)


# =============================================================================
# PENDING QUEUE
# =============================================================================
@router.get(
    "/pending",
    response_model=PendingQueueResponse,
    summary="Lista pending items per validazione",
)
async def get_pending(
    request: PendingQueueRequest = Depends(),
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> PendingQueueResponse:
    """Lista pending entities e relations per validazione.

    IMPORTANTE: Filtra automaticamente le entità/relazioni già votate dall'utente.
    Ogni utente può votare solo una volta per ogni item (accuracy vote).
    """
    log.info(
        "API: get_pending",
        user_id=request.user_id,
        legal_domain=request.legal_domain,
        article_urn=request.article_urn,
        limit=request.limit
    )

    # === Subquery per escludere entità già votate dall'utente ===
    # Un utente può votare solo UNA volta per entità (vote_type='accuracy')
    user_voted_entities = (
        select(EntityVote.entity_id)
        .where(EntityVote.user_id == request.user_id)
        .where(EntityVote.vote_type == "accuracy")
    )

    # Query pending entities (escludi quelle già votate)
    entities_stmt = (
        select(PendingEntity)
        .where(PendingEntity.validation_status == "pending")
        .where(~PendingEntity.entity_id.in_(user_voted_entities))  # Escludi già votate
        .order_by(PendingEntity.created_at.desc())
        .limit(request.limit)
    )

    if request.legal_domain:
        entities_stmt = entities_stmt.where(PendingEntity.ambito == request.legal_domain)

    # Filter by tipo_atto (act type) - resolve to URN pattern using NORMATTIVA_URN_CODICI
    # This distinguishes Art. 1 Costituzione from Art. 1 Codice Civile
    if request.tipo_atto:
        tipo_atto_lower = request.tipo_atto.lower().strip()
        urn_pattern = NORMATTIVA_URN_CODICI.get(tipo_atto_lower)
        if urn_pattern:
            # Match the URN pattern for the act type (e.g., "costituzione" or "regio.decreto:1930-10-19;1398:1")
            entities_stmt = entities_stmt.where(
                PendingEntity.article_urn.ilike(f"%{urn_pattern}%")
            )
        else:
            # Fallback: try to match tipo_atto directly (normalized to lowercase with underscores)
            tipo_atto_normalized = tipo_atto_lower.replace(" ", "_").replace("'", "")
            entities_stmt = entities_stmt.where(
                PendingEntity.article_urn.ilike(f"%{tipo_atto_normalized}%")
            )

    # Filter by article URN with precise article number matching
    # The frontend sends patterns like "~art1" which should match "~art1" but NOT "~art11"
    # We use PostgreSQL regex (~) to ensure the article number is followed by non-digit or end of string
    if request.article_urn:
        # Extract article number from pattern (e.g., "~art1" -> "1")
        article_pattern = request.article_urn
        if article_pattern.startswith("~art"):
            article_num = article_pattern[4:]  # Get number part
            # Build regex: ~art{num} followed by non-digit or end of string
            # This ensures "~art1" matches "~art1" or "~art1bis" but NOT "~art11"
            regex_pattern = f"~art{article_num}([^0-9]|$)"
            entities_stmt = entities_stmt.where(
                PendingEntity.article_urn.op("~")(regex_pattern)
            )
        else:
            # Fallback to ILIKE for other patterns
            entities_stmt = entities_stmt.where(
                PendingEntity.article_urn.ilike(f"%{article_pattern}%")
            )

    # Filter by updated_after timestamp (for real-time sync)
    if request.updated_after:
        entities_stmt = entities_stmt.where(
            PendingEntity.updated_at > request.updated_after
        )

    entities_result = await session.execute(entities_stmt)
    entities = entities_result.scalars().all()

    # Convert to PendingEntityData
    pending_entities = [
        PendingEntityData(
            id=entity.entity_id,
            nome=entity.entity_text,
            tipo=entity.entity_type,
            descrizione=entity.descrizione or "",
            articoli_correlati=[entity.article_urn] if entity.article_urn else [],
            ambito=entity.ambito or "",
            fonte=entity.fonte or "unknown",
            llm_confidence=entity.llm_confidence or 0.0,
            raw_context="",  # Not stored in DB for now
            validation_status=ValidationStatus.PENDING,
            approval_score=entity.approval_score or 0.0,
            rejection_score=entity.rejection_score or 0.0,
            votes_count=entity.votes_count or 0,
            contributed_by=entity.contributed_by or "unknown",
            contributor_authority=entity.contributor_authority or 0.0,
        )
        for entity in entities
    ]

    # === Subquery per escludere relazioni già votate dall'utente ===
    user_voted_relations = (
        select(RelationVote.relation_id)
        .where(RelationVote.user_id == request.user_id)
        .where(RelationVote.vote_type == "accuracy")
    )

    # Query pending relations (escludi quelle già votate)
    relations_stmt = (
        select(PendingRelation)
        .where(PendingRelation.validation_status == "pending")
        .where(~PendingRelation.relation_id.in_(user_voted_relations))  # Escludi già votate
        .order_by(PendingRelation.created_at.desc())
        .limit(request.limit)
    )

    # Filter by tipo_atto for relations (same logic as entities)
    if request.tipo_atto:
        tipo_atto_lower = request.tipo_atto.lower().strip()
        urn_pattern = NORMATTIVA_URN_CODICI.get(tipo_atto_lower)
        if urn_pattern:
            relations_stmt = relations_stmt.where(
                PendingRelation.article_urn.ilike(f"%{urn_pattern}%")
            )
        else:
            tipo_atto_normalized = tipo_atto_lower.replace(" ", "_").replace("'", "")
            relations_stmt = relations_stmt.where(
                PendingRelation.article_urn.ilike(f"%{tipo_atto_normalized}%")
            )

    # Filter by article URN with precise article number matching (same logic as entities)
    if request.article_urn:
        article_pattern = request.article_urn
        if article_pattern.startswith("~art"):
            article_num = article_pattern[4:]
            regex_pattern = f"~art{article_num}([^0-9]|$)"
            relations_stmt = relations_stmt.where(
                PendingRelation.article_urn.op("~")(regex_pattern)
            )
        else:
            relations_stmt = relations_stmt.where(
                PendingRelation.article_urn.ilike(f"%{article_pattern}%")
            )

    # Filter by updated_after timestamp (for real-time sync)
    if request.updated_after:
        relations_stmt = relations_stmt.where(
            PendingRelation.updated_at > request.updated_after
        )

    relations_result = await session.execute(relations_stmt)
    relations = relations_result.scalars().all()

    # Convert to PendingRelationData
    pending_relations = []
    for rel in relations:
        # Convert relation_type string to RelationType enum
        try:
            rel_type = RelationType(rel.relation_type)
        except (ValueError, KeyError):
            # Fallback: try to match by name or default to IMPLICA
            rel_type = RelationType.IMPLICA
            log.debug(f"Unknown relation type '{rel.relation_type}', defaulting to IMPLICA")

        pending_relations.append(
            PendingRelationData(
                id=rel.relation_id,
                source_urn=rel.source_node_urn or "",
                target_urn=rel.target_entity_id or "",
                relation_type=rel_type,
                fonte=getattr(rel, 'fonte', None) or "llm_extraction",
                llm_confidence=rel.llm_confidence or 0.0,
                evidence=rel.relation_description or "",
                validation_status=ValidationStatus.PENDING,
                approval_score=rel.approval_score or 0.0,
                rejection_score=rel.rejection_score or 0.0,
                votes_count=rel.votes_count or 0,
                contributed_by=rel.contributed_by or "unknown",
                contributor_authority=rel.contributor_authority or 0.5,
            )
        )

    log.info(f"Retrieved {len(pending_entities)} entities, {len(pending_relations)} relations")

    return PendingQueueResponse(
        pending_entities=pending_entities,
        pending_relations=pending_relations,
        total_entities=len(pending_entities),
        total_relations=len(pending_relations),
    )


# =============================================================================
# DUPLICATE CHECK
# =============================================================================
@router.post(
    "/check-duplicate",
    response_model=DuplicateCheckResponse,
    summary="Verifica duplicati prima di proporre entita'",
)
async def check_entity_duplicate(
    request: DuplicateCheckRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DuplicateCheckResponse:
    """
    Verifica se un'entita' simile esiste gia' nel sistema.

    Usa questa API prima di proporre una nuova entita' per:
    1. Evitare duplicati
    2. Mostrare entita' simili all'utente
    3. Permettere di modificare entita' esistenti invece di crearne nuove

    Recommendation:
    - "create": Nessun duplicato, procedi con la proposta
    - "merge": Trovato match esatto, suggerisci di votare l'esistente
    - "ask_user": Trovati duplicati probabili, mostra all'utente per decidere
    """
    log.info(
        "API: check_entity_duplicate",
        entity_text=request.entity_text,
        entity_type=request.entity_type,
        scope=request.scope,
    )

    # Run deduplication
    deduplicator = EntityDeduplicator(session)
    result = await deduplicator.find_duplicates(
        entity_text=request.entity_text,
        entity_type=request.entity_type.value if hasattr(request.entity_type, 'value') else str(request.entity_type),
        article_urn=request.article_urn,
        scope=request.scope,
    )

    # Map internal DuplicateConfidence to API DuplicateConfidenceLevel
    def map_confidence(conf: DuplicateConfidence) -> DuplicateConfidenceLevel:
        return DuplicateConfidenceLevel(conf.value)

    # Convert to API response
    duplicates = [
        DuplicateCandidateData(
            entity_id=d.entity_id,
            entity_text=d.entity_text,
            entity_type=d.entity_type,
            descrizione=d.descrizione,
            article_urn=d.article_urn,
            similarity_score=d.similarity_score,
            confidence=map_confidence(d.confidence),
            match_reason=d.match_reason,
            validation_status=d.validation_status,
            votes_count=d.votes_count,
            net_score=d.net_score,
        )
        for d in result.duplicates
    ]

    exact_match = None
    if result.exact_match:
        exact_match = DuplicateCandidateData(
            entity_id=result.exact_match.entity_id,
            entity_text=result.exact_match.entity_text,
            entity_type=result.exact_match.entity_type,
            descrizione=result.exact_match.descrizione,
            article_urn=result.exact_match.article_urn,
            similarity_score=result.exact_match.similarity_score,
            confidence=map_confidence(result.exact_match.confidence),
            match_reason=result.exact_match.match_reason,
            validation_status=result.exact_match.validation_status,
            votes_count=result.exact_match.votes_count,
            net_score=result.exact_match.net_score,
        )

    log.info(
        "Duplicate check completed",
        has_duplicates=result.has_duplicates,
        duplicates_count=len(duplicates),
        recommendation=result.recommendation,
    )

    return DuplicateCheckResponse(
        query_text=result.query_text,
        query_type=result.query_type,
        normalized_query=result.normalized_query,
        has_duplicates=result.has_duplicates,
        exact_match=exact_match,
        duplicates=duplicates,
        recommendation=result.recommendation,
    )


@router.post(
    "/check-relation-duplicate",
    response_model=RelationDuplicateCheckResponse,
    summary="Verifica duplicati relazione",
)
async def check_relation_duplicate(
    request: RelationDuplicateCheckRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> RelationDuplicateCheckResponse:
    """Verifica se una relazione simile esiste gia'."""
    log.info(
        "API: check_relation_duplicate",
        source=request.source_entity_id,
        target=request.target_entity_id,
        relation_type=request.relation_type,
    )

    deduplicator = RelationDeduplicator(session)
    result = await deduplicator.find_duplicates(
        source_entity_id=request.source_entity_id,
        target_entity_id=request.target_entity_id,
        relation_type=request.relation_type.value if hasattr(request.relation_type, 'value') else str(request.relation_type),
    )

    def map_confidence(conf: DuplicateConfidence) -> DuplicateConfidenceLevel:
        return DuplicateConfidenceLevel(conf.value)

    duplicates = [
        RelationDuplicateCandidateData(
            relation_id=d.relation_id,
            source_text=d.source_text,
            target_text=d.target_text,
            relation_type=d.relation_type,
            similarity_score=d.similarity_score,
            confidence=map_confidence(d.confidence),
            validation_status=d.validation_status,
        )
        for d in result.duplicates
    ]

    exact_match = None
    if result.exact_match:
        exact_match = RelationDuplicateCandidateData(
            relation_id=result.exact_match.relation_id,
            source_text=result.exact_match.source_text,
            target_text=result.exact_match.target_text,
            relation_type=result.exact_match.relation_type,
            similarity_score=result.exact_match.similarity_score,
            confidence=map_confidence(result.exact_match.confidence),
            validation_status=result.exact_match.validation_status,
        )

    return RelationDuplicateCheckResponse(
        has_duplicates=result.has_duplicates,
        exact_match=exact_match,
        duplicates=duplicates,
        recommendation=result.recommendation,
    )


# =============================================================================
# PROPOSE ENTITY
# =============================================================================
@router.post(
    "/propose-entity",
    response_model=EntityProposalResponse,
    summary="Proponi nuova entita'",
)
async def propose_entity(
    request: EntityProposalRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> EntityProposalResponse:
    """
    Proponi una nuova entita' per validazione community.

    Se vengono trovati duplicati e skip_duplicate_check=False,
    la response conterra' i duplicati e l'entita' NON verra' creata.
    L'utente deve richiamare con skip_duplicate_check=True per procedere.
    """
    log.info(
        "API: propose_entity",
        tipo=request.tipo,
        nome=request.nome,
        user_id=request.user_id,
        skip_duplicate_check=request.skip_duplicate_check,
    )

    # Get user authority
    voter_authority = await get_user_authority_for_vote(
        session,
        request.user_id,
        request.ambito or "generale",
    )

    tipo_str = request.tipo.value if hasattr(request.tipo, 'value') else str(request.tipo)

    # Track duplicates for info in response (even if not blocking)
    found_duplicates: List[DuplicateCandidateData] = []

    # === DEDUPLICATION CHECK ===
    if not request.skip_duplicate_check:
        deduplicator = EntityDeduplicator(session)
        dedup_result = await deduplicator.find_duplicates(
            entity_text=request.nome,
            entity_type=tipo_str,
            article_urn=request.article_urn,
            scope="global",
        )

        if dedup_result.has_duplicates:
            # Map to API models
            def map_confidence(conf: DuplicateConfidence) -> DuplicateConfidenceLevel:
                return DuplicateConfidenceLevel(conf.value)

            duplicates_data = [
                DuplicateCandidateData(
                    entity_id=d.entity_id,
                    entity_text=d.entity_text,
                    entity_type=d.entity_type,
                    descrizione=d.descrizione,
                    article_urn=d.article_urn,
                    similarity_score=d.similarity_score,
                    confidence=map_confidence(d.confidence),
                    match_reason=d.match_reason,
                    validation_status=d.validation_status,
                    votes_count=d.votes_count,
                    net_score=d.net_score,
                )
                for d in dedup_result.duplicates
            ]

            # SOLO EXACT match blocca la creazione
            # Nel dominio giuridico, "buona fede" vs "buona fede oggettiva" sono DIVERSI
            # quindi non blocchiamo per fuzzy match
            has_exact_match = dedup_result.exact_match is not None

            if has_exact_match:
                log.info(
                    "Exact duplicate found, action required",
                    exact_match=dedup_result.exact_match.entity_text if dedup_result.exact_match else None,
                )

                return EntityProposalResponse(
                    success=False,
                    pending_entity=None,
                    message=f"Esiste gia' un'entita' identica: '{dedup_result.exact_match.entity_text}'. Conferma per creare comunque.",
                    has_duplicates=True,
                    duplicates=duplicates_data,
                    duplicate_action_required=True,
                )

            # Per fuzzy match (HIGH/MEDIUM/LOW): solo info, non blocca
            log.info(
                "Similar entities found (non-blocking)",
                duplicates_count=len(duplicates_data),
                recommendation=dedup_result.recommendation,
            )
            # Salva i duplicati per includerli nella response (solo info)
            found_duplicates = duplicates_data

    # === CREATE ENTITY ===
    entity_id = f"{tipo_str}:{uuid4().hex[:8]}"

    # Create pending entity
    pending_entity = PendingEntity(
        entity_id=entity_id,
        article_urn=request.article_urn,
        source_type="manual",
        entity_type=tipo_str,
        entity_text=request.nome,
        descrizione=request.descrizione,
        ambito=request.ambito,
        fonte="community",
        validation_status="pending",
        contributed_by=request.user_id,
        contributor_authority=voter_authority,
        # Track deduplication acknowledgment
        duplicate_check_mechanical=True,
        potential_duplicate_of=request.acknowledged_duplicate_of,
    )

    session.add(pending_entity)
    await session.commit()

    log.info("Entity proposed", entity_id=entity_id, acknowledged_duplicate=request.acknowledged_duplicate_of)

    # Create PendingEntityData for response
    pending_entity_data = PendingEntityData(
        id=entity_id,
        nome=request.nome,
        tipo=request.tipo,  # Keep as enum for response
        descrizione=request.descrizione,
        articoli_correlati=[request.article_urn],
        ambito=request.ambito,
        fonte="community",  # Manual proposal from user
        llm_confidence=0.0,  # Manual proposal, no LLM
        raw_context=request.evidence,  # Evidence provided by user
        validation_status=ValidationStatus.PENDING,
        approval_score=0.0,
        rejection_score=0.0,
        votes_count=0,
        contributed_by=request.user_id,
        contributor_authority=voter_authority,
    )

    # Include similar entities as info (non-blocking) if found
    return EntityProposalResponse(
        pending_entity=pending_entity_data,
        message="Entity proposed for community validation",
        has_duplicates=len(found_duplicates) > 0,
        duplicates=found_duplicates,
        duplicate_action_required=False,  # Non-blocking, just info
    )


# =============================================================================
# RELATION VALIDATION (Simplified for now)
# =============================================================================
@router.post(
    "/validate-relation",
    response_model=RelationValidationResponse,
    summary="Valida una singola relazione",
)
async def validate_relation(
    request: RelationValidationRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> RelationValidationResponse:
    """Valida una singola relazione (similar to entity validation)."""
    relation_id = request.relation_id

    log.info("API: validate_relation", relation_id=relation_id, user_id=request.user_id)

    # Get relation from DB
    stmt = select(PendingRelation).where(PendingRelation.relation_id == relation_id)
    result = await session.execute(stmt)
    relation = result.scalar_one_or_none()

    if not relation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relation not found")

    # Check not already finalized
    if relation.validation_status not in ["pending", "needs_revision"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Relation already {relation.validation_status}",
        )

    # Get voter authority (use source article's domain if available)
    voter_authority = await get_user_authority_for_vote(session, request.user_id, "generale")

    # Map vote - "edit" counts as approve with suggested changes
    vote_value_map = {
        "approve": 1,
        "reject": -1,
        "edit": 1,  # Edit = approve with suggested changes
    }
    vote_value = vote_value_map.get(request.vote, 1)

    # Check if user has already voted on this relation (upsert behavior)
    existing_vote_stmt = select(RelationVote).where(
        RelationVote.relation_id == relation_id,
        RelationVote.user_id == request.user_id,
        RelationVote.vote_type == "accuracy",
    )
    existing_vote_result = await session.execute(existing_vote_stmt)
    existing_vote = existing_vote_result.scalar_one_or_none()

    if existing_vote:
        # Update existing vote
        existing_vote.vote_value = vote_value
        existing_vote.voter_authority = voter_authority
        existing_vote.comment = request.reason
        # Store suggested edits as JSON string in comment if provided
        if request.suggested_edits:
            import json
            existing_vote.comment = json.dumps({
                "reason": request.reason,
                "suggested_edits": request.suggested_edits,
            })
        log.info("Updated existing relation vote", relation_id=relation_id, user_id=request.user_id)
    else:
        # Create new vote
        comment = request.reason
        if request.suggested_edits:
            import json
            comment = json.dumps({
                "reason": request.reason,
                "suggested_edits": request.suggested_edits,
            })

        vote = RelationVote(
            relation_id=relation_id,
            user_id=request.user_id,
            vote_value=vote_value,
            vote_type="accuracy",
            voter_authority=voter_authority,
            legal_domain="generale",
            comment=comment,
        )
        session.add(vote)

    await session.commit()

    # Refresh to get consensus
    await session.refresh(relation)

    # Calculate net score (approval - rejection) - can be negative
    net_score = (relation.approval_score or 0.0) - (relation.rejection_score or 0.0)

    # Handle consensus reached cases
    merge_message = ""
    if relation.consensus_reached:
        if relation.consensus_type == "rejected":
            # Relation rejected by community - log and skip
            log.info(
                "Relation rejected by community consensus",
                relation_id=relation_id,
                net_score=net_score,
                approval_score=relation.approval_score,
                rejection_score=relation.rejection_score,
            )
        elif relation.consensus_type == "approved" and not relation.written_to_graph_at:
            try:
                # First, process any edit merges (applies community-agreed modifications)
                original_values = {
                    "relation_type": relation.relation_type,
                    "target_urn": relation.target_entity_id,
                    "evidence": relation.relation_description,
                }
                merge_result = await process_relation_consensus(session, relation_id, original_values)

                log.info(
                    "Relation edit merge processed",
                    relation_id=relation_id,
                    should_apply=merge_result.should_apply,
                    fields_changed=list(merge_result.merged_fields.keys()) if merge_result.merged_fields else [],
                )

                if merge_result.should_apply:
                    merge_message = f" Edits applied: {merge_result.message}"
                    await session.refresh(relation)

                # Then write to FalkorDB
                await _write_relation_to_graph(relation, session)

            except Exception as e:
                log.error(f"Failed to process relation consensus: {e}", exc_info=True)

    # Build response
    status_map = {
        "pending": ValidationStatus.PENDING,
        "approved": ValidationStatus.APPROVED,
        "rejected": ValidationStatus.REJECTED,
        "needs_revision": ValidationStatus.NEEDS_REVISION,
    }

    return RelationValidationResponse(
        relation_id=relation_id,
        new_status=status_map.get(relation.validation_status, ValidationStatus.PENDING),
        approval_score=relation.approval_score or 0.0,
        rejection_score=relation.rejection_score or 0.0,
        votes_count=relation.votes_count or 0,
        message=f"Vote recorded. Consensus: {relation.consensus_reached or False}{merge_message}",
        threshold_reached=relation.consensus_reached or False,
    )


# =============================================================================
# PROPOSE RELATION
# =============================================================================
@router.post(
    "/propose-relation",
    response_model=RelationProposalResponse,
    summary="Proponi nuova relazione",
)
async def propose_relation(
    request: RelationProposalRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> RelationProposalResponse:
    """
    Proponi una nuova relazione per validazione.

    IMPORTANTE: Le relazioni possono ora puntare a entità pending.
    Se il target è pending, `target_is_pending=True` viene settato.
    Se l'entità target viene poi scartata, la relazione torna pending (cascade).

    DEDUPLICATION: Se skip_duplicate_check=False (default):
    - Cerca duplicati (stesso source, target, tipo)
    - Se EXACT match: blocca la creazione
    - Se fuzzy match: crea comunque ma ritorna info duplicati
    """
    log.info(
        "API: propose_relation",
        tipo=request.tipo_relazione,
        source=request.source_urn,
        target=request.target_entity_id,
        skip_duplicate_check=request.skip_duplicate_check,
    )

    # Track duplicates for info in response
    found_duplicates: List[RelationDuplicateCandidateData] = []
    has_exact_match = False

    # === DEDUPLICATION CHECK ===
    if not request.skip_duplicate_check:
        deduplicator = RelationDeduplicator(session)
        dedup_result = await deduplicator.find_duplicates(
            source_entity_id=request.source_urn,
            target_entity_id=request.target_entity_id,
            relation_type=request.tipo_relazione.value if hasattr(request.tipo_relazione, 'value') else str(request.tipo_relazione),
        )

        # Map duplicates to response format
        def map_confidence(conf: DuplicateConfidence) -> DuplicateConfidenceLevel:
            return DuplicateConfidenceLevel(conf.value)

        found_duplicates = [
            RelationDuplicateCandidateData(
                relation_id=d.relation_id,
                source_text=d.source_text,
                target_text=d.target_text,
                relation_type=d.relation_type,
                similarity_score=d.similarity_score,
                confidence=map_confidence(d.confidence),
                validation_status=d.validation_status,
            )
            for d in dedup_result.duplicates
        ]

        # Check for exact match
        has_exact_match = dedup_result.exact_match is not None

        # SOLO EXACT match blocca la creazione
        if has_exact_match:
            exact_match = dedup_result.exact_match
            assert exact_match is not None  # Type hint for mypy
            exact_data = RelationDuplicateCandidateData(
                relation_id=exact_match.relation_id,
                source_text=exact_match.source_text,
                target_text=exact_match.target_text,
                relation_type=exact_match.relation_type,
                similarity_score=exact_match.similarity_score,
                confidence=map_confidence(exact_match.confidence),
                validation_status=exact_match.validation_status,
            )
            return RelationProposalResponse(
                success=False,
                relation_id=None,
                message="Relazione identica gia' esistente",
                has_duplicates=True,
                duplicates=[exact_data] + found_duplicates,
                duplicate_action_required=True,
            )

    # === Check if target entity is pending ===
    # Look for target_entity_id in pending_entities table
    target_is_pending = False
    stmt = select(PendingEntity).where(
        PendingEntity.entity_id == request.target_entity_id,
        PendingEntity.validation_status == "pending",
    )
    result = await session.execute(stmt)
    pending_target = result.scalar_one_or_none()

    if pending_target:
        target_is_pending = True
        log.info(
            "Target entity is pending",
            target_entity_id=request.target_entity_id,
        )

    # Generate relation ID
    relation_id = f"{request.tipo_relazione}:{uuid4().hex[:8]}"

    # Create pending relation with target_is_pending flag
    pending_relation = PendingRelation(
        relation_id=relation_id,
        article_urn=request.article_urn,
        source_type="manual",
        relation_type=request.tipo_relazione,
        source_node_urn=request.source_urn,
        target_entity_id=request.target_entity_id,
        target_is_pending=target_is_pending,  # Track if target is pending
        relation_description=request.descrizione,
        certezza=request.certezza,
        validation_status="pending",
        contributed_by=request.user_id,
    )

    session.add(pending_relation)
    await session.commit()

    log.info(
        "Relation proposed",
        relation_id=relation_id,
        target_is_pending=target_is_pending,
        duplicates_found=len(found_duplicates),
    )

    return RelationProposalResponse(
        success=True,
        relation_id=relation_id,
        message="Relation proposed for community validation",
        has_duplicates=len(found_duplicates) > 0,
        duplicates=found_duplicates,
        duplicate_action_required=False,
    )


# =============================================================================
# ISSUE REPORTING (RLCF Feedback Loop)
# =============================================================================

# Soglie RLCF per issue reporting
ISSUE_THRESHOLDS = {
    "reopen_validation": 2.0,  # Somma pesata per tornare in needs_revision
    "dismiss_issue": -1.5,     # Soglia per dismissare issue non valida
}


@router.post(
    "/report-issue",
    response_model=ReportIssueResponse,
    summary="Segnala un problema su un'entita'",
)
async def report_issue(
    request: ReportIssueRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> ReportIssueResponse:
    """
    Segnala un problema su un'entita' approvata nel Knowledge Graph.

    Flusso RLCF:
    1. Utente vede incongruenza nel grafo
    2. Crea issue con tipo, gravita' e descrizione
    3. Community vota sulla validita' dell'issue
    4. Se upvote_score >= threshold → entity torna in needs_revision

    DEDUPLICATION:
    Se esiste gia' una issue aperta con stesso entity_id e issue_type,
    l'issue viene "merged" (incrementa il votes_count invece di duplicare).
    """
    log.info(
        "API: report_issue",
        entity_id=request.entity_id,
        issue_type=request.issue_type,
        severity=request.severity,
        user_id=request.user_id,
    )

    # 1. Verifica che l'entita' esista (prima in pending_entities, poi nel grafo)
    entity_type: Optional[str] = None
    entity_domain: str = "generale"
    is_relation: bool = request.entity_id.startswith("rel_")

    # Check pending_entities first (solo per nodi, non relazioni)
    if not is_relation:
        entity_stmt = select(PendingEntity).where(PendingEntity.entity_id == request.entity_id)
        entity_result = await session.execute(entity_stmt)
        entity = entity_result.scalar_one_or_none()

        if entity:
            entity_type = entity.entity_type
            entity_domain = entity.ambito or "generale"
            log.debug("Entity found in pending_entities", entity_id=request.entity_id)
    else:
        entity = None

    if not entity:
        # Fallback: check FalkorDB graph for approved entities or relations
        log.debug(
            "Checking FalkorDB graph",
            entity_id=request.entity_id,
            is_relation=is_relation,
        )
        try:
            graph_client = FalkorDBClient()
            await graph_client.connect()

            try:
                if is_relation:
                    # Per le relazioni, verifichiamo che source e target esistano
                    # Il formato e': rel_{source_id}_{relation_type}_{target_id}
                    # Ma puo' essere complesso, quindi verifichiamo solo che esista qualche relazione
                    # tra i nodi indicati nell'ID
                    parts = request.entity_id.split("_", 2)  # rel, source..., rest
                    if len(parts) >= 2:
                        # Estraiamo tipo relazione (ultima parte prima del target)
                        # Formato: rel_<source>_<type>_<target>
                        # Verifichiamo semplicemente che l'ID sia valido accettandolo
                        entity_type = "Relation"
                        entity_domain = "generale"
                        log.info(
                            "Relation issue accepted",
                            entity_id=request.entity_id,
                        )
                    else:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid relation ID format: {request.entity_id}",
                        )
                else:
                    # Query per trovare il nodo nel grafo (entita' gia' approvate)
                    # In FalkorDB la proprieta' identificativa e' "node_id"
                    cypher = """
                        MATCH (n)
                        WHERE n.node_id = $entity_id
                        RETURN n.node_id as entity_id,
                               labels(n)[0] as entity_type,
                               n.domain as domain,
                               n.ambito as ambito
                        LIMIT 1
                    """
                    result = await graph_client.query(
                        cypher,
                        {"entity_id": request.entity_id}
                    )

                    if result and len(result) > 0:
                        row = result[0]
                        entity_type = row.get("entity_type") or "unknown"
                        entity_domain = row.get("domain") or row.get("ambito") or "generale"
                        log.info(
                            "Entity found in FalkorDB graph",
                            entity_id=request.entity_id,
                            entity_type=entity_type,
                            domain=entity_domain,
                        )
                    else:
                        # Entita' non trovata da nessuna parte
                        raise HTTPException(
                            status_code=status.HTTP_404_NOT_FOUND,
                            detail=f"Entity {request.entity_id} not found (checked pending_entities and graph)",
                        )
            finally:
                await graph_client.close()
        except HTTPException:
            raise
        except Exception as e:
            log.warning(
                "FalkorDB graph lookup failed, entity not found",
                entity_id=request.entity_id,
                error=str(e),
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Entity {request.entity_id} not found",
            )

    # 2. Check se esiste gia' una issue aperta simile (dedup)
    existing_stmt = select(EntityIssueReport).where(
        EntityIssueReport.entity_id == request.entity_id,
        EntityIssueReport.issue_type == request.issue_type.value,
        EntityIssueReport.status == "open",
    )
    existing_result = await session.execute(existing_stmt)
    existing_issue = existing_result.scalar_one_or_none()

    if existing_issue:
        # Merge: incrementa votes_count invece di duplicare
        existing_issue.votes_count = (existing_issue.votes_count or 0) + 1
        await session.commit()

        log.info(
            "Issue merged with existing",
            existing_issue_id=existing_issue.issue_id,
            new_votes_count=existing_issue.votes_count,
        )

        return ReportIssueResponse(
            success=True,
            issue_id=existing_issue.issue_id,
            entity_id=request.entity_id,
            status="merged",
            message=f"Segnalazione unita a issue esistente (ID: {existing_issue.issue_id})",
            merged_with=existing_issue.issue_id,
        )

    # 3. Get reporter authority
    reporter_authority = await get_user_authority_for_vote(
        session,
        request.user_id,
        entity_domain,
    )

    # 4. Crea nuova issue
    issue_id = f"issue:{uuid4().hex[:12]}"

    new_issue = EntityIssueReport(
        issue_id=issue_id,
        entity_id=request.entity_id,
        entity_type=entity_type,
        reported_by=request.user_id,
        reporter_authority=reporter_authority,
        issue_type=request.issue_type.value,
        severity=request.severity.value,
        description=request.description,
        status="open",
        upvote_score=reporter_authority,  # Reporter conta come primo upvote
        downvote_score=0.0,
        votes_count=1,
    )
    session.add(new_issue)
    await session.commit()

    log.info(
        "Issue created",
        issue_id=issue_id,
        entity_id=request.entity_id,
        reporter_authority=reporter_authority,
    )

    return ReportIssueResponse(
        success=True,
        issue_id=issue_id,
        entity_id=request.entity_id,
        status="created",
        message="Segnalazione inviata. La community votera' sulla validita'.",
    )


@router.post(
    "/vote-issue",
    response_model=VoteIssueResponse,
    summary="Vota su una segnalazione",
)
async def vote_issue(
    request: VoteIssueRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> VoteIssueResponse:
    """
    Vota su una issue esistente (upvote = issue valida, downvote = issue non valida).

    Il voto e' pesato per l'authority dell'utente.
    Se upvote_score raggiunge la soglia, l'entita' torna in needs_revision.
    Se downvote_score raggiunge la soglia, l'issue viene dismissata.
    """
    log.info(
        "API: vote_issue",
        issue_id=request.issue_id,
        vote=request.vote,
        user_id=request.user_id,
    )

    # 1. Get issue
    issue_stmt = select(EntityIssueReport).where(EntityIssueReport.issue_id == request.issue_id)
    issue_result = await session.execute(issue_stmt)
    issue = issue_result.scalar_one_or_none()

    if not issue:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Issue {request.issue_id} not found",
        )

    # 2. Check issue is still open
    if issue.status != "open":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Issue is already {issue.status}",
        )

    # 3. Get entity to determine domain for authority
    # Check pending_entities first, then FalkorDB graph
    entity_stmt = select(PendingEntity).where(PendingEntity.entity_id == issue.entity_id)
    entity_result = await session.execute(entity_stmt)
    entity = entity_result.scalar_one_or_none()

    domain = "generale"
    graph_entity_data: Optional[Dict[str, Any]] = None

    if entity:
        domain = entity.ambito or "generale"
    else:
        # Fallback: check FalkorDB graph for approved entities
        try:
            graph_client = FalkorDBClient()
            await graph_client.connect()

            cypher = """
                MATCH (n)
                WHERE n.node_id = $entity_id
                RETURN n.node_id as entity_id,
                       labels(n)[0] as entity_type,
                       n.domain as domain,
                       n.ambito as ambito,
                       n.nome as nome,
                       n.descrizione as descrizione
                LIMIT 1
            """
            result = await graph_client.query(cypher, {"entity_id": issue.entity_id})

            if result and len(result) > 0:
                graph_entity_data = result[0]
                domain = graph_entity_data.get("domain") or graph_entity_data.get("ambito") or "generale"
                log.debug(
                    "Entity found in FalkorDB graph for vote",
                    entity_id=issue.entity_id,
                    domain=domain,
                )
        except Exception as e:
            log.warning(
                "FalkorDB lookup failed during vote",
                entity_id=issue.entity_id,
                error=str(e),
            )

    # 4. Get voter authority
    voter_authority = await get_user_authority_for_vote(session, request.user_id, domain)

    # 5. Upsert vote (check if user already voted)
    vote_value = 1 if request.vote == "upvote" else -1

    existing_vote_stmt = select(EntityIssueVote).where(
        EntityIssueVote.issue_id == request.issue_id,
        EntityIssueVote.user_id == request.user_id,
    )
    existing_vote_result = await session.execute(existing_vote_stmt)
    existing_vote = existing_vote_result.scalar_one_or_none()

    if existing_vote:
        # Update existing vote
        old_value = existing_vote.vote_value
        old_authority = existing_vote.voter_authority

        # Remove old vote contribution from scores
        if old_value > 0:
            issue.upvote_score = (issue.upvote_score or 0.0) - old_authority
        else:
            issue.downvote_score = (issue.downvote_score or 0.0) - old_authority

        # Update vote
        existing_vote.vote_value = vote_value
        existing_vote.voter_authority = voter_authority
        existing_vote.comment = request.comment

        log.info("Updated existing vote", issue_id=request.issue_id, user_id=request.user_id)
    else:
        # Create new vote
        new_vote = EntityIssueVote(
            issue_id=request.issue_id,
            user_id=request.user_id,
            vote_value=vote_value,
            voter_authority=voter_authority,
            comment=request.comment,
        )
        session.add(new_vote)
        issue.votes_count = (issue.votes_count or 0) + 1

    # 6. Add new vote contribution to scores
    if vote_value > 0:
        issue.upvote_score = (issue.upvote_score or 0.0) + voter_authority
    else:
        issue.downvote_score = (issue.downvote_score or 0.0) + voter_authority

    await session.commit()

    # 7. Check thresholds
    entity_reopened = False
    new_status = IssueStatus.OPEN

    if issue.upvote_score >= ISSUE_THRESHOLDS["reopen_validation"]:
        # Issue valida - riapri entity per validazione
        issue.status = "threshold_reached"
        new_status = IssueStatus.THRESHOLD_REACHED

        if entity:
            # Entity exists in pending_entities - update status
            entity.validation_status = "needs_revision"
            entity.approval_score = 0.0
            entity.rejection_score = 0.0
            entity.consensus_reached = False
            entity.consensus_type = None
            entity_reopened = True

            log.info(
                "Entity reopened for validation due to issue",
                entity_id=issue.entity_id,
                issue_id=request.issue_id,
                upvote_score=issue.upvote_score,
            )
        elif graph_entity_data:
            # Entity is in graph but not in pending_entities
            # Create a new pending_entity entry with needs_revision status
            new_pending = PendingEntity(
                entity_id=issue.entity_id,
                entity_type=graph_entity_data.get("entity_type") or issue.entity_type or "unknown",
                entity_text=graph_entity_data.get("nome") or issue.entity_id,
                descrizione=graph_entity_data.get("descrizione") or f"Riaperto per issue: {issue.description[:100] if issue.description else ''}",
                ambito=domain,
                article_urn="",  # Will be populated if available
                fonte="issue_reopen",
                llm_confidence=0.0,
                validation_status="needs_revision",
                approval_score=0.0,
                rejection_score=0.0,
                consensus_reached=False,
                consensus_type=None,
            )
            session.add(new_pending)
            entity_reopened = True

            log.info(
                "Graph entity added to pending for revision due to issue",
                entity_id=issue.entity_id,
                issue_id=request.issue_id,
                upvote_score=issue.upvote_score,
            )

    elif issue.downvote_score >= abs(ISSUE_THRESHOLDS["dismiss_issue"]):
        # Issue non valida - dismissata
        issue.status = "dismissed"
        new_status = IssueStatus.DISMISSED

        log.info(
            "Issue dismissed",
            issue_id=request.issue_id,
            downvote_score=issue.downvote_score,
        )

    await session.commit()

    message = ""
    if entity_reopened:
        message = "L'entita' e' tornata in validazione per revisione."
    elif new_status == IssueStatus.DISMISSED:
        message = "Issue dismissata dalla community."
    else:
        message = "Voto registrato."

    return VoteIssueResponse(
        success=True,
        issue_id=request.issue_id,
        new_status=new_status,
        upvote_score=issue.upvote_score or 0.0,
        downvote_score=issue.downvote_score or 0.0,
        votes_count=issue.votes_count or 0,
        entity_reopened=entity_reopened,
        message=message,
    )


@router.get(
    "/entity-issues/{entity_id}",
    response_model=GetEntityIssuesResponse,
    summary="Lista issue per un'entita'",
)
async def get_entity_issues(
    entity_id: str,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> GetEntityIssuesResponse:
    """
    Ritorna tutte le issue associate a un'entita'.

    Utile per:
    - Mostrare issue aperte nel NodeDetailsPanel
    - Controllare se un'entita' ha problemi segnalati
    """
    log.info("API: get_entity_issues", entity_id=entity_id)

    # Query issues for this entity
    stmt = (
        select(EntityIssueReport)
        .where(EntityIssueReport.entity_id == entity_id)
        .order_by(EntityIssueReport.created_at.desc())
    )
    result = await session.execute(stmt)
    issues = result.scalars().all()

    # Convert to response format
    issue_data = []
    open_count = 0

    for issue in issues:
        if issue.status == "open":
            open_count += 1

        issue_data.append(
            EntityIssueData(
                issue_id=issue.issue_id,
                entity_id=issue.entity_id,
                entity_type=issue.entity_type,
                issue_type=IssueType(issue.issue_type),
                severity=IssueSeverity(issue.severity),
                description=issue.description or "",
                status=IssueStatus(issue.status),
                reported_by=issue.reported_by,
                reporter_authority=issue.reporter_authority or 0.0,
                upvote_score=issue.upvote_score or 0.0,
                downvote_score=issue.downvote_score or 0.0,
                votes_count=issue.votes_count or 0,
                created_at=issue.created_at,
                resolved_at=issue.resolved_at,
                resolution_notes=issue.resolution_notes,
            )
        )

    log.info(
        "Retrieved entity issues",
        entity_id=entity_id,
        total=len(issue_data),
        open=open_count,
    )

    return GetEntityIssuesResponse(
        entity_id=entity_id,
        issues=issue_data,
        open_count=open_count,
        total_count=len(issue_data),
    )


# =============================================================================
# HELPER: Extract Readable Label from ID
# =============================================================================

def _extract_readable_label(entity_id: str) -> str:
    """
    Estrae un label leggibile da un entity_id.

    Esempi:
    - "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile~art1337"
      -> "Art. 1337 Codice Civile"
    - "massima_cassazione_civile_7288_2023"
      -> "Massima Cassazione Civile 7288/2023"
    - "concetto:legittima_difesa"
      -> "Legittima Difesa"
    """
    if not entity_id:
        return "(sconosciuto)"

    # Se è un URN normattiva, estrai articolo e codice
    if "normattiva.it" in entity_id or "urn:nir:" in entity_id:
        # Cerca pattern ~artXXX
        import re
        art_match = re.search(r'~art(\d+[a-z]*)', entity_id, re.IGNORECASE)
        if art_match:
            art_num = art_match.group(1)
            # Cerca il tipo di codice
            if "codice.civile" in entity_id:
                return f"Art. {art_num} c.c."
            elif "codice.penale" in entity_id:
                return f"Art. {art_num} c.p."
            elif "decreto" in entity_id:
                return f"Art. {art_num}"
            else:
                return f"Art. {art_num}"

    # Se è un ID massima/sentenza
    if "massima" in entity_id.lower() or "sentenza" in entity_id.lower():
        # massima_cassazione_civile_7288_2023 -> Cass. Civ. 7288/2023
        parts = entity_id.replace("_", " ").split()
        if len(parts) >= 3:
            # Cerca numeri per costruire riferimento
            nums = [p for p in parts if p.isdigit()]
            if len(nums) >= 2:
                return f"Cass. {nums[0]}/{nums[1]}"
            elif len(nums) == 1:
                return f"Cass. {nums[0]}"

    # Se è un concetto (concetto:nome)
    if ":" in entity_id and not entity_id.startswith("http"):
        parts = entity_id.split(":")
        if len(parts) >= 2:
            name = parts[-1].replace("_", " ").title()
            return name

    # Fallback: pulisci e tronca
    clean = entity_id.replace("_", " ").replace("-", " ")
    # Rimuovi URL prefix
    if clean.startswith("http"):
        clean = clean.split("/")[-1].split("?")[-1]
    # Capitalizza e tronca
    clean = clean.title()
    if len(clean) > 50:
        clean = clean[:47] + "..."
    return clean


# =============================================================================
# HELPER: Fetch Entity Details from Graph
# =============================================================================

async def fetch_entity_details_from_graph(
    entity_id: str,
    graph_client: FalkorDBClient,
) -> Optional[EntityDetailsForIssue]:
    """
    Recupera i dettagli di un'entita' dal Knowledge Graph per contestualizzare un'issue.

    Supporta sia nodi che relazioni. Per le relazioni, recupera anche source e target.
    """
    try:
        # Prima prova come nodo
        node_query = """
            MATCH (n)
            WHERE n.node_id = $entity_id
            RETURN
                labels(n)[0] as node_type,
                n.nome as nome,
                n.label as label,
                n.node_id as node_id,
                n.urn as urn,
                n.ambito as ambito,
                n.domain as domain,
                n.descrizione as descrizione,
                n.tipo as tipo,
                n.testo as testo
            LIMIT 1
        """
        result = await graph_client.query(node_query, {"entity_id": entity_id})

        if result and len(result) > 0:
            row = result[0]
            # Costruisci properties con i campi significativi
            properties = {}
            if row.get("descrizione"):
                properties["descrizione"] = str(row["descrizione"])[:200]  # Tronca
            if row.get("testo"):
                properties["testo"] = str(row["testo"])[:300]  # Tronca
            if row.get("tipo"):
                properties["tipo"] = row["tipo"]
            if row.get("domain"):
                properties["domain"] = row["domain"]

            return EntityDetailsForIssue(
                label=row.get("nome") or row.get("label") or row.get("node_id"),
                node_type=row.get("node_type"),
                urn=row.get("urn"),
                ambito=row.get("ambito") or row.get("domain"),
                properties=properties,
                is_relation=False,
            )

        # Se non trovato come nodo, prova come relazione
        # Il formato e': "rel_{source_id}_{rel_type}_{target_id}"
        if entity_id.startswith("rel_"):
            # Tutti i 65 tipi di relazione del Knowledge Graph (da RelationType enum)
            # Ordinati per lunghezza decrescente per matchare prima i più specifici
            known_rel_types = [
                # Relazioni lunghe (evita match parziali)
                "ABROGA_PARZIALMENTE", "ABROGA_TOTALMENTE",
                "VERSIONE_PRECEDENTE", "VERSIONE_SUCCESSIVA",
                "HA_COMPETENZA_SU", "GERARCHICAMENTE_SUPERIORE",
                "APPLICA_NORMA_A_CASO", "APPLICA_REGOLA",
                "ATTRIBUISCE_RESPONSABILITA", "RESPONSABILE_PER",
                "DEROGA_PRINCIPIO", "ESPRIME_PRINCIPIO",
                "PRODUCE_EFFETTO", "MODIFICA_EFFICACIA",
                "PRESUPPOSTO_DI", "COSTITUTIVO_DI",
                "PRECEDENTE_DI", "CONDIZIONE_DI", "CAUSA_DI",
                "PREVEDE_SANZIONE", "STABILISCE_TERMINE",
                "INCOMPATIBILE_CON", "COMPATIBILE_CON",
                "BILANCIA_CON", "CONFORMA_A", "CONFORME_A",
                "CLASSIFICA_IN", "TITOLARE_DI", "RIVESTE_RUOLO",
                # Relazioni medie
                "DIPENDE_DA", "PRESUPPONE", "HA_VERSIONE",
                "SOSTITUISCE", "INSERISCE", "SOSPENDE", "PROROGA",
                "DEROGA_A", "CONSOLIDA", "DISCIPLINA", "APPLICA_A",
                "DEFINISCE", "PREVEDE", "EMESSO_DA", "RIGUARDA",
                "IMPLICA", "CONTRADICE", "GIUSTIFICA", "LIMITA",
                "TUTELA", "VIOLA", "SPECIFICA", "ESEMPLIFICA",
                "ESTINGUE", "CONFERISCE", "CORRELATO",
                # Relazioni corte
                "CONTIENE", "PARTE_DI", "INTEGRA", "SPECIES",
                "CITA", "INTERPRETA", "COMMENTA", "ATTUA",
                "RECEPISCE", "FONTE", "IMPONE", "APPLICA",
                # Lowercase variants (per compatibilità)
                "interpreta", "cita", "applica", "disciplina",
                "definisce", "abroga", "modifica", "deroga",
                "rinvia", "sostituisce", "integra", "prevede",
            ]

            source_id = None
            rel_type = None
            target_id = None

            # Cerca il tipo di relazione nell'entity_id (case-insensitive)
            entity_without_prefix = entity_id[4:]  # Rimuovi "rel_"
            entity_lower = entity_without_prefix.lower()

            for rt in known_rel_types:
                separator_lower = f"_{rt.lower()}_"
                if separator_lower in entity_lower:
                    # Trova la posizione esatta nel testo originale
                    idx = entity_lower.find(separator_lower)
                    if idx != -1:
                        source_id = entity_without_prefix[:idx]
                        rel_type = rt.upper()  # Normalizza a uppercase
                        target_id = entity_without_prefix[idx + len(separator_lower):]
                        break

            if source_id and rel_type and target_id:
                log.debug(
                    "Parsed relation entity_id",
                    entity_id=entity_id,
                    source_id=source_id,
                    rel_type=rel_type,
                    target_id=target_id,
                )

                # Query per trovare i dettagli di source e target
                # Prova sia con node_id che con url/urn
                rel_query = """
                    MATCH (s), (t)
                    WHERE (s.node_id = $source_id OR s.url = $source_id OR s.urn = $source_id)
                      AND (t.node_id = $target_id OR t.url = $target_id OR t.urn = $target_id)
                    RETURN
                        labels(s)[0] as source_type,
                        s.nome as source_nome,
                        s.label as source_label,
                        s.node_id as source_node_id,
                        labels(t)[0] as target_type,
                        t.nome as target_nome,
                        t.label as target_label,
                        t.node_id as target_node_id
                    LIMIT 1
                """
                rel_result = await graph_client.query(
                    rel_query,
                    {"source_id": source_id, "target_id": target_id}
                )

                if rel_result and len(rel_result) > 0:
                    row = rel_result[0]
                    return EntityDetailsForIssue(
                        is_relation=True,
                        relation_type=rel_type,
                        source_label=row.get("source_nome") or row.get("source_label") or row.get("source_node_id") or source_id,
                        source_type=row.get("source_type"),
                        target_label=row.get("target_nome") or row.get("target_label") or row.get("target_node_id") or target_id,
                        target_type=row.get("target_type"),
                    )
                else:
                    # Nodi non trovati nel grafo, ritorna ID raw (frontend formatterà)
                    log.debug(
                        "Relation nodes not found in graph",
                        source_id=source_id,
                        target_id=target_id,
                    )
                    return EntityDetailsForIssue(
                        is_relation=True,
                        relation_type=rel_type,
                        source_label=source_id,  # Frontend usa formatUrnToReadable
                        source_type="Nodo",
                        target_label=target_id,  # Frontend usa formatUrnToReadable
                        target_type="Nodo",
                    )
            else:
                # Non siamo riusciti a parsare
                log.warning(
                    "Failed to parse relation entity_id",
                    entity_id=entity_id,
                    entity_without_prefix=entity_without_prefix,
                )
                return EntityDetailsForIssue(
                    is_relation=True,
                    relation_type="Unknown",
                    source_label="(non parsabile)",
                    source_type="Unknown",
                    target_label="(non parsabile)",
                    target_type="Unknown",
                )

        return None

    except Exception as e:
        log.warning("Failed to fetch entity details from graph", entity_id=entity_id, error=str(e))
        return None


@router.get(
    "/open-issues",
    response_model=OpenIssuesResponse,
    summary="Lista issue aperte (moderatori)",
)
async def get_open_issues(
    request: OpenIssuesRequest = Depends(),
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> OpenIssuesResponse:
    """
    Ritorna lista di issue aperte per moderazione.

    Supporta filtri per stato, gravita' e tipo.
    Include i dettagli delle entita' dal Knowledge Graph per contestualizzare.
    """
    log.info(
        "API: get_open_issues",
        status=request.status,
        severity=request.severity,
        issue_type=request.issue_type,
        limit=request.limit,
    )

    # Build query
    stmt = select(EntityIssueReport).order_by(EntityIssueReport.created_at.desc())

    if request.status:
        stmt = stmt.where(EntityIssueReport.status == request.status.value)
    if request.severity:
        stmt = stmt.where(EntityIssueReport.severity == request.severity.value)
    if request.issue_type:
        stmt = stmt.where(EntityIssueReport.issue_type == request.issue_type.value)

    # Get total count before pagination
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total_result = await session.execute(count_stmt)
    total = total_result.scalar() or 0

    # Apply pagination
    stmt = stmt.offset(request.offset).limit(request.limit + 1)  # +1 to check has_more

    result = await session.execute(stmt)
    issues = result.scalars().all()

    # Check if there are more
    has_more = len(issues) > request.limit
    if has_more:
        issues = issues[:-1]  # Remove the extra item

    # Fetch entity details from graph (in parallel)
    import asyncio
    graph_client = FalkorDBClient()
    await graph_client.connect()

    try:
        # Fetch all entity details in parallel
        entity_details_tasks = [
            fetch_entity_details_from_graph(issue.entity_id, graph_client)
            for issue in issues
        ]
        entity_details_list = await asyncio.gather(*entity_details_tasks)

        # Convert to response format with entity details
        issue_data = [
            EntityIssueData(
                issue_id=issue.issue_id,
                entity_id=issue.entity_id,
                entity_type=issue.entity_type,
                issue_type=IssueType(issue.issue_type),
                severity=IssueSeverity(issue.severity),
                description=issue.description or "",
                status=IssueStatus(issue.status),
                reported_by=issue.reported_by,
                reporter_authority=issue.reporter_authority or 0.0,
                upvote_score=issue.upvote_score or 0.0,
                downvote_score=issue.downvote_score or 0.0,
                votes_count=issue.votes_count or 0,
                created_at=issue.created_at,
                resolved_at=issue.resolved_at,
                resolution_notes=issue.resolution_notes,
                entity_details=entity_details,
            )
            for issue, entity_details in zip(issues, entity_details_list)
        ]
    finally:
        await graph_client.close()

    log.info("Retrieved open issues with entity details", total=total, returned=len(issue_data))

    return OpenIssuesResponse(
        issues=issue_data,
        total=total,
        has_more=has_more,
    )


# =============================================================================
# DOSSIER TRAINING SET EXPORT (R5)
# =============================================================================

from merlt.api.models.enrichment_models import (
    DossierArticleData,
    DossierQASessionData,
    DossierAnnotationData,
    DossierTrainingSetExportRequest,
    DossierTrainingSetExportResponse,
    LoadDossierTrainingRequest,
    LoadDossierTrainingResponse,
)
from merlt.experts.models import QATrace, QAFeedback


@router.post(
    "/dossier-training-export",
    response_model=DossierTrainingSetExportResponse,
    summary="Esporta dossier come training set RLCF",
)
async def export_dossier_training_set(
    request: DossierTrainingSetExportRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DossierTrainingSetExportResponse:
    """
    Esporta un dossier utente come training set per RLCF.

    Il training set include:
    - Articoli curati nel dossier (con status utente)
    - Sessioni Q&A collegate agli articoli (se richiesto)
    - Annotazioni utente (se richieste)

    Questo formato e' ideale per:
    1. Fine-tuning degli Expert
    2. Training del retriever
    3. Miglioramento Knowledge Graph

    Args:
        request: Configurazione export (dossier_id, opzioni)

    Returns:
        Training set completo in formato strutturato
    """
    from uuid import uuid4

    log.info(
        "API: export_dossier_training_set",
        dossier_id=request.dossier_id,
        user_id=request.user_id,
        include_qa=request.include_qa_sessions,
        include_annotations=request.include_annotations,
    )

    # Generate training set ID
    training_set_id = f"ts_{uuid4().hex[:12]}"

    # Note: The dossier data comes from VisuaLex frontend (localStorage)
    # This endpoint receives the dossier content in the request body
    # For now, we create a minimal response structure
    # In production, this would be enhanced with Q&A session lookup

    articles: List[DossierArticleData] = []
    qa_sessions: List[DossierQASessionData] = []
    annotations: List[DossierAnnotationData] = []

    # If Q&A sessions are requested, look them up by article URNs
    if request.include_qa_sessions:
        # In a real implementation, we'd query QATrace by article URNs
        # For now, we return an empty list as the dossier data comes from frontend
        pass

    # Placeholder response - in production, VisuaLex would send the full dossier content
    response = DossierTrainingSetExportResponse(
        training_set_id=training_set_id,
        dossier_id=request.dossier_id,
        dossier_title="Exported Dossier",
        dossier_description=None,
        dossier_tags=[],
        articles=articles,
        qa_sessions=qa_sessions,
        annotations=annotations,
        exported_by=request.user_id,
        articles_count=len(articles),
        qa_sessions_count=len(qa_sessions),
        annotations_count=len(annotations),
        completed_articles=0,
        avg_qa_confidence=0.0,
    )

    log.info(
        "Dossier training set exported",
        training_set_id=training_set_id,
        articles=len(articles),
        qa_sessions=len(qa_sessions),
        annotations=len(annotations),
    )

    return response


@router.post(
    "/dossier-training-export-full",
    response_model=DossierTrainingSetExportResponse,
    summary="Esporta dossier completo come training set",
)
async def export_dossier_training_set_full(
    dossier_title: str,
    dossier_description: Optional[str] = None,
    dossier_tags: List[str] = [],
    articles: List[Dict[str, Any]] = [],
    user_id: str = "anonymous",
    include_qa_sessions: bool = True,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DossierTrainingSetExportResponse:
    """
    Esporta dossier completo con contenuti da VisuaLex.

    VisuaLex invia il contenuto completo del dossier (articoli, note, status)
    e questo endpoint:
    1. Converte nel formato training set
    2. Cerca sessioni Q&A correlate (per article URN)
    3. Ritorna training set strutturato

    Args:
        dossier_title: Titolo del dossier
        articles: Lista articoli dal dossier [{tipo_atto, numero_articolo, ...}]
        user_id: ID utente proprietario
        include_qa_sessions: Se cercare Q&A collegate

    Returns:
        Training set completo
    """
    from uuid import uuid4
    from datetime import timezone

    log.info(
        "API: export_dossier_training_set_full",
        dossier_title=dossier_title,
        articles_count=len(articles),
        user_id=user_id,
    )

    training_set_id = f"ts_{uuid4().hex[:12]}"
    dossier_id = f"dossier_{uuid4().hex[:8]}"

    # Convert articles to DossierArticleData
    article_data: List[DossierArticleData] = []
    article_urns: List[str] = []

    for art in articles:
        urn = art.get("urn")
        if urn:
            article_urns.append(urn)

        article_data.append(DossierArticleData(
            urn=urn,
            tipo_atto=art.get("tipo_atto", "unknown"),
            numero_atto=art.get("numero_atto"),
            numero_articolo=str(art.get("numero_articolo", "")),
            data=art.get("data"),
            article_text=art.get("article_text") if True else None,
            user_status=art.get("status"),
        ))

    # Look up Q&A sessions for these articles
    qa_sessions: List[DossierQASessionData] = []
    avg_confidence = 0.0

    if include_qa_sessions and article_urns:
        # Query QATrace where sources contain any of our article URNs
        # This is a simplification - in production we'd do a proper JSON query
        stmt = select(QATrace).where(
            QATrace.user_id == user_id
        ).order_by(QATrace.created_at.desc()).limit(100)

        result = await session.execute(stmt)
        traces = result.scalars().all()

        # Filter traces that reference our articles
        confidences = []
        for trace in traces:
            if trace.sources:
                trace_urns = [s.get("article_urn", "") for s in trace.sources if isinstance(s, dict)]
                if any(urn in trace_urns for urn in article_urns):
                    # Get feedback for this trace
                    feedback_stmt = select(QAFeedback).where(
                        QAFeedback.trace_id == trace.trace_id
                    ).limit(1)
                    feedback_result = await session.execute(feedback_stmt)
                    feedback = feedback_result.scalar_one_or_none()

                    feedback_data = None
                    if feedback:
                        feedback_data = {
                            "inline_rating": feedback.inline_rating,
                            "retrieval_score": feedback.retrieval_score,
                            "reasoning_score": feedback.reasoning_score,
                            "synthesis_score": feedback.synthesis_score,
                            "preferred_expert": feedback.preferred_expert,
                        }

                    qa_sessions.append(DossierQASessionData(
                        trace_id=trace.trace_id,
                        query=trace.query,
                        synthesis=trace.synthesis_text or "",
                        mode=trace.synthesis_mode or "convergent",
                        experts_used=trace.selected_experts or [],
                        confidence=trace.confidence if hasattr(trace, 'confidence') and trace.confidence else 0.0,
                        feedback=feedback_data,
                        created_at=trace.created_at,
                    ))
                    confidences.append(trace.confidence if hasattr(trace, 'confidence') and trace.confidence else 0.0)

        if confidences:
            avg_confidence = sum(confidences) / len(confidences)

    # Count completed articles
    completed = sum(1 for a in article_data if a.user_status == "done")

    response = DossierTrainingSetExportResponse(
        training_set_id=training_set_id,
        dossier_id=dossier_id,
        dossier_title=dossier_title,
        dossier_description=dossier_description,
        dossier_tags=dossier_tags,
        articles=article_data,
        qa_sessions=qa_sessions,
        annotations=[],  # Annotations would come from VisuaLex
        exported_by=user_id,
        articles_count=len(article_data),
        qa_sessions_count=len(qa_sessions),
        annotations_count=0,
        completed_articles=completed,
        avg_qa_confidence=avg_confidence,
    )

    log.info(
        "Full dossier training set exported",
        training_set_id=training_set_id,
        articles=len(article_data),
        qa_sessions=len(qa_sessions),
        completed=completed,
    )

    return response


@router.post(
    "/load-dossier-training",
    response_model=LoadDossierTrainingResponse,
    summary="Carica training set nel buffer RLCF",
)
async def load_dossier_training_set(
    request: LoadDossierTrainingRequest,
    api_key: ApiKey = Depends(verify_api_key),
) -> LoadDossierTrainingResponse:
    """
    Carica un training set esportato nel buffer RLCF.

    Il training set viene convertito in esperienze per il
    TrainingScheduler. Le esperienze dai dossier curati
    hanno priorita' elevata perche' rappresentano dati
    di alta qualita' (studio umano verificato).

    Args:
        request: Training set e configurazione caricamento

    Returns:
        Statistiche caricamento e stato buffer
    """
    from merlt.rlcf.training_scheduler import get_scheduler

    log.info(
        "API: load_dossier_training_set",
        training_set_id=request.training_set.training_set_id,
        articles=request.training_set.articles_count,
        qa_sessions=request.training_set.qa_sessions_count,
        priority_boost=request.priority_boost,
    )

    scheduler = get_scheduler()
    experiences_added = 0

    # Convert Q&A sessions with feedback to experiences
    for qa in request.training_set.qa_sessions:
        if qa.feedback:
            # Create experience from Q&A session
            trace_data = {
                "trace_id": qa.trace_id,
                "query": qa.query,
                "synthesis": qa.synthesis,
                "mode": qa.mode,
                "experts_used": qa.experts_used,
            }

            feedback_data = qa.feedback

            # Calculate reward from feedback
            reward = 0.0
            if isinstance(feedback_data, dict):
                if feedback_data.get("inline_rating"):
                    reward = (feedback_data["inline_rating"] - 3) / 2  # Map 1-5 to -1..1

                # Boost from detailed scores
                scores = [
                    feedback_data.get("retrieval_score"),
                    feedback_data.get("reasoning_score"),
                    feedback_data.get("synthesis_score"),
                ]
                valid_scores = [s for s in scores if s is not None]
                if valid_scores:
                    avg_score = sum(valid_scores) / len(valid_scores)
                    reward = (reward + (avg_score * 2 - 1)) / 2  # Blend with detailed

            # Apply priority boost for curated dossier data
            td_error = 0.5 + request.priority_boost

            exp_id = scheduler.add_experience(
                trace=trace_data,
                feedback=feedback_data,
                reward=reward,
                td_error=td_error,
                metadata={
                    "source": "dossier",
                    "training_set_id": request.training_set.training_set_id,
                    "dossier_title": request.training_set.dossier_title,
                },
            )

            if exp_id:
                experiences_added += 1

    stats = scheduler.get_buffer_stats()
    training_ready = scheduler.should_train()

    log.info(
        "Dossier training set loaded",
        experiences_added=experiences_added,
        buffer_size=stats.size,
        training_ready=training_ready,
    )

    return LoadDossierTrainingResponse(
        success=True,
        experiences_added=experiences_added,
        buffer_size=stats.size,
        training_ready=training_ready,
        message=f"Caricate {experiences_added} esperienze da dossier '{request.training_set.dossier_title}'",
    )


# =============================================================================
# NER FEEDBACK (R6 - Citation NER Training) with RLCF Integration
# =============================================================================
@router.post(
    "/ner-feedback",
    response_model=NERFeedbackResponse,
    summary="Invia feedback NER su citazione con RLCF integration",
)
async def submit_ner_feedback(
    request: NERFeedbackRequest,
    api_key: ApiKey = Depends(verify_api_key),
) -> NERFeedbackResponse:
    """
    Registra feedback NER su una citazione giuridica.

    Integrato con sistema RLCF:
    - Calcola authority utente
    - Salva nel buffer NER (in-memory)
    - Persiste nel database RLCF (cronologia)
    - Aggiorna track record utente

    Workflow:
    1. Utente seleziona citazione in CitationPreview
    2. Corregge/conferma il parsing
    3. Feedback salvato nel buffer + database RLCF
    4. Authority utente aggiornata
    5. Quando buffer >= 50, training_ready=True

    Tipi feedback:
    - correction: Parsing errato, utente corregge
    - confirmation: Parsing corretto, utente conferma
    - annotation: Nuova citazione annotata manualmente

    Args:
        request: Dati feedback NER

    Returns:
        Statistiche buffer, stato training, e info authority
    """
    from merlt.rlcf.ner_rlcf_integration import get_ner_rlcf_integration

    log.info(
        "API: submit_ner_feedback (RLCF integrated)",
        user_id=request.user_id,
        article_urn=request.article_urn,
        feedback_type=request.feedback_type,
        selected_text=request.selected_text[:50],
    )

    integration = get_ner_rlcf_integration()

    # Process with RLCF integration
    result = await integration.process_ner_feedback(
        user_id=request.user_id,
        article_urn=request.article_urn,
        selected_text=request.selected_text,
        context_window=request.context_window,
        feedback_type=request.feedback_type,
        correct_reference=request.correct_reference,
        original_parsed=request.original_parsed,
        confidence_before=request.confidence_before,
        source=request.source,
    )

    log.info(
        "NER feedback registered with RLCF",
        feedback_id=result.feedback_id,
        buffer_size=result.buffer_size,
        training_ready=result.training_ready,
        user_authority=result.user_authority,
        persisted_to_db=result.persisted_to_db,
    )

    return NERFeedbackResponse(
        success=result.success,
        feedback_id=result.feedback_id,
        buffer_size=result.buffer_size,
        training_ready=result.training_ready,
        training_triggered=False,
        patterns_updated=0,
        message=result.message,
        # Extended info
        user_authority=result.user_authority,
        authority_breakdown=result.authority_breakdown,
    )


@router.post(
    "/ner-feedback-confirm",
    response_model=NERFeedbackResponse,
    summary="Conferma citazione corretta (shortcut) con RLCF",
)
async def confirm_citation(
    request: NERConfirmRequest,
    api_key: ApiKey = Depends(verify_api_key),
) -> NERFeedbackResponse:
    """
    Shortcut per confermare una citazione correttamente parsata.

    Usato quando utente clicca "Corretto" in CitationPreview.
    Equivalente a submit_ner_feedback con feedback_type="confirmation".

    Integrato con RLCF per tracciamento authority e cronologia.

    Args:
        request: Dati della citazione confermata

    Returns:
        Statistiche buffer e info authority
    """
    from merlt.rlcf.ner_rlcf_integration import get_ner_rlcf_integration

    log.info(
        "API: confirm_citation (RLCF integrated)",
        user_id=request.user_id,
        article_urn=request.article_urn,
        text=request.text[:50],
    )

    integration = get_ner_rlcf_integration()

    # Process confirmation with RLCF
    result = await integration.process_ner_feedback(
        user_id=request.user_id,
        article_urn=request.article_urn,
        selected_text=request.text,
        context_window=request.text,  # In UI reale: 500 char prima/dopo
        feedback_type="confirmation",
        correct_reference=request.parsed,
        original_parsed=request.parsed,
        confidence_before=1.0,
        source="citation_preview",
    )

    return NERFeedbackResponse(
        success=result.success,
        feedback_id=result.feedback_id,
        buffer_size=result.buffer_size,
        training_ready=result.training_ready,
        training_triggered=False,
        patterns_updated=0,
        message=result.message,
        user_authority=result.user_authority,
        authority_breakdown=result.authority_breakdown,
    )


# =============================================================================
# NER FEEDBACK HISTORY & STATS
# =============================================================================
@router.get(
    "/ner-feedback/history",
    summary="Cronologia feedback NER utente",
)
async def get_ner_feedback_history(
    user_id: str,
    limit: int = 20,
    offset: int = 0,
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Recupera cronologia feedback NER per un utente.

    Args:
        user_id: ID utente
        limit: Numero massimo risultati (default 20)
        offset: Offset per paginazione

    Returns:
        Lista di feedback NER con dettagli
    """
    from merlt.rlcf.ner_rlcf_integration import get_ner_rlcf_integration

    integration = get_ner_rlcf_integration()
    history = await integration.get_user_ner_history(
        user_id=user_id,
        limit=limit,
        offset=offset,
    )

    return {
        "success": True,
        "user_id": user_id,
        "count": len(history),
        "offset": offset,
        "limit": limit,
        "history": [item.to_dict() for item in history],
    }


@router.get(
    "/ner-feedback/history/all",
    summary="Cronologia globale feedback NER",
)
async def get_all_ner_feedback_history(
    limit: int = 50,
    offset: int = 0,
    feedback_type: Optional[str] = None,
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Recupera cronologia globale feedback NER.

    Args:
        limit: Numero massimo risultati (default 50)
        offset: Offset per paginazione
        feedback_type: Filtra per tipo (correction/confirmation/annotation)

    Returns:
        Lista di feedback NER con dettagli e conteggio totale
    """
    from merlt.rlcf.ner_rlcf_integration import get_ner_rlcf_integration

    integration = get_ner_rlcf_integration()
    history, total = await integration.get_all_ner_history(
        limit=limit,
        offset=offset,
        feedback_type=feedback_type,
    )

    return {
        "success": True,
        "total": total,
        "count": len(history),
        "offset": offset,
        "limit": limit,
        "feedback_type_filter": feedback_type,
        "history": [item.to_dict() for item in history],
    }


@router.get(
    "/ner-feedback/stats",
    summary="Statistiche feedback NER",
)
async def get_ner_feedback_stats(
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Statistiche aggregate feedback NER.

    Returns:
        Dict con statistiche:
        - total_feedback: Totale feedback
        - buffer_stats: Stato buffer in-memory
        - authority_stats: Distribuzione authority
        - by_domain: Count per dominio giuridico
    """
    from merlt.rlcf.ner_rlcf_integration import get_ner_rlcf_integration

    integration = get_ner_rlcf_integration()
    stats = await integration.get_ner_feedback_stats()

    return {
        "success": True,
        **stats,
    }


# =============================================================================
# EXPORTS
# =============================================================================
__all__ = ["router"]
