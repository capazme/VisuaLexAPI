"""
NER RLCF Integration
====================

Integrazione del feedback NER con il sistema RLCF centrale.

Questo modulo connette il NERFeedbackBuffer con:
- AuthoritySyncService: Calcolo authority utente
- Feedback persistence: Salvataggio nel database RLCF
- Authority updates: Aggiornamento track record utente

Workflow:
1. Utente invia feedback NER
2. Sistema recupera/calcola authority utente
3. Feedback salvato nel buffer + database RLCF
4. Track record utente aggiornato
5. Feedback appare nella cronologia

Example:
    >>> integration = NERRLCFIntegration()
    >>> result = await integration.process_ner_feedback(request)
    >>> print(f"Authority: {result.user_authority}")
"""

import structlog
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.rlcf.authority_sync import AuthoritySyncService, VisualexUserSync, AuthorityBreakdown
from merlt.rlcf.ner_feedback_buffer import get_ner_feedback_buffer, NERFeedback
from merlt.rlcf.models import User, Feedback, LegalTask, Response, TaskType, TaskStatus
from merlt.rlcf.database import get_async_session

log = structlog.get_logger()


# =============================================================================
# DATA MODELS
# =============================================================================

@dataclass
class NERFeedbackRLCFResult:
    """
    Risultato dell'elaborazione feedback NER con RLCF.

    Attributes:
        feedback_id: ID univoco del feedback
        success: Se l'operazione è riuscita
        user_authority: Authority calcolata dell'utente
        authority_breakdown: Breakdown componenti authority
        buffer_size: Dimensione buffer NER
        training_ready: Se buffer pronto per training
        persisted_to_db: Se salvato nel database RLCF
        track_record_updated: Se track record aggiornato
        message: Messaggio descrittivo
    """
    feedback_id: str
    success: bool
    user_authority: float
    authority_breakdown: Optional[Dict[str, Any]]
    buffer_size: int
    training_ready: bool
    persisted_to_db: bool
    track_record_updated: bool
    message: str


