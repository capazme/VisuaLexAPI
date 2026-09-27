"""
Integrazione del simulatore RLCF con i componenti reali di MERL-T.

Questo modulo fornisce:
1. RealExpertSystemAdapter: wrapper per LegalKnowledgeGraph.interpret()
2. RealRLCFAdapter: wrapper per RLCFOrchestrator
3. IntegratedExperiment: factory per creare esperimenti con componenti reali
"""

import logging
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


@dataclass
class AdaptedExpertResponse:
    """
    Risposta expert adattata per il simulatore.

    Converte InterpretationResult in un formato compatibile con
    ObjectiveEvaluator e FeedbackSynthesizer.
    """

    query: str
    expert_type: str
    interpretation: str
    confidence: float
    execution_time_ms: float
    legal_basis: List[Any] = field(default_factory=list)
    reasoning_steps: List[Any] = field(default_factory=list)
    tokens_used: int = 0
    expert_contributions: Dict[str, Any] = field(default_factory=dict)
    routing_decision: Optional[Dict] = None
    trace_id: str = ""

    @classmethod
    def from_interpretation_result(cls, result: Any, query: str) -> "AdaptedExpertResponse":
        """
        Converte InterpretationResult in AdaptedExpertResponse.

        Args:
            result: InterpretationResult da LegalKnowledgeGraph.interpret()
            query: Query originale

        Returns:
            AdaptedExpertResponse compatibile con il simulatore
        """
        # Estrai expert_type dalla routing decision
        routing = getattr(result, "routing_decision", {}) or {}
        expert_type = routing.get("query_type", "aggregated")

        # Estrai legal_basis
        legal_basis = []
        combined_basis = getattr(result, "combined_legal_basis", []) or []
        for basis in combined_basis:
            if isinstance(basis, dict):
                legal_basis.append(LegalSourceAdapter(
                    source_id=basis.get("urn", basis.get("source_id", "")),
                    source_type=basis.get("source_type", basis.get("type", "norm")),
                    relevance=basis.get("relevance", 0.5),
                    excerpt=basis.get("excerpt", ""),
                ))
            elif hasattr(basis, "to_dict"):
                bd = basis.to_dict()
                legal_basis.append(LegalSourceAdapter(
                    source_id=bd.get("urn", bd.get("source_id", "")),
                    source_type=bd.get("source_type", bd.get("type", "norm")),
                    relevance=bd.get("relevance", 0.5),
                    excerpt=bd.get("excerpt", ""),
                ))

        return cls(
            query=query,
            expert_type=expert_type,
            interpretation=getattr(result, "synthesis", str(result)),
            confidence=getattr(result, "confidence", 0.5),
            execution_time_ms=getattr(result, "execution_time_ms", 0),
            legal_basis=legal_basis,
            reasoning_steps=[],  # Potrebbe essere estratto da expert_contributions
            tokens_used=0,  # Non tracciato in InterpretationResult
            expert_contributions=getattr(result, "expert_contributions", {}),
            routing_decision=routing,
            trace_id=getattr(result, "trace_id", ""),
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "expert_type": self.expert_type,
            "interpretation": self.interpretation,
            "confidence": self.confidence,
            "execution_time_ms": self.execution_time_ms,
            "legal_basis": [lb.to_dict() for lb in self.legal_basis],
            "tokens_used": self.tokens_used,
            "trace_id": self.trace_id,
        }


@dataclass
class LegalSourceAdapter:
    """Adapter per fonti legali."""

    source_id: str
    source_type: str
    relevance: float
    excerpt: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_id": self.source_id,
            "source_type": self.source_type,
            "relevance": self.relevance,
            "excerpt": self.excerpt,
        }


