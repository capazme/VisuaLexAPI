"""
Runner per esperimenti RLCF in 3 fasi.

Fasi dell'esperimento:
1. BASELINE: Esegue query senza feedback, registra metriche iniziali
2. TRAINING: Esegue query con feedback simulato, aggiorna pesi
3. POST-TRAINING: Esegue stesse query del baseline, confronta metriche

Il runner gestisce:
- Creazione pool utenti sintetici
- Caricamento query da gold standard
- Esecuzione expert system
- Valutazione con metriche obiettive e LLM-as-Judge
- Sintesi e registrazione feedback
- Tracking evoluzione pesi e authority
"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Callable
from datetime import datetime
import json
import os

from merlt.rlcf.simulator.users import SyntheticUser, UserPool, create_user_pool
from merlt.rlcf.simulator.objective_metrics import ObjectiveMetrics, ObjectiveEvaluator
from merlt.rlcf.simulator.llm_judge import SubjectiveMetrics, LLMJudge
from merlt.rlcf.simulator.feedback_synthesizer import SimulatedFeedback, FeedbackSynthesizer

logger = logging.getLogger(__name__)


@dataclass
class QueryResult:
    """Risultato di una singola query."""

    query_id: str
    query_text: str
    expert_type: str
    response: Any  # ExpertResponse
    objective_metrics: ObjectiveMetrics
    subjective_metrics: Optional[SubjectiveMetrics]
    feedbacks: List[SimulatedFeedback]
    execution_time_ms: float
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query_id": self.query_id,
            "query_text": self.query_text,
            "expert_type": self.expert_type,
            "response": self.response.to_dict() if hasattr(self.response, "to_dict") else str(self.response),
            "objective_metrics": self.objective_metrics.to_dict(),
            "subjective_metrics": self.subjective_metrics.to_dict() if self.subjective_metrics else None,
            "feedbacks": [f.to_dict() for f in self.feedbacks],
            "execution_time_ms": self.execution_time_ms,
            "timestamp": self.timestamp,
        }


@dataclass
class PhaseResults:
    """Risultati di una fase dell'esperimento."""

    phase_name: str
    queries_processed: int
    results: List[QueryResult]
    total_feedbacks: int
    feedbacks_persisted: int
    avg_confidence: float
    avg_source_grounding: float
    avg_hallucination_rate: float
    weight_snapshot: Dict[str, Any]
    user_authorities: Dict[int, float]
    duration_seconds: float
    started_at: str
    completed_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "phase_name": self.phase_name,
            "queries_processed": self.queries_processed,
            "total_feedbacks": self.total_feedbacks,
            "feedbacks_persisted": self.feedbacks_persisted,
            "metrics": {
                "avg_confidence": self.avg_confidence,
                "avg_source_grounding": self.avg_source_grounding,
                "avg_hallucination_rate": self.avg_hallucination_rate,
            },
            "weight_snapshot": self.weight_snapshot,
            "user_authorities": self.user_authorities,
            "duration_seconds": self.duration_seconds,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "results": [r.to_dict() for r in self.results],
        }


@dataclass
class ExperimentResults:
    """Risultati completi dell'esperimento."""

    experiment_id: str
    config: Dict[str, Any]
    baseline: PhaseResults
    training: List[PhaseResults]
    post_training: PhaseResults
    weight_evolution: List[Dict[str, Any]]
    authority_evolution: List[Dict[str, Any]]
    total_duration_seconds: float
    total_feedbacks: int
    total_feedbacks_persisted: int
    started_at: str
    completed_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "config": self.config,
            "phases": {
                "baseline": self.baseline.to_dict(),
                "training": [t.to_dict() for t in self.training],
                "post_training": self.post_training.to_dict(),
            },
            "weight_evolution": self.weight_evolution,
            "authority_evolution": self.authority_evolution,
            "summary": {
                "total_duration_seconds": self.total_duration_seconds,
                "total_feedbacks": self.total_feedbacks,
                "total_feedbacks_persisted": self.total_feedbacks_persisted,
            },
            "started_at": self.started_at,
            "completed_at": self.completed_at,
        }

    def save(self, output_path: str):
        """Salva i risultati in JSON."""
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)


