"""
Weight Configuration Models
============================

Pydantic models per la configurazione dei pesi nel sistema MERL-T.
Supporta pesi per retrieval, expert traversal, RLCF authority e gating network.

I pesi possono essere:
- Caricati da YAML (default)
- Override runtime (senza restart)
- Persistiti in database (per experiment tracking)
- Versionati (per A/B testing)
- Learnable via RLCF feedback loop
"""

from pydantic import BaseModel, Field, field_validator
from typing import Dict, Optional, Any, List
from enum import Enum


class WeightCategory(str, Enum):
    """Categorie di pesi nel sistema."""
    RETRIEVAL = "retrieval"
    EXPERT_TRAVERSAL = "expert_traversal"
    RLCF = "rlcf"
    GATING = "gating"


class WeightBounds(BaseModel):
    """Limiti per un peso learnable."""
    min_value: float = Field(default=0.0, ge=0.0)
    max_value: float = Field(default=1.0, le=10.0)

    @field_validator("max_value")
    @classmethod
    def max_greater_than_min(cls, v: float, info) -> float:
        if "min_value" in info.data and v <= info.data["min_value"]:
            raise ValueError("max_value must be greater than min_value")
        return v


class LearnableWeight(BaseModel):
    """
    Singolo peso learnable con default, bounds e learning rate.

    Esempio:
        alpha:
          default: 0.7
          bounds: [0.3, 0.9]
          learnable: true
          learning_rate: 0.01
    """
    default: float = Field(..., description="Valore di default")
    bounds: tuple[float, float] = Field(default=(0.0, 1.0), description="Min e max")
    learnable: bool = Field(default=True, description="Se il peso e' learnable via RLCF")
    learning_rate: float = Field(default=0.01, ge=0.0, le=1.0, description="Learning rate")

    @field_validator("default")
    @classmethod
    def default_within_bounds(cls, v: float, info) -> float:
        if "bounds" in info.data:
            min_val, max_val = info.data["bounds"]
            if not min_val <= v <= max_val:
                raise ValueError(f"default {v} must be within bounds [{min_val}, {max_val}]")
        return v


class RetrievalWeights(BaseModel):
    """
    Pesi per hybrid retrieval.

    Attributes:
        alpha: Bilancio vector/graph (0.7 = 70% semantico, 30% strutturale)
        over_retrieve_factor: Moltiplicatore per re-ranking
        max_graph_hops: Massimi hop nel grafo
        default_graph_score: Score quando non c'e' path
    """
    alpha: LearnableWeight = Field(
        default_factory=lambda: LearnableWeight(
            default=0.7,
            bounds=(0.3, 0.9),
            learnable=True,
            learning_rate=0.01
        )
    )
    over_retrieve_factor: int = Field(default=3, ge=1, le=10)
    max_graph_hops: int = Field(default=3, ge=1, le=5)
    default_graph_score: float = Field(default=0.5, ge=0.0, le=1.0)


class ExpertTraversalWeights(BaseModel):
    """
    Pesi di traversal per un singolo Expert.

    Ogni Expert valuta diversamente i tipi di relazione nel grafo.
    Mappati sulle Preleggi (art. 12-14 disp. prel. c.c.).
    """
    weights: Dict[str, LearnableWeight] = Field(
        default_factory=dict,
        description="Mapping relation_type -> weight"
    )
    default_weight: float = Field(default=0.5, ge=0.0, le=1.0)

    def get_weight(self, relation_type: str) -> float:
        """Ottiene il peso per un tipo di relazione."""
        if relation_type in self.weights:
            return self.weights[relation_type].default
        return self.default_weight


class RLCFAuthorityWeights(BaseModel):
    """
    Pesi per il calcolo dell'authority in RLCF.

    Formula: A_u(t) = alpha * B_u + beta * T_u(t-1) + gamma * P_u(t)
    Dove:
        - B_u: Baseline credentials
        - T_u: Track record
        - P_u: Recent performance
    """
    baseline_credentials: LearnableWeight = Field(
        default_factory=lambda: LearnableWeight(
            default=0.4, bounds=(0.1, 0.6), learnable=True
        )
    )
    track_record: LearnableWeight = Field(
        default_factory=lambda: LearnableWeight(
            default=0.4, bounds=(0.2, 0.7), learnable=True
        )
    )
    recent_performance: LearnableWeight = Field(
        default_factory=lambda: LearnableWeight(
            default=0.2, bounds=(0.1, 0.4), learnable=True
        )
    )
    track_record_update_factor: LearnableWeight = Field(
        default_factory=lambda: LearnableWeight(
            default=0.05, bounds=(0.01, 0.2), learnable=True
        ),
        description="Lambda per exponential smoothing del track record"
    )

    @field_validator("baseline_credentials", "track_record", "recent_performance")
    @classmethod
    def weights_must_sum_to_one(cls, v: LearnableWeight, info) -> LearnableWeight:
        # La validazione della somma viene fatta a runtime, non qui
        return v


