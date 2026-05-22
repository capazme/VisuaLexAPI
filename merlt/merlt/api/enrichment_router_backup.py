"""
Enrichment API Router
=====================

FastAPI router per live enrichment e validazione granulare.

Endpoint:
- POST /enrichment/live - Live enrichment articolo
- POST /enrichment/validate-entity - Valida singola entita'
- POST /enrichment/validate-relation - Valida singola relazione
- POST /enrichment/propose-entity - Proponi nuova entita'
- POST /enrichment/propose-relation - Proponi nuova relazione
- GET /enrichment/pending - Lista pending per validazione
- POST /enrichment/extract-document - Estrai da documento uploadato
"""

import structlog
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, status

from merlt.api.models.enrichment_models import (
    DocumentExtractionRequest,
    DocumentExtractionResponse,
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
)
from merlt.pipeline.enrichment.models import EntityType, RelationType
from merlt.rlcf.entity_feedback import (
    AuthorityImpactCalculator,
    EntityValidationAggregator,
    EntityValidationFeedback,
    RelationValidationAggregator,
    RelationValidationFeedback,
)

log = structlog.get_logger()

router = APIRouter(prefix="/enrichment", tags=["enrichment"])

# =============================================================================
# IN-MEMORY STORAGE (da sostituire con Redis/PostgreSQL in produzione)
# =============================================================================

# Storage temporaneo per pending entities/relations
_pending_entities: Dict[str, PendingEntityData] = {}
_pending_relations: Dict[str, PendingRelationData] = {}

# Storage per voti
_entity_votes: Dict[str, List[EntityValidationFeedback]] = {}
_relation_votes: Dict[str, List[RelationValidationFeedback]] = {}

# Aggregators
_entity_aggregator = EntityValidationAggregator(approval_threshold=2.0)
_relation_aggregator = RelationValidationAggregator(approval_threshold=2.0)
_authority_calculator = AuthorityImpactCalculator()


# =============================================================================
# CHECK ARTICLE IN GRAPH
# =============================================================================

@router.get(
    "/check-article",
    summary="Verifica se un articolo e' nel knowledge graph",
    description="""
Controlla se un articolo specifico esiste gia' nel knowledge graph MERL-T.

Ritorna:
- `in_graph`: True se l'articolo e' presente
- `node_count`: Numero di nodi collegati all'articolo
- `has_entities`: True se esistono entita' estratte
- `last_updated`: Data ultimo aggiornamento (se presente)
    """,
)
async def check_article_in_graph(
    tipo_atto: str,
    articolo: str,
    numero_atto: Optional[str] = None,
    data: Optional[str] = None,
) -> Dict:
    """Verifica se un articolo esiste nel grafo."""
    log.info(
        "API: check_article_in_graph",
        tipo_atto=tipo_atto,
        articolo=articolo,
        numero_atto=numero_atto,
    )

    try:
        from merlt.storage.graph.client import FalkorDBClient

        client = FalkorDBClient()
        await client.connect()

        # Costruisci URN parziale per la ricerca
        urn_pattern = f"{tipo_atto.lower().replace(' ', '_')}%art_{articolo}"

        # Query per trovare l'articolo
        query = """
        MATCH (a:Articolo)
        WHERE toLower(a.urn) CONTAINS $pattern OR a.numero_articolo = $articolo
        OPTIONAL MATCH (a)-[r]->(e)
        RETURN a, count(DISTINCT e) as entity_count, max(a.updated_at) as last_updated
        LIMIT 1
        """

        result = await client.query(
            query,
            {"pattern": urn_pattern, "articolo": articolo}
        )

        if result and len(result) > 0 and result[0].get("a"):
            return {
                "in_graph": True,
                "node_count": result[0].get("entity_count", 0),
                "has_entities": result[0].get("entity_count", 0) > 0,
                "last_updated": result[0].get("last_updated"),
                "article_urn": result[0]["a"].get("urn") if result[0].get("a") else None,
            }

        # Articolo non trovato
        return {
            "in_graph": False,
            "node_count": 0,
            "has_entities": False,
            "last_updated": None,
            "article_urn": None,
        }

    except Exception as e:
        log.warning(f"Check article failed (non-critical): {e}")
        # In caso di errore, assumiamo non presente
        return {
            "in_graph": False,
            "node_count": 0,
            "has_entities": False,
            "last_updated": None,
            "article_urn": None,
            "error": str(e),
        }


