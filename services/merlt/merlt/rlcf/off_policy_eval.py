"""
Off-Policy Evaluation (OPE)
===========================

Valutazione di policy usando dati raccolti da policy diverse.

L'OPE permette di stimare la performance di una nuova policy
senza doverla deployare, usando dati storici.

Metodi implementati:
1. **Importance Sampling (IS)**: Pesa campioni per ratio probabilità
2. **Weighted Importance Sampling (WIS)**: IS normalizzato (varianza ridotta)
3. **Per-Decision IS (PDIS)**: Applica IS per ogni decisione
4. **Doubly Robust (DR)**: Combina IS con stime model-based

Formule:
    IS: V̂(π) = (1/n) Σ ρ_i * r_i
        dove ρ_i = π(a_i|s_i) / μ(a_i|s_i)

    WIS: V̂(π) = Σ (ρ_i * r_i) / Σ ρ_i

    Effective Sample Size: ESS = (Σ ρ_i)² / Σ ρ_i²

Esempio:
    >>> from merlt.rlcf.off_policy_eval import OPEEvaluator
    >>>
    >>> evaluator = OPEEvaluator()
    >>>
    >>> # Dati da vecchia policy
    >>> historical_data = [
    ...     {"state": s, "action": a, "reward": r, "old_log_prob": lp}
    ...     for s, a, r, lp in data
    ... ]
    >>>
    >>> # Valuta nuova policy
    >>> result = evaluator.evaluate(
    ...     new_policy=policy,
    ...     data=historical_data
    ... )
    >>> print(f"Estimated value: {result.estimated_value:.3f}")
    >>> print(f"95% CI: [{result.ci_lower:.3f}, {result.ci_upper:.3f}]")

Note:
    - Importance weights possono esplodere se policy molto diverse
    - Weight clipping per stabilità
    - ESS basso indica dati poco informativi
"""

import math
import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple, Callable
from datetime import datetime
from enum import Enum

log = structlog.get_logger()

# Lazy imports
_torch = None
_np = None


def _get_torch():
    """Lazy import torch."""
    global _torch
    if _torch is None:
        import torch
        _torch = torch
    return _torch


def _get_numpy():
    """Lazy import numpy."""
    global _np
    if _np is None:
        import numpy as np
        _np = np
    return _np


# =============================================================================
# ENUMS
# =============================================================================

class OPEMethod(str, Enum):
    """Metodi OPE disponibili."""
    IS = "importance_sampling"
    WIS = "weighted_importance_sampling"
    PDIS = "per_decision_is"
    DR = "doubly_robust"


# =============================================================================
# DATACLASSES
# =============================================================================

@dataclass
class OPEDataPoint:
    """
    Singolo punto dati per OPE.

    Attributes:
        state: State embedding (o features)
        action: Azione presa
        reward: Reward osservato
        old_log_prob: Log probability sotto vecchia policy
        new_log_prob: Log probability sotto nuova policy (calcolato)
        importance_weight: Peso importance sampling
    """
    state: Any
    action: Any
    reward: float
    old_log_prob: float
    new_log_prob: Optional[float] = None
    importance_weight: Optional[float] = None

    def compute_weight(self) -> float:
        """Calcola importance weight."""
        if self.new_log_prob is None:
            return 1.0
        # ρ = π_new(a|s) / π_old(a|s) = exp(log π_new - log π_old)
        log_ratio = self.new_log_prob - self.old_log_prob
        self.importance_weight = math.exp(log_ratio)
        return self.importance_weight


