"""
Disagreement Loss
=================

Multi-task loss per training LegalDisagreementNet.

Combina:
1. Binary Cross Entropy per detection disagreement
2. Cross Entropy per tipo (6 classi)
3. Cross Entropy per livello (4 classi)
4. MSE per intensity [0,1]
5. MSE per resolvability [0,1]
6. Contrastive loss per pairwise matrix

Include:
- Class balancing per classi sbilanciate
- Focal loss per hard examples
- Task weighting dinamico

Fondamento teorico:
    L_total = Σᵢ wᵢ * Lᵢ
    dove wᵢ sono pesi task-specific (learnable o fissi)

Esempio:
    >>> from merlt.disagreement.loss import DisagreementLoss
    >>>
    >>> loss_fn = DisagreementLoss(
    ...     task_weights={"binary": 1.0, "type": 0.8, "level": 0.6}
    ... )
    >>> outputs = model(batch)
    >>> losses = loss_fn(outputs, targets)
    >>> total_loss = losses["total"]
"""

import structlog
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any

log = structlog.get_logger()

# Lazy imports
_torch = None
_nn = None
_F = None


def _get_torch():
    """Lazy import di torch."""
    global _torch, _nn, _F
    if _torch is None:
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
        _torch = torch
        _nn = nn
        _F = F
    return _torch, _nn, _F


# =============================================================================
# CONFIGURATION
# =============================================================================

@dataclass
class LossConfig:
    """
    Configurazione per DisagreementLoss.

    Attributes:
        task_weights: Pesi per ogni task loss
        use_focal_loss: Usa focal loss per binary/type/level
        focal_gamma: Gamma per focal loss
        label_smoothing: Smoothing per cross entropy
        class_weights: Pesi per classi sbilanciate (per task)
        dynamic_weighting: Usa uncertainty weighting dinamico
    """
    task_weights: Dict[str, float] = field(default_factory=lambda: {
        "binary": 1.0,
        "type": 0.8,
        "level": 0.6,
        "intensity": 0.4,
        "resolvability": 0.4,
        "pairwise": 0.3,
    })
    use_focal_loss: bool = True
    focal_gamma: float = 2.0
    label_smoothing: float = 0.1
    class_weights: Optional[Dict[str, List[float]]] = None
    dynamic_weighting: bool = False


# =============================================================================
# COMPONENT LOSSES
# =============================================================================

class FocalLoss:
    """
    Focal Loss per gestire class imbalance.

    FL(p) = -α(1-p)^γ * log(p)

    Riduce il peso degli esempi facili, focus su quelli difficili.
    """

    def __init__(
        self,
        gamma: float = 2.0,
        alpha: Optional[List[float]] = None,
        reduction: str = "mean"
    ):
        """
        Inizializza Focal Loss.

        Args:
            gamma: Focusing parameter (0 = standard CE)
            alpha: Class weights [num_classes]
            reduction: "mean", "sum", o "none"
        """
        self.gamma = gamma
        self.alpha = alpha
        self.reduction = reduction

    def __call__(self, logits, targets):
        """
        Calcola focal loss.

        Args:
            logits: Logits del modello [batch, num_classes]
            targets: Target class indices [batch]

        Returns:
            Loss scalare o per-sample
        """
        torch, _, F = _get_torch()

        ce_loss = F.cross_entropy(logits, targets, reduction="none")
        pt = torch.exp(-ce_loss)  # probability of correct class
        focal_loss = ((1 - pt) ** self.gamma) * ce_loss

        if self.alpha is not None:
            alpha_t = torch.tensor(self.alpha, device=logits.device)[targets]
            focal_loss = alpha_t * focal_loss

        if self.reduction == "mean":
            return focal_loss.mean()
        elif self.reduction == "sum":
            return focal_loss.sum()
        return focal_loss


