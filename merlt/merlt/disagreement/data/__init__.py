"""
Disagreement Data Module
========================

Pipeline per raccolta, preprocessing e gestione dei dati
per training di LegalDisagreementNet.

Fonti:
1. RLCF Feedback (silver labels)
2. Overruling dal grafo (gold labels)
3. Synthetic generation (bronze labels)
4. Expert annotations (gold labels)

Componenti:
- collector: Raccolta dati da fonti multiple
- dataset: PyTorch Dataset per training
- augmentation: Tecniche di data augmentation
"""

from merlt.disagreement.data.collector import (
    DisagreementDataCollector,
    RLCFSource,
    OverrulingSource,
    SyntheticSource,
    CollectionStats,
)

from merlt.disagreement.data.dataset import (
    DisagreementDataset,
    StreamingDisagreementDataset,
    TYPE_TO_IDX,
    IDX_TO_TYPE,
    LEVEL_TO_IDX,
    IDX_TO_LEVEL,
    EXPERT_TO_IDX,
)

from merlt.disagreement.data.augmentation import (
    DisagreementAugmenter,
    AugmentationConfig,
    TextDropout,
    SynonymReplacement,
    NoiseInjection,
    ExpertPermutation,
)

__all__ = [
    # === Collector ===
    "DisagreementDataCollector",
    "RLCFSource",
    "OverrulingSource",
    "SyntheticSource",
    "CollectionStats",
    # === Dataset ===
    "DisagreementDataset",
    "StreamingDisagreementDataset",
    "TYPE_TO_IDX",
    "IDX_TO_TYPE",
    "LEVEL_TO_IDX",
    "IDX_TO_LEVEL",
    "EXPERT_TO_IDX",
    # === Augmentation ===
    "DisagreementAugmenter",
    "AugmentationConfig",
    "TextDropout",
    "SynonymReplacement",
    "NoiseInjection",
    "ExpertPermutation",
]
