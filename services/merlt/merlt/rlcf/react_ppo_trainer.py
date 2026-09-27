"""
ReAct PPO Trainer
=================

PPO Trainer ottimizzato per training di policy ReAct multi-step.

Questo trainer è progettato per scenari dove ogni episodio consiste in
una sequenza di azioni:
    State → Action₁ → Obs₁ → Action₂ → Obs₂ → ... → Final Answer → Reward

Casi d'uso:
- Expert che usano tool (search, read, extract)
- Chain-of-thought reasoning
- Multi-step retrieval

Perché PPO per ReAct:
- GAE propaga credito alle azioni iniziali che influenzano il risultato finale
- Value function predice "quanto sarà buona la risposta da questo stato intermedio"
- Clipping previene update troppo aggressivi dopo singoli episodi "fortunati"
- Multiple epochs sfruttano al massimo ogni trajectory (ReAct è costoso)

NON usare per:
- Routing/Gating single-step (usa SingleStepTrainer)
- Decisioni one-shot

Action Space tipico per Expert:
- search_knowledge_graph(query)
- read_article(urn)
- get_related_articles(urn)
- extract_principle(article)
- final_answer(response)
- stop_and_summarize()

State tipico:
- query_embedding: embedding della query originale
- retrieved_docs: documenti già recuperati
- reasoning_history: azioni e osservazioni passate
- step_count: numero di step corrente

Reward:
- Sparse (alla fine): +1 se risposta corretta/utile
- Shaping (opzionale): -0.1 per step (efficienza), +0.2 per fonte citata

Esempio:
    >>> from merlt.rlcf.react_ppo_trainer import ReActPPOTrainer, ReActConfig
    >>>
    >>> # ReActPolicy è una policy che mappa state → action distribution
    >>> policy = ReActPolicy(state_dim=1024, action_dim=6)
    >>> config = ReActConfig(gamma=0.99, gae_lambda=0.95)
    >>> trainer = ReActPPOTrainer(policy, config)
    >>>
    >>> # Raccogli trajectory
    >>> trajectory = expert.generate_with_trace(query)
    >>> trainer.add_trajectory(trajectory, final_reward)
    >>>
    >>> # Training
    >>> metrics = trainer.update()
"""

import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple, Union
from datetime import datetime
from pathlib import Path
from enum import Enum

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
# ACTION TYPES
# =============================================================================

class ReActActionType(Enum):
    """Tipi di azione disponibili per Expert ReAct."""
    SEARCH_KG = "search_knowledge_graph"
    READ_ARTICLE = "read_article"
    GET_RELATED = "get_related_articles"
    SEARCH_PRECEDENTS = "search_precedents"
    EXTRACT_PRINCIPLE = "extract_principle"
    FINAL_ANSWER = "final_answer"
    STOP = "stop_and_summarize"
    THINK = "think"  # Chain of thought interno


# =============================================================================
# DATA STRUCTURES
# =============================================================================

@dataclass
class ReActStep:
    """
    Singolo step in una trajectory ReAct.

    Attributes:
        state: Stato corrente (embedding + context)
        action_type: Tipo di azione scelta
        action_args: Argomenti dell'azione (es. query per search)
        action_index: Indice dell'azione nel action space
        log_prob: Log probability dell'azione
        value: V(s) predetto dalla value function
        observation: Risultato dell'azione (testo, documenti, etc.)
        reward: Reward per questo step (0 per step intermedi, sparse per finale)
        done: Se episodio terminato
    """
    state: Any  # torch.Tensor [state_dim]
    action_type: ReActActionType
    action_args: Optional[Dict[str, Any]] = None
    action_index: int = 0
    log_prob: float = 0.0
    value: float = 0.0
    observation: Optional[str] = None
    reward: float = 0.0
    done: bool = False