class GatingWeights(BaseModel):
    """
    Pesi per la gating network (MoE-style expert activation).

    Attributes:
        expert_priors: Pesi iniziali per ogni expert
        query_type_modifiers: Modificatori basati su tipo query
    """
    expert_priors: Dict[str, LearnableWeight] = Field(
        default_factory=lambda: {
            "LiteralExpert": LearnableWeight(default=0.25, bounds=(0.1, 0.5)),
            "SystemicExpert": LearnableWeight(default=0.25, bounds=(0.1, 0.5)),
            "PrinciplesExpert": LearnableWeight(default=0.25, bounds=(0.1, 0.5)),
            "PrecedentExpert": LearnableWeight(default=0.25, bounds=(0.1, 0.5)),
        }
    )
    query_type_modifiers: Dict[str, Dict[str, float]] = Field(
        default_factory=lambda: {
            "definitorio": {"LiteralExpert": 1.5, "SystemicExpert": 0.8},
            "interpretativo": {"PrinciplesExpert": 1.3, "PrecedentExpert": 1.2},
            "applicativo": {"PrecedentExpert": 1.5, "SystemicExpert": 1.1},
        }
    )


class WeightConfig(BaseModel):
    """
    Configurazione completa dei pesi del sistema.

    Unifica tutte le categorie di pesi con supporto per:
    - Persistenza (via WeightStore)
    - Versioning (via experiment_id)
    - Learning (via WeightLearner)
    """
    version: str = Field(default="2.0")
    schema_version: str = Field(default="1.0")

    retrieval: RetrievalWeights = Field(default_factory=RetrievalWeights)
    expert_traversal: Dict[str, ExpertTraversalWeights] = Field(default_factory=dict)
    rlcf: RLCFAuthorityWeights = Field(default_factory=RLCFAuthorityWeights)
    gating: GatingWeights = Field(default_factory=GatingWeights)

    # Metadata
    experiment_id: Optional[str] = Field(default=None, description="ID esperimento A/B")
    created_at: Optional[str] = Field(default=None)
    updated_at: Optional[str] = Field(default=None)
    metrics: Optional[Dict[str, float]] = Field(
        default=None,
        description="Metriche associate a questa versione di pesi"
    )

    def get_retrieval_alpha(self) -> float:
        """Ottiene il valore corrente di alpha per retrieval."""
        return self.retrieval.alpha.default

    def get_expert_weights(self, expert_name: str) -> Dict[str, float]:
        """Ottiene i pesi di traversal per un expert specifico."""
        if expert_name in self.expert_traversal:
            expert = self.expert_traversal[expert_name]
            return {k: w.default for k, w in expert.weights.items()}
        return {}

    def get_gating_prior(self, expert_name: str) -> float:
        """Ottiene il prior di attivazione per un expert."""
        if expert_name in self.gating.expert_priors:
            return self.gating.expert_priors[expert_name].default
        return 0.25  # Default uniforme


class WeightUpdate(BaseModel):
    """
    Richiesta di aggiornamento pesi.

    Usata da WeightLearner per applicare aggiornamenti da RLCF feedback.
    """
    category: WeightCategory
    updates: Dict[str, float] = Field(
        ...,
        description="Mapping weight_name -> new_value"
    )
    feedback_authority: float = Field(
        ge=0.0, le=1.0,
        description="Authority del feedback che ha generato l'update"
    )
    experiment_id: Optional[str] = Field(default=None)


class ExperimentVariant(BaseModel):
    """
    Variante di un esperimento A/B.

    Contiene la configurazione pesi per un braccio dell'esperimento.
    """
    name: str = Field(..., description="Nome variante (es. 'control', 'treatment')")
    weights: WeightConfig
    allocation_ratio: float = Field(default=0.5, ge=0.0, le=1.0)


class ExperimentConfig(BaseModel):
    """
    Configurazione di un esperimento A/B sui pesi.

    Attributes:
        name: Nome dell'esperimento
        variants: Lista di varianti (tipicamente control e treatment)
        min_samples: Campioni minimi per significativita'
        significance_threshold: Soglia p-value
    """
    name: str
    description: Optional[str] = None
    variants: List[ExperimentVariant] = Field(min_length=2)
    min_samples_for_significance: int = Field(default=100)
    significance_threshold: float = Field(default=0.05)
    status: str = Field(default="draft")  # draft, running, completed, stopped

    @field_validator("variants")
    @classmethod
    def allocation_must_sum_to_one(cls, v: List[ExperimentVariant]) -> List[ExperimentVariant]:
        total = sum(variant.allocation_ratio for variant in v)
        if abs(total - 1.0) > 0.001:
            raise ValueError(f"allocation_ratio must sum to 1.0, got {total}")
        return v
