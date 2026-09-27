"""
MERL-T RLCF Framework
=====================

Reinforcement Learning from Collective Feedback per ricerca giuridica.

Componenti Core:
- authority: Funzioni per calcolo autorevolezza fonte
- aggregation: AggregationEngine per aggregazione feedback
- ai_service: OpenRouterService per AI responses
- models: SQLAlchemy models per RLCF data
- metrics: MetricsTracker per tracking LLM calls e costi
- validation: Modelli per validazione knowledge graph

Policy Gradient:
- execution_trace: ExecutionTrace e Action per policy gradient
- multilevel_feedback: MultilevelFeedback per feedback strutturato
- policy_gradient: GatingPolicy, TraversalPolicy, PolicyGradientTrainer (REINFORCE)
- single_step_trainer: SingleStepTrainer per routing single-step (REINFORCE ottimizzato)
- ppo_trainer: PPOTrainer, PPOConfig (Proximal Policy Optimization - legacy)
- react_ppo_trainer: ReActPPOTrainer per Expert multi-step reasoning (PPO)

External Integration:
- external_feedback: ExternalFeedbackAdapter per feedback da VisuaLex
- authority_sync: AuthoritySyncService per sincronizzazione authority

Advanced Training:
- replay_buffer: ExperienceReplayBuffer, PrioritizedReplayBuffer
- curriculum_learning: CurriculumScheduler, DifficultyAssessor, QueryPool
- off_policy_eval: OPEEvaluator per valutazione off-policy

Safety & Quality:
- bias_detection: BiasDetector per rilevamento bias 6-dimensionale
- devils_advocate: DevilsAdvocateAssigner per critical thinking

Esempio:
    from merlt.rlcf.ai_service import OpenRouterService
    from merlt.rlcf.metrics import get_metrics
    from merlt.rlcf.validation import ValidationIssue, IssueType

    # AI Service
    service = OpenRouterService()
    response = await service.generate(prompt="...")

    # Metrics tracking
    metrics = get_metrics()
    metrics.record_llm_call(model="gpt-4", tokens_in=100, ...)

    # Policy Gradient (REINFORCE)
    from merlt.rlcf.execution_trace import ExecutionTrace, Action
    from merlt.rlcf.multilevel_feedback import MultilevelFeedback
    from merlt.rlcf.policy_gradient import GatingPolicy, PolicyGradientTrainer

    policy = GatingPolicy(input_dim=1024)
    trainer = PolicyGradientTrainer(policy)
    metrics = trainer.update_from_feedback(trace, feedback)

    # SingleStepTrainer for routing (optimized REINFORCE)
    from merlt.rlcf.single_step_trainer import SingleStepTrainer, SingleStepConfig

    config = SingleStepConfig(learning_rate=1e-4, entropy_coef=0.01)
    ss_trainer = SingleStepTrainer(policy, config)
    metrics = ss_trainer.update(trace, feedback)

    # ReActPPOTrainer for multi-step Expert reasoning
    from merlt.rlcf.react_ppo_trainer import ReActPPOTrainer, ReActConfig, ReActPolicy

    react_policy = ReActPolicy(state_dim=1024, num_actions=7)
    react_config = ReActConfig(gamma=0.99, gae_lambda=0.95)
    react_trainer = ReActPPOTrainer(react_policy, react_config)
    react_trainer.add_trajectory(trajectory)
    metrics = react_trainer.update()

    # Experience Replay
    from merlt.rlcf.replay_buffer import ExperienceReplayBuffer, PrioritizedReplayBuffer

    buffer = PrioritizedReplayBuffer(capacity=10000, alpha=0.6)
    buffer.add(trace, feedback, reward, td_error=0.5)
    batch, indices, weights = buffer.sample_with_priority(32)

    # Curriculum Learning
    from merlt.rlcf.curriculum_learning import CurriculumScheduler

    scheduler = CurriculumScheduler()
    assessment = scheduler.assess_difficulty("Cos'e' la legittima difesa?")
    batch = scheduler.filter_batch_by_curriculum(queries, target_size=32)
    scheduler.update_after_epoch(avg_reward=0.75)

    # Off-Policy Evaluation
    from merlt.rlcf.off_policy_eval import OPEEvaluator

    evaluator = OPEEvaluator()
    result = evaluator.evaluate(new_policy, historical_data)
    print(f"Estimated value: {result.estimated_value:.3f}")

    # Bias Detection
    from merlt.rlcf.bias_detection import BiasDetector

    detector = BiasDetector()
    report = await detector.calculate_total_bias(task_id, feedbacks)
    print(f"Total bias: {report.total_bias:.3f}")

    # Devil's Advocate
    from merlt.rlcf.devils_advocate import DevilsAdvocateAssigner

    assigner = DevilsAdvocateAssigner()
    assignments = assigner.assign_advocates(task_id, eligible_users)

Note:
    Il modulo è in fase di sviluppo. Alcuni componenti richiedono
    configurazione database (SQLAlchemy) per funzionare completamente.
"""

