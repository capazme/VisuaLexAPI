"""
Multilevel Feedback
====================

Strutture dati per feedback multi-livello nel sistema MERL-T.

Il feedback è strutturato su 3 livelli:
1. **Retrieval**: Qualità dei risultati recuperati (precision, recall)
2. **Reasoning**: Qualità del ragionamento giuridico (logica, fondatezza)
3. **Synthesis**: Qualità della sintesi finale (chiarezza, completezza)

Ogni livello ha metriche specifiche per consentire apprendimento granulare
delle policy (gating, traversal, tool selection).

Esempio:
    >>> from merlt.rlcf.multilevel_feedback import MultilevelFeedback
    >>>
    >>> feedback = MultilevelFeedback(
    ...     retrieval_feedback={
    ...         "precision": 0.8,
    ...         "recall": 0.7,
    ...         "sources_relevant": 4,
    ...         "sources_total": 5
    ...     },
    ...     reasoning_feedback={
    ...         "logical_coherence": 0.9,
    ...         "legal_soundness": 0.85,
    ...         "citation_quality": 0.8
    ...     },
    ...     synthesis_feedback={
    ...         "clarity": 0.9,
    ...         "completeness": 0.85,
    ...         "usefulness": 0.9
    ...     }
    ... )
    >>> print(f"Overall score: {feedback.overall_score()}")
"""

import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime

log = structlog.get_logger()


# =============================================================================
# DATACLASSES
# =============================================================================

@dataclass
class RetrievalFeedback:
    """
    Feedback sul retrieval dei documenti giuridici.

    Valuta quanto bene il sistema ha recuperato le fonti rilevanti.

    Attributes:
        precision: Precisione [0-1] (quante fonti recuperate sono rilevanti)
        recall: Recall [0-1] (quante fonti rilevanti sono state recuperate)
        sources_relevant: Numero di fonti rilevanti recuperate
        sources_total: Numero totale di fonti recuperate
        missing_sources: URN di fonti rilevanti non recuperate
        irrelevant_sources: URN di fonti recuperate ma non rilevanti
        ranking_quality: Qualità del ranking [0-1]
        metadata: Metadati aggiuntivi
    """
    precision: float = 0.0
    recall: float = 0.0
    sources_relevant: int = 0
    sources_total: int = 0
    missing_sources: List[str] = field(default_factory=list)
    irrelevant_sources: List[str] = field(default_factory=list)
    ranking_quality: float = 0.5
    metadata: Dict[str, Any] = field(default_factory=dict)

    def f1_score(self) -> float:
        """Calcola F1 score da precision e recall."""
        if self.precision + self.recall == 0:
            return 0.0
        return 2 * (self.precision * self.recall) / (self.precision + self.recall)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "precision": self.precision,
            "recall": self.recall,
            "sources_relevant": self.sources_relevant,
            "sources_total": self.sources_total,
            "missing_sources": self.missing_sources,
            "irrelevant_sources": self.irrelevant_sources,
            "ranking_quality": self.ranking_quality,
            "f1_score": self.f1_score(),
            "metadata": self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RetrievalFeedback":
        """Deserializza da dizionario."""
        return cls(
            precision=data.get("precision", 0.0),
            recall=data.get("recall", 0.0),
            sources_relevant=data.get("sources_relevant", 0),
            sources_total=data.get("sources_total", 0),
            missing_sources=data.get("missing_sources", []),
            irrelevant_sources=data.get("irrelevant_sources", []),
            ranking_quality=data.get("ranking_quality", 0.5),
            metadata=data.get("metadata", {})
        )


