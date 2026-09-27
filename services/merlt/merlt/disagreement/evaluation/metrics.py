"""
Disagreement Metrics
====================

Metriche per valutazione di LegalDisagreementNet.

Metriche implementate:
- Binary detection: Accuracy, Precision, Recall, F1
- Type classification: Macro/Micro F1, per-class metrics
- Level classification: Macro/Micro F1
- Regression: MAE, MSE per intensity/resolvability
- Pairwise: Agreement con human annotations

Esempio:
    >>> from merlt.disagreement.evaluation import compute_disagreement_metrics
    >>>
    >>> metrics = compute_disagreement_metrics(predictions, ground_truth)
    >>> print(f"Binary F1: {metrics.binary_f1:.3f}")
    >>> print(f"Type Macro F1: {metrics.type_macro_f1:.3f}")
"""

import structlog
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
import numpy as np

from merlt.disagreement.types import (
    DisagreementType,
    DisagreementLevel,
    DisagreementAnalysis,
    DisagreementSample,
)

log = structlog.get_logger()


@dataclass
class DisagreementMetrics:
    """
    Metriche complete per valutazione LegalDisagreementNet.

    Attributes:
        # Binary detection
        binary_accuracy: Accuracy detection disagreement
        binary_precision: Precision detection
        binary_recall: Recall detection
        binary_f1: F1 score detection

        # Type classification
        type_accuracy: Accuracy classificazione tipo
        type_macro_f1: Macro F1 (media su classi)
        type_micro_f1: Micro F1 (globale)
        type_per_class: Metriche per singola classe

        # Level classification
        level_accuracy: Accuracy classificazione livello
        level_macro_f1: Macro F1 livello
        level_per_class: Metriche per singolo livello

        # Regression
        intensity_mae: MAE intensity
        intensity_mse: MSE intensity
        resolvability_mae: MAE resolvability
        resolvability_mse: MSE resolvability

        # Metadata
        n_samples: Numero samples valutati
        n_positive: Samples con disagreement
        n_negative: Samples senza disagreement
    """
    # Binary detection
    binary_accuracy: float = 0.0
    binary_precision: float = 0.0
    binary_recall: float = 0.0
    binary_f1: float = 0.0

    # Type classification
    type_accuracy: float = 0.0
    type_macro_f1: float = 0.0
    type_micro_f1: float = 0.0
    type_per_class: Dict[str, Dict[str, float]] = field(default_factory=dict)

    # Level classification
    level_accuracy: float = 0.0
    level_macro_f1: float = 0.0
    level_per_class: Dict[str, Dict[str, float]] = field(default_factory=dict)

    # Regression
    intensity_mae: float = 0.0
    intensity_mse: float = 0.0
    resolvability_mae: float = 0.0
    resolvability_mse: float = 0.0

    # Metadata
    n_samples: int = 0
    n_positive: int = 0
    n_negative: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "binary": {
                "accuracy": self.binary_accuracy,
                "precision": self.binary_precision,
                "recall": self.binary_recall,
                "f1": self.binary_f1,
            },
            "type": {
                "accuracy": self.type_accuracy,
                "macro_f1": self.type_macro_f1,
                "micro_f1": self.type_micro_f1,
                "per_class": self.type_per_class,
            },
            "level": {
                "accuracy": self.level_accuracy,
                "macro_f1": self.level_macro_f1,
                "per_class": self.level_per_class,
            },
            "regression": {
                "intensity_mae": self.intensity_mae,
                "intensity_mse": self.intensity_mse,
                "resolvability_mae": self.resolvability_mae,
                "resolvability_mse": self.resolvability_mse,
            },
            "metadata": {
                "n_samples": self.n_samples,
                "n_positive": self.n_positive,
                "n_negative": self.n_negative,
            },
        }

    def summary(self) -> str:
        """Restituisce summary leggibile."""
        return (
            f"DisagreementMetrics (n={self.n_samples}):\n"
            f"  Binary:  Acc={self.binary_accuracy:.3f}, F1={self.binary_f1:.3f}\n"
            f"  Type:    Acc={self.type_accuracy:.3f}, Macro-F1={self.type_macro_f1:.3f}\n"
            f"  Level:   Acc={self.level_accuracy:.3f}, Macro-F1={self.level_macro_f1:.3f}\n"
            f"  Regress: Intensity MAE={self.intensity_mae:.3f}, Resolv MAE={self.resolvability_mae:.3f}"
        )


