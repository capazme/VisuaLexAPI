"""
Profile API Models
==================

Pydantic models per il profilo utente e l'RLCF authority system.
"""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, TYPE_CHECKING

from pydantic import BaseModel, Field


class LegalDomain(str, Enum):
    """Domini legali supportati."""

    CIVILE = "civile"
    PENALE = "penale"
    AMMINISTRATIVO = "amministrativo"
    COSTITUZIONALE = "costituzionale"
    LAVORO = "lavoro"
    COMMERCIALE = "commerciale"
    TRIBUTARIO = "tributario"
    INTERNAZIONALE = "internazionale"


class QualificationType(str, Enum):
    """Tipi di qualifica professionale."""

    STUDENTE = "studente"
    LAUREANDO = "laureando"
    NEOLAUREATO = "neolaureato"
    PRATICANTE = "praticante"
    AVVOCATO = "avvocato"
    MAGISTRATO = "magistrato"
    DOCENTE = "docente"
    GIUDICE_SUPREMA = "giudice_suprema"


class AuthorityBreakdown(BaseModel):
    """Breakdown dei componenti dell'authority (formula RLCF)."""

    baseline: float = Field(..., description="B_u - Baseline da qualifiche (peso 0.3)")
    track_record: float = Field(..., description="T_u - Track Record storico (peso 0.5)")
    level_authority: float = Field(..., description="P_u - Performance recente (peso 0.2)")


class DomainAuthorityResponse(BaseModel):
    """Authority per dominio legale."""

    civile: float = 0.0
    penale: float = 0.0
    amministrativo: float = 0.0
    costituzionale: float = 0.0
    lavoro: float = 0.0
    commerciale: float = 0.0
    tributario: float = 0.0
    internazionale: float = 0.0


class DetailedContributionStats(BaseModel):
    """Statistiche contributi dettagliate."""

    entities_proposed: int = 0
    entities_approved: int = 0
    entities_rejected: int = 0
    relations_proposed: int = 0
    relations_approved: int = 0
    relations_rejected: int = 0
    votes_cast: int = 0
    votes_correct: int = 0
    accuracy_rate: float = 0.0


class NotificationPreferences(BaseModel):
    """Preferenze notifiche utente."""

    email_on_validation: bool = True
    email_on_authority_change: bool = True
    email_weekly_summary: bool = False


class ProfileActivityEntry(BaseModel):
    """Singola entry di attività recente (voti, proposte, NER feedback)."""

    id: Optional[str] = None
    type: str = Field(..., description="'vote' | 'proposal' | 'edit' | 'ner_feedback'")
    item_name: str
    item_type: str = Field(..., description="'entity' | 'relation' | 'citation'")
    outcome: str = Field(..., description="'approved' | 'rejected' | 'pending'")
    timestamp: datetime
    track_record_delta: Optional[float] = Field(None, description="Delta sul track record T_u")
    domain: Optional[str] = Field(None, description="Dominio legale")
    item_id: Optional[str] = None


class DomainStats(BaseModel):
    """Statistiche per singolo dominio legale."""

    authority: float = 0.0
    contributions: int = 0
    success_rate: float = 0.0


class AuthorityInfo(BaseModel):
    """Authority completa con tier e progress."""

    score: float = Field(..., description="Authority score calcolato A_u [0-1]")
    tier: str = Field(..., description="Tier attuale: novizio, contributore, esperto, autorita")
    breakdown: AuthorityBreakdown
    next_tier_threshold: float = Field(..., description="Soglia per prossimo tier")
    progress_to_next: float = Field(..., description="Progresso verso prossimo tier [0-100]")


class ContributionStatsSimple(BaseModel):
    """Statistiche contributi semplificate per frontend."""

    total_contributions: int = 0
    approved: int = 0
    rejected: int = 0
    pending: int = 0
    vote_weight: float = Field(0.0, description="Peso voto attuale (= authority score)")


class FullProfileResponse(BaseModel):
    """
    Risposta completa profilo utente.

    Formato ottimizzato per il frontend VisuaLex.
    """

    user_id: str
    display_name: Optional[str] = None

    # RLCF Authority con tier e progress
    authority: AuthorityInfo

    # Domain-specific stats
    domains: Dict[str, DomainStats] = Field(default_factory=dict)

    # Stats semplificate
    stats: ContributionStatsSimple = Field(default_factory=ContributionStatsSimple)

    # Recent activity
    recent_activity: List["ProfileActivityEntry"] = Field(default_factory=list)

    # Timestamps
    joined_at: Optional[str] = None
    last_updated: Optional[str] = None


class FullProfileResponseInternal(BaseModel):
    """Risposta profilo interna con tutti i dettagli (per admin/backend)."""

    user_id: str
    username: str
    email: str
    created_at: datetime
    is_admin: bool = False
    is_verified: bool = False

    # RLCF Authority
    authority: float = Field(..., description="Authority globale (0.0-1.0)")
    authority_breakdown: Optional[AuthorityBreakdown] = None

    # Qualifiche
    qualification: Optional[QualificationType] = None
    specializations: List[LegalDomain] = Field(default_factory=list)
    years_experience: Optional[int] = None

    # Domain-specific authority
    domain_authority: DomainAuthorityResponse = Field(default_factory=DomainAuthorityResponse)

    # Stats
    contribution_stats: DetailedContributionStats = Field(default_factory=DetailedContributionStats)

    # Recent activity
    recent_activity: List["ProfileActivityEntry"] = Field(default_factory=list)

    # Timestamps
    joined_at: Optional[datetime] = None
    last_updated: Optional[datetime] = None

    # Preferenze
    notification_preferences: NotificationPreferences = Field(default_factory=NotificationPreferences)


class UpdateQualificationRequest(BaseModel):
    """Request per aggiornare qualifiche."""

    qualification: QualificationType
    specializations: Optional[List[LegalDomain]] = None
    years_experience: Optional[int] = None


class UpdateNotificationsRequest(BaseModel):
    """Request per aggiornare preferenze notifiche."""

    email_on_validation: Optional[bool] = None
    email_on_authority_change: Optional[bool] = None
    email_weekly_summary: Optional[bool] = None


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "LegalDomain",
    "QualificationType",
    "AuthorityBreakdown",
    "AuthorityInfo",
    "ContributionStatsSimple",
    "DomainAuthorityResponse",
    "DetailedContributionStats",
    "NotificationPreferences",
    "ProfileActivityEntry",
    "DomainStats",
    "FullProfileResponse",
    "FullProfileResponseInternal",
    "UpdateQualificationRequest",
    "UpdateNotificationsRequest",
]
