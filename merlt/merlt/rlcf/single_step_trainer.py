"""
Single-Step REINFORCE Trainer
=============================

Trainer ottimizzato per episodi single-step (routing/gating).

Questo trainer è progettato per scenari dove ogni episodio consiste in:
    Query → Decisione → Reward → DONE

NON usare per:
- Multi-step reasoning (usa ReActPPOTrainer)
- Trajectory con più azioni sequenziali

Vantaggi rispetto a PPO per single-step:
- Più semplice (~150 righe vs 900)
- Teoricamente corretto (PPO overkill per single-step)
- Meno iperparametri da tuning
- Baseline EMA invece di Value Network

Formula REINFORCE:
    loss = -log π(a|s) × (R - baseline) + entropy_bonus

Esempio:
    >>> from merlt.rlcf.single_step_trainer import SingleStepTrainer, SingleStepConfig
    >>> from merlt.rlcf.policy_gradient import GatingPolicy
    >>>
    >>> policy = GatingPolicy(input_dim=1024)
    >>> config = SingleStepConfig(learning_rate=1e-4)
    >>> trainer = SingleStepTrainer(policy, config)
    >>>
    >>> # Training
    >>> metrics = trainer.update(trace, feedback)
"""

import structlog
from dataclasses import dataclass
from typing import Dict, Any, Optional, List, Tuple
from datetime import datetime
from pathlib import Path

log = structlog.get_logger()

# Lazy imports
_torch = None
_nn = None
_optim = None


def _get_torch():
    """Lazy import di torch."""
    global _torch, _nn, _optim
    if _torch is None:
        import torch
        import torch.nn as nn
        import torch.optim as optim
        _torch = torch
        _nn = nn
        _optim = optim
    return _torch, _nn, _optim


# =============================================================================
# CONFIG
# =============================================================================

@dataclass
class SingleStepConfig:
    """
    Configurazione per SingleStepTrainer.

    Attributes:
        learning_rate: Learning rate per optimizer
        baseline_decay: Decay per EMA baseline (0.99 = smooth)
        clip_grad_norm: Max gradient norm per clipping
        entropy_coef: Coefficiente entropy bonus (esplorazione)
        normalize_advantage: Se normalizzare advantage per varianza reward
        min_variance: Minima varianza per normalizzazione (evita div by 0)
    """
    learning_rate: float = 1e-4
    baseline_decay: float = 0.99
    clip_grad_norm: float = 1.0
    entropy_coef: float = 0.01
    normalize_advantage: bool = True
    min_variance: float = 0.1

    def to_dict(self) -> Dict[str, Any]:
        """Serializza config."""
        return {
            "learning_rate": self.learning_rate,
            "baseline_decay": self.baseline_decay,
            "clip_grad_norm": self.clip_grad_norm,
            "entropy_coef": self.entropy_coef,
            "normalize_advantage": self.normalize_advantage,
            "min_variance": self.min_variance,
        }


# =============================================================================
# SINGLE STEP TRAINER
# =============================================================================

