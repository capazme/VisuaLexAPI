"""
Policy Manager
==============

Central hub per gestire TraversalPolicy e GatingPolicy.

Responsabilita':
- Initialize policies (lazy load da checkpoint)
- Compute weights con fallback a config statici
- Registra log_prob in ExecutionTrace
- Device management (CPU/GPU/MPS)

Il PolicyManager gestisce il ciclo di vita delle policy neurali per il sistema
RLCF, permettendo transizione graduale da pesi statici a pesi appresi.

Esempio:
    >>> from merlt.rlcf.policy_manager import PolicyManager
    >>> from merlt.rlcf.execution_trace import ExecutionTrace
    >>>
    >>> # Inizializza manager
    >>> manager = PolicyManager(enable_policy=True)
    >>>
    >>> # Computa peso per una relazione
    >>> weight, log_prob = await manager.compute_relation_weight(
    ...     query_embedding=embedding,
    ...     relation_type="RIFERIMENTO",
    ...     expert_type="literal",
    ...     trace=trace
    ... )
    >>>
    >>> # Batch computation (piu' efficiente)
    >>> weights = await manager.compute_batch_weights(
    ...     query_embedding=embedding,
    ...     relation_types=["RIFERIMENTO", "CITATO_DA", "MODIFICA"],
    ...     expert_type="literal",
    ...     trace=trace
    ... )
"""

import threading

import structlog
from typing import Optional, List, Dict, Any, Tuple, TYPE_CHECKING
from pathlib import Path
from dataclasses import dataclass, field

if TYPE_CHECKING:
    from merlt.rlcf.policy_gradient import TraversalPolicy
    from merlt.experts.neural_gating.neural import ExpertGatingMLP
    from merlt.rlcf.execution_trace import ExecutionTrace

log = structlog.get_logger()


# Default traversal weights per expert type (fallback)
DEFAULT_TRAVERSAL_WEIGHTS: Dict[str, Dict[str, float]] = {
    "literal": {
        "RIFERIMENTO": 0.9,
        "CITATO_DA": 0.8,
        "MODIFICA": 0.7,
        "MODIFICATO_DA": 0.7,
        "DEROGA": 0.5,
        "DEROGATO_DA": 0.5,
        "ABROGA": 0.4,
        "ABROGATO_DA": 0.4,
        "RELATED_TO": 0.3,
        "default": 0.3
    },
    "systemic": {
        "RIFERIMENTO": 0.95,
        "CITATO_DA": 0.9,
        "MODIFICA": 0.85,
        "MODIFICATO_DA": 0.85,
        "DEROGA": 0.7,
        "DEROGATO_DA": 0.7,
        "ABROGA": 0.6,
        "ABROGATO_DA": 0.6,
        "RELATED_TO": 0.5,
        "default": 0.4
    },
    "principles": {
        "RIFERIMENTO": 0.7,
        "CITATO_DA": 0.6,
        "INTERPRETED_BY": 0.9,
        "APPLIES_TO": 0.8,
        "RELATED_TO": 0.7,
        "default": 0.4
    },
    "precedent": {
        "INTERPRETED_BY": 0.95,
        "CITATO_DA": 0.9,
        "RIFERIMENTO": 0.7,
        "APPLIES_TO": 0.85,
        "RELATED_TO": 0.5,
        "default": 0.3
    }
}


@dataclass
class PolicyConfig:
    """
    Configurazione per PolicyManager.

    Attributes:
        checkpoint_dir: Directory con checkpoint policy
        enable_traversal_policy: Se True, usa TraversalPolicy neurale
        enable_gating_policy: Se True, usa GatingPolicy neurale
        device: Device per inference (cuda/mps/cpu, auto se None)
        weight_threshold: Soglia minima peso per includere relazione
        fallback_to_static: Se True, fallback a pesi statici su errore
        cache_embeddings: Se True, cache query embeddings
    """
    checkpoint_dir: Path = field(default_factory=lambda: Path("checkpoints"))
    enable_traversal_policy: bool = True
    enable_gating_policy: bool = True
    device: Optional[str] = None
    weight_threshold: float = 0.3
    fallback_to_static: bool = True
    cache_embeddings: bool = True


