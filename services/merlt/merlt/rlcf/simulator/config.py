"""
Configurazione per il simulatore RLCF.

Gestisce il caricamento della configurazione da file YAML
con supporto per variabili d'ambiente e valori di default.
"""

import os
from dataclasses import dataclass, field
from typing import Dict, Any, Optional
from pathlib import Path
import yaml


@dataclass
class AuthorityModelConfig:
    """
    Configurazione modello authority utenti.

    Controlla come l'authority evolve in risposta ai feedback:
    - lambda_factor: fattore per exponential smoothing del track record
    - weight_*: pesi per la formula A = w_b*B + w_t*T + w_q*Q

    I pesi devono sommare a 1.0 per mantenere l'authority normalizzata.
    """
    lambda_factor: float = 0.15       # Fattore exponential smoothing (era 0.05)
    weight_baseline: float = 0.40     # Peso baseline_authority
    weight_track_record: float = 0.35 # Peso track_record
    weight_quality: float = 0.25      # Peso quality_score recente

    def __post_init__(self):
        """Valida che i pesi sommino a 1.0."""
        total = self.weight_baseline + self.weight_track_record + self.weight_quality
        if abs(total - 1.0) > 0.001:
            raise ValueError(
                f"Authority weights must sum to 1.0, got {total:.4f}. "
                f"Weights: baseline={self.weight_baseline}, "
                f"track_record={self.weight_track_record}, "
                f"quality={self.weight_quality}"
            )

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AuthorityModelConfig":
        """Costruisce da dizionario."""
        return cls(
            lambda_factor=data.get("lambda_factor", 0.15),
            weight_baseline=data.get("weight_baseline", 0.40),
            weight_track_record=data.get("weight_track_record", 0.35),
            weight_quality=data.get("weight_quality", 0.25),
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "lambda_factor": self.lambda_factor,
            "weight_baseline": self.weight_baseline,
            "weight_track_record": self.weight_track_record,
            "weight_quality": self.weight_quality,
        }


