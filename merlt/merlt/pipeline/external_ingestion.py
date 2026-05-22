"""
External Ingestion Pipeline
============================

Wrapper per IngestionPipelineV2 che gestisce ingestion da fonti esterne (es. VisuaLex).

Funzionalità:
- Auto-approvazione basata su authority e trigger
- Preview del grafo prima dell'ingestion
- Gestione pending validations per community review
- Tracciamento provenance (chi ha contribuito cosa)

Workflow:
1. Riceve richiesta esterna (ExternalIngestionRequest)
2. Valuta se auto-approvare o richiedere validazione community
3. Se auto-approved: esegue ingestion via IngestionPipelineV2
4. Se pending: salva in coda validazione
5. Ritorna IngestionResponse con preview

Esempio:
    >>> from merlt.pipeline.external_ingestion import ExternalIngestionPipeline
    >>> from merlt.api.models.ingestion import ExternalIngestionRequest, IngestionTrigger
    >>>
    >>> pipeline = ExternalIngestionPipeline(falkordb_client, bridge_table)
    >>> request = ExternalIngestionRequest(
    ...     source="visualex",
    ...     user_id="uuid-123",
    ...     user_authority=0.65,
    ...     tipo_atto="codice civile",
    ...     articolo="1337",
    ...     trigger=IngestionTrigger.SEARCH_NOT_FOUND,
    ... )
    >>> response = await pipeline.process(request)
    >>> print(response.status)  # "auto_approved" o "pending_validation"
"""

import structlog
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from merlt.api.models.ingestion import (
    ExternalIngestionRequest,
    IngestionResponse,
    IngestionStatus,
    IngestionTrigger,
    GraphPreview,
    GraphNodePreview,
    GraphRelationPreview,
    SuggestedRelation,
    CODICI_PRINCIPALI,
    AUTHORITY_AUTO_APPROVE_THRESHOLD,
    DEFAULT_REQUIRED_APPROVALS,
    PENDING_VALIDATION_TIMEOUT_DAYS,
)
from merlt.pipeline.ingestion import IngestionPipelineV2, IngestionResult
from merlt.pipeline.visualex import VisualexClient, VisualexArticle

log = structlog.get_logger()


# =============================================================================
# AUTO-APPROVAZIONE LOGIC
# =============================================================================

def evaluate_ingestion_request(
    request: ExternalIngestionRequest,
) -> Tuple[IngestionStatus, str]:
    """
    Valuta se auto-approvare una richiesta di ingestion.

    Criteri di auto-approvazione:
    1. Utente con authority >= 0.7
    2. Articolo da codice principale + trigger search_not_found
    3. Cross-reference esplicito nel testo

    Args:
        request: Richiesta di ingestion

    Returns:
        Tupla (status, reason) che indica se approvare o meno
    """
    # CASO 1: High-authority user
    if request.user_authority >= AUTHORITY_AUTO_APPROVE_THRESHOLD:
        log.info(
            "Auto-approved: high authority user",
            user_id=request.user_id,
            authority=request.user_authority,
        )
        return IngestionStatus.AUTO_APPROVED, "high_authority_user"

    # CASO 2: Articolo standard da fonte ufficiale
    if request.trigger == IngestionTrigger.SEARCH_NOT_FOUND:
        tipo_atto_lower = request.tipo_atto.lower().strip()
        if tipo_atto_lower in CODICI_PRINCIPALI:
            log.info(
                "Auto-approved: standard code article",
                tipo_atto=request.tipo_atto,
                articolo=request.articolo,
            )
            return IngestionStatus.AUTO_APPROVED, "official_source_standard_code"

    # CASO 3: Cross-reference esplicito nel testo
    if request.trigger == IngestionTrigger.CROSS_REF_CLICK:
        log.info(
            "Auto-approved: explicit textual reference",
            articolo=request.articolo,
        )
        return IngestionStatus.AUTO_APPROVED, "explicit_textual_reference"

    # CASO 4: Relazione da dossier (community validation richiesta)
    if request.trigger in [
        IngestionTrigger.DOSSIER_GROUPING,
        IngestionTrigger.ANNOTATION,
    ]:
        log.info(
            "Pending validation: community review required",
            trigger=request.trigger.value,
        )
        return IngestionStatus.PENDING_VALIDATION, "community_validation_required"

    # DEFAULT: Community validation per sicurezza
    log.info(
        "Pending validation: default community review",
        user_authority=request.user_authority,
        trigger=request.trigger.value,
    )
    return IngestionStatus.PENDING_VALIDATION, "default_community_review"