@dataclass
class ExperimentConfig:
    """Configurazione esperimento."""

    # Identificazione
    experiment_name: str = "EXP-021_RLCF_Simulation"
    random_seed: int = 42

    # Fasi
    baseline_queries: int = 10
    training_iterations: int = 5
    queries_per_training: int = 20
    post_training_queries: int = 10  # Uguale a baseline

    # Utenti
    user_distribution: Dict[str, int] = field(default_factory=lambda: {
        "strict_expert": 3,
        "domain_specialist": 5,
        "lenient_student": 8,
        "random_noise": 4,
    })

    # Valutazione
    use_llm_judge: bool = True
    llm_judge_model: str = "google/gemini-2.5-flash"
    objective_weight: float = 0.4
    subjective_weight: float = 0.6

    # Output
    output_dir: str = "docs/experiments/EXP-021_rlcf_loop_validation/results"
    save_intermediate: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment_name": self.experiment_name,
            "random_seed": self.random_seed,
            "baseline_queries": self.baseline_queries,
            "training_iterations": self.training_iterations,
            "queries_per_training": self.queries_per_training,
            "user_distribution": self.user_distribution,
            "use_llm_judge": self.use_llm_judge,
            "llm_judge_model": self.llm_judge_model,
            "objective_weight": self.objective_weight,
            "subjective_weight": self.subjective_weight,
            "output_dir": self.output_dir,
        }


