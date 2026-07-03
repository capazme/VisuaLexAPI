"""
Policy Gradient Training
=========================

Implementazione REINFORCE per apprendimento policy-based nel sistema MERL-T.

Componenti:
1. **GatingPolicy**: MLP che mappa query embedding → expert weights (softmax 4-dim)
2. **TraversalPolicy**: MLP per pesi relazioni nel grafo
3. **PolicyGradientTrainer**: Trainer REINFORCE con baseline

Formula REINFORCE:
    ∇J(θ) = E[∑ₜ ∇log π_θ(aₜ|sₜ) * (R - baseline)]

Dove:
- π_θ(aₜ|sₜ) = policy parametrizzata da θ
- R = reward totale da feedback
- baseline = moving average dei reward passati (variance reduction)

Esempio:
    >>> from merlt.rlcf.policy_gradient import GatingPolicy, PolicyGradientTrainer
    >>> from merlt.rlcf.execution_trace import ExecutionTrace
    >>> from merlt.rlcf.multilevel_feedback import MultilevelFeedback
    >>>
    >>> # Setup policy
    >>> policy = GatingPolicy(input_dim=1024, hidden_dim=256)
    >>>
    >>> # Setup trainer
    >>> trainer = PolicyGradientTrainer(policy, learning_rate=1e-4)
    >>>
    >>> # Training loop
    >>> for trace, feedback in zip(traces, feedbacks):
    ...     reward = feedback.overall_score()
    ...     trace.set_reward(reward)
    ...     loss = trainer.update_from_trace(trace)
    ...
    >>> # Save checkpoint
    >>> trainer.save_checkpoint("checkpoints/gating_policy_epoch10.pt")

Note:
    - Usa lazy import di torch (pattern codebase)
    - Production-ready con type hints e logging
    - Supporta save/load checkpoint
    - Baseline moving average per variance reduction
"""

import os
import warnings
import structlog
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

log = structlog.get_logger()

# Lazy imports
_torch = None
_nn = None
_optim = None
_F = None


def _get_torch():
    """Lazy import di torch."""
    global _torch, _nn, _optim, _F
    if _torch is None:
        import torch
        import torch.nn as nn
        import torch.optim as optim
        import torch.nn.functional as F
        _torch = torch
        _nn = nn
        _optim = optim
        _F = F
    return _torch, _nn, _optim, _F


# =============================================================================
# Slice 4 P2b (L2) — teach-the-weights helpers
# =============================================================================
#
# Two integration signals feed the EXISTING gating head (no new architecture):
#
# 1. **Per-expert reward shaping** — the jurist's ``preferredExpert`` (a canon in
#    ``literal|systemic|principles|precedent``) becomes an ADDITIVE shaping term
#    ``+GATING_SHAPING_BETA`` on the preferred canon's advantage, mirroring the
#    tool head's productivity shaping (``ToolPolicyTrainer.SHAPING_BETA``). Under
#    REINFORCE the per-action loss is ``-logπ(a)·advantage``; a *larger positive*
#    advantage on the preferred canon's log-prob ⇒ its gradient pushes that
#    logit UP ⇒ softmax P(preferred) rises next time. This is the exact sign
#    proven in ``tests/unit/test_gating_preference_authority.py``.
#
# 2. **Authority weighting** — ``advantage = authority · (returns + shaping)``.
#    The senior jurist (higher authority) moves the weights more than the novice
#    (dynamic-authority pillar). Authority is a server-side scalar carried in
#    ``feedback.metadata['authority']``; it defaults to ``1.0`` when absent so
#    the pre-L2 behaviour (authority-agnostic) is exactly recovered, and it is
#    applied here and ONLY here on the live heads (grep authority = 0 elsewhere),
#    so there is no double-counting. NOTE: server authority ∈ [0,1] (authority.py
#    convex combination), so a *present* authority SHRINKS the step — real
#    feedback trains slightly slower than pre-L2 by design (stabilising), it is
#    not a no-op.
#
# LOAD-BEARING INVARIANT for the shaping sign: the preference reward is a fixed
# positive endorsement (0.7) and the baseline is an EMA of rewards ∈ [0,1], so
# ``returns + β = reward − baseline + β ≥ 0`` ALWAYS on the preference channel —
# the preferred canon's advantage can never go negative (which would train the
# OPPOSITE). If the preference reward magnitude or the baseline range ever
# changes, re-verify this stays ≥ 0.

# Mirrors ToolPolicyTrainer.SHAPING_BETA (policy_gradient.py) — same magnitude so
# the two heads shape at a comparable scale.
GATING_SHAPING_BETA = 0.3

# Canonical expert ordering = the gating softmax index order
# (merlt.experts.neural_gating.neural.EXPERT_NAMES). Kept as a module constant so
# the trainer never has to import the neural package (lazy-torch discipline).
GATING_EXPERT_NAMES = ["literal", "systemic", "principles", "precedent"]


