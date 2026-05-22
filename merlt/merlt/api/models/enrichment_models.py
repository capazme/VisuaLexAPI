"""
Enrichment API Models
=====================

Pydantic models per gli endpoint di live enrichment e validazione granulare.

Questi modelli definiscono le strutture dati per:
- Live enrichment request/response
- Entity/Relation validation
- User proposals
- Document extraction
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

from merlt.pipeline.enrichment.models import EntityType, RelationType


# =============================================================================
# ENUMS
# =============================================================================

class ValidationStatus(str, Enum):
    """Status di validazione per entita' e relazioni."""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    NEEDS_REVISION = "needs_revision"  # Richiede edit prima di approvazione
    EXPIRED = "expired"


class VoteType(str, Enum):
    """Tipo di voto per validazione."""
    APPROVE = "approve"
    REJECT = "reject"
    EDIT = "edit"


# =============================================================================
# PENDING ENTITIES (da validare)
# =============================================================================

class PendingEntityData(BaseModel):
    """Entita' estratta in attesa di validazione."""
    id: str = Field(..., description="ID univoco dell'entita' pending")
    nome: str = Field(..., description="Nome dell'entita'")
    tipo: EntityType = Field(..., description="Tipo entita' (17 tipi)")
    descrizione: str = Field("", description="Descrizione dell'entita'")
    articoli_correlati: List[str] = Field(
        default_factory=list,
        description="URN degli articoli correlati"
    )
    ambito: str = Field("diritto_civile", description="Ambito giuridico")

    # Provenance
    fonte: str = Field(..., description="Fonte estrazione (brocardi, llm, manual)")
    llm_confidence: float = Field(
        1.0,
        ge=0.0,
        le=1.0,
        description="Confidenza LLM (0-1)"
    )
    raw_context: str = Field("", description="Contesto originale estrazione")

    # Validation state
    validation_status: ValidationStatus = Field(
        ValidationStatus.PENDING,
        description="Stato corrente validazione"
    )
    approval_score: float = Field(
        0.0,
        description="Somma pesata voti approvazione"
    )
    rejection_score: float = Field(
        0.0,
        description="Somma pesata voti rifiuto"
    )
    votes_count: int = Field(0, description="Numero totale voti")

    # Contributor
    contributed_by: str = Field(..., description="User ID del contributor")
    contributor_authority: float = Field(..., description="Authority del contributor")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


class PendingRelationData(BaseModel):
    """Relazione estratta in attesa di validazione."""
    id: str = Field(..., description="ID univoco della relazione pending")
    source_urn: str = Field(..., description="URN nodo sorgente")
    target_urn: str = Field(..., description="URN nodo target")
    relation_type: RelationType = Field(..., description="Tipo relazione")

    # Provenance
    fonte: str = Field(..., description="Fonte estrazione")
    llm_confidence: float = Field(1.0, ge=0.0, le=1.0)
    evidence: str = Field("", description="Evidenza testuale per la relazione")

    # Validation state
    validation_status: ValidationStatus = Field(ValidationStatus.PENDING)
    approval_score: float = Field(0.0)
    rejection_score: float = Field(0.0)
    votes_count: int = Field(0)

    # Contributor
    contributed_by: str = Field(..., description="User ID del contributor")
    contributor_authority: float = Field(...)
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


# =============================================================================
# ARTICLE DATA
# =============================================================================

class ArticleData(BaseModel):
    """Dati articolo per preview."""
    urn: str = Field(..., description="URN dell'articolo")
    tipo_atto: str = Field(..., description="Tipo di atto normativo")
    numero_articolo: str = Field(..., description="Numero articolo")
    rubrica: str = Field("", description="Rubrica/titolo articolo")
    testo_vigente: str = Field(..., description="Testo vigente completo")
    estremi: str = Field("", description="Estremi norma contenitore")
    url: str = Field("", description="URL Normattiva")


# =============================================================================
# GRAPH PREVIEW
# =============================================================================

class GraphNodePreview(BaseModel):
    """Nodo per preview grafo."""
    id: str
    label: str
    type: str  # EntityType.value o "ARTICOLO"
    status: ValidationStatus = ValidationStatus.PENDING
    confidence: float = 1.0


class GraphLinkPreview(BaseModel):
    """Link per preview grafo."""
    source: str
    target: str
    type: str  # RelationType.value
    status: ValidationStatus = ValidationStatus.PENDING


class GraphPreviewData(BaseModel):
    """Preview del grafo per visualizzazione D3.js."""
    nodes: List[GraphNodePreview] = Field(default_factory=list)
    links: List[GraphLinkPreview] = Field(default_factory=list)


# =============================================================================
# LIVE ENRICHMENT REQUEST/RESPONSE
# =============================================================================

