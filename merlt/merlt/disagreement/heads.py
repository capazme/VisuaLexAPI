"""
Prediction Heads per LegalDisagreementNet
==========================================

Multi-task prediction heads per il modello di disagreement detection.

Heads implementati:
1. BinaryHead: P(disagreement) ∈ [0,1]
2. TypeHead: P(type) ∈ [ANT, LAC, MET, OVR, GER, SPE]
3. LevelHead: P(level) ∈ [SEM, SIS, TEL, APP]
4. IntensityHead: intensity ∈ [0,1]
5. ResolvabilityHead: resolvability ∈ [0,1]
6. PairwiseHead: M_ij ∈ R^(4×4) - conflitto tra coppie expert

Esempio:
    >>> from merlt.disagreement.heads import PredictionHeads
    >>>
    >>> heads = PredictionHeads(hidden_size=768)
    >>> outputs = heads(cross_expert_features)
"""

import structlog
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass

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
# OUTPUT DATACLASS
# =============================================================================

@dataclass
class HeadsOutput:
    """
    Output delle prediction heads.

    Contiene logits/valori per tutti i task.
    """
    # Binary detection
    binary_logits: Any  # torch.Tensor [batch, 2]
    binary_probs: Any   # torch.Tensor [batch, 2]

    # Type classification
    type_logits: Any    # torch.Tensor [batch, 6]
    type_probs: Any     # torch.Tensor [batch, 6]

    # Level classification
    level_logits: Any   # torch.Tensor [batch, 4]
    level_probs: Any    # torch.Tensor [batch, 4]

    # Regression
    intensity: Any      # torch.Tensor [batch, 1]
    resolvability: Any  # torch.Tensor [batch, 1]

    # Pairwise
    pairwise_matrix: Any  # torch.Tensor [batch, 4, 4]

    # Confidence
    confidence: Any     # torch.Tensor [batch, 1]

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dict con valori numpy/python."""
        torch, _, _ = _get_torch()

        def to_python(t):
            if isinstance(t, torch.Tensor):
                return t.detach().cpu().numpy().tolist()
            return t

        return {
            "binary_probs": to_python(self.binary_probs),
            "type_probs": to_python(self.type_probs),
            "level_probs": to_python(self.level_probs),
            "intensity": to_python(self.intensity),
            "resolvability": to_python(self.resolvability),
            "pairwise_matrix": to_python(self.pairwise_matrix),
            "confidence": to_python(self.confidence),
        }


# =============================================================================
# SINGOLE HEADS
# =============================================================================

class BinaryHead:
    """
    Head per binary disagreement detection.

    Output: P(disagreement), P(no_disagreement)
    """

    def __init__(self, hidden_size: int, dropout: float = 0.1):
        torch, nn, _ = _get_torch()

        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 2, 2),
        )

    def __call__(self, x):
        return self.classifier(x)

    def parameters(self):
        return self.classifier.parameters()


class TypeHead:
    """
    Head per classificazione tipo di disagreement.

    Output: probabilita' su 6 classi (ANT, LAC, MET, OVR, GER, SPE)
    """

    def __init__(self, hidden_size: int, num_types: int = 6, dropout: float = 0.1):
        torch, nn, _ = _get_torch()

        self.num_types = num_types
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, hidden_size),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 2, num_types),
        )

    def __call__(self, x):
        return self.classifier(x)

    def parameters(self):
        return self.classifier.parameters()


class LevelHead:
    """
    Head per classificazione livello di disagreement.

    Output: probabilita' su 4 classi (SEM, SIS, TEL, APP)
    """

    def __init__(self, hidden_size: int, num_levels: int = 4, dropout: float = 0.1):
        torch, nn, _ = _get_torch()

        self.num_levels = num_levels
        self.classifier = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 2, num_levels),
        )

    def __call__(self, x):
        return self.classifier(x)

    def parameters(self):
        return self.classifier.parameters()


class IntensityHead:
    """
    Head per regressione intensity [0, 1].

    Usa sigmoid per constrainere output in [0, 1].
    """

    def __init__(self, hidden_size: int, dropout: float = 0.1):
        torch, nn, _ = _get_torch()

        self.regressor = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 4),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 4, 1),
            nn.Sigmoid(),
        )

    def __call__(self, x):
        return self.regressor(x)

    def parameters(self):
        return self.regressor.parameters()


class ResolvabilityHead:
    """
    Head per regressione resolvability [0, 1].

    Stima quanto il disagreement e' risolvibile con criteri oggettivi.
    """

    def __init__(self, hidden_size: int, dropout: float = 0.1):
        torch, nn, _ = _get_torch()

        self.regressor = nn.Sequential(
            nn.Linear(hidden_size, hidden_size // 4),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 4, 1),
            nn.Sigmoid(),
        )

    def __call__(self, x):
        return self.regressor(x)

    def parameters(self):
        return self.regressor.parameters()


class PairwiseHead:
    """
    Head per predizione conflitto pairwise tra expert.

    Input: features per ogni coppia di expert
    Output: matrice 4x4 con score di conflitto
    """

    def __init__(
        self,
        hidden_size: int,
        num_experts: int = 4,
        dropout: float = 0.1,
    ):
        torch, nn, _ = _get_torch()

        self.num_experts = num_experts

        # Proietta features coppia in score
        self.pair_scorer = nn.Sequential(
            nn.Linear(hidden_size * 2, hidden_size // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_size // 2, 1),
            nn.Sigmoid(),
        )

    def __call__(self, expert_embeddings):
        """
        Calcola matrice di conflitto pairwise.

        Args:
            expert_embeddings: Tensor [batch, num_experts, hidden_size]

        Returns:
            Tensor [batch, num_experts, num_experts] con score conflitto
        """
        torch, _, _ = _get_torch()

        batch_size = expert_embeddings.shape[0]
        n = self.num_experts

        # Inizializza matrice
        pairwise = torch.zeros(batch_size, n, n, device=expert_embeddings.device)

        # Calcola per ogni coppia
        for i in range(n):
            for j in range(i + 1, n):
                # Concatena embeddings della coppia
                pair_features = torch.cat([
                    expert_embeddings[:, i, :],
                    expert_embeddings[:, j, :],
                ], dim=-1)

                # Score di conflitto
                score = self.pair_scorer(pair_features).squeeze(-1)

                # Simmetrico
                pairwise[:, i, j] = score
                pairwise[:, j, i] = score

        return pairwise

    def parameters(self):
        return self.pair_scorer.parameters()


# =============================================================================
# CROSS-EXPERT ATTENTION
# =============================================================================

class CrossExpertAttention:
    """
    Modulo per cross-attention tra expert embeddings.

    Calcola:
    - Attention weights tra coppie di expert
    - Contrast features (h_i - h_j)
    - Interaction features (h_i * h_j)
    """

    def __init__(
        self,
        hidden_size: int,
        num_experts: int = 4,
        num_heads: int = 4,
        dropout: float = 0.1,
    ):
        torch, nn, _ = _get_torch()

        self.hidden_size = hidden_size
        self.num_experts = num_experts
        self.num_heads = num_heads
        self.head_dim = hidden_size // num_heads

        # Proiezioni Q, K, V
        self.query = nn.Linear(hidden_size, hidden_size)
        self.key = nn.Linear(hidden_size, hidden_size)
        self.value = nn.Linear(hidden_size, hidden_size)

        # Output projection
        self.out_proj = nn.Linear(hidden_size, hidden_size)

        # Contrast e interaction projection
        self.contrast_proj = nn.Linear(hidden_size, hidden_size)
        self.interact_proj = nn.Linear(hidden_size, hidden_size)

        self.dropout = nn.Dropout(dropout)
        self.layer_norm = nn.LayerNorm(hidden_size)

    def __call__(self, expert_embeddings):
        """
        Cross-attention tra expert.

        Args:
            expert_embeddings: Tensor [batch, num_experts, hidden_size]

        Returns:
            Dict con:
            - attended: Tensor [batch, num_experts, hidden_size]
            - attention_weights: Tensor [batch, num_heads, num_experts, num_experts]
            - contrast_features: Tensor [batch, num_experts, num_experts, hidden_size]
            - aggregate: Tensor [batch, hidden_size] per classificazione
        """
        torch, _, F = _get_torch()

        batch_size = expert_embeddings.shape[0]
        n = self.num_experts

        # Q, K, V projections
        Q = self.query(expert_embeddings)  # [batch, n, hidden]
        K = self.key(expert_embeddings)
        V = self.value(expert_embeddings)

        # Reshape per multi-head attention
        Q = Q.view(batch_size, n, self.num_heads, self.head_dim).transpose(1, 2)
        K = K.view(batch_size, n, self.num_heads, self.head_dim).transpose(1, 2)
        V = V.view(batch_size, n, self.num_heads, self.head_dim).transpose(1, 2)

        # Attention scores
        scores = torch.matmul(Q, K.transpose(-2, -1)) / (self.head_dim ** 0.5)
        attention_weights = F.softmax(scores, dim=-1)
        attention_weights = self.dropout(attention_weights)

        # Attended values
        attended = torch.matmul(attention_weights, V)
        attended = attended.transpose(1, 2).contiguous().view(batch_size, n, -1)
        attended = self.out_proj(attended)

        # Residual + LayerNorm
        attended = self.layer_norm(expert_embeddings + attended)

        # Contrast features: h_i - h_j per ogni coppia
        contrast_features = torch.zeros(
            batch_size, n, n, self.hidden_size,
            device=expert_embeddings.device
        )
        for i in range(n):
            for j in range(n):
                contrast = expert_embeddings[:, i, :] - expert_embeddings[:, j, :]
                contrast_features[:, i, j, :] = self.contrast_proj(contrast)

        # Aggregate per classificazione globale
        # Mean pooling degli attended embeddings
        aggregate = attended.mean(dim=1)  # [batch, hidden]

        return {
            "attended": attended,
            "attention_weights": attention_weights,
            "contrast_features": contrast_features,
            "aggregate": aggregate,
        }

    def parameters(self):
        params = []
        params.extend(self.query.parameters())
        params.extend(self.key.parameters())
        params.extend(self.value.parameters())
        params.extend(self.out_proj.parameters())
        params.extend(self.contrast_proj.parameters())
        params.extend(self.interact_proj.parameters())
        params.extend(self.layer_norm.parameters())
        return params


# =============================================================================
# PREDICTION HEADS AGGREGATE
# =============================================================================

class PredictionHeads:
    """
    Aggregazione di tutte le prediction heads.

    Combina:
    - BinaryHead: detection disagreement
    - TypeHead: classificazione tipo
    - LevelHead: classificazione livello
    - IntensityHead: regressione intensita'
    - ResolvabilityHead: regressione risolvibilita'
    - PairwiseHead: matrice conflitto pairwise
    """

    def __init__(
        self,
        hidden_size: int = 768,
        num_types: int = 6,
        num_levels: int = 4,
        num_experts: int = 4,
        dropout: float = 0.1,
    ):
        """
        Inizializza tutte le heads.

        Args:
            hidden_size: Dimensione input features
            num_types: Numero tipi disagreement (6)
            num_levels: Numero livelli (4)
            num_experts: Numero expert (4)
            dropout: Dropout rate
        """
        self.hidden_size = hidden_size
        self.num_experts = num_experts

        # Cross-expert attention
        self.cross_attention = CrossExpertAttention(
            hidden_size=hidden_size,
            num_experts=num_experts,
            dropout=dropout,
        )

        # Prediction heads
        self.binary_head = BinaryHead(hidden_size, dropout)
        self.type_head = TypeHead(hidden_size, num_types, dropout)
        self.level_head = LevelHead(hidden_size, num_levels, dropout)
        self.intensity_head = IntensityHead(hidden_size, dropout)
        self.resolvability_head = ResolvabilityHead(hidden_size, dropout)
        self.pairwise_head = PairwiseHead(hidden_size, num_experts, dropout)

        # Confidence estimation
        torch, nn, _ = _get_torch()
        self.confidence_head = nn.Sequential(
            nn.Linear(hidden_size, 64),
            nn.GELU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def __call__(self, expert_embeddings) -> HeadsOutput:
        """
        Forward pass su tutte le heads.

        Args:
            expert_embeddings: Tensor [batch, num_experts, hidden_size]

        Returns:
            HeadsOutput con predizioni per tutti i task
        """
        torch, _, F = _get_torch()

        # Cross-attention
        cross_out = self.cross_attention(expert_embeddings)
        aggregate = cross_out["aggregate"]  # [batch, hidden]

        # Binary detection
        binary_logits = self.binary_head(aggregate)
        binary_probs = F.softmax(binary_logits, dim=-1)

        # Type classification
        type_logits = self.type_head(aggregate)
        type_probs = F.softmax(type_logits, dim=-1)

        # Level classification
        level_logits = self.level_head(aggregate)
        level_probs = F.softmax(level_logits, dim=-1)

        # Regression
        intensity = self.intensity_head(aggregate)
        resolvability = self.resolvability_head(aggregate)

        # Pairwise
        pairwise_matrix = self.pairwise_head(expert_embeddings)

        # Confidence
        confidence = self.confidence_head(aggregate)

        return HeadsOutput(
            binary_logits=binary_logits,
            binary_probs=binary_probs,
            type_logits=type_logits,
            type_probs=type_probs,
            level_logits=level_logits,
            level_probs=level_probs,
            intensity=intensity,
            resolvability=resolvability,
            pairwise_matrix=pairwise_matrix,
            confidence=confidence,
        )

    def to(self, device):
        """Move all sub-heads and their nn.Module attributes to device."""
        torch, nn_mod, _ = _get_torch()
        for obj in [
            self, self.cross_attention, self.binary_head, self.type_head,
            self.level_head, self.intensity_head, self.resolvability_head,
            self.pairwise_head,
        ]:
            for attr_name in list(vars(obj)):
                attr = getattr(obj, attr_name)
                if isinstance(attr, torch.nn.Module):
                    setattr(obj, attr_name, attr.to(device))
        return self

    def parameters(self):
        """Tutti i parametri trainabili."""
        params = []
        params.extend(self.cross_attention.parameters())
        params.extend(self.binary_head.parameters())
        params.extend(self.type_head.parameters())
        params.extend(self.level_head.parameters())
        params.extend(self.intensity_head.parameters())
        params.extend(self.resolvability_head.parameters())
        params.extend(self.pairwise_head.parameters())
        params.extend(self.confidence_head.parameters())
        return params
