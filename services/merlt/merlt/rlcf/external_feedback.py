"""
External Feedback Adapter
=========================

Adapter per convertire interazioni da fonti esterne (es. VisuaLex)
in feedback RLCF strutturato.

Architettura MultilevelFeedback:
- RetrievalFeedback: Qualità del retrieval (precision, recall, ranking)
- ReasoningFeedback: Qualità del reasoning (logical coherence, legal soundness)
- SynthesisFeedback: Qualità della sintesi finale (clarity, usefulness)

Due modalità di feedback:
1. Implicit: Dedotto da azioni utente (bookmark, highlight, click)
2. Explicit: Raccolto tramite popup/form

Esempio:
    >>> from merlt.rlcf.external_feedback import (
    ...     ExternalFeedbackAdapter,
    ...     VisualexInteraction,
    ... )
    >>>
    >>> adapter = ExternalFeedbackAdapter()
    >>>
    >>> # Singola interazione
    >>> interaction = VisualexInteraction(
    ...     user_id="uuid-123",
    ...     interaction_type="bookmark_add",
    ...     article_urn="urn:test",
    ... )
    >>> partial = adapter.convert_interaction(interaction)
    >>>
    >>> # Aggregazione sessione
    >>> feedback = adapter.aggregate_session(
    ...     interactions=[...],
    ...     explicit_feedback={...},
    ... )
"""

import structlog
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from collections import defaultdict
from enum import Enum


log = structlog.get_logger()


# =============================================================================
# ENUMS
# =============================================================================

class FeedbackLevel(str, Enum):
    """Livello di feedback nel pipeline."""
    RETRIEVAL = "retrieval"
    REASONING = "reasoning"
    SYNTHESIS = "synthesis"


class InteractionType(str, Enum):
    """Tipi di interazione da VisuaLex."""
    # Retrieval
    BOOKMARK_ADD = "bookmark_add"
    HIGHLIGHT_CREATE = "highlight_create"
    FIRST_RESULT_CLICK = "first_result_click"
    SKIP_RESULTS = "skip_results"
    CROSS_REF_FOUND = "cross_ref_found"
    CROSS_REF_MISSING = "cross_ref_missing"

    # Reasoning
    DOCTRINE_READ = "doctrine_read"
    ANNOTATION_CREATE = "annotation_create"
    ANNOTATION_QUESTION = "annotation_question"

    # Synthesis
    SEARCH_AFTER_AI = "search_after_ai"
    QUICKNORM_SAVE = "quicknorm_save"
    DOSSIER_ADD = "dossier_add"
    LONG_READ = "long_read"
    QUICK_CLOSE = "quick_close"

    # Explicit
    EXPLICIT_RATING = "explicit_rating"


# =============================================================================
# FEEDBACK DATACLASS
# =============================================================================

@dataclass
class RetrievalFeedback:
    """
    Feedback sulla qualità del retrieval.

    Attributes:
        precision: % risultati rilevanti (0-1)
        recall: % fonti trovate vs necessarie (0-1)
        missing_sources: URN articoli mancanti
        irrelevant_sources: URN articoli irrilevanti
        ranking_quality: Qualità del ranking (0-1)
        source_diversity: Diversità delle fonti (0-1)
        context_coverage: Copertura del contesto (0-1)
    """
    precision: Optional[float] = None
    recall: Optional[float] = None
    missing_sources: List[str] = field(default_factory=list)
    irrelevant_sources: List[str] = field(default_factory=list)
    ranking_quality: Optional[float] = None
    source_diversity: Optional[float] = None
    context_coverage: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario."""
        return {
            "precision": self.precision,
            "recall": self.recall,
            "missing_sources": self.missing_sources,
            "irrelevant_sources": self.irrelevant_sources,
            "ranking_quality": self.ranking_quality,
            "source_diversity": self.source_diversity,
            "context_coverage": self.context_coverage,
        }


@dataclass
class ReasoningFeedback:
    """
    Feedback sulla qualità del reasoning.

    Attributes:
        logical_coherence: Coerenza logica (0-1)
        legal_soundness: Correttezza giuridica (0-1)
        citation_quality: Qualità citazioni (0-1)
        interpretation_accuracy: Accuratezza interpretazione (0-1)
        reasoning_steps_clear: Chiarezza passaggi (0-1)
        expert_agreement: Accordo tra expert (0-1)
    """
    logical_coherence: Optional[float] = None
    legal_soundness: Optional[float] = None
    citation_quality: Optional[float] = None
    interpretation_accuracy: Optional[float] = None
    reasoning_steps_clear: Optional[float] = None
    expert_agreement: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario."""
        return {
            "logical_coherence": self.logical_coherence,
            "legal_soundness": self.legal_soundness,
            "citation_quality": self.citation_quality,
            "interpretation_accuracy": self.interpretation_accuracy,
            "reasoning_steps_clear": self.reasoning_steps_clear,
            "expert_agreement": self.expert_agreement,
        }