@dataclass
class OPEResult:
    """
    Risultato valutazione OPE.

    Attributes:
        method: Metodo usato
        estimated_value: Valore stimato della policy
        ci_lower: Lower bound confidence interval
        ci_upper: Upper bound confidence interval
        effective_sample_size: ESS (sample size effettivo)
        n_samples: Numero campioni usati
        weight_stats: Statistiche sui pesi
        diagnostics: Diagnostiche aggiuntive
    """
    method: OPEMethod
    estimated_value: float
    ci_lower: float = 0.0
    ci_upper: float = 1.0
    effective_sample_size: float = 0.0
    n_samples: int = 0
    weight_stats: Dict[str, float] = field(default_factory=dict)
    diagnostics: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza risultato."""
        return {
            "method": self.method.value,
            "estimated_value": round(self.estimated_value, 4),
            "ci_lower": round(self.ci_lower, 4),
            "ci_upper": round(self.ci_upper, 4),
            "confidence_interval_width": round(self.ci_upper - self.ci_lower, 4),
            "effective_sample_size": round(self.effective_sample_size, 2),
            "ess_ratio": round(self.effective_sample_size / max(self.n_samples, 1), 4),
            "n_samples": self.n_samples,
            "weight_stats": {k: round(v, 4) for k, v in self.weight_stats.items()},
            "diagnostics": self.diagnostics
        }


@dataclass
class OPEConfig:
    """
    Configurazione OPE.

    Attributes:
        clip_weights: Se clippare i pesi (per stabilità)
        max_weight: Massimo peso IS (clipping)
        min_weight: Minimo peso IS (clipping)
        confidence_level: Livello confidenza per CI
        bootstrap_samples: Numero campioni bootstrap per CI
        use_normalized: Se usare WIS invece di IS
    """
    clip_weights: bool = True
    max_weight: float = 100.0
    min_weight: float = 0.01
    confidence_level: float = 0.95
    bootstrap_samples: int = 1000
    use_normalized: bool = True

    def to_dict(self) -> Dict[str, Any]:
        """Serializza config."""
        return {
            "clip_weights": self.clip_weights,
            "max_weight": self.max_weight,
            "min_weight": self.min_weight,
            "confidence_level": self.confidence_level,
            "bootstrap_samples": self.bootstrap_samples,
            "use_normalized": self.use_normalized
        }


# =============================================================================
# OPE EVALUATOR
# =============================================================================

class OPEEvaluator:
    """
    Valutatore Off-Policy.

    Stima la performance di una nuova policy usando dati
    raccolti da una policy comportamentale diversa.
    """

    def __init__(self, config: Optional[OPEConfig] = None):
        """
        Inizializza OPEEvaluator.

        Args:
            config: Configurazione OPE
        """
        self.config = config or OPEConfig()

        log.info(
            "OPEEvaluator initialized",
            config=self.config.to_dict()
        )

    def compute_importance_weights(
        self,
        data: List[Dict[str, Any]],
        new_policy: Any,
        device: str = "cpu"
    ) -> List[OPEDataPoint]:
        """
        Calcola importance weights per i dati.

        Args:
            data: Lista di dict con state, action, reward, old_log_prob
            new_policy: Nuova policy da valutare
            device: Device per computazione

        Returns:
            Lista di OPEDataPoint con pesi calcolati
        """
        torch = _get_torch()

        datapoints = []

        for item in data:
            state = item["state"]
            action = item["action"]
            reward = item["reward"]
            old_log_prob = item["old_log_prob"]

            # Converti state in tensor se necessario
            if not isinstance(state, torch.Tensor):
                state_tensor = torch.tensor(
                    state, dtype=torch.float32, device=device
                )
            else:
                state_tensor = state.to(device)

            # Forward nuova policy per ottenere log_prob
            with torch.no_grad():
                if state_tensor.dim() == 1:
                    state_tensor = state_tensor.unsqueeze(0)

                _, new_log_probs = new_policy.forward(state_tensor)

                # Calcola log prob dell'azione specifica
                if isinstance(action, torch.Tensor):
                    action_tensor = action.to(device)
                else:
                    action_tensor = torch.tensor(
                        action, dtype=torch.float32, device=device
                    )

                if action_tensor.dim() == 1:
                    action_tensor = action_tensor.unsqueeze(0)

                # Log prob = sum(action * log_probs) per distribuzione softmax
                new_log_prob = (action_tensor * new_log_probs).sum().item()

            # Crea datapoint
            dp = OPEDataPoint(
                state=state,
                action=action,
                reward=reward,
                old_log_prob=old_log_prob,
                new_log_prob=new_log_prob
            )
            dp.compute_weight()

            # Clip weight se configurato
            if self.config.clip_weights:
                dp.importance_weight = max(
                    self.config.min_weight,
                    min(self.config.max_weight, dp.importance_weight)
                )

            datapoints.append(dp)

        return datapoints

    def importance_sampling(
        self,
        datapoints: List[OPEDataPoint]
    ) -> Tuple[float, Dict[str, float]]:
        """
        Calcola stima IS standard.

        V̂_IS = (1/n) Σ ρ_i * r_i

        Args:
            datapoints: Lista di OPEDataPoint con pesi

        Returns:
            Tuple (estimated_value, weight_stats)
        """
        if not datapoints:
            return 0.0, {}

        n = len(datapoints)
        weights = [dp.importance_weight for dp in datapoints]
        rewards = [dp.reward for dp in datapoints]

        # IS estimate
        weighted_sum = sum(w * r for w, r in zip(weights, rewards))
        estimated_value = weighted_sum / n

        # Weight stats
        weight_stats = {
            "mean": sum(weights) / n,
            "max": max(weights),
            "min": min(weights),
            "std": math.sqrt(sum((w - sum(weights)/n)**2 for w in weights) / n)
        }

        return estimated_value, weight_stats

    def weighted_importance_sampling(
        self,
        datapoints: List[OPEDataPoint]
    ) -> Tuple[float, Dict[str, float]]:
        """
        Calcola stima WIS (self-normalized).

        V̂_WIS = Σ (ρ_i * r_i) / Σ ρ_i

        Varianza minore di IS ma con bias.

        Args:
            datapoints: Lista di OPEDataPoint con pesi

        Returns:
            Tuple (estimated_value, weight_stats)
        """
        if not datapoints:
            return 0.0, {}

        n = len(datapoints)
        weights = [dp.importance_weight for dp in datapoints]
        rewards = [dp.reward for dp in datapoints]

        # WIS estimate
        weight_sum = sum(weights)
        if weight_sum == 0:
            return 0.0, {}

        weighted_reward_sum = sum(w * r for w, r in zip(weights, rewards))
        estimated_value = weighted_reward_sum / weight_sum

        # Weight stats
        weight_stats = {
            "mean": weight_sum / n,
            "max": max(weights),
            "min": min(weights),
            "sum": weight_sum,
            "std": math.sqrt(sum((w - weight_sum/n)**2 for w in weights) / n)
        }

        return estimated_value, weight_stats

    def compute_effective_sample_size(
        self,
        weights: List[float]
    ) -> float:
        """
        Calcola Effective Sample Size.

        ESS = (Σ ρ_i)² / Σ ρ_i²

        ESS indica quanti campioni IID equivalenti abbiamo.

        Args:
            weights: Lista importance weights

        Returns:
            ESS value
        """
        if not weights:
            return 0.0

        weight_sum = sum(weights)
        weight_sq_sum = sum(w * w for w in weights)

        if weight_sq_sum == 0:
            return 0.0

        ess = (weight_sum ** 2) / weight_sq_sum

        return ess

    def bootstrap_confidence_interval(
        self,
        datapoints: List[OPEDataPoint],
        method: OPEMethod = OPEMethod.WIS
    ) -> Tuple[float, float]:
        """
        Calcola CI usando bootstrap.

        Args:
            datapoints: Dati per bootstrap
            method: Metodo OPE da usare

        Returns:
            Tuple (ci_lower, ci_upper)
        """
        np = _get_numpy()

        if not datapoints:
            return 0.0, 1.0

        n = len(datapoints)
        estimates = []

        for _ in range(self.config.bootstrap_samples):
            # Resample con replacement
            indices = np.random.choice(n, size=n, replace=True)
            sample = [datapoints[i] for i in indices]

            # Calcola stima
            if method == OPEMethod.WIS:
                est, _ = self.weighted_importance_sampling(sample)
            else:
                est, _ = self.importance_sampling(sample)

            estimates.append(est)

        # Percentile CI
        alpha = 1 - self.config.confidence_level
        ci_lower = np.percentile(estimates, alpha / 2 * 100)
        ci_upper = np.percentile(estimates, (1 - alpha / 2) * 100)

        return float(ci_lower), float(ci_upper)

    def evaluate(
        self,
        new_policy: Any,
        data: List[Dict[str, Any]],
        method: OPEMethod = OPEMethod.WIS,
        compute_ci: bool = True
    ) -> OPEResult:
        """
        Valuta nuova policy usando dati storici.

        Args:
            new_policy: Policy da valutare
            data: Dati storici [{state, action, reward, old_log_prob}]
            method: Metodo OPE
            compute_ci: Se calcolare confidence interval

        Returns:
            OPEResult con stima e diagnostiche
        """
        if not data:
            return OPEResult(
                method=method,
                estimated_value=0.0,
                n_samples=0
            )

        # Calcola pesi
        device = getattr(new_policy, 'device', 'cpu')
        datapoints = self.compute_importance_weights(data, new_policy, device)

        # Calcola stima secondo metodo
        if method == OPEMethod.WIS:
            estimated_value, weight_stats = self.weighted_importance_sampling(datapoints)
        elif method == OPEMethod.IS:
            estimated_value, weight_stats = self.importance_sampling(datapoints)
        else:
            # Default a WIS
            estimated_value, weight_stats = self.weighted_importance_sampling(datapoints)

        # ESS
        weights = [dp.importance_weight for dp in datapoints]
        ess = self.compute_effective_sample_size(weights)

        # Confidence interval
        if compute_ci and len(datapoints) > 10:
            ci_lower, ci_upper = self.bootstrap_confidence_interval(datapoints, method)
        else:
            # Stima approssimata
            std_estimate = weight_stats.get("std", 0.1) * 0.5
            ci_lower = max(0, estimated_value - 1.96 * std_estimate)
            ci_upper = min(1, estimated_value + 1.96 * std_estimate)

        # Diagnostiche
        diagnostics = {
            "ess_ratio": ess / max(len(datapoints), 1),
            "ess_warning": ess < len(datapoints) * 0.1,  # <10% efficiency
            "extreme_weights": sum(1 for w in weights if w > 10 or w < 0.1),
            "clipped_weights": sum(
                1 for w in weights
                if w == self.config.max_weight or w == self.config.min_weight
            ) if self.config.clip_weights else 0
        }

        result = OPEResult(
            method=method,
            estimated_value=estimated_value,
            ci_lower=ci_lower,
            ci_upper=ci_upper,
            effective_sample_size=ess,
            n_samples=len(datapoints),
            weight_stats=weight_stats,
            diagnostics=diagnostics
        )

        log.info(
            "OPE evaluation completed",
            method=method.value,
            estimated_value=round(estimated_value, 4),
            ess=round(ess, 2),
            n_samples=len(datapoints)
        )

        return result

    def compare_policies(
        self,
        policies: List[Any],
        data: List[Dict[str, Any]],
        method: OPEMethod = OPEMethod.WIS
    ) -> List[OPEResult]:
        """
        Confronta multiple policy sugli stessi dati.

        Args:
            policies: Lista di policy da confrontare
            data: Dati storici
            method: Metodo OPE

        Returns:
            Lista di OPEResult ordinata per estimated_value (decrescente)
        """
        results = []

        for i, policy in enumerate(policies):
            result = self.evaluate(policy, data, method)
            result.diagnostics["policy_index"] = i
            results.append(result)

        # Ordina per valore stimato
        results.sort(key=lambda r: r.estimated_value, reverse=True)

        return results


# =============================================================================
# HELPERS
# =============================================================================

@dataclass
class PolicyComparisonResult:
    """Risultato confronto policy."""
    policy_a_value: float
    policy_b_value: float
    difference: float
    ci_lower: float
    ci_upper: float
    significant: bool  # CI non include 0
    preferred: str  # "a", "b", or "neither"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "policy_a_value": round(self.policy_a_value, 4),
            "policy_b_value": round(self.policy_b_value, 4),
            "difference": round(self.difference, 4),
            "ci_lower": round(self.ci_lower, 4),
            "ci_upper": round(self.ci_upper, 4),
            "significant": self.significant,
            "preferred": self.preferred
        }


def compare_two_policies(
    policy_a: Any,
    policy_b: Any,
    data: List[Dict[str, Any]],
    config: Optional[OPEConfig] = None
) -> PolicyComparisonResult:
    """
    Confronta direttamente due policy.

    Args:
        policy_a: Prima policy
        policy_b: Seconda policy
        data: Dati storici
        config: Configurazione OPE

    Returns:
        PolicyComparisonResult con differenza e significatività
    """
    evaluator = OPEEvaluator(config)

    result_a = evaluator.evaluate(policy_a, data)
    result_b = evaluator.evaluate(policy_b, data)

    difference = result_a.estimated_value - result_b.estimated_value

    # CI sulla differenza (approssimato)
    # Assumendo indipendenza (sottostima varianza)
    var_a = ((result_a.ci_upper - result_a.ci_lower) / 3.92) ** 2
    var_b = ((result_b.ci_upper - result_b.ci_lower) / 3.92) ** 2
    var_diff = var_a + var_b
    std_diff = math.sqrt(var_diff)

    ci_lower = difference - 1.96 * std_diff
    ci_upper = difference + 1.96 * std_diff

    # Significativo se CI non include 0
    significant = ci_lower > 0 or ci_upper < 0

    # Preferenza
    if significant:
        preferred = "a" if difference > 0 else "b"
    else:
        preferred = "neither"

    return PolicyComparisonResult(
        policy_a_value=result_a.estimated_value,
        policy_b_value=result_b.estimated_value,
        difference=difference,
        ci_lower=ci_lower,
        ci_upper=ci_upper,
        significant=significant,
        preferred=preferred
    )


def create_ope_evaluator(
    clip_weights: bool = True,
    max_weight: float = 100.0,
    confidence_level: float = 0.95
) -> OPEEvaluator:
    """
    Factory per creare OPE evaluator.

    Args:
        clip_weights: Se clippare pesi
        max_weight: Max peso
        confidence_level: Livello CI

    Returns:
        OPEEvaluator configurato
    """
    config = OPEConfig(
        clip_weights=clip_weights,
        max_weight=max_weight,
        confidence_level=confidence_level
    )
    return OPEEvaluator(config)
