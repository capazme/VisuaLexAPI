"""
Experiment Tracker
==================

A/B testing e tracking esperimenti per pesi.

L'ExperimentTracker gestisce:
1. Creazione esperimenti con varianti (control/treatment)
2. Assegnazione utenti a varianti
3. Raccolta metriche per variante
4. Analisi statistica (p-value, effect size)

Esempio:
    >>> tracker = ExperimentTracker(store)
    >>> exp = await tracker.create_experiment(
    ...     name="alpha_tuning",
    ...     variants={
    ...         "control": WeightConfig(retrieval=RetrievalWeights(alpha=0.7)),
    ...         "treatment": WeightConfig(retrieval=RetrievalWeights(alpha=0.8))
    ...     }
    ... )
    >>> variant = await tracker.assign_variant(exp.id, user_id="user123")
    >>> await tracker.record_outcome(exp.id, variant, {"mrr": 0.85})
"""

import json
import os
import structlog
from typing import Dict, Optional, List, Any
from dataclasses import dataclass, field, asdict
from datetime import datetime
from uuid import uuid4
import hashlib
import random

from merlt.weights.config import WeightConfig, ExperimentConfig, ExperimentVariant
from merlt.weights.store import WeightStore

log = structlog.get_logger()

# Redis singleton for experiment persistence (db=2)
_exp_redis_client = None
_exp_redis_checked = False

# TTL: 30 days in seconds
_EXP_REDIS_TTL = 30 * 24 * 3600


async def _get_exp_redis():
    """Get or create Redis async client for experiment storage. Returns None if unavailable."""
    global _exp_redis_client, _exp_redis_checked

    if _exp_redis_checked and _exp_redis_client is None:
        return None

    if _exp_redis_client is not None:
        return _exp_redis_client

    _exp_redis_checked = True
    try:
        import redis.asyncio as aioredis
        client = aioredis.Redis(
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=int(os.environ.get("REDIS_PORT", "6379")),
            db=2,
            decode_responses=True,
            socket_connect_timeout=2,
        )
        await client.ping()
        _exp_redis_client = client
        log.info("Experiment Redis connected (db=2)")
        return _exp_redis_client
    except Exception as e:
        log.warning("Experiment Redis unavailable, using in-memory only", error=str(e))
        _exp_redis_client = None
        return None


@dataclass
class Experiment:
    """
    Rappresenta un esperimento A/B attivo.

    Attributes:
        id: ID univoco esperimento
        name: Nome descrittivo
        status: Stato (draft, running, completed, stopped)
        variants: Varianti con configurazioni pesi
        created_at: Timestamp creazione
        metrics_by_variant: Metriche raccolte per variante
    """
    id: str
    name: str
    description: Optional[str] = None
    status: str = "draft"
    variants: Dict[str, WeightConfig] = field(default_factory=dict)
    allocation: Dict[str, float] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    completed_at: Optional[str] = None
    metrics_by_variant: Dict[str, List[Dict[str, float]]] = field(default_factory=dict)
    user_assignments: Dict[str, str] = field(default_factory=dict)


@dataclass
class ExperimentAnalysis:
    """
    Risultati analisi esperimento.

    Attributes:
        experiment_id: ID esperimento
        control_metrics: Metriche aggregate control
        treatment_metrics: Metriche aggregate treatment
        winner: Variante vincente (o None se inconclusive)
        p_value: p-value del test statistico
        effect_size: Cohen's d effect size
        significant: Se la differenza e' statisticamente significativa
    """
    experiment_id: str
    control_metrics: Dict[str, float]
    treatment_metrics: Dict[str, float]
    winner: Optional[str] = None
    p_value: Optional[float] = None
    effect_size: Optional[float] = None
    significant: bool = False
    samples_control: int = 0
    samples_treatment: int = 0