# =============================================================================
# LIVE ENRICHMENT
# =============================================================================

@router.post(
    "/live",
    response_model=LiveEnrichmentResponse,
    summary="Live enrichment di un articolo",
    description="""
Esegue l'enrichment in tempo reale per un articolo:

1. **Scrape Normattiva** - Recupera testo ufficiale
2. **Fetch Brocardi** - Recupera ratio, spiegazione, brocardo
3. **LLM Extraction** - Estrae concetti, principi, definizioni

Ritorna le entita' estratte come "pending" per validazione umana granulare.
Ogni entita'/relazione puo' essere approvata, modificata o rifiutata.
    """,
)
async def live_enrich(request: LiveEnrichmentRequest) -> LiveEnrichmentResponse:
    """Esegue live enrichment per un articolo."""
    log.info(
        "API: live_enrich",
        tipo_atto=request.tipo_atto,
        articolo=request.articolo,
        user_id=request.user_id,
    )

    try:
        from merlt.pipeline.live_enrichment import LiveEnrichmentService

        service = LiveEnrichmentService()
        response = await service.enrich(request)

        # Salva pending in storage temporaneo
        for entity in response.pending_entities:
            _pending_entities[entity.id] = entity
            _entity_votes[entity.id] = []

        for relation in response.pending_relations:
            _pending_relations[relation.id] = relation
            _relation_votes[relation.id] = []

        return response

    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e),
        )
    except Exception as e:
        log.error(f"Live enrichment failed: {e}")
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
    description="""
Vota per approvare, rifiutare o modificare un'entita' pending.

Il voto e' pesato per l'authority dell'utente:
- authority 0.9 → voto vale 0.9
- authority 0.3 → voto vale 0.3

Threshold approvazione: Σ(weighted_votes) >= 2.0
    """,
)
async def validate_entity(
    request: EntityValidationRequest,
) -> EntityValidationResponse:
    """Valida una singola entita'."""
    entity_id = request.entity_id

    log.info(
        "API: validate_entity",
        entity_id=entity_id,
        vote=request.vote,
        user_id=request.user_id,
        user_authority=request.user_authority,
    )

    # Check entity exists
    if entity_id not in _pending_entities:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Entity {entity_id} not found",
        )

    entity = _pending_entities[entity_id]

    # Check not already finalized
    if entity.validation_status != ValidationStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Entity already {entity.validation_status.value}",
        )

    # Create feedback
    feedback = EntityValidationFeedback(
        entity_id=entity_id,
        entity_type=entity.tipo,
        vote=request.vote,
        suggested_edits=request.suggested_edits,
        reason=request.reason,
        user_id=request.user_id,
        user_authority=request.user_authority,
    )

    # Add to votes
    _entity_votes[entity_id].append(feedback)

    # Aggregate
    result = _entity_aggregator.aggregate(_entity_votes[entity_id])

    # Update entity
    entity.approval_score = sum(
        f.weighted_vote for f in _entity_votes[entity_id] if f.weighted_vote > 0
    )
    entity.rejection_score = abs(sum(
        f.weighted_vote for f in _entity_votes[entity_id] if f.weighted_vote < 0
    ))
    entity.votes_count = len(_entity_votes[entity_id])
    entity.validation_status = result.status

    # Apply edits if approved with modifications
    if result.status == ValidationStatus.APPROVED and result.merged_edits:
        for key, value in result.merged_edits.items():
            if hasattr(entity, key):
                setattr(entity, key, value)

    # Build response
    graph_node_id = None
    message = ""

    if result.status == ValidationStatus.APPROVED:
        # TODO: Write to FalkorDB
        graph_node_id = f"node:{entity.tipo.value}:{entity.nome.lower().replace(' ', '_')}"
        message = "Entita' approvata e aggiunta al knowledge graph"
    elif result.status == ValidationStatus.REJECTED:
        message = "Entita' rifiutata dalla community"
    else:
        progress = _entity_aggregator.get_progress(_entity_votes[entity_id])
        message = f"Voto registrato. Score: {progress['total_score']:.2f}/{progress['approval_threshold']}"

    return EntityValidationResponse(
        success=True,
        entity_id=entity_id,
        new_status=result.status,
        approval_score=entity.approval_score,
        rejection_score=entity.rejection_score,
        votes_count=entity.votes_count,
        message=message,
        graph_node_id=graph_node_id,
    )


