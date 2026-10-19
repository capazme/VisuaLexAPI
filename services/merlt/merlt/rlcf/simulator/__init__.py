"""
RLCF Simulator - Validazione scientifica del loop di feedback.

Questo modulo permette di simulare una community di utenti per validare
il funzionamento del loop RLCF senza utenti reali.

Componenti principali:
- SyntheticUser: Profili utente simulati con diversi livelli di authority
- ObjectiveEvaluator: Metriche calcolabili automaticamente (SG, HR, etc.)
- LLMJudge: Valutazione soggettiva tramite LLM-as-Judge
- FeedbackSynthesizer: Combina metriche oggettive e soggettive
- RLCFExperiment: Runner per esperimenti in 3 fasi
- StatisticalAnalyzer: Test statistici per validazione ipotesi
- ThesisOutputGenerator: Output thesis-ready (LaTeX, PDF, JSON)

Esempio di utilizzo:
    from merlt.rlcf.simulator import RLCFExperiment, load_config

    config = load_config("simulation.yaml")
    experiment = RLCFExperiment(config)
    results = await experiment.run()

    print(f"H1 Passed: {results.statistics.h1.passed}")
    print(f"H4 Improvement: {results.statistics.h4.value:.1%}")
"""

from merlt.rlcf.simulator.users import (
    SyntheticUser,
    UserPool,
    PROFILES,
    create_user_pool,
)
from merlt.rlcf.simulator.objective_metrics import (
    ObjectiveMetrics,
    ObjectiveEvaluator,
)
from merlt.rlcf.simulator.llm_judge import (
    SubjectiveMetrics,
    LLMJudge,
)
from merlt.rlcf.simulator.feedback_synthesizer import (
    SimulatedFeedback,
    FeedbackSynthesizer,
)
from merlt.rlcf.simulator.experiment import (
    ExperimentConfig,
    PhaseResults,
    ExperimentResults,
    RLCFExperiment,
)
from merlt.rlcf.simulator.statistics import (
    HypothesisResult,
    StatisticalReport,
    StatisticalAnalyzer,
)
from merlt.rlcf.simulator.outputs import (
    ThesisOutputGenerator,
)
from merlt.rlcf.simulator.config import (
    SimulationConfig,
    load_config,
)
from merlt.rlcf.simulator.integration import (
    RealExpertSystemAdapter,
    RealRLCFAdapter,
    AdaptedExpertResponse,
    create_integrated_experiment,
    cleanup_experiment,
    check_real_components,
)

__all__ = [
    # Users
    "SyntheticUser",
    "UserPool",
    "PROFILES",
    "create_user_pool",
    # Objective Metrics
    "ObjectiveMetrics",
    "ObjectiveEvaluator",
    # LLM Judge
    "SubjectiveMetrics",
    "LLMJudge",
    # Feedback
    "SimulatedFeedback",
    "FeedbackSynthesizer",
    # Experiment
    "ExperimentConfig",
    "PhaseResults",
    "ExperimentResults",
    "RLCFExperiment",
    # Statistics
    "HypothesisResult",
    "StatisticalReport",
    "StatisticalAnalyzer",
    # Outputs
    "ThesisOutputGenerator",
    # Config
    "SimulationConfig",
    "load_config",
    # Integration
    "RealExpertSystemAdapter",
    "RealRLCFAdapter",
    "AdaptedExpertResponse",
    "create_integrated_experiment",
    "cleanup_experiment",
    "check_real_components",
]
