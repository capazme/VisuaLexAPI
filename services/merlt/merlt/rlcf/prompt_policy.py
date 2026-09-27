"""
Prompt Policy
=============

Policy network per soft prompt tuning via REINFORCE.

Produce embedding di modulazione che vengono applicati ai prompt
degli expert per adattarli dinamicamente.

Fondamento teorico:
- Soft Prompt Tuning: P(response|query, prompt, modulation)
- REINFORCE: ∇J(θ) = E[∇log π(modulation|query) * R]
- Il modulation vector influenza come il prompt viene interpretato

Esempio:
    >>> from merlt.rlcf.prompt_policy import PromptPolicy
    >>>
    >>> policy = PromptPolicy(input_dim=1024, prompt_dim=256)
    >>> query_embedding = get_embedding("Cos'e' la legittima difesa?")
    >>> modulation, log_prob = policy(query_embedding)
    >>> # modulation viene usato per adattare il prompt
"""

import warnings
warnings.warn(
    "merlt.rlcf.prompt_policy is deprecated and has no active callers in production code. "
    "This module will be removed in a future version.",
    DeprecationWarning,
    stacklevel=2,
)

import structlog
import torch
import torch.nn as nn
import torch.nn.functional as F
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime

log = structlog.get_logger()


@dataclass
class PromptFeedback:
    """
    Feedback specifico per la qualita' del prompt.

    Usato per valutare quanto efficacemente il prompt ha guidato
    l'interpretazione dell'expert.

    Attributes:
        clarity: Chiarezza dell'output (0-1)
        relevance: Rilevanza rispetto alla query (0-1)
        completeness: Completezza della risposta (0-1)
        prompt_quality_score: Score aggregato (0-1)
    """
    clarity: float = 0.5
    relevance: float = 0.5
    completeness: float = 0.5
    prompt_quality_score: float = 0.5

    def __post_init__(self):
        """Calcola score aggregato se non fornito."""
        if self.prompt_quality_score == 0.5:
            self.prompt_quality_score = (
                self.clarity * 0.3 +
                self.relevance * 0.4 +
                self.completeness * 0.3
            )

    def to_dict(self) -> Dict[str, float]:
        """Serializza in dizionario."""
        return {
            "clarity": self.clarity,
            "relevance": self.relevance,
            "completeness": self.completeness,
            "prompt_quality_score": self.prompt_quality_score,
        }


@dataclass
class PromptAction:
    """
    Azione di prompt generation tracciabile.

    Attributes:
        expert_type: Tipo di expert (literal, systemic, etc.)
        prompt_version: Versione del prompt usato
        modulation_vector: Vettore di modulazione applicato
        log_prob: Log probability dell'azione
        timestamp: Quando e' stata eseguita
    """
    expert_type: str
    prompt_version: str
    modulation_vector: Optional[List[float]] = None
    log_prob: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "action_type": "prompt_generation",
            "expert_type": self.expert_type,
            "prompt_version": self.prompt_version,
            "modulation_vector": self.modulation_vector,
            "log_prob": self.log_prob,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }


class PromptPolicy(nn.Module):
    """
    Policy network per soft prompt tuning.

    Produce un vettore di modulazione che puo' essere usato per
    adattare il prompt in modo differenziabile.

    Architettura:
        query_embedding → MLP → modulation_mean, modulation_std → sample → modulation
                                                                         ↓
                                                                    log_prob

    Attributes:
        input_dim: Dimensione dell'embedding di input (query)
        hidden_dim: Dimensione del layer nascosto
        prompt_dim: Dimensione del vettore di modulazione
        temperature: Temperatura per sampling (default 1.0)
    """

    def __init__(
        self,
        input_dim: int = 1024,
        hidden_dim: int = 512,
        prompt_dim: int = 256,
        temperature: float = 1.0,
        num_experts: int = 4,
    ):
        """
        Inizializza la policy.

        Args:
            input_dim: Dimensione embedding input
            hidden_dim: Dimensione hidden layer
            prompt_dim: Dimensione output modulation
            temperature: Temperatura sampling
            num_experts: Numero di expert (per expert-specific modulation)
        """
        super().__init__()

        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.prompt_dim = prompt_dim
        self.temperature = temperature
        self.num_experts = num_experts

        # Encoder MLP
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.LayerNorm(hidden_dim // 2),
            nn.GELU(),
        )

        # Output heads per mean e log_std
        self.mean_head = nn.Linear(hidden_dim // 2, prompt_dim)
        self.log_std_head = nn.Linear(hidden_dim // 2, prompt_dim)

        # Expert-specific projection (opzionale)
        self.expert_projections = nn.ModuleDict({
            f"expert_{i}": nn.Linear(prompt_dim, prompt_dim)
            for i in range(num_experts)
        })

        # Inizializzazione
        self._init_weights()

        log.info(
            "PromptPolicy initialized",
            input_dim=input_dim,
            hidden_dim=hidden_dim,
            prompt_dim=prompt_dim,
            num_experts=num_experts,
        )

    def _init_weights(self):
        """Inizializza i pesi con valori piccoli per stabilita'."""
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.xavier_uniform_(module.weight, gain=0.1)
                if module.bias is not None:
                    nn.init.zeros_(module.bias)

        # Log std inizializzato a valori negativi (bassa varianza iniziale)
        nn.init.constant_(self.log_std_head.weight, -2.0)
        nn.init.zeros_(self.log_std_head.bias)

    def forward(
        self,
        query_embedding: torch.Tensor,
        expert_idx: Optional[int] = None,
        deterministic: bool = False,
    ) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Genera modulation vector per il prompt.

        Args:
            query_embedding: Embedding della query [batch_size, input_dim]
            expert_idx: Indice dell'expert (per expert-specific modulation)
            deterministic: Se True, usa mean invece di sampling

        Returns:
            Tuple[modulation, log_prob]:
                - modulation: Vettore di modulazione [batch_size, prompt_dim]
                - log_prob: Log probability dell'azione [batch_size]
        """
        # Ensure correct device
        device = query_embedding.device

        # Encode query
        hidden = self.encoder(query_embedding)

        # Compute mean and std
        mean = self.mean_head(hidden)
        log_std = self.log_std_head(hidden)
        log_std = torch.clamp(log_std, min=-5, max=2)  # Stabilita' numerica
        std = torch.exp(log_std) * self.temperature

        # Sample or use mean
        if deterministic:
            modulation = mean
            log_prob = torch.zeros(query_embedding.shape[0], device=device)
        else:
            # Reparameterization trick
            eps = torch.randn_like(std)
            modulation = mean + std * eps

            # Compute log probability
            # log N(x; μ, σ) = -0.5 * log(2π) - log(σ) - 0.5 * ((x - μ) / σ)^2
            log_prob = -0.5 * (
                torch.log(2 * torch.pi * std**2) +
                ((modulation - mean) / std) ** 2
            ).sum(dim=-1)

        # Apply expert-specific projection if requested
        if expert_idx is not None and f"expert_{expert_idx}" in self.expert_projections:
            modulation = self.expert_projections[f"expert_{expert_idx}"](modulation)

        return modulation, log_prob

    def get_modulation(
        self,
        query_embedding: torch.Tensor,
        expert_type: str = "literal",
    ) -> Tuple[torch.Tensor, float]:
        """
        Convenience method per ottenere modulation per un expert.

        Args:
            query_embedding: Embedding della query
            expert_type: Tipo di expert

        Returns:
            Tuple[modulation, log_prob]
        """
        expert_map = {"literal": 0, "systemic": 1, "principles": 2, "precedent": 3}
        expert_idx = expert_map.get(expert_type, 0)

        with torch.no_grad():
            modulation, log_prob = self.forward(
                query_embedding.unsqueeze(0) if query_embedding.dim() == 1 else query_embedding,
                expert_idx=expert_idx,
            )

        return modulation.squeeze(0), log_prob.item()

    def compute_loss(
        self,
        log_probs: torch.Tensor,
        rewards: torch.Tensor,
        baseline: Optional[torch.Tensor] = None,
    ) -> torch.Tensor:
        """
        Calcola REINFORCE loss.

        Args:
            log_probs: Log probabilities delle azioni [batch_size]
            rewards: Rewards ricevuti [batch_size]
            baseline: Baseline per variance reduction (opzionale)

        Returns:
            Loss scalare
        """
        if baseline is not None:
            advantages = rewards - baseline
        else:
            advantages = rewards - rewards.mean()

        # REINFORCE: -E[log π(a|s) * A]
        loss = -(log_probs * advantages.detach()).mean()

        return loss

    def save(self, path: str) -> None:
        """Salva i pesi del modello."""
        torch.save(self.state_dict(), path)
        log.info(f"PromptPolicy saved to {path}")

    def load(self, path: str) -> None:
        """Carica i pesi del modello."""
        self.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
        log.info(f"PromptPolicy loaded from {path}")


class PromptPolicyTrainer:
    """
    Trainer per PromptPolicy via REINFORCE.

    Accumula esperienze e aggiorna la policy periodicamente.
    """

    def __init__(
        self,
        policy: PromptPolicy,
        learning_rate: float = 1e-4,
        baseline_decay: float = 0.99,
        entropy_coef: float = 0.01,
    ):
        """
        Inizializza il trainer.

        Args:
            policy: PromptPolicy da trainare
            learning_rate: Learning rate
            baseline_decay: Decay per moving average baseline
            entropy_coef: Coefficiente per entropy regularization
        """
        self.policy = policy
        self.optimizer = torch.optim.Adam(policy.parameters(), lr=learning_rate)
        self.baseline_decay = baseline_decay
        self.entropy_coef = entropy_coef

        self.running_baseline = 0.0
        self.experience_buffer: List[Dict[str, Any]] = []

        log.info(
            "PromptPolicyTrainer initialized",
            learning_rate=learning_rate,
            baseline_decay=baseline_decay,
        )

    def record_experience(
        self,
        query_embedding: torch.Tensor,
        modulation: torch.Tensor,
        log_prob: float,
        reward: float,
        expert_type: str,
    ) -> None:
        """
        Registra un'esperienza per training successivo.

        Args:
            query_embedding: Embedding della query
            modulation: Modulation usata
            log_prob: Log probability dell'azione
            reward: Reward ricevuto
            expert_type: Tipo di expert
        """
        self.experience_buffer.append({
            "query_embedding": query_embedding.detach().cpu(),
            "modulation": modulation.detach().cpu(),
            "log_prob": log_prob,
            "reward": reward,
            "expert_type": expert_type,
        })

        # Update running baseline
        self.running_baseline = (
            self.baseline_decay * self.running_baseline +
            (1 - self.baseline_decay) * reward
        )

    def update(self, min_experiences: int = 8) -> Optional[Dict[str, float]]:
        """
        Aggiorna la policy se ci sono abbastanza esperienze.

        Args:
            min_experiences: Minimo numero di esperienze per update

        Returns:
            Dict con metriche di training o None se skip
        """
        if len(self.experience_buffer) < min_experiences:
            return None

        self.policy.train()

        # Stack query embeddings per ricalcolare log_probs con gradients
        query_embeddings = torch.stack([
            e["query_embedding"] for e in self.experience_buffer
        ])
        rewards = torch.tensor([e["reward"] for e in self.experience_buffer])

        # Mappa expert_type a indice
        expert_map = {"literal": 0, "systemic": 1, "principles": 2, "precedent": 3}
        expert_indices = [
            expert_map.get(e["expert_type"], 0)
            for e in self.experience_buffer
        ]

        # Ricalcola log_probs con gradient graph
        _, log_probs = self.policy(query_embeddings, deterministic=False)

        # Compute loss
        advantages = rewards - self.running_baseline
        loss = -(log_probs * advantages.detach()).mean()

        # Entropy bonus (stima da log_probs)
        entropy_estimate = -log_probs.mean()
        entropy_loss = -self.entropy_coef * entropy_estimate
        total_loss = loss + entropy_loss

        # Update
        self.optimizer.zero_grad()
        total_loss.backward()
        torch.nn.utils.clip_grad_norm_(self.policy.parameters(), 1.0)
        self.optimizer.step()

        # Clear buffer
        metrics = {
            "loss": total_loss.item(),
            "policy_loss": loss.item(),
            "entropy_loss": entropy_loss.item(),
            "avg_reward": rewards.mean().item(),
            "avg_advantage": advantages.mean().item(),
            "buffer_size": len(self.experience_buffer),
        }

        self.experience_buffer = []

        log.info("PromptPolicy updated", **metrics)

        return metrics

    def save_checkpoint(self, path: str) -> None:
        """Salva checkpoint completo."""
        checkpoint = {
            "policy_state_dict": self.policy.state_dict(),
            "optimizer_state_dict": self.optimizer.state_dict(),
            "running_baseline": self.running_baseline,
        }
        torch.save(checkpoint, path)
        log.info(f"Checkpoint saved to {path}")

    def load_checkpoint(self, path: str) -> None:
        """Carica checkpoint."""
        # weights_only=False: checkpoint contains optimizer state (non-tensor)
        checkpoint = torch.load(path, map_location="cpu", weights_only=False)
        self.policy.load_state_dict(checkpoint["policy_state_dict"])
        self.optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
        self.running_baseline = checkpoint["running_baseline"]
        log.info(f"Checkpoint loaded from {path}")
