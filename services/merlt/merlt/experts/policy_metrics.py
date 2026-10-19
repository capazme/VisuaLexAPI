"""
Policy Metrics Tracking
========================

Modulo per tracciare metriche dettagliate del sistema di routing policy-based.

Il PolicyMetricsTracker monitora:
1. Distribuzione uso tra Expert (load balancing)
2. Performance del routing neurale vs regex fallback
3. Evolution dei pesi nel tempo
4. Correlazione tra confidenza e reward
5. Detection di expert collapse

Usato per:
- Debugging del routing
- Ottimizzazione policy
- RLCF feedback loop analysis
- Dashboard di monitoring

Esempio:
    >>> tracker = PolicyMetricsTracker(window_size=1000)
    >>>
    >>> # Durante routing
    >>> tracker.record_routing(
    ...     expert_weights={"literal": 0.5, "systemic": 0.3},
    ...     confidence=0.8,
    ...     is_neural=True
    ... )
    >>>
    >>> # Dopo feedback utente
    >>> tracker.record_feedback(reward=0.9)
    >>>
    >>> # Export metriche
    >>> metrics = tracker.get_metrics()
    >>> print(metrics.expert_load_balance)
    0.12  # Basso = ben bilanciato
"""

import structlog
import json
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from collections import deque, Counter
import math

log = structlog.get_logger()


@dataclass
class RoutingMetrics:
    """
    Metriche aggregate del sistema di routing.

    Attributes:
        expert_usage_rate: Percentuale uso per expert (es. {"literal": 0.35, ...})
        expert_load_balance: Deviazione standard uso (0=perfettamente bilanciato)
        avg_confidence: Confidenza media del routing
        neural_vs_fallback_rate: % routing neurale vs regex fallback
        avg_reward: Reward medio da feedback utente
        baseline_value: Baseline corrente per normalizzazione reward
        entropy: Entropy distribuzione pesi (alta = più diversità)
        num_queries: Totale query processate
        timestamp: Timestamp creazione metriche
    """
    expert_usage_rate: Dict[str, float] = field(default_factory=dict)
    expert_load_balance: float = 0.0
    avg_confidence: float = 0.0
    neural_vs_fallback_rate: float = 0.0
    avg_reward: float = 0.0
    baseline_value: float = 0.0
    entropy: float = 0.0
    num_queries: int = 0
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return asdict(self)