def compute_disagreement_metrics(
    predictions: List[DisagreementAnalysis],
    ground_truth: List[DisagreementSample],
) -> DisagreementMetrics:
    """
    Calcola metriche complete confrontando predizioni con ground truth.

    Args:
        predictions: Lista di DisagreementAnalysis (output modello)
        ground_truth: Lista di DisagreementSample (labels)

    Returns:
        DisagreementMetrics con tutte le metriche
    """
    if len(predictions) != len(ground_truth):
        raise ValueError(
            f"Mismatch lunghezza: {len(predictions)} predictions, "
            f"{len(ground_truth)} ground truth"
        )

    n_samples = len(predictions)
    if n_samples == 0:
        return DisagreementMetrics()

    # === Binary Detection ===
    y_true_binary = [
        1 if gt.has_disagreement else 0
        for gt in ground_truth
    ]
    y_pred_binary = [
        1 if pred.has_disagreement else 0
        for pred in predictions
    ]

    binary_metrics = _compute_binary_metrics(y_true_binary, y_pred_binary)

    # === Type Classification ===
    # Solo su samples con disagreement
    type_true = []
    type_pred = []
    for gt, pred in zip(ground_truth, predictions):
        if gt.has_disagreement and gt.disagreement_type:
            type_true.append(gt.disagreement_type.value)
            type_pred.append(
                pred.disagreement_type.value if pred.disagreement_type else "none"
            )

    type_metrics = _compute_multiclass_metrics(
        type_true, type_pred,
        classes=[t.value for t in DisagreementType]
    )

    # === Level Classification ===
    level_true = []
    level_pred = []
    for gt, pred in zip(ground_truth, predictions):
        if gt.has_disagreement and gt.disagreement_level:
            level_true.append(gt.disagreement_level.value)
            level_pred.append(
                pred.disagreement_level.value if pred.disagreement_level else "none"
            )

    level_metrics = _compute_multiclass_metrics(
        level_true, level_pred,
        classes=[l.value for l in DisagreementLevel]
    )

    # === Regression ===
    intensity_true = []
    intensity_pred = []
    resolvability_true = []
    resolvability_pred = []

    for gt, pred in zip(ground_truth, predictions):
        if gt.intensity is not None:
            intensity_true.append(gt.intensity)
            intensity_pred.append(pred.intensity)
        if gt.resolvability is not None:
            resolvability_true.append(gt.resolvability)
            resolvability_pred.append(pred.resolvability)

    intensity_metrics = _compute_regression_metrics(intensity_true, intensity_pred)
    resolvability_metrics = _compute_regression_metrics(
        resolvability_true, resolvability_pred
    )

    # === Assemble ===
    n_positive = sum(1 for gt in ground_truth if gt.has_disagreement)

    return DisagreementMetrics(
        # Binary
        binary_accuracy=binary_metrics["accuracy"],
        binary_precision=binary_metrics["precision"],
        binary_recall=binary_metrics["recall"],
        binary_f1=binary_metrics["f1"],
        # Type
        type_accuracy=type_metrics["accuracy"],
        type_macro_f1=type_metrics["macro_f1"],
        type_micro_f1=type_metrics["micro_f1"],
        type_per_class=type_metrics["per_class"],
        # Level
        level_accuracy=level_metrics["accuracy"],
        level_macro_f1=level_metrics["macro_f1"],
        level_per_class=level_metrics["per_class"],
        # Regression
        intensity_mae=intensity_metrics["mae"],
        intensity_mse=intensity_metrics["mse"],
        resolvability_mae=resolvability_metrics["mae"],
        resolvability_mse=resolvability_metrics["mse"],
        # Metadata
        n_samples=n_samples,
        n_positive=n_positive,
        n_negative=n_samples - n_positive,
    )


