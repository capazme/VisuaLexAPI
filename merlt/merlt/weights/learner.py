"""
Weight Learner
===============

Aggiornamento pesi via RLCF feedback loop.

Il WeightLearner:
1. Riceve feedback con authority score
2. Calcola gradiente basato su correlazione feedback-performance
3. Aggiorna pesi rispettando bounds
4. Persiste tramite WeightStore

Formula: w_new = w_old + η * authority * gradient
Dove:
    - η: learning rate
    - authority: peso del feedback (da RLCF AuthorityModule)
    - gradient: direzione di aggiornamento
"""

import structlog
from typing import Dict, Optional, Any
from dataclasses import dataclass
from datetime import datetime

from merlt.weights.config import (
    WeightConfig,
    WeightCategory,
    LearnableWeight,
    WeightUpdate,
    ExpertTraversalWeights,
)
from merlt.weights.store import WeightStore

log = structlog.get_logger()


@dataclass
class LearnerConfig:
    """
    Configurazione per WeightLearner.

    Attributes:
        default_learning_rate: Learning rate default per pesi senza rate specifico
        min_authority_threshold: Authority minima per applicare update
        momentum: Momentum per smooth updates
        clip_gradient: Max gradient magnitude
    """
    default_learning_rate: float = 0.01
    min_authority_threshold: float = 0.3
    momentum: float = 0.9
    clip_gradient: float = 0.1


@dataclass
class RelationUsageData:
    """
    Dati uso relazione per RLCF traversal weight learning.

    Attributes:
        relation_type: Tipo di relazione (es. "RIFERIMENTO", "CITATO_DA")
        usage_count: Numero di volte usata
        sources_found: Numero di fonti trovate tramite questa relazione
        sources_used_in_response: Fonti effettivamente usate nella risposta finale
        avg_relevance: Rilevanza media delle fonti trovate (post-feedback)
    """
    relation_type: str
    usage_count: int = 0
    sources_found: int = 0
    sources_used_in_response: int = 0
    avg_relevance: float = 0.0


@dataclass
class RLCFFeedback:
    """
    Feedback da RLCF per aggiornamento pesi.

    Attributes:
        query_id: ID della query originale
        user_id: ID dell'utente che ha dato feedback
        authority: Authority score dell'utente [0-1]
        relevance_scores: Score di rilevanza per risultati
        expected_ranking: Ranking atteso (ground truth)
        actual_ranking: Ranking prodotto dal sistema
        task_type: Tipo di task (retrieval, qa, classification)
        expert_type: Tipo di expert (literal, systemic, etc.) - PHASE 2
        relation_usage: Mapping relation_type -> RelationUsageData - PHASE 2
        user_rating: Rating complessivo dell'utente [0-1] - PHASE 2
    """
    query_id: str
    user_id: str
    authority: float
    relevance_scores: Dict[str, float]
    expected_ranking: Optional[list] = None
    actual_ranking: Optional[list] = None
    task_type: str = "retrieval"
    timestamp: Optional[str] = None
    # PHASE 2: Dati per traversal weight learning
    expert_type: Optional[str] = None
    relation_usage: Optional[Dict[str, RelationUsageData]] = None
    user_rating: float = 0.5  # Rating complessivo [0-1]