class RealExpertSystemAdapter:
    """
    Adapter che wrappa LegalKnowledgeGraph per uso nel simulatore.

    Converte le chiamate e i risultati tra il formato del simulatore
    e il formato di LegalKnowledgeGraph.interpret().
    """

    def __init__(
        self,
        knowledge_graph: Any,
        max_experts: int = 4,
        aggregation_method: str = "weighted_average",
        timeout_seconds: float = 30.0,
    ):
        """
        Inizializza l'adapter.

        Args:
            knowledge_graph: Istanza di LegalKnowledgeGraph connessa
            max_experts: Numero massimo di expert da usare
            aggregation_method: Metodo di aggregazione
            timeout_seconds: Timeout per expert
        """
        self.kg = knowledge_graph
        self.max_experts = max_experts
        self.aggregation_method = aggregation_method
        self.timeout_seconds = timeout_seconds
        self._call_count = 0
        self._total_time_ms = 0.0

    async def interpret(self, query: str) -> AdaptedExpertResponse:
        """
        Esegue interpretazione sulla query.

        Wrappa LegalKnowledgeGraph.interpret() e converte il risultato.

        Args:
            query: Domanda in linguaggio naturale

        Returns:
            AdaptedExpertResponse compatibile con il simulatore
        """
        self._call_count += 1
        start_time = datetime.now()

        try:
            result = await self.kg.interpret(
                query=query,
                include_search=True,
                max_experts=self.max_experts,
                aggregation_method=self.aggregation_method,
                timeout_seconds=self.timeout_seconds,
            )

            elapsed_ms = (datetime.now() - start_time).total_seconds() * 1000
            self._total_time_ms += elapsed_ms

            return AdaptedExpertResponse.from_interpretation_result(result, query)

        except Exception as e:
            logger.error(f"Expert system error: {e}")
            # Ritorna risposta di fallback
            return AdaptedExpertResponse(
                query=query,
                expert_type="error",
                interpretation=f"Errore durante l'interpretazione: {str(e)}",
                confidence=0.0,
                execution_time_ms=(datetime.now() - start_time).total_seconds() * 1000,
            )

    def get_stats(self) -> Dict[str, Any]:
        """Ritorna statistiche di utilizzo."""
        return {
            "call_count": self._call_count,
            "total_time_ms": self._total_time_ms,
            "avg_time_ms": self._total_time_ms / max(self._call_count, 1),
        }