def compute_pairwise_metrics(
    predictions: List[DisagreementAnalysis],
    ground_truth: List[DisagreementSample],
) -> Dict[str, float]:
    """
    Calcola metriche per predizione coppie in conflitto.

    Args:
        predictions: Predizioni del modello
        ground_truth: Ground truth

    Returns:
        Dict con precision, recall, f1 per coppie
    """
    tp = 0  # True positives
    fp = 0  # False positives
    fn = 0  # False negatives

    for pred, gt in zip(predictions, ground_truth):
        pred_pairs = set()
        gt_pairs = set()

        # Estrai coppie predette
        for pair in pred.conflicting_pairs:
            pred_pairs.add((pair.expert_a, pair.expert_b))
            pred_pairs.add((pair.expert_b, pair.expert_a))  # Simmetrizza

        # Estrai coppie ground truth
        if gt.conflicting_pairs:
            for pair in gt.conflicting_pairs:
                gt_pairs.add(tuple(pair))
                gt_pairs.add((pair[1], pair[0]))  # Simmetrizza

        # Conta
        tp += len(pred_pairs & gt_pairs) // 2  # Dividi per simmetria
        fp += len(pred_pairs - gt_pairs) // 2
        fn += len(gt_pairs - pred_pairs) // 2

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "pair_precision": precision,
        "pair_recall": recall,
        "pair_f1": f1,
        "tp": tp,
        "fp": fp,
        "fn": fn,
    }


def _compute_binary_metrics(
    y_true: List[int],
    y_pred: List[int]
) -> Dict[str, float]:
    """Calcola metriche binarie."""
    if not y_true:
        return {"accuracy": 0.0, "precision": 0.0, "recall": 0.0, "f1": 0.0}

    y_true = np.array(y_true)
    y_pred = np.array(y_pred)

    accuracy = np.mean(y_true == y_pred)

    tp = np.sum((y_true == 1) & (y_pred == 1))
    fp = np.sum((y_true == 0) & (y_pred == 1))
    fn = np.sum((y_true == 1) & (y_pred == 0))

    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

    return {
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
    }


def _compute_multiclass_metrics(
    y_true: List[str],
    y_pred: List[str],
    classes: List[str]
) -> Dict[str, Any]:
    """Calcola metriche multiclass."""
    if not y_true:
        return {
            "accuracy": 0.0,
            "macro_f1": 0.0,
            "micro_f1": 0.0,
            "per_class": {},
        }

    # Accuracy globale
    accuracy = sum(1 for t, p in zip(y_true, y_pred) if t == p) / len(y_true)

    # Per-class metrics
    per_class = {}
    class_f1s = []

    for cls in classes:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == cls and p == cls)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != cls and p == cls)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == cls and p != cls)

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0

        per_class[cls] = {
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "support": sum(1 for t in y_true if t == cls),
        }

        if per_class[cls]["support"] > 0:
            class_f1s.append(f1)

    # Macro F1
    macro_f1 = np.mean(class_f1s) if class_f1s else 0.0

    # Micro F1 (= accuracy per multiclass)
    micro_f1 = accuracy

    return {
        "accuracy": accuracy,
        "macro_f1": float(macro_f1),
        "micro_f1": micro_f1,
        "per_class": per_class,
    }


def _compute_regression_metrics(
    y_true: List[float],
    y_pred: List[float]
) -> Dict[str, float]:
    """Calcola metriche regression."""
    if not y_true:
        return {"mae": 0.0, "mse": 0.0}

    y_true = np.array(y_true)
    y_pred = np.array(y_pred)

    mae = np.mean(np.abs(y_true - y_pred))
    mse = np.mean((y_true - y_pred) ** 2)

    return {
        "mae": float(mae),
        "mse": float(mse),
    }
