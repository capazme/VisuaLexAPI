"""
Modelli Pydantic per NER Giuridico - Annotazioni Citazioni Normative.

Questo modulo definisce i modelli per raccogliere annotazioni utente
su citazioni normative ambigue, usate per training NER/coreference.

Caso d'uso principale:
    "La legge 241/1990 disciplina il procedimento. L'art. 3 prevede..."
                                                      ^^^^^^
    L'utente annota che "art. 3" si riferisce a "legge 241/1990"
"""

from datetime import datetime
from enum import Enum
from typing import Optional, List
from uuid import uuid4

from pydantic import BaseModel, Field


# =============================================================================
# ENUMS
# =============================================================================

class CitationAnnotationType(str, Enum):
    """Tipi di annotazione per citazioni normative."""

    # Coreference: citazione riferita a fonte distante nel testo
    CITATION_COREFERENCE = "citation_coreference"

    # Implicita: "la citata legge", "la norma di cui sopra"
    CITATION_IMPLICIT = "citation_implicit"

    # Correzione confini: span errata
    CITATION_BOUNDARY = "citation_boundary"

    # Errore: citazione errata nel testo originale
    CITATION_ERROR = "citation_error"

    # Mancata: citazione non rilevata dal matcher
    CITATION_MISSED = "citation_missed"


class AnnotationStatus(str, Enum):
    """Stato dell'annotazione nel workflow di validazione."""
    PENDING = "pending"
    VALIDATED = "validated"
    REJECTED = "rejected"


# =============================================================================
# CORE MODELS
# =============================================================================

class CitationSpan(BaseModel):
    """Span di testo con posizioni."""
    text: str = Field(..., description="Testo della span")
    start: int = Field(..., ge=0, description="Offset inizio (caratteri)")
    end: int = Field(..., ge=0, description="Offset fine (caratteri)")


class ResolvedReference(BaseModel):
    """Riferimento normativo risolto dall'utente."""
    act_type: str = Field(..., description="Tipo atto (es. 'legge', 'codice civile')")
    act_number: Optional[str] = Field(None, description="Numero atto (es. '241')")
    date: Optional[str] = Field(None, description="Data/anno (es. '1990')")
    article: Optional[str] = Field(None, description="Numero articolo (es. '3', '3-bis')")

    def to_cache_key(self) -> str:
        """Genera chiave univoca per caching."""
        parts = [self.act_type.lower().replace(" ", "-")]
        if self.article:
            parts.append(f"art{self.article}")
        if self.act_number:
            parts.append(self.act_number)
        if self.date:
            parts.append(self.date)
        return "::".join(parts)


# =============================================================================
# ANNOTATION MODELS
# =============================================================================

class CitationAnnotationBase(BaseModel):
    """Base per annotazione di citazione."""

    # Contesto documento
    article_urn: str = Field(..., description="URN dell'articolo contenente il testo")

    # Selezione utente (citazione da annotare)
    selected_span: CitationSpan = Field(..., description="Span selezionata dall'utente")

    # Risoluzione (a cosa si riferisce la citazione)
    resolved_reference: ResolvedReference = Field(..., description="Riferimento risolto")

    # Se la fonte è menzionata nel testo, cattura anche quella span
    source_mention_span: Optional[CitationSpan] = Field(
        None,
        description="Span della fonte nel testo (es. 'legge 241/1990')"
    )

    # Tipo annotazione
    annotation_type: CitationAnnotationType = Field(
        default=CitationAnnotationType.CITATION_COREFERENCE,
        description="Tipo di annotazione"
    )

    # Confidence utente (quanto è sicuro)
    user_confidence: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Confidenza utente nell'annotazione"
    )

    # Note opzionali
    notes: Optional[str] = Field(None, max_length=500, description="Note aggiuntive")


