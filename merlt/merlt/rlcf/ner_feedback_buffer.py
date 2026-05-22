"""
NER Feedback Buffer con RLCF Authority Integration
===================================================

Buffer per raccogliere feedback NER su citazioni giuridiche con
supporto per authority-weighted training (RLCF integration).

Il buffer accumula correzioni/conferme dall'utente tramite l'endpoint
`/enrichment/ner-feedback` e, quando raggiunge la threshold (50+ samples),
esporta i dati in formato spaCy per training del NER.

RLCF Features:
- Authority-weighted samples: feedback da utenti esperti pesa di più
- User authority calculation: basata su feedback history + accuracy
- Weighted export: samples con weight per training

Workflow:
1. Utente seleziona citazione in CitationPreview
2. Frontend invia feedback (correzione o conferma) con user_id
3. Buffer calcola user_authority e accumula feedback
4. Quando buffer >= 50, training_ready=True
5. Training usa authority come sample weight

Design:
- In-memory storage (opzione future: PostgreSQL persistence)
- Thread-safe con asyncio.Lock
- Export formato spaCy v3 con weights: List[Tuple[str, Dict, float]]
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4
import asyncio
import structlog

log = structlog.get_logger()

# =============================================================================
# DATA MODELS
# =============================================================================


@dataclass
class NERFeedback:
    """
    Singolo feedback NER da utente con authority RLCF.

    Rappresenta una correzione/conferma di parsing citazione,
    con peso basato sull'authority dell'utente.
    """

    feedback_id: str
    article_urn: str
    user_id: str

    # Testo citazione
    selected_text: str
    start_offset: int
    end_offset: int
    context_window: str

    # Tipo feedback
    feedback_type: str  # "correction" | "confirmation" | "annotation"

    # Parsing
    original_parsed: Optional[Dict[str, Any]]
    correct_reference: Dict[str, Any]  # {tipo_atto, numero, anno, articoli}

    # Metadata
    confidence_before: Optional[float]
    source: str
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    # RLCF Authority
    user_authority: float = 0.5  # Default: neutral authority [0.0-1.0]
    sample_weight: float = 1.0  # Computed from authority for training

    def to_spacy_format(self) -> Tuple[str, Dict[str, List[Tuple[int, int, str]]]]:
        """
        Converte il feedback in formato spaCy training.

        Returns:
            (context_text, {"entities": [(start, end, label), ...]})

        Example:
            ("Art. 1218 c.c. prevede...", {"entities": [(0, 13, "NORMA")]})
        """
        # Usa context_window per avere più contesto
        text = self.context_window

        # Calcola offset nel context_window (assumiamo selected_text centrato)
        # Per semplicità, cerchiamo selected_text nel context
        start_in_context = text.find(self.selected_text)
        if start_in_context == -1:
            # Fallback: usa offset originali (potrebbero essere sfasati)
            start_in_context = 0
            end_in_context = len(self.selected_text)
        else:
            end_in_context = start_in_context + len(self.selected_text)

        # Label dipende dal tipo di riferimento
        label = "NORMA"  # Default

        # Opzionale: possiamo aggiungere granularità (ARTICOLO, COMMA, etc.)
        # Per ora usiamo label unica "NORMA"

        entities = [(start_in_context, end_in_context, label)]

        return (text, {"entities": entities})

    def to_dict(self) -> Dict[str, Any]:
        """Serializza a dict per JSON export."""
        data = asdict(self)
        data["created_at"] = self.created_at.isoformat()
        return data


# =============================================================================
# NER FEEDBACK BUFFER
# =============================================================================


@dataclass
class UserNERStats:
    """
    Statistiche NER per singolo utente.

    Usato per calcolare authority dinamica basata su:
    - Numero totale feedback
    - Accuratezza (se verificabile tramite consensus)
    - Consistency (varianza nelle annotazioni)
    """

    user_id: str
    total_feedback: int = 0
    corrections: int = 0
    confirmations: int = 0
    annotations: int = 0
    # Future: accuracy tracking tramite peer validation
    validated_correct: int = 0
    validated_incorrect: int = 0


class NERFeedbackBuffer:
    """
    Buffer in-memory per feedback NER con RLCF Authority.

    Raccoglie feedback utente su citazioni giuridiche e prepara
    dati per training spaCy NER con sample weights basati su
    authority dell'utente.

    Authority Calculation:
    - Base authority: 0.3 (nuovo utente)
    - +0.1 per ogni 10 feedback (max +0.3)
    - +0.2 per corrections (più informativi delle confirmations)
    - +0.2 se accuracy > 80% (quando disponibile)
    - Capped a [0.1, 1.0]
    """

    # Authority calculation constants
    BASE_AUTHORITY = 0.3
    FEEDBACK_BONUS_PER_10 = 0.1
    MAX_FEEDBACK_BONUS = 0.3
    CORRECTION_BONUS = 0.1
    HIGH_ACCURACY_BONUS = 0.2
    MIN_AUTHORITY = 0.1
    MAX_AUTHORITY = 1.0

    def __init__(self, training_threshold: int = 50):
        """
        Args:
            training_threshold: Numero minimo feedback per considerare training ready
        """
        self._buffer: List[NERFeedback] = []
        self._user_stats: Dict[str, UserNERStats] = {}
        self._lock = asyncio.Lock()
        self._training_threshold = training_threshold

        log.info(
            "NERFeedbackBuffer initialized with RLCF authority",
            training_threshold=training_threshold,
        )

    def _calculate_user_authority(self, user_id: str, feedback_type: str) -> float:
        """
        Calcola authority dell'utente basata su feedback history.

        Formula:
            authority = BASE + feedback_bonus + correction_bonus + accuracy_bonus
            - BASE = 0.3
            - feedback_bonus = min(total_feedback / 10 * 0.1, 0.3)
            - correction_bonus = 0.1 se feedback_type == "correction"
            - accuracy_bonus = 0.2 se accuracy > 80%

        Args:
            user_id: ID utente
            feedback_type: Tipo del feedback corrente

        Returns:
            Authority score [0.1, 1.0]
        """
        # Get or create user stats
        if user_id not in self._user_stats:
            self._user_stats[user_id] = UserNERStats(user_id=user_id)

        stats = self._user_stats[user_id]

        # Base authority
        authority = self.BASE_AUTHORITY

        # Feedback volume bonus (più feedback = più esperienza)
        feedback_bonus = min(
            stats.total_feedback / 10 * self.FEEDBACK_BONUS_PER_10,
            self.MAX_FEEDBACK_BONUS,
        )
        authority += feedback_bonus

        # Correction bonus (correzioni sono più informative)
        if feedback_type == "correction":
            authority += self.CORRECTION_BONUS

        # Accuracy bonus (quando abbiamo dati di validazione)
        total_validated = stats.validated_correct + stats.validated_incorrect
        if total_validated >= 5:  # Min 5 validazioni per calcolare accuracy
            accuracy = stats.validated_correct / total_validated
            if accuracy >= 0.8:
                authority += self.HIGH_ACCURACY_BONUS

        # Clamp to valid range
        authority = max(self.MIN_AUTHORITY, min(self.MAX_AUTHORITY, authority))

        return authority

    def _authority_to_sample_weight(self, authority: float) -> float:
        """
        Converte authority in sample weight per training.

        Mappa [0.1, 1.0] authority → [0.5, 2.0] weight
        Utenti con alta authority hanno peso doppio.

        Args:
            authority: User authority [0.1, 1.0]

        Returns:
            Sample weight [0.5, 2.0]
        """
        # Linear mapping: 0.1 → 0.5, 1.0 → 2.0
        return 0.5 + (authority - 0.1) * (1.5 / 0.9)

    async def add_feedback(
        self,
        article_urn: str,
        user_id: str,
        selected_text: str,
        start_offset: int,
        end_offset: int,
        context_window: str,
        feedback_type: str,
        correct_reference: Dict[str, Any],
        original_parsed: Optional[Dict[str, Any]] = None,
        confidence_before: Optional[float] = None,
        source: str = "citation_preview",
        user_authority_override: Optional[float] = None,
    ) -> str:
        """
        Aggiunge feedback al buffer con RLCF authority weighting.

        Args:
            article_urn: URN articolo sorgente
            user_id: UUID utente
            selected_text: Testo citazione
            start_offset: Offset inizio
            end_offset: Offset fine
            context_window: 500 char prima/dopo
            feedback_type: correction | confirmation | annotation
            correct_reference: Riferimento corretto parsato
            original_parsed: Parsing originale (se disponibile)
            confidence_before: Confidence parser prima del feedback
            source: Origine feedback
            user_authority_override: Authority esterna (da AuthorityModule)

        Returns:
            feedback_id: ID univoco del feedback
        """
        async with self._lock:
            feedback_id = str(uuid4())

            # Calculate or use provided authority
            if user_authority_override is not None:
                user_authority = user_authority_override
            else:
                user_authority = self._calculate_user_authority(user_id, feedback_type)

            # Convert to sample weight
            sample_weight = self._authority_to_sample_weight(user_authority)

            # Update user stats
            if user_id not in self._user_stats:
                self._user_stats[user_id] = UserNERStats(user_id=user_id)

            stats = self._user_stats[user_id]
            stats.total_feedback += 1
            if feedback_type == "correction":
                stats.corrections += 1
            elif feedback_type == "confirmation":
                stats.confirmations += 1
            elif feedback_type == "annotation":
                stats.annotations += 1

            # Create feedback with authority
            feedback = NERFeedback(
                feedback_id=feedback_id,
                article_urn=article_urn,
                user_id=user_id,
                selected_text=selected_text,
                start_offset=start_offset,
                end_offset=end_offset,
                context_window=context_window,
                feedback_type=feedback_type,
                original_parsed=original_parsed,
                correct_reference=correct_reference,
                confidence_before=confidence_before,
                source=source,
                user_authority=user_authority,
                sample_weight=sample_weight,
            )

            self._buffer.append(feedback)

            log.info(
                "NER feedback added with RLCF authority",
                feedback_id=feedback_id,
                feedback_type=feedback_type,
                user_id=user_id,
                user_authority=round(user_authority, 3),
                sample_weight=round(sample_weight, 3),
                buffer_size=len(self._buffer),
                training_ready=self.should_train(),
            )

            return feedback_id

    async def get_all(self) -> List[NERFeedback]:
        """
        Ritorna tutti i feedback nel buffer.

        Returns:
            Lista di NERFeedback
        """
        async with self._lock:
            return self._buffer.copy()

    async def get_buffer_stats(self) -> Dict[str, Any]:
        """
        Ritorna statistiche buffer.

        Returns:
            {
                size: int,
                training_ready: bool,
                training_threshold: int,
                feedback_types: Dict[str, int],
                sources: Dict[str, int],
                oldest_feedback: Optional[datetime],
                newest_feedback: Optional[datetime],
            }
        """
        async with self._lock:
            if not self._buffer:
                return {
                    "size": 0,
                    "training_ready": False,
                    "training_threshold": self._training_threshold,
                    "feedback_types": {},
                    "sources": {},
                    "oldest_feedback": None,
                    "newest_feedback": None,
                }

            # Count feedback types
            feedback_types = {}
            sources = {}
            for fb in self._buffer:
                feedback_types[fb.feedback_type] = (
                    feedback_types.get(fb.feedback_type, 0) + 1
                )
                sources[fb.source] = sources.get(fb.source, 0) + 1

            # Timestamps
            oldest = min(fb.created_at for fb in self._buffer)
            newest = max(fb.created_at for fb in self._buffer)

            return {
                "size": len(self._buffer),
                "training_ready": self.should_train(),
                "training_threshold": self._training_threshold,
                "feedback_types": feedback_types,
                "sources": sources,
                "oldest_feedback": oldest.isoformat(),
                "newest_feedback": newest.isoformat(),
            }

    def has_data(self) -> bool:
        """
        Verifica se il buffer contiene almeno un feedback.

        Returns:
            True se buffer non vuoto
        """
        return len(self._buffer) > 0

    def get_all(self) -> List[NERFeedback]:
        """
        Ritorna tutti i feedback nel buffer (sync version).

        Returns:
            Lista di NERFeedback
        """
        return self._buffer.copy()

    def should_train(self) -> bool:
        """
        Verifica se il buffer ha raggiunto la threshold per training.

        Returns:
            True se size >= training_threshold
        """
        return len(self._buffer) >= self._training_threshold

    async def export_for_spacy(self) -> List[Tuple[str, Dict[str, List[Tuple[int, int, str]]]]]:
        """
        Esporta buffer in formato spaCy v3 training.

        Format:
            [
                ("Art. 1218 c.c. prevede...", {"entities": [(0, 13, "NORMA")]}),
                ("Vedi anche l'art. 52 c.p.", {"entities": [(15, 25, "NORMA")]}),
                ...
            ]

        Returns:
            Lista di (text, {"entities": [(start, end, label), ...]})
        """
        async with self._lock:
            spacy_data = []
            for fb in self._buffer:
                try:
                    spacy_entry = fb.to_spacy_format()
                    spacy_data.append(spacy_entry)
                except Exception as e:
                    log.warning(
                        "Failed to convert feedback to spaCy format",
                        feedback_id=fb.feedback_id,
                        error=str(e),
                    )
                    continue

            log.info(
                "NER feedback exported for spaCy",
                total_samples=len(spacy_data),
            )

            return spacy_data

    async def export_for_spacy_weighted(
        self,
    ) -> List[Tuple[str, Dict[str, List[Tuple[int, int, str]]], float]]:
        """
        Esporta buffer in formato spaCy v3 con RLCF authority weights.

        Ogni sample include il peso calcolato dall'authority dell'utente.
        Utile per weighted training dove feedback da esperti pesano di più.

        Format:
            [
                ("Art. 1218 c.c. prevede...", {"entities": [(0, 13, "NORMA")]}, 1.5),
                ("Vedi anche l'art. 52 c.p.", {"entities": [(15, 25, "NORMA")]}, 0.8),
                ...
            ]

        Returns:
            Lista di (text, {"entities": [...]}, sample_weight)

        Example:
            >>> data = await buffer.export_for_spacy_weighted()
            >>> for text, annotations, weight in data:
            ...     # weight in [0.5, 2.0]: 0.5=novice, 2.0=expert
            ...     print(f"Weight {weight:.2f}: {text[:50]}...")
        """
        async with self._lock:
            weighted_data = []
            for fb in self._buffer:
                try:
                    text, annotations = fb.to_spacy_format()
                    weighted_data.append((text, annotations, fb.sample_weight))
                except Exception as e:
                    log.warning(
                        "Failed to convert feedback to weighted spaCy format",
                        feedback_id=fb.feedback_id,
                        error=str(e),
                    )
                    continue

            # Log statistiche pesi
            if weighted_data:
                weights = [w for _, _, w in weighted_data]
                avg_weight = sum(weights) / len(weights)
                min_weight = min(weights)
                max_weight = max(weights)
            else:
                avg_weight = min_weight = max_weight = 0.0

            log.info(
                "NER feedback exported for weighted spaCy training",
                total_samples=len(weighted_data),
                avg_weight=round(avg_weight, 3),
                min_weight=round(min_weight, 3),
                max_weight=round(max_weight, 3),
            )

            return weighted_data

    async def get_authority_stats(self) -> Dict[str, Any]:
        """
        Ritorna statistiche sulle authority degli utenti nel buffer.

        Returns:
            Dict con statistiche authority:
                - total_users: Numero utenti unici
                - avg_authority: Authority media
                - authority_distribution: Distribuzione per range
                - top_contributors: Top 5 utenti per feedback count
        """
        async with self._lock:
            if not self._buffer:
                return {
                    "total_users": 0,
                    "avg_authority": 0.0,
                    "authority_distribution": {},
                    "top_contributors": [],
                }

            # Calcola stats per utente
            user_feedback_count: Dict[str, int] = {}
            user_authority_sum: Dict[str, float] = {}

            for fb in self._buffer:
                uid = fb.user_id
                user_feedback_count[uid] = user_feedback_count.get(uid, 0) + 1
                user_authority_sum[uid] = user_authority_sum.get(uid, 0) + fb.user_authority

            # Calcola authority media per utente
            user_avg_authority = {
                uid: user_authority_sum[uid] / user_feedback_count[uid]
                for uid in user_feedback_count
            }

            # Distribuzione authority
            distribution = {"low": 0, "medium": 0, "high": 0, "expert": 0}
            for auth in user_avg_authority.values():
                if auth < 0.3:
                    distribution["low"] += 1
                elif auth < 0.5:
                    distribution["medium"] += 1
                elif auth < 0.7:
                    distribution["high"] += 1
                else:
                    distribution["expert"] += 1

            # Top contributors
            sorted_users = sorted(
                user_feedback_count.items(), key=lambda x: x[1], reverse=True
            )[:5]
            top_contributors = [
                {
                    "user_id": uid,
                    "feedback_count": count,
                    "avg_authority": round(user_avg_authority[uid], 3),
                }
                for uid, count in sorted_users
            ]

            return {
                "total_users": len(user_feedback_count),
                "avg_authority": round(
                    sum(user_avg_authority.values()) / len(user_avg_authority), 3
                ),
                "authority_distribution": distribution,
                "top_contributors": top_contributors,
            }

    async def export_to_dict(self) -> List[Dict[str, Any]]:
        """
        Esporta buffer come lista di dict (per JSON).

        Returns:
            Lista di dict con feedback serializzati
        """
        async with self._lock:
            return [fb.to_dict() for fb in self._buffer]

    async def clear(self) -> int:
        """
        Svuota il buffer (dopo training).

        Returns:
            Numero di feedback rimossi
        """
        async with self._lock:
            count = len(self._buffer)
            self._buffer.clear()
            log.info("NER feedback buffer cleared", removed_count=count)
            return count

    async def remove_feedback(self, feedback_id: str) -> bool:
        """
        Rimuove un feedback specifico.

        Args:
            feedback_id: ID del feedback da rimuovere

        Returns:
            True se rimosso, False se non trovato
        """
        async with self._lock:
            for i, fb in enumerate(self._buffer):
                if fb.feedback_id == feedback_id:
                    del self._buffer[i]
                    log.info("NER feedback removed", feedback_id=feedback_id)
                    return True
            return False


# =============================================================================
# SINGLETON INSTANCE
# =============================================================================

# Buffer globale in-memory (reset al restart server)
_global_buffer: Optional[NERFeedbackBuffer] = None


def get_ner_feedback_buffer() -> NERFeedbackBuffer:
    """
    Ottiene l'istanza singleton del buffer.

    Returns:
        NERFeedbackBuffer globale
    """
    global _global_buffer
    if _global_buffer is None:
        _global_buffer = NERFeedbackBuffer(training_threshold=50)
    return _global_buffer


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    "NERFeedback",
    "NERFeedbackBuffer",
    "get_ner_feedback_buffer",
]