@dataclass
class ReActTrajectory:
    """
    Trajectory completa di un episodio ReAct.

    Attributes:
        query_id: ID della query
        query: Testo della query originale
        query_embedding: Embedding della query
        steps: Lista di ReActStep
        final_reward: Reward finale dell'episodio
        total_reward: Somma di tutti i reward (include shaping)
        expert_type: Tipo di expert che ha generato la trajectory
    """
    query_id: str
    query: str
    query_embedding: Any  # torch.Tensor
    steps: List[ReActStep] = field(default_factory=list)
    final_reward: float = 0.0
    total_reward: float = 0.0
    expert_type: str = "unknown"

    def add_step(self, step: ReActStep) -> None:
        """Aggiunge step alla trajectory."""
        self.steps.append(step)
        self.total_reward += step.reward

    def set_final_reward(self, reward: float) -> None:
        """Imposta reward finale e lo assegna all'ultimo step."""
        self.final_reward = reward
        if self.steps:
            self.steps[-1].reward = reward
            self.steps[-1].done = True
            self.total_reward += reward

    def __len__(self) -> int:
        return len(self.steps)


# =============================================================================
# CONFIG
# =============================================================================

@dataclass
class ReActConfig:
    """
    Configurazione per ReActPPOTrainer.

    Attributes:
        learning_rate: Learning rate per optimizer
        gamma: Discount factor (quanto conta il futuro)
        gae_lambda: Lambda per GAE (trade-off bias/variance)
        clip_ratio: Epsilon per PPO clipping
        num_epochs: Epochs per ogni update
        value_coef: Coefficiente value loss
        entropy_coef: Coefficiente entropy bonus
        max_grad_norm: Max gradient norm per clipping
        target_kl: KL divergence target per early stopping
        batch_size: Mini-batch size per epoch
        max_steps_per_episode: Max step per episodio (evita loop infiniti)
        step_penalty: Penalità per ogni step (incentiva efficienza)
    """
    learning_rate: float = 3e-4
    gamma: float = 0.99
    gae_lambda: float = 0.95
    clip_ratio: float = 0.2
    num_epochs: int = 4
    value_coef: float = 0.5
    entropy_coef: float = 0.01
    max_grad_norm: float = 0.5
    target_kl: Optional[float] = 0.01
    batch_size: Optional[int] = None
    max_steps_per_episode: int = 10
    step_penalty: float = 0.0  # -0.1 per incentivare efficienza

    def to_dict(self) -> Dict[str, Any]:
        """Serializza config."""
        return {
            "learning_rate": self.learning_rate,
            "gamma": self.gamma,
            "gae_lambda": self.gae_lambda,
            "clip_ratio": self.clip_ratio,
            "num_epochs": self.num_epochs,
            "value_coef": self.value_coef,
            "entropy_coef": self.entropy_coef,
            "max_grad_norm": self.max_grad_norm,
            "target_kl": self.target_kl,
            "batch_size": self.batch_size,
            "max_steps_per_episode": self.max_steps_per_episode,
            "step_penalty": self.step_penalty,
        }


# =============================================================================
# REACT POLICY NETWORK
# =============================================================================