class LiveEnrichmentRequest(BaseModel):
    """
    Request per live enrichment di un articolo.

    Avvia l'estrazione completa:
    1. Scrape Normattiva (testo ufficiale)
    2. Fetch Brocardi (ratio, spiegazione, brocardo)
    3. LLM extraction (concetti, principi, definizioni, relazioni)
    """
    tipo_atto: str = Field(
        ...,
        description="Tipo atto normativo",
        examples=["codice civile", "codice penale", "costituzione"]
    )
    articolo: str = Field(
        ...,
        description="Numero articolo",
        examples=["1337", "52", "2043"]
    )
    user_id: str = Field("anonymous", description="UUID utente VisuaLex")
    user_authority: float = Field(
        0.5,
        ge=0.0,
        le=1.0,
        description="Authority score utente (0-1)"
    )

    # Opzioni
    include_brocardi: bool = Field(
        True,
        description="Includere enrichment da Brocardi.it"
    )
    extract_entities: bool = Field(
        True,
        description="Estrarre entita' con LLM"
    )
    priority_types: Optional[List[EntityType]] = Field(
        None,
        description="Tipi entita' prioritari (default: tutti)"
    )
    article_text: Optional[str] = Field(
        None,
        description="Testo articolo gia' disponibile da VisuaLex; se presente evita il refetch da Normattiva"
    )
    article_urn: Optional[str] = Field(
        None,
        description="URN/URL articolo gia' disponibile da VisuaLex"
    )
    norma_data: Optional[Dict[str, Any]] = Field(
        None,
        description="Metadata articolo provenienti da VisuaLex"
    )


class LiveEnrichmentResponse(BaseModel):
    """
    Response con dati estratti per validazione granulare.

    Contiene:
    - Dati articolo
    - Lista entita' pending (validabili singolarmente)
    - Lista relazioni pending (validabili singolarmente)
    - Preview grafo per visualizzazione
    """
    success: bool = True
    article: ArticleData
    pending_entities: List[PendingEntityData] = Field(default_factory=list)
    pending_relations: List[PendingRelationData] = Field(default_factory=list)
    graph_preview: GraphPreviewData = Field(default_factory=GraphPreviewData)

    # Metadata
    extraction_time_ms: int = Field(0, description="Tempo estrazione in ms")
    sources_used: List[str] = Field(
        default_factory=list,
        description="Fonti utilizzate (normattiva, brocardi, llm)"
    )


# =============================================================================
# ENTITY VALIDATION
# =============================================================================

class EntityValidationRequest(BaseModel):
    """Request per validare una singola entita'."""
    entity_id: str = Field(..., description="ID dell'entita' pending")
    vote: VoteType = Field(..., description="Tipo di voto")
    suggested_edits: Optional[Dict[str, Any]] = Field(
        None,
        description="Modifiche suggerite (se vote=edit)"
    )
    reason: Optional[str] = Field(
        None,
        description="Motivazione del voto"
    )

    # User info
    user_id: str = Field(...)
    user_authority: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Authority utente (se None, calcolata automaticamente)"
    )


class EntityValidationResponse(BaseModel):
    """Response dopo validazione entita'."""
    success: bool = True
    entity_id: str
    new_status: ValidationStatus
    approval_score: float
    rejection_score: float
    votes_count: int
    message: str = Field("", description="Messaggio informativo")
    threshold_reached: bool = Field(
        False,
        description="True se il consenso e' stato raggiunto (approved o rejected)"
    )

    # Se approvata, ID nodo nel grafo
    graph_node_id: Optional[str] = None


# =============================================================================
# RELATION VALIDATION
# =============================================================================

class RelationValidationRequest(BaseModel):
    """Request per validare una singola relazione."""
    relation_id: str = Field(..., description="ID della relazione pending")
    vote: VoteType = Field(...)
    suggested_edits: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None

    user_id: str
    user_authority: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Authority utente (se None, calcolata automaticamente)"
    )


class RelationValidationResponse(BaseModel):
    """Response dopo validazione relazione."""
    success: bool = True
    relation_id: str
    new_status: ValidationStatus
    approval_score: float
    rejection_score: float
    votes_count: int
    message: str = ""
    threshold_reached: bool = Field(
        False,
        description="True se il consenso e' stato raggiunto (approved o rejected)"
    )


# =============================================================================
# ENTITY PROPOSAL
# =============================================================================

class EntityProposalRequest(BaseModel):
    """
    Request per proporre una nuova entita'.

    Permette agli utenti di suggerire concetti/principi/definizioni
    che non sono stati estratti automaticamente.
    """
    article_urn: str = Field(..., description="URN articolo correlato")
    nome: str = Field(..., description="Nome dell'entita' proposta")
    tipo: EntityType = Field(..., description="Tipo entita'")
    descrizione: str = Field(..., description="Descrizione dettagliata")
    articoli_correlati: List[str] = Field(
        default_factory=list,
        description="Altri articoli correlati"
    )
    ambito: str = Field(default="generale", description="Ambito giuridico")

    # Evidenza (opzionale per proposte manuali)
    evidence: str = Field(
        default="",
        description="Evidenza testuale/motivazione per la proposta"
    )
    source_reference: Optional[str] = Field(
        None,
        description="Riferimento fonte (es. 'Torrente, p.123')"
    )

    # User
    user_id: str
    # user_authority calcolata automaticamente nel backend

    # Deduplication
    skip_duplicate_check: bool = Field(
        False,
        description="Se True, salta il check duplicati (utente ha gia' visto i duplicati)"
    )
    acknowledged_duplicate_of: Optional[str] = Field(
        None,
        description="Se specificato, l'utente ha riconosciuto che questa e' simile all'entita' con questo ID"
    )