class PolicyManager:
    """
    Manager centrale per TraversalPolicy e GatingPolicy.

    Gestisce:
    - Lazy loading delle policy da checkpoint
    - Fallback graceful a pesi statici
    - Device management (CPU/GPU/MPS)
    - ExecutionTrace logging per REINFORCE

    Attributes:
        config: PolicyConfig con settings
        traversal_policy: TraversalPolicy (lazy loaded)
        gating_policy: GatingPolicy (lazy loaded)
    """

    def __init__(
        self,
        config: Optional[PolicyConfig] = None,
        checkpoint_dir: Optional[Path] = None,
        device: Optional[str] = None,
        enable_policy: bool = True
    ):
        """
        Inizializza PolicyManager.

        Args:
            config: PolicyConfig (sovrascrive altri params)
            checkpoint_dir: Directory con checkpoint policy
            device: Device per inference (auto-detect se None)
            enable_policy: Se False, usa sempre pesi statici (A/B testing)
        """
        if config:
            self.config = config
        else:
            self.config = PolicyConfig(
                checkpoint_dir=checkpoint_dir or Path("checkpoints"),
                device=device,
                enable_traversal_policy=enable_policy,
                enable_gating_policy=enable_policy
            )

        # Lazy-loaded policies
        self._traversal_policy: Optional["TraversalPolicy"] = None
        self._gating_policy: Optional["ExpertGatingMLP"] = None
        self._traversal_loaded = False
        self._gating_loaded = False
        # Loop β E.3: tool-gating policy (lazy-loaded).
        self._tool_policy: Optional[Any] = None
        self._tool_loaded = False
        self._load_lock = threading.Lock()

        # Device detection
        self._device: Optional[str] = self.config.device

        # Static fallback weights
        self.static_weights = DEFAULT_TRAVERSAL_WEIGHTS

        # Cache per embeddings
        self._embedding_cache: Dict[str, List[float]] = {}

        log.info(
            "PolicyManager initialized",
            checkpoint_dir=str(self.config.checkpoint_dir),
            enable_traversal=self.config.enable_traversal_policy,
            enable_gating=self.config.enable_gating_policy,
            device=self._device
        )

    def _detect_device(self) -> str:
        """
        Auto-detect best available device.

        Returns:
            Device string (cuda/mps/cpu)
        """
        if self._device:
            return self._device

        try:
            import torch
            if torch.cuda.is_available():
                self._device = "cuda"
            elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                self._device = "mps"
            else:
                self._device = "cpu"
        except ImportError:
            self._device = "cpu"

        return self._device

    def _load_traversal_policy(self) -> Optional["TraversalPolicy"]:
        """
        Load TraversalPolicy da checkpoint (lazy, thread-safe).

        Uses double-checked locking: fast path without lock, then full
        loading inside lock to prevent concurrent torch.load races.

        Returns:
            TraversalPolicy o None se non disponibile
        """
        if self._traversal_loaded:
            return self._traversal_policy

        with self._load_lock:
            if self._traversal_loaded:
                return self._traversal_policy

            if not self.config.enable_traversal_policy:
                log.info("TraversalPolicy disabled, using static weights")
                self._traversal_loaded = True
                return None

            checkpoint_path = self.config.checkpoint_dir / "traversal_policy_latest.pt"

            if not checkpoint_path.exists():
                log.info(
                    f"No TraversalPolicy checkpoint at {checkpoint_path}, "
                    "using static weights"
                )
                self._traversal_loaded = True
                return None

            try:
                from merlt.rlcf.policy_gradient import TraversalPolicy
                import torch

                device = self._detect_device()

                checkpoint = torch.load(
                    checkpoint_path, map_location=device, weights_only=True
                )

                policy = TraversalPolicy(
                    input_dim=checkpoint.get("input_dim", 1024),
                    relation_dim=checkpoint.get("relation_dim", 64),
                    hidden_dim=checkpoint.get("hidden_dim", 128),
                    device=device
                )

                # Slice 4 L3: route through the legacy-aware loader — old
                # checkpoints (no expert one-hot columns) are zero-init expanded
                # and produce identical outputs until retrained.
                policy.load_mlp_state_dict(checkpoint["mlp_state_dict"])
                policy.relation_embeddings.load_state_dict(
                    checkpoint["relation_embeddings_state_dict"]
                )

                policy.mlp.requires_grad_(False)
                policy.relation_embeddings.requires_grad_(False)

                self._traversal_policy = policy
                self._traversal_loaded = True
                log.info(
                    f"TraversalPolicy loaded from {checkpoint_path}",
                    device=device,
                )
                return policy

            except Exception as e:
                log.error(f"Failed to load TraversalPolicy: {e}")
                self._traversal_loaded = True
                return None

    def _load_gating_policy(self):
        """
        Load ExpertGatingMLP da checkpoint (lazy, thread-safe).

        Uses double-checked locking: fast path without lock, then full
        loading inside lock to prevent concurrent torch.load races.

        Fallback chain: model_state_dict → mlp_state_dict (backward compat).

        Returns:
            ExpertGatingMLP o None se non disponibile
        """
        if self._gating_loaded:
            return self._gating_policy

        with self._load_lock:
            if self._gating_loaded:
                return self._gating_policy

            if not self.config.enable_gating_policy:
                log.info("GatingPolicy disabled")
                self._gating_loaded = True
                return None

            checkpoint_path = self.config.checkpoint_dir / "gating_policy_latest.pt"

            if not checkpoint_path.exists():
                log.info(f"No GatingPolicy checkpoint at {checkpoint_path}")
                self._gating_loaded = True
                return None

            try:
                from merlt.experts.neural_gating.neural import ExpertGatingMLP, GatingConfig
                import torch

                device = self._detect_device()

                checkpoint = torch.load(
                    checkpoint_path, map_location=device, weights_only=True
                )

                config = GatingConfig(
                    input_dim=checkpoint.get("input_dim", 1024),
                )
                policy = ExpertGatingMLP(config)
                policy = policy.to(device)

                state_dict = checkpoint.get("model_state_dict")
                if state_dict is None:
                    raise KeyError(
                        "Checkpoint missing model_state_dict key. "
                        "Legacy mlp_state_dict (GatingPolicy) is not compatible with ExpertGatingMLP."
                    )

                policy.load_state_dict(state_dict)
                policy.requires_grad_(False)

                self._gating_policy = policy
                self._gating_loaded = True
                log.info(
                    f"ExpertGatingMLP loaded from {checkpoint_path}",
                    device=device,
                )
                return policy

            except Exception as e:
                log.error(f"Failed to load GatingPolicy: {e}")
                self._gating_loaded = True
                return None

    async def compute_relation_weight(
        self,
        query_embedding: List[float],
        relation_type: str,
        expert_type: str,
        trace: Optional["ExecutionTrace"] = None
    ) -> Tuple[float, float]:
        """
        Computa peso per una relazione usando policy (se disponibile).

        Args:
            query_embedding: Embedding della query [1024]
            relation_type: Tipo di relazione (es: "RIFERIMENTO")
            expert_type: Tipo di expert (es: "literal")
            trace: ExecutionTrace per registrare log_prob (opzionale)

        Returns:
            Tuple (weight, log_prob)
            - weight: Peso [0-1] per la relazione
            - log_prob: Log probability per REINFORCE (0.0 se static)
        """
        policy = self._load_traversal_policy()

        if policy is None:
            # Fallback a pesi statici
            weight = self._get_static_weight(expert_type, relation_type)
            return weight, 0.0

        try:
            import torch

            # Convert to tensor
            query_tensor = torch.tensor(
                [query_embedding],  # [1, 1024]
                dtype=torch.float32,
                device=policy.device
            )

            # Get relation index
            relation_idx = policy.get_relation_index(relation_type)
            relation_tensor = torch.tensor(
                [relation_idx],  # [1]
                dtype=torch.long,
                device=policy.device
            )

            # Slice 4 L3: expert conditioning (None → zero one-hot, legacy-equal)
            expert_idx = policy.get_expert_index(expert_type)
            expert_tensor = (
                torch.tensor([expert_idx], dtype=torch.long, device=policy.device)
                if expert_idx is not None else None
            )

            # Forward pass (inference mode)
            with torch.no_grad():
                weights, log_probs = policy.forward(
                    query_tensor, relation_tensor, expert_tensor
                )

            weight = float(weights[0, 0].cpu())
            log_prob = float(log_probs[0, 0].cpu())

            # Registra in trace se fornito
            if trace:
                trace.add_graph_traversal(
                    relation_type=relation_type,
                    weight=weight,
                    log_prob=log_prob,
                    metadata={
                        "expert_type": expert_type,
                        "source": "traversal_policy"
                    }
                )

            log.debug(
                "TraversalPolicy computed weight",
                relation=relation_type,
                weight=weight,
                log_prob=log_prob
            )

            return weight, log_prob

        except Exception as e:
            if self.config.fallback_to_static:
                log.warning(
                    f"TraversalPolicy failed, using static weight: {e}",
                    relation=relation_type
                )
                weight = self._get_static_weight(expert_type, relation_type)
                return weight, 0.0
            else:
                raise

    async def compute_batch_weights(
        self,
        query_embedding: List[float],
        relation_types: List[str],
        expert_type: str,
        trace: Optional["ExecutionTrace"] = None
    ) -> Dict[str, Tuple[float, float]]:
        """
        Computa pesi per batch di relazioni (piu' efficiente).

        Args:
            query_embedding: Embedding della query [1024]
            relation_types: Lista tipi relazione
            expert_type: Tipo di expert
            trace: ExecutionTrace per logging

        Returns:
            Dict[relation_type -> (weight, log_prob)]
        """
        if not relation_types:
            return {}

        policy = self._load_traversal_policy()

        if policy is None:
            # Fallback statico
            return {
                rel: (self._get_static_weight(expert_type, rel), 0.0)
                for rel in relation_types
            }

        try:
            import torch

            # Batch tensors
            batch_size = len(relation_types)
            query_batch = torch.tensor(
                [query_embedding] * batch_size,  # [batch, 1024]
                dtype=torch.float32,
                device=policy.device
            )

            relation_indices = torch.tensor(
                [policy.get_relation_index(r) for r in relation_types],  # [batch]
                dtype=torch.long,
                device=policy.device
            )

            # Slice 4 L3: expert conditioning (None → zero one-hot, legacy-equal)
            expert_idx = policy.get_expert_index(expert_type)
            expert_indices = (
                torch.tensor([expert_idx] * batch_size, dtype=torch.long, device=policy.device)
                if expert_idx is not None else None
            )

            # Forward pass (inference mode)
            with torch.no_grad():
                weights, log_probs = policy.forward(
                    query_batch, relation_indices, expert_indices
                )

            # Extract results
            results = {}
            for i, rel_type in enumerate(relation_types):
                weight = float(weights[i, 0].cpu())
                log_prob = float(log_probs[i, 0].cpu())
                results[rel_type] = (weight, log_prob)

                # Registra in trace
                if trace:
                    trace.add_graph_traversal(
                        relation_type=rel_type,
                        weight=weight,
                        log_prob=log_prob,
                        metadata={
                            "expert_type": expert_type,
                            "source": "traversal_policy_batch",
                            "batch_index": i
                        }
                    )

            log.debug(
                "TraversalPolicy batch computed",
                num_relations=batch_size,
                expert_type=expert_type
            )

            return results

        except Exception as e:
            if self.config.fallback_to_static:
                log.warning(f"Batch weight computation failed: {e}")
                return {
                    rel: (self._get_static_weight(expert_type, rel), 0.0)
                    for rel in relation_types
                }
            else:
                raise

    async def filter_relations_by_weight(
        self,
        query_embedding: List[float],
        relation_types: List[str],
        expert_type: str,
        threshold: Optional[float] = None,
        trace: Optional["ExecutionTrace"] = None
    ) -> List[str]:
        """
        Filtra relazioni mantenendo solo quelle con peso >= threshold.

        Args:
            query_embedding: Embedding della query
            relation_types: Lista relazioni candidate
            expert_type: Tipo expert
            threshold: Soglia minima (default: self.config.weight_threshold)
            trace: ExecutionTrace

        Returns:
            Lista relazioni filtrate ordinate per peso (decrescente)
        """
        if not relation_types:
            return []

        threshold = threshold or self.config.weight_threshold

        weights = await self.compute_batch_weights(
            query_embedding=query_embedding,
            relation_types=relation_types,
            expert_type=expert_type,
            trace=trace
        )

        # Filtra e ordina per peso
        filtered = [
            (rel, w, lp) for rel, (w, lp) in weights.items()
            if w >= threshold
        ]
        filtered.sort(key=lambda x: x[1], reverse=True)

        result = [rel for rel, w, lp in filtered]

        log.debug(
            "Relations filtered",
            input_count=len(relation_types),
            output_count=len(result),
            threshold=threshold
        )

        return result

    async def compute_expert_weights(
        self,
        query_embedding: List[float],
        trace: Optional["ExecutionTrace"] = None
    ) -> Optional[Dict[str, float]]:
        """
        Computa pesi expert usando GatingPolicy.

        Args:
            query_embedding: Embedding della query
            trace: ExecutionTrace per logging

        Returns:
            Dict[expert_type -> weight] o None se policy non disponibile
        """
        policy = self._load_gating_policy()

        if policy is None:
            return None

        try:
            import torch

            query_tensor = torch.tensor(
                [query_embedding],
                dtype=torch.float32,
                device=policy.device
            )

            with torch.no_grad():
                weights, log_probs = policy.forward(query_tensor)

            # Map to expert names
            expert_names = ["literal", "systemic", "principles", "precedent"]
            result = {}

            for i, expert in enumerate(expert_names):
                weight = float(weights[0, i].cpu())
                log_prob = float(log_probs[0, i].cpu())
                result[expert] = weight

                if trace:
                    trace.add_expert_selection(
                        expert_type=expert,
                        weight=weight,
                        log_prob=log_prob,
                        metadata={"source": "gating_policy"}
                    )

            return result

        except Exception as e:
            log.warning(f"GatingPolicy failed: {e}")
            return None

    def _get_static_weight(self, expert_type: str, relation_type: str) -> float:
        """
        Fallback a pesi statici da config.

        Args:
            expert_type: Tipo expert (literal, systemic, etc.)
            relation_type: Tipo relazione (RIFERIMENTO, etc.)

        Returns:
            Peso statico [0-1]
        """
        expert_weights = self.static_weights.get(expert_type, {})
        return expert_weights.get(relation_type, expert_weights.get("default", 0.5))

    def get_traversal_policy(self) -> Optional["TraversalPolicy"]:
        """Ottieni TraversalPolicy (lazy load)."""
        return self._load_traversal_policy()

    def get_gating_policy(self) -> Optional["ExpertGatingMLP"]:
        """Ottieni ExpertGatingMLP (lazy load)."""
        return self._load_gating_policy()

    def is_traversal_policy_available(self) -> bool:
        """Check se TraversalPolicy e' disponibile."""
        return self._load_traversal_policy() is not None

    def is_gating_policy_available(self) -> bool:
        """Check se GatingPolicy e' disponibile."""
        return self._load_gating_policy() is not None

    def reset_policies(self):
        """Reset policies (forza reload, thread-safe)."""
        with self._load_lock:
            self._traversal_policy = None
            self._gating_policy = None
            self._traversal_loaded = False
            self._gating_loaded = False
        log.info("Policies reset")

    def save_traversal_policy(self, policy: "TraversalPolicy", name: str = "latest"):
        """
        Salva TraversalPolicy su checkpoint.

        Args:
            policy: TraversalPolicy da salvare
            name: Nome checkpoint (default: latest)
        """
        import torch

        checkpoint_path = self.config.checkpoint_dir / f"traversal_policy_{name}.pt"
        self.config.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        checkpoint = {
            "input_dim": policy.input_dim,
            "relation_dim": policy.relation_dim,
            "hidden_dim": policy.hidden_dim,
            "mlp_state_dict": policy.mlp.state_dict(),
            "relation_embeddings_state_dict": policy.relation_embeddings.state_dict(),
            "relation_types": policy.relation_types,
            # Slice 4 L3 (provenance, additive): expert one-hot vocabulary.
            "expert_types": getattr(policy, "expert_types", None),
        }

        torch.save(checkpoint, checkpoint_path)
        log.info(f"TraversalPolicy saved to {checkpoint_path}")

        # Reset per forzare reload
        with self._load_lock:
            self._traversal_policy = None
            self._traversal_loaded = False

    # ------------------------------------------------------------------
    # Loop β E.3 — tool-gating policy (mirror of the traversal methods)
    # ------------------------------------------------------------------
    def _load_tool_policy(self):
        """Load ToolGatingMLP from checkpoint (lazy, thread-safe). None if absent."""
        if self._tool_loaded:
            return self._tool_policy
        with self._load_lock:
            if self._tool_loaded:
                return self._tool_policy
            checkpoint_path = self.config.checkpoint_dir / "tool_policy_latest.pt"
            if not checkpoint_path.exists():
                log.info(f"No ToolGatingMLP checkpoint at {checkpoint_path}, using warm-start")
                self._tool_loaded = True
                return None
            try:
                from merlt.experts.neural_gating.tool_neural import ToolGatingMLP, ToolGatingConfig
                import torch

                device = self._detect_device()
                checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
                policy = ToolGatingMLP(ToolGatingConfig(input_dim=checkpoint.get("input_dim", 1024)))
                policy = policy.to(device)
                policy.load_state_dict(checkpoint["model_state_dict"])
                policy.requires_grad_(False)
                policy.eval()
                self._tool_policy = policy
                self._tool_loaded = True
                log.info(f"ToolGatingMLP loaded from {checkpoint_path}")
                return policy
            except Exception as e:
                log.warning(f"Failed to load ToolGatingMLP: {e}")
                self._tool_loaded = True
                return None

    def get_tool_policy(self):
        """Ottieni ToolGatingMLP (lazy load). None se nessun checkpoint."""
        return self._load_tool_policy()

    def save_tool_policy(self, policy, name: str = "latest"):
        """Salva ToolGatingMLP su checkpoint (formato inference: model_state_dict)."""
        import torch

        checkpoint_path = self.config.checkpoint_dir / f"tool_policy_{name}.pt"
        self.config.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        checkpoint = {
            "input_dim": getattr(getattr(policy, "config", None), "input_dim", 1024),
            "model_state_dict": policy.state_dict(),
        }
        torch.save(checkpoint, checkpoint_path)
        log.info(f"ToolGatingMLP saved to {checkpoint_path}")
        with self._load_lock:
            self._tool_policy = None
            self._tool_loaded = False

    def save_gating_policy(self, policy, name: str = "latest"):
        """
        Salva GatingPolicy/ExpertGatingMLP su checkpoint.

        Args:
            policy: ExpertGatingMLP (nn.Module) o legacy GatingPolicy
            name: Nome checkpoint (default: latest)
        """
        import torch

        checkpoint_path = self.config.checkpoint_dir / f"gating_policy_{name}.pt"
        self.config.checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # ExpertGatingMLP (nn.Module) vs legacy GatingPolicy
        if isinstance(policy, torch.nn.Module):
            checkpoint = {
                "input_dim": getattr(getattr(policy, 'config', None), 'input_dim', 1024),
                "model_state_dict": policy.state_dict(),
            }
        else:
            checkpoint = {
                "input_dim": policy.input_dim,
                "hidden_dim": policy.hidden_dim,
                "num_experts": policy.num_experts,
                "mlp_state_dict": policy.mlp.state_dict(),
            }

        torch.save(checkpoint, checkpoint_path)
        log.info(f"GatingPolicy saved to {checkpoint_path}")

        # Reset per forzare reload
        with self._load_lock:
            self._gating_policy = None
            self._gating_loaded = False


# Singleton instance
_policy_manager: Optional[PolicyManager] = None
_pm_lock = threading.Lock()


def get_policy_manager(
    config: Optional[PolicyConfig] = None,
    **kwargs
) -> PolicyManager:
    """
    Ottieni PolicyManager singleton (thread-safe).

    Args:
        config: PolicyConfig (usato solo alla prima chiamata)
        **kwargs: Passati a PolicyManager se config non specificato

    Returns:
        PolicyManager singleton
    """
    global _policy_manager

    with _pm_lock:
        if _policy_manager is None:
            _policy_manager = PolicyManager(config=config, **kwargs)
        return _policy_manager


def reset_policy_manager():
    """Reset PolicyManager singleton (thread-safe)."""
    global _policy_manager
    with _pm_lock:
        _policy_manager = None