def evaluate_relation_suggestion(
    relation: SuggestedRelation,
    user_authority: float,
) -> Tuple[IngestionStatus, str]:
    """
    Valuta se auto-approvare una relazione suggerita.

    Args:
        relation: Relazione suggerita
        user_authority: Authority dell'utente che suggerisce

    Returns:
        Tupla (status, reason)
    """
    # High authority user può aggiungere qualsiasi relazione
    if user_authority >= AUTHORITY_AUTO_APPROVE_THRESHOLD:
        return IngestionStatus.AUTO_APPROVED, "high_authority_user"

    # Cross-reference espliciti sono auto-approvati
    if relation.evidence == "cross_ref":
        return IngestionStatus.AUTO_APPROVED, "explicit_cross_reference"

    # Text extraction con alta confidenza
    if relation.evidence == "text_extraction" and relation.confidence >= 0.9:
        return IngestionStatus.AUTO_APPROVED, "high_confidence_extraction"

    # Tutto il resto richiede validazione community
    return IngestionStatus.PENDING_VALIDATION, "community_validation_required"


# =============================================================================
# PREVIEW GENERATION
# =============================================================================

@dataclass
class PreviewResult:
    """Risultato della generazione preview."""
    preview: GraphPreview
    existing_urns: set = field(default_factory=set)
    new_urns: set = field(default_factory=set)


async def generate_preview(
    request: ExternalIngestionRequest,
    falkordb_client: Any,
    visualex_client: Optional[VisualexClient] = None,
) -> PreviewResult:
    """
    Genera una preview del grafo che verrebbe creato/modificato.

    Args:
        request: Richiesta di ingestion
        falkordb_client: Client FalkorDB per verificare nodi esistenti
        visualex_client: Client VisuaLex per fetch articolo (opzionale)

    Returns:
        PreviewResult con preview e set di URN esistenti/nuovi
    """
    from merlt.utils import urngenerator

    preview = GraphPreview()
    existing_urns = set()
    new_urns = set()

    # Genera URN per l'articolo richiesto
    article_urn = urngenerator.generate_urn(
        act_type=request.tipo_atto,
        date=None,  # Sarà determinato da VisuaLex
        act_number=None,
        article=request.articolo,
        urn_flag=True,
    )

    # Verifica se articolo esiste già
    exists = await _check_node_exists(falkordb_client, article_urn)

    node_preview = GraphNodePreview(
        urn=article_urn,
        tipo="Norma",
        label=f"Art. {request.articolo} {_abbreviate_tipo_atto(request.tipo_atto)}",
        exists=exists,
    )

    if exists:
        preview.nodes_existing.append(node_preview)
        existing_urns.add(article_urn)
    else:
        preview.nodes_new.append(node_preview)
        new_urns.add(article_urn)

    # Processa relazioni suggerite
    for rel in request.suggested_relations:
        # Verifica esistenza nodi sorgente e target
        source_exists = await _check_node_exists(falkordb_client, rel.source_urn)
        target_exists = await _check_node_exists(falkordb_client, rel.target_urn)

        # Verifica se relazione esiste già
        rel_exists = await _check_relation_exists(
            falkordb_client,
            rel.source_urn,
            rel.target_urn,
            rel.relation_type.value,
        )

        # Valuta se richiede validazione
        status, _ = evaluate_relation_suggestion(rel, request.user_authority)
        requires_validation = status == IngestionStatus.PENDING_VALIDATION

        rel_preview = GraphRelationPreview(
            source_urn=rel.source_urn,
            target_urn=rel.target_urn,
            relation_type=rel.relation_type.value,
            exists=rel_exists,
            requires_validation=requires_validation,
            confidence=rel.confidence,
        )

        if rel_exists:
            # Relazione già esiste, skip
            pass
        elif requires_validation:
            preview.relations_pending.append(rel_preview)
        else:
            preview.relations_new.append(rel_preview)

    return PreviewResult(
        preview=preview,
        existing_urns=existing_urns,
        new_urns=new_urns,
    )