class SingleStepTrainer:
    """
    REINFORCE Trainer ottimizzato per single-step episodes.

    Progettato per GatingPolicy e TraversalPolicy dove ogni episodio
    è una singola decisione:
        Query embedding → Policy → Weights → Feedback → DONE

    Componenti:
        - EMA Baseline: Media mobile esponenziale dei reward (variance reduction)
        - Gradient Clipping: Stabilità del training
        - Entropy Bonus: Incentivo all'esplorazione
        - Advantage Normalization: Normalizza per varianza reward

    Algoritmo:
        1. Ricevi (trace, feedback) con query_embedding nei metadata
        2. Ri-esegui forward pass con gradient enabled
        3. Calcola advantage = reward - baseline
        4. Calcola loss = -weighted_log_prob × advantage - entropy_coef × entropy
        5. loss.backward() + optimizer.step()
        6. Aggiorna baseline con EMA

    Attributes:
        policy: Policy network (GatingPolicy o TraversalPolicy)
        config: SingleStepConfig
        optimizer: Optimizer PyTorch
        baseline: EMA del reward
        reward_variance: Varianza dei reward per normalizzazione
        num_updates: Numero totale di update effettuati
    """

    def __init__(
        self,
        policy: Any,
        config: Optional[SingleStepConfig] = None,
        optimizer: Optional[Any] = None
    ):
        """
        Inizializza SingleStepTrainer.

        Args:
            policy: Policy network (GatingPolicy o TraversalPolicy)
            config: Configurazione trainer
            optimizer: Optimizer custom (opzionale)
        """
        torch, _, optim = _get_torch()

        self.policy = policy
        self.config = config or SingleStepConfig()

        # Optimizer
        if optimizer:
            self.optimizer = optimizer
        else:
            self.optimizer = optim.AdamW(
                policy.parameters(),
                lr=self.config.learning_rate
            )

        # Baseline (EMA)
        self.baseline = 0.5  # Inizia a metà [0,1]
        self.reward_variance = 0.1  # Iniziale

        # Stats
        self.num_updates = 0
        self._reward_history: List[float] = []

        log.info(
            "SingleStepTrainer initialized",
            learning_rate=self.config.learning_rate,
            baseline_decay=self.config.baseline_decay,
            entropy_coef=self.config.entropy_coef
        )

    def compute_reward(self, feedback: Any) -> float:
        """
        Calcola reward da feedback.

        Args:
            feedback: MultilevelFeedback o dict o float

        Returns:
            Reward normalizzato [0-1]
        """
        if hasattr(feedback, 'overall_score'):
            return feedback.overall_score()
        elif hasattr(feedback, 'to_scalar_reward'):
            return feedback.to_scalar_reward()
        elif isinstance(feedback, dict):
            return feedback.get('overall_score', feedback.get('reward', 0.5))
        return float(feedback) if feedback else 0.5

    def update(
        self,
        trace: Any,
        feedback: Any
    ) -> Dict[str, float]:
        """
        Aggiorna policy da singolo trace.

        Implementazione REINFORCE per single-step:
        1. Estrae query_embedding dal trace
        2. Forward pass con gradient enabled
        3. Calcola advantage normalizzato
        4. Calcola loss con entropy bonus
        5. Backpropagation e optimizer step
        6. Aggiorna baseline EMA

        Args:
            trace: ExecutionTrace con azioni e metadata
            feedback: MultilevelFeedback con reward

        Returns:
            Dict con metriche: loss, reward, advantage, baseline, entropy, grad_norm
        """
        torch, _, _ = _get_torch()

        # Calcola reward
        reward = self.compute_reward(feedback)

        # Aggiorna reward history per varianza
        self._reward_history.append(reward)
        if len(self._reward_history) > 100:
            self._reward_history = self._reward_history[-100:]

        # Calcola varianza reward
        if len(self._reward_history) > 1:
            mean_r = sum(self._reward_history) / len(self._reward_history)
            var_r = sum((r - mean_r) ** 2 for r in self._reward_history) / len(self._reward_history)
            self.reward_variance = max(var_r ** 0.5, self.config.min_variance)

        # Calcola advantage
        raw_advantage = reward - self.baseline
        if self.config.normalize_advantage:
            advantage = raw_advantage / self.reward_variance
        else:
            advantage = raw_advantage

        # Aggiorna baseline (EMA)
        self.baseline = (
            self.config.baseline_decay * self.baseline +
            (1 - self.config.baseline_decay) * reward
        )

        # =====================================================================
        # ESTRAI QUERY EMBEDDING DAL TRACE
        # =====================================================================

        # Filtra azioni di expert_selection (dalla GatingPolicy)
        expert_actions = [
            a for a in trace.actions
            if a.action_type == "expert_selection"
            and a.metadata.get("source") in ("neural_gating", "gating_policy")
        ]

        if not expert_actions:
            log.warning(
                "No expert_selection actions in trace",
                query_id=getattr(trace, 'query_id', 'unknown')
            )
            return {
                "loss": 0.0,
                "reward": reward,
                "advantage": advantage,
                "baseline": self.baseline,
                "entropy": 0.0,
                "grad_norm": 0.0,
                "num_updates": self.num_updates,
            }

        # Estrai query_embedding dalla prima azione
        query_embedding_list = expert_actions[0].metadata.get("query_embedding")

        if query_embedding_list is None:
            log.warning(
                "No query_embedding in action metadata",
                query_id=getattr(trace, 'query_id', 'unknown')
            )
            return {
                "loss": 0.0,
                "reward": reward,
                "advantage": advantage,
                "baseline": self.baseline,
                "entropy": 0.0,
                "grad_norm": 0.0,
                "num_updates": self.num_updates,
            }

        # =====================================================================
        # FORWARD PASS CON GRADIENT
        # =====================================================================

        # Prepara input
        query_embedding = torch.tensor(
            query_embedding_list,
            dtype=torch.float32,
            device=self.policy.device
        ).unsqueeze(0)  # [1, embedding_dim]

        # Zero gradients
        self.optimizer.zero_grad()

        # Forward pass (training mode)
        self.policy.train()
        weights, log_probs = self.policy.forward(query_embedding)

        # =====================================================================
        # CALCOLA LOSS
        # =====================================================================

        # Expert weights dall'azione (per weighted log prob)
        expert_weights = torch.tensor(
            [a.parameters.get("weight", 0.25) for a in expert_actions],
            dtype=torch.float32,
            device=self.policy.device
        )
        expert_weights = expert_weights / expert_weights.sum()

        # Weighted log probability (soft combination)
        weighted_log_prob = (log_probs.squeeze(0) * expert_weights).sum()

        # Entropy per esplorazione
        # H = -Σ p * log(p)
        entropy = -(weights.squeeze(0) * log_probs.squeeze(0)).sum()

        # REINFORCE loss: -log_prob * advantage
        policy_loss = -weighted_log_prob * advantage

        # Entropy bonus (negativo perché minimizziamo)
        entropy_loss = -self.config.entropy_coef * entropy

        # Total loss
        total_loss = policy_loss + entropy_loss

        # =====================================================================
        # BACKPROP E UPDATE
        # =====================================================================

        total_loss.backward()

        # Gradient clipping
        grad_norm = torch.nn.utils.clip_grad_norm_(
            self.policy.parameters(),
            self.config.clip_grad_norm
        ).item()

        # Optimizer step
        self.optimizer.step()

        self.num_updates += 1

        # Metriche
        metrics = {
            "loss": total_loss.item(),
            "policy_loss": policy_loss.item(),
            "entropy_loss": entropy_loss.item(),
            "reward": reward,
            "advantage": advantage,
            "raw_advantage": raw_advantage,
            "baseline": self.baseline,
            "entropy": entropy.item(),
            "grad_norm": grad_norm,
            "reward_variance": self.reward_variance,
            "num_updates": self.num_updates,
        }

        log.debug("SingleStepTrainer update", **metrics)

        return metrics

    def update_batch(
        self,
        traces: List[Any],
        feedbacks: List[Any]
    ) -> Dict[str, float]:
        """
        Aggiorna policy da batch di traces.

        Accumula gradienti e fa un singolo optimizer step.

        Args:
            traces: Lista di ExecutionTrace
            feedbacks: Lista di MultilevelFeedback

        Returns:
            Dict con metriche aggregate
        """
        torch, _, _ = _get_torch()

        if len(traces) != len(feedbacks):
            raise ValueError("Number of traces must match feedbacks")

        if len(traces) == 0:
            return {"loss": 0.0, "batch_size": 0}

        # Calcola rewards e aggiorna statistics
        rewards = [self.compute_reward(fb) for fb in feedbacks]
        avg_reward = sum(rewards) / len(rewards)

        # Aggiorna reward history
        self._reward_history.extend(rewards)
        if len(self._reward_history) > 100:
            self._reward_history = self._reward_history[-100:]

        # Calcola varianza
        if len(self._reward_history) > 1:
            mean_r = sum(self._reward_history) / len(self._reward_history)
            var_r = sum((r - mean_r) ** 2 for r in self._reward_history) / len(self._reward_history)
            self.reward_variance = max(var_r ** 0.5, self.config.min_variance)

        # Zero gradients
        self.optimizer.zero_grad()
        self.policy.train()

        # Accumula loss
        accumulated_losses = []
        total_entropy = 0.0
        valid_traces = 0

        for trace, reward in zip(traces, rewards):
            # Advantage
            raw_advantage = reward - self.baseline
            if self.config.normalize_advantage:
                advantage = raw_advantage / self.reward_variance
            else:
                advantage = raw_advantage

            # Estrai query_embedding
            expert_actions = [
                a for a in trace.actions
                if a.action_type == "expert_selection"
                and a.metadata.get("source") in ("neural_gating", "gating_policy")
            ]

            if not expert_actions:
                continue

            query_embedding_list = expert_actions[0].metadata.get("query_embedding")
            if query_embedding_list is None:
                continue

            # Forward pass
            query_embedding = torch.tensor(
                query_embedding_list,
                dtype=torch.float32,
                device=self.policy.device
            ).unsqueeze(0)

            weights, log_probs = self.policy.forward(query_embedding)

            # Expert weights
            expert_weights = torch.tensor(
                [a.parameters.get("weight", 0.25) for a in expert_actions],
                dtype=torch.float32,
                device=self.policy.device
            )
            expert_weights = expert_weights / expert_weights.sum()

            # Losses
            weighted_log_prob = (log_probs.squeeze(0) * expert_weights).sum()
            entropy = -(weights.squeeze(0) * log_probs.squeeze(0)).sum()

            policy_loss = -weighted_log_prob * advantage
            entropy_loss = -self.config.entropy_coef * entropy
            total_loss = policy_loss + entropy_loss

            accumulated_losses.append(total_loss)
            total_entropy += entropy.item()
            valid_traces += 1

        if accumulated_losses:
            # Batch loss
            batch_loss = torch.stack(accumulated_losses).mean()
            batch_loss.backward()

            # Gradient clipping
            grad_norm = torch.nn.utils.clip_grad_norm_(
                self.policy.parameters(),
                self.config.clip_grad_norm
            ).item()

            # Optimizer step
            self.optimizer.step()
        else:
            grad_norm = 0.0

        # Aggiorna baseline
        self.baseline = (
            self.config.baseline_decay * self.baseline +
            (1 - self.config.baseline_decay) * avg_reward
        )

        self.num_updates += 1

        return {
            "loss": batch_loss.item() if accumulated_losses else 0.0,
            "avg_reward": avg_reward,
            "avg_entropy": total_entropy / max(valid_traces, 1),
            "baseline": self.baseline,
            "grad_norm": grad_norm,
            "batch_size": len(traces),
            "valid_traces": valid_traces,
            "num_updates": self.num_updates,
        }

    def save_checkpoint(
        self,
        path: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Salva checkpoint.

        Args:
            path: Path del file
            metadata: Metadati aggiuntivi
        """
        torch, _, _ = _get_torch()

        Path(path).parent.mkdir(parents=True, exist_ok=True)

        checkpoint = {
            "policy_state_dict": self.policy.mlp.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "baseline": self.baseline,
            "reward_variance": self.reward_variance,
            "num_updates": self.num_updates,
            "reward_history": self._reward_history[-100:],
            "config": self.config.to_dict(),
            "policy_config": {
                "input_dim": self.policy.input_dim,
                "hidden_dim": self.policy.hidden_dim,
                "num_experts": getattr(self.policy, 'num_experts', None),
            },
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {}
        }

        torch.save(checkpoint, path)
        log.info(f"SingleStepTrainer checkpoint saved to {path}")

    def load_checkpoint(self, path: str) -> Dict[str, Any]:
        """
        Carica checkpoint.

        Args:
            path: Path del file

        Returns:
            Metadata del checkpoint
        """
        torch, _, _ = _get_torch()

        # weights_only=False: checkpoint contains optimizer state (non-tensor)
        checkpoint = torch.load(path, map_location=self.policy.device, weights_only=False)

        self.policy.mlp.load_state_dict(checkpoint["policy_state_dict"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])

        self.baseline = checkpoint.get("baseline", 0.5)
        self.reward_variance = checkpoint.get("reward_variance", 0.1)
        self.num_updates = checkpoint.get("num_updates", 0)
        self._reward_history = checkpoint.get("reward_history", [])

        log.info(f"SingleStepTrainer checkpoint loaded from {path}")

        return checkpoint.get("metadata", {})

    def get_stats(self) -> Dict[str, Any]:
        """Restituisce statistiche correnti."""
        return {
            "num_updates": self.num_updates,
            "baseline": self.baseline,
            "reward_variance": self.reward_variance,
            "reward_history_len": len(self._reward_history),
            "config": self.config.to_dict(),
        }


# =============================================================================
# FACTORY
# =============================================================================

def create_single_step_trainer(
    policy: Any,
    learning_rate: float = 1e-4,
    entropy_coef: float = 0.01,
    checkpoint_path: Optional[str] = None
) -> SingleStepTrainer:
    """
    Factory per creare SingleStepTrainer.

    Args:
        policy: Policy network (GatingPolicy o TraversalPolicy)
        learning_rate: Learning rate
        entropy_coef: Coefficiente entropy bonus
        checkpoint_path: Path checkpoint da caricare

    Returns:
        SingleStepTrainer configurato
    """
    config = SingleStepConfig(
        learning_rate=learning_rate,
        entropy_coef=entropy_coef
    )

    trainer = SingleStepTrainer(policy, config)

    if checkpoint_path and Path(checkpoint_path).exists():
        trainer.load_checkpoint(checkpoint_path)

    return trainer