class PolicyMetricsTracker:
    """
    Tracker per metriche del sistema di routing policy-based.

    Mantiene una sliding window delle ultime N query per calcolare
    metriche aggregate e rilevare anomalie.

    Attributes:
        window_size: Dimensione finestra sliding (default: 1000 query)

    Esempio:
        >>> tracker = PolicyMetricsTracker(window_size=500)
        >>>
        >>> for query in queries:
        ...     decision = router.route(query)
        ...     tracker.record_routing(
        ...         expert_weights=decision.expert_weights,
        ...         confidence=decision.confidence,
        ...         is_neural=decision.is_neural
        ...     )
        ...     response = orchestrator.process(query)
        ...     tracker.record_feedback(reward=user_rating)
        >>>
        >>> # Check bilanciamento
        >>> if tracker.check_expert_collapse():
        ...     print("WARNING: Expert collapse detected!")
        >>>
        >>> # Export per dashboard
        >>> tracker.export_json("metrics/routing_metrics.json")
    """

    def __init__(self, window_size: int = 1000):
        """
        Inizializza il tracker.

        Args:
            window_size: Numero di query nella sliding window
        """
        self.window_size = window_size

        # Sliding windows (FIFO deques)
        self._expert_usage: deque = deque(maxlen=window_size)  # List[str] - expert selezionati
        self._confidences: deque = deque(maxlen=window_size)   # List[float]
        self._is_neural: deque = deque(maxlen=window_size)     # List[bool] - neural vs fallback
        self._rewards: deque = deque(maxlen=window_size)       # List[float]
        self._weight_snapshots: deque = deque(maxlen=window_size)  # List[Dict[str, float]]

        # Baseline per reward normalization (moving average)
        self._baseline = 0.5

        # Expert disponibili (inferiti dai primi routing)
        self._expert_types: set = set()

        log.info("PolicyMetricsTracker initialized", window_size=window_size)

    def record_routing(
        self,
        expert_weights: Dict[str, float],
        confidence: float,
        is_neural: bool = True,
        selected_expert: Optional[str] = None
    ) -> None:
        """
        Registra una decisione di routing.

        Args:
            expert_weights: Pesi assegnati agli expert
            confidence: Confidenza del routing
            is_neural: True se neural router, False se regex fallback
            selected_expert: Expert effettivamente selezionato (opzionale)
        """
        # Update expert types
        self._expert_types.update(expert_weights.keys())

        # Record data
        self._confidences.append(confidence)
        self._is_neural.append(is_neural)
        self._weight_snapshots.append(expert_weights.copy())

        # Track top expert (più pesato)
        if selected_expert:
            top_expert = selected_expert
        else:
            top_expert = max(expert_weights.items(), key=lambda x: x[1])[0]

        self._expert_usage.append(top_expert)

        log.debug(
            "Routing recorded",
            expert=top_expert,
            confidence=confidence,
            neural=is_neural
        )

    def record_feedback(self, reward: float) -> None:
        """
        Registra feedback utente (reward).

        Args:
            reward: Reward normalizzato [0-1] (0=pessimo, 1=eccellente)
        """
        if not 0.0 <= reward <= 1.0:
            log.warning(f"Reward {reward} fuori range [0,1] - clipping")
            reward = max(0.0, min(1.0, reward))

        self._rewards.append(reward)

        # Update baseline (EMA con alpha=0.1)
        alpha = 0.1
        self._baseline = alpha * reward + (1 - alpha) * self._baseline

        log.debug("Feedback recorded", reward=reward, baseline=self._baseline)

    def get_metrics(self) -> RoutingMetrics:
        """
        Calcola metriche aggregate correnti.

        Returns:
            RoutingMetrics con statistiche aggregate
        """
        if not self._expert_usage:
            return RoutingMetrics()

        # 1. Expert usage rates
        usage_counts = Counter(self._expert_usage)
        total = len(self._expert_usage)
        usage_rate = {
            exp: count / total
            for exp, count in usage_counts.items()
        }

        # Aggiungi expert mai usati (0%)
        for exp in self._expert_types:
            if exp not in usage_rate:
                usage_rate[exp] = 0.0

        # 2. Load balance (std dev)
        load_balance = compute_load_balance(usage_counts)

        # 3. Average confidence
        avg_confidence = sum(self._confidences) / len(self._confidences)

        # 4. Neural vs fallback rate
        if self._is_neural:
            neural_rate = sum(self._is_neural) / len(self._is_neural)
        else:
            neural_rate = 0.0

        # 5. Average reward
        if self._rewards:
            avg_reward = sum(self._rewards) / len(self._rewards)
        else:
            avg_reward = 0.0

        # 6. Entropy distribuzione pesi
        if self._weight_snapshots:
            # Usa ultimo snapshot
            last_weights = self._weight_snapshots[-1]
            entropy = self.compute_entropy(last_weights)
        else:
            entropy = 0.0

        return RoutingMetrics(
            expert_usage_rate=usage_rate,
            expert_load_balance=load_balance,
            avg_confidence=avg_confidence,
            neural_vs_fallback_rate=neural_rate,
            avg_reward=avg_reward,
            baseline_value=self._baseline,
            entropy=entropy,
            num_queries=total
        )

    def compute_entropy(self, weights: Dict[str, float]) -> float:
        """
        Calcola entropy della distribuzione pesi.

        Entropy alta = distribuzione più uniforme (più diversità)
        Entropy bassa = concentrazione su pochi expert

        Args:
            weights: Dict expert -> peso

        Returns:
            Entropy in [0, log2(N)] dove N = numero expert
        """
        if not weights:
            return 0.0

        # Normalizza pesi
        total = sum(weights.values())
        if total == 0:
            return 0.0

        probs = [w / total for w in weights.values()]

        # Shannon entropy: H = -Σ p_i * log2(p_i)
        entropy = 0.0
        for p in probs:
            if p > 0:
                entropy -= p * math.log2(p)

        return entropy

    def check_expert_collapse(
        self,
        threshold: float = 0.7,
        min_samples: int = 100
    ) -> bool:
        """
        Rileva se c'è expert collapse (un expert domina troppo).

        Expert collapse = un singolo expert viene usato >70% del tempo.
        Indica che il routing è degenerato.

        Args:
            threshold: Soglia di dominanza (default: 0.7 = 70%)
            min_samples: Minimo sample per detection affidabile

        Returns:
            True se c'è collapse, False altrimenti
        """
        if len(self._expert_usage) < min_samples:
            return False

        usage_counts = Counter(self._expert_usage)
        total = len(self._expert_usage)

        # Check se qualche expert > threshold
        for count in usage_counts.values():
            if count / total > threshold:
                log.warning(
                    "Expert collapse detected",
                    dominant_usage=count / total,
                    threshold=threshold
                )
                return True

        return False

    def export_json(self, path: str) -> None:
        """
        Esporta metriche in JSON file.

        Args:
            path: Path del file JSON
        """
        metrics = self.get_metrics()

        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(metrics.to_dict(), f, indent=2, ensure_ascii=False)

        log.info(f"Metrics exported to {path}")

    def get_time_series(
        self,
        metric: str = "confidence",
        window: int = 100
    ) -> List[float]:
        """
        Ottiene serie temporale di una metrica.

        Utile per plot e analisi trend.

        Args:
            metric: Nome metrica ("confidence", "reward", "entropy")
            window: Dimensione finestra per moving average

        Returns:
            Lista valori della metrica (smoothed con moving avg)
        """
        if metric == "confidence":
            data = list(self._confidences)
        elif metric == "reward":
            data = list(self._rewards)
        elif metric == "entropy":
            # Calcola entropy per ogni snapshot
            data = [self.compute_entropy(w) for w in self._weight_snapshots]
        else:
            log.warning(f"Unknown metric: {metric}")
            return []

        if not data or window <= 0:
            return data

        # Moving average
        smoothed = []
        for i in range(len(data)):
            start = max(0, i - window + 1)
            smoothed.append(sum(data[start:i+1]) / (i - start + 1))

        return smoothed

    def get_expert_evolution(self) -> List[Dict[str, Any]]:
        """
        Ottiene evoluzione uso expert nel tempo.

        Returns:
            Lista di snapshot: [{"timestamp": i, "usage": {"literal": 0.4, ...}}, ...]
        """
        if not self._expert_usage:
            return []

        # Dividi in bucket da 50 query
        bucket_size = 50
        evolution = []

        usage_list = list(self._expert_usage)

        for i in range(0, len(usage_list), bucket_size):
            bucket = usage_list[i:i+bucket_size]
            counts = Counter(bucket)
            total = len(bucket)

            usage = {exp: counts.get(exp, 0) / total for exp in self._expert_types}

            evolution.append({
                "bucket": i // bucket_size,
                "queries": len(bucket),
                "usage": usage
            })

        return evolution

    def reset(self) -> None:
        """Reset tutte le metriche."""
        self._expert_usage.clear()
        self._confidences.clear()
        self._is_neural.clear()
        self._rewards.clear()
        self._weight_snapshots.clear()
        self._baseline = 0.5
        self._expert_types.clear()

        log.info("Metrics tracker reset")