# Lazy imports to avoid circular dependencies and allow partial module use
# Import specific components as needed:
#   from merlt.rlcf.ai_service import OpenRouterService
#   from merlt.rlcf.aggregation import AggregationEngine
#   from merlt.rlcf.metrics import get_metrics
#   from merlt.rlcf.validation import ValidationIssue

__all__ = [
    # Core
    "ai_service",
    "aggregation",
    "authority",
    "database",
    "models",
    "metrics",
    "orchestrator",
    "RLCFOrchestrator",
    "validation",
    # Policy Gradient
    "execution_trace",
    "multilevel_feedback",
    "policy_gradient",
    "single_step_trainer",
    "ppo_trainer",
    "react_ppo_trainer",
    # Persistence (PostgreSQL storage)
    "persistence",
    "RLCFPersistence",
    "RLCFTrace",
    "RLCFFeedback",
    "PolicyCheckpoint",
    "TrainingSession",
    # External Integration
    "authority_sync",
    "external_feedback",
    # Advanced Training
    "replay_buffer",
    "curriculum_learning",
    "off_policy_eval",
    # Safety & Quality
    "bias_detection",
    "devils_advocate",
    # Training Scheduler
    "training_scheduler",
    "TrainingScheduler",
    "get_scheduler",
]

# Convenience imports for common classes
def get_orchestrator():
    """Get RLCFOrchestrator singleton."""
    from merlt.rlcf.orchestrator import get_orchestrator as _get
    return _get

def get_async_session():
    """Get async database session."""
    from merlt.rlcf.database import get_async_session as _get
    return _get


# Direct access to classes via lazy import
def __getattr__(name):
    """Lazy import to avoid circular imports."""
    if name == "RLCFOrchestrator":
        from merlt.rlcf.orchestrator import RLCFOrchestrator
        return RLCFOrchestrator
    if name == "RLCFPersistence":
        from merlt.rlcf.persistence import RLCFPersistence
        return RLCFPersistence
    if name == "RLCFTrace":
        from merlt.rlcf.persistence import RLCFTrace
        return RLCFTrace
    if name == "RLCFFeedback":
        from merlt.rlcf.persistence import RLCFFeedback
        return RLCFFeedback
    if name == "PolicyCheckpoint":
        from merlt.rlcf.persistence import PolicyCheckpoint
        return PolicyCheckpoint
    if name == "TrainingSession":
        from merlt.rlcf.persistence import TrainingSession
        return TrainingSession
    if name == "TrainingScheduler":
        from merlt.rlcf.training_scheduler import TrainingScheduler
        return TrainingScheduler
    if name == "get_scheduler":
        from merlt.rlcf.training_scheduler import get_scheduler
        return get_scheduler
    raise AttributeError(f"module 'merlt.rlcf' has no attribute '{name}'")