@dataclass
class ReasoningFeedback:
    """
    Feedback sul ragionamento giuridico.

    Valuta la qualità dell'interpretazione e del reasoning.

    Attributes:
        logical_coherence: Coerenza logica [0-1]
        legal_soundness: Fondatezza giuridica [0-1]
        citation_quality: Qualità delle citazioni [0-1]
        interpretation_accuracy: Accuratezza interpretazione [0-1]
        expert_agreement: Consenso tra expert [0-1]
        reasoning_steps_clear: Passi di reasoning chiari [0-1]
        fallacies_detected: Lista di fallacy rilevate
        metadata: Metadati aggiuntivi
    """
    logical_coherence: float = 0.5
    legal_soundness: float = 0.5
    citation_quality: float = 0.5
    interpretation_accuracy: float = 0.5
    expert_agreement: float = 0.5
    reasoning_steps_clear: float = 0.5
    fallacies_detected: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

    def average_score(self) -> float:
        """Calcola score medio su tutte le dimensioni."""
        scores = [
            self.logical_coherence,
            self.legal_soundness,
            self.citation_quality,
            self.interpretation_accuracy,
            self.expert_agreement,
            self.reasoning_steps_clear
        ]
        return sum(scores) / len(scores)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "logical_coherence": self.logical_coherence,
            "legal_soundness": self.legal_soundness,
            "citation_quality": self.citation_quality,
            "interpretation_accuracy": self.interpretation_accuracy,
            "expert_agreement": self.expert_agreement,
            "reasoning_steps_clear": self.reasoning_steps_clear,
            "fallacies_detected": self.fallacies_detected,
            "average_score": self.average_score(),
            "metadata": self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReasoningFeedback":
        """Deserializza da dizionario."""
        return cls(
            logical_coherence=data.get("logical_coherence", 0.5),
            legal_soundness=data.get("legal_soundness", 0.5),
            citation_quality=data.get("citation_quality", 0.5),
            interpretation_accuracy=data.get("interpretation_accuracy", 0.5),
            expert_agreement=data.get("expert_agreement", 0.5),
            reasoning_steps_clear=data.get("reasoning_steps_clear", 0.5),
            fallacies_detected=data.get("fallacies_detected", []),
            metadata=data.get("metadata", {})
        )


@dataclass
class SynthesisFeedback:
    """
    Feedback sulla sintesi finale.

    Valuta la qualità della risposta finale aggregata.

    Attributes:
        clarity: Chiarezza della risposta [0-1]
        completeness: Completezza della risposta [0-1]
        usefulness: Utilità pratica [0-1]
        conciseness: Concisione [0-1]
        language_quality: Qualità linguistica [0-1]
        structure_quality: Qualità strutturale [0-1]
        user_satisfaction: Soddisfazione utente [0-1]
        metadata: Metadati aggiuntivi
    """
    clarity: float = 0.5
    completeness: float = 0.5
    usefulness: float = 0.5
    conciseness: float = 0.5
    language_quality: float = 0.5
    structure_quality: float = 0.5
    user_satisfaction: float = 0.5
    metadata: Dict[str, Any] = field(default_factory=dict)

    def average_score(self) -> float:
        """Calcola score medio su tutte le dimensioni."""
        scores = [
            self.clarity,
            self.completeness,
            self.usefulness,
            self.conciseness,
            self.language_quality,
            self.structure_quality,
            self.user_satisfaction
        ]
        return sum(scores) / len(scores)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "clarity": self.clarity,
            "completeness": self.completeness,
            "usefulness": self.usefulness,
            "conciseness": self.conciseness,
            "language_quality": self.language_quality,
            "structure_quality": self.structure_quality,
            "user_satisfaction": self.user_satisfaction,
            "average_score": self.average_score(),
            "metadata": self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SynthesisFeedback":
        """Deserializza da dizionario."""
        return cls(
            clarity=data.get("clarity", 0.5),
            completeness=data.get("completeness", 0.5),
            usefulness=data.get("usefulness", 0.5),
            conciseness=data.get("conciseness", 0.5),
            language_quality=data.get("language_quality", 0.5),
            structure_quality=data.get("structure_quality", 0.5),
            user_satisfaction=data.get("user_satisfaction", 0.5),
            metadata=data.get("metadata", {})
        )