class ReActPolicy:
    """
    Policy network per ReAct reasoning.

    Mappa stato corrente → distribuzione su azioni.

    State encoding:
        [query_embedding, context_embedding, step_count_embedding]

    Architettura:
        state → MLP → action_logits → Categorical distribution

    Attributes:
        state_dim: Dimensione stato (tipicamente 768 + 256 + 16 = 1040)
        num_actions: Numero di azioni possibili
        hidden_dim: Dimensione hidden layers
    """

    def __init__(
        self,
        state_dim: int = 1024,
        num_actions: int = 7,
        hidden_dim: int = 256,
        device: Optional[str] = None
    ):
        """
        Inizializza ReActPolicy.

        Args:
            state_dim: Dimensione input stato
            num_actions: Numero di azioni nel action space
            hidden_dim: Dimensione hidden layer
            device: Device per training
        """
        torch, nn, _, _ = _get_torch()

        self.state_dim = state_dim
        self.num_actions = num_actions
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

        # Actor network (policy)
        self.actor = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim // 2, num_actions)
        ).to(self.device)

        # Critic network (value function)
        self.critic = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim // 2, 1)
        ).to(self.device)

        log.info(
            "ReActPolicy initialized",
            state_dim=state_dim,
            num_actions=num_actions,
            hidden_dim=hidden_dim,
            device=self.device
        )

    def forward(
        self,
        state: Any  # torch.Tensor [batch, state_dim]
    ) -> Tuple[Any, Any, Any]:
        """
        Forward pass.

        Args:
            state: Stato corrente [batch, state_dim]

        Returns:
            Tuple (action_probs, log_probs, values)
            - action_probs: [batch, num_actions] probabilità azioni
            - log_probs: [batch, num_actions] log probabilità
            - values: [batch, 1] value estimates
        """
        torch, _, _, F = _get_torch()

        # Actor
        logits = self.actor(state)
        action_probs = F.softmax(logits, dim=-1)
        log_probs = F.log_softmax(logits, dim=-1)

        # Critic
        values = self.critic(state)

        return action_probs, log_probs, values

    def select_action(
        self,
        state: Any,  # torch.Tensor
        deterministic: bool = False
    ) -> Tuple[int, float, float]:
        """
        Seleziona azione dato lo stato.

        Args:
            state: Stato corrente
            deterministic: Se True, usa argmax; altrimenti sample

        Returns:
            Tuple (action_index, log_prob, value)
        """
        torch, _, _, _ = _get_torch()

        with torch.no_grad():
            if state.dim() == 1:
                state = state.unsqueeze(0)

            action_probs, log_probs, values = self.forward(state)

            if deterministic:
                action_idx = action_probs.argmax(dim=-1).item()
            else:
                dist = torch.distributions.Categorical(action_probs)
                action_idx = dist.sample().item()

            log_prob = log_probs[0, action_idx].item()
            value = values[0, 0].item()

        return action_idx, log_prob, value

    def evaluate_actions(
        self,
        states: Any,  # torch.Tensor [batch, state_dim]
        actions: Any  # torch.Tensor [batch] action indices
    ) -> Tuple[Any, Any, Any]:
        """
        Valuta azioni date per batch di stati.

        Usato durante training per ricalcolare log_probs con gradient.

        Args:
            states: Stati [batch, state_dim]
            actions: Indici azioni [batch]

        Returns:
            Tuple (log_probs, values, entropy)
        """
        torch, _, _, _ = _get_torch()

        action_probs, log_probs_all, values = self.forward(states)

        # Log prob delle azioni prese
        log_probs = log_probs_all.gather(1, actions.unsqueeze(-1)).squeeze(-1)

        # Entropy
        entropy = -(action_probs * log_probs_all).sum(dim=-1)

        return log_probs, values.squeeze(-1), entropy

    def parameters(self):
        """Restituisce parametri trainable."""
        import itertools
        return itertools.chain(self.actor.parameters(), self.critic.parameters())

    def actor_parameters(self):
        """Restituisce solo parametri actor."""
        return self.actor.parameters()

    def critic_parameters(self):
        """Restituisce solo parametri critic."""
        return self.critic.parameters()

    def to(self, device):
        """Muove policy su device."""
        self.device = device
        self.actor = self.actor.to(device)
        self.critic = self.critic.to(device)
        return self

    def train(self):
        """Training mode."""
        self.actor.train()
        self.critic.train()
        return self

    def eval(self):
        """Eval mode."""
        self.actor.eval()
        self.critic.eval()
        return self


# =============================================================================
# GAE COMPUTATION
# =============================================================================

def compute_gae(
    rewards: List[float],
    values: List[float],
    dones: List[bool],
    gamma: float,
    gae_lambda: float,
    last_value: float = 0.0
) -> Tuple[List[float], List[float]]:
    """
    Calcola GAE (Generalized Advantage Estimation).

    GAE formula:
        A_t = δ_t + (γλ)δ_{t+1} + (γλ)²δ_{t+2} + ...
        δ_t = r_t + γV(s_{t+1}) - V(s_t)

    Args:
        rewards: Lista di reward per ogni step
        values: Lista di value estimates V(s)
        dones: Lista di flag done
        gamma: Discount factor
        gae_lambda: Lambda per GAE
        last_value: Value dell'ultimo stato (per bootstrap)

    Returns:
        Tuple (advantages, returns)
    """
    n = len(rewards)
    advantages = [0.0] * n
    returns = [0.0] * n

    gae = 0.0
    for t in reversed(range(n)):
        if t == n - 1:
            next_value = last_value
            next_non_terminal = 1.0 - float(dones[t])
        else:
            next_value = values[t + 1]
            next_non_terminal = 1.0 - float(dones[t])

        # TD error
        delta = rewards[t] + gamma * next_value * next_non_terminal - values[t]

        # GAE
        gae = delta + gamma * gae_lambda * next_non_terminal * gae
        advantages[t] = gae
        returns[t] = gae + values[t]

    return advantages, returns