# =============================================================================
# RELATION VALIDATION
# =============================================================================

@router.post(
    "/validate-relation",
    response_model=RelationValidationResponse,
    summary="Valida una singola relazione",
)
async def validate_relation(
    request: RelationValidationRequest,
) -> RelationValidationResponse:
    """Valida una singola relazione."""
    relation_id = request.relation_id

    log.info(
        "API: validate_relation",
        relation_id=relation_id,
        vote=request.vote,
        user_id=request.user_id,
    )

    if relation_id not in _pending_relations:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Relation {relation_id} not found",
        )

    relation = _pending_relations[relation_id]

    if relation.validation_status != ValidationStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Relation already {relation.validation_status.value}",
        )

    # Create feedback
    feedback = RelationValidationFeedback(
        relation_id=relation_id,
        relation_type=relation.relation_type,
        vote=request.vote,
        suggested_edits=request.suggested_edits,
        reason=request.reason,
        user_id=request.user_id,
        user_authority=request.user_authority,
    )

    _relation_votes[relation_id].append(feedback)

    # Aggregate
    result = _relation_aggregator.aggregate(_relation_votes[relation_id])

    # Update relation
    relation.approval_score = sum(
        f.weighted_vote for f in _relation_votes[relation_id] if f.weighted_vote > 0
    )
    relation.rejection_score = abs(sum(
        f.weighted_vote for f in _relation_votes[relation_id] if f.weighted_vote < 0
    ))
    relation.votes_count = len(_relation_votes[relation_id])
    relation.validation_status = result.status

    message = ""
    if result.status == ValidationStatus.APPROVED:
        message = "Relazione approvata e aggiunta al knowledge graph"
    elif result.status == ValidationStatus.REJECTED:
        message = "Relazione rifiutata dalla community"
    else:
        message = f"Voto registrato. Score: {result.score:.2f}/2.0"

    return RelationValidationResponse(
        success=True,
        relation_id=relation_id,
        new_status=result.status,
        approval_score=relation.approval_score,
        rejection_score=relation.rejection_score,
        votes_count=relation.votes_count,
        message=message,
    )


# =============================================================================
# ENTITY PROPOSAL
# =============================================================================

@router.post(
    "/propose-entity",
    response_model=EntityProposalResponse,
    summary="Proponi una nuova entita'",
    description="""
Permette agli utenti di proporre nuovi concetti/principi/definizioni
che non sono stati estratti automaticamente.

La proposta entra nella coda di validazione community.
    """,
)
async def propose_entity(
    request: EntityProposalRequest,
) -> EntityProposalResponse:
    """Proponi una nuova entita'."""
    log.info(
        "API: propose_entity",
        nome=request.nome,
        tipo=request.tipo,
        user_id=request.user_id,
    )

    # Create pending entity
    entity_id = f"proposal:{uuid4().hex[:12]}"

    entity = PendingEntityData(
        id=entity_id,
        nome=request.nome,
        tipo=request.tipo,
        descrizione=request.descrizione,
        articoli_correlati=request.articoli_correlati,
        ambito=request.ambito,
        fonte="user_proposal",
        llm_confidence=0.0,  # Non estratto da LLM
        raw_context=request.evidence,
        validation_status=ValidationStatus.PENDING,
        approval_score=0.0,
        rejection_score=0.0,
        votes_count=0,
        contributed_by=request.user_id,
        contributor_authority=request.user_authority,
    )

    # Save
    _pending_entities[entity_id] = entity
    _entity_votes[entity_id] = []

    return EntityProposalResponse(
        success=True,
        pending_entity=entity,
        message="Proposta inviata per validazione community",
    )


# =============================================================================
# RELATION PROPOSAL
# =============================================================================