class EntityProposalResponse(BaseModel):
    """Response dopo proposta entita'."""
    success: bool = True
    pending_entity: Optional[PendingEntityData] = None
    message: str = "Proposta inviata per validazione community"

    # Deduplication warnings
    has_duplicates: bool = Field(
        False,
        description="True se sono stati trovati duplicati"
    )
    duplicates: List["DuplicateCandidateData"] = Field(
        default_factory=list,
        description="Lista duplicati trovati (se has_duplicates=True)"
    )
    duplicate_action_required: bool = Field(
        False,
        description="True se l'utente deve scegliere prima di procedere"
    )


# =============================================================================
# RELATION PROPOSAL
# =============================================================================

class RelationProposalRequest(BaseModel):
    """Request per proporre una nuova relazione."""
    source_urn: str = Field(..., description="URN entita'/nodo sorgente")
    target_entity_id: str = Field(..., description="ID entita' target o nome")
    tipo_relazione: RelationType = Field(..., description="Tipo relazione")
    article_urn: str = Field(..., description="URN articolo correlato")
    descrizione: str = Field(..., description="Motivazione/descrizione relazione")
    certezza: float = Field(default=0.7, ge=0.0, le=1.0, description="Livello certezza")

    # User
    user_id: str
    # user_authority calcolata automaticamente nel backend

    # Deduplication
    skip_duplicate_check: bool = Field(
        default=False,
        description="Se True, salta il check duplicati (usa dopo conferma utente)"
    )
    acknowledged_duplicate_of: Optional[str] = Field(
        default=None,
        description="ID del duplicato riconosciuto dall'utente"
    )


class RelationProposalResponse(BaseModel):
    """Response dopo proposta relazione."""
    success: bool = Field(default=True, description="True se la relazione e' stata creata")
    relation_id: Optional[str] = Field(default=None, description="ID della relazione proposta")
    message: str = "Proposta inviata per validazione community"

    # Deduplication
    has_duplicates: bool = Field(
        default=False,
        description="True se sono stati trovati duplicati"
    )
    duplicates: List["RelationDuplicateCandidateData"] = Field(
        default_factory=list,
        description="Lista di relazioni duplicate trovate"
    )
    duplicate_action_required: bool = Field(
        default=False,
        description="True se l'utente deve confermare prima di procedere"
    )


# =============================================================================
# DOCUMENT EXTRACTION
# =============================================================================

class DocumentExtractionRequest(BaseModel):
    """
    Request per estrarre entita' da documento uploadato.

    Supporta PDF, DOCX, TXT, MD.
    """
    article_urn: str = Field(..., description="URN articolo correlato")
    file_type: str = Field(
        ...,
        description="Tipo file",
        examples=["pdf", "docx", "txt", "md"]
    )
    content_base64: str = Field(..., description="Contenuto file in base64")
    filename: str = Field(..., description="Nome file originale")

    # Metadata documento
    document_title: Optional[str] = Field(None, description="Titolo documento")
    document_type: Optional[str] = Field(
        None,
        description="Tipo documento",
        examples=["manuale", "appunti", "articolo_dottrina"]
    )

    user_id: str
    user_authority: float = Field(..., ge=0.0, le=1.0)


class DocumentExtractionResponse(BaseModel):
    """Response con entita' estratte dal documento."""
    success: bool = True
    document_id: str = Field(..., description="ID documento salvato")

    # Estrazione
    entities_extracted: List[PendingEntityData] = Field(default_factory=list)
    relations_extracted: List[PendingRelationData] = Field(default_factory=list)
    extraction_status: str = Field("completed")

    # Punti
    authority_points_earned: int = Field(
        0,
        description="Punti authority guadagnati per upload"
    )
    message: str = ""


# =============================================================================
# PENDING QUEUE
# =============================================================================

class PendingQueueRequest(BaseModel):
    """Request per ottenere la coda di pending per un utente."""
    user_id: str = Field("anonymous", description="ID utente per escludere voti già espressi")
    legal_domain: Optional[str] = Field(
        None,
        description="Filtra per dominio giuridico (es. 'penale', 'civile')"
    )
    tipo_atto: Optional[str] = Field(
        None,
        description="Filtra per tipo atto normativo (es. 'codice civile', 'costituzione'). "
                    "Viene risolto internamente usando NORMATTIVA_URN_CODICI."
    )
    article_urn: Optional[str] = Field(
        None,
        description="Filtra per articolo specifico (URN o pattern parziale)"
    )
    include_own: bool = Field(
        False,
        description="Includere anche le proprie proposte"
    )
    entity_types: Optional[List[EntityType]] = Field(
        None,
        description="Filtra per tipo entita'"
    )
    limit: int = Field(20, ge=1, le=100)
    offset: int = Field(0, ge=0)
    updated_after: Optional[datetime] = Field(
        None,
        description="Filtra entità/relazioni aggiornate dopo questo timestamp (per real-time sync)"
    )


