"""
Authority Sync Service
======================

Sincronizzazione authority tra VisuaLex e MERL-T.

Calcola authority score basandosi su:
- B_u: Baseline credentials (qualifica, esperienza)
- T_u: Track record (feedback, ingestion, validazioni)
- P_u: Domain authority (attività per ambito giuridico)

Formula: A_u(t) = 0.4*B_u + 0.4*T_u + 0.2*P_u

Esempio:
    >>> from merlt.rlcf.authority_sync import AuthoritySyncService, VisualexUserSync
    >>>
    >>> service = AuthoritySyncService()
    >>> user_data = VisualexUserSync(
    ...     visualex_user_id="visualex-123",
    ...     merlt_user_id="merl-t-456",
    ...     qualification="avvocato",
    ...     years_experience=5,
    ...     total_feedback=20,
    ...     domain_activity={"civile": 50, "penale": 30},
    ... )
    >>> authority = await service.sync_user(user_data)
    >>> print(f"Authority: {authority}")
"""

import structlog
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple


log = structlog.get_logger()


# =============================================================================
# DATACLASS
# =============================================================================

@dataclass
class VisualexUserSync:
    """
    Dati utente da sincronizzare da VisuaLex.

    Attributes:
        visualex_user_id: ID utente in VisuaLex
        merlt_user_id: UUID condiviso MERL-T
        qualification: Qualifica professionale
        specializations: Lista specializzazioni
        years_experience: Anni di esperienza
        institution: Istituzione (opzionale)
        total_feedback: Totale feedback inviati
        validated_feedback: Feedback peer-validated
        ingestions: Numero ingestion effettuate
        validations: Numero validazioni effettuate
        domain_activity: Attività per dominio giuridico
    """
    visualex_user_id: str
    merlt_user_id: str

    # Credenziali
    qualification: str
    specializations: List[str] = field(default_factory=list)
    years_experience: int = 0
    institution: Optional[str] = None

    # Attività aggregata
    total_feedback: int = 0
    validated_feedback: int = 0
    ingestions: int = 0
    validations: int = 0

    # Dossier breakdown per dominio
    domain_activity: Dict[str, int] = field(default_factory=dict)

    # Timestamp
    synced_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class AuthorityBreakdown:
    """
    Breakdown del calcolo authority.

    Attributes:
        baseline: Punteggio baseline (B_u)
        track_record: Punteggio track record (T_u)
        level_authority: Punteggio domain authority (P_u)
        domain_scores: Punteggi per singolo dominio
        final_authority: Authority finale calcolata
    """
    baseline: float
    track_record: float
    level_authority: float
    domain_scores: Dict[str, float]
    final_authority: float

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario."""
        return {
            "baseline": self.baseline,
            "track_record": self.track_record,
            "level_authority": self.level_authority,
            "domain_scores": self.domain_scores,
            "final_authority": self.final_authority,
        }


# =============================================================================
# AUTHORITY SYNC SERVICE
# =============================================================================

class AuthoritySyncService:
    """
    Servizio per sincronizzazione authority tra VisuaLex e MERL-T.

    Implementa la formula:
    A_u(t) = 0.4*B_u + 0.4*T_u + 0.2*P_u

    Dove:
    - B_u: Baseline credentials (qualifica, esperienza, specializzazioni)
    - T_u: Track record (feedback, ingestion, validazioni)
    - P_u: Domain authority (attività per ambito giuridico)

    Esempio:
        >>> service = AuthoritySyncService()
        >>> authority = await service.sync_user(user_data)
    """

    # Pesi per formula authority
    WEIGHT_BASELINE = 0.4
    WEIGHT_TRACK_RECORD = 0.4
    WEIGHT_LEVEL_AUTHORITY = 0.2

    # Mapping qualifica → baseline score
    QUALIFICATION_SCORES: Dict[str, float] = {
        "studente": 0.2,
        "laureato": 0.3,
        "praticante": 0.4,
        "avvocato": 0.6,
        "avvocato_specializzato": 0.7,
        "magistrato": 0.8,
        "docente": 0.8,
        "professore": 0.85,
        "giudice_suprema": 0.9,
        "accademico": 0.85,
    }

    # Limiti per bonus
    MAX_YEARS_BONUS = 0.1
    MAX_SPEC_BONUS = 0.05

    # Limiti per track record
    MAX_FEEDBACK_CONTRIBUTION = 0.3
    MAX_VALIDATED_CONTRIBUTION = 0.2
    MAX_INGESTION_CONTRIBUTION = 0.2
    MAX_VALIDATION_CONTRIBUTION = 0.1

    def __init__(
        self,
        db_client: Optional[Any] = None,
        cache_client: Optional[Any] = None,
    ):
        """
        Inizializza servizio.

        Args:
            db_client: Client database per persistenza (opzionale)
            cache_client: Client cache per performance (opzionale)
        """
        self.db_client = db_client
        self.cache_client = cache_client

        log.info("AuthoritySyncService initialized")

    async def sync_user(
        self,
        data: VisualexUserSync,
    ) -> Tuple[float, AuthorityBreakdown]:
        """
        Sincronizza authority utente da VisuaLex.

        Args:
            data: Dati utente da VisuaLex

        Returns:
            Tupla (authority_score, breakdown)
        """
        log.info(
            "Syncing user authority",
            visualex_id=data.visualex_user_id,
            merlt_id=data.merlt_user_id,
            qualification=data.qualification,
        )

        # Calcola componenti
        baseline = self._calculate_baseline(
            qualification=data.qualification,
            years_experience=data.years_experience,
            specializations=data.specializations,
        )

        track_record = self._calculate_track_record(
            total_feedback=data.total_feedback,
            validated_feedback=data.validated_feedback,
            ingestions=data.ingestions,
            validations=data.validations,
        )

        domain_scores = self._calculate_domain_authority(data.domain_activity)
        level_authority = sum(domain_scores.values()) / max(len(domain_scores), 1) if domain_scores else 0.0

        # Formula finale
        final_authority = (
            self.WEIGHT_BASELINE * baseline +
            self.WEIGHT_TRACK_RECORD * track_record +
            self.WEIGHT_LEVEL_AUTHORITY * level_authority
        )

        # Clamp to 0-1
        final_authority = max(0.0, min(1.0, final_authority))

        breakdown = AuthorityBreakdown(
            baseline=baseline,
            track_record=track_record,
            level_authority=level_authority,
            domain_scores=domain_scores,
            final_authority=final_authority,
        )

        # Persisti se db disponibile
        if self.db_client:
            await self._persist_authority(data.merlt_user_id, final_authority, breakdown)

        # Cache se disponibile
        if self.cache_client:
            await self._cache_authority(data.merlt_user_id, final_authority, breakdown)

        log.info(
            "User authority synced",
            merlt_id=data.merlt_user_id,
            authority=final_authority,
            baseline=baseline,
            track_record=track_record,
            level_authority=level_authority,
        )

        return final_authority, breakdown

    def _calculate_baseline(
        self,
        qualification: str,
        years_experience: int,
        specializations: List[str],
    ) -> float:
        """
        Calcola baseline credentials (B_u).

        B_u = base_score + years_bonus + specialization_bonus

        Args:
            qualification: Qualifica professionale
            years_experience: Anni di esperienza
            specializations: Lista specializzazioni

        Returns:
            Baseline score (0-1)
        """
        # Base score da qualifica
        qualification_lower = qualification.lower().strip()
        base = self.QUALIFICATION_SCORES.get(qualification_lower, 0.3)

        # Bonus anni (max 0.1)
        years_bonus = min(years_experience * 0.01, self.MAX_YEARS_BONUS)

        # Bonus specializzazioni (max 0.05)
        spec_bonus = min(len(specializations) * 0.025, self.MAX_SPEC_BONUS)

        return min(base + years_bonus + spec_bonus, 1.0)

    def _calculate_track_record(
        self,
        total_feedback: int,
        validated_feedback: int,
        ingestions: int,
        validations: int,
    ) -> float:
        """
        Calcola track record score (T_u).

        T_u = feedback_score + validated_score + ingestion_score + validation_score

        Args:
            total_feedback: Totale feedback inviati
            validated_feedback: Feedback peer-validated
            ingestions: Numero ingestion effettuate
            validations: Numero validazioni effettuate

        Returns:
            Track record score (0-1)
        """
        # Feedback contribution (max 0.3)
        feedback_score = min(total_feedback * 0.01, self.MAX_FEEDBACK_CONTRIBUTION)

        # Validated feedback contribution (max 0.2)
        validated_score = min(validated_feedback * 0.02, self.MAX_VALIDATED_CONTRIBUTION)

        # Ingestion contribution (max 0.2)
        ingestion_score = min(ingestions * 0.05, self.MAX_INGESTION_CONTRIBUTION)

        # Validation contribution (max 0.1)
        validation_score = min(validations * 0.01, self.MAX_VALIDATION_CONTRIBUTION)

        total = feedback_score + validated_score + ingestion_score + validation_score

        return min(total, 1.0)

    def _calculate_domain_authority(
        self,
        domain_activity: Dict[str, int],
    ) -> Dict[str, float]:
        """
        Calcola authority per dominio giuridico (P_u).

        P_u_domain = normalized_activity * engagement_factor

        Args:
            domain_activity: Attività per dominio (es. {"civile": 50, "penale": 30})

        Returns:
            Dict dominio → score (0-1)
        """
        if not domain_activity:
            return {}

        total_activity = sum(domain_activity.values())
        if total_activity == 0:
            return {}

        domain_scores = {}
        for domain, activity in domain_activity.items():
            # Proporzione attività
            proportion = activity / total_activity

            # Engagement factor basato su attività assoluta
            # Più attività = engagement più alto (saturazione a 100)
            engagement = min(activity / 100, 1.0)

            # Score = proporzione * engagement
            score = proportion * engagement

            # Boost per domini con alta attività assoluta
            if activity > 50:
                score = min(score * 1.2, 1.0)

            domain_scores[domain] = round(score, 3)

        return domain_scores

    async def _persist_authority(
        self,
        user_id: str,
        authority: float,
        breakdown: AuthorityBreakdown,
    ) -> None:
        """Persiste authority nel database."""
        # Implementazione dipende dal client db
        log.debug(
            "Persisting authority",
            user_id=user_id,
            authority=authority,
        )

    async def _cache_authority(
        self,
        user_id: str,
        authority: float,
        breakdown: AuthorityBreakdown,
    ) -> None:
        """Cache authority per performance."""
        # Implementazione dipende dal client cache
        log.debug(
            "Caching authority",
            user_id=user_id,
            authority=authority,
        )

    # -------------------------------------------------------------------------
    # HELPER METHODS
    # -------------------------------------------------------------------------

    def calculate_authority_delta(
        self,
        action: str,
        current_authority: float,
    ) -> float:
        """
        Calcola delta authority per una singola azione.

        Utile per aggiornamenti incrementali senza ricalcolo completo.

        Args:
            action: Tipo di azione (feedback, validation, ingestion)
            current_authority: Authority corrente

        Returns:
            Delta da applicare
        """
        ACTION_DELTAS = {
            "feedback_simple": 0.001,
            "feedback_detailed": 0.005,
            "validation_correct": 0.003,
            "validation_incorrect": -0.002,
            "ingestion_approved": 0.01,
            "disagreement_annotation": 0.008,
            "peer_validation": 0.002,
        }

        delta = ACTION_DELTAS.get(action, 0)

        # Diminishing returns per authority alta
        if current_authority > 0.9:
            delta *= 0.25
        elif current_authority > 0.8:
            delta *= 0.5

        return delta

    def estimate_authority(
        self,
        qualification: str,
        years_experience: int = 0,
        specializations: Optional[List[str]] = None,
    ) -> float:
        """
        Stima rapida authority senza dati completi.

        Utile per nuovi utenti o preview.

        Args:
            qualification: Qualifica
            years_experience: Anni esperienza
            specializations: Specializzazioni

        Returns:
            Authority stimata
        """
        baseline = self._calculate_baseline(
            qualification=qualification,
            years_experience=years_experience,
            specializations=specializations or [],
        )

        # Senza track record e domain activity, usa solo baseline pesato
        return baseline * self.WEIGHT_BASELINE


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "VisualexUserSync",
    "AuthorityBreakdown",
    "AuthoritySyncService",
]
