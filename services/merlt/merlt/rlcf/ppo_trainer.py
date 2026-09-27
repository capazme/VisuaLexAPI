"""
PPO (Proximal Policy Optimization) Trainer
==========================================

Implementazione PPO per training più stabile rispetto a REINFORCE.

Vantaggi PPO su REINFORCE:
1. Clipped surrogate objective previene update troppo grandi
2. Multiple epochs per batch migliora sample efficiency
3. Value function per advantage estimation riduce varianza
4. Trust region implicito per stabilità

Formula PPO-Clip:
    L^CLIP(theta) = E[min(r_t(theta) * A_t, clip(r_t(theta), 1-eps, 1+eps) * A_t)]

Dove:
    r_t(theta) = pi_theta(a_t|s_t) / pi_theta_old(a_t|s_t)
    A_t = reward - V(s_t)  # Advantage
    eps = clip ratio (default 0.2)

Esempio:
    >>> from merlt.rlcf.ppo_trainer import PPOTrainer, PPOConfig
    >>> from merlt.rlcf.policy_gradient import GatingPolicy
    >>>
    >>> policy = GatingPolicy(input_dim=1024)
    >>> config = PPOConfig(clip_ratio=0.2, num_epochs=4)
    >>> trainer = PPOTrainer(policy, config)
    >>>
    >>> # Training con batch di esperienze
    >>> metrics = trainer.update_from_batch(traces, feedbacks)

Note:
    - Richiede storage di old_log_probs per importance sampling
    - Value function integrata per advantage calculation
    - Supporta GAE (Generalized Advantage Estimation)
"""

import math
import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple
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
# CONFIG
# =============================================================================