class PendingQueueResponse(BaseModel):
    """Response con lista pending da validare."""
    pending_entities: List[PendingEntityData] = Field(default_factory=list)
    pending_relations: List[PendingRelationData] = Field(default_factory=list)
    total_entities: int = 0
    total_relations: int = 0
    user_can_vote: int = Field(
        0,
        description="Su quante puo' ancora votare"
    )


# =============================================================================
# VALIDATION RESULT (interno)
# =============================================================================

class ValidationResult(BaseModel):
    """Risultato aggregazione voti (uso interno)."""
    status: ValidationStatus
    score: float
    merged_edits: Dict[str, Any] = Field(default_factory=dict)


# =============================================================================
# NORM RESOLVER
# =============================================================================

class NormResolveRequest(BaseModel):
    """
    Request per risolvere una citazione normativa.

    Usato in ProposeRelationDrawer quando l'utente inserisce una norma
    come target (es. "Art. 1218 c.c.") invece di un'entità esistente.

    Il frontend usa citationParser per parsing, poi invia i dati parsati
    al backend per risoluzione URN e lookup/creazione nel grafo.
    """
    # Dati dalla parsedCitation del frontend
    act_type: str = Field(
        ...,
        description="Tipo atto normalizzato (es. 'codice civile', 'legge', 'd.lgs.')"
    )
    article: str = Field(
        ...,
        description="Numero articolo (es. '1218', '52-bis')"
    )
    act_number: Optional[str] = Field(
        None,
        description="Numero atto (es. '241' per L. 241/1990)"
    )
    date: Optional[str] = Field(
        None,
        description="Anno o data atto (es. '1990', '2016-05-04')"
    )

    # Contesto
    source_article_urn: str = Field(
        ...,
        description="URN dell'articolo da cui parte la relazione"
    )

    # User
    user_id: str = Field(..., description="UUID utente VisuaLex")


class NormResolveResponse(BaseModel):
    """
    Response con risultato risoluzione norma.

    Possibili scenari:
    1. Norma esiste nel grafo → resolved=True, exists_in_graph=True
    2. Norma non esiste → crea PendingEntity tipo=norma → resolved=True, created_pending=True
    3. Errore parsing/risoluzione → resolved=False, error_message valorizzato
    """
    resolved: bool = Field(..., description="True se risoluzione riuscita")
    entity_id: str = Field(
        "",
        description="ID entità da usare in proposeRelation (entity_id o node_id)"
    )
    display_label: str = Field(
        "",
        description="Label per UI (es. 'Art. 1218 Codice Civile')"
    )
    urn: str = Field(
        "",
        description="URN risolto (es. 'urn:nir:stato:regio.decreto:1942-03-16;262~art1218')"
    )

    # Status
    exists_in_graph: bool = Field(
        False,
        description="True se la norma era già nel grafo (approvata)"
    )
    is_pending: bool = Field(
        False,
        description="True se la norma è un'entità pending"
    )
    created_pending: bool = Field(
        False,
        description="True se è stata creata una nuova PendingEntity"
    )

    # Error handling
    error_message: Optional[str] = Field(
        None,
        description="Messaggio errore se resolved=False"
    )


# =============================================================================
# DEDUPLICATION
# =============================================================================

class DuplicateConfidenceLevel(str, Enum):
    """Livello di confidenza nella rilevazione duplicato."""
    EXACT = "exact"  # Match esatto dopo normalizzazione
    HIGH = "high"  # Score > 0.90, molto probabile duplicato
    MEDIUM = "medium"  # Score 0.75-0.90, possibile duplicato
    LOW = "low"  # Score 0.60-0.75, forse correlato


class DuplicateCandidateData(BaseModel):
    """Un candidato duplicato trovato."""
    entity_id: str = Field(..., description="ID entita' esistente")
    entity_text: str = Field(..., description="Nome/testo entita'")
    entity_type: str = Field(..., description="Tipo entita'")
    descrizione: Optional[str] = Field(None, description="Descrizione")
    article_urn: str = Field(..., description="URN articolo di origine")
    similarity_score: float = Field(..., ge=0.0, le=1.0, description="Score similarita'")
    confidence: DuplicateConfidenceLevel = Field(..., description="Livello confidenza")
    match_reason: str = Field(..., description="Motivo match (exact_normalized, fuzzy_name, fuzzy_description)")
    validation_status: str = Field("pending", description="Stato validazione")
    votes_count: int = Field(0, description="Numero voti")
    net_score: float = Field(0.0, description="Score netto (approval - rejection)")


