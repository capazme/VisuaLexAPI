"""
External Ingestion Models
=========================

Dataclass per richieste e risposte di ingestion da fonti esterne (VisuaLex).

Supporta:
- Ingestion di nuovi articoli
- Suggerimento di nuove relazioni
- Preview del grafo risultante
- Logica di auto-approvazione

Esempio:
    >>> from merlt.api.models.ingestion import ExternalIngestionRequest
    >>> request = ExternalIngestionRequest(
    ...     source="visualex",
    ...     user_id="uuid-123",
    ...     user_authority=0.6,
    ...     tipo_atto="codice civile",
    ...     articolo="1337",
    ...     trigger="search_not_found",
    ... )
"""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
from enum import Enum


# =============================================================================
# ENUMS
# =============================================================================

class IngestionTrigger(str, Enum):
    """Trigger che ha causato la richiesta di ingestion."""
    SEARCH_NOT_FOUND = "search_not_found"
    CROSS_REF_CLICK = "cross_ref_click"
    DOSSIER_GROUPING = "dossier_grouping"
    ANNOTATION = "annotation"
    MANUAL = "manual"


class IngestionStatus(str, Enum):
    """Stato dell'ingestion dopo valutazione."""
    AUTO_APPROVED = "auto_approved"
    PENDING_VALIDATION = "pending_validation"
    REJECTED = "rejected"
    COMPLETED = "completed"
    FAILED = "failed"


class RelationType(str, Enum):
    """Tipi di relazione nel Knowledge Graph."""
    RIFERIMENTO = "RIFERIMENTO"
    CITATO_DA = "CITATO_DA"
    MODIFICA = "MODIFICA"
    MODIFICATO_DA = "MODIFICATO_DA"
    DEROGA = "DEROGA"
    DEROGATO_DA = "DEROGATO_DA"
    ABROGA = "ABROGA"
    ABROGATO_DA = "ABROGATO_DA"
    INTERPRETED_BY = "INTERPRETED_BY"
    RELATED_TO = "RELATED_TO"
    APPLIES_TO = "APPLIES_TO"


# =============================================================================
# REQUEST MODELS
# =============================================================================

@dataclass
class SuggestedRelation:
    """
    Relazione proposta dall'utente.

    Attributes:
        source_urn: URN del nodo sorgente
        target_urn: URN del nodo destinazione
        relation_type: Tipo di relazione (RIFERIMENTO, RELATED_TO, etc.)
        evidence: Evidenza che supporta la relazione
        confidence: Confidenza nella relazione (0.5-1.0)
    """
    source_urn: str
    target_urn: str
    relation_type: RelationType
    evidence: str  # "cross_ref", "dossier_grouping", "user_annotation", "text_extraction"
    confidence: float = 0.7

    def __post_init__(self):
        """Valida i campi."""
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError(f"confidence deve essere tra 0 e 1, got {self.confidence}")
        if isinstance(self.relation_type, str):
            self.relation_type = RelationType(self.relation_type)


@dataclass
class BrocardiMassima:
    """Massima giurisprudenziale da Brocardi."""
    corte: str
    numero: str
    estratto: str


@dataclass
class BrocardiInfo:
    """Informazioni arricchite da Brocardi.it."""
    position: Optional[str] = None
    ratio: Optional[str] = None
    spiegazione: Optional[str] = None
    massime: List[BrocardiMassima] = field(default_factory=list)
    brocardi: List[str] = field(default_factory=list)


@dataclass
class NormaMetadata:
    """Metadati dell'atto normativo."""
    tipo_atto: str
    data: str
    numero_atto: str
    titolo: str
    autorita_emanante: str


@dataclass
class NormaData:
    """Dati completi della norma da VisuaLex."""
    norma: NormaMetadata
    numero_articolo: str
    versione: Optional[str] = None
    data_versione: Optional[str] = None
    allegato: Optional[str] = None