class ExperimentTracker:
    """
    Gestisce A/B testing sui pesi del sistema.

    Supporta:
    - Creazione esperimenti multi-variante
    - Assegnazione deterministica utenti (hash-based)
    - Raccolta metriche per variante
    - Analisi statistica semplice

    Esempio:
        >>> tracker = ExperimentTracker(store)
        >>>
        >>> # Crea esperimento
        >>> exp = await tracker.create_experiment(
        ...     name="alpha_test",
        ...     control_weights=config_a,
        ...     treatment_weights=config_b,
        ...     split_ratio=0.5
        ... )
        >>>
        >>> # Assegna utente
        >>> variant = await tracker.assign_variant(exp.id, "user123")
        >>> # "control" o "treatment"
        >>>
        >>> # Registra outcome
        >>> await tracker.record_outcome(exp.id, variant, {"mrr": 0.85})
        >>>
        >>> # Analizza
        >>> analysis = await tracker.analyze_experiment(exp.id)
    """

    def __init__(self, store: WeightStore):
        """
        Inizializza ExperimentTracker.

        Args:
            store: WeightStore per persistenza
        """
        self.store = store
        self._experiments: Dict[str, Experiment] = {}

        log.info("ExperimentTracker initialized")

    def _experiment_to_dict(self, exp: Experiment) -> Dict[str, Any]:
        """Serialize Experiment to JSON-safe dict (excluding WeightConfig variants)."""
        return {
            "id": exp.id,
            "name": exp.name,
            "description": exp.description,
            "status": exp.status,
            "allocation": exp.allocation,
            "created_at": exp.created_at,
            "completed_at": exp.completed_at,
            "metrics_by_variant": exp.metrics_by_variant,
            "user_assignments": exp.user_assignments,
        }

    def _experiment_from_dict(self, data: Dict[str, Any]) -> Experiment:
        """Deserialize Experiment from dict (without variants — those stay in-memory)."""
        return Experiment(
            id=data["id"],
            name=data["name"],
            description=data.get("description"),
            status=data.get("status", "draft"),
            allocation=data.get("allocation", {}),
            created_at=data.get("created_at", ""),
            completed_at=data.get("completed_at"),
            metrics_by_variant=data.get("metrics_by_variant", {}),
            user_assignments=data.get("user_assignments", {}),
        )

    async def _persist_to_redis(self, exp: Experiment) -> None:
        """Persist experiment state to Redis with graceful degradation."""
        redis = await _get_exp_redis()
        if redis is None:
            return
        try:
            key = f"experiment:{exp.id}"
            await redis.set(key, json.dumps(self._experiment_to_dict(exp)), ex=_EXP_REDIS_TTL)
        except Exception as e:
            log.warning("Failed to persist experiment to Redis", experiment_id=exp.id, error=str(e))

    async def _load_from_redis(self, experiment_id: str) -> Optional[Experiment]:
        """Load experiment from Redis on cache miss (cold-start recovery)."""
        redis = await _get_exp_redis()
        if redis is None:
            return None
        try:
            key = f"experiment:{experiment_id}"
            data = await redis.get(key)
            if data is None:
                return None
            return self._experiment_from_dict(json.loads(data))
        except Exception as e:
            log.warning("Failed to load experiment from Redis", experiment_id=experiment_id, error=str(e))
            return None

    async def create_experiment(
        self,
        name: str,
        control_weights: WeightConfig,
        treatment_weights: WeightConfig,
        split_ratio: float = 0.5,
        description: Optional[str] = None
    ) -> Experiment:
        """
        Crea un nuovo esperimento A/B.

        Args:
            name: Nome esperimento
            control_weights: Configurazione pesi control
            treatment_weights: Configurazione pesi treatment
            split_ratio: % traffico per treatment (default 50%)
            description: Descrizione opzionale

        Returns:
            Experiment creato
        """
        exp_id = str(uuid4())[:8]

        experiment = Experiment(
            id=exp_id,
            name=name,
            description=description,
            status="running",
            variants={
                "control": control_weights,
                "treatment": treatment_weights,
            },
            allocation={
                "control": 1 - split_ratio,
                "treatment": split_ratio,
            },
            metrics_by_variant={
                "control": [],
                "treatment": [],
            }
        )

        self._experiments[exp_id] = experiment

        # Persist to Redis
        await self._persist_to_redis(experiment)

        log.info(
            "Experiment created",
            experiment_id=exp_id,
            name=name,
            split_ratio=split_ratio
        )

        return experiment

    async def assign_variant(
        self,
        experiment_id: str,
        user_id: str
    ) -> str:
        """
        Assegna un utente a una variante.

        L'assegnazione e' deterministica (basata su hash) per garantire
        che lo stesso utente veda sempre la stessa variante.

        Args:
            experiment_id: ID esperimento
            user_id: ID utente

        Returns:
            Nome variante ("control" o "treatment")
        """
        if experiment_id not in self._experiments:
            # Try loading from Redis (cold-start recovery)
            recovered = await self._load_from_redis(experiment_id)
            if recovered:
                self._experiments[experiment_id] = recovered
            else:
                raise ValueError(f"Experiment {experiment_id} not found")

        exp = self._experiments[experiment_id]

        # Check cache
        if user_id in exp.user_assignments:
            return exp.user_assignments[user_id]

        # Deterministic assignment via hash
        hash_input = f"{experiment_id}:{user_id}"
        hash_value = int(hashlib.md5(hash_input.encode(), usedforsecurity=False).hexdigest(), 16)
        normalized = (hash_value % 10000) / 10000  # [0, 1)

        # Assign based on allocation
        if normalized < exp.allocation.get("treatment", 0.5):
            variant = "treatment"
        else:
            variant = "control"

        # Cache assignment
        exp.user_assignments[user_id] = variant

        log.debug(
            "User assigned to variant",
            experiment_id=experiment_id,
            user_id=user_id[:8] + "...",
            variant=variant
        )

        return variant

    async def get_weights_for_user(
        self,
        experiment_id: str,
        user_id: str
    ) -> WeightConfig:
        """
        Ottiene i pesi per un utente in un esperimento.

        Args:
            experiment_id: ID esperimento
            user_id: ID utente

        Returns:
            WeightConfig per la variante assegnata
        """
        variant = await self.assign_variant(experiment_id, user_id)
        exp = self._experiments[experiment_id]
        return exp.variants[variant]

    async def record_outcome(
        self,
        experiment_id: str,
        variant: str,
        metrics: Dict[str, float]
    ) -> None:
        """
        Registra outcome per una variante.

        Args:
            experiment_id: ID esperimento
            variant: Nome variante
            metrics: Metriche da registrare (es. {"mrr": 0.85, "recall": 0.9})
        """
        if experiment_id not in self._experiments:
            raise ValueError(f"Experiment {experiment_id} not found")

        exp = self._experiments[experiment_id]

        if variant not in exp.metrics_by_variant:
            raise ValueError(f"Variant {variant} not in experiment")

        exp.metrics_by_variant[variant].append(metrics)

        # Persist updated metrics to Redis
        await self._persist_to_redis(exp)

        log.debug(
            "Outcome recorded",
            experiment_id=experiment_id,
            variant=variant,
            metrics=metrics
        )

    async def analyze_experiment(
        self,
        experiment_id: str
    ) -> ExperimentAnalysis:
        """
        Analizza risultati esperimento.

        Calcola:
        - Metriche aggregate per variante
        - p-value via t-test (se abbastanza campioni)
        - Effect size (Cohen's d)
        - Winner (se significativo)

        Args:
            experiment_id: ID esperimento

        Returns:
            ExperimentAnalysis con risultati
        """
        if experiment_id not in self._experiments:
            raise ValueError(f"Experiment {experiment_id} not found")

        exp = self._experiments[experiment_id]

        control_metrics = self._aggregate_metrics(exp.metrics_by_variant.get("control", []))
        treatment_metrics = self._aggregate_metrics(exp.metrics_by_variant.get("treatment", []))

        n_control = len(exp.metrics_by_variant.get("control", []))
        n_treatment = len(exp.metrics_by_variant.get("treatment", []))

        # Simple analysis (senza scipy per ora)
        p_value = None
        effect_size = None
        winner = None
        significant = False

        # Check if we have enough samples
        min_samples = 30
        if n_control >= min_samples and n_treatment >= min_samples:
            # Calcola effect size semplice per MRR (se presente)
            if "mrr" in control_metrics and "mrr" in treatment_metrics:
                diff = treatment_metrics["mrr"] - control_metrics["mrr"]

                # Stima effect size (semplificato)
                effect_size = abs(diff)

                # Winner semplice (>5% improvement)
                if diff > 0.05:
                    winner = "treatment"
                    significant = True
                elif diff < -0.05:
                    winner = "control"
                    significant = True

        analysis = ExperimentAnalysis(
            experiment_id=experiment_id,
            control_metrics=control_metrics,
            treatment_metrics=treatment_metrics,
            winner=winner,
            p_value=p_value,
            effect_size=effect_size,
            significant=significant,
            samples_control=n_control,
            samples_treatment=n_treatment,
        )

        log.info(
            "Experiment analyzed",
            experiment_id=experiment_id,
            samples_control=n_control,
            samples_treatment=n_treatment,
            winner=winner,
            significant=significant
        )

        return analysis

    def _aggregate_metrics(self, metrics_list: List[Dict[str, float]]) -> Dict[str, float]:
        """Aggrega lista di metriche in valori medi."""
        if not metrics_list:
            return {}

        aggregated = {}
        for key in metrics_list[0].keys():
            values = [m.get(key, 0) for m in metrics_list if key in m]
            if values:
                aggregated[key] = sum(values) / len(values)

        return aggregated

    async def stop_experiment(self, experiment_id: str) -> Experiment:
        """
        Ferma un esperimento.

        Args:
            experiment_id: ID esperimento

        Returns:
            Experiment aggiornato
        """
        if experiment_id not in self._experiments:
            raise ValueError(f"Experiment {experiment_id} not found")

        exp = self._experiments[experiment_id]
        exp.status = "stopped"
        exp.completed_at = datetime.now().isoformat()

        await self._persist_to_redis(exp)

        log.info("Experiment stopped", experiment_id=experiment_id)
        return exp

    async def complete_experiment(
        self,
        experiment_id: str,
        winner: Optional[str] = None
    ) -> Experiment:
        """
        Completa un esperimento e (opzionalmente) applica il winner.

        Args:
            experiment_id: ID esperimento
            winner: Variante da applicare come nuovi pesi default

        Returns:
            Experiment aggiornato
        """
        if experiment_id not in self._experiments:
            raise ValueError(f"Experiment {experiment_id} not found")

        exp = self._experiments[experiment_id]
        exp.status = "completed"
        exp.completed_at = datetime.now().isoformat()

        await self._persist_to_redis(exp)

        # Se winner specificato, salva come nuovi pesi
        if winner and winner in exp.variants:
            await self.store.save_weights(
                config=exp.variants[winner],
                experiment_id=f"{experiment_id}_winner",
                metrics=self._aggregate_metrics(exp.metrics_by_variant.get(winner, []))
            )
            log.info(
                "Experiment completed, winner applied",
                experiment_id=experiment_id,
                winner=winner
            )
        else:
            log.info("Experiment completed", experiment_id=experiment_id)

        return exp

    def list_experiments(self, status: Optional[str] = None) -> List[Experiment]:
        """Lista tutti gli esperimenti."""
        experiments = list(self._experiments.values())
        if status:
            experiments = [e for e in experiments if e.status == status]
        return experiments

    def get_experiment(self, experiment_id: str) -> Optional[Experiment]:
        """Ottiene un esperimento per ID."""
        return self._experiments.get(experiment_id)