# =============================================================================
# REACT PPO TRAINER
# =============================================================================

class ReActPPOTrainer:
    """
    PPO Trainer per ReAct multi-step reasoning.

    Ottimizzato per training di Expert che usano tool e reasoning sequenziale.

    Caratteristiche chiave:
    - GAE per credit assignment temporale
    - Value function per advantage estimation
    - Clipping per stabilità
    - Support per trajectory di lunghezza variabile

    Workflow:
        1. Expert genera trajectory con ReActPolicy
        2. Raccogli trajectories nel buffer
        3. Quando buffer pieno, calcola GAE e aggiorna

    Attributes:
        policy: ReActPolicy (actor-critic)
        config: ReActConfig
        optimizer: Optimizer
        trajectories: Buffer di trajectories
        num_updates: Totale updates
    """

    def __init__(
        self,
        policy: ReActPolicy,
        config: Optional[ReActConfig] = None,
        optimizer: Optional[Any] = None
    ):
        """
        Inizializza ReActPPOTrainer.

        Args:
            policy: ReActPolicy da trainare
            config: Configurazione
            optimizer: Optimizer custom
        """
        torch, _, optim, _ = _get_torch()

        self.policy = policy
        self.config = config or ReActConfig()

        # Optimizer
        if optimizer:
            self.optimizer = optimizer
        else:
            self.optimizer = optim.Adam(
                policy.parameters(),
                lr=self.config.learning_rate
            )

        # Buffer
        self.trajectories: List[ReActTrajectory] = []
        self._all_steps: List[ReActStep] = []

        # Stats
        self.num_updates = 0
        self._total_episodes = 0
        self._total_steps = 0

        log.info(
            "ReActPPOTrainer initialized",
            gamma=self.config.gamma,
            gae_lambda=self.config.gae_lambda,
            clip_ratio=self.config.clip_ratio,
            num_epochs=self.config.num_epochs
        )

    def add_trajectory(
        self,
        trajectory: ReActTrajectory
    ) -> None:
        """
        Aggiunge trajectory al buffer.

        Args:
            trajectory: ReActTrajectory completa
        """
        # Applica step penalty se configurato
        if self.config.step_penalty != 0:
            for i, step in enumerate(trajectory.steps[:-1]):  # Tutti tranne ultimo
                step.reward += self.config.step_penalty

        self.trajectories.append(trajectory)
        self._all_steps.extend(trajectory.steps)
        self._total_episodes += 1
        self._total_steps += len(trajectory.steps)

        log.debug(
            "Trajectory added",
            query_id=trajectory.query_id,
            num_steps=len(trajectory.steps),
            final_reward=trajectory.final_reward
        )

    def add_trajectory_from_steps(
        self,
        query_id: str,
        query: str,
        query_embedding: Any,
        steps: List[Dict[str, Any]],
        final_reward: float,
        expert_type: str = "unknown"
    ) -> None:
        """
        Crea e aggiunge trajectory da lista di step dict.

        Utility per integrazione con Expert esistenti.

        Args:
            query_id: ID query
            query: Testo query
            query_embedding: Embedding query
            steps: Lista di dict con step data
            final_reward: Reward finale
            expert_type: Tipo expert
        """
        trajectory = ReActTrajectory(
            query_id=query_id,
            query=query,
            query_embedding=query_embedding,
            expert_type=expert_type
        )

        for i, step_data in enumerate(steps):
            step = ReActStep(
                state=step_data.get("state"),
                action_type=ReActActionType(step_data.get("action_type", "think")),
                action_args=step_data.get("action_args"),
                action_index=step_data.get("action_index", 0),
                log_prob=step_data.get("log_prob", 0.0),
                value=step_data.get("value", 0.0),
                observation=step_data.get("observation"),
                reward=step_data.get("reward", 0.0),
                done=(i == len(steps) - 1)
            )
            trajectory.add_step(step)

        trajectory.set_final_reward(final_reward)
        self.add_trajectory(trajectory)

    def update(self) -> Dict[str, float]:
        """
        Esegue update PPO su tutte le trajectory nel buffer.

        Returns:
            Dict con metriche di training
        """
        torch, _, _, F = _get_torch()

        if len(self._all_steps) == 0:
            log.warning("No steps in buffer, skipping update")
            return {}

        # Prepara batch
        states = torch.stack([s.state for s in self._all_steps]).to(self.policy.device)
        actions = torch.tensor(
            [s.action_index for s in self._all_steps],
            dtype=torch.long,
            device=self.policy.device
        )
        old_log_probs = torch.tensor(
            [s.log_prob for s in self._all_steps],
            dtype=torch.float32,
            device=self.policy.device
        )
        old_values = torch.tensor(
            [s.value for s in self._all_steps],
            dtype=torch.float32,
            device=self.policy.device
        )

        # Calcola GAE per ogni trajectory
        all_advantages = []
        all_returns = []

        step_idx = 0
        for trajectory in self.trajectories:
            rewards = [s.reward for s in trajectory.steps]
            values = [s.value for s in trajectory.steps]
            dones = [s.done for s in trajectory.steps]

            advantages, returns = compute_gae(
                rewards=rewards,
                values=values,
                dones=dones,
                gamma=self.config.gamma,
                gae_lambda=self.config.gae_lambda,
                last_value=0.0
            )

            all_advantages.extend(advantages)
            all_returns.extend(returns)
            step_idx += len(trajectory.steps)

        advantages = torch.tensor(all_advantages, dtype=torch.float32, device=self.policy.device)
        returns = torch.tensor(all_returns, dtype=torch.float32, device=self.policy.device)

        # Normalize advantages
        if len(advantages) > 1:
            advantages = (advantages - advantages.mean()) / (advantages.std() + 1e-8)

        n_samples = len(states)
        batch_size = self.config.batch_size or n_samples

        # Metriche
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
            indices = torch.randperm(n_samples, device=self.policy.device)

            for start in range(0, n_samples, batch_size):
                end = min(start + batch_size, n_samples)
                mb_idx = indices[start:end]

                mb_states = states[mb_idx]
                mb_actions = actions[mb_idx]
                mb_old_log_probs = old_log_probs[mb_idx]
                mb_advantages = advantages[mb_idx]
                mb_returns = returns[mb_idx]

                # Forward pass
                new_log_probs, new_values, entropy = self.policy.evaluate_actions(
                    mb_states, mb_actions
                )

                # Ratio
                log_ratio = new_log_probs - mb_old_log_probs
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
                value_loss = F.mse_loss(new_values, mb_returns)

                # Entropy loss
                entropy_loss = -entropy.mean()

                # Total loss
                loss = (
                    policy_loss
                    + self.config.value_coef * value_loss
                    + self.config.entropy_coef * entropy_loss
                )

                # Backprop
                self.optimizer.zero_grad()
                loss.backward()

                # Gradient clipping
                torch.nn.utils.clip_grad_norm_(
                    self.policy.parameters(),
                    self.config.max_grad_norm
                )

                self.optimizer.step()

                # Metriche
                with torch.no_grad():
                    approx_kl = ((ratio - 1) - log_ratio).mean().item()
                    clip_frac = (
                        (ratio < 1.0 - self.config.clip_ratio) |
                        (ratio > 1.0 + self.config.clip_ratio)
                    ).float().mean().item()

                total_policy_loss += policy_loss.item()
                total_value_loss += value_loss.item()
                total_entropy += entropy.mean().item()
                total_kl += approx_kl
                total_clip_frac += clip_frac
                n_batches += 1

            epochs_completed = epoch + 1

            # Early stopping su KL
            if self.config.target_kl is not None:
                avg_kl = total_kl / n_batches
                if avg_kl > self.config.target_kl:
                    log.info(
                        f"Early stopping at epoch {epoch+1}",
                        kl=avg_kl,
                        target_kl=self.config.target_kl
                    )
                    early_stopped = True
                    break

        self.num_updates += 1

        # Calcola explained variance
        with torch.no_grad():
            _, final_values, _ = self.policy.evaluate_actions(states, actions)
            if len(returns) > 1:
                explained_var = 1 - (returns - final_values).var() / (returns.var() + 1e-8)
                explained_var = explained_var.item()
            else:
                explained_var = 0.0

        # Clear buffer
        self.trajectories = []
        self._all_steps = []

        metrics = {
            "policy_loss": total_policy_loss / max(n_batches, 1),
            "value_loss": total_value_loss / max(n_batches, 1),
            "entropy": total_entropy / max(n_batches, 1),
            "kl_divergence": total_kl / max(n_batches, 1),
            "clip_fraction": total_clip_frac / max(n_batches, 1),
            "explained_variance": explained_var,
            "epochs_completed": epochs_completed,
            "early_stopped": early_stopped,
            "num_trajectories": self._total_episodes,
            "num_steps": n_samples,
            "num_updates": self.num_updates,
        }

        log.info("ReActPPO update completed", **metrics)

        return metrics

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
            "actor_state_dict": self.policy.actor.state_dict(),
            "critic_state_dict": self.policy.critic.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "num_updates": self.num_updates,
            "total_episodes": self._total_episodes,
            "total_steps": self._total_steps,
            "config": self.config.to_dict(),
            "policy_config": {
                "state_dim": self.policy.state_dim,
                "num_actions": self.policy.num_actions,
                "hidden_dim": self.policy.hidden_dim,
            },
            "timestamp": datetime.now().isoformat(),
            "metadata": metadata or {}
        }

        torch.save(checkpoint, path)
        log.info(f"ReActPPOTrainer checkpoint saved to {path}")

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

        self.policy.actor.load_state_dict(checkpoint["actor_state_dict"])
        self.policy.critic.load_state_dict(checkpoint["critic_state_dict"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])

        self.num_updates = checkpoint.get("num_updates", 0)
        self._total_episodes = checkpoint.get("total_episodes", 0)
        self._total_steps = checkpoint.get("total_steps", 0)

        log.info(f"ReActPPOTrainer checkpoint loaded from {path}")

        return checkpoint.get("metadata", {})

    def get_stats(self) -> Dict[str, Any]:
        """Restituisce statistiche correnti."""
        return {
            "num_updates": self.num_updates,
            "total_episodes": self._total_episodes,
            "total_steps": self._total_steps,
            "buffer_trajectories": len(self.trajectories),
            "buffer_steps": len(self._all_steps),
            "config": self.config.to_dict(),
        }