def _extract_authority(feedback: Any, default: float = 1.0) -> float:
    """Read the server-computed authority scalar from ``feedback.metadata``.

    Returns ``default`` (1.0 — authority-neutral) when the feedback carries no
    authority, when it is ``None``, or when it is non-numeric/non-finite, so a
    missing signal can never crash training or flip the gradient sign. The value
    is clamped to ``>= 0`` (a negative authority would invert REINFORCE, which is
    never intended).
    """
    meta = getattr(feedback, "metadata", None) or {}
    raw = meta.get("authority")
    if raw is None:
        return default
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return default
    # Reject NaN / inf and negative authority.
    if val != val or val in (float("inf"), float("-inf")) or val < 0.0:
        return default
    return val


def _preferred_expert_index(feedback: Any) -> Optional[int]:
    """Map ``feedback.metadata['preferred_expert']`` to its gating softmax index.

    Returns ``None`` when there is no preference or the canon name is unknown, so
    callers add NO shaping term (pure baseline advantage) in that case.
    """
    meta = getattr(feedback, "metadata", None) or {}
    pref = meta.get("preferred_expert")
    if not pref:
        return None
    try:
        return GATING_EXPERT_NAMES.index(str(pref))
    except ValueError:
        log.warning("Unknown preferred_expert, ignoring shaping", preferred_expert=pref)
        return None


# =============================================================================
# POLICY NETWORKS
# =============================================================================

class GatingPolicy:
    """
    Policy per gating degli expert.

    Mappa query embedding → expert weights (softmax 4-dim).

    Architettura:
        input (1024) → hidden (256) → ReLU → hidden (128) → ReLU → output (4) → Softmax

    Output: [w_literal, w_systemic, w_principles, w_precedent]

    Attributes:
        input_dim: Dimensione input (1024 per E5-large embeddings)
        hidden_dim: Dimensione hidden layer
        num_experts: Numero di expert (default 4)
        device: Device per training
    """

    def __init__(
        self,
        input_dim: int = 1024,
        hidden_dim: int = 256,
        num_experts: int = 4,
        device: Optional[str] = None
    ):
        """
        Inizializza GatingPolicy.

        Args:
            input_dim: Dimensione input embedding (1024 for E5-large)
            hidden_dim: Dimensione hidden layer
            num_experts: Numero di expert
            device: Device (cuda/mps/cpu)
        """
        warnings.warn(
            "GatingPolicy is deprecated and will be removed in a future version. "
            "Use ExpertGatingMLP from merlt.rlcf.expert_gating_mlp instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        torch, nn, _, _ = _get_torch()

        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.num_experts = num_experts

        # Device
        if device:
            self.device = device
        elif torch.cuda.is_available():
            self.device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            self.device = "mps"
        else:
            self.device = "cpu"

        # Network
        self.mlp = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim // 2, num_experts)
        ).to(self.device)

        log.info(
            "GatingPolicy initialized",
            input_dim=input_dim,
            hidden_dim=hidden_dim,
            num_experts=num_experts,
            device=self.device
        )

    def forward(
        self,
        query_embedding: Any,  # torch.Tensor [batch, input_dim]
        return_logits: bool = False
    ) -> Tuple[Any, Any]:
        """
        Forward pass.

        Args:
            query_embedding: Embedding della query [batch, input_dim]
            return_logits: Se True, ritorna anche i logits pre-softmax

        Returns:
            Tuple (weights, log_probs) o (weights, log_probs, logits) se return_logits
            - weights: [batch, num_experts] probabilità normalizzate
            - log_probs: [batch, num_experts] log probabilità
            - logits: [batch, num_experts] logits pre-softmax (opzionale)
        """
        torch, _, _, F = _get_torch()

        # Forward
        logits = self.mlp(query_embedding)  # [batch, num_experts]

        # Softmax per ottenere probabilità
        weights = F.softmax(logits, dim=-1)

        # Log probabilities per REINFORCE
        log_probs = F.log_softmax(logits, dim=-1)

        if return_logits:
            return weights, log_probs, logits
        return weights, log_probs

    def parameters(self):
        """Restituisce parametri trainable."""
        return self.mlp.parameters()

    def to(self, device):
        """Muove policy su device."""
        self.device = device
        self.mlp = self.mlp.to(device)
        return self

    def train(self):
        """Imposta training mode."""
        self.mlp.train()
        return self

    def eval(self):
        """Imposta eval mode."""
        self.mlp.eval()
        return self

    def state_dict(self) -> Dict[str, Any]:
        """Restituisce state dict per checkpoint."""
        return self.mlp.state_dict()

    def load_state_dict(self, state_dict: Dict[str, Any]):
        """Carica state dict da checkpoint."""
        self.mlp.load_state_dict(state_dict)