@router.post(
    "/propose-relation",
    response_model=RelationProposalResponse,
    summary="Proponi una nuova relazione",
)
async def propose_relation(
    request: RelationProposalRequest,
) -> RelationProposalResponse:
    """Proponi una nuova relazione."""
    log.info(
        "API: propose_relation",
        source=request.source_urn,
        target=request.target_urn,
        type=request.relation_type,
        user_id=request.user_id,
    )

    relation_id = f"proposal:{uuid4().hex[:12]}"

    relation = PendingRelationData(
        id=relation_id,
        source_urn=request.source_urn,
        target_urn=request.target_urn,
        relation_type=request.relation_type,
        fonte="user_proposal",
        llm_confidence=0.0,
        evidence=request.evidence,
        validation_status=ValidationStatus.PENDING,
        approval_score=0.0,
        rejection_score=0.0,
        votes_count=0,
        contributed_by=request.user_id,
        contributor_authority=request.user_authority,
    )

    _pending_relations[relation_id] = relation
    _relation_votes[relation_id] = []

    return RelationProposalResponse(
        success=True,
        pending_relation=relation,
        message="Proposta inviata per validazione community",
    )


# =============================================================================
# PENDING QUEUE
# =============================================================================

@router.post(
    "/pending",
    response_model=PendingQueueResponse,
    summary="Lista pending per validazione",
    description="""
Ritorna la lista di entita' e relazioni pending su cui l'utente puo' votare.

Esclude le proprie proposte (a meno che include_own=True).
    """,
)
async def get_pending_queue(
    request: PendingQueueRequest,
) -> PendingQueueResponse:
    """Ritorna lista pending per validazione."""
    log.info(
        "API: get_pending_queue",
        user_id=request.user_id,
        include_own=request.include_own,
    )

    # Filter entities
    entities = []
    for entity in _pending_entities.values():
        if entity.validation_status != ValidationStatus.PENDING:
            continue
        if not request.include_own and entity.contributed_by == request.user_id:
            continue
        if request.entity_types and entity.tipo not in request.entity_types:
            continue

        # Check if user already voted
        voted = any(
            f.user_id == request.user_id
            for f in _entity_votes.get(entity.id, [])
        )
        if not voted:
            entities.append(entity)

    # Filter relations
    relations = []
    for relation in _pending_relations.values():
        if relation.validation_status != ValidationStatus.PENDING:
            continue
        if not request.include_own and relation.contributed_by == request.user_id:
            continue

        voted = any(
            f.user_id == request.user_id
            for f in _relation_votes.get(relation.id, [])
        )
        if not voted:
            relations.append(relation)

    # Paginate
    total_entities = len(entities)
    total_relations = len(relations)

    entities = entities[request.offset:request.offset + request.limit]
    relations = relations[request.offset:request.offset + request.limit]

    return PendingQueueResponse(
        pending_entities=entities,
        pending_relations=relations,
        total_entities=total_entities,
        total_relations=total_relations,
        user_can_vote=total_entities + total_relations,
    )


# =============================================================================
# DOCUMENT EXTRACTION
# =============================================================================

@router.post(
    "/extract-document",
    response_model=DocumentExtractionResponse,
    summary="Estrai entita' da documento uploadato",
    description="""
Estrae entita' da un documento caricato dall'utente.

Supporta: PDF, DOCX, TXT, MD

Le entita' estratte entrano nella coda di validazione.
    """,
)
async def extract_document(
    request: DocumentExtractionRequest,
) -> DocumentExtractionResponse:
    """Estrai entita' da documento uploadato."""
    log.info(
        "API: extract_document",
        filename=request.filename,
        file_type=request.file_type,
        user_id=request.user_id,
    )

    # TODO: Implementare estrazione da documento
    # 1. Decode base64
    # 2. Parse documento (PDF, DOCX, TXT)
    # 3. Chunk il testo
    # 4. Estrai entita' con LLM
    # 5. Converti in pending

    document_id = f"doc:{uuid4().hex[:12]}"

    # Per ora ritorna risposta vuota
    return DocumentExtractionResponse(
        success=True,
        document_id=document_id,
        entities_extracted=[],
        relations_extracted=[],
        extraction_status="not_implemented",
        authority_points_earned=0,
        message="Document extraction not yet implemented",
    )


# =============================================================================
# ADMIN STATS
# =============================================================================