@dataclass
class SynthesisFeedback:
    """
    Feedback sulla qualità della sintesi.

    Attributes:
        clarity: Chiarezza (0-1)
        completeness: Completezza (0-1)
        usefulness: Utilità (0-1)
        conciseness: Concisione (0-1)
        language_quality: Qualità linguistica (0-1)
        structure_quality: Qualità struttura (0-1)
        user_satisfaction: Soddisfazione utente (0-1)
    """
    clarity: Optional[float] = None
    completeness: Optional[float] = None
    usefulness: Optional[float] = None
    conciseness: Optional[float] = None
    language_quality: Optional[float] = None
    structure_quality: Optional[float] = None
    user_satisfaction: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario."""
        return {
            "clarity": self.clarity,
            "completeness": self.completeness,
            "usefulness": self.usefulness,
            "conciseness": self.conciseness,
            "language_quality": self.language_quality,
            "structure_quality": self.structure_quality,
            "user_satisfaction": self.user_satisfaction,
        }


@dataclass
class MultilevelFeedback:
    """
    Feedback multilivello completo.

    Combina feedback da tutti e tre i livelli del pipeline:
    - Retrieval: Qualità della ricerca
    - Reasoning: Qualità del ragionamento
    - Synthesis: Qualità della risposta finale

    Attributes:
        retrieval: Feedback sul retrieval
        reasoning: Feedback sul reasoning
        synthesis: Feedback sulla sintesi
        trace_id: ID trace MERL-T (opzionale)
        user_id: ID utente
        user_authority: Authority dell'utente
        timestamp: Timestamp del feedback
        source: Fonte del feedback
        metadata: Metadati aggiuntivi
    """
    retrieval: RetrievalFeedback = field(default_factory=RetrievalFeedback)
    reasoning: ReasoningFeedback = field(default_factory=ReasoningFeedback)
    synthesis: SynthesisFeedback = field(default_factory=SynthesisFeedback)

    trace_id: Optional[str] = None
    user_id: Optional[str] = None
    user_authority: float = 0.5
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    source: str = "external"
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario."""
        return {
            "retrieval": self.retrieval.to_dict(),
            "reasoning": self.reasoning.to_dict(),
            "synthesis": self.synthesis.to_dict(),
            "trace_id": self.trace_id,
            "user_id": self.user_id,
            "user_authority": self.user_authority,
            "timestamp": self.timestamp.isoformat(),
            "source": self.source,
            "metadata": self.metadata,
        }

    @property
    def has_retrieval_feedback(self) -> bool:
        """Verifica se c'è feedback retrieval."""
        return any([
            self.retrieval.precision is not None,
            self.retrieval.recall is not None,
            self.retrieval.ranking_quality is not None,
            self.retrieval.missing_sources,
            self.retrieval.irrelevant_sources,
        ])

    @property
    def has_reasoning_feedback(self) -> bool:
        """Verifica se c'è feedback reasoning."""
        return any([
            self.reasoning.logical_coherence is not None,
            self.reasoning.legal_soundness is not None,
            self.reasoning.citation_quality is not None,
        ])

    @property
    def has_synthesis_feedback(self) -> bool:
        """Verifica se c'è feedback synthesis."""
        return any([
            self.synthesis.clarity is not None,
            self.synthesis.usefulness is not None,
            self.synthesis.user_satisfaction is not None,
        ])


