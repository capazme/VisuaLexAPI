"""
Neural Gating Module
=====================

PHASE 3: θ_gating NEURALE per routing dinamico expert.

Architettura:
    Query → EmbeddingService → ExpertGatingMLP → Expert Weights

Componenti:
    - ExpertGatingMLP: Neural network per routing query → expert weights
    - NeuralGatingTrainer: Training loop con feedback RLCF
    - HybridExpertRouter: Router ibrido neural + regex fallback
"""

from merlt.experts.neural_gating.neural import (
    ExpertGatingMLP,
    NeuralGatingTrainer,
    AutosaveCallback,
    GatingConfig,
    EXPERT_NAMES,
    DEFAULT_EXPERT_PRIORS,
)
from merlt.experts.neural_gating.hybrid_router import (
    HybridExpertRouter,
    HybridRoutingDecision,
    AdaptiveThresholdManager,
)

__all__ = [
    "ExpertGatingMLP",
    "NeuralGatingTrainer",
    "AutosaveCallback",
    "GatingConfig",
    "EXPERT_NAMES",
    "DEFAULT_EXPERT_PRIORS",
    "HybridExpertRouter",
    "HybridRoutingDecision",
    "AdaptiveThresholdManager",
]