class DuplicateCheckRequest(BaseModel):
    """Request per check duplicati prima di proporre entita'."""
    entity_text: str = Field(..., min_length=2, description="Nome/testo dell'entita' da verificare")
    entity_type: EntityType = Field(..., description="Tipo entita'")
    article_urn: Optional[str] = Field(None, description="URN articolo (opzionale, per scope)")
    scope: Literal["global", "article", "type"] = Field(
        "global",
        description="Ambito ricerca: global (tutte), article (stesso articolo), type (stesso tipo)"
    )


class DuplicateCheckResponse(BaseModel):
    """Response con duplicati trovati."""
    query_text: str = Field(..., description="Testo cercato")
    query_type: str = Field(..., description="Tipo cercato")
    normalized_query: str = Field(..., description="Query normalizzata")
    has_duplicates: bool = Field(False, description="True se trovati duplicati")
    exact_match: Optional[DuplicateCandidateData] = Field(
        None,
        description="Match esatto se trovato"
    )
    duplicates: List[DuplicateCandidateData] = Field(
        default_factory=list,
        description="Lista duplicati ordinati per similarita'"
    )
    recommendation: Literal["create", "merge", "ask_user"] = Field(
        "create",
        description="Raccomandazione: create (nuova), merge (unisci), ask_user (chiedi)"
    )


class RelationDuplicateCheckRequest(BaseModel):
    """Request per check duplicati relazione."""
    source_entity_id: str = Field(..., description="ID entita' sorgente")
    target_entity_id: str = Field(..., description="ID entita' target")
    relation_type: RelationType = Field(..., description="Tipo relazione")


class RelationDuplicateCandidateData(BaseModel):
    """Candidato duplicato per relazione."""
    relation_id: str
    source_text: str
    target_text: str
    relation_type: str
    similarity_score: float
    confidence: DuplicateConfidenceLevel
    validation_status: str = "pending"


class RelationDuplicateCheckResponse(BaseModel):
    """Response con relazioni duplicate."""
    has_duplicates: bool = False
    exact_match: Optional[RelationDuplicateCandidateData] = None
    duplicates: List[RelationDuplicateCandidateData] = Field(default_factory=list)
    recommendation: Literal["create", "merge", "ask_user"] = "create"


# =============================================================================
# ISSUE REPORTING (RLCF Feedback Loop)
# =============================================================================

class IssueType(str, Enum):
    """
    Tipi di issue segnalabili per entita' e relazioni.

    Categorie:
    - ERRORI: Problemi fattuali che richiedono correzione
    - SUGGERIMENTI: Miglioramenti proposti
    """
    # Errori fattuali
    FACTUAL_ERROR = "factual_error"      # Dati errati
    WRONG_RELATION = "wrong_relation"     # Relazione sbagliata
    WRONG_TYPE = "wrong_type"             # Tipo entita' errato
    DUPLICATE = "duplicate"               # Nodo duplicato
    OUTDATED = "outdated"                 # Info non aggiornata

    # Suggerimenti
    MISSING_RELATION = "missing_relation"  # Manca relazione
    INCOMPLETE = "incomplete"              # Proprieta' mancanti
    IMPROVE_LABEL = "improve_label"        # Label migliorabile
    OTHER = "other"                        # Altro


class IssueSeverity(str, Enum):
    """Gravita' dell'issue segnalata."""
    LOW = "low"       # Minore, non urgente
    MEDIUM = "medium"  # Media, da correggere
    HIGH = "high"     # Grave, prioritaria


class IssueStatus(str, Enum):
    """Stato di una issue."""
    OPEN = "open"                    # Aperta, in attesa di voti
    THRESHOLD_REACHED = "threshold_reached"  # Soglia raggiunta, entity in needs_revision
    DISMISSED = "dismissed"          # Dismissata (troppi downvote)
    RESOLVED = "resolved"            # Risolta manualmente


class ReportIssueRequest(BaseModel):
    """
    Request per segnalare un problema su un'entita' approvata.

    Flusso RLCF:
    1. Utente vede incongruenza nel Knowledge Graph
    2. Crea issue con tipo, gravita' e descrizione
    3. Community vota sulla validita' dell'issue
    4. Se upvote_score >= threshold → entity torna in needs_revision
    """
    entity_id: str = Field(
        ...,
        description="ID dell'entita' (entity_id in pending_entities)"
    )
    issue_type: IssueType = Field(
        ...,
        description="Tipo di problema segnalato"
    )
    severity: IssueSeverity = Field(
        IssueSeverity.MEDIUM,
        description="Gravita' del problema"
    )
    description: str = Field(
        ...,
        min_length=10,
        max_length=2000,
        description="Descrizione dettagliata del problema"
    )

    # User
    user_id: str = Field(..., description="UUID utente VisuaLex")


class ReportIssueResponse(BaseModel):
    """Response dopo creazione issue."""
    success: bool = True
    issue_id: str = Field(..., description="ID univoco dell'issue creata")
    entity_id: str = Field(..., description="ID entita' segnalata")
    status: Literal["created", "merged"] = Field(
        "created",
        description="created se nuova, merged se issue simile esisteva"
    )
    message: str = "Segnalazione inviata"
    merged_with: Optional[str] = Field(
        None,
        description="ID issue con cui e' stata unita (se status=merged)"
    )