# =============================================================================
# INTERACTION & PARTIAL FEEDBACK
# =============================================================================

@dataclass
class VisualexInteraction:
    """
    Singola interazione da VisuaLex.

    Attributes:
        user_id: ID utente
        interaction_type: Tipo di interazione
        timestamp: Timestamp
        article_urn: URN articolo (opzionale)
        query_text: Testo query (opzionale)
        trace_id: ID trace MERL-T (opzionale)
        metadata: Dati specifici per tipo
    """
    user_id: str
    interaction_type: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    article_urn: Optional[str] = None
    query_text: Optional[str] = None
    trace_id: Optional[str] = None

    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PartialFeedback:
    """
    Feedback parziale da singola interazione.

    Attributes:
        trace_id: ID trace (opzionale)
        level: Livello del feedback
        field: Campo del feedback
        delta: Variazione del valore (+/-)
        source: Fonte (implicit/explicit)
        timestamp: Timestamp
    """
    trace_id: Optional[str]
    level: FeedbackLevel
    field: str
    delta: float
    source: str = "implicit"
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# =============================================================================
# EXTERNAL FEEDBACK ADAPTER
# =============================================================================

class ExternalFeedbackAdapter:
    """
    Converte interazioni VisuaLex in MultilevelFeedback.

    Due modalità:
    1. Single: Una interazione → partial feedback
    2. Batch: Aggregazione sessione → full feedback

    Esempio:
        >>> adapter = ExternalFeedbackAdapter()
        >>>
        >>> # Singola interazione
        >>> partial = adapter.convert_interaction(interaction)
        >>>
        >>> # Aggregazione
        >>> feedback = adapter.aggregate_session(interactions)
    """

    # Mapping interaction_type → (level, field, delta)
    IMPLICIT_MAPPINGS: Dict[str, Tuple[FeedbackLevel, str, float]] = {
        # Retrieval positive
        "bookmark_add": (FeedbackLevel.RETRIEVAL, "precision", +0.1),
        "highlight_create": (FeedbackLevel.RETRIEVAL, "precision", +0.2),
        "first_result_click": (FeedbackLevel.RETRIEVAL, "ranking_quality", +0.1),
        "cross_ref_found": (FeedbackLevel.RETRIEVAL, "recall", +0.1),

        # Retrieval negative
        "skip_results": (FeedbackLevel.RETRIEVAL, "ranking_quality", -0.1),
        "cross_ref_missing": (FeedbackLevel.RETRIEVAL, "recall", -0.15),

        # Reasoning
        "doctrine_read": (FeedbackLevel.REASONING, "legal_soundness", +0.1),
        "annotation_create": (FeedbackLevel.REASONING, "interpretation_accuracy", +0.05),
        "annotation_question": (FeedbackLevel.REASONING, "reasoning_steps_clear", -0.05),

        # Synthesis positive
        "quicknorm_save": (FeedbackLevel.SYNTHESIS, "usefulness", +0.2),
        "dossier_add": (FeedbackLevel.SYNTHESIS, "user_satisfaction", +0.2),
        "long_read": (FeedbackLevel.SYNTHESIS, "clarity", +0.1),

        # Synthesis negative
        "search_after_ai": (FeedbackLevel.SYNTHESIS, "completeness", -0.1),
        "quick_close": (FeedbackLevel.SYNTHESIS, "clarity", -0.1),
    }

    # Baseline score per aggregazione (partenza neutra)
    BASELINE_SCORE = 0.5

    def __init__(self):
        """Inizializza adapter."""
        log.info("ExternalFeedbackAdapter initialized")

    def convert_interaction(
        self,
        interaction: VisualexInteraction,
    ) -> Optional[PartialFeedback]:
        """
        Converte singola interazione in partial feedback.

        Args:
            interaction: Interazione VisuaLex

        Returns:
            PartialFeedback o None se tipo non mappato
        """
        mapping = self.IMPLICIT_MAPPINGS.get(interaction.interaction_type)
        if not mapping:
            log.debug(
                "Unmapped interaction type",
                type=interaction.interaction_type,
            )
            return None

        level, field_name, delta = mapping

        return PartialFeedback(
            trace_id=interaction.trace_id,
            level=level,
            field=field_name,
            delta=delta,
            source="implicit",
            timestamp=interaction.timestamp,
        )

    def aggregate_session(
        self,
        interactions: List[VisualexInteraction],
        explicit_feedback: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
        user_authority: float = 0.5,
        trace_id: Optional[str] = None,
    ) -> MultilevelFeedback:
        """
        Aggrega interazioni di una sessione in feedback completo.

        Combina:
        - Implicit: da interazioni
        - Explicit: da popup (se presente)

        Args:
            interactions: Lista di interazioni
            explicit_feedback: Feedback esplicito da popup (opzionale)
            user_id: ID utente
            user_authority: Authority dell'utente
            trace_id: ID trace MERL-T

        Returns:
            MultilevelFeedback aggregato
        """
        # Accumula delta per campo
        field_deltas: Dict[Tuple[FeedbackLevel, str], List[float]] = defaultdict(list)

        for interaction in interactions:
            partial = self.convert_interaction(interaction)
            if partial:
                key = (partial.level, partial.field)
                field_deltas[key].append(partial.delta)

        # Crea feedback objects
        retrieval = RetrievalFeedback()
        reasoning = ReasoningFeedback()
        synthesis = SynthesisFeedback()

        # Calcola valori aggregati
        for (level, field_name), deltas in field_deltas.items():
            avg_delta = sum(deltas) / len(deltas)
            # Clamp to 0-1 partendo da baseline
            value = max(0.0, min(1.0, self.BASELINE_SCORE + avg_delta))

            if level == FeedbackLevel.RETRIEVAL:
                if hasattr(retrieval, field_name):
                    setattr(retrieval, field_name, value)
            elif level == FeedbackLevel.REASONING:
                if hasattr(reasoning, field_name):
                    setattr(reasoning, field_name, value)
            elif level == FeedbackLevel.SYNTHESIS:
                if hasattr(synthesis, field_name):
                    setattr(synthesis, field_name, value)

        # Merge explicit se presente
        if explicit_feedback:
            self._merge_explicit_feedback(
                retrieval, reasoning, synthesis, explicit_feedback
            )

        return MultilevelFeedback(
            retrieval=retrieval,
            reasoning=reasoning,
            synthesis=synthesis,
            trace_id=trace_id,
            user_id=user_id,
            user_authority=user_authority,
            source="visualex",
        )

    def _merge_explicit_feedback(
        self,
        retrieval: RetrievalFeedback,
        reasoning: ReasoningFeedback,
        synthesis: SynthesisFeedback,
        explicit: Dict[str, Any],
    ) -> None:
        """
        Merge feedback esplicito nei feedback objects.

        Explicit feedback ha priorità su implicit.
        """
        # Retrieval fields
        if "precision" in explicit:
            retrieval.precision = float(explicit["precision"])
        if "recall" in explicit:
            retrieval.recall = float(explicit["recall"])
        if "missing_sources" in explicit:
            retrieval.missing_sources = explicit["missing_sources"]
        if "ranking_quality" in explicit:
            retrieval.ranking_quality = float(explicit["ranking_quality"])

        # Reasoning fields
        if "legal_soundness" in explicit:
            reasoning.legal_soundness = float(explicit["legal_soundness"])
        if "logical_coherence" in explicit:
            reasoning.logical_coherence = float(explicit["logical_coherence"])
        if "citation_quality" in explicit:
            reasoning.citation_quality = float(explicit["citation_quality"])

        # Synthesis fields
        if "clarity" in explicit:
            synthesis.clarity = float(explicit["clarity"])
        if "completeness" in explicit:
            synthesis.completeness = float(explicit["completeness"])
        if "usefulness" in explicit:
            synthesis.usefulness = float(explicit["usefulness"])
        if "user_satisfaction" in explicit:
            synthesis.user_satisfaction = float(explicit["user_satisfaction"])

    def convert_rating_to_score(
        self,
        rating: int,
        max_rating: int = 5,
    ) -> float:
        """
        Converte rating (es. 1-5 stelle) in score 0-1.

        Args:
            rating: Valore rating
            max_rating: Valore massimo (default 5)

        Returns:
            Score normalizzato 0-1
        """
        return max(0.0, min(1.0, rating / max_rating))