class TraversalPolicy:
    """
    Policy per traversal del grafo.

    Mappa (query_embedding, relation_type_embedding) → relation_weight.

    Architettura:
        concat(query_emb, relation_emb) → hidden → ReLU → hidden → sigmoid

    Output: weight [0-1] per la relazione

    Attributes:
        input_dim: Dimensione input query embedding
        relation_dim: Dimensione relation type embedding
        hidden_dim: Dimensione hidden layer
        device: Device per training
    """

    def __init__(
        self,
        input_dim: int = 1024,
        relation_dim: int = 64,
        hidden_dim: int = 128,
        device: Optional[str] = None
    ):
        """
        Inizializza TraversalPolicy.

        Args:
            input_dim: Dimensione query embedding (1024 for E5-large)
            relation_dim: Dimensione relation type embedding
            hidden_dim: Dimensione hidden layer
            device: Device
        """
        torch, nn, _, _ = _get_torch()

        self.input_dim = input_dim
        self.relation_dim = relation_dim
        self.hidden_dim = hidden_dim

        # Device
        if device:
            self.device = device
        elif torch.cuda.is_available():
            self.device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            self.device = "mps"
        else:
            self.device = "cpu"

        # Network
        total_input = input_dim + relation_dim
        self.mlp = nn.Sequential(
            nn.Linear(total_input, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(hidden_dim // 2, 1),
            nn.Sigmoid()  # Output [0-1]
        ).to(self.device)

        # Relation type embeddings (learnable)
        # Comuni relation types nel grafo MERL-T
        self.relation_types = [
            "RIFERIMENTO", "CITATO_DA", "MODIFICA", "MODIFICATO_DA",
            "DEROGA", "DEROGATO_DA", "ABROGATO_DA", "ABROGA",
            "INTERPRETED_BY", "RELATED_TO", "APPLIES_TO"
        ]
        self.num_relations = len(self.relation_types)

        self.relation_embeddings = nn.Embedding(
            self.num_relations,
            relation_dim
        ).to(self.device)

        log.info(
            "TraversalPolicy initialized",
            input_dim=input_dim,
            relation_dim=relation_dim,
            hidden_dim=hidden_dim,
            num_relations=self.num_relations,
            device=self.device
        )

    def forward(
        self,
        query_embedding: Any,  # torch.Tensor [batch, input_dim]
        relation_indices: Any  # torch.Tensor [batch] indices delle relazioni
    ) -> Tuple[Any, Any]:
        """
        Forward pass.

        Args:
            query_embedding: Embedding della query [batch, input_dim]
            relation_indices: Indici relation types [batch]

        Returns:
            Tuple (weights, log_probs)
            - weights: [batch, 1] pesi relazioni
            - log_probs: [batch, 1] log probabilities
        """
        torch, _, _, _ = _get_torch()

        # Ottieni relation embeddings
        relation_emb = self.relation_embeddings(relation_indices)  # [batch, relation_dim]

        # Concatena
        combined = torch.cat([query_embedding, relation_emb], dim=-1)  # [batch, input_dim + relation_dim]

        # Forward
        weights = self.mlp(combined)  # [batch, 1]

        # Log probs (per policy gradient)
        # Usiamo log di sigmoid output
        log_probs = torch.log(weights + 1e-8)  # Evita log(0)

        return weights, log_probs

    def get_relation_index(self, relation_type: str) -> int:
        """
        Ottiene indice per relation_type.

        Args:
            relation_type: Nome relation type

        Returns:
            Indice [0, num_relations-1]
        """
        try:
            return self.relation_types.index(relation_type)
        except ValueError:
            # Default a RELATED_TO se sconosciuto
            log.warning(f"Unknown relation type: {relation_type}, using RELATED_TO")
            return self.relation_types.index("RELATED_TO")

    def parameters(self):
        """Restituisce parametri trainable."""
        import itertools
        return itertools.chain(self.mlp.parameters(), self.relation_embeddings.parameters())

    def to(self, device):
        """Muove policy su device."""
        self.device = device
        self.mlp = self.mlp.to(device)
        self.relation_embeddings = self.relation_embeddings.to(device)
        return self

    def train(self):
        """Imposta training mode."""
        self.mlp.train()
        self.relation_embeddings.train()
        return self

    def eval(self):
        """Imposta eval mode."""
        self.mlp.eval()
        self.relation_embeddings.eval()
        return self

    def state_dict(self) -> Dict[str, Any]:
        """Restituisce state dict per checkpoint."""
        return {
            "mlp": self.mlp.state_dict(),
            "relation_embeddings": self.relation_embeddings.state_dict()
        }

    def load_state_dict(self, state_dict: Dict[str, Any]):
        """Carica state dict da checkpoint."""
        self.mlp.load_state_dict(state_dict["mlp"])
        self.relation_embeddings.load_state_dict(state_dict["relation_embeddings"])


# =============================================================================
# TRAINER
# =============================================================================

@dataclass
class TrainerConfig:
    """
    Configurazione per PolicyGradientTrainer.

    Attributes:
        learning_rate: Learning rate per optimizer
        gamma: Discount factor [0-1]
        baseline_decay: Decay per baseline moving average [0-1]
        clip_grad_norm: Max gradient norm (gradient clipping)
        entropy_coef: Coefficiente entropy bonus (exploration)
        max_grad_norm: Max gradient norm
    """
    learning_rate: float = 1e-4
    gamma: float = 1.0
    baseline_decay: float = 0.99
    clip_grad_norm: float = 0.5
    entropy_coef: float = 0.01
    max_grad_norm: float = 0.5


class PolicyGradientTrainer:
    """
    Trainer REINFORCE per policy gradient.

    Implementa vanilla REINFORCE con baseline (moving average) per
    variance reduction.

    Algoritmo:
        1. Raccogli trace con log_probs delle azioni
        2. Ottieni reward da feedback
        3. Calcola returns = reward - baseline
        4. Calcola loss = -∑ log_prob * returns
        5. Backprop e update policy
        6. Aggiorna baseline

    Attributes:
        policy: Policy network (GatingPolicy o TraversalPolicy)
        optimizer: Optimizer per policy parameters
        config: TrainerConfig
        baseline: Moving average baseline
        num_updates: Numero di updates effettuati
    """

    def __init__(
        self,
        policy: Any,  # GatingPolicy o TraversalPolicy
        config: Optional[TrainerConfig] = None,
        optimizer: Optional[Any] = None
    ):
        """
        Inizializza PolicyGradientTrainer.

        Args:
            policy: Policy network da trainare
            config: Configurazione trainer
            optimizer: Optimizer custom (opzionale)
        """
        torch, _, optim, _ = _get_torch()

        self.policy = policy
        self.config = config or TrainerConfig()

        # Optimizer
        if optimizer:
            self.optimizer = optimizer
        else:
            self.optimizer = optim.Adam(
                policy.parameters(),
                lr=self.config.learning_rate
            )

        # Baseline (moving average)
        self.baseline = 0.0
        self.num_updates = 0

        log.info(
            "PolicyGradientTrainer initialized",
            learning_rate=self.config.learning_rate,
            gamma=self.config.gamma,
            baseline_decay=self.config.baseline_decay
        )

    def compute_reward(
        self,
        feedback: Any  # MultilevelFeedback
    ) -> float:
        """
        Calcola reward da MultilevelFeedback.

        Args:
            feedback: MultilevelFeedback object

        Returns:
            Reward normalizzato [0-1]
        """
        # Usa overall_score come reward
        reward = feedback.overall_score()
        return reward

    def update_from_feedback(
        self,
        trace: Any,  # ExecutionTrace
        feedback: Any  # MultilevelFeedback
    ) -> Dict[str, float]:
        """
        Aggiorna policy da un singolo trace con feedback.

        Implementazione REINFORCE corretta (Williams, 1992):
        ∇J(θ) = E[∑ᵗ ∇log π(aₜ|sₜ) * (R - b)]

        Il metodo:
        1. Estrae query_embedding dalle azioni
        2. Ri-esegue forward pass con gradient enabled
        3. Calcola loss = -log_prob * returns
        4. Backpropagation reale via loss.backward()
        5. optimizer.step() per aggiornare i parametri

        Args:
            trace: ExecutionTrace con azioni e log_probs
            feedback: MultilevelFeedback con reward

        Returns:
            Dict con metriche di training (loss, reward, baseline)
        """
        torch, nn, F, _ = _get_torch()

        # Calcola reward
        reward = self.compute_reward(feedback)
        trace.set_reward(reward)

        # Calcola returns con baseline
        returns = reward - self.baseline

        # Aggiorna baseline (moving average)
        self.baseline = (
            self.config.baseline_decay * self.baseline +
            (1 - self.config.baseline_decay) * reward
        )

        # Slice 4 P2b (L2) — authority weighting + per-expert preference shaping.
        # ``authority`` scales the whole advantage (senior jurist moves the
        # weights more; defaults to 1.0 = pre-L2 behaviour). ``preferred_idx`` is
        # the gating softmax index the jurist asked to weigh more (None = no
        # preference → no shaping term). Both are read from feedback.metadata,
        # which round-trips through the replay buffer.
        authority = _extract_authority(feedback)
        preferred_idx = _preferred_expert_index(feedback)

        # =====================================================================
        # REINFORCE con backpropagation REALE
        # =====================================================================

        # Filtra solo azioni di expert_selection (quelle prodotte dalla GatingPolicy)
        expert_actions = [
            a for a in trace.actions
            if a.action_type == "expert_selection"
            and a.metadata.get("source") in ("neural_gating", "gating_policy")
        ]

        if not expert_actions:
            log.warning(
                "No expert_selection actions found in trace",
                query_id=trace.query_id
            )
            return {
                "loss": 0.0,
                "reward": reward,
                "baseline": self.baseline,
                "returns": returns,
                "num_actions": 0,
                "num_updates": self.num_updates
            }

        # Estrai query_embedding dalla prima azione (è lo stesso per tutte)
        query_embedding_list = expert_actions[0].metadata.get("query_embedding")

        if query_embedding_list is None:
            log.warning(
                "No query_embedding in action metadata, falling back to stored log_probs",
                query_id=trace.query_id
            )
            # Fallback: usa log_probs pre-calcolati (meno accurato ma funziona)
            log_probs = torch.tensor(
                [action.log_prob for action in expert_actions],
                dtype=torch.float32,
                device=self.policy.device
            )
            # Crea un proxy tensor per ottenere gradients
            proxy = torch.zeros_like(log_probs, requires_grad=True)
            # Authority-weight the return. Per-expert preference shaping is NOT
            # possible here: without a live forward pass there is no per-canon
            # log-prob to attach the shaping to. Authority still applies.
            policy_loss = -(proxy * (authority * returns)).sum()
        else:
            # CASO CORRETTO: ri-calcola log_probs con forward pass
            query_embedding = torch.tensor(
                query_embedding_list,
                dtype=torch.float32,
                device=self.policy.device
            ).unsqueeze(0)  # Shape: [1, embedding_dim]

            # Zero gradients prima del forward pass
            self.optimizer.zero_grad()

            # Forward pass CON gradient enabled
            self.policy.train()
            weights, all_log_probs = self.policy.forward(query_embedding)

            # Per soft combination (MERL-T usa tutti gli expert pesati),
            # usiamo weighted log prob: sum(log_prob_i * weight_i)
            # Questo rinforza gli expert proporzionalmente al loro contributo
            #
            # Alternativa: sample categoriale (un solo expert)
            # action_dist = torch.distributions.Categorical(weights)
            # selected_log_prob = all_log_probs[0, action_idx]
            #
            # Usiamo weighted sum per rispettare la natura soft del gating
            expert_weights = torch.tensor(
                [a.parameters.get("weight", 0.25) for a in expert_actions],
                dtype=torch.float32,
                device=self.policy.device
            )
            # Normalizza weights (dovrebbero già sommare a 1)
            expert_weights = expert_weights / expert_weights.sum()

            # Weighted log probability
            weighted_log_prob = (all_log_probs.squeeze(0) * expert_weights).sum()

            # -----------------------------------------------------------------
            # Slice 4 P2b (L2): advantage = authority · (returns + shaping)
            # -----------------------------------------------------------------
            # Baseline (no preference, authority=1.0) reduces EXACTLY to the
            # legacy ``-weighted_log_prob * returns`` — regression-safe.
            #
            # With a preference, we ADD a per-expert shaping term applied to the
            # preferred canon's own log-prob (indexed by EXPERT_NAMES order, the
            # gating softmax index). Under REINFORCE (loss = -logπ(a)·advantage),
            # a strictly larger positive advantage on the preferred canon's
            # log-prob drives its logit UP ⇒ P(preferred) rises next forward.
            # The soft-combination term keeps the answer-quality (returns)
            # signal on every consulted expert.
            base_loss = -weighted_log_prob * (authority * returns)

            if preferred_idx is not None:
                # advantage_pref = authority · (returns + β); the "+β" is what
                # makes the preferred canon's advantage STRICTLY greater than a
                # non-preferred canon's (which sees only authority·returns).
                pref_log_prob = all_log_probs.squeeze(0)[preferred_idx]
                pref_shaping = authority * (returns + GATING_SHAPING_BETA)
                policy_loss = base_loss + (-pref_log_prob * pref_shaping)
            else:
                policy_loss = base_loss

        # Backpropagation REALE
        policy_loss.backward()

        # Gradient clipping (opzionale ma raccomandato per stabilità)
        if hasattr(self.config, 'clip_grad_norm') and self.config.clip_grad_norm:
            torch.nn.utils.clip_grad_norm_(
                self.policy.parameters(),
                self.config.clip_grad_norm
            )

        # Optimizer step - applica i gradienti calcolati
        self.optimizer.step()

        self.num_updates += 1

        metrics = {
            "loss": policy_loss.item(),
            "reward": reward,
            "baseline": self.baseline,
            "returns": returns,
            "num_actions": len(expert_actions),
            "num_updates": self.num_updates,
            "grad_norm": self._compute_grad_norm()
        }

        log.info(
            "Policy updated with real backpropagation",
            query_id=trace.query_id,
            **metrics
        )

        return metrics

    def _compute_grad_norm(self) -> float:
        """Calcola norma totale dei gradienti per monitoring."""
        torch, _, _, _ = _get_torch()
        total_norm = 0.0
        for param in self.policy.parameters():
            if param.grad is not None:
                total_norm += param.grad.data.norm(2).item() ** 2
        return total_norm ** 0.5

    def update_from_batch(
        self,
        traces: List[Any],  # List[ExecutionTrace]
        feedbacks: List[Any]  # List[MultilevelFeedback]
    ) -> Dict[str, float]:
        """
        Aggiorna policy da batch di traces con backpropagation REALE.

        Implementa REINFORCE con mini-batch:
        1. Accumula gradienti per tutti i trace
        2. Applica un singolo optimizer step

        Args:
            traces: Lista di ExecutionTrace
            feedbacks: Lista di MultilevelFeedback

        Returns:
            Dict con metriche aggregate
        """
        torch, nn, F, _ = _get_torch()

        if len(traces) != len(feedbacks):
            raise ValueError("Number of traces must match number of feedbacks")

        # Calcola rewards
        rewards = [self.compute_reward(fb) for fb in feedbacks]

        # Set rewards nei trace
        for trace, reward in zip(traces, rewards):
            trace.set_reward(reward)

        # Calcola baseline (media dei reward nel batch)
        avg_reward = sum(rewards) / len(rewards)

        # Update baseline (moving average)
        self.baseline = (
            self.config.baseline_decay * self.baseline +
            (1 - self.config.baseline_decay) * avg_reward
        )

        # =====================================================================
        # REINFORCE BATCH con backpropagation REALE
        # =====================================================================

        # Zero gradients prima di accumulare
        self.optimizer.zero_grad()
        self.policy.train()

        total_loss = 0.0
        total_actions = 0
        accumulated_losses = []

        for trace, feedback, reward in zip(traces, feedbacks, rewards):
            returns = reward - self.baseline

            # Slice 4 P2b (L2): per-experience authority + preference shaping
            # (same semantics as update_from_feedback; see helper docstrings).
            authority = _extract_authority(feedback)
            preferred_idx = _preferred_expert_index(feedback)

            # Filtra solo azioni di expert_selection
            expert_actions = [
                a for a in trace.actions
                if a.action_type == "expert_selection"
                and a.metadata.get("source") in ("neural_gating", "gating_policy")
            ]

            if not expert_actions:
                continue

            # Estrai query_embedding
            query_embedding_list = expert_actions[0].metadata.get("query_embedding")

            if query_embedding_list is None:
                log.warning(
                    "No query_embedding in action metadata, skipping trace",
                    query_id=trace.query_id
                )
                continue

            # Ri-calcola log_probs con forward pass
            query_embedding = torch.tensor(
                query_embedding_list,
                dtype=torch.float32,
                device=self.policy.device
            ).unsqueeze(0)

            # Forward pass CON gradient enabled
            weights, all_log_probs = self.policy.forward(query_embedding)

            # Weighted log probability per soft combination
            expert_weights = torch.tensor(
                [a.parameters.get("weight", 0.25) for a in expert_actions],
                dtype=torch.float32,
                device=self.policy.device
            )
            expert_weights = expert_weights / expert_weights.sum()

            weighted_log_prob = (all_log_probs.squeeze(0) * expert_weights).sum()

            # REINFORCE loss with L2 authority weighting + preference shaping
            # (regression-safe: authority=1.0 & no preference ⇒ legacy loss).
            base_loss = -weighted_log_prob * (authority * returns)
            if preferred_idx is not None:
                pref_log_prob = all_log_probs.squeeze(0)[preferred_idx]
                pref_shaping = authority * (returns + GATING_SHAPING_BETA)
                policy_loss = base_loss + (-pref_log_prob * pref_shaping)
            else:
                policy_loss = base_loss
            accumulated_losses.append(policy_loss)

            total_loss += policy_loss.item()
            total_actions += len(expert_actions)

        # Somma tutti i loss e fai backprop una volta sola
        if accumulated_losses:
            batch_loss = torch.stack(accumulated_losses).sum()
            batch_loss.backward()

            # Gradient clipping
            if hasattr(self.config, 'clip_grad_norm') and self.config.clip_grad_norm:
                torch.nn.utils.clip_grad_norm_(
                    self.policy.parameters(),
                    self.config.clip_grad_norm
                )

            # Optimizer step
            self.optimizer.step()

        self.num_updates += 1

        metrics = {
            "loss": total_loss / max(len(traces), 1),
            "avg_reward": avg_reward,
            "baseline": self.baseline,
            "batch_size": len(traces),
            "effective_batch_size": len(accumulated_losses),
            "total_actions": total_actions,
            "num_updates": self.num_updates,
            "grad_norm": self._compute_grad_norm()
        }

        log.info("Policy updated from batch with real backpropagation", **metrics)

        return metrics

    def save_checkpoint(
        self,
        path: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Salva checkpoint della policy.

        Args:
            path: Path del checkpoint
            metadata: Metadati aggiuntivi da salvare
        """
        torch, _, _, _ = _get_torch()

        # Crea directory se non esiste
        Path(path).parent.mkdir(parents=True, exist_ok=True)

        # State dict — uses model_state_dict for ExpertGatingMLP (nn.Module),
        # falls back to policy.mlp for legacy GatingPolicy
        if hasattr(self.policy, 'state_dict') and callable(getattr(self.policy, 'state_dict')) and isinstance(self.policy, torch.nn.Module):
            model_sd = {k: v.cpu() for k, v in self.policy.state_dict().items()}
        else:
            model_sd = {k: v.cpu() for k, v in self.policy.mlp.state_dict().items()}

        checkpoint = {
            "model_state_dict": model_sd,
            "optimizer_state_dict": self.optimizer.state_dict(),
            "baseline": self.baseline,
            "num_updates": self.num_updates,
            "config": {
                "learning_rate": self.config.learning_rate,
                "gamma": self.config.gamma,
                "baseline_decay": self.config.baseline_decay,
                "clip_grad_norm": self.config.clip_grad_norm,
                "entropy_coef": self.config.entropy_coef
            },
            "policy_config": {
                "input_dim": getattr(self.policy, 'input_dim', getattr(getattr(self.policy, 'config', None), 'input_dim', 1024)),
                "hidden_dim": getattr(self.policy, 'hidden_dim', None),
                "num_experts": getattr(self.policy, 'num_experts', getattr(getattr(self.policy, 'config', None), 'num_experts', None)),
                "relation_dim": getattr(self.policy, 'relation_dim', None),
            },
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {}
        }

        torch.save(checkpoint, path)

        log.info(
            "Checkpoint saved",
            path=path,
            num_updates=self.num_updates,
            baseline=self.baseline
        )

    def load_checkpoint(
        self,
        path: str
    ) -> Dict[str, Any]:
        """
        Carica checkpoint della policy.

        Args:
            path: Path del checkpoint

        Returns:
            Metadata del checkpoint
        """
        torch, _, _, _ = _get_torch()

        # weights_only=False: checkpoint contains optimizer state (non-tensor)
        device = getattr(self.policy, 'device', 'cpu')
        checkpoint = torch.load(path, map_location=device, weights_only=False)

        # Load policy state with fallback chain:
        # model_state_dict (new) → policy_state_dict (legacy)
        if "model_state_dict" in checkpoint:
            policy_state = checkpoint["model_state_dict"]
        elif "policy_state_dict" in checkpoint:
            log.warning(
                "Loading legacy policy_state_dict format. "
                "This may fail if policy architecture changed (e.g. GatingPolicy → ExpertGatingMLP).",
                path=path,
            )
            policy_state = checkpoint["policy_state_dict"]
        else:
            raise KeyError("Checkpoint missing both model_state_dict and policy_state_dict")

        state_to_load = {k: v.to(device) for k, v in policy_state.items()}

        self.policy.load_state_dict(state_to_load)

        # Carica optimizer state
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])

        # Carica baseline e num_updates
        self.baseline = checkpoint.get("baseline", 0.0)
        self.num_updates = checkpoint.get("num_updates", 0)

        log.info(
            "Checkpoint loaded",
            path=path,
            num_updates=self.num_updates,
            baseline=self.baseline
        )

        return checkpoint.get("metadata", {})

    def get_stats(self) -> Dict[str, Any]:
        """
        Restituisce statistiche del training.

        Returns:
            Dict con statistiche correnti
        """
        return {
            "num_updates": self.num_updates,
            "baseline": self.baseline,
            "learning_rate": self.config.learning_rate,
            "gamma": self.config.gamma
        }


# =============================================================================
# UTILITIES
# =============================================================================

def create_traversal_policy(
    input_dim: int = 1024,
    relation_dim: int = 64,
    hidden_dim: int = 128,
    checkpoint_path: Optional[str] = None
) -> Tuple[TraversalPolicy, PolicyGradientTrainer]:
    """
    Factory function per creare TraversalPolicy e trainer.

    Args:
        input_dim: Dimensione query embedding
        relation_dim: Dimensione relation embedding
        hidden_dim: Dimensione hidden layer
        checkpoint_path: Path checkpoint da caricare (opzionale)

    Returns:
        Tuple (policy, trainer)
    """
    policy = TraversalPolicy(
        input_dim=input_dim,
        relation_dim=relation_dim,
        hidden_dim=hidden_dim
    )
    trainer = PolicyGradientTrainer(policy)

    if checkpoint_path and os.path.exists(checkpoint_path):
        trainer.load_checkpoint(checkpoint_path)
        log.info(f"Loaded traversal policy from {checkpoint_path}")

    return policy, trainer


# =============================================================================
# Loop β E.3 — Tool-Gating Policy Trainer (multi-label REINFORCE)
# =============================================================================

class ToolPolicyTrainer:
    """REINFORCE trainer for the multi-label ``ToolGatingMLP``.

    Mirrors ``PolicyGradientTrainer`` but consumes ``tool_use`` actions
    (independent Bernoulli call decisions) instead of ``expert_selection``. For
    each action the per-tool log-prob of the action ACTUALLY taken is recomputed
    from a live forward pass (so gradients flow): ``log σ(logit)`` if the tool was
    called, ``log(1-σ(logit))`` if it was pruned.

    The advantage combines the global return ``(reward - baseline)`` with a
    **productivity shaping** term (signal a): a called tool that returned a
    source gets ``+β``, a called-but-unproductive tool ``-β`` — so the policy
    learns to call productive tools and stop calling barren ones, on top of the
    answer-quality signal. A pruned tool in a *bad* answer gets a negative
    advantage on ``log(1-p)`` → P(call)↑, i.e. it learns it should have been
    called (reinforced strongly by the control arm, where everything fires).
    """

    SHAPING_BETA = 0.3

    def __init__(self, policy, config: Optional["TrainerConfig"] = None, optimizer: Optional[Any] = None):
        torch, _, optim, _ = _get_torch()
        self.policy = policy
        self.config = config or TrainerConfig()
        self.optimizer = optimizer or optim.Adam(policy.parameters(), lr=self.config.learning_rate)
        self.baseline = 0.0
        self.num_updates = 0
        from merlt.experts.neural_gating.tool_neural import TOOL_VOCAB
        self._tool_index = {t: i for i, t in enumerate(TOOL_VOCAB)}
        log.info("ToolPolicyTrainer initialized", learning_rate=self.config.learning_rate)

    def compute_reward(self, feedback: Any) -> float:
        return feedback.overall_score()

    def _empty_metrics(self, reward: float, returns: float) -> Dict[str, float]:
        return {
            "loss": 0.0, "reward": reward, "baseline": self.baseline,
            "returns": returns, "num_actions": 0, "num_updates": self.num_updates,
            "grad_norm": 0.0,
        }

    def update_from_feedback(self, trace: Any, feedback: Any) -> Dict[str, float]:
        torch, _, _, _ = _get_torch()

        # Flush any stale gradients up-front so an early-return (no actions / no
        # embedding) can never leave gradients lingering before the next step.
        self.optimizer.zero_grad()

        reward = self.compute_reward(feedback)
        trace.set_reward(reward)
        returns = reward - self.baseline
        self.baseline = (
            self.config.baseline_decay * self.baseline
            + (1 - self.config.baseline_decay) * reward
        )

        tool_actions = [
            a for a in trace.actions
            if a.action_type == "tool_use" and a.metadata.get("source") == "tool_policy"
        ]
        if not tool_actions:
            return self._empty_metrics(reward, returns)

        emb_list = trace.metadata.get("query_embedding")
        if emb_list is None:
            for a in trace.actions:
                emb = a.metadata.get("query_embedding")
                if emb:
                    emb_list = emb
                    break
        if emb_list is None:
            return self._empty_metrics(reward, returns)

        query_embedding = torch.tensor(
            emb_list, dtype=torch.float32, device=self.policy.device
        ).unsqueeze(0)

        self.policy.train()
        probs, _ = self.policy.forward(query_embedding)  # (1, num_tools)
        probs = probs.squeeze(0)

        # Slice 4 P2b (L2): authority-weight the tool advantage too, so the
        # dynamic-authority pillar applies consistently across the live heads.
        # Defaults to 1.0 when feedback carries no authority ⇒ legacy behaviour.
        authority = _extract_authority(feedback)

        terms = []
        for a in tool_actions:
            idx = self._tool_index.get(a.parameters.get("tool_name"))
            if idx is None:
                continue
            called = bool(a.metadata.get("called"))
            produced = bool(a.metadata.get("produced_source"))
            p = probs[idx].clamp(1e-8, 1.0 - 1e-8)
            log_p = torch.log(p) if called else torch.log(1.0 - p)
            shaping = (self.SHAPING_BETA if produced else -self.SHAPING_BETA) if called else 0.0
            advantage = authority * (returns + shaping)
            terms.append(-advantage * log_p)

        if not terms:
            return self._empty_metrics(reward, returns)

        loss = torch.stack(terms).sum()
        loss.backward()
        if getattr(self.config, "clip_grad_norm", None):
            torch.nn.utils.clip_grad_norm_(self.policy.parameters(), self.config.clip_grad_norm)
        self.optimizer.step()
        self.num_updates += 1

        metrics = {
            "loss": float(loss.item()),
            "reward": reward,
            "baseline": self.baseline,
            "returns": returns,
            "num_actions": len(terms),
            "num_updates": self.num_updates,
            "grad_norm": self._compute_grad_norm(),
        }
        log.info("Tool policy updated with real backpropagation",
                 query_id=getattr(trace, "query_id", None), **metrics)
        return metrics

    def _compute_grad_norm(self) -> float:
        total_norm = 0.0
        for param in self.policy.parameters():
            if param.grad is not None:
                total_norm += param.grad.data.norm(2).item() ** 2
        return total_norm ** 0.5

    def save_checkpoint(self, path: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        torch, _, _, _ = _get_torch()
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        checkpoint = {
            "model_state_dict": {k: v.cpu() for k, v in self.policy.state_dict().items()},
            "optimizer_state_dict": self.optimizer.state_dict(),
            "baseline": self.baseline,
            "num_updates": self.num_updates,
            "policy_config": {
                "input_dim": getattr(getattr(self.policy, "config", None), "input_dim", 1024),
            },
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {},
        }
        torch.save(checkpoint, path)
        log.info("Tool checkpoint saved", path=path, num_updates=self.num_updates)

    def load_checkpoint(self, path: str) -> Dict[str, Any]:
        torch, _, _, _ = _get_torch()
        device = getattr(self.policy, "device", "cpu")
        checkpoint = torch.load(path, map_location=device, weights_only=False)
        self.policy.load_state_dict(checkpoint["model_state_dict"])
        try:
            self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        except Exception as e:  # noqa: BLE001
            log.warning("Tool optimizer state not restored", error=str(e))
        self.baseline = checkpoint.get("baseline", 0.0)
        self.num_updates = checkpoint.get("num_updates", 0)
        return checkpoint.get("metadata", {})