class VoteIssueRequest(BaseModel):
    """
    Request per votare su una issue esistente.

    Il voto e' pesato per l'authority dell'utente.
    """
    issue_id: str = Field(..., description="ID dell'issue")
    vote: Literal["upvote", "downvote"] = Field(
        ...,
        description="upvote = issue valida, downvote = issue non valida"
    )
    comment: Optional[str] = Field(
        None,
        max_length=500,
        description="Commento opzionale al voto"
    )

    # User
    user_id: str = Field(..., description="UUID utente VisuaLex")


class VoteIssueResponse(BaseModel):
    """Response dopo voto su issue."""
    success: bool = True
    issue_id: str
    new_status: IssueStatus = Field(
        ...,
        description="Stato issue dopo il voto"
    )
    upvote_score: float = Field(
        ...,
        description="Score totale upvote (pesato per authority)"
    )
    downvote_score: float = Field(
        ...,
        description="Score totale downvote (pesato per authority)"
    )
    votes_count: int = Field(..., description="Numero totale voti")
    entity_reopened: bool = Field(
        False,
        description="True se l'entita' e' tornata in needs_revision"
    )
    message: str = ""


class EntityDetailsForIssue(BaseModel):
    """Dettagli dell'entita' per contestualizzare l'issue."""
    # Per nodi
    label: Optional[str] = Field(None, description="Label/nome del nodo")
    node_type: Optional[str] = Field(None, description="Tipo del nodo (Norma, Concetto, etc.)")
    urn: Optional[str] = Field(None, description="URN se disponibile")
    ambito: Optional[str] = Field(None, description="Ambito giuridico")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Proprieta' chiave")

    # Per relazioni
    is_relation: bool = Field(False, description="True se e' una relazione")
    relation_type: Optional[str] = Field(None, description="Tipo relazione")
    source_label: Optional[str] = Field(None, description="Label nodo sorgente")
    source_type: Optional[str] = Field(None, description="Tipo nodo sorgente")
    target_label: Optional[str] = Field(None, description="Label nodo target")
    target_type: Optional[str] = Field(None, description="Tipo nodo target")


class EntityIssueData(BaseModel):
    """Dati di una issue per visualizzazione."""
    issue_id: str
    entity_id: str
    entity_type: Optional[str] = None
    issue_type: IssueType
    severity: IssueSeverity
    description: str
    status: IssueStatus

    # Reporter
    reported_by: str
    reporter_authority: float = 0.0

    # Scores
    upvote_score: float = 0.0
    downvote_score: float = 0.0
    votes_count: int = 0

    # Timestamps
    created_at: datetime
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None

    # Dettagli entita' dal grafo (per contestualizzare)
    entity_details: Optional[EntityDetailsForIssue] = Field(
        None,
        description="Dettagli del nodo/relazione dal Knowledge Graph"
    )


class GetEntityIssuesResponse(BaseModel):
    """Response con lista issues per un'entita'."""
    entity_id: str
    issues: List[EntityIssueData] = Field(default_factory=list)
    open_count: int = Field(0, description="Numero issue aperte")
    total_count: int = Field(0, description="Numero totale issues")


class OpenIssuesRequest(BaseModel):
    """Request per lista issues aperte (moderatori)."""
    status: Optional[IssueStatus] = Field(
        IssueStatus.OPEN,
        description="Filtra per stato"
    )
    severity: Optional[IssueSeverity] = Field(
        None,
        description="Filtra per gravita'"
    )
    issue_type: Optional[IssueType] = Field(
        None,
        description="Filtra per tipo"
    )
    limit: int = Field(50, ge=1, le=200)
    offset: int = Field(0, ge=0)


class OpenIssuesResponse(BaseModel):
    """Response con issues aperte."""
    issues: List[EntityIssueData] = Field(default_factory=list)
    total: int = 0
    has_more: bool = False


# =============================================================================
# DOSSIER TRAINING SET EXPORT (R5)
# =============================================================================

class DossierArticleData(BaseModel):
    """Dati di un articolo nel dossier per training set."""
    urn: Optional[str] = Field(None, description="URN dell'articolo")
    tipo_atto: str = Field(..., description="Tipo di atto")
    numero_atto: Optional[str] = Field(None, description="Numero dell'atto")
    numero_articolo: str = Field(..., description="Numero dell'articolo")
    data: Optional[str] = Field(None, description="Data dell'atto")
    article_text: Optional[str] = Field(None, description="Testo dell'articolo")
    user_status: Optional[str] = Field(
        None,
        description="Status utente (unread, reading, important, done)"
    )


