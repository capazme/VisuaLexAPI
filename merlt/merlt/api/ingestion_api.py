"""
Ingestion API
=============

FastAPI router per ingestion da fonti esterne (es. VisuaLex).

Endpoint:
- POST /ingestion/process - Processa richiesta di ingestion
- POST /ingestion/preview - Genera solo preview (dry-run)
- GET /ingestion/pending - Lista pending validations
- POST /ingestion/validate - Valida una pending ingestion

Esempio:
    >>> from fastapi import FastAPI
    >>> from merlt.api.ingestion_api import router
    >>>
    >>> app = FastAPI()
    >>> app.include_router(router, prefix="/api/v1")
"""

import structlog
from typing import Dict, List, Optional, Any
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel, Field, ConfigDict

from merlt.api.models.ingestion import (
    ExternalIngestionRequest,
    IngestionResponse,
    IngestionStatus,
    IngestionTrigger,
    SuggestedRelation,
    RelationType,
    GraphPreview,
    AUTHORITY_AUTO_APPROVE_THRESHOLD,
    DEFAULT_REQUIRED_APPROVALS,
)
from merlt.pipeline.external_ingestion import (
    ExternalIngestionPipeline,
    evaluate_ingestion_request,
    generate_preview,
)

log = structlog.get_logger()

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


# =============================================================================
# PYDANTIC MODELS (per FastAPI validation)
# =============================================================================

class SuggestedRelationModel(BaseModel):
    """Relazione proposta dall'utente (Pydantic model)."""
    source_urn: str = Field(..., description="URN del nodo sorgente")
    target_urn: str = Field(..., description="URN del nodo destinazione")
    relation_type: str = Field(
        ...,
        description="Tipo di relazione",
        examples=["RIFERIMENTO", "RELATED_TO", "CITATO_DA"]
    )
    evidence: str = Field(
        ...,
        description="Evidenza che supporta la relazione",
        examples=["cross_ref", "dossier_grouping", "user_annotation", "text_extraction"]
    )
    confidence: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="Confidenza nella relazione (0-1)"
    )


class IngestionRequestModel(BaseModel):
    """
    Richiesta di ingestion da fonte esterna (Pydantic model).

    Usata per validazione input FastAPI.
    """
    source: str = Field(
        ...,
        description="Identificatore fonte",
        examples=["visualex", "manual"]
    )
    user_id: str = Field(..., description="UUID dell'utente (SSO condiviso)")
    user_authority: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Authority score dell'utente (0-1)"
    )

    tipo_atto: str = Field(
        ...,
        description="Tipo di atto normativo",
        examples=["codice civile", "codice penale", "costituzione"]
    )
    articolo: str = Field(
        ...,
        description="Numero dell'articolo",
        examples=["1337", "52", "2043"]
    )

    trigger: str = Field(
        ...,
        description="Evento che ha triggerato la richiesta",
        examples=["search_not_found", "cross_ref_click", "dossier_grouping", "annotation", "manual"]
    )

    suggested_relations: List[SuggestedRelationModel] = Field(
        default_factory=list,
        description="Relazioni suggerite dall'utente"
    )

    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Metadati aggiuntivi"
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "source": "visualex",
                "user_id": "550e8400-e29b-41d4-a716-446655440000",
                "user_authority": 0.65,
                "tipo_atto": "codice civile",
                "articolo": "1337",
                "trigger": "search_not_found",
                "suggested_relations": [],
                "metadata": {}
            }
        }
    )


class IngestionResponseModel(BaseModel):
    """Risposta ingestion (Pydantic model)."""
    success: bool
    status: str = Field(..., examples=["auto_approved", "pending_validation", "completed", "failed"])
    reason: str

    # Preview
    preview: Dict[str, Any]

    # Se pending
    pending_id: Optional[str] = None
    required_approvals: int = 0

    # Se completato
    article_urn: Optional[str] = None
    nodes_created: List[str] = Field(default_factory=list)
    relations_created: List[str] = Field(default_factory=list)

    # Errori
    errors: List[str] = Field(default_factory=list)

    # Timestamp
    processed_at: str


class ValidationVoteModel(BaseModel):
    """Voto di validazione."""
    pending_id: str = Field(..., description="ID della pending validation")
    voter_id: str = Field(..., description="UUID del votante")
    voter_authority: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Authority del votante"
    )
    vote: bool = Field(..., description="True=approva, False=rifiuta")
    reason: Optional[str] = Field(None, description="Motivazione (opzionale)")