@dataclass
class NERFeedbackHistoryItem:
    """
    Singolo item nella cronologia feedback NER.

    Attributes:
        feedback_id: ID feedback
        article_urn: URN articolo
        selected_text: Testo citazione
        feedback_type: Tipo (correction/confirmation/annotation)
        correct_reference: Riferimento corretto
        user_authority: Authority utente al momento del feedback
        created_at: Timestamp
    """
    feedback_id: str
    article_urn: str
    selected_text: str
    feedback_type: str
    correct_reference: Dict[str, Any]
    user_authority: float
    created_at: datetime

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dict per JSON."""
        return {
            **asdict(self),
            "created_at": self.created_at.isoformat(),
        }


# =============================================================================
# NER RLCF INTEGRATION
# =============================================================================

class NERRLCFIntegration:
    """
    Integrazione NER feedback con sistema RLCF.

    Responsabilità:
    - Calcolo authority utente via AuthoritySyncService
    - Persistenza feedback nel database RLCF
    - Aggiornamento track record utente
    - Recupero cronologia feedback

    Example:
        >>> integration = NERRLCFIntegration()
        >>>
        >>> # Process feedback
        >>> result = await integration.process_ner_feedback(
        ...     user_id="user-123",
        ...     article_urn="urn:nir:stato:codice.civile:1942-03-16;262:art:1218",
        ...     selected_text="art. 1218 c.c.",
        ...     feedback_type="confirmation",
        ...     correct_reference={"tipo_atto": "codice civile", "articoli": ["1218"]},
        ... )
        >>>
        >>> # Get history
        >>> history = await integration.get_user_ner_history("user-123", limit=20)
    """

    # Action type per authority delta
    NER_ACTION_TYPES = {
        "confirmation": "feedback_simple",
        "correction": "feedback_detailed",
        "annotation": "feedback_detailed",
    }

    def __init__(
        self,
        authority_service: Optional[AuthoritySyncService] = None,
    ):
        """
        Inizializza integrazione.

        Args:
            authority_service: Servizio authority (crea default se None)
        """
        self.authority_service = authority_service or AuthoritySyncService()
        self.buffer = get_ner_feedback_buffer()

        log.info("NERRLCFIntegration initialized")

    async def process_ner_feedback(
        self,
        user_id: str,
        article_urn: str,
        selected_text: str,
        context_window: str,
        feedback_type: str,
        correct_reference: Dict[str, Any],
        original_parsed: Optional[Dict[str, Any]] = None,
        confidence_before: Optional[float] = None,
        source: str = "citation_preview",
        # Optional user data for authority calculation
        user_qualification: Optional[str] = None,
        user_years_experience: int = 0,
        user_total_feedback: int = 0,
    ) -> NERFeedbackRLCFResult:
        """
        Processa feedback NER con integrazione RLCF completa.

        Steps:
        1. Calcola/recupera authority utente
        2. Salva nel buffer NER (in-memory)
        3. Persisti nel database RLCF (Feedback table)
        4. Aggiorna track record utente

        Args:
            user_id: ID utente
            article_urn: URN articolo
            selected_text: Testo citazione selezionata
            context_window: Contesto 500 char
            feedback_type: correction | confirmation | annotation
            correct_reference: Riferimento corretto parsato
            original_parsed: Parsing originale (se disponibile)
            confidence_before: Confidence prima del feedback
            source: Origine feedback
            user_qualification: Qualifica utente (per authority)
            user_years_experience: Anni esperienza
            user_total_feedback: Totale feedback utente

        Returns:
            NERFeedbackRLCFResult con dettagli operazione
        """
        feedback_id = str(uuid4())

        log.info(
            "Processing NER feedback with RLCF",
            feedback_id=feedback_id,
            user_id=user_id,
            feedback_type=feedback_type,
        )

        try:
            # Step 1: Calculate user authority
            user_authority, authority_breakdown = await self._get_user_authority(
                user_id=user_id,
                qualification=user_qualification,
                years_experience=user_years_experience,
                total_feedback=user_total_feedback,
            )

            # Step 2: Add to NER buffer with authority
            await self.buffer.add_feedback(
                article_urn=article_urn,
                user_id=user_id,
                selected_text=selected_text,
                start_offset=0,
                end_offset=len(selected_text),
                context_window=context_window,
                feedback_type=feedback_type,
                correct_reference=correct_reference,
                original_parsed=original_parsed,
                confidence_before=confidence_before,
                source=source,
                user_authority_override=user_authority,
            )

            # Step 3: Persist to RLCF database
            persisted = await self._persist_to_rlcf_db(
                feedback_id=feedback_id,
                user_id=user_id,
                article_urn=article_urn,
                selected_text=selected_text,
                context_window=context_window,
                feedback_type=feedback_type,
                correct_reference=correct_reference,
                original_parsed=original_parsed,
                user_authority=user_authority,
            )

            # Step 4: Update user track record
            track_updated = await self._update_user_track_record(
                user_id=user_id,
                feedback_type=feedback_type,
                current_authority=user_authority,
            )

            # Get buffer stats
            stats = await self.buffer.get_buffer_stats()
            training_ready = self.buffer.should_train()

            message = f"Feedback NER registrato con authority {user_authority:.2f}. "
            message += f"Buffer: {stats['size']}/{stats['training_threshold']}"
            if training_ready:
                message += " - Training pronto!"

            return NERFeedbackRLCFResult(
                feedback_id=feedback_id,
                success=True,
                user_authority=user_authority,
                authority_breakdown=authority_breakdown.to_dict() if authority_breakdown else None,
                buffer_size=stats["size"],
                training_ready=training_ready,
                persisted_to_db=persisted,
                track_record_updated=track_updated,
                message=message,
            )

        except Exception as e:
            log.error(
                "Failed to process NER feedback",
                feedback_id=feedback_id,
                error=str(e),
            )
            return NERFeedbackRLCFResult(
                feedback_id=feedback_id,
                success=False,
                user_authority=0.5,
                authority_breakdown=None,
                buffer_size=0,
                training_ready=False,
                persisted_to_db=False,
                track_record_updated=False,
                message=f"Errore: {str(e)}",
            )

    async def _get_user_authority(
        self,
        user_id: str,
        qualification: Optional[str] = None,
        years_experience: int = 0,
        total_feedback: int = 0,
    ) -> Tuple[float, Optional[AuthorityBreakdown]]:
        """
        Calcola authority utente.

        Se abbiamo dati utente, usa AuthoritySyncService.
        Altrimenti usa stima basata su feedback count.
        """
        if qualification:
            # Full authority calculation
            user_data = VisualexUserSync(
                visualex_user_id=user_id,
                merlt_user_id=user_id,
                qualification=qualification,
                years_experience=years_experience,
                total_feedback=total_feedback,
            )
            authority, breakdown = await self.authority_service.sync_user(user_data)
            return authority, breakdown
        else:
            # Simple estimation based on feedback history
            # Check if user exists in buffer stats
            stats = await self.buffer.get_authority_stats()

            # Find user in top contributors
            for contributor in stats.get("top_contributors", []):
                if contributor["user_id"] == user_id:
                    return contributor["avg_authority"], None

            # Default: use buffer's internal authority calculation
            # (handled by add_feedback)
            return 0.5, None  # Default neutral authority

    async def _persist_to_rlcf_db(
        self,
        feedback_id: str,
        user_id: str,
        article_urn: str,
        selected_text: str,
        context_window: str,
        feedback_type: str,
        correct_reference: Dict[str, Any],
        original_parsed: Optional[Dict[str, Any]],
        user_authority: float,
    ) -> bool:
        """
        Persiste feedback nel database RLCF.

        Crea:
        - LegalTask con TaskType.NER
        - Response con dati citazione
        - Feedback con scores e metadata
        """
        try:
            async with get_async_session() as session:
                # Create or get user
                user = await self._get_or_create_user(session, user_id, user_authority)

                # Create LegalTask for NER
                task = LegalTask(
                    task_type=TaskType.NER.value,
                    input_data={
                        "article_urn": article_urn,
                        "selected_text": selected_text,
                        "context_window": context_window[:500],  # Limit size
                        "feedback_type": feedback_type,
                    },
                    ground_truth_data=correct_reference,
                    status=TaskStatus.CLOSED.value,
                )
                session.add(task)
                await session.flush()

                # Create Response
                response = Response(
                    task_id=task.id,
                    output_data={
                        "original_parsed": original_parsed,
                        "correct_reference": correct_reference,
                    },
                    model_version="ner_feedback_v1",
                )
                session.add(response)
                await session.flush()

                # Create Feedback
                # Map feedback_type to scores
                accuracy = 1.0 if feedback_type == "confirmation" else 0.5
                utility = 0.8 if feedback_type == "correction" else 0.6

                feedback = Feedback(
                    user_id=user.id,
                    response_id=response.id,
                    is_blind_phase=False,
                    accuracy_score=accuracy,
                    utility_score=utility,
                    transparency_score=1.0,  # User feedback is transparent
                    feedback_data={
                        "feedback_id": feedback_id,
                        "feedback_type": feedback_type,
                        "source": "ner_citation",
                        "correct_reference": correct_reference,
                        "original_parsed": original_parsed,
                        "user_authority_at_submission": user_authority,
                    },
                    legal_domain=self._extract_domain(article_urn),
                    pipeline_level="retrieval",  # NER is part of retrieval
                )
                session.add(feedback)

                await session.commit()

                log.info(
                    "NER feedback persisted to RLCF database",
                    feedback_id=feedback_id,
                    task_id=task.id,
                    user_id=user_id,
                )
                return True

        except Exception as e:
            log.warning(
                "Failed to persist NER feedback to RLCF database",
                feedback_id=feedback_id,
                error=str(e),
            )
            return False

    async def _get_or_create_user(
        self,
        session: AsyncSession,
        user_id: str,
        authority: float,
    ) -> User:
        """Get existing user or create new one."""
        # Try to find by username (user_id)
        result = await session.execute(
            select(User).where(User.username == user_id)
        )
        user = result.scalar_one_or_none()

        if user:
            # Update authority if higher
            if authority > user.authority_score:
                user.authority_score = authority
            return user

        # Create new user
        user = User(
            username=user_id,
            authority_score=authority,
            track_record_score=0.0,
            baseline_credential_score=authority,
        )
        session.add(user)
        await session.flush()
        return user

    async def _update_user_track_record(
        self,
        user_id: str,
        feedback_type: str,
        current_authority: float,
    ) -> bool:
        """
        Aggiorna track record utente basato sul feedback NER.
        """
        try:
            action_type = self.NER_ACTION_TYPES.get(feedback_type, "feedback_simple")
            delta = self.authority_service.calculate_authority_delta(
                action=action_type,
                current_authority=current_authority,
            )

            async with get_async_session() as session:
                result = await session.execute(
                    select(User).where(User.username == user_id)
                )
                user = result.scalar_one_or_none()

                if user:
                    user.track_record_score = min(
                        user.track_record_score + delta,
                        1.0
                    )
                    # Update overall authority
                    user.authority_score = min(
                        user.authority_score + delta,
                        1.0
                    )
                    await session.commit()

                    log.debug(
                        "User track record updated",
                        user_id=user_id,
                        delta=delta,
                        new_track_record=user.track_record_score,
                    )
                    return True

            return False

        except Exception as e:
            log.warning(
                "Failed to update user track record",
                user_id=user_id,
                error=str(e),
            )
            return False

    def _extract_domain(self, article_urn: str) -> Optional[str]:
        """Estrae dominio giuridico dall'URN."""
        urn_lower = article_urn.lower()

        if "codice.civile" in urn_lower or "cc" in urn_lower:
            return "civile"
        elif "codice.penale" in urn_lower or "cp" in urn_lower:
            return "penale"
        elif "procedura.civile" in urn_lower or "cpc" in urn_lower:
            return "procedura_civile"
        elif "procedura.penale" in urn_lower or "cpp" in urn_lower:
            return "procedura_penale"
        elif "costituzione" in urn_lower:
            return "costituzionale"
        elif "amministrativo" in urn_lower or "cpa" in urn_lower:
            return "amministrativo"

        return None

    # -------------------------------------------------------------------------
    # HISTORY METHODS
    # -------------------------------------------------------------------------

    async def get_user_ner_history(
        self,
        user_id: str,
        limit: int = 20,
        offset: int = 0,
    ) -> List[NERFeedbackHistoryItem]:
        """
        Recupera cronologia feedback NER per utente.

        Args:
            user_id: ID utente
            limit: Numero massimo risultati
            offset: Offset per paginazione

        Returns:
            Lista di NERFeedbackHistoryItem ordinata per data (recente prima)
        """
        history = []

        try:
            async with get_async_session() as session:
                # Get user
                user_result = await session.execute(
                    select(User).where(User.username == user_id)
                )
                user = user_result.scalar_one_or_none()

                if not user:
                    return []

                # Get NER feedback for this user
                query = (
                    select(Feedback, LegalTask, Response)
                    .join(Response, Feedback.response_id == Response.id)
                    .join(LegalTask, Response.task_id == LegalTask.id)
                    .where(
                        Feedback.user_id == user.id,
                        LegalTask.task_type == TaskType.NER.value,
                    )
                    .order_by(desc(Feedback.submitted_at))
                    .offset(offset)
                    .limit(limit)
                )

                result = await session.execute(query)
                rows = result.all()

                for feedback, task, response in rows:
                    feedback_data = feedback.feedback_data or {}
                    input_data = task.input_data or {}

                    history.append(NERFeedbackHistoryItem(
                        feedback_id=feedback_data.get("feedback_id", str(feedback.id)),
                        article_urn=input_data.get("article_urn", ""),
                        selected_text=input_data.get("selected_text", ""),
                        feedback_type=input_data.get("feedback_type", "unknown"),
                        correct_reference=task.ground_truth_data or {},
                        user_authority=feedback_data.get("user_authority_at_submission", feedback.accuracy_score),
                        created_at=feedback.submitted_at or datetime.now(timezone.utc),
                    ))

        except Exception as e:
            log.warning(
                "Failed to get NER feedback history",
                user_id=user_id,
                error=str(e),
            )

        return history

    async def get_all_ner_history(
        self,
        limit: int = 50,
        offset: int = 0,
        feedback_type: Optional[str] = None,
    ) -> Tuple[List[NERFeedbackHistoryItem], int]:
        """
        Recupera cronologia globale feedback NER.

        Args:
            limit: Numero massimo risultati
            offset: Offset per paginazione
            feedback_type: Filtra per tipo (optional)

        Returns:
            Tupla (lista feedback, total count)
        """
        history = []
        total = 0

        try:
            async with get_async_session() as session:
                # Base query
                base_query = (
                    select(Feedback, LegalTask, Response, User)
                    .join(Response, Feedback.response_id == Response.id)
                    .join(LegalTask, Response.task_id == LegalTask.id)
                    .join(User, Feedback.user_id == User.id)
                    .where(LegalTask.task_type == TaskType.NER.value)
                )

                # Apply feedback_type filter if provided
                if feedback_type:
                    base_query = base_query.where(
                        LegalTask.input_data["feedback_type"].astext == feedback_type
                    )

                # Count total
                count_query = select(func.count()).select_from(base_query.subquery())
                count_result = await session.execute(count_query)
                total = count_result.scalar() or 0

                # Get paginated results
                query = (
                    base_query
                    .order_by(desc(Feedback.submitted_at))
                    .offset(offset)
                    .limit(limit)
                )

                result = await session.execute(query)
                rows = result.all()

                for feedback, task, response, user in rows:
                    feedback_data = feedback.feedback_data or {}
                    input_data = task.input_data or {}

                    history.append(NERFeedbackHistoryItem(
                        feedback_id=feedback_data.get("feedback_id", str(feedback.id)),
                        article_urn=input_data.get("article_urn", ""),
                        selected_text=input_data.get("selected_text", ""),
                        feedback_type=input_data.get("feedback_type", "unknown"),
                        correct_reference=task.ground_truth_data or {},
                        user_authority=feedback_data.get("user_authority_at_submission", 0.5),
                        created_at=feedback.submitted_at or datetime.now(timezone.utc),
                    ))

        except Exception as e:
            log.warning(
                "Failed to get global NER feedback history",
                error=str(e),
            )

        return history, total

    async def get_ner_feedback_stats(self) -> Dict[str, Any]:
        """
        Statistiche aggregate feedback NER.

        Returns:
            Dict con statistiche:
            - total_feedback: Totale feedback
            - by_type: Count per tipo
            - by_domain: Count per dominio
            - avg_authority: Authority media
            - top_contributors: Top 5 contributori
        """
        stats = {
            "total_feedback": 0,
            "by_type": {},
            "by_domain": {},
            "avg_authority": 0.0,
            "top_contributors": [],
            "buffer_stats": {},
        }

        # Get buffer stats
        stats["buffer_stats"] = await self.buffer.get_buffer_stats()
        stats["authority_stats"] = await self.buffer.get_authority_stats()

        try:
            async with get_async_session() as session:
                # Count total NER feedback
                count_result = await session.execute(
                    select(func.count(Feedback.id))
                    .join(Response, Feedback.response_id == Response.id)
                    .join(LegalTask, Response.task_id == LegalTask.id)
                    .where(LegalTask.task_type == TaskType.NER.value)
                )
                stats["total_feedback"] = count_result.scalar() or 0

                # Count by domain
                domain_result = await session.execute(
                    select(
                        Feedback.legal_domain,
                        func.count(Feedback.id)
                    )
                    .join(Response, Feedback.response_id == Response.id)
                    .join(LegalTask, Response.task_id == LegalTask.id)
                    .where(LegalTask.task_type == TaskType.NER.value)
                    .group_by(Feedback.legal_domain)
                )
                stats["by_domain"] = {
                    domain or "unknown": count
                    for domain, count in domain_result.all()
                }

        except Exception as e:
            log.warning(
                "Failed to get NER feedback stats from database",
                error=str(e),
            )

        return stats


# =============================================================================
# SINGLETON
# =============================================================================

_global_integration: Optional[NERRLCFIntegration] = None


def get_ner_rlcf_integration() -> NERRLCFIntegration:
    """
    Ottiene istanza singleton dell'integrazione.

    Returns:
        NERRLCFIntegration globale
    """
    global _global_integration
    if _global_integration is None:
        _global_integration = NERRLCFIntegration()
    return _global_integration


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "NERRLCFIntegration",
    "NERFeedbackRLCFResult",
    "NERFeedbackHistoryItem",
    "get_ner_rlcf_integration",
]