class DossierQASessionData(BaseModel):
    """Dati di una sessione Q&A collegata al dossier."""
    trace_id: str = Field(..., description="ID trace della query")
    query: str = Field(..., description="Query originale")
    synthesis: str = Field(..., description="Risposta sintetizzata")
    mode: str = Field(..., description="Modalita' sintesi (convergent/divergent)")
    experts_used: List[str] = Field(default_factory=list, description="Expert utilizzati")
    confidence: float = Field(..., ge=0, le=1, description="Confidence risposta")
    feedback: Optional[Dict[str, Any]] = Field(
        None,
        description="Feedback RLCF se presente"
    )
    created_at: datetime = Field(..., description="Timestamp della query")


class DossierAnnotationData(BaseModel):
    """Annotazione utente su un articolo."""
    article_urn: Optional[str] = Field(None, description="URN articolo annotato")
    article_numero: str = Field(..., description="Numero articolo annotato")
    user_note: Optional[str] = Field(None, description="Nota utente")
    highlight_text: Optional[str] = Field(None, description="Testo evidenziato")
    annotation_type: str = Field("note", description="Tipo annotazione (note, highlight, question)")
    created_at: Optional[datetime] = Field(None, description="Timestamp annotazione")


class DossierTrainingSetExportRequest(BaseModel):
    """
    Request per esportare un dossier come training set RLCF.

    Un dossier contiene:
    - Articoli curati dall'utente
    - Sessioni Q&A (se l'utente ha fatto domande sugli articoli)
    - Annotazioni e note utente

    Questo insieme costituisce un training set di alta qualita'
    perche' rappresenta il percorso di studio di un giurista.
    """
    dossier_id: str = Field(..., description="ID del dossier da esportare")
    user_id: str = Field(..., description="ID utente proprietario")
    include_qa_sessions: bool = Field(
        True,
        description="Includere sessioni Q&A collegate agli articoli del dossier"
    )
    include_annotations: bool = Field(
        True,
        description="Includere annotazioni e note utente"
    )
    include_article_text: bool = Field(
        True,
        description="Includere testo completo degli articoli"
    )
    format: str = Field(
        "json",
        description="Formato export (json, jsonl)"
    )


class DossierTrainingSetExportResponse(BaseModel):
    """
    Response con training set esportato dal dossier.

    Questo formato puo' essere usato per:
    1. Fine-tuning degli Expert (tramite annotazioni)
    2. Training del retriever (tramite Q&A sessions)
    3. Miglioramento del Knowledge Graph (tramite articoli curati)
    """
    training_set_id: str = Field(..., description="ID univoco del training set")
    dossier_id: str = Field(..., description="ID dossier sorgente")
    dossier_title: str = Field(..., description="Titolo del dossier")
    dossier_description: Optional[str] = Field(None, description="Descrizione dossier")
    dossier_tags: List[str] = Field(default_factory=list, description="Tag del dossier")

    # Contenuto
    articles: List[DossierArticleData] = Field(
        default_factory=list,
        description="Articoli nel dossier"
    )
    qa_sessions: List[DossierQASessionData] = Field(
        default_factory=list,
        description="Sessioni Q&A collegate"
    )
    annotations: List[DossierAnnotationData] = Field(
        default_factory=list,
        description="Annotazioni utente"
    )

    # Metadata export
    exported_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Timestamp export"
    )
    exported_by: str = Field(..., description="User ID che ha esportato")
    articles_count: int = Field(0, description="Numero articoli")
    qa_sessions_count: int = Field(0, description="Numero sessioni Q&A")
    annotations_count: int = Field(0, description="Numero annotazioni")

    # Stats per RLCF
    completed_articles: int = Field(
        0,
        description="Articoli marcati come 'done' dall'utente"
    )
    avg_qa_confidence: float = Field(
        0.0,
        description="Confidence media delle risposte Q&A"
    )


class LoadDossierTrainingRequest(BaseModel):
    """
    Request per caricare un training set nel buffer RLCF.

    Il training set verra' convertito in esperienze per il
    training scheduler.
    """
    training_set: DossierTrainingSetExportResponse = Field(
        ...,
        description="Training set da caricare"
    )
    priority_boost: float = Field(
        0.0,
        ge=0.0,
        le=1.0,
        description="Boost priorita' (0-1). I dossier curati sono alta qualita'"
    )


class LoadDossierTrainingResponse(BaseModel):
    """Response dopo caricamento training set."""
    success: bool = True
    experiences_added: int = Field(0, description="Esperienze aggiunte al buffer")
    buffer_size: int = Field(0, description="Nuovo size buffer")
    training_ready: bool = Field(False, description="True se buffer ha raggiunto threshold")
    message: str = Field("", description="Messaggio di stato")


# =============================================================================
# NER FEEDBACK (R6 - Citation NER Training)
# =============================================================================