@dataclass
class SimulationConfig:
    """
    Configurazione completa per la simulazione RLCF.

    Può essere caricata da file YAML o costruita programmaticamente.
    """

    # Experiment
    experiment_name: str = "EXP-021_RLCF_Simulation"
    random_seed: int = 42

    # Phases
    baseline_queries: int = 10
    training_iterations: int = 5
    queries_per_training: int = 20
    post_training_queries: int = 10

    # Users
    user_pool_size: int = 20
    user_distribution: Dict[str, int] = field(default_factory=lambda: {
        "strict_expert": 3,
        "domain_specialist": 5,
        "lenient_student": 8,
        "random_noise": 4,
    })

    # Authority model (FIX per authority che decresce)
    authority_model: AuthorityModelConfig = field(default_factory=AuthorityModelConfig)

    # LLM Judge
    use_llm_judge: bool = True
    llm_judge_model: str = "google/gemini-2.5-flash"
    llm_judge_temperature: float = 0.1
    llm_provider: str = "openrouter"

    # Evaluation weights
    objective_weight: float = 0.4
    subjective_weight: float = 0.6

    # Statistics
    confidence_level: float = 0.95
    min_effect_size: float = 0.3
    bootstrap_samples: int = 1000

    # Output
    output_dir: str = "docs/experiments/EXP-021_rlcf_loop_validation/results"
    output_formats: list = field(default_factory=lambda: ["json", "csv", "pdf", "tex", "md"])
    streamlit_dashboard: bool = True
    save_intermediate: bool = True

    @classmethod
    def from_yaml(cls, path: str) -> "SimulationConfig":
        """
        Carica configurazione da file YAML.

        Supporta variabili d'ambiente con sintassi ${VAR:-default}.

        Args:
            path: Percorso al file YAML

        Returns:
            SimulationConfig configurato
        """
        with open(path, "r", encoding="utf-8") as f:
            raw = f.read()

        # Sostituisci variabili d'ambiente
        raw = cls._expand_env_vars(raw)

        data = yaml.safe_load(raw)
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SimulationConfig":
        """
        Costruisce configurazione da dizionario.

        Gestisce struttura nidificata del YAML.
        """
        config = cls()

        # Experiment section
        exp = data.get("experiment", {})
        if "name" in exp:
            config.experiment_name = exp["name"]
        if "random_seed" in exp:
            config.random_seed = exp["random_seed"]

        # Phases section
        phases = data.get("phases", {})
        baseline = phases.get("baseline", {})
        training = phases.get("training", {})
        post = phases.get("post_training", {})

        if "queries" in baseline:
            config.baseline_queries = baseline["queries"]
        if "iterations" in training:
            config.training_iterations = training["iterations"]
        if "queries_per_iteration" in training:
            config.queries_per_training = training["queries_per_iteration"]
        if "queries" in post:
            config.post_training_queries = post["queries"]

        # Users section
        users = data.get("users", {})
        if "pool_size" in users:
            config.user_pool_size = users["pool_size"]
        if "distribution" in users:
            config.user_distribution = users["distribution"]

        # Authority model section (FIX per authority che decresce)
        authority_data = data.get("authority_model", {})
        if authority_data:
            config.authority_model = AuthorityModelConfig.from_dict(authority_data)

        # Evaluation section
        evaluation = data.get("evaluation", {})
        llm_judge = evaluation.get("llm_judge", {})

        if "model" in llm_judge:
            config.llm_judge_model = llm_judge["model"]
        if "temperature" in llm_judge:
            config.llm_judge_temperature = llm_judge["temperature"]
        if "enabled" in llm_judge:
            config.use_llm_judge = llm_judge["enabled"]
        if "provider" in llm_judge:
            config.llm_provider = llm_judge["provider"]

        if "objective" in evaluation:
            config.objective_weight = evaluation["objective"].get("weight", 0.4)
        if "subjective" in evaluation:
            config.subjective_weight = evaluation["subjective"].get("weight", 0.6)

        # Statistics section
        stats = data.get("statistics", {})
        if "confidence_level" in stats:
            config.confidence_level = stats["confidence_level"]
        if "min_effect_size" in stats:
            config.min_effect_size = stats["min_effect_size"]
        if "runs_for_variance" in stats:
            config.bootstrap_samples = stats.get("bootstrap_samples", 1000)

        # Output section
        outputs = data.get("outputs", {})
        if "output_dir" in outputs:
            config.output_dir = outputs["output_dir"]
        if "formats" in outputs:
            config.output_formats = outputs["formats"]
        if "streamlit_dashboard" in outputs:
            config.streamlit_dashboard = outputs["streamlit_dashboard"]

        return config

    @staticmethod
    def _expand_env_vars(content: str) -> str:
        """
        Espande variabili d'ambiente nel contenuto.

        Sintassi supportata:
        - ${VAR} → valore di VAR o stringa vuota
        - ${VAR:-default} → valore di VAR o "default"
        """
        import re

        def replacer(match):
            var_expr = match.group(1)
            if ":-" in var_expr:
                var_name, default = var_expr.split(":-", 1)
                return os.environ.get(var_name, default)
            else:
                return os.environ.get(var_expr, "")

        return re.sub(r'\$\{([^}]+)\}', replacer, content)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza configurazione in dizionario."""
        return {
            "experiment": {
                "name": self.experiment_name,
                "random_seed": self.random_seed,
            },
            "phases": {
                "baseline": {"queries": self.baseline_queries},
                "training": {
                    "iterations": self.training_iterations,
                    "queries_per_iteration": self.queries_per_training,
                },
                "post_training": {"queries": self.post_training_queries},
            },
            "users": {
                "pool_size": self.user_pool_size,
                "distribution": self.user_distribution,
            },
            "authority_model": self.authority_model.to_dict(),
            "evaluation": {
                "llm_judge": {
                    "model": self.llm_judge_model,
                    "temperature": self.llm_judge_temperature,
                    "enabled": self.use_llm_judge,
                    "provider": self.llm_provider,
                },
                "objective": {"weight": self.objective_weight},
                "subjective": {"weight": self.subjective_weight},
            },
            "statistics": {
                "confidence_level": self.confidence_level,
                "min_effect_size": self.min_effect_size,
                "bootstrap_samples": self.bootstrap_samples,
            },
            "outputs": {
                "output_dir": self.output_dir,
                "formats": self.output_formats,
                "streamlit_dashboard": self.streamlit_dashboard,
            },
        }

    def save_yaml(self, path: str):
        """Salva configurazione in file YAML."""
        with open(path, "w", encoding="utf-8") as f:
            yaml.dump(self.to_dict(), f, default_flow_style=False, allow_unicode=True)


def load_config(path: Optional[str] = None) -> SimulationConfig:
    """
    Carica configurazione da file o usa default.

    Args:
        path: Percorso al file YAML (opzionale)

    Returns:
        SimulationConfig
    """
    if path is None:
        # Cerca config di default
        default_paths = [
            "merlt/rlcf/simulator/config/simulation.yaml",
            "config/simulation.yaml",
            "simulation.yaml",
        ]
        for p in default_paths:
            if os.path.exists(p):
                path = p
                break

    if path and os.path.exists(path):
        return SimulationConfig.from_yaml(path)

    # Usa configurazione di default
    return SimulationConfig()


def get_default_config_path() -> str:
    """Restituisce il percorso alla configurazione di default."""
    return str(Path(__file__).parent / "config" / "simulation.yaml")
