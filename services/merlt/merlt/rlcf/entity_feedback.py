"""
Entity Validation Feedback
==========================

Sistema di feedback RLCF per validazione granulare di entita' e relazioni.

Questo modulo implementa:
- EntityValidationFeedback: Feedback pesato per singola entita'
- RelationValidationFeedback: Feedback pesato per singola relazione
- EntityValidationAggregator: Aggregazione voti con RLCF weighting

Formula Authority:
    A_u(t) = 0.4*B_u + 0.4*T_u + 0.2*P_u
    - B_u: baseline_credentials (qualifica)
    - T_u: track_record (contributi validati)
    - P_u: level_authority (domain expertise)

Threshold Approvazione:
    Σ(weighted_votes) >= 2.0 per approvazione
    Σ(weighted_votes) <= -2.0 per rifiuto
"""

import warnings
warnings.warn(
    "merlt.rlcf.entity_feedback is deprecated and has no active callers. "
    "This module will be removed in a future version.",
    DeprecationWarning,
    stacklevel=2,
)

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from merlt.api.models.enrichment_models import ValidationResult, ValidationStatus
from merlt.pipeline.enrichment.models import EntityType, RelationType


# =============================================================================
# ENTITY VALIDATION FEEDBACK
# =============================================================================

@dataclass
class EntityValidationFeedback:
    """
    Feedback per validazione di una singola entita'.

    Ogni voto e' pesato per l'authority dell'utente votante.
    Questo permette ai giuristi esperti di avere piu' peso nelle
    decisioni di validazione.

    Attributes:
        entity_id: ID dell'entita' pending
        entity_type: Tipo entita' (17 tipi)
        vote: Tipo voto (approve/reject/edit)
        suggested_edits: Modifiche suggerite se vote=edit
        reason: Motivazione del voto
        user_id: ID utente votante
        user_authority: Authority score utente (0-1)
        timestamp: Momento del voto
    """

    entity_id: str
    entity_type: EntityType
    vote: Literal["approve", "reject", "edit"]

    # Optional
    suggested_edits: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None

    # User info (from VisuaLex)
    user_id: str = ""
    user_authority: float = 0.3  # Default per utenti non verificati

    # Timing
    timestamp: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @property
    def weighted_vote(self) -> float:
        """
        Calcola il voto pesato per authority.

        - approve: +authority
        - reject: -authority
        - edit: +authority * 0.5 (approvazione parziale)

        Returns:
            float: Voto pesato [-1.0, +1.0]
        """
        if self.vote == "approve":
            return self.user_authority
        elif self.vote == "reject":
            return -self.user_authority
        else:  # edit = partial approve
            return self.user_authority * 0.5

    @property
    def is_positive(self) -> bool:
        """True se il voto e' positivo (approve o edit)."""
        return self.vote in ("approve", "edit")

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "entity_id": self.entity_id,
            "entity_type": self.entity_type.value,
            "vote": self.vote,
            "suggested_edits": self.suggested_edits,
            "reason": self.reason,
            "user_id": self.user_id,
            "user_authority": self.user_authority,
            "weighted_vote": self.weighted_vote,
            "timestamp": self.timestamp.isoformat(),
        }


# =============================================================================
# RELATION VALIDATION FEEDBACK
# =============================================================================

@dataclass
class RelationValidationFeedback:
    """
    Feedback per validazione di una singola relazione.

    Attributes:
        relation_id: ID della relazione pending
        relation_type: Tipo relazione (65+ tipi)
        vote: Tipo voto
        suggested_edits: Modifiche suggerite
        reason: Motivazione
        user_id: ID utente votante
        user_authority: Authority score utente
    """

    relation_id: str
    relation_type: RelationType
    vote: Literal["approve", "reject", "edit"]

    suggested_edits: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None

    user_id: str = ""
    user_authority: float = 0.3

    timestamp: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    @property
    def weighted_vote(self) -> float:
        """Calcola il voto pesato per authority."""
        if self.vote == "approve":
            return self.user_authority
        elif self.vote == "reject":
            return -self.user_authority
        else:
            return self.user_authority * 0.5

    @property
    def is_positive(self) -> bool:
        """True se il voto e' positivo."""
        return self.vote in ("approve", "edit")


# =============================================================================
# ENTITY VALIDATION AGGREGATOR
# =============================================================================