@dataclass
class ExternalIngestionRequest:
    """
    Richiesta di ingestion da fonte esterna (es. VisuaLex).

    Segue lo 'Schema Definitivo 1.0 - LOCKED'.

    Attributes:
        source: Identificatore della fonte ("visualex", "manual", etc.)
        user_id: UUID dell'utente che richiede l'ingestion
        user_authority: Authority score dell'utente (0-1)
        
        # Dati Arricchiti (Schema Locked)
        norma_data: Dati strutturati della norma
        article_text: Testo completo dell'articolo (da parsare in commi)
        brocardi_info: Ratio, spiegazioni e massime
        url: URL ufficiale Normattiva
        
        # Backward Compatibility / Simple Request
        tipo_atto: Optional[str] = None
        articolo: Optional[str] = None
        
        # Contesto
        trigger: IngestionTrigger = IngestionTrigger.MANUAL
        suggested_relations: List[SuggestedRelation] = field(default_factory=list)
        metadata: Dict[str, Any] = field(default_factory=dict)
        requested_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    """
    # Identificazione fonte
    source: str
    user_id: str
    user_authority: float

    # Dati Arricchiti (Schema Locked)
    norma_data: Optional[NormaData] = None
    article_text: Optional[str] = None
    brocardi_info: Optional[BrocardiInfo] = None
    url: Optional[str] = None

    # Articolo (per compatibilità o se non fornito norma_data)
    tipo_atto: Optional[str] = None
    articolo: Optional[str] = None

    # Contesto
    trigger: IngestionTrigger = IngestionTrigger.MANUAL

    # Relazioni suggerite (opzionale)
    suggested_relations: List[SuggestedRelation] = field(default_factory=list)

    # Metadata aggiuntivi
    metadata: Dict[str, Any] = field(default_factory=dict)

    # Timestamp
    requested_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self):
        """Valida i campi e assicura coerenza."""
        if not 0.0 <= self.user_authority <= 1.0:
            raise ValueError(f"user_authority deve essere tra 0 e 1, got {self.user_authority}")
        
        if isinstance(self.trigger, str):
            self.trigger = IngestionTrigger(self.trigger)
            
        # Sincronizza tipo_atto e articolo se forniti via norma_data
        if self.norma_data:
            self.tipo_atto = self.norma_data.norma.tipo_atto
            self.articolo = self.norma_data.numero_articolo
        elif not self.tipo_atto or not self.articolo:
            raise ValueError("Mancano dati identificativi dell'articolo (norma_data o tipo_atto/articolo)")

    @property
    def is_high_authority(self) -> bool:
        """Verifica se l'utente ha authority alta (>= 0.7)."""
        return self.user_authority >= 0.7

    @property
    def has_rich_data(self) -> bool:
        """Verifica se la richiesta include il payload ricco di VisuaLex."""
        return self.article_text is not None and self.brocardi_info is not None


# =============================================================================
# RESPONSE MODELS
# =============================================================================

@dataclass
class GraphNodePreview:
    """
    Preview di un nodo del grafo.

    Attributes:
        urn: URN del nodo
        tipo: Tipo di nodo (Norma, Comma, etc.)
        label: Etichetta display
        exists: Se il nodo esiste già nel grafo
        properties: Proprietà del nodo
    """
    urn: str
    tipo: str
    label: str
    exists: bool
    properties: Dict[str, Any] = field(default_factory=dict)


@dataclass
class GraphRelationPreview:
    """
    Preview di una relazione del grafo.

    Attributes:
        source_urn: URN nodo sorgente
        target_urn: URN nodo destinazione
        relation_type: Tipo di relazione
        exists: Se la relazione esiste già
        requires_validation: Se richiede validazione community
        confidence: Confidenza nella relazione
    """
    source_urn: str
    target_urn: str
    relation_type: str
    exists: bool = False
    requires_validation: bool = False
    confidence: float = 1.0