@router.get(
    "/admin/stats",
    summary="Admin stats per validazioni",
    description="Ritorna statistiche globali su validazioni, entita', relazioni.",
)
async def get_admin_stats() -> Dict:
    """Ritorna statistiche admin per la dashboard."""
    # Entity stats
    total_entities = len(_pending_entities)
    pending_entity_count = sum(
        1 for e in _pending_entities.values()
        if e.validation_status == ValidationStatus.PENDING
    )
    approved_entity_count = sum(
        1 for e in _pending_entities.values()
        if e.validation_status == ValidationStatus.APPROVED
    )
    rejected_entity_count = sum(
        1 for e in _pending_entities.values()
        if e.validation_status == ValidationStatus.REJECTED
    )

    # Relation stats
    total_relations = len(_pending_relations)
    pending_relation_count = sum(
        1 for r in _pending_relations.values()
        if r.validation_status == ValidationStatus.PENDING
    )
    approved_relation_count = sum(
        1 for r in _pending_relations.values()
        if r.validation_status == ValidationStatus.APPROVED
    )
    rejected_relation_count = sum(
        1 for r in _pending_relations.values()
        if r.validation_status == ValidationStatus.REJECTED
    )

    # Vote stats
    total_entity_votes = sum(len(votes) for votes in _entity_votes.values())
    total_relation_votes = sum(len(votes) for votes in _relation_votes.values())

    # Entity type distribution
    entity_type_counts: Dict[str, int] = {}
    for e in _pending_entities.values():
        tipo = e.tipo.value if hasattr(e.tipo, 'value') else str(e.tipo)
        entity_type_counts[tipo] = entity_type_counts.get(tipo, 0) + 1

    # Top contributors
    contributor_counts: Dict[str, int] = {}
    for e in _pending_entities.values():
        if e.contributed_by:
            contributor_counts[e.contributed_by] = contributor_counts.get(e.contributed_by, 0) + 1
    for r in _pending_relations.values():
        if r.contributed_by:
            contributor_counts[r.contributed_by] = contributor_counts.get(r.contributed_by, 0) + 1

    top_contributors = sorted(
        contributor_counts.items(),
        key=lambda x: x[1],
        reverse=True
    )[:10]

    # Recent pending items
    recent_entities = sorted(
        [e for e in _pending_entities.values() if e.validation_status == ValidationStatus.PENDING],
        key=lambda x: x.votes_count,
        reverse=True
    )[:20]

    recent_relations = sorted(
        [r for r in _pending_relations.values() if r.validation_status == ValidationStatus.PENDING],
        key=lambda x: x.votes_count,
        reverse=True
    )[:10]

    # Calculate approval rate
    total_validated = approved_entity_count + rejected_entity_count + approved_relation_count + rejected_relation_count
    approval_rate = (approved_entity_count + approved_relation_count) / total_validated if total_validated > 0 else 0.0

    # Vote type breakdown (approximate from feedback if available)
    approve_votes = sum(
        1 for votes in _entity_votes.values()
        for v in votes if v.vote == "approve"
    ) + sum(
        1 for votes in _relation_votes.values()
        for v in votes if v.vote == "approve"
    )
    reject_votes = sum(
        1 for votes in _entity_votes.values()
        for v in votes if v.vote == "reject"
    ) + sum(
        1 for votes in _relation_votes.values()
        for v in votes if v.vote == "reject"
    )
    edit_votes = sum(
        1 for votes in _entity_votes.values()
        for v in votes if v.vote == "edit"
    ) + sum(
        1 for votes in _relation_votes.values()
        for v in votes if v.vote == "edit"
    )

    return {
        "summary": {
            "total_entities": total_entities,
            "total_relations": total_relations,
            "total_votes": total_entity_votes + total_relation_votes,
            "pending_validations": pending_entity_count + pending_relation_count,
            "approval_rate": approval_rate,
            "avg_time_to_approval_hours": 0.0,  # TODO: Calculate from timestamps
        },
        "entities": {
            "pending": pending_entity_count,
            "approved": approved_entity_count,
            "rejected": rejected_entity_count,
            "by_type": entity_type_counts,
        },
        "relations": {
            "pending": pending_relation_count,
            "approved": approved_relation_count,
            "rejected": rejected_relation_count,
        },
        "votes": {
            "total": total_entity_votes + total_relation_votes,
            "today": 0,  # TODO: Calculate from timestamps
            "this_week": 0,  # TODO: Calculate from timestamps
            "by_type": {
                "approve": approve_votes,
                "reject": reject_votes,
                "edit": edit_votes,
            },
        },
        "top_contributors": [
            {"user_id": uid, "contributions": count}
            for uid, count in top_contributors
        ],
        "pending_entities": [
            {
                "id": e.id,
                "nome": e.nome,
                "tipo": e.tipo.value if hasattr(e.tipo, 'value') else str(e.tipo),
                "approval_score": e.approval_score,
                "rejection_score": e.rejection_score,
                "votes_count": e.votes_count,
                "llm_confidence": e.llm_confidence,
                "contributed_by": e.contributed_by,
                "contributor_authority": e.contributor_authority,
            }
            for e in recent_entities
        ],
        "pending_relations": [
            {
                "id": r.id,
                "source_urn": r.source_urn,
                "target_urn": r.target_urn,
                "relation_type": r.relation_type.value if hasattr(r.relation_type, 'value') else str(r.relation_type),
                "approval_score": r.approval_score,
                "rejection_score": r.rejection_score,
                "votes_count": r.votes_count,
                "llm_confidence": r.llm_confidence,
                "contributed_by": r.contributed_by,
            }
            for r in recent_relations
        ],
    }