# =============================================================================
# FEEDBACK ACCUMULATOR
# =============================================================================

class FeedbackAccumulator:
    """
    Accumula feedback nel tempo per una sessione.

    Utile per raccogliere interazioni incrementalmente
    e generare feedback aggregato alla fine.

    Esempio:
        >>> accumulator = FeedbackAccumulator(user_id="user-123")
        >>> accumulator.add_interaction(interaction1)
        >>> accumulator.add_interaction(interaction2)
        >>> accumulator.add_explicit({"clarity": 0.8})
        >>> feedback = accumulator.finalize()
    """

    def __init__(
        self,
        user_id: str,
        user_authority: float = 0.5,
        trace_id: Optional[str] = None,
    ):
        """
        Inizializza accumulator.

        Args:
            user_id: ID utente
            user_authority: Authority dell'utente
            trace_id: ID trace MERL-T
        """
        self.user_id = user_id
        self.user_authority = user_authority
        self.trace_id = trace_id

        self.interactions: List[VisualexInteraction] = []
        self.explicit_feedback: Dict[str, Any] = {}

        self._adapter = ExternalFeedbackAdapter()
        self._finalized = False

    def add_interaction(self, interaction: VisualexInteraction) -> None:
        """Aggiunge interazione."""
        if self._finalized:
            raise RuntimeError("Accumulator already finalized")
        self.interactions.append(interaction)

    def add_explicit(self, feedback: Dict[str, Any]) -> None:
        """Aggiunge feedback esplicito."""
        if self._finalized:
            raise RuntimeError("Accumulator already finalized")
        self.explicit_feedback.update(feedback)

    def finalize(self) -> MultilevelFeedback:
        """
        Finalizza e genera feedback aggregato.

        Returns:
            MultilevelFeedback
        """
        if self._finalized:
            raise RuntimeError("Accumulator already finalized")

        self._finalized = True

        return self._adapter.aggregate_session(
            interactions=self.interactions,
            explicit_feedback=self.explicit_feedback if self.explicit_feedback else None,
            user_id=self.user_id,
            user_authority=self.user_authority,
            trace_id=self.trace_id,
        )

    @property
    def interaction_count(self) -> int:
        """Numero di interazioni accumulate."""
        return len(self.interactions)


# =============================================================================
# EXPORTS
# =============================================================================

__all__ = [
    # Enums
    "FeedbackLevel",
    "InteractionType",
    # Feedback dataclass
    "RetrievalFeedback",
    "ReasoningFeedback",
    "SynthesisFeedback",
    "MultilevelFeedback",
    # Interaction
    "VisualexInteraction",
    "PartialFeedback",
    # Adapter
    "ExternalFeedbackAdapter",
    "FeedbackAccumulator",
]