@dataclass
class GraphPreview:
    """
    Preview del grafo che verrebbe creato/modificato.

    Attributes:
        nodes_new: Nodi che verranno creati
        nodes_existing: Nodi già presenti (per contesto)
        relations_new: Relazioni che verranno create
        relations_pending: Relazioni che richiedono validazione
        total_new_nodes: Conteggio nuovi nodi
        total_new_relations: Conteggio nuove relazioni
    """
    nodes_new: List[GraphNodePreview] = field(default_factory=list)
    nodes_existing: List[GraphNodePreview] = field(default_factory=list)
    relations_new: List[GraphRelationPreview] = field(default_factory=list)
    relations_pending: List[GraphRelationPreview] = field(default_factory=list)

    @property
    def total_new_nodes(self) -> int:
        """Conta i nuovi nodi."""
        return len(self.nodes_new)

    @property
    def total_new_relations(self) -> int:
        """Conta le nuove relazioni."""
        return len(self.relations_new)

    @property
    def has_pending_validations(self) -> bool:
        """Verifica se ci sono relazioni pending."""
        return len(self.relations_pending) > 0

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "nodes_new": [
                {"urn": n.urn, "tipo": n.tipo, "label": n.label, "exists": n.exists}
                for n in self.nodes_new
            ],
            "nodes_existing": [
                {"urn": n.urn, "tipo": n.tipo, "label": n.label, "exists": n.exists}
                for n in self.nodes_existing
            ],
            "relations_new": [
                {
                    "source": r.source_urn,
                    "target": r.target_urn,
                    "type": r.relation_type,
                    "confidence": r.confidence,
                }
                for r in self.relations_new
            ],
            "relations_pending": [
                {
                    "source": r.source_urn,
                    "target": r.target_urn,
                    "type": r.relation_type,
                    "confidence": r.confidence,
                }
                for r in self.relations_pending
            ],
            "total_new_nodes": self.total_new_nodes,
            "total_new_relations": self.total_new_relations,
            "has_pending_validations": self.has_pending_validations,
        }


@dataclass
class IngestionResponse:
    """
    Risposta a una richiesta di ingestion.

    Attributes:
        success: Se l'operazione è andata a buon fine
        status: Stato dell'ingestion
        reason: Motivazione dello stato
        preview: Preview del grafo
        pending_id: ID per tracking se pending validation
        required_approvals: Numero di approvazioni necessarie
        article_urn: URN dell'articolo ingestito (se completato)
        nodes_created: Lista URN nodi creati
        relations_created: Lista relazioni create
        errors: Lista errori (se presenti)
    """
    success: bool
    status: IngestionStatus
    reason: str

    # Preview (sempre presente per UI)
    preview: GraphPreview

    # Se pending validation
    pending_id: Optional[str] = None
    required_approvals: int = 0

    # Se completato
    article_urn: Optional[str] = None
    nodes_created: List[str] = field(default_factory=list)
    relations_created: List[str] = field(default_factory=list)

    # Errori
    errors: List[str] = field(default_factory=list)

    # Timestamp
    processed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione JSON."""
        return {
            "success": self.success,
            "status": self.status.value,
            "reason": self.reason,
            "preview": self.preview.to_dict(),
            "pending_id": self.pending_id,
            "required_approvals": self.required_approvals,
            "article_urn": self.article_urn,
            "nodes_created": self.nodes_created,
            "relations_created": self.relations_created,
            "errors": self.errors,
            "processed_at": self.processed_at.isoformat(),
        }


# =============================================================================
# CONSTANTS
# =============================================================================

# Codici principali che permettono auto-approvazione
CODICI_PRINCIPALI = [
    "codice civile",
    "codice penale",
    "codice di procedura civile",
    "codice di procedura penale",
    "costituzione",
    "costituzione italiana",
    "preleggi",
    "disposizioni preliminari",
]

# Threshold per auto-approvazione basata su authority
AUTHORITY_AUTO_APPROVE_THRESHOLD = 0.7

# Numero di approvazioni richieste per validazione community
DEFAULT_REQUIRED_APPROVALS = 3

# Timeout per pending validations (giorni)
PENDING_VALIDATION_TIMEOUT_DAYS = 7