class CitationAnnotationCreate(CitationAnnotationBase):
    """Request per creare una nuova annotazione."""

    # Full article text per context window (training)
    article_text: str = Field(..., description="Testo completo dell'articolo")

    # User ID
    user_id: str = Field(..., description="ID utente che annota")


class CitationAnnotation(CitationAnnotationBase):
    """Annotazione completa con metadata."""

    # ID
    annotation_id: str = Field(
        default_factory=lambda: f"ca_{uuid4().hex[:12]}",
        description="ID univoco annotazione"
    )

    # Full article text
    article_text: str = Field(..., description="Testo completo dell'articolo")

    # User
    user_id: str = Field(..., description="ID utente che ha annotato")

    # Timestamps
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = None

    # Validation workflow
    status: AnnotationStatus = Field(default=AnnotationStatus.PENDING)
    validation_votes: int = Field(default=0)
    validated_by: Optional[str] = None
    validated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# =============================================================================
# RESPONSE MODELS
# =============================================================================

class CitationAnnotationResponse(BaseModel):
    """Response dopo creazione annotazione."""
    success: bool = True
    annotation_id: str
    message: str = "Annotazione salvata con successo"


class CitationAnnotationValidateRequest(BaseModel):
    """Request per validare un'annotazione."""
    annotation_id: str
    vote: str = Field(..., pattern="^(approve|reject)$")
    user_id: str
    comment: Optional[str] = None


class CitationAnnotationValidateResponse(BaseModel):
    """Response dopo validazione."""
    annotation_id: str
    new_status: AnnotationStatus
    total_votes: int


class CitationAnnotationListResponse(BaseModel):
    """Lista di annotazioni."""
    annotations: List[CitationAnnotation]
    total: int
    page: int = 1
    page_size: int = 50


# =============================================================================
# TRAINING EXPORT MODELS
# =============================================================================

class TrainingExportFormat(str, Enum):
    """Formati supportati per export training data."""
    JSONL = "jsonl"
    CONLL = "conll"
    SPACY = "spacy"


class TrainingExportRequest(BaseModel):
    """Request per export dati training."""
    format: TrainingExportFormat = TrainingExportFormat.JSONL
    min_validation_votes: int = Field(default=1, ge=0)
    only_validated: bool = True
    annotation_types: Optional[List[CitationAnnotationType]] = None


class TrainingExample(BaseModel):
    """Singolo esempio per training NER/coreference."""
    text: str  # Full article text
    entities: List[dict]  # [{start, end, label}]
    relations: List[dict]  # [{head, tail, type}] per coreference


class TrainingExportResponse(BaseModel):
    """Response export training."""
    format: TrainingExportFormat
    examples_count: int
    annotations_used: int
    export_url: Optional[str] = None  # Se file grande, URL per download


# =============================================================================
# DETECTED CITATIONS (per UI dropdown)
# =============================================================================

class DetectedCitation(BaseModel):
    """Citazione rilevata automaticamente nel testo (da regex)."""
    text: str
    start: int
    end: int
    act_type: str
    act_number: Optional[str] = None
    date: Optional[str] = None
    article: Optional[str] = None
    confidence: float


class DetectedCitationsResponse(BaseModel):
    """Citazioni rilevate in un testo."""
    citations: List[DetectedCitation]
    article_urn: str


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    # Enums
    "CitationAnnotationType",
    "AnnotationStatus",
    "TrainingExportFormat",
    # Core models
    "CitationSpan",
    "ResolvedReference",
    # Annotation models
    "CitationAnnotationBase",
    "CitationAnnotationCreate",
    "CitationAnnotation",
    # Response models
    "CitationAnnotationResponse",
    "CitationAnnotationValidateRequest",
    "CitationAnnotationValidateResponse",
    "CitationAnnotationListResponse",
    # Training export
    "TrainingExportRequest",
    "TrainingExample",
    "TrainingExportResponse",
    # Detected citations
    "DetectedCitation",
    "DetectedCitationsResponse",
]