@dataclass
class PPOConfig:
    """
    Configurazione per PPO Trainer.

    Attributes:
        learning_rate: Learning rate per optimizer
        clip_ratio: Epsilon per clipping ratio (default 0.2)
        num_epochs: Numero di epochs per batch (default 4)
        value_coef: Coefficiente value loss (default 0.5)
        entropy_coef: Coefficiente entropy bonus (default 0.01)
        max_grad_norm: Max gradient norm per clipping
        gae_lambda: Lambda per GAE (default 0.95)
        gamma: Discount factor
        target_kl: Target KL divergence per early stopping (optional)
        batch_size: Mini-batch size per epoch (se None, usa tutto il batch)
    """
    learning_rate: float = 3e-4
    clip_ratio: float = 0.2
    num_epochs: int = 4
    value_coef: float = 0.5
    entropy_coef: float = 0.01
    max_grad_norm: float = 0.5
    gae_lambda: float = 0.95
    gamma: float = 0.99
    target_kl: Optional[float] = 0.01  # Early stop se KL > target
    batch_size: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serializza config."""
        return {
            "learning_rate": self.learning_rate,
            "clip_ratio": self.clip_ratio,
            "num_epochs": self.num_epochs,
            "value_coef": self.value_coef,
            "entropy_coef": self.entropy_coef,
            "max_grad_norm": self.max_grad_norm,
            "gae_lambda": self.gae_lambda,
            "gamma": self.gamma,
            "target_kl": self.target_kl,
            "batch_size": self.batch_size
        }


# =============================================================================
# VALUE NETWORK
# =============================================================================

class ValueNetwork:
    """
    Value function V(s) per advantage estimation.

    Predice il valore atteso di uno state (query embedding).

    Architettura:
        input (1024) -> hidden (256) -> ReLU -> hidden (128) -> ReLU -> output (1)

    Attributes:
        input_dim: Dimensione input
        hidden_dim: Dimensione hidden layer
        device: Device per training
    """

    def __init__(
        self,
        input_dim: int = 1024,
        hidden_dim: int = 256,
        device: Optional[str] = None
    ):
        """
        Inizializza ValueNetwork.

        Args:
            input_dim: Dimensione input embedding
            hidden_dim: Dimensione hidden layer
            device: Device (cuda/mps/cpu)
        """
        torch, nn, _, _ = _get_torch()

        self.input_dim = input_dim
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
        self.mlp = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim // 2, 1)
        ).to(self.device)

        log.info(
            "ValueNetwork initialized",
            input_dim=input_dim,
            hidden_dim=hidden_dim,
            device=self.device
        )

    def forward(self, state: Any) -> Any:
        """
        Forward pass.

        Args:
            state: State embedding [batch, input_dim]

        Returns:
            Value estimates [batch, 1]
        """
        return self.mlp(state)

    def parameters(self):
        """Restituisce parametri trainable."""
        return self.mlp.parameters()

    def to(self, device):
        """Muove network su device."""
        self.device = device
        self.mlp = self.mlp.to(device)
        return self

    def train(self):
        """Training mode."""
        self.mlp.train()
        return self

    def eval(self):
        """Eval mode."""
        self.mlp.eval()
        return self


# =============================================================================
# EXPERIENCE BUFFER FOR PPO
# =============================================================================

@dataclass
class PPOExperience:
    """
    Singola esperienza per PPO.

    Attributes:
        state: State embedding (query embedding)
        action: Azione presa (expert weights o altro)
        reward: Reward ricevuto
        log_prob: Log probability dell'azione sotto policy corrente
        value: Value estimate V(s)
        done: Se episodio terminato
        advantage: Advantage calcolato (opzionale)
        returns: Return calcolato (opzionale)
    """
    state: Any  # torch.Tensor
    action: Any  # torch.Tensor
    reward: float
    log_prob: float
    value: float
    done: bool = True  # Per MERL-T, ogni query e' un episodio
    advantage: Optional[float] = None
    returns: Optional[float] = None


class PPOBuffer:
    """
    Buffer per raccogliere esperienze PPO.

    Gestisce states, actions, rewards, log_probs, values.
    Calcola advantages usando GAE.
    """

    def __init__(self, gamma: float = 0.99, gae_lambda: float = 0.95):
        """
        Inizializza PPOBuffer.

        Args:
            gamma: Discount factor
            gae_lambda: Lambda per GAE
        """
        self.gamma = gamma
        self.gae_lambda = gae_lambda

        self.states = []
        self.actions = []
        self.rewards = []
        self.log_probs = []
        self.values = []
        self.dones = []

        self.advantages = []
        self.returns = []

    def add(
        self,
        state: Any,
        action: Any,
        reward: float,
        log_prob: float,
        value: float,
        done: bool = True
    ) -> None:
        """Aggiunge esperienza al buffer."""
        self.states.append(state)
        self.actions.append(action)
        self.rewards.append(reward)
        self.log_probs.append(log_prob)
        self.values.append(value)
        self.dones.append(done)

    def compute_gae(self, last_value: float = 0.0) -> None:
        """
        Calcola GAE per trajectory multi-step.

        Per MERL-T con episodi single-step, equivale a compute_advantages.
        """
        torch, _, _, _ = _get_torch()

        n = len(self.rewards)
        self.advantages = [0.0] * n
        self.returns = [0.0] * n

        gae = 0.0
        for i in reversed(range(n)):
            if i == n - 1:
                next_value = last_value
                next_non_terminal = 1.0 - int(self.dones[i])
            else:
                next_value = self.values[i + 1]
                next_non_terminal = 1.0 - int(self.dones[i])

            delta = self.rewards[i] + self.gamma * next_value * next_non_terminal - self.values[i]
            gae = delta + self.gamma * self.gae_lambda * next_non_terminal * gae

            self.advantages[i] = gae
            self.returns[i] = gae + self.values[i]

    def get_batch(self, device: str) -> Dict[str, Any]:
        """
        Restituisce batch per training.

        Args:
            device: Device target

        Returns:
            Dict con tensors per training
        """
        torch, _, _, _ = _get_torch()

        # Stack states e actions
        states = torch.stack(self.states).to(device)
        actions = torch.stack(self.actions).to(device)

        log_probs = torch.tensor(self.log_probs, dtype=torch.float32, device=device)
        values = torch.tensor(self.values, dtype=torch.float32, device=device)
        advantages = torch.tensor(self.advantages, dtype=torch.float32, device=device)
        returns = torch.tensor(self.returns, dtype=torch.float32, device=device)

        # Normalize advantages
        if len(advantages) > 1:
            advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        return {
            "states": states,
            "actions": actions,
            "old_log_probs": log_probs,
            "old_values": values,
            "advantages": advantages,
            "returns": returns
        }

    def __len__(self) -> int:
        return len(self.rewards)

    def clear(self) -> None:
        """Svuota buffer."""
        self.states = []
        self.actions = []
        self.rewards = []
        self.log_probs = []
        self.values = []
        self.dones = []
        self.advantages = []
        self.returns = []


# =============================================================================
# PPO TRAINER
# =============================================================================

@dataclass
class PPOMetrics:
    """Metriche di training PPO."""
    policy_loss: float = 0.0
    value_loss: float = 0.0
    entropy: float = 0.0
    total_loss: float = 0.0
    kl_divergence: float = 0.0
    clip_fraction: float = 0.0
    approx_kl: float = 0.0
    explained_variance: float = 0.0
    num_updates: int = 0
    epochs_completed: int = 0
    early_stopped: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Serializza metriche."""
        return {
            "policy_loss": round(self.policy_loss, 6),
            "value_loss": round(self.value_loss, 6),
            "entropy": round(self.entropy, 6),
            "total_loss": round(self.total_loss, 6),
            "kl_divergence": round(self.kl_divergence, 6),
            "clip_fraction": round(self.clip_fraction, 4),
            "approx_kl": round(self.approx_kl, 6),
            "explained_variance": round(self.explained_variance, 4),
            "num_updates": self.num_updates,
            "epochs_completed": self.epochs_completed,
            "early_stopped": self.early_stopped
        }