class PendingValidationModel(BaseModel):
    """Pending validation."""
    id: str
    type: str
    target_urn: str
    contributor_id: str
    contributor_authority: float
    source: str
    trigger: str
    created_at: str
    expires_at: str
    approvals: float
    rejections: float
    required_approvals: int
    status: str


# =============================================================================
# DEPENDENCY INJECTION
# =============================================================================

# Pipeline singleton (inizializzata al primo uso)
_pipeline: Optional[ExternalIngestionPipeline] = None


async def get_pipeline() -> ExternalIngestionPipeline:
    """
    Dependency injection per ExternalIngestionPipeline.

    La pipeline viene inizializzata lazy al primo uso.
    In produzione, i client vengono iniettati dalla configurazione.
    """
    global _pipeline

    if _pipeline is None:
        # Import lazy per evitare circular imports
        from merlt.storage.graph.client import FalkorDBClient
        from merlt.storage.graph.config import FalkorDBConfig

        # Inizializza connessioni (in produzione da config)
        config = FalkorDBConfig()
        falkordb_client = FalkorDBClient(config)
        await falkordb_client.connect()

        _pipeline = ExternalIngestionPipeline(
            falkordb_client=falkordb_client,
        )

        log.info("IngestionAPI pipeline initialized")

    return _pipeline


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post(
    "/process",
    response_model=IngestionResponseModel,
    summary="Processa richiesta di ingestion",
    description="""
    Processa una richiesta di ingestion da fonte esterna.

    Il sistema valuta automaticamente se auto-approvare la richiesta o
    richiedere validazione dalla community.

    **Criteri auto-approvazione:**
    - Utente con authority >= 0.7
    - Articolo da codice principale (c.c., c.p., Cost.) + trigger search_not_found
    - Cross-reference esplicito nel testo

    **Risultati possibili:**
    - `auto_approved` → L'articolo è stato aggiunto al knowledge graph
    - `pending_validation` → In attesa di approvazione community
    - `completed` → Ingestion completata con successo
    - `failed` → Errore durante l'ingestion
    """,
)
async def process_ingestion(
    request: IngestionRequestModel,
    pipeline: ExternalIngestionPipeline = Depends(get_pipeline),
) -> IngestionResponseModel:
    """
    Processa una richiesta di ingestion.
    """
    log.info(
        "API: process_ingestion called",
        source=request.source,
        user_id=request.user_id,
        tipo_atto=request.tipo_atto,
        articolo=request.articolo,
    )

    try:
        # Converti Pydantic model a dataclass
        suggested_relations = [
            SuggestedRelation(
                source_urn=rel.source_urn,
                target_urn=rel.target_urn,
                relation_type=RelationType(rel.relation_type),
                evidence=rel.evidence,
                confidence=rel.confidence,
            )
            for rel in request.suggested_relations
        ]

        ingestion_request = ExternalIngestionRequest(
            source=request.source,
            user_id=request.user_id,
            user_authority=request.user_authority,
            tipo_atto=request.tipo_atto,
            articolo=request.articolo,
            trigger=IngestionTrigger(request.trigger),
            suggested_relations=suggested_relations,
            metadata=request.metadata,
        )

        # Processa richiesta
        response = await pipeline.process(ingestion_request)

        return IngestionResponseModel(
            success=response.success,
            status=response.status.value,
            reason=response.reason,
            preview=response.preview.to_dict(),
            pending_id=response.pending_id,
            required_approvals=response.required_approvals,
            article_urn=response.article_urn,
            nodes_created=response.nodes_created,
            relations_created=response.relations_created,
            errors=response.errors,
            processed_at=response.processed_at.isoformat(),
        )

    except ValueError as e:
        log.error(f"Invalid request: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Ingestion processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/preview",
    response_model=IngestionResponseModel,
    summary="Genera preview ingestion (dry-run)",
    description="""
    Genera una preview del grafo che verrebbe creato, senza modificare il database.

    Utile per mostrare all'utente cosa succederà prima di confermare l'ingestion.
    """,
)
async def preview_ingestion(
    request: IngestionRequestModel,
    pipeline: ExternalIngestionPipeline = Depends(get_pipeline),
) -> IngestionResponseModel:
    """
    Genera preview senza eseguire ingestion.
    """
    log.info(
        "API: preview_ingestion called",
        tipo_atto=request.tipo_atto,
        articolo=request.articolo,
    )

    try:
        # Converti Pydantic model a dataclass
        suggested_relations = [
            SuggestedRelation(
                source_urn=rel.source_urn,
                target_urn=rel.target_urn,
                relation_type=RelationType(rel.relation_type),
                evidence=rel.evidence,
                confidence=rel.confidence,
            )
            for rel in request.suggested_relations
        ]

        ingestion_request = ExternalIngestionRequest(
            source=request.source,
            user_id=request.user_id,
            user_authority=request.user_authority,
            tipo_atto=request.tipo_atto,
            articolo=request.articolo,
            trigger=IngestionTrigger(request.trigger),
            suggested_relations=suggested_relations,
            metadata=request.metadata,
        )

        # Processa in dry-run mode
        response = await pipeline.process(ingestion_request, dry_run=True)

        return IngestionResponseModel(
            success=response.success,
            status=response.status.value,
            reason=response.reason,
            preview=response.preview.to_dict(),
            pending_id=response.pending_id,
            required_approvals=response.required_approvals,
            article_urn=response.article_urn,
            nodes_created=response.nodes_created,
            relations_created=response.relations_created,
            errors=response.errors,
            processed_at=response.processed_at.isoformat(),
        )

    except ValueError as e:
        log.error(f"Invalid request: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        log.error(f"Preview generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/pending",
    response_model=List[PendingValidationModel],
    summary="Lista pending validations",
    description="""
    Recupera la lista delle ingestion in attesa di validazione.

    Filtri opzionali:
    - `status`: Filtra per stato (pending, approved, rejected, expired)
    - `limit`: Numero massimo di risultati
    - `exclude_voter`: Escludi pending già votate da questo user_id
    """,
)
async def list_pending_validations(
    status: Optional[str] = Query(None, description="Filtra per stato"),
    limit: int = Query(20, ge=1, le=100, description="Limite risultati"),
    exclude_voter: Optional[str] = Query(None, description="Escludi pending già votate da questo user"),
    pipeline: ExternalIngestionPipeline = Depends(get_pipeline),
) -> List[PendingValidationModel]:
    """
    Lista pending validations.
    """
    log.info(
        "API: list_pending_validations called",
        status=status,
        limit=limit,
        exclude_voter=exclude_voter,
    )

    try:
        # Query pending validations
        cypher = """
            MATCH (p:PendingValidation)
            WHERE 1=1
        """

        params = {"limit": limit}

        if status:
            cypher += " AND p.status = $status"
            params["status"] = status
        else:
            cypher += " AND p.status = 'pending'"

        if exclude_voter:
            cypher += """
                AND NOT EXISTS {
                    MATCH (v:ValidationVote {pending_id: p.id, voter_id: $voter_id})
                }
            """
            params["voter_id"] = exclude_voter

        cypher += """
            RETURN p
            ORDER BY p.created_at DESC
            LIMIT $limit
        """

        results = await pipeline.falkordb.query(cypher, params)

        pending_list = []
        for row in results:
            p = row.get("p", {}).get("properties", {})
            pending_list.append(PendingValidationModel(
                id=p.get("id", ""),
                type=p.get("type", "ingestion"),
                target_urn=p.get("target_urn", ""),
                contributor_id=p.get("contributor_id", ""),
                contributor_authority=float(p.get("contributor_authority", 0)),
                source=p.get("source", ""),
                trigger=p.get("trigger", ""),
                created_at=p.get("created_at", ""),
                expires_at=p.get("expires_at", ""),
                approvals=float(p.get("approvals", 0)),
                rejections=float(p.get("rejections", 0)),
                required_approvals=int(p.get("required_approvals", DEFAULT_REQUIRED_APPROVALS)),
                status=p.get("status", "pending"),
            ))

        return pending_list

    except Exception as e:
        log.error(f"Failed to list pending validations: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/validate",
    summary="Valida una pending ingestion",
    description="""
    Aggiunge un voto di validazione a una pending ingestion.

    Il voto è pesato per l'authority del votante:
    - Voto di utente con authority 0.9 vale 0.9
    - Voto di utente con authority 0.3 vale 0.3

    Quando la somma dei voti positivi supera la soglia (default 2.0),
    l'ingestion viene automaticamente approvata e eseguita.
    """,
)
async def validate_pending(
    vote: ValidationVoteModel,
    pipeline: ExternalIngestionPipeline = Depends(get_pipeline),
) -> Dict[str, Any]:
    """
    Valida una pending ingestion.
    """
    log.info(
        "API: validate_pending called",
        pending_id=vote.pending_id,
        voter_id=vote.voter_id,
        vote=vote.vote,
    )

    try:
        # Verifica che pending esista e sia ancora pending
        check_result = await pipeline.falkordb.query(
            "MATCH (p:PendingValidation {id: $id, status: 'pending'}) RETURN p",
            {"id": vote.pending_id}
        )

        if not check_result:
            raise HTTPException(
                status_code=404,
                detail=f"Pending validation {vote.pending_id} not found or already processed"
            )

        # Verifica che utente non abbia già votato
        vote_check = await pipeline.falkordb.query(
            """
            MATCH (v:ValidationVote {pending_id: $pending_id, voter_id: $voter_id})
            RETURN v
            """,
            {"pending_id": vote.pending_id, "voter_id": vote.voter_id}
        )

        if vote_check:
            raise HTTPException(
                status_code=400,
                detail="User has already voted on this pending validation"
            )

        # Crea voto
        from uuid import uuid4
        vote_id = str(uuid4())

        await pipeline.falkordb.query(
            """
            CREATE (v:ValidationVote {
                id: $vote_id,
                pending_id: $pending_id,
                voter_id: $voter_id,
                voter_authority: $authority,
                vote: $vote,
                reason: $reason,
                created_at: $timestamp
            })
            """,
            {
                "vote_id": vote_id,
                "pending_id": vote.pending_id,
                "voter_id": vote.voter_id,
                "authority": vote.voter_authority,
                "vote": vote.vote,
                "reason": vote.reason or "",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )

        # Aggiorna conteggi
        if vote.vote:
            field = "approvals"
        else:
            field = "rejections"

        await pipeline.falkordb.query(
            f"""
            MATCH (p:PendingValidation {{id: $id}})
            SET p.{field} = p.{field} + $weight
            """,
            {"id": vote.pending_id, "weight": vote.voter_authority}
        )

        # Verifica se raggiunto threshold
        result = await pipeline.falkordb.query(
            """
            MATCH (p:PendingValidation {id: $id})
            RETURN p.approvals AS approvals,
                   p.rejections AS rejections,
                   p.required_approvals AS required
            """,
            {"id": vote.pending_id}
        )

        if result:
            approvals = float(result[0].get("approvals", 0))
            rejections = float(result[0].get("rejections", 0))
            required = float(result[0].get("required", DEFAULT_REQUIRED_APPROVALS))

            if approvals >= required:
                # Approva e esegui ingestion
                await pipeline.falkordb.query(
                    "MATCH (p:PendingValidation {id: $id}) SET p.status = 'approved'",
                    {"id": vote.pending_id}
                )

                # TODO: Trigger ingestion effettiva
                log.info(
                    "Pending validation approved",
                    pending_id=vote.pending_id,
                    approvals=approvals,
                )

                return {
                    "success": True,
                    "vote_recorded": True,
                    "pending_status": "approved",
                    "message": "Validation approved, ingestion will be executed",
                }

            elif rejections >= required:
                # Rifiuta
                await pipeline.falkordb.query(
                    "MATCH (p:PendingValidation {id: $id}) SET p.status = 'rejected'",
                    {"id": vote.pending_id}
                )

                log.info(
                    "Pending validation rejected",
                    pending_id=vote.pending_id,
                    rejections=rejections,
                )

                return {
                    "success": True,
                    "vote_recorded": True,
                    "pending_status": "rejected",
                    "message": "Validation rejected by community",
                }

        return {
            "success": True,
            "vote_recorded": True,
            "pending_status": "pending",
            "message": "Vote recorded, waiting for more votes",
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Validation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/article-exists/{tipo_atto}/{articolo}",
    summary="Verifica se articolo esiste nel KG",
    description="Verifica rapidamente se un articolo è già presente nel knowledge graph.",
)
async def check_article_exists(
    tipo_atto: str,
    articolo: str,
    pipeline: ExternalIngestionPipeline = Depends(get_pipeline),
) -> Dict[str, Any]:
    """
    Verifica se articolo esiste nel KG.
    """
    log.info(
        "API: check_article_exists called",
        tipo_atto=tipo_atto,
        articolo=articolo,
    )

    try:
        from merlt.utils import urngenerator

        article_urn = urngenerator.generate_urn(
            act_type=tipo_atto,
            date=None,
            act_number=None,
            article=articolo,
            urn_flag=True,
        )

        results = await pipeline.falkordb.query(
            "MATCH (n:Norma {URN: $urn}) RETURN n.URN, n.estremi LIMIT 1",
            {"urn": article_urn}
        )

        if results:
            return {
                "exists": True,
                "urn": results[0].get("n.URN"),
                "estremi": results[0].get("n.estremi"),
            }

        return {
            "exists": False,
            "urn": article_urn,
        }

    except Exception as e:
        log.error(f"Check failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "router",
    "IngestionRequestModel",
    "IngestionResponseModel",
    "SuggestedRelationModel",
    "ValidationVoteModel",
    "PendingValidationModel",
]