async def _check_node_exists(client: Any, urn: str) -> bool:
    """Verifica se un nodo esiste nel grafo."""
    if not client:
        return False

    try:
        results = await client.query(
            "MATCH (n {URN: $urn}) RETURN n.URN LIMIT 1",
            {"urn": urn}
        )
        return len(results) > 0
    except Exception as e:
        log.warning(f"Error checking node existence: {e}")
        return False


async def _check_relation_exists(
    client: Any,
    source_urn: str,
    target_urn: str,
    rel_type: str,
) -> bool:
    """Verifica se una relazione esiste nel grafo."""
    if not client:
        return False

    try:
        results = await client.query(
            f"""
            MATCH (a {{URN: $source}})-[r:{rel_type}]->(b {{URN: $target}})
            RETURN type(r) LIMIT 1
            """,
            {"source": source_urn, "target": target_urn}
        )
        return len(results) > 0
    except Exception as e:
        log.warning(f"Error checking relation existence: {e}")
        return False


def _abbreviate_tipo_atto(tipo_atto: str) -> str:
    """Abbrevia tipo atto per display."""
    abbrev = {
        "codice civile": "c.c.",
        "codice penale": "c.p.",
        "codice di procedura civile": "c.p.c.",
        "codice di procedura penale": "c.p.p.",
        "costituzione": "Cost.",
        "costituzione italiana": "Cost.",
    }
    return abbrev.get(tipo_atto.lower().strip(), tipo_atto)


# =============================================================================
# EXTERNAL INGESTION PIPELINE
# =============================================================================