def compute_load_balance(usage_counts: Dict[str, int]) -> float:
    """
    Calcola load balance tra expert (deviazione standard normalizzata).

    Un sistema ben bilanciato ha std dev bassa.

    Args:
        usage_counts: Dict expert -> numero volte usato

    Returns:
        Std dev normalizzata [0-1] (0 = perfettamente bilanciato)
    """
    if not usage_counts:
        return 0.0

    counts = list(usage_counts.values())

    if len(counts) == 1:
        return 0.0  # Solo un expert, perfettamente bilanciato per definizione

    mean = sum(counts) / len(counts)

    if mean == 0:
        return 0.0

    # Std dev
    variance = sum((c - mean) ** 2 for c in counts) / len(counts)
    std_dev = math.sqrt(variance)

    # Normalizza per media (coefficient of variation)
    normalized_std = std_dev / mean

    # Clamp a [0, 1]
    return min(normalized_std, 1.0)


def check_statistical_significance(
    group_a: List[float],
    group_b: List[float],
    alpha: float = 0.05
) -> Tuple[float, bool]:
    """
    Test t-test per significatività statistica tra due gruppi.

    Utile per validare se cambio di policy ha effetto significativo.

    Args:
        group_a: Metriche gruppo A (es. reward prima del cambio)
        group_b: Metriche gruppo B (es. reward dopo il cambio)
        alpha: Soglia p-value (default: 0.05)

    Returns:
        Tuple (p_value, is_significant)
    """
    # Lazy import per evitare dipendenza obbligatoria
    try:
        from scipy import stats
    except ImportError:
        log.warning("scipy not installed - skipping statistical test")
        return (1.0, False)

    if not group_a or not group_b:
        return (1.0, False)

    # Welch's t-test (non assume ugual varianza)
    t_stat, p_value = stats.ttest_ind(group_a, group_b, equal_var=False)

    is_significant = p_value < alpha

    log.info(
        "Statistical test",
        t_stat=t_stat,
        p_value=p_value,
        significant=is_significant
    )

    return (p_value, is_significant)


def analyze_correlation(
    metric_a: List[float],
    metric_b: List[float]
) -> float:
    """
    Calcola correlazione di Pearson tra due metriche.

    Utile per capire relazioni (es. confidence vs reward).

    Args:
        metric_a: Prima metrica
        metric_b: Seconda metrica

    Returns:
        Coefficiente correlazione [-1, 1]
    """
    # Lazy import
    try:
        from scipy.stats import pearsonr
    except ImportError:
        log.warning("scipy not installed - using simple correlation")
        # Fallback semplice
        if not metric_a or not metric_b or len(metric_a) != len(metric_b):
            return 0.0

        n = len(metric_a)
        mean_a = sum(metric_a) / n
        mean_b = sum(metric_b) / n

        cov = sum((metric_a[i] - mean_a) * (metric_b[i] - mean_b) for i in range(n)) / n
        std_a = math.sqrt(sum((a - mean_a) ** 2 for a in metric_a) / n)
        std_b = math.sqrt(sum((b - mean_b) ** 2 for b in metric_b) / n)

        if std_a == 0 or std_b == 0:
            return 0.0

        return cov / (std_a * std_b)

    if not metric_a or not metric_b or len(metric_a) != len(metric_b):
        return 0.0

    corr, _ = pearsonr(metric_a, metric_b)
    return corr