class WeightLearner:
    """
    Aggiorna pesi basandosi su RLCF feedback.

    Il learner implementa un semplice gradient update:
    w_new = w_old + η * authority * gradient

    Dove gradient e' calcolato dalla correlazione tra:
    - Ranking atteso vs ranking ottenuto
    - Relevance scores dei risultati
    - Tipo di query e expert performance

    Esempio:
        >>> learner = WeightLearner(store)
        >>> feedback = RLCFFeedback(
        ...     query_id="q001",
        ...     user_id="user123",
        ...     authority=0.8,
        ...     relevance_scores={"result1": 0.9, "result2": 0.3}
        ... )
        >>> new_config = await learner.update_from_feedback(
        ...     category="retrieval",
        ...     feedback=feedback
        ... )
    """

    def __init__(
        self,
        store: WeightStore,
        config: Optional[LearnerConfig] = None
    ):
        """
        Inizializza WeightLearner.

        Args:
            store: WeightStore per persistenza
            config: Configurazione learner
        """
        self.store = store
        self.config = config or LearnerConfig()
        self._momentum_buffer: Dict[str, float] = {}

        log.info(
            "WeightLearner initialized",
            learning_rate=self.config.default_learning_rate,
            min_authority=self.config.min_authority_threshold
        )

    async def update_from_feedback(
        self,
        category: str,
        feedback: RLCFFeedback,
        experiment_id: Optional[str] = None
    ) -> WeightConfig:
        """
        Aggiorna pesi basandosi su feedback.

        Args:
            category: Categoria di pesi da aggiornare
            feedback: Feedback da RLCF
            experiment_id: ID esperimento (per tracking)

        Returns:
            WeightConfig aggiornata
        """
        # Verifica authority threshold
        if feedback.authority < self.config.min_authority_threshold:
            log.debug(
                "Feedback authority too low, skipping update",
                authority=feedback.authority,
                threshold=self.config.min_authority_threshold
            )
            current = await self.store.get_weights(experiment_id=experiment_id)
            return current

        # Carica pesi correnti
        current = await self.store.get_weights(experiment_id=experiment_id)

        # Calcola gradiente
        gradient = self._compute_gradient(category, feedback, current)

        # Applica update (PHASE 2: passa expert_type per traversal weights)
        updated = self._apply_update(
            category, current, gradient, feedback.authority,
            expert_type=feedback.expert_type
        )

        # Salva se experiment tracking attivo
        if experiment_id:
            await self.store.save_weights(
                config=updated,
                experiment_id=experiment_id,
                metrics={"feedback_authority": feedback.authority}
            )

        log.info(
            "Weights updated from feedback",
            category=category,
            authority=feedback.authority,
            gradient_norm=sum(abs(v) for v in gradient.values())
        )

        return updated

    def _compute_gradient(
        self,
        category: str,
        feedback: RLCFFeedback,
        current: WeightConfig
    ) -> Dict[str, float]:
        """
        Calcola gradiente per update.

        Il gradiente e' basato sulla differenza tra ranking atteso e ottenuto,
        pesata per la rilevanza dei risultati.
        """
        gradient = {}

        if category == "retrieval":
            gradient = self._compute_retrieval_gradient(feedback, current)
        elif category == "expert_traversal":
            gradient = self._compute_traversal_gradient(feedback, current)
        elif category == "gating":
            gradient = self._compute_gating_gradient(feedback, current)
        else:
            log.warning(f"Unknown category for gradient: {category}")

        # Clip gradient
        for key in gradient:
            gradient[key] = max(
                -self.config.clip_gradient,
                min(self.config.clip_gradient, gradient[key])
            )

        return gradient

    def _compute_retrieval_gradient(
        self,
        feedback: RLCFFeedback,
        current: WeightConfig
    ) -> Dict[str, float]:
        """
        Calcola gradiente per pesi retrieval.

        Se i risultati graph-based sono piu' rilevanti, aumenta (1-alpha).
        Se i risultati semantic sono piu' rilevanti, aumenta alpha.
        """
        gradient = {"alpha": 0.0}

        if not feedback.relevance_scores:
            return gradient

        # Calcola media rilevanza
        avg_relevance = sum(feedback.relevance_scores.values()) / len(feedback.relevance_scores)

        # Euristica semplice: se rilevanza alta, mantieni; se bassa, cambia
        if avg_relevance < 0.5:
            # Risultati scarsi, prova a cambiare direzione
            current_alpha = current.get_retrieval_alpha()
            if current_alpha > 0.5:
                gradient["alpha"] = -0.01  # Riduci semantic
            else:
                gradient["alpha"] = 0.01   # Aumenta semantic

        return gradient

    def _compute_traversal_gradient(
        self,
        feedback: RLCFFeedback,
        current: WeightConfig
    ) -> Dict[str, float]:
        """
        Calcola gradiente per pesi expert traversal.

        PHASE 2: Basato su quali tipi di relazione hanno portato a risultati rilevanti.

        Formula per ogni relazione r:
            gradient[r] = (sources_used / sources_found) * avg_relevance * user_rating - 0.5

        Interpretazione:
            - Se una relazione porta a molte fonti usate con alta rilevanza → gradient positivo
            - Se una relazione porta a poche fonti usate o bassa rilevanza → gradient negativo
            - Il fattore (user_rating - 0.5) amplifica o inverte in base al feedback generale

        Returns:
            Dict con gradient per ogni relation_type
        """
        gradient = {}

        if not feedback.relation_usage:
            log.debug("No relation usage data in feedback, skipping traversal gradient")
            return gradient

        if not feedback.expert_type:
            log.debug("No expert_type in feedback, skipping traversal gradient")
            return gradient

        # Ottieni pesi correnti per questo expert
        expert_name = f"{feedback.expert_type.capitalize()}Expert"
        current_weights = current.get_expert_weights(expert_name)

        # Calcola gradiente per ogni relazione usata
        for rel_type, usage in feedback.relation_usage.items():
            if not isinstance(usage, RelationUsageData):
                # Converti da dict se necessario
                if isinstance(usage, dict):
                    usage = RelationUsageData(**usage)
                else:
                    continue

            # Skip se nessun uso
            if usage.usage_count == 0:
                continue

            # Calcola efficienza della relazione
            # (quante fonti trovate sono state effettivamente usate)
            if usage.sources_found > 0:
                usage_efficiency = usage.sources_used_in_response / usage.sources_found
            else:
                usage_efficiency = 0.0

            # Calcola gradient basato su:
            # 1. Efficienza dell'uso (fonti usate / fonti trovate)
            # 2. Rilevanza media delle fonti
            # 3. Rating complessivo dell'utente (scala da -0.5 a +0.5)
            relevance_factor = usage.avg_relevance if usage.avg_relevance > 0 else 0.5
            rating_shift = feedback.user_rating - 0.5  # Range [-0.5, +0.5]

            # Gradient = efficienza * rilevanza * rating_shift
            # Questo fa sì che:
            # - Relazioni efficaci con buon feedback → gradient positivo
            # - Relazioni inefficaci o con cattivo feedback → gradient negativo
            grad = usage_efficiency * relevance_factor * rating_shift

            # Se la relazione non esiste nei pesi correnti, inizializza
            if rel_type not in current_weights:
                gradient[rel_type] = grad
            else:
                gradient[rel_type] = grad

            log.debug(
                f"Traversal gradient for {rel_type}",
                efficiency=usage_efficiency,
                relevance=relevance_factor,
                rating_shift=rating_shift,
                gradient=grad
            )

        # Log summary
        if gradient:
            log.info(
                f"Traversal gradients computed for {expert_name}",
                num_relations=len(gradient),
                total_gradient_magnitude=sum(abs(v) for v in gradient.values())
            )

        return gradient

    def _compute_gating_gradient(
        self,
        feedback: RLCFFeedback,
        current: WeightConfig
    ) -> Dict[str, float]:
        """
        Calcola gradiente per pesi gating.

        Aumenta prior degli expert che hanno performato bene.
        """
        # TODO: Implementare quando abbiamo output per-expert
        return {}

    def _apply_update(
        self,
        category: str,
        current: WeightConfig,
        gradient: Dict[str, float],
        authority: float,
        expert_type: Optional[str] = None
    ) -> WeightConfig:
        """
        Applica update ai pesi rispettando bounds.

        Args:
            category: Categoria di pesi (retrieval, expert_traversal, gating)
            current: Configurazione pesi corrente
            gradient: Gradiente calcolato
            authority: Authority dell'utente che ha dato feedback
            expert_type: Tipo di expert (per expert_traversal) - PHASE 2
        """
        # Deep copy per non modificare originale
        import copy
        updated = copy.deepcopy(current)

        if category == "retrieval" and "alpha" in gradient:
            # Update alpha
            old_alpha = updated.retrieval.alpha.default
            lr = updated.retrieval.alpha.learning_rate
            new_alpha = old_alpha + lr * authority * gradient["alpha"]

            # Clip to bounds
            min_val, max_val = updated.retrieval.alpha.bounds
            new_alpha = max(min_val, min(max_val, new_alpha))

            updated.retrieval.alpha.default = new_alpha

            log.debug(
                "Alpha updated",
                old=old_alpha,
                new=new_alpha,
                gradient=gradient["alpha"]
            )

        # PHASE 2: Update expert_traversal weights
        elif category == "expert_traversal" and expert_type and gradient:
            expert_name = f"{expert_type.capitalize()}Expert"

            # Inizializza expert traversal se non esiste
            if expert_name not in updated.expert_traversal:
                from merlt.weights.config import ExpertTraversalWeights, LearnableWeight
                updated.expert_traversal[expert_name] = ExpertTraversalWeights()

            expert_weights = updated.expert_traversal[expert_name]

            for rel_type, grad in gradient.items():
                # Ottieni o crea peso per questa relazione
                if rel_type not in expert_weights.weights:
                    from merlt.weights.config import LearnableWeight
                    expert_weights.weights[rel_type] = LearnableWeight(
                        default=0.5,
                        bounds=(0.1, 1.0),
                        learnable=True,
                        learning_rate=self.config.default_learning_rate
                    )

                weight = expert_weights.weights[rel_type]
                old_value = weight.default
                lr = weight.learning_rate

                # Formula: w_new = w_old + η * authority * gradient
                new_value = old_value + lr * authority * grad

                # Clip to bounds
                min_val, max_val = weight.bounds
                new_value = max(min_val, min(max_val, new_value))

                weight.default = new_value

                log.debug(
                    f"Traversal weight updated: {expert_name}.{rel_type}",
                    old=old_value,
                    new=new_value,
                    gradient=grad,
                    authority=authority
                )

            # Calcola total change
            total_change = 0.0
            for k in gradient.keys():
                if k in expert_weights.weights:
                    total_change += abs(expert_weights.weights[k].default - 0.5)

            log.info(
                f"Expert traversal weights updated for {expert_name}",
                num_weights=len(gradient),
                total_change=total_change
            )

        updated.updated_at = datetime.now().isoformat()
        return updated

    async def batch_update(
        self,
        category: str,
        feedbacks: list,
        experiment_id: Optional[str] = None
    ) -> WeightConfig:
        """
        Applica batch di feedback in una volta.

        Utile per training offline o bulk updates.
        """
        current = await self.store.get_weights(experiment_id=experiment_id)

        for feedback in feedbacks:
            current = await self.update_from_feedback(
                category=category,
                feedback=feedback,
                experiment_id=experiment_id
            )

        return current

    def reset_momentum(self) -> None:
        """Reset momentum buffer."""
        self._momentum_buffer.clear()
        log.debug("Momentum buffer reset")