class ExternalIngestionPipeline:
    """
    Pipeline per ingestion da fonti esterne.

    Gestisce:
    - Valutazione auto-approvazione
    - Preview del grafo
    - Ingestion effettiva (se approvata)
    - Creazione pending validation (se richiesta)
    - Tracciamento provenance

    Esempio:
        >>> pipeline = ExternalIngestionPipeline(
        ...     falkordb_client=falkordb,
        ...     bridge_table=bridge,
        ... )
        >>> response = await pipeline.process(request)
    """

    def __init__(
        self,
        falkordb_client: Any = None,
        bridge_table: Any = None,
        embedding_service: Any = None,
        visualex_base_url: str = "http://localhost:5100",
    ):
        """
        Inizializza pipeline.

        Args:
            falkordb_client: Client FalkorDB
            bridge_table: Bridge table service
            embedding_service: Servizio embeddings
            visualex_base_url: URL base API VisuaLex
        """
        self.falkordb = falkordb_client
        self.bridge_table = bridge_table
        self.embedding_service = embedding_service
        self.visualex_base_url = visualex_base_url

        # Pipeline interna per ingestion effettiva
        self._ingestion_pipeline = IngestionPipelineV2(
            falkordb_client=falkordb_client,
        )

        log.info(
            "ExternalIngestionPipeline initialized",
            has_falkordb=falkordb_client is not None,
            has_bridge=bridge_table is not None,
        )

    async def process(
        self,
        request: ExternalIngestionRequest,
        dry_run: bool = False,
    ) -> IngestionResponse:
        """
        Processa una richiesta di ingestion esterna.

        Args:
            request: Richiesta di ingestion
            dry_run: Se True, genera solo preview senza modificare il grafo

        Returns:
            IngestionResponse con risultato e preview
        """
        log.info(
            "Processing external ingestion request",
            source=request.source,
            user_id=request.user_id,
            tipo_atto=request.tipo_atto,
            articolo=request.articolo,
            trigger=request.trigger.value,
            dry_run=dry_run,
        )

        # Step 1: Genera preview
        preview_result = await generate_preview(
            request=request,
            falkordb_client=self.falkordb,
        )

        # Step 2: Valuta auto-approvazione
        status, reason = evaluate_ingestion_request(request)

        # Se dry_run, ritorna solo preview
        if dry_run:
            return IngestionResponse(
                success=True,
                status=status,
                reason=f"[DRY RUN] {reason}",
                preview=preview_result.preview,
            )

        # Step 3: Esegui in base allo status
        if status == IngestionStatus.AUTO_APPROVED:
            return await self._execute_approved_ingestion(
                request=request,
                preview_result=preview_result,
                reason=reason,
            )
        else:
            return await self._create_pending_validation(
                request=request,
                preview_result=preview_result,
                reason=reason,
            )

    async def _execute_approved_ingestion(
        self,
        request: ExternalIngestionRequest,
        preview_result: PreviewResult,
        reason: str,
    ) -> IngestionResponse:
        """
        Esegue ingestion auto-approvata.

        Args:
            request: Richiesta originale
            preview_result: Preview generata
            reason: Motivazione approvazione

        Returns:
            IngestionResponse con risultato
        """
        nodes_created = []
        relations_created = []
        errors = []
        article_urn = None

        try:
            # Step 1: Ottieni i dati dell'articolo
            if request.has_rich_data:
                # Usa i dati forniti nella richiesta (Schema Locked)
                log.info("Using rich data provided in request", article=request.articolo)
                
                # Convertiamo il payload ExternalIngestionRequest in un oggetto compatible con IngestionPipelineV2
                # In una versione futura, IngestionPipelineV2 dovrebbe accettare direttamente ExternalIngestionRequest
                from merlt.pipeline.visualex import VisualexArticle
                article = VisualexArticle(
                    tipo_atto=request.tipo_atto,
                    articolo=request.articolo,
                    testo=request.article_text,
                    url=request.url,
                    # Passiamo le info di brocardi nei metadati per ora
                    metadata={
                        "brocardi_info": {
                            "ratio": request.brocardi_info.ratio,
                            "spiegazione": request.brocardi_info.spiegazione,
                            "massime": [
                                {"corte": m.corte, "numero": m.numero, "estratto": m.estratto}
                                for m in request.brocardi_info.massime
                            ],
                            "position": request.brocardi_info.position,
                        },
                        "norma_metadata": {
                            "data": request.norma_data.norma.data,
                            "titolo": request.norma_data.norma.titolo,
                            "autorita": request.norma_data.norma.autorita_emanante,
                            "allegato": request.norma_data.allegato
                        }
                    }
                )
            else:
                # Fetch articolo da VisuaLex (fallback per richieste semplici)
                log.info("Fetching article from VisuaLex (simple request)", article=request.articolo)
                async with VisualexClient(base_url=self.visualex_base_url) as client:
                    article = await client.fetch_article(
                        act_type=request.tipo_atto,
                        article=request.articolo,
                    )

            # Step 2: Esegui ingestion effettiva
            result = await self._ingestion_pipeline.ingest_article(
                article=article,
                create_graph_nodes=True,
            )

            article_urn = result.article_urn
            nodes_created = result.nodes_created
            relations_created = result.relations_created

            # Aggiungi metadata provenance
            if self.falkordb:
                await self._add_provenance_metadata(
                    urn=article_urn,
                    contributed_by=request.user_id,
                    contribution_source=request.source,
                )

            # Processa relazioni suggerite approvate
            for rel in request.suggested_relations:
                rel_status, _ = evaluate_relation_suggestion(
                    rel, request.user_authority
                )
                if rel_status == IngestionStatus.AUTO_APPROVED:
                    try:
                        await self._create_relation(rel, request.user_id)
                        relations_created.append(
                            f"{rel.relation_type.value}:{rel.source_urn}->{rel.target_urn}"
                        )
                    except Exception as e:
                        errors.append(f"Relation creation failed: {e}")

            log.info(
                "Ingestion completed successfully",
                article_urn=article_urn,
                nodes_created=len(nodes_created),
                relations_created=len(relations_created),
            )

            return IngestionResponse(
                success=True,
                status=IngestionStatus.COMPLETED,
                reason=reason,
                preview=preview_result.preview,
                article_urn=article_urn,
                nodes_created=nodes_created,
                relations_created=relations_created,
                errors=errors,
            )

        except Exception as e:
            log.error(f"Ingestion failed: {e}")
            return IngestionResponse(
                success=False,
                status=IngestionStatus.FAILED,
                reason=str(e),
                preview=preview_result.preview,
                errors=[str(e)],
            )

    async def _create_pending_validation(
        self,
        request: ExternalIngestionRequest,
        preview_result: PreviewResult,
        reason: str,
    ) -> IngestionResponse:
        """
        Crea pending validation per community review.

        Args:
            request: Richiesta originale
            preview_result: Preview generata
            reason: Motivazione per pending

        Returns:
            IngestionResponse con pending_id
        """
        pending_id = str(uuid4())
        expires_at = datetime.now(timezone.utc) + timedelta(
            days=PENDING_VALIDATION_TIMEOUT_DAYS
        )

        # Salva pending validation nel grafo
        if self.falkordb:
            try:
                await self.falkordb.query(
                    """
                    CREATE (p:PendingValidation {
                        id: $id,
                        type: 'ingestion',
                        target_urn: $target_urn,
                        contributor_id: $contributor_id,
                        contributor_authority: $authority,
                        source: $source,
                        trigger: $trigger,
                        proposed_data: $data,
                        created_at: $created,
                        expires_at: $expires,
                        approvals: 0,
                        rejections: 0,
                        required_approvals: $required,
                        status: 'pending'
                    })
                    """,
                    {
                        "id": pending_id,
                        "target_urn": f"{request.tipo_atto}:{request.articolo}",
                        "contributor_id": request.user_id,
                        "authority": request.user_authority,
                        "source": request.source,
                        "trigger": request.trigger.value,
                        "data": str(request.metadata),
                        "created": datetime.now(timezone.utc).isoformat(),
                        "expires": expires_at.isoformat(),
                        "required": DEFAULT_REQUIRED_APPROVALS,
                    }
                )

                log.info(
                    "Created pending validation",
                    pending_id=pending_id,
                    contributor=request.user_id,
                )

            except Exception as e:
                log.error(f"Failed to create pending validation: {e}")

        return IngestionResponse(
            success=True,
            status=IngestionStatus.PENDING_VALIDATION,
            reason=reason,
            preview=preview_result.preview,
            pending_id=pending_id,
            required_approvals=DEFAULT_REQUIRED_APPROVALS,
        )

    async def _add_provenance_metadata(
        self,
        urn: str,
        contributed_by: str,
        contribution_source: str,
    ) -> None:
        """Aggiunge metadata di provenance a un nodo."""
        if not self.falkordb:
            return

        try:
            await self.falkordb.query(
                """
                MATCH (n {URN: $urn})
                SET n.contributed_by = $contributor,
                    n.contribution_source = $source,
                    n.validation_status = 'validated'
                """,
                {
                    "urn": urn,
                    "contributor": contributed_by,
                    "source": contribution_source,
                }
            )
        except Exception as e:
            log.warning(f"Failed to add provenance metadata: {e}")

    async def _create_relation(
        self,
        relation: SuggestedRelation,
        contributed_by: str,
    ) -> None:
        """Crea una relazione nel grafo."""
        if not self.falkordb:
            return

        cypher = f"""
            MATCH (a {{URN: $source_urn}})
            MATCH (b {{URN: $target_urn}})
            MERGE (a)-[r:{relation.relation_type.value}]->(b)
            ON CREATE SET
                r.created_at = $timestamp,
                r.contributed_by = $contributor,
                r.contribution_source = $evidence,
                r.confidence = $confidence,
                r.validation_status = 'validated'
        """

        await self.falkordb.query(cypher, {
            "source_urn": relation.source_urn,
            "target_urn": relation.target_urn,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "contributor": contributed_by,
            "evidence": relation.evidence,
            "confidence": relation.confidence,
        })


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "ExternalIngestionPipeline",
    "evaluate_ingestion_request",
    "evaluate_relation_suggestion",
    "generate_preview",
    "PreviewResult",
]