class NERFeedbackRequest(BaseModel):
    """
    Request per feedback NER su citazione.

    Usato quando l'utente corregge o conferma il parsing di una citazione
    estratta dal CitationPreview. Questo feedback viene accumulato nel buffer
    per training del NER spaCy.
    """
    article_urn: str = Field(..., description="URN articolo sorgente")
    user_id: str = Field(..., description="UUID utente VisuaLex")

    # Testo citazione
    selected_text: str = Field(
        ...,
        min_length=5,
        max_length=500,
        description="Testo della citazione selezionata"
    )
    # NOTA: start_offset e end_offset sono deprecati.
    # Il contesto viene ora estratto tramite DOM walking nel frontend,
    # che produce context_window direttamente senza bisogno degli offset.
    start_offset: Optional[int] = Field(
        None,
        ge=0,
        description="[DEPRECATED] Offset inizio nel testo - usare context_window"
    )
    end_offset: Optional[int] = Field(
        None,
        gt=0,
        description="[DEPRECATED] Offset fine nel testo - usare context_window"
    )
    context_window: str = Field(
        ...,
        max_length=1500,
        description="Contesto estratto con DOM walking: 500 char prima + [selected_text] + 500 char dopo"
    )

    # Tipo feedback
    feedback_type: Literal["correction", "confirmation", "annotation"] = Field(
        ...,
        description="correction=correzione parsing errato, confirmation=conferma corretto, annotation=nuova citazione"
    )

    # Parsing
    original_parsed: Optional[Dict[str, Any]] = Field(
        None,
        description="Dati parsati originalmente (se disponibile)"
    )
    correct_reference: Dict[str, Any] = Field(
        ...,
        description="Riferimento corretto: {tipo_atto, numero, anno, articoli}"
    )

    # Metadata
    confidence_before: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Confidence del parser prima del feedback (se disponibile)"
    )
    source: str = Field(
        default="citation_preview",
        description="Origine feedback (citation_preview, manual_annotation, etc.)"
    )


class NERFeedbackResponse(BaseModel):
    """Response dopo invio feedback NER con RLCF integration."""
    success: bool = True
    feedback_id: str = Field(..., description="ID univoco del feedback")
    buffer_size: int = Field(..., description="Dimensione corrente buffer")
    training_ready: bool = Field(
        ...,
        description="True se buffer ha raggiunto threshold (>= 50)"
    )
    training_triggered: bool = Field(
        default=False,
        description="True se il training è stato avviato automaticamente"
    )
    patterns_updated: int = Field(
        default=0,
        description="Numero pattern aggiornati nel NER (se training eseguito)"
    )
    message: str = Field(
        default="",
        description="Messaggio informativo"
    )

    # RLCF Integration fields
    user_authority: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="Authority calcolata dell'utente (0-1)"
    )
    authority_breakdown: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Breakdown componenti authority (baseline, track_record, level)"
    )


class NERConfirmRequest(BaseModel):
    """
    Request semplificata per conferma citazione corretta.

    Usato quando utente clicca "Corretto" in CitationPreview.
    Shortcut per NERFeedbackRequest con feedback_type="confirmation".
    """
    article_urn: str = Field(..., description="URN articolo sorgente")
    text: str = Field(..., min_length=1, description="Testo citazione")
    parsed: Dict[str, Any] = Field(..., description="Dati parsati dalla citazione")
    user_id: str = Field(..., description="UUID utente VisuaLex")


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    # Enums
    "ValidationStatus",
    "VoteType",
    # Pending
    "PendingEntityData",
    "PendingRelationData",
    # Article
    "ArticleData",
    # Graph
    "GraphNodePreview",
    "GraphLinkPreview",
    "GraphPreviewData",
    # Live Enrichment
    "LiveEnrichmentRequest",
    "LiveEnrichmentResponse",
    # Validation
    "EntityValidationRequest",
    "EntityValidationResponse",
    "RelationValidationRequest",
    "RelationValidationResponse",
    # Proposal
    "EntityProposalRequest",
    "EntityProposalResponse",
    "RelationProposalRequest",
    "RelationProposalResponse",
    # Document
    "DocumentExtractionRequest",
    "DocumentExtractionResponse",
    # Queue
    "PendingQueueRequest",
    "PendingQueueResponse",
    # Internal
    "ValidationResult",
    # Norm Resolver
    "NormResolveRequest",
    "NormResolveResponse",
    # Deduplication
    "DuplicateConfidenceLevel",
    "DuplicateCandidateData",
    "DuplicateCheckRequest",
    "DuplicateCheckResponse",
    "RelationDuplicateCheckRequest",
    "RelationDuplicateCandidateData",
    "RelationDuplicateCheckResponse",
    # Issue Reporting (RLCF Feedback Loop)
    "IssueType",
    "IssueSeverity",
    "IssueStatus",
    "ReportIssueRequest",
    "ReportIssueResponse",
    "VoteIssueRequest",
    "VoteIssueResponse",
    "EntityIssueData",
    "GetEntityIssuesResponse",
    "OpenIssuesRequest",
    "OpenIssuesResponse",
    # Dossier Training Set Export (R5)
    "DossierArticleData",
    "DossierQASessionData",
    "DossierAnnotationData",
    "DossierTrainingSetExportRequest",
    "DossierTrainingSetExportResponse",
    "LoadDossierTrainingRequest",
    "LoadDossierTrainingResponse",
    # NER Feedback (R6)
    "NERFeedbackRequest",
    "NERFeedbackResponse",
    "NERConfirmRequest",
]