class ContrastivePairwiseLoss:
    """
    Contrastive loss per pairwise conflict matrix.

    Incoraggia:
    - Alta similarita' (basso conflict) per coppie concordi
    - Bassa similarita' (alto conflict) per coppie discordi
    """

    def __init__(self, margin: float = 0.5):
        """
        Args:
            margin: Margine minimo tra positivi e negativi
        """
        self.margin = margin

    def __call__(
        self,
        predicted_matrix,
        target_pairs: Optional[List[tuple]] = None,
        has_disagreement: Optional[bool] = None
    ):
        """
        Calcola contrastive loss su matrice pairwise.

        Args:
            predicted_matrix: Tensor [batch, 4, 4] con conflict scores
            target_pairs: Lista di tuple (i, j) che dovrebbero avere alto conflict
            has_disagreement: Se True, expected almeno alcune coppie in conflitto

        Returns:
            Loss scalare
        """
        torch, _, F = _get_torch()

        batch_size = predicted_matrix.shape[0]
        loss = torch.tensor(0.0, device=predicted_matrix.device)

        for b in range(batch_size):
            matrix = predicted_matrix[b]  # [4, 4]

            # Se abbiamo target pairs espliciti
            if target_pairs and b < len(target_pairs) and target_pairs[b]:
                pairs = target_pairs[b]
                positive_loss = torch.tensor(0.0, device=matrix.device)
                negative_loss = torch.tensor(0.0, device=matrix.device)

                for i in range(4):
                    for j in range(i + 1, 4):
                        is_positive = (i, j) in pairs or (j, i) in pairs
                        score = matrix[i, j]

                        if is_positive:
                            # Dovrebbe essere alto (vicino a 1)
                            positive_loss += (1 - score) ** 2
                        else:
                            # Dovrebbe essere basso (vicino a 0)
                            negative_loss += score ** 2

                # Margin loss
                batch_loss = positive_loss + negative_loss

            # Se sappiamo solo se c'e' disagreement o no
            elif has_disagreement is not None:
                # Gestisci diversi tipi di input
                if isinstance(has_disagreement, list):
                    has_dis = bool(has_disagreement[b])
                elif isinstance(has_disagreement, torch.Tensor):
                    if has_disagreement.dim() == 0:
                        has_dis = bool(has_disagreement.item())
                    else:
                        has_dis = bool(has_disagreement[b].item())
                else:
                    has_dis = bool(has_disagreement)

                # Prendi elementi sopra diagonale
                upper_triangle = []
                for i in range(4):
                    for j in range(i + 1, 4):
                        upper_triangle.append(matrix[i, j])
                scores = torch.stack(upper_triangle)

                if has_dis:
                    # Almeno uno dovrebbe essere alto
                    max_score = scores.max()
                    batch_loss = F.relu(self.margin - max_score)
                else:
                    # Tutti dovrebbero essere bassi
                    batch_loss = scores.mean()

            else:
                batch_loss = torch.tensor(0.0, device=matrix.device)

            loss += batch_loss

        return loss / batch_size


# =============================================================================
# MAIN LOSS CLASS
# =============================================================================

