"""
MERL-T Weight Management System
================================

Sistema centralizzato per la gestione dei pesi nel sistema MERL-T.

Supporta:
- Pesi retrieval (alpha per hybrid search)
- Pesi expert traversal (per i 4 Expert basati su Preleggi)
- Pesi RLCF authority (alpha, beta, gamma)
- Pesi gating network (expert activation priors)

Tutti i pesi sono:
1. Configurabili via YAML (default)
2. Override runtime (senza restart)
3. Persistibili in database (per experiment tracking)
4. Versionabili (per A/B testing)
5. Learnable via RLCF feedback loop

Esempio:
    >>> from merlt.weights import WeightStore, get_weight_store
    >>>
    >>> # Usa singleton
    >>> store = get_weight_store()
    >>> config = await store.get_weights()
    >>> print(config.get_retrieval_alpha())
    0.7
    >>>
    >>> # Ottieni pesi expert specifici
    >>> literal_weights = store.get_expert_traversal_weights("LiteralExpert")
    >>> print(literal_weights["contiene"])
    1.0
"""

from merlt.weights.config import (
    WeightConfig,
    WeightCategory,
    WeightBounds,
    LearnableWeight,
    RetrievalWeights,
    ExpertTraversalWeights,
    RLCFAuthorityWeights,
    GatingWeights,
    WeightUpdate,
    ExperimentVariant,
    ExperimentConfig,
)
from merlt.weights.store import (
    WeightStore,
    get_weight_store,
)
from merlt.weights.learner import (
    WeightLearner,
    LearnerConfig,
    RLCFFeedback,
)
from merlt.weights.experiment import (
    ExperimentTracker,
    Experiment,
    ExperimentAnalysis,
)

__all__ = [
    # Config models
    "WeightConfig",
    "WeightCategory",
    "WeightBounds",
    "LearnableWeight",
    "RetrievalWeights",
    "ExpertTraversalWeights",
    "RLCFAuthorityWeights",
    "GatingWeights",
    "WeightUpdate",
    "ExperimentVariant",
    "ExperimentConfig",
    # Store
    "WeightStore",
    "get_weight_store",
    # Learner
    "WeightLearner",
    "LearnerConfig",
    "RLCFFeedback",
    # Experiment
    "ExperimentTracker",
    "Experiment",
    "ExperimentAnalysis",
]