class RLCFExperiment:
    """
    Runner per esperimenti RLCF.

    Gestisce l'esecuzione completa dell'esperimento in 3 fasi:
    baseline → training → post-training.
    """

    def __init__(
        self,
        config: ExperimentConfig,
        expert_system: Optional[Any] = None,
        rlcf_orchestrator: Optional[Any] = None,
        weight_store: Optional[Any] = None,
        progress_callback: Optional[Callable[[str, float], None]] = None,
    ):
        """
        Inizializza l'esperimento.

        Args:
            config: Configurazione esperimento
            expert_system: Sistema multi-expert (o mock)
            rlcf_orchestrator: Orchestratore RLCF (o None per mock)
            weight_store: Store per pesi (o None per mock)
            progress_callback: Callback per progress updates (phase, progress)
        """
        self.config = config
        self.expert_system = expert_system
        self.orchestrator = rlcf_orchestrator
        self.weight_store = weight_store
        self.progress_callback = progress_callback

        # Componenti
        self.user_pool: Optional[UserPool] = None
        self.objective_evaluator: Optional[ObjectiveEvaluator] = None
        self.llm_judge: Optional[LLMJudge] = None
        self.feedback_synthesizer: Optional[FeedbackSynthesizer] = None

        # Tracking
        self._weight_history: List[Dict[str, Any]] = []
        self._authority_history: List[Dict[str, Any]] = []
        self._total_feedbacks = 0
        self._total_persisted = 0

    async def setup(self):
        """Inizializza componenti."""
        logger.info("Setting up experiment...")

        # User pool
        self.user_pool = create_user_pool(
            self.config.user_distribution,
            random_seed=self.config.random_seed
        )
        logger.info(f"Created user pool: {len(self.user_pool.users)} users")

        # Evaluators
        self.objective_evaluator = ObjectiveEvaluator(libro_iv_only=True)

        if self.config.use_llm_judge:
            self.llm_judge = LLMJudge(
                judge_model=self.config.llm_judge_model
            )

        # Synthesizer
        self.feedback_synthesizer = FeedbackSynthesizer(
            objective_weight=self.config.objective_weight,
            subjective_weight=self.config.subjective_weight,
            random_seed=self.config.random_seed
        )

        # Record initial weights
        await self._record_weights("initial")

    async def run(self) -> ExperimentResults:
        """
        Esegue l'esperimento completo.

        Returns:
            ExperimentResults con tutti i dati raccolti

        Raises:
            ValueError: Se la configurazione non è valida
        """
        # Validazione pre-run
        if self.config.training_iterations < 1:
            raise ValueError("training_iterations must be >= 1")
        if sum(self.config.user_distribution.values()) < 5:
            raise ValueError("user_distribution must have >= 5 users total")

        await self.setup()

        experiment_id = f"{self.config.experiment_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        started_at = datetime.now().isoformat()
        start_time = asyncio.get_event_loop().time()

        logger.info(f"Starting experiment: {experiment_id}")

        # Carica query
        queries = self._load_queries()

        # FASE 1: BASELINE
        self._report_progress("baseline", 0.0)
        baseline_results = await self._run_phase(
            phase_name="baseline",
            queries=queries[:self.config.baseline_queries],
            collect_feedback=False
        )
        self._report_progress("baseline", 1.0)

        # FASE 2: TRAINING
        training_results = []
        training_queries = queries[self.config.baseline_queries:]

        for iteration in range(self.config.training_iterations):
            self._report_progress("training", iteration / self.config.training_iterations)

            # Seleziona query per questa iterazione
            start_idx = iteration * self.config.queries_per_training
            end_idx = start_idx + self.config.queries_per_training
            iter_queries = training_queries[start_idx:end_idx]

            # Esegui iterazione
            iter_results = await self._run_phase(
                phase_name=f"training_{iteration}",
                queries=iter_queries,
                collect_feedback=True
            )
            training_results.append(iter_results)

            # Log iteration summary
            active_users_count = len([u for u in self.user_pool.users if len(u.feedback_history) > 0])
            logger.info(
                f"Iteration {iteration + 1}/{self.config.training_iterations}: "
                f"feedback={iter_results.total_feedbacks}, "
                f"active_users={active_users_count}/{len(self.user_pool.users)}, "
                f"avg_SG={iter_results.avg_source_grounding:.3f}"
            )

            # Record evolution
            await self._record_weights(f"training_{iteration}")
            self._record_authorities(f"training_{iteration}")

        self._report_progress("training", 1.0)

        # FASE 3: POST-TRAINING
        self._report_progress("post_training", 0.0)
        post_results = await self._run_phase(
            phase_name="post_training",
            queries=queries[:self.config.baseline_queries],  # Stesse query del baseline
            collect_feedback=False
        )
        self._report_progress("post_training", 1.0)

        # Risultati finali
        end_time = asyncio.get_event_loop().time()

        results = ExperimentResults(
            experiment_id=experiment_id,
            config=self.config.to_dict(),
            baseline=baseline_results,
            training=training_results,
            post_training=post_results,
            weight_evolution=self._weight_history,
            authority_evolution=self._authority_history,
            total_duration_seconds=end_time - start_time,
            total_feedbacks=self._total_feedbacks,
            total_feedbacks_persisted=self._total_persisted,
            started_at=started_at,
        )

        # Salva risultati
        if self.config.output_dir:
            os.makedirs(self.config.output_dir, exist_ok=True)
            output_path = os.path.join(
                self.config.output_dir,
                f"experiment_results_{experiment_id}.json"
            )
            results.save(output_path)
            logger.info(f"Results saved to: {output_path}")

        return results

    async def _run_phase(
        self,
        phase_name: str,
        queries: List[Dict[str, Any]],
        collect_feedback: bool
    ) -> PhaseResults:
        """
        Esegue una singola fase dell'esperimento.

        Args:
            phase_name: Nome fase (baseline, training_N, post_training)
            queries: Lista di query da processare
            collect_feedback: Se True, raccoglie e registra feedback

        Returns:
            PhaseResults con metriche aggregate
        """
        started_at = datetime.now().isoformat()
        start_time = asyncio.get_event_loop().time()

        results = []
        phase_feedbacks = 0
        phase_persisted = 0

        for i, query_data in enumerate(queries):
            # Esegui query
            query_result = await self._process_query(
                query_data,
                collect_feedback=collect_feedback
            )
            results.append(query_result)

            # Conta feedback
            phase_feedbacks += len(query_result.feedbacks)
            if collect_feedback:
                phase_persisted += len(query_result.feedbacks)

            # Progress update
            progress = (i + 1) / len(queries)
            self._report_progress(phase_name, progress)

        # Aggrega metriche
        confidences = [r.response.confidence if hasattr(r.response, "confidence") else 0.5
                      for r in results]
        sg_scores = [r.objective_metrics.source_grounding for r in results]
        hr_scores = [r.objective_metrics.hallucination_rate for r in results]

        # Snapshot pesi e authority
        weight_snapshot = await self._get_current_weights()
        user_authorities = {
            u.user_id: u.current_authority
            for u in self.user_pool.users
        }

        end_time = asyncio.get_event_loop().time()

        # Aggiorna totali
        self._total_feedbacks += phase_feedbacks
        self._total_persisted += phase_persisted

        return PhaseResults(
            phase_name=phase_name,
            queries_processed=len(queries),
            results=results,
            total_feedbacks=phase_feedbacks,
            feedbacks_persisted=phase_persisted,
            avg_confidence=sum(confidences) / len(confidences) if confidences else 0,
            avg_source_grounding=sum(sg_scores) / len(sg_scores) if sg_scores else 0,
            avg_hallucination_rate=sum(hr_scores) / len(hr_scores) if hr_scores else 0,
            weight_snapshot=weight_snapshot,
            user_authorities=user_authorities,
            duration_seconds=end_time - start_time,
            started_at=started_at,
        )

    async def _process_query(
        self,
        query_data: Dict[str, Any],
        collect_feedback: bool
    ) -> QueryResult:
        """
        Processa una singola query.

        Steps:
        1. Esegue expert system
        2. Calcola metriche oggettive
        3. (Opzionale) Valuta con LLM-as-Judge
        4. (Opzionale) Sintetizza e registra feedback
        """
        query_id = query_data.get("id", "unknown")
        query_text = query_data.get("text", "")
        gold_urns = query_data.get("relevant_urns", [])

        start_time = asyncio.get_event_loop().time()

        # 1. Esegui expert system
        response = await self._execute_expert(query_text)

        # 2. Calcola metriche oggettive
        context = {
            "gold_urns": gold_urns,
            "valid_urns": set(),  # Popolato dal DB
        }
        objective = self.objective_evaluator.evaluate(response, context)

        # 3. Valuta con LLM-as-Judge (se abilitato)
        subjective = None
        if self.llm_judge and self.config.use_llm_judge:
            try:
                subjective = await self.llm_judge.evaluate(query_text, response)
            except Exception as e:
                logger.warning(f"LLM Judge error: {e}")

        # 4. Sintetizza feedback
        feedbacks = []
        if collect_feedback and subjective:
            feedbacks = await self._collect_feedbacks(
                response, objective, subjective
            )

        end_time = asyncio.get_event_loop().time()

        return QueryResult(
            query_id=query_id,
            query_text=query_text,
            expert_type=response.expert_type if hasattr(response, "expert_type") else "unknown",
            response=response,
            objective_metrics=objective,
            subjective_metrics=subjective,
            feedbacks=feedbacks,
            execution_time_ms=(end_time - start_time) * 1000,
        )

    async def _execute_expert(self, query: str) -> Any:
        """Esegue il sistema expert o mock."""
        if self.expert_system:
            return await self.expert_system.interpret(query)
        else:
            # Mock response per testing
            return MockExpertResponse(query)

    async def _collect_feedbacks(
        self,
        response: Any,
        objective: ObjectiveMetrics,
        subjective: SubjectiveMetrics
    ) -> List[SimulatedFeedback]:
        """
        Raccoglie feedback da utenti sintetici.
        """
        feedbacks = []

        # Seleziona utenti che forniranno feedback
        active_users = [u for u in self.user_pool.users if u.should_provide_feedback()]

        for user in active_users:
            # Sintetizza feedback
            feedback = self.feedback_synthesizer.synthesize(
                user, objective, subjective
            )
            feedbacks.append(feedback)

            # Registra nel RLCF (se disponibile)
            if self.orchestrator:
                try:
                    await self.orchestrator.record_expert_feedback(
                        expert_type=response.expert_type if hasattr(response, "expert_type") else "unknown",
                        response=response,
                        **feedback.to_rlcf_format()
                    )
                except Exception as e:
                    logger.warning(f"RLCF recording error: {e}")

            # Aggiorna authority utente
            # IMPORTANTE: passa feedback_accuracy per aggiornare correttamente il track_record
            user.record_feedback(
                feedback.to_dict(),
                quality_score=feedback.quality_score,
                feedback_accuracy=feedback.feedback_accuracy,
            )

        return feedbacks

    def _load_queries(self) -> List[Dict[str, Any]]:
        """
        Carica query per l'esperimento.

        Prova a caricare dal gold standard, altrimenti usa query di default.
        """
        try:
            from merlt.benchmark.gold_standard import create_expanded_gold_standard
            gold = create_expanded_gold_standard()
            return [
                {
                    "id": q.id,
                    "text": q.text,
                    "category": q.category.value if hasattr(q.category, "value") else str(q.category),
                    "relevant_urns": q.relevant_urns,
                }
                for q in gold.queries
            ]
        except ImportError:
            logger.warning("Gold standard not available, using default queries")
            return self._get_default_queries()

    def _get_default_queries(self) -> List[Dict[str, Any]]:
        """Query di default per il Libro IV."""
        return [
            {"id": "Q001", "text": "Quali sono i requisiti essenziali del contratto?", "relevant_urns": ["1325"]},
            {"id": "Q002", "text": "Quando il debitore è in mora?", "relevant_urns": ["1219", "1220"]},
            {"id": "Q003", "text": "Come si determina il risarcimento del danno?", "relevant_urns": ["1223", "1226"]},
            {"id": "Q004", "text": "Quali sono le cause di risoluzione del contratto?", "relevant_urns": ["1453", "1454"]},
            {"id": "Q005", "text": "Quando è ammessa la compensazione tra debiti?", "relevant_urns": ["1241", "1242"]},
            {"id": "Q006", "text": "Quali sono gli effetti della nullità del contratto?", "relevant_urns": ["1418", "1419"]},
            {"id": "Q007", "text": "Come si perfeziona la cessione del credito?", "relevant_urns": ["1260", "1264"]},
            {"id": "Q008", "text": "Quali sono i limiti della responsabilità del debitore?", "relevant_urns": ["1218", "1225"]},
            {"id": "Q009", "text": "Quando opera la clausola risolutiva espressa?", "relevant_urns": ["1456"]},
            {"id": "Q010", "text": "Come si calcola la prescrizione delle obbligazioni?", "relevant_urns": ["2934", "2935"]},
            # Aggiungi altre per training
            {"id": "Q011", "text": "Cos'è l'obbligazione naturale?", "relevant_urns": ["2034"]},
            {"id": "Q012", "text": "Quali sono gli effetti del pagamento dell'indebito?", "relevant_urns": ["2033"]},
            {"id": "Q013", "text": "Come opera la novazione?", "relevant_urns": ["1230", "1231"]},
            {"id": "Q014", "text": "Cos'è la delegazione?", "relevant_urns": ["1268", "1269"]},
            {"id": "Q015", "text": "Quando si verifica l'impossibilità sopravvenuta?", "relevant_urns": ["1256", "1463"]},
            {"id": "Q016", "text": "Quali sono i tipi di vendita?", "relevant_urns": ["1470", "1471"]},
            {"id": "Q017", "text": "Cos'è la garanzia per evizione?", "relevant_urns": ["1483", "1484"]},
            {"id": "Q018", "text": "Quando opera la locazione?", "relevant_urns": ["1571", "1572"]},
            {"id": "Q019", "text": "Cos'è il mandato?", "relevant_urns": ["1703", "1704"]},
            {"id": "Q020", "text": "Come opera il mutuo?", "relevant_urns": ["1813", "1814"]},
        ] + [
            {"id": f"Q{i:03d}", "text": f"Query di training {i}", "relevant_urns": []}
            for i in range(21, 121)  # 100 query aggiuntive per training
        ]

    async def _record_weights(self, label: str):
        """Registra snapshot dei pesi correnti."""
        weights = await self._get_current_weights()
        self._weight_history.append({
            "label": label,
            "timestamp": datetime.now().isoformat(),
            "weights": weights,
        })

    def _record_authorities(self, label: str):
        """Registra snapshot delle authority degli utenti."""
        authorities = {
            u.user_id: {
                "profile": u.profile_type,
                "authority": u.current_authority,
                "track_record": u.track_record,
                "feedback_count": len(u.feedback_history),
            }
            for u in self.user_pool.users
        }
        self._authority_history.append({
            "label": label,
            "timestamp": datetime.now().isoformat(),
            "authorities": authorities,
        })

    async def _get_current_weights(self) -> Dict[str, Any]:
        """
        Ottiene pesi correnti dal weight store.

        Returns:
            Dict con pesi per tracking. Contiene 'mock': True se WeightStore non disponibile.
        """
        if self.weight_store:
            try:
                # get_weights() è async e ritorna WeightConfig (Pydantic)
                config = await self.weight_store.get_weights()

                # Estrai pesi rilevanti per tracking
                return {
                    "mock": False,
                    "retrieval_alpha": config.retrieval.alpha.default,
                    "expert_traversal": {
                        expert_name: {
                            rel_type: w.default
                            for rel_type, w in expert_weights.weights.items()
                        }
                        for expert_name, expert_weights in config.expert_traversal.items()
                    },
                    "gating": {
                        expert_name: w.default
                        for expert_name, w in config.gating.expert_priors.items()
                    },
                    "rlcf": {
                        "baseline_credentials": config.rlcf.baseline_credentials.default,
                        "track_record": config.rlcf.track_record.default,
                        "recent_performance": config.rlcf.recent_performance.default,
                    },
                }
            except Exception as e:
                logger.warning(f"Error getting weights from store: {e}")
        return {"mock": True, "alpha": 0.7}

    def _report_progress(self, phase: str, progress: float):
        """Report progress to callback if available."""
        if self.progress_callback:
            self.progress_callback(phase, progress)


@dataclass
class MockExpertResponse:
    """Mock response per testing senza expert system reale."""

    query: str
    expert_type: str = "mock"
    interpretation: str = "Mock interpretation for testing"
    confidence: float = 0.75
    execution_time_ms: float = 100.0
    legal_basis: List[Any] = field(default_factory=list)
    reasoning_steps: List[Any] = field(default_factory=list)
    tokens_used: int = 500

    def __post_init__(self):
        # Genera interpretazione basata sulla query
        self.interpretation = f"Risposta mock per: {self.query}"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "expert_type": self.expert_type,
            "interpretation": self.interpretation,
            "confidence": self.confidence,
            "execution_time_ms": self.execution_time_ms,
        }