@router.get(
    "/admin/pending-list",
    summary="Lista completa pending per admin",
    description="Ritorna lista completa di tutte le entita'/relazioni pending.",
)
async def get_admin_pending_list(
    limit: int = 50,
    offset: int = 0,
    entity_type: Optional[str] = None,
    sort_by: str = "votes_count",
) -> Dict:
    """Ritorna lista completa pending per admin."""
    # Filter entities
    entities = list(_pending_entities.values())
    if entity_type:
        entities = [e for e in entities if str(e.tipo.value if hasattr(e.tipo, 'value') else e.tipo) == entity_type]

    # Filter only pending
    entities = [e for e in entities if e.validation_status == ValidationStatus.PENDING]

    # Sort
    if sort_by == "votes_count":
        entities.sort(key=lambda x: x.votes_count, reverse=True)
    elif sort_by == "approval_score":
        entities.sort(key=lambda x: x.approval_score, reverse=True)
    elif sort_by == "llm_confidence":
        entities.sort(key=lambda x: x.llm_confidence, reverse=True)

    # Paginate
    total = len(entities)
    entities = entities[offset:offset + limit]

    # Relations
    relations = [r for r in _pending_relations.values() if r.validation_status == ValidationStatus.PENDING]
    relations.sort(key=lambda x: x.votes_count, reverse=True)
    relations = relations[:limit]

    return {
        "entities": [
            {
                "id": e.id,
                "nome": e.nome,
                "tipo": e.tipo.value if hasattr(e.tipo, 'value') else str(e.tipo),
                "descrizione": e.descrizione,
                "articoli_correlati": e.articoli_correlati,
                "ambito": e.ambito,
                "fonte": e.fonte,
                "llm_confidence": e.llm_confidence,
                "approval_score": e.approval_score,
                "rejection_score": e.rejection_score,
                "votes_count": e.votes_count,
                "contributed_by": e.contributed_by,
                "contributor_authority": e.contributor_authority,
                "votes": [
                    {
                        "vote": v.vote,
                        "user_id": v.user_id,
                        "user_authority": v.user_authority,
                        "weighted_vote": v.weighted_vote,
                    }
                    for v in _entity_votes.get(e.id, [])
                ],
            }
            for e in entities
        ],
        "relations": [
            {
                "id": r.id,
                "source_urn": r.source_urn,
                "target_urn": r.target_urn,
                "relation_type": r.relation_type.value if hasattr(r.relation_type, 'value') else str(r.relation_type),
                "fonte": r.fonte,
                "llm_confidence": r.llm_confidence,
                "evidence": r.evidence,
                "approval_score": r.approval_score,
                "rejection_score": r.rejection_score,
                "votes_count": r.votes_count,
                "contributed_by": r.contributed_by,
                "votes": [
                    {
                        "vote": v.vote,
                        "user_id": v.user_id,
                        "user_authority": v.user_authority,
                        "weighted_vote": v.weighted_vote,
                    }
                    for v in _relation_votes.get(r.id, [])
                ],
            }
            for r in relations
        ],
        "total_entities": total,
        "total_relations": len([r for r in _pending_relations.values() if r.validation_status == ValidationStatus.PENDING]),
    }


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = ["router"]