# =============================================================================
# FACTORY
# =============================================================================

def create_react_policy(
    state_dim: int = 1024,
    num_actions: int = 7,
    hidden_dim: int = 256,
    device: Optional[str] = None
) -> ReActPolicy:
    """
    Factory per creare ReActPolicy.

    Args:
        state_dim: Dimensione stato
        num_actions: Numero azioni
        hidden_dim: Dimensione hidden
        device: Device

    Returns:
        ReActPolicy configurata
    """
    return ReActPolicy(
        state_dim=state_dim,
        num_actions=num_actions,
        hidden_dim=hidden_dim,
        device=device
    )


def create_react_ppo_trainer(
    policy: ReActPolicy,
    gamma: float = 0.99,
    gae_lambda: float = 0.95,
    clip_ratio: float = 0.2,
    num_epochs: int = 4,
    checkpoint_path: Optional[str] = None
) -> ReActPPOTrainer:
    """
    Factory per creare ReActPPOTrainer.

    Args:
        policy: ReActPolicy
        gamma: Discount factor
        gae_lambda: Lambda per GAE
        clip_ratio: Clip ratio PPO
        num_epochs: Epochs per update
        checkpoint_path: Path checkpoint da caricare

    Returns:
        ReActPPOTrainer configurato
    """
    config = ReActConfig(
        gamma=gamma,
        gae_lambda=gae_lambda,
        clip_ratio=clip_ratio,
        num_epochs=num_epochs
    )

    trainer = ReActPPOTrainer(policy, config)

    if checkpoint_path and Path(checkpoint_path).exists():
        trainer.load_checkpoint(checkpoint_path)

    return trainer