class DisagreementLoss:
    """
    Multi-task loss per LegalDisagreementNet.

    Combina multiple loss functions con pesi configurabili.
    Supporta:
    - Focal loss per classification tasks
    - MSE/Huber per regression tasks
    - Contrastive loss per pairwise matrix
    - Dynamic task weighting (uncertainty weighting)
    """

    def __init__(self, config: Optional[LossConfig] = None):
        """
        Inizializza DisagreementLoss.

        Args:
            config: Configurazione loss (default se None)
        """
        torch, nn, _ = _get_torch()

        self.config = config or LossConfig()

        # Task weights
        self.task_weights = self.config.task_weights

        # Focal loss per classification
        self.focal_loss = FocalLoss(
            gamma=self.config.focal_gamma,
            alpha=self.config.class_weights.get("type") if self.config.class_weights else None
        )

        # Contrastive loss per pairwise
        self.pairwise_loss = ContrastivePairwiseLoss()

        # Dynamic weighting params (se abilitato)
        if self.config.dynamic_weighting:
            self.log_vars = nn.ParameterDict({
                task: nn.Parameter(torch.zeros(1))
                for task in self.task_weights.keys()
            })

        log.info(
            "DisagreementLoss initialized",
            task_weights=self.task_weights,
            use_focal=self.config.use_focal_loss,
            dynamic_weighting=self.config.dynamic_weighting,
        )

    def __call__(
        self,
        outputs: Any,  # HeadsOutput
        targets: Dict[str, Any],
        mask: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Calcola tutte le losses.

        Args:
            outputs: HeadsOutput dal modello
            targets: Dict con:
                - binary: Tensor [batch] con 0/1
                - type: Tensor [batch] con class indices 0-5
                - level: Tensor [batch] con class indices 0-3
                - intensity: Tensor [batch] con valori [0-1]
                - resolvability: Tensor [batch] con valori [0-1]
                - conflicting_pairs: Lista di liste di tuple (opzionale)
            mask: Dict con maschere per task opzionali

        Returns:
            Dict con:
                - total: Loss totale
                - binary: Binary loss
                - type: Type classification loss
                - level: Level classification loss
                - intensity: Intensity regression loss
                - resolvability: Resolvability regression loss
                - pairwise: Pairwise contrastive loss
                - metrics: Dict con metriche aggiuntive
        """
        torch, nn, F = _get_torch()

        losses = {}
        metrics = {}

        # 1. Binary detection loss
        if "binary" in targets and targets["binary"] is not None:
            binary_targets = targets["binary"]
            if self.config.use_focal_loss:
                losses["binary"] = self.focal_loss(
                    outputs.binary_logits,
                    binary_targets.long()
                )
            else:
                losses["binary"] = F.cross_entropy(
                    outputs.binary_logits,
                    binary_targets.long(),
                    label_smoothing=self.config.label_smoothing
                )

            # Accuracy metric
            preds = outputs.binary_probs.argmax(dim=-1)
            metrics["binary_accuracy"] = (preds == binary_targets).float().mean().item()

        # 2. Type classification loss
        # Solo per samples CON disagreement
        if "type" in targets and targets["type"] is not None:
            type_targets = targets["type"]

            # Mask per samples con disagreement
            type_mask = mask.get("type") if mask else None
            if type_mask is None and "binary" in targets:
                type_mask = targets["binary"] == 1

            if type_mask is not None and type_mask.any():
                masked_logits = outputs.type_logits[type_mask]
                masked_targets = type_targets[type_mask]

                if len(masked_targets) > 0:
                    if self.config.use_focal_loss:
                        losses["type"] = self.focal_loss(
                            masked_logits,
                            masked_targets.long()
                        )
                    else:
                        losses["type"] = F.cross_entropy(
                            masked_logits,
                            masked_targets.long(),
                            label_smoothing=self.config.label_smoothing
                        )

                    # Accuracy
                    preds = masked_logits.argmax(dim=-1)
                    metrics["type_accuracy"] = (preds == masked_targets).float().mean().item()

        # 3. Level classification loss
        if "level" in targets and targets["level"] is not None:
            level_targets = targets["level"]

            level_mask = mask.get("level") if mask else None
            if level_mask is None and "binary" in targets:
                level_mask = targets["binary"] == 1

            if level_mask is not None and level_mask.any():
                masked_logits = outputs.level_logits[level_mask]
                masked_targets = level_targets[level_mask]

                if len(masked_targets) > 0:
                    losses["level"] = F.cross_entropy(
                        masked_logits,
                        masked_targets.long(),
                        label_smoothing=self.config.label_smoothing
                    )

                    preds = masked_logits.argmax(dim=-1)
                    metrics["level_accuracy"] = (preds == masked_targets).float().mean().item()

        # 4. Intensity regression loss
        if "intensity" in targets and targets["intensity"] is not None:
            intensity_targets = targets["intensity"].float()
            intensity_preds = outputs.intensity.squeeze(-1)

            # Huber loss per robustezza a outliers
            losses["intensity"] = F.huber_loss(
                intensity_preds,
                intensity_targets,
                reduction="mean",
                delta=0.1
            )

            # MAE metric
            metrics["intensity_mae"] = (intensity_preds - intensity_targets).abs().mean().item()

        # 5. Resolvability regression loss
        if "resolvability" in targets and targets["resolvability"] is not None:
            resolvability_targets = targets["resolvability"].float()
            resolvability_preds = outputs.resolvability.squeeze(-1)

            losses["resolvability"] = F.huber_loss(
                resolvability_preds,
                resolvability_targets,
                reduction="mean",
                delta=0.1
            )

            metrics["resolvability_mae"] = (
                resolvability_preds - resolvability_targets
            ).abs().mean().item()

        # 6. Pairwise contrastive loss
        if outputs.pairwise_matrix is not None:
            conflicting_pairs = targets.get("conflicting_pairs")
            has_disagreement = targets.get("binary")

            losses["pairwise"] = self.pairwise_loss(
                outputs.pairwise_matrix,
                target_pairs=conflicting_pairs,
                has_disagreement=has_disagreement
            )

        # Compute total loss with weighting
        total_loss = torch.tensor(0.0, device=outputs.binary_logits.device)

        for task, loss in losses.items():
            weight = self.task_weights.get(task, 1.0)

            if self.config.dynamic_weighting and hasattr(self, "log_vars"):
                # Uncertainty weighting: L = 1/σ² * L + log(σ)
                log_var = self.log_vars[task]
                precision = torch.exp(-log_var)
                weighted_loss = precision * loss + log_var
            else:
                weighted_loss = weight * loss

            total_loss += weighted_loss

        losses["total"] = total_loss
        losses["metrics"] = metrics

        return losses

    def get_task_weights_summary(self) -> Dict[str, float]:
        """Restituisce i pesi task attuali."""
        torch, _, _ = _get_torch()

        if self.config.dynamic_weighting and hasattr(self, "log_vars"):
            return {
                task: torch.exp(-self.log_vars[task]).item()
                for task in self.log_vars
            }
        return self.task_weights

    def parameters(self):
        """Parametri trainabili (per dynamic weighting)."""
        if self.config.dynamic_weighting and hasattr(self, "log_vars"):
            return self.log_vars.parameters()
        return iter([])


# =============================================================================
# CURRICULUM LOSS
# =============================================================================

class CurriculumLoss:
    """
    Loss wrapper per curriculum learning.

    Abilita/disabilita task progressivamente durante il training:
    - Phase 1: Solo binary
    - Phase 2: Binary + type + level
    - Phase 3: Full (tutti i task)
    """

    def __init__(
        self,
        base_loss: DisagreementLoss,
        phase1_epochs: int = 10,
        phase2_epochs: int = 20,
    ):
        """
        Args:
            base_loss: DisagreementLoss sottostante
            phase1_epochs: Epoche per fase 1 (solo binary)
            phase2_epochs: Epoche per fase 2 (+type/level)
        """
        self.base_loss = base_loss
        self.phase1_epochs = phase1_epochs
        self.phase2_epochs = phase2_epochs
        self.current_epoch = 0

    def set_epoch(self, epoch: int):
        """Imposta epoca corrente per curriculum."""
        self.current_epoch = epoch

    def get_phase(self) -> int:
        """Restituisce fase corrente (1, 2, o 3)."""
        if self.current_epoch < self.phase1_epochs:
            return 1
        elif self.current_epoch < self.phase1_epochs + self.phase2_epochs:
            return 2
        return 3

    def __call__(
        self,
        outputs: Any,
        targets: Dict[str, Any],
        mask: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Calcola loss con curriculum.

        Maschera task in base alla fase corrente.
        """
        phase = self.get_phase()

        # Modifica targets in base alla fase
        curriculum_targets = targets.copy()
        curriculum_mask = mask.copy() if mask else {}

        if phase == 1:
            # Solo binary
            for task in ["type", "level", "intensity", "resolvability"]:
                curriculum_targets[task] = None
        elif phase == 2:
            # Binary + type + level
            for task in ["intensity", "resolvability"]:
                curriculum_targets[task] = None

        # Phase 3: tutti i task abilitati

        losses = self.base_loss(outputs, curriculum_targets, curriculum_mask)
        losses["phase"] = phase

        return losses

    def parameters(self):
        """Parametri trainabili."""
        return self.base_loss.parameters()