class RealRLCFAdapter:
    """
    Adapter che wrappa RLCFOrchestrator per uso nel simulatore.

    Gestisce la registrazione del feedback e l'aggiornamento dei pesi.
    """

    def __init__(self, rlcf_orchestrator: Any):
        """
        Inizializza l'adapter.

        Args:
            rlcf_orchestrator: Istanza di RLCFOrchestrator
        """
        self.orchestrator = rlcf_orchestrator
        self._feedback_count = 0
        self._successful_recordings = 0

    async def record_expert_feedback(
        self,
        expert_type: str,
        response: Any,
        user_rating: float,
        feedback_type: str = "accuracy",
        user_id: Optional[int] = None,
        feedback_details: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        Registra feedback per un expert response.

        Args:
            expert_type: Tipo di expert (literal, systemic, etc.)
            response: ExpertResponse o AdaptedExpertResponse
            user_rating: Rating utente (0-1)
            feedback_type: Tipo di feedback
            user_id: ID utente
            feedback_details: Dettagli aggiuntivi

        Returns:
            Dict con risultato della registrazione
        """
        self._feedback_count += 1

        try:
            # Converti AdaptedExpertResponse se necessario
            if isinstance(response, AdaptedExpertResponse):
                # Crea un oggetto compatibile con record_expert_feedback
                adapted_response = self._adapt_for_rlcf(response)
            else:
                adapted_response = response

            result = await self.orchestrator.record_expert_feedback(
                expert_type=expert_type,
                response=adapted_response,
                user_rating=user_rating,
                feedback_type=feedback_type,
                user_id=user_id,
                feedback_details=feedback_details,
            )

            self._successful_recordings += 1
            return result

        except Exception as e:
            logger.warning(f"RLCF recording error: {e}")
            return {
                "success": False,
                "error": str(e),
            }

    def _adapt_for_rlcf(self, response: AdaptedExpertResponse) -> Any:
        """
        Converte AdaptedExpertResponse per RLCFOrchestrator.

        Il RLCFOrchestrator si aspetta ExpertResponse con:
        - expert_type
        - interpretation
        - confidence
        - legal_basis
        - trace_id
        """
        # Crea un oggetto che ha gli attributi necessari
        class ResponseAdapter:
            def __init__(self, adapted: AdaptedExpertResponse):
                self.expert_type = adapted.expert_type
                self.interpretation = adapted.interpretation
                self.confidence = adapted.confidence
                self.legal_basis = adapted.legal_basis
                self.trace_id = adapted.trace_id
                self.execution_time_ms = adapted.execution_time_ms
                self.reasoning_steps = adapted.reasoning_steps

            def to_dict(self) -> Dict[str, Any]:
                return {
                    "expert_type": self.expert_type,
                    "interpretation": self.interpretation,
                    "confidence": self.confidence,
                    "trace_id": self.trace_id,
                }

        return ResponseAdapter(response)

    def get_stats(self) -> Dict[str, Any]:
        """Ritorna statistiche di utilizzo."""
        return {
            "feedback_count": self._feedback_count,
            "successful_recordings": self._successful_recordings,
            "success_rate": self._successful_recordings / max(self._feedback_count, 1),
        }


async def create_integrated_experiment(
    config: "ExperimentConfig",
    use_real_components: bool = True,
    graph_name: str = "merl_t_dev",
    falkordb_host: str = "localhost",
    falkordb_port: int = 6379,
    qdrant_host: str = "localhost",
    qdrant_port: int = 6333,
    progress_callback: Optional[Any] = None,
) -> "RLCFExperiment":
    """
    Factory per creare un esperimento RLCF con componenti reali.

    Args:
        config: Configurazione dell'esperimento
        use_real_components: Se True, usa componenti reali; altrimenti mock
        graph_name: Nome del grafo FalkorDB
        falkordb_host: Host FalkorDB
        falkordb_port: Porta FalkorDB
        qdrant_host: Host Qdrant
        qdrant_port: Porta Qdrant
        progress_callback: Callback per progress updates

    Returns:
        RLCFExperiment configurato
    """
    from merlt.rlcf.simulator.experiment import RLCFExperiment, ExperimentConfig

    if not use_real_components:
        # Usa mock (comportamento esistente)
        return RLCFExperiment(
            config=config,
            expert_system=None,
            rlcf_orchestrator=None,
            weight_store=None,
            progress_callback=progress_callback,
        )

    # Inizializza componenti reali
    logger.info("Initializing real MERL-T components...")

    # 1. LegalKnowledgeGraph
    from merlt import LegalKnowledgeGraph, MerltConfig

    kg_config = MerltConfig(
        graph_name=graph_name,
        falkordb_host=falkordb_host,
        falkordb_port=falkordb_port,
        qdrant_host=qdrant_host,
        qdrant_port=qdrant_port,
    )

    kg = LegalKnowledgeGraph(kg_config)
    await kg.connect()
    logger.info("LegalKnowledgeGraph connected")

    # Crea adapter per expert system
    expert_adapter = RealExpertSystemAdapter(
        knowledge_graph=kg,
        max_experts=4,
        aggregation_method="weighted_average",
        timeout_seconds=30.0,
    )

    # 2. RLCFOrchestrator (se disponibile)
    rlcf_adapter = None
    try:
        from merlt.rlcf import RLCFOrchestrator

        # Inizializza RLCF orchestrator
        rlcf = RLCFOrchestrator()
        rlcf_adapter = RealRLCFAdapter(rlcf)
        logger.info("RLCFOrchestrator initialized")
    except ImportError as e:
        logger.warning(f"RLCFOrchestrator not available: {e}")
    except Exception as e:
        logger.warning(f"Could not initialize RLCFOrchestrator: {e}")

    # 3. WeightStore (se disponibile)
    weight_store = None
    try:
        from merlt.weights import WeightStore
        weight_store = WeightStore()
        logger.info("WeightStore initialized")
    except ImportError:
        logger.warning("WeightStore not available")
    except Exception as e:
        logger.warning(f"Could not initialize WeightStore: {e}")

    # Crea esperimento
    experiment = RLCFExperiment(
        config=config,
        expert_system=expert_adapter,
        rlcf_orchestrator=rlcf_adapter,
        weight_store=weight_store,
        progress_callback=progress_callback,
    )

    # Salva riferimento a kg per cleanup
    experiment._knowledge_graph = kg

    return experiment


async def cleanup_experiment(experiment: "RLCFExperiment"):
    """
    Pulisce le risorse di un esperimento integrato.

    Args:
        experiment: Esperimento da pulire
    """
    if hasattr(experiment, "_knowledge_graph"):
        try:
            await experiment._knowledge_graph.close()
            logger.info("LegalKnowledgeGraph closed")
        except Exception as e:
            logger.warning(f"Error closing KnowledgeGraph: {e}")


# Aggiungi helper per verificare disponibilità componenti
def check_real_components() -> Dict[str, bool]:
    """
    Verifica quali componenti reali sono disponibili.

    Returns:
        Dict con stato di disponibilità per ogni componente
    """
    status = {
        "LegalKnowledgeGraph": False,
        "RLCFOrchestrator": False,
        "WeightStore": False,
        "FalkorDB": False,
        "Qdrant": False,
    }

    # Check imports
    try:
        from merlt import LegalKnowledgeGraph
        status["LegalKnowledgeGraph"] = True
    except ImportError:
        pass

    try:
        from merlt.rlcf import RLCFOrchestrator
        status["RLCFOrchestrator"] = True
    except ImportError:
        pass

    try:
        from merlt.weights import WeightStore
        status["WeightStore"] = True
    except ImportError:
        pass

    # Check services (basic connectivity)
    import socket

    def check_port(host: str, port: int) -> bool:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                s.connect((host, port))
                return True
        except (socket.error, socket.timeout):
            return False

    status["FalkorDB"] = check_port("localhost", 6380)  # FalkorDB default port
    status["Qdrant"] = check_port("localhost", 6333)

    return status