class PPOTrainer:
    """
    PPO (Proximal Policy Optimization) Trainer.

    Implementa PPO-Clip per training stabile delle policy MERL-T.

    Algoritmo:
        1. Raccogli batch di esperienze con current policy
        2. Calcola advantages usando GAE
        3. Per num_epochs:
            a. Shuffle batch
            b. Per ogni mini-batch:
                - Calcola ratio = pi_new / pi_old
                - Calcola surrogate loss clipped
                - Calcola value loss
                - Calcola entropy bonus
                - Backprop e update
            c. Check KL divergence per early stopping

    Attributes:
        policy: Policy network (GatingPolicy o TraversalPolicy)
        value_net: Value network per advantage estimation
        config: PPOConfig
        optimizer: Optimizer combinato per policy + value
        buffer: PPOBuffer per raccogliere esperienze
        num_updates: Totale updates effettuati
    """

    def __init__(
        self,
        policy: Any,
        config: Optional[PPOConfig] = None,
        value_net: Optional[ValueNetwork] = None,
        optimizer: Optional[Any] = None
    ):
        """
        Inizializza PPOTrainer.

        Args:
            policy: Policy network da trainare
            config: Configurazione PPO
            value_net: Value network (se None, viene creato)
            optimizer: Optimizer custom (se None, viene creato)
        """
        torch, _, optim, _ = _get_torch()

        self.policy = policy
        self.config = config or PPOConfig()

        # Value network
        if value_net:
            self.value_net = value_net
        else:
            self.value_net = ValueNetwork(
                input_dim=policy.input_dim,
                hidden_dim=policy.hidden_dim,
                device=policy.device
            )

        # Optimizer combinato
        if optimizer:
            self.optimizer = optimizer
        else:
            import itertools
            params = itertools.chain(
                policy.parameters(),
                self.value_net.parameters()
            )
            self.optimizer = optim.Adam(params, lr=self.config.learning_rate)

        # Buffer
        self.buffer = PPOBuffer(
            gamma=self.config.gamma,
            gae_lambda=self.config.gae_lambda
        )

        # Stats
        self.num_updates = 0
        self._total_episodes = 0

        log.info(
            "PPOTrainer initialized",
            clip_ratio=self.config.clip_ratio,
            num_epochs=self.config.num_epochs,
            learning_rate=self.config.learning_rate,
            device=policy.device
        )

    def collect_experience(
        self,
        state: Any,  # query embedding tensor
        action: Any,  # expert weights tensor
        reward: float,
        log_prob: float,
        done: bool = True
    ) -> None:
        """
        Raccoglie una singola esperienza nel buffer.

        Args:
            state: Query embedding
            action: Expert weights
            reward: Reward dal feedback
            log_prob: Log probability dell'azione
            done: Se episodio terminato
        """
        torch, _, _, _ = _get_torch()

        # Calcola value
        with torch.no_grad():
            if state.dim() == 1:
                state = state.unsqueeze(0)
            value = self.value_net.forward(state).squeeze().item()

        self.buffer.add(
            state=state.squeeze(0) if state.dim() == 2 else state,
            action=action.squeeze(0) if action.dim() == 2 else action,
            reward=reward,
            log_prob=log_prob,
            value=value,
            done=done
        )

        if done:
            self._total_episodes += 1

    def compute_reward(self, feedback: Any) -> float:
        """
        Calcola reward da feedback.

        Args:
            feedback: MultilevelFeedback object

        Returns:
            Reward normalizzato [0-1]
        """
        if hasattr(feedback, 'overall_score'):
            return feedback.overall_score()
        elif isinstance(feedback, dict):
            return feedback.get('overall_score', 0.5)
        return float(feedback) if feedback else 0.5

    def update(self) -> PPOMetrics:
        """
        Esegue update PPO sul buffer corrente.

        Returns:
            PPOMetrics con statistiche training
        """
        torch, _, _, F = _get_torch()

        if len(self.buffer) == 0:
            log.warning("Empty buffer, skipping update")
            return PPOMetrics()

        # Calcola advantages
        self.buffer.compute_gae(last_value=0.0)

        # Get batch
        batch = self.buffer.get_batch(self.policy.device)

        states = batch["states"]
        actions = batch["actions"]
        old_log_probs = batch["old_log_probs"]
        advantages = batch["advantages"]
        returns = batch["returns"]

        n_samples = len(states)
        batch_size = self.config.batch_size or n_samples

        # Training metrics
        total_policy_loss = 0.0
        total_value_loss = 0.0
        total_entropy = 0.0
        total_kl = 0.0
        total_clip_frac = 0.0
        n_batches = 0
        epochs_completed = 0
        early_stopped = False

        # PPO epochs
        for epoch in range(self.config.num_epochs):
            # Shuffle indices
            indices = torch.randperm(n_samples, device=self.policy.device)

            # Mini-batches
            for start in range(0, n_samples, batch_size):
                end = min(start + batch_size, n_samples)
                mb_indices = indices[start:end]

                mb_states = states[mb_indices]
                mb_actions = actions[mb_indices]
                mb_old_log_probs = old_log_probs[mb_indices]
                mb_advantages = advantages[mb_indices]
                mb_returns = returns[mb_indices]

                # Forward pass policy
                new_weights, new_log_probs = self.policy.forward(mb_states)

                # Per gating, usiamo log prob dei weights come azione
                # Calcola log prob dell'azione presa
                # L'azione e' la distribuzione dei weights, usiamo cross-entropy
                new_action_log_probs = (new_log_probs * mb_actions).sum(dim=-1)

                # Ratio per PPO
                log_ratio = new_action_log_probs - mb_old_log_probs
                ratio = torch.exp(log_ratio)

                # Clipped surrogate loss
                surr1 = ratio * mb_advantages
                surr2 = torch.clamp(
                    ratio,
                    1.0 - self.config.clip_ratio,
                    1.0 + self.config.clip_ratio
                ) * mb_advantages
                policy_loss = -torch.min(surr1, surr2).mean()

                # Value loss
                new_values = self.value_net.forward(mb_states).squeeze(-1)
                # Ensure same shape for single samples
                if new_values.dim() == 0:
                    new_values = new_values.unsqueeze(0)
                if mb_returns.dim() == 0:
                    mb_returns = mb_returns.unsqueeze(0)
                value_loss = F.mse_loss(new_values, mb_returns)

                # Entropy bonus (per exploration)
                entropy = -(new_weights * new_log_probs).sum(dim=-1).mean()

                # Total loss
                loss = (
                    policy_loss
                    + self.config.value_coef * value_loss
                    - self.config.entropy_coef * entropy
                )

                # Backprop
                self.optimizer.zero_grad()
                loss.backward()

                # Gradient clipping
                torch.nn.utils.clip_grad_norm_(
                    list(self.policy.parameters()) + list(self.value_net.parameters()),
                    self.config.max_grad_norm
                )

                self.optimizer.step()

                # Metriche
                with torch.no_grad():
                    # Approximate KL divergence
                    approx_kl = ((ratio - 1) - log_ratio).mean().item()

                    # Clip fraction
                    clip_frac = (
                        (ratio < 1.0 - self.config.clip_ratio) |
                        (ratio > 1.0 + self.config.clip_ratio)
                    ).float().mean().item()

                total_policy_loss += policy_loss.item()
                total_value_loss += value_loss.item()
                total_entropy += entropy.item()
                total_kl += approx_kl
                total_clip_frac += clip_frac
                n_batches += 1

            epochs_completed = epoch + 1

            # Early stopping su KL
            if self.config.target_kl is not None:
                avg_kl = total_kl / n_batches
                if avg_kl > self.config.target_kl:
                    log.info(
                        f"Early stopping at epoch {epoch+1} due to KL divergence",
                        kl=avg_kl,
                        target=self.config.target_kl
                    )
                    early_stopped = True
                    break

        self.num_updates += 1

        # Calcola explained variance
        with torch.no_grad():
            values_pred = self.value_net.forward(states).squeeze(-1)
            if values_pred.dim() == 0:
                values_pred = values_pred.unsqueeze(0)
            # Handle single sample case
            if len(returns) > 1:
                explained_var = 1 - (returns - values_pred).var() / (returns.var() + 1e-8)
                explained_var = explained_var.item()
            else:
                explained_var = 0.0  # Cannot compute with single sample

        # Clear buffer
        self.buffer.clear()

        metrics = PPOMetrics(
            policy_loss=total_policy_loss / n_batches,
            value_loss=total_value_loss / n_batches,
            entropy=total_entropy / n_batches,
            total_loss=(total_policy_loss + self.config.value_coef * total_value_loss) / n_batches,
            kl_divergence=total_kl / n_batches,
            clip_fraction=total_clip_frac / n_batches,
            approx_kl=total_kl / n_batches,
            explained_variance=explained_var,
            num_updates=self.num_updates,
            epochs_completed=epochs_completed,
            early_stopped=early_stopped
        )

        log.info("PPO update completed", **metrics.to_dict())

        return metrics

    def update_from_traces(
        self,
        traces: List[Any],
        feedbacks: List[Any]
    ) -> PPOMetrics:
        """
        Aggiorna policy da lista di traces e feedbacks.

        Converte traces in esperienze PPO e esegue update.

        Args:
            traces: Lista di ExecutionTrace
            feedbacks: Lista di MultilevelFeedback

        Returns:
            PPOMetrics con statistiche
        """
        torch, _, _, _ = _get_torch()

        if len(traces) != len(feedbacks):
            raise ValueError("Number of traces must match feedbacks")

        # Converti traces in esperienze
        for trace, feedback in zip(traces, feedbacks):
            reward = self.compute_reward(feedback)
            trace.set_reward(reward)

            # Per ogni azione nel trace
            for action in trace.actions:
                # Costruisci state e action tensors
                state = torch.tensor(
                    action.state if hasattr(action, 'state') else [0.0] * self.policy.input_dim,
                    dtype=torch.float32,
                    device=self.policy.device
                )

                action_tensor = torch.tensor(
                    action.weights if hasattr(action, 'weights') else [0.25] * self.policy.num_experts,
                    dtype=torch.float32,
                    device=self.policy.device
                )

                self.collect_experience(
                    state=state,
                    action=action_tensor,
                    reward=reward,
                    log_prob=action.log_prob,
                    done=True
                )

        # Esegui update
        return self.update()

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
        torch, _, _, _ = _get_torch()

        Path(path).parent.mkdir(parents=True, exist_ok=True)

        checkpoint = {
            "policy_state_dict": self.policy.mlp.state_dict(),
            "value_net_state_dict": self.value_net.mlp.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "num_updates": self.num_updates,
            "total_episodes": self._total_episodes,
            "config": self.config.to_dict(),
            "policy_config": {
                "input_dim": self.policy.input_dim,
                "hidden_dim": self.policy.hidden_dim,
                "num_experts": getattr(self.policy, 'num_experts', None)
            },
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {}
        }

        torch.save(checkpoint, path)
        log.info(f"PPO checkpoint saved to {path}")

    def load_checkpoint(self, path: str) -> Dict[str, Any]:
        """
        Carica checkpoint.

        Args:
            path: Path del file

        Returns:
            Metadata del checkpoint
        """
        torch, _, _, _ = _get_torch()

        # weights_only=False: checkpoint contains optimizer state (non-tensor)
        checkpoint = torch.load(path, map_location=self.policy.device, weights_only=False)

        self.policy.mlp.load_state_dict(checkpoint["policy_state_dict"])
        self.value_net.mlp.load_state_dict(checkpoint["value_net_state_dict"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])

        self.num_updates = checkpoint.get("num_updates", 0)
        self._total_episodes = checkpoint.get("total_episodes", 0)

        log.info(f"PPO checkpoint loaded from {path}")

        return checkpoint.get("metadata", {})

    def get_stats(self) -> Dict[str, Any]:
        """Restituisce statistiche training."""
        return {
            "num_updates": self.num_updates,
            "total_episodes": self._total_episodes,
            "buffer_size": len(self.buffer),
            "config": self.config.to_dict()
        }


# =============================================================================
# FACTORY
# =============================================================================

def create_ppo_trainer(
    policy: Any,
    clip_ratio: float = 0.2,
    num_epochs: int = 4,
    learning_rate: float = 3e-4,
    checkpoint_path: Optional[str] = None
) -> PPOTrainer:
    """
    Factory per creare PPO trainer.

    Args:
        policy: Policy network
        clip_ratio: Clip ratio PPO
        num_epochs: Epochs per update
        learning_rate: Learning rate
        checkpoint_path: Path checkpoint da caricare

    Returns:
        PPOTrainer configurato
    """
    config = PPOConfig(
        clip_ratio=clip_ratio,
        num_epochs=num_epochs,
        learning_rate=learning_rate
    )

    trainer = PPOTrainer(policy, config)

    if checkpoint_path and Path(checkpoint_path).exists():
        trainer.load_checkpoint(checkpoint_path)

    return trainer