@dataclass
class MultilevelFeedback:
    """
    Feedback completo multi-livello per una query.

    Combina feedback su retrieval, reasoning e synthesis per consentire
    apprendimento granulare delle policy.

    Attributes:
        query_id: ID della query
        retrieval_feedback: Feedback su retrieval
        reasoning_feedback: Feedback su reasoning
        synthesis_feedback: Feedback su synthesis
        overall_rating: Rating complessivo [0-1] (se disponibile)
        timestamp: Timestamp del feedback
        user_id: ID utente che ha dato feedback
        metadata: Metadati aggiuntivi
    """
    query_id: str
    retrieval_feedback: Optional[RetrievalFeedback] = None
    reasoning_feedback: Optional[ReasoningFeedback] = None
    synthesis_feedback: Optional[SynthesisFeedback] = None
    overall_rating: Optional[float] = None
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    user_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def overall_score(self, weights: Optional[Dict[str, float]] = None) -> float:
        """
        Calcola score complessivo come weighted average dei 3 livelli.

        Args:
            weights: Pesi per ogni livello (default: uguale)
                    {"retrieval": 0.3, "reasoning": 0.4, "synthesis": 0.3}

        Returns:
            Score complessivo [0-1]
        """
        if weights is None:
            weights = {
                "retrieval": 0.3,
                "reasoning": 0.4,
                "synthesis": 0.3
            }

        total_weight = 0.0
        weighted_sum = 0.0

        if self.retrieval_feedback:
            score = self.retrieval_feedback.f1_score()
            weighted_sum += score * weights.get("retrieval", 0.0)
            total_weight += weights.get("retrieval", 0.0)

        if self.reasoning_feedback:
            score = self.reasoning_feedback.average_score()
            weighted_sum += score * weights.get("reasoning", 0.0)
            total_weight += weights.get("reasoning", 0.0)

        if self.synthesis_feedback:
            score = self.synthesis_feedback.average_score()
            weighted_sum += score * weights.get("synthesis", 0.0)
            total_weight += weights.get("synthesis", 0.0)

        # Se c'è overall_rating esplicito, usalo come override
        if self.overall_rating is not None:
            return self.overall_rating

        # Altrimenti weighted average
        if total_weight > 0:
            return weighted_sum / total_weight

        return 0.5  # Default neutro

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario per storage."""
        return {
            "query_id": self.query_id,
            "retrieval_feedback": self.retrieval_feedback.to_dict() if self.retrieval_feedback else None,
            "reasoning_feedback": self.reasoning_feedback.to_dict() if self.reasoning_feedback else None,
            "synthesis_feedback": self.synthesis_feedback.to_dict() if self.synthesis_feedback else None,
            "overall_rating": self.overall_rating,
            "overall_score": self.overall_score(),
            "timestamp": self.timestamp,
            "user_id": self.user_id,
            "metadata": self.metadata
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "MultilevelFeedback":
        """Deserializza da dizionario."""
        retrieval = None
        if data.get("retrieval_feedback"):
            retrieval = RetrievalFeedback.from_dict(data["retrieval_feedback"])

        reasoning = None
        if data.get("reasoning_feedback"):
            reasoning = ReasoningFeedback.from_dict(data["reasoning_feedback"])

        synthesis = None
        if data.get("synthesis_feedback"):
            synthesis = SynthesisFeedback.from_dict(data["synthesis_feedback"])

        return cls(
            query_id=data["query_id"],
            retrieval_feedback=retrieval,
            reasoning_feedback=reasoning,
            synthesis_feedback=synthesis,
            overall_rating=data.get("overall_rating"),
            timestamp=data.get("timestamp", datetime.now().isoformat()),
            user_id=data.get("user_id"),
            metadata=data.get("metadata", {})
        )

    def is_complete(self) -> bool:
        """True se ha feedback su tutti e 3 i livelli."""
        return (
            self.retrieval_feedback is not None and
            self.reasoning_feedback is not None and
            self.synthesis_feedback is not None
        )

    def summary(self) -> Dict[str, Any]:
        """
        Restituisce summary leggibile del feedback.

        Returns:
            Dict con score principali
        """
        return {
            "query_id": self.query_id,
            "retrieval_f1": self.retrieval_feedback.f1_score() if self.retrieval_feedback else None,
            "reasoning_avg": self.reasoning_feedback.average_score() if self.reasoning_feedback else None,
            "synthesis_avg": self.synthesis_feedback.average_score() if self.synthesis_feedback else None,
            "overall_score": self.overall_score(),
            "is_complete": self.is_complete(),
            "timestamp": self.timestamp
        }


# =============================================================================
# FACTORY FUNCTIONS
# =============================================================================

def create_feedback_from_user_rating(
    query_id: str,
    user_rating: float,
    user_id: Optional[str] = None
) -> MultilevelFeedback:
    """
    Crea MultilevelFeedback da un singolo rating utente.

    Distribuisce il rating uniformemente sui 3 livelli.
    Utile per feedback semplificato.

    Args:
        query_id: ID della query
        user_rating: Rating [0-1]
        user_id: ID utente

    Returns:
        MultilevelFeedback con rating distribuito
    """
    # Distribuisci rating su tutti i campi
    retrieval = RetrievalFeedback(
        precision=user_rating,
        recall=user_rating,
        ranking_quality=user_rating
    )

    reasoning = ReasoningFeedback(
        logical_coherence=user_rating,
        legal_soundness=user_rating,
        citation_quality=user_rating,
        interpretation_accuracy=user_rating,
        expert_agreement=user_rating,
        reasoning_steps_clear=user_rating
    )

    synthesis = SynthesisFeedback(
        clarity=user_rating,
        completeness=user_rating,
        usefulness=user_rating,
        conciseness=user_rating,
        language_quality=user_rating,
        structure_quality=user_rating,
        user_satisfaction=user_rating
    )

    return MultilevelFeedback(
        query_id=query_id,
        retrieval_feedback=retrieval,
        reasoning_feedback=reasoning,
        synthesis_feedback=synthesis,
        overall_rating=user_rating,
        user_id=user_id
    )


def aggregate_feedbacks(
    feedbacks: List[MultilevelFeedback],
    method: str = "mean"
) -> MultilevelFeedback:
    """
    Aggrega multipli feedback in uno solo.

    Utile per ottenere consensus da più annotatori.

    Args:
        feedbacks: Lista di MultilevelFeedback da aggregare
        method: Metodo di aggregazione ("mean", "median", "weighted")

    Returns:
        MultilevelFeedback aggregato
    """
    if not feedbacks:
        raise ValueError("Cannot aggregate empty feedback list")

    # Usa il primo query_id
    query_id = feedbacks[0].query_id

    # Aggrega retrieval
    retrieval_scores = [
        f.retrieval_feedback for f in feedbacks
        if f.retrieval_feedback is not None
    ]

    aggregated_retrieval = None
    if retrieval_scores:
        aggregated_retrieval = RetrievalFeedback(
            precision=sum(r.precision for r in retrieval_scores) / len(retrieval_scores),
            recall=sum(r.recall for r in retrieval_scores) / len(retrieval_scores),
            ranking_quality=sum(r.ranking_quality for r in retrieval_scores) / len(retrieval_scores)
        )

    # Aggrega reasoning
    reasoning_scores = [
        f.reasoning_feedback for f in feedbacks
        if f.reasoning_feedback is not None
    ]

    aggregated_reasoning = None
    if reasoning_scores:
        aggregated_reasoning = ReasoningFeedback(
            logical_coherence=sum(r.logical_coherence for r in reasoning_scores) / len(reasoning_scores),
            legal_soundness=sum(r.legal_soundness for r in reasoning_scores) / len(reasoning_scores),
            citation_quality=sum(r.citation_quality for r in reasoning_scores) / len(reasoning_scores),
            interpretation_accuracy=sum(r.interpretation_accuracy for r in reasoning_scores) / len(reasoning_scores),
            expert_agreement=sum(r.expert_agreement for r in reasoning_scores) / len(reasoning_scores),
            reasoning_steps_clear=sum(r.reasoning_steps_clear for r in reasoning_scores) / len(reasoning_scores)
        )

    # Aggrega synthesis
    synthesis_scores = [
        f.synthesis_feedback for f in feedbacks
        if f.synthesis_feedback is not None
    ]

    aggregated_synthesis = None
    if synthesis_scores:
        aggregated_synthesis = SynthesisFeedback(
            clarity=sum(s.clarity for s in synthesis_scores) / len(synthesis_scores),
            completeness=sum(s.completeness for s in synthesis_scores) / len(synthesis_scores),
            usefulness=sum(s.usefulness for s in synthesis_scores) / len(synthesis_scores),
            conciseness=sum(s.conciseness for s in synthesis_scores) / len(synthesis_scores),
            language_quality=sum(s.language_quality for s in synthesis_scores) / len(synthesis_scores),
            structure_quality=sum(s.structure_quality for s in synthesis_scores) / len(synthesis_scores),
            user_satisfaction=sum(s.user_satisfaction for s in synthesis_scores) / len(synthesis_scores)
        )

    # Overall rating (se presente)
    overall_ratings = [f.overall_rating for f in feedbacks if f.overall_rating is not None]
    aggregated_overall = sum(overall_ratings) / len(overall_ratings) if overall_ratings else None

    return MultilevelFeedback(
        query_id=query_id,
        retrieval_feedback=aggregated_retrieval,
        reasoning_feedback=aggregated_reasoning,
        synthesis_feedback=aggregated_synthesis,
        overall_rating=aggregated_overall,
        metadata={"aggregated_from": len(feedbacks), "method": method}
    )