class EntityValidationAggregator:
    """
    Aggrega voti per una singola entita' con RLCF weighting.

    Ogni voto e' pesato per l'authority dell'utente.
    L'entita' viene approvata quando Σ(weighted_votes) >= threshold.

    Attributes:
        approval_threshold: Soglia per approvazione (default 2.0)
        rejection_threshold: Soglia per rifiuto (default -2.0)

    Example:
        >>> aggregator = EntityValidationAggregator(approval_threshold=2.0)
        >>> feedbacks = [
        ...     EntityValidationFeedback(entity_id="e1", entity_type=EntityType.CONCETTO,
        ...                              vote="approve", user_authority=0.9),
        ...     EntityValidationFeedback(entity_id="e1", entity_type=EntityType.CONCETTO,
        ...                              vote="approve", user_authority=0.8),
        ...     EntityValidationFeedback(entity_id="e1", entity_type=EntityType.CONCETTO,
        ...                              vote="reject", user_authority=0.5),
        ... ]
        >>> result = aggregator.aggregate(feedbacks)
        >>> result.status  # approved (0.9 + 0.8 - 0.5 = 1.2... wait need more)
    """

    def __init__(
        self,
        approval_threshold: float = 2.0,
        rejection_threshold: float = -2.0,
    ):
        """
        Inizializza l'aggregatore.

        Args:
            approval_threshold: Soglia per approvazione.
                Con authority media 0.5, servono ~4 voti unanimi.
                Con authority alta 0.8, servono ~3 voti.
            rejection_threshold: Soglia per rifiuto (negativo).
        """
        self.approval_threshold = approval_threshold
        self.rejection_threshold = rejection_threshold

    def aggregate(
        self,
        feedbacks: List[EntityValidationFeedback],
    ) -> ValidationResult:
        """
        Aggrega una lista di feedback pesati.

        Args:
            feedbacks: Lista di feedback per la stessa entita'

        Returns:
            ValidationResult con status, score e merged_edits
        """
        if not feedbacks:
            return ValidationResult(
                status=ValidationStatus.PENDING,
                score=0.0,
                merged_edits={},
            )

        # Calcola score totale
        total_score = sum(f.weighted_vote for f in feedbacks)

        # Determina status
        if total_score >= self.approval_threshold:
            # Merge edits se presenti
            merged_edits = self._merge_edits(feedbacks)
            return ValidationResult(
                status=ValidationStatus.APPROVED,
                score=total_score,
                merged_edits=merged_edits,
            )
        elif total_score <= self.rejection_threshold:
            return ValidationResult(
                status=ValidationStatus.REJECTED,
                score=total_score,
                merged_edits={},
            )
        else:
            return ValidationResult(
                status=ValidationStatus.PENDING,
                score=total_score,
                merged_edits={},
            )

    def _merge_edits(
        self,
        feedbacks: List[EntityValidationFeedback],
    ) -> Dict[str, Any]:
        """
        Merge le modifiche suggerite dai votanti.

        Strategia: prendi le modifiche dall'utente con authority piu' alta.
        In futuro si potrebbe implementare merge piu' sofisticato.

        Args:
            feedbacks: Lista feedback con possibili suggested_edits

        Returns:
            Dict con edits merged
        """
        edits_feedbacks = [
            f for f in feedbacks
            if f.vote == "edit" and f.suggested_edits
        ]

        if not edits_feedbacks:
            return {}

        # Prendi edit dall'utente con authority piu' alta
        best_feedback = max(edits_feedbacks, key=lambda f: f.user_authority)
        return best_feedback.suggested_edits or {}

    def calculate_required_votes(
        self,
        average_authority: float = 0.5,
    ) -> int:
        """
        Calcola quanti voti unanimi servono per approvazione.

        Utile per mostrare all'utente quanti voti mancano.

        Args:
            average_authority: Authority media attesa

        Returns:
            Numero di voti unanimi necessari
        """
        if average_authority <= 0:
            return float("inf")
        return int(self.approval_threshold / average_authority) + 1

    def get_progress(
        self,
        feedbacks: List[EntityValidationFeedback],
    ) -> Dict[str, Any]:
        """
        Calcola il progresso verso approvazione/rifiuto.

        Utile per mostrare barra di progresso nell'UI.

        Args:
            feedbacks: Lista feedback correnti

        Returns:
            Dict con progress info
        """
        total_score = sum(f.weighted_vote for f in feedbacks)
        positive_votes = sum(1 for f in feedbacks if f.is_positive)
        negative_votes = sum(1 for f in feedbacks if not f.is_positive)

        # Calcola percentuale verso threshold
        if total_score >= 0:
            progress = min(total_score / self.approval_threshold, 1.0)
            direction = "approval"
        else:
            progress = min(abs(total_score) / abs(self.rejection_threshold), 1.0)
            direction = "rejection"

        return {
            "total_score": total_score,
            "positive_votes": positive_votes,
            "negative_votes": negative_votes,
            "progress": progress,
            "direction": direction,
            "approval_threshold": self.approval_threshold,
            "rejection_threshold": self.rejection_threshold,
        }


