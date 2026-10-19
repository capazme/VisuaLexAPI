"""
MERL-T Disagreement Detection Module
=====================================

Modulo per rilevamento, classificazione e spiegazione delle divergenze
interpretative nel diritto italiano.

Fondamento teorico: Art. 12-14 disp. prel. c.c. (Preleggi)

Componenti:
- **types**: Tassonomia (DisagreementType, DisagreementLevel)
- **data**: Pipeline raccolta dati per training
- **encoder**: LegalBertEncoder con LoRA adapters
- **heads**: Multi-task prediction heads
- **detector**: LegalDisagreementNet (modello neurale)
- **evaluation**: Metriche per valutazione

Esempio di utilizzo:
    >>> from merlt.disagreement import (
    ...     LegalDisagreementNet,
    ...     analyze_expert_disagreement,
    ...     DisagreementType,
    ... )
    >>>
    >>> # Modo semplice
    >>> analysis = await analyze_expert_disagreement(
    ...     query="Il venditore puo' recedere?",
    ...     expert_responses={"literal": "...", "principles": "..."}
    ... )
    >>>
    >>> if analysis.has_disagreement:
    ...     print(f"Tipo: {analysis.disagreement_type.label}")
    ...     print(f"Modo sintesi: {analysis.synthesis_mode}")

Valore scientifico:
1. Primo modello specifico per divergenze dottrinali nel diritto italiano
2. Tassonomia fondata sui canoni interpretativi delle Preleggi
3. Multi-task learning con 6 prediction heads
4. Cross-Expert Attention per confronto expert embeddings
"""

from merlt.disagreement.types import (
    # Enums
    DisagreementType,
    DisagreementLevel,
    # Dataclasses - Analysis
    DisagreementAnalysis,
    DisagreementExplanation,
    ExpertPairConflict,
    TokenAttribution,
    # Dataclasses - Data
    DisagreementSample,
    ExpertResponseData,
    # Dataclasses - Active Learning
    AnnotationCandidate,
    AnnotationQuestion,
    Annotation,
    # Constants
    TYPE_LEVEL_FREQUENCY,
    EXPERT_NAMES,
    EXPERT_DISPLAY_NAMES,
    EXPERT_PAIRS,
)

from merlt.disagreement.data import (
    DisagreementDataCollector,
    RLCFSource,
    OverrulingSource,
    SyntheticSource,
    DisagreementDataset,
    StreamingDisagreementDataset,
    DisagreementAugmenter,
    AugmentationConfig,
)

from merlt.disagreement.encoder import (
    LegalBertEncoder,
    EncoderConfig,
)

from merlt.disagreement.heads import (
    PredictionHeads,
    HeadsOutput,
    CrossExpertAttention,
)

from merlt.disagreement.detector import (
    LegalDisagreementNet,
    DetectorConfig,
    get_disagreement_detector,
    analyze_expert_disagreement,
)

from merlt.disagreement.evaluation import (
    DisagreementMetrics,
    compute_disagreement_metrics,
    compute_pairwise_metrics,
)

from merlt.disagreement.loss import (
    DisagreementLoss,
    LossConfig,
    CurriculumLoss,
    FocalLoss,
    ContrastivePairwiseLoss,
)

from merlt.disagreement.trainer import (
    DisagreementTrainer,
    TrainerConfig,
    CurriculumScheduler,
    EpochMetrics,
    TrainingState,
)

from merlt.disagreement.explainer import (
    ExplainabilityModule,
    IntegratedGradients,
    AttentionAnalyzer,
    ExplanationGenerator,
)

from merlt.disagreement.active_learning import (
    ActiveLearningManager,
    ActiveLearningConfig,
    UncertaintyEstimator,
    DiversitySampler,
)

__all__ = [
    # === Model ===
    "LegalDisagreementNet",
    "DetectorConfig",
    "get_disagreement_detector",
    "analyze_expert_disagreement",
    # === Encoder ===
    "LegalBertEncoder",
    "EncoderConfig",
    # === Heads ===
    "PredictionHeads",
    "HeadsOutput",
    "CrossExpertAttention",
    # === Enums ===
    "DisagreementType",
    "DisagreementLevel",
    # === Analysis Dataclasses ===
    "DisagreementAnalysis",
    "DisagreementExplanation",
    "ExpertPairConflict",
    "TokenAttribution",
    # === Data Dataclasses ===
    "DisagreementSample",
    "ExpertResponseData",
    # === Active Learning Dataclasses ===
    "AnnotationCandidate",
    "AnnotationQuestion",
    "Annotation",
    # === Data Collection ===
    "DisagreementDataCollector",
    "RLCFSource",
    "OverrulingSource",
    "SyntheticSource",
    # === Dataset & Augmentation ===
    "DisagreementDataset",
    "StreamingDisagreementDataset",
    "DisagreementAugmenter",
    "AugmentationConfig",
    # === Evaluation ===
    "DisagreementMetrics",
    "compute_disagreement_metrics",
    "compute_pairwise_metrics",
    # === Constants ===
    "TYPE_LEVEL_FREQUENCY",
    "EXPERT_NAMES",
    "EXPERT_DISPLAY_NAMES",
    "EXPERT_PAIRS",
    # === Loss ===
    "DisagreementLoss",
    "LossConfig",
    "CurriculumLoss",
    "FocalLoss",
    "ContrastivePairwiseLoss",
    # === Trainer ===
    "DisagreementTrainer",
    "TrainerConfig",
    "CurriculumScheduler",
    "EpochMetrics",
    "TrainingState",
    # === Explainer ===
    "ExplainabilityModule",
    "IntegratedGradients",
    "AttentionAnalyzer",
    "ExplanationGenerator",
    # === Active Learning ===
    "ActiveLearningManager",
    "ActiveLearningConfig",
    "UncertaintyEstimator",
    "DiversitySampler",
]

# Versione del modulo
__version__ = "0.3.0"