# =============================================================================
# RELATION VALIDATION AGGREGATOR
# =============================================================================

class RelationValidationAggregator:
    """
    Aggrega voti per una singola relazione.

    Stessa logica di EntityValidationAggregator.
    """

    def __init__(
        self,
        approval_threshold: float = 2.0,
        rejection_threshold: float = -2.0,
    ):
        self.approval_threshold = approval_threshold
        self.rejection_threshold = rejection_threshold

    def aggregate(
        self,
        feedbacks: List[RelationValidationFeedback],
    ) -> ValidationResult:
        """Aggrega feedback per una relazione."""
        if not feedbacks:
            return ValidationResult(
                status=ValidationStatus.PENDING,
                score=0.0,
            )

        total_score = sum(f.weighted_vote for f in feedbacks)

        if total_score >= self.approval_threshold:
            return ValidationResult(
                status=ValidationStatus.APPROVED,
                score=total_score,
            )
        elif total_score <= self.rejection_threshold:
            return ValidationResult(
                status=ValidationStatus.REJECTED,
                score=total_score,
            )
        else:
            return ValidationResult(
                status=ValidationStatus.PENDING,
                score=total_score,
            )


# =============================================================================
# AUTHORITY IMPACT CALCULATOR
# =============================================================================

class AuthorityImpactCalculator:
    """
    Calcola l'impatto sulla authority dell'utente dopo validazione.

    Quando un'entita' proposta viene approvata/rifiutata,
    l'utente contributor guadagna/perde punti authority.

    Rewards:
        - Entita' approvata: +0.02 authority
        - Relazione approvata: +0.01 authority
        - Voto corretto (in linea con outcome): +0.005 authority
        - Voto sbagliato: -0.002 authority
    """

    # Punti per tipo di contributo
    ENTITY_APPROVED_REWARD = 0.02
    ENTITY_REJECTED_PENALTY = 0.0  # Nessuna penalita', errori capitano
    RELATION_APPROVED_REWARD = 0.01
    VOTE_CORRECT_REWARD = 0.005
    VOTE_WRONG_PENALTY = 0.002

    def calculate_contributor_delta(
        self,
        contribution_type: Literal["entity", "relation"],
        outcome: ValidationStatus,
    ) -> float:
        """
        Calcola delta authority per il contributor.

        Args:
            contribution_type: Tipo contributo
            outcome: Esito finale validazione

        Returns:
            Delta da applicare all'authority
        """
        if outcome == ValidationStatus.APPROVED:
            if contribution_type == "entity":
                return self.ENTITY_APPROVED_REWARD
            else:
                return self.RELATION_APPROVED_REWARD
        elif outcome == ValidationStatus.REJECTED:
            return 0.0  # Nessuna penalita'
        else:
            return 0.0  # Pending, nessun cambio

    def calculate_voter_delta(
        self,
        voter_vote: Literal["approve", "reject", "edit"],
        outcome: ValidationStatus,
    ) -> float:
        """
        Calcola delta authority per un votante.

        Args:
            voter_vote: Come ha votato l'utente
            outcome: Esito finale

        Returns:
            Delta da applicare all'authority
        """
        if outcome == ValidationStatus.PENDING:
            return 0.0

        vote_positive = voter_vote in ("approve", "edit")
        outcome_positive = outcome == ValidationStatus.APPROVED

        if vote_positive == outcome_positive:
            # Voto corretto
            return self.VOTE_CORRECT_REWARD
        else:
            # Voto sbagliato
            return -self.VOTE_WRONG_PENALTY


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "EntityValidationFeedback",
    "RelationValidationFeedback",
    "EntityValidationAggregator",
    "RelationValidationAggregator",
    "AuthorityImpactCalculator",
]
