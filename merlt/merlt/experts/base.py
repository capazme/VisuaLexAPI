"""
Expert Base Classes
====================

Classi base per gli Expert del sistema multi-expert interpretativo.

Gli Expert sono basati sui criteri interpretativi delle Preleggi (art. 12-14 disp. prel. c.c.):
- LiteralExpert: "significato proprio delle parole" (art. 12, I)
- SystemicExpert: "connessione di esse" + storico (art. 12, I + art. 14)
- PrinciplesExpert: "intenzione del legislatore" (art. 12, II)
- PrecedentExpert: Applicazione giurisprudenziale (prassi)

Architettura:
    Query → ExpertRouter → [Expert1, Expert2, ...] → GatingNetwork → Response
                              ↓                          ↓
                          Tools (search, graph)     Synthesizer

Ogni Expert:
- Ha tools specifici per il proprio approccio
- Usa traversal weights configurabili
- Produce ExpertResponse strutturata con provenance
"""

import structlog
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime
from pathlib import Path
import yaml

from merlt.tools import BaseTool, ToolResult, ToolRegistry
from merlt.experts.prompt_loader import get_prompt_loader

# Type hints per evitare circular imports
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from merlt.rlcf.policy_manager import PolicyManager
    from merlt.rlcf.execution_trace import ExecutionTrace

log = structlog.get_logger()


@dataclass
class ExpertContext:
    """
    Input context per gli Expert.

    Contiene tutte le informazioni necessarie per il reasoning legale.

    Attributes:
        query_text: Domanda originale dell'utente
        query_embedding: Embedding della query (per retrieval)
        entities: Entità estratte (norme, concetti, etc.)
        retrieved_chunks: Chunks già recuperati (opzionale)
        metadata: Metadati aggiuntivi
        trace_id: ID per tracing
    """
    query_text: str
    query_embedding: Optional[List[float]] = None
    entities: Dict[str, List[str]] = field(default_factory=dict)
    retrieved_chunks: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    trace_id: str = field(default_factory=lambda: datetime.now().strftime("%Y%m%d_%H%M%S_%f"))

    @property
    def norm_references(self) -> List[str]:
        """Riferimenti normativi estratti."""
        return self.entities.get("norm_references", [])

    @property
    def legal_concepts(self) -> List[str]:
        """Concetti giuridici estratti."""
        return self.entities.get("legal_concepts", [])


@dataclass
class LegalSource:
    """
    Fonte giuridica citata nel reasoning.

    Traccia la provenance di ogni affermazione.

    Attributes:
        source_type: Tipo (norm, jurisprudence, doctrine, constitutional)
        source_id: URN o identificativo univoco
        citation: Citazione formale (es. "Art. 1321 c.c.")
        excerpt: Estratto rilevante
        relevance: Perché questa fonte è rilevante
    """
    source_type: str  # norm, jurisprudence, doctrine, constitutional
    source_id: str
    citation: str
    excerpt: str = ""
    relevance: str = ""
    relevance_score: float = 0.0  # Normalized 0-1 score for ranking/training

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_type": self.source_type,
            "source_id": self.source_id,
            "citation": self.citation,
            "excerpt": self.excerpt,
            "relevance": self.relevance,
            "relevance_score": self.relevance_score,
        }


@dataclass
class ReasoningStep:
    """
    Singolo step del ragionamento.

    Attributes:
        step_number: Numero progressivo
        description: Descrizione dello step
        sources: ID delle fonti usate
    """
    step_number: int
    description: str
    sources: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step_number": self.step_number,
            "description": self.description,
            "sources": self.sources
        }


@dataclass
class RelationUsage:
    """
    Traccia l'uso di un tipo di relazione durante l'esplorazione del grafo.

    Usato per RLCF feedback loop per aggiornare traversal weights.

    Attributes:
        relation_type: Tipo di relazione (es. "RIFERIMENTO", "CITATO_DA")
        usage_count: Numero di volte usata
        sources_found: Numero di fonti trovate tramite questa relazione
        sources_used_in_response: Fonti effettivamente usate nella risposta finale
        avg_relevance: Rilevanza media delle fonti trovate (post-feedback)
    """
    relation_type: str
    usage_count: int = 0
    sources_found: int = 0
    sources_used_in_response: int = 0
    avg_relevance: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "relation_type": self.relation_type,
            "usage_count": self.usage_count,
            "sources_found": self.sources_found,
            "sources_used_in_response": self.sources_used_in_response,
            "avg_relevance": self.avg_relevance
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "RelationUsage":
        return cls(
            relation_type=data["relation_type"],
            usage_count=data.get("usage_count", 0),
            sources_found=data.get("sources_found", 0),
            sources_used_in_response=data.get("sources_used_in_response", 0),
            avg_relevance=data.get("avg_relevance", 0.0)
        )


@dataclass
class ConfidenceFactors:
    """
    Breakdown del confidence score.

    Attributes:
        norm_clarity: Chiarezza della norma [0-1]
        jurisprudence_alignment: Allineamento con giurisprudenza [0-1]
        contextual_ambiguity: Ambiguità contestuale [0-1] (1 = molto ambiguo)
        source_availability: Disponibilità fonti [0-1]
    """
    norm_clarity: float = 0.5
    jurisprudence_alignment: float = 0.5
    contextual_ambiguity: float = 0.5
    source_availability: float = 0.5
    definition_coverage: float = 0.5

    def to_dict(self) -> Dict[str, float]:
        return {
            "norm_clarity": round(self.norm_clarity, 3),
            "jurisprudence_alignment": round(self.jurisprudence_alignment, 3),
            "contextual_ambiguity": round(self.contextual_ambiguity, 3),
            "source_availability": round(self.source_availability, 3),
            "definition_coverage": round(self.definition_coverage, 3),
        }

    def compute_overall(self) -> float:
        """
        Compute overall confidence from factors.

        Ambiguity reduces confidence, others increase it.
        """
        positive = (
            self.norm_clarity + self.source_availability +
            self.definition_coverage + self.jurisprudence_alignment
        ) / 4
        penalty = self.contextual_ambiguity * 0.3
        return max(0.0, min(1.0, positive - penalty))


@dataclass
class FeedbackHook:
    """
    F3-F7 Feedback hook per integrazione RLCF.

    Permette agli utenti di fornire feedback sugli output degli Expert.

    Attributes:
        feedback_type: Tipo di feedback (F3=Literal, F4=Systemic, F5=Principles, F6=Precedent, F7=Gating)
        expert_type: L'expert a cui si riferisce il feedback
        response_id: ID univoco collegato alla risposta
        enabled: Se la raccolta feedback è abilitata
        correction_options: Scelte di correzione per ogni dimensione
        context_snapshot: Snapshot del contesto per training (sources, confidence, etc.)
    """
    feedback_type: str  # F3, F4, F5, F6, F7
    expert_type: str
    response_id: str
    enabled: bool = True
    correction_options: Dict[str, List[str]] = field(default_factory=dict)
    context_snapshot: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "feedback_type": self.feedback_type,
            "expert_type": self.expert_type,
            "response_id": self.response_id,
            "enabled": self.enabled,
            "correction_options": self.correction_options,
            "context_snapshot": self.context_snapshot,
        }


@dataclass
class ExpertResponse:
    """
    Output strutturato di un Expert.

    Attributes:
        expert_type: Tipo di expert (literal, systemic, principles, precedent)
        section_header: Header italiano per UI display
        interpretation: Interpretazione principale (in italiano)
        legal_basis: Fonti giuridiche citate
        reasoning_steps: Passi del ragionamento
        confidence: Score di confidenza [0-1]
        confidence_factors: Breakdown della confidenza
        limitations: Cosa l'expert non ha potuto considerare
        suggestions: Suggerimenti per chiarimento (se bassa confidenza)
        trace_id: ID per tracing
        execution_time_ms: Tempo di esecuzione
        tokens_used: Token LLM usati
        feedback_hook: F3-F6 feedback hook per RLCF
    """
    expert_type: str
    section_header: str = ""
    interpretation: str = ""
    legal_basis: List[LegalSource] = field(default_factory=list)
    reasoning_steps: List[ReasoningStep] = field(default_factory=list)
    confidence: float = 0.5
    confidence_factors: ConfidenceFactors = field(default_factory=ConfidenceFactors)
    limitations: str = ""
    suggestions: str = ""
    trace_id: str = ""
    execution_time_ms: float = 0.0
    tokens_used: int = 0
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    feedback_hook: Optional[FeedbackHook] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        result = {
            "expert_type": self.expert_type,
            "section_header": self.section_header,
            "interpretation": self.interpretation,
            "legal_basis": [lb.to_dict() for lb in self.legal_basis],
            "reasoning_steps": [rs.to_dict() for rs in self.reasoning_steps],
            "confidence": round(self.confidence, 3),
            "confidence_factors": self.confidence_factors.to_dict(),
            "limitations": self.limitations,
            "suggestions": self.suggestions,
            "trace_id": self.trace_id,
            "execution_time_ms": round(self.execution_time_ms, 2),
            "tokens_used": self.tokens_used,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }
        if self.feedback_hook:
            result["feedback_hook"] = self.feedback_hook.to_dict()
        return result

    def is_low_confidence(self, threshold: float = 0.3) -> bool:
        """Check if response has low confidence."""
        return self.confidence < threshold


class BaseExpert(ABC):
    """
    Classe base astratta per tutti gli Expert.

    Ogni Expert:
    - Ha un tipo specifico (literal, systemic, principles, precedent)
    - Ha tools dedicati per il proprio approccio interpretativo
    - Ha traversal weights per il grafo
    - Produce ExpertResponse strutturata

    Esempio:
        >>> class LiteralExpert(BaseExpert):
        ...     expert_type = "literal"
        ...     description = "Interpretazione letterale"
        ...
        ...     async def analyze(self, context: ExpertContext) -> ExpertResponse:
        ...         # Tool calls + LLM reasoning
        ...         ...
    """

    # Sottoclassi devono definire questi attributi
    expert_type: str = ""
    description: str = ""

    def __init__(
        self,
        tools: Optional[List[BaseTool]] = None,
        config: Optional[Dict[str, Any]] = None,
        ai_service: Any = None,
        policy_manager: Optional["PolicyManager"] = None
    ):
        """
        Inizializza l'Expert.

        Args:
            tools: Lista di tools disponibili
            config: Configurazione (prompt, temperature, etc.)
            ai_service: Servizio AI per LLM calls
            policy_manager: PolicyManager per pesi traversal neurali (opzionale)
        """
        if not self.expert_type:
            raise ValueError("Expert must have an expert_type")
        if not self.description:
            raise ValueError("Expert must have a description")

        self.tools = tools or []
        self.config = config or {}
        self.ai_service = ai_service
        self.policy_manager = policy_manager

        # ExecutionTrace per RLCF (inizializzato per ogni query)
        self._current_trace: Optional["ExecutionTrace"] = None

        # Scientific tracing (pipeline observability)
        self._llm_call_traces: list = []
        self._tool_call_traces: list = []

        # Crea tool registry locale
        self._tool_registry = ToolRegistry()
        for tool in self.tools:
            self._tool_registry.register(tool)

        # Carica configurazione da YAML
        self._load_config()

        log.info(
            f"Expert initialized: {self.expert_type}",
            tools=len(self.tools),
            has_ai_service=self.ai_service is not None,
            has_policy_manager=self.policy_manager is not None
        )

    async def _traced_llm_call(self, prompt: str, **kwargs) -> Any:
        """Wrapper per chiamate LLM con tracing automatico."""
        import time as _time
        import uuid as _uuid

        call_id = _uuid.uuid4().hex[:8]
        started_at = datetime.now()
        t0 = _time.perf_counter()
        model = kwargs.get("model", getattr(self, "model", "unknown")) or "unknown"
        temperature = kwargs.get("temperature", getattr(self, "temperature", None))

        try:
            response = await self.ai_service.generate_response_async(prompt, **kwargs)
            duration_ms = (_time.perf_counter() - t0) * 1000

            # Extract token usage from response or service
            tokens_in, tokens_out = 0, 0
            if isinstance(response, dict):
                usage = response.get("usage", {})
                tokens_in = usage.get("prompt_tokens", 0)
                tokens_out = usage.get("completion_tokens", 0)
            if tokens_in == 0 and hasattr(self.ai_service, 'get_last_usage'):
                usage = self.ai_service.get_last_usage()
                tokens_in = usage.get("prompt_tokens", 0)
                tokens_out = usage.get("completion_tokens", 0)

            self._llm_call_traces.append({
                "call_id": call_id,
                "model": model,
                "prompt_summary": prompt[:200],
                "started_at": started_at.isoformat(),
                "completed_at": datetime.now().isoformat(),
                "duration_ms": round(duration_ms, 2),
                "tokens_input": tokens_in,
                "tokens_output": tokens_out,
                "temperature": temperature,
                "response_summary": str(response.get("content", response) if isinstance(response, dict) else response)[:200],
                "success": True,
                "error": None,
            })
            return response
        except Exception as e:
            duration_ms = (_time.perf_counter() - t0) * 1000
            self._llm_call_traces.append({
                "call_id": call_id,
                "model": model,
                "prompt_summary": prompt[:200],
                "started_at": started_at.isoformat(),
                "completed_at": datetime.now().isoformat(),
                "duration_ms": round(duration_ms, 2),
                "tokens_input": 0,
                "tokens_output": 0,
                "temperature": temperature,
                "response_summary": "",
                "success": False,
                "error": str(e)[:200],
            })
            raise

    def collect_and_reset_traces(self) -> dict:
        """Collect traces from LLM calls, tool objects, and ReAct history."""
        # LLM traces
        llm_calls = list(self._llm_call_traces)
        self._llm_call_traces.clear()

        # Tool traces — collected from TOOL OBJECTS, not self._tool_call_traces
        tool_calls = []
        if hasattr(self, '_tool_registry') and self._tool_registry:
            for tool in self._tool_registry.get_all():
                tool_calls.extend(tool.collect_and_reset_traces())

        # ReAct steps — from ReActMixin._react_result
        react_steps = []
        if hasattr(self, '_react_result') and self._react_result:
            for tao in self._react_result.history:
                react_steps.append(tao.to_dict())
            # Reset
            self._react_result = None
            self._react_history = []

        return {
            "llm_calls": llm_calls,
            "tool_calls": tool_calls,
            "react_steps": react_steps,
        }

    def _load_config(self):
        """Carica configurazione da YAML."""
        config_path = Path(__file__).parent / "config" / "experts.yaml"

        if config_path.exists():
            try:
                with open(config_path) as f:
                    all_config = yaml.safe_load(f)
                    expert_config = all_config.get("experts", {}).get(self.expert_type, {})
                    # Merge with instance config (instance config takes precedence)
                    expert_config.update(self.config)
                    self.config = expert_config
            except Exception as e:
                log.warning(f"Failed to load config: {e}")

        # Set defaults
        self.prompt_template = self.config.get("prompt_template", self._get_default_prompt())
        self.temperature = self.config.get("temperature", 0.3)
        self.model = self.config.get("model", "google/gemini-2.5-flash")

    def _get_default_prompt(self) -> str:
        """
        Carica il prompt template da YAML via PromptLoader.

        Se il prompt non e' trovato nel YAML, usa un fallback generico.
        """
        try:
            loader = get_prompt_loader()
            prompt = loader.get_prompt(self.expert_type)

            # Traccia l'utilizzo se disponibile
            loader.track_usage(
                expert_type=self.expert_type,
                prompt_name="system_prompt",
            )

            return prompt

        except Exception as e:
            log.warning(f"Failed to load prompt from YAML, using fallback: {e}")
            return self._get_fallback_prompt()

    def _get_fallback_prompt(self) -> str:
        """Prompt di fallback se YAML non disponibile."""
        return f"""Sei un esperto legale specializzato in {self.description}.

Analizza la domanda dell'utente seguendo rigorosamente il tuo approccio interpretativo.

## REGOLA FONDAMENTALE - SOURCE OF TRUTH

⚠️ DEVI usare ESCLUSIVAMENTE le fonti fornite nella sezione "FONTI RECUPERATE".
⚠️ NON PUOI citare articoli, sentenze o dottrina che NON sono presenti in quella sezione.
⚠️ Se le fonti recuperate sono insufficienti, indica un confidence basso e spiega nelle limitations.
⚠️ Se nessuna fonte è rilevante, imposta confidence=0.1 e spiega il problema.

Output in formato JSON con campi:
- interpretation: str (interpretazione basata SOLO sulle fonti recuperate)
- legal_basis: List[Dict] (fonti citate - DEVONO provenire da FONTI RECUPERATE)
- reasoning_steps: List[Dict] (passi del ragionamento)
- confidence: float (0.0-1.0) - abbassa se fonti insufficienti
- limitations: str (cosa non hai potuto considerare perché non nelle fonti)

CHECKLIST:
✅ Ogni fonte DEVE provenire dalla sezione FONTI RECUPERATE
✅ NON inventare MAI fonti non presenti
✅ Rispondi in italiano"""

    @property
    def traversal_weights(self) -> Dict[str, float]:
        """
        Pesi per il traversal del grafo.

        Ogni Expert ha pesi diversi che determinano quali
        relazioni privilegiare durante la ricerca.
        """
        return self.config.get("traversal_weights", {})

    @abstractmethod
    async def analyze(self, context: ExpertContext) -> ExpertResponse:
        """
        Analizza la query usando l'approccio interpretativo dell'Expert.

        Args:
            context: ExpertContext con query e dati recuperati

        Returns:
            ExpertResponse con interpretazione e fonti
        """
        pass

    async def use_tool(self, tool_name: str, **kwargs) -> ToolResult:
        """
        Usa un tool registrato.

        Tracing avviene automaticamente in BaseTool.__call__() e viene
        raccolto da collect_and_reset_traces().

        Args:
            tool_name: Nome del tool
            **kwargs: Parametri per il tool

        Returns:
            ToolResult
        """
        return await self._tool_registry.execute(tool_name, **kwargs)

    def get_tools_schema(self) -> List[Dict[str, Any]]:
        """
        Ottiene schema JSON di tutti i tools.

        Utile per passare a LLM per function calling.
        """
        return self._tool_registry.get_all_schemas()

    def _init_trace(self, context: ExpertContext) -> None:
        """
        Inizializza ExecutionTrace per questa query.

        Chiamato all'inizio di analyze() per tracciare tutte le azioni
        durante l'elaborazione della query.

        Args:
            context: ExpertContext con info sulla query
        """
        from merlt.rlcf.execution_trace import ExecutionTrace

        self._current_trace = ExecutionTrace(
            query_id=context.trace_id,
            metadata={
                "expert_type": self.expert_type,
                "query_text": context.query_text[:200] if context.query_text else ""
            }
        )

        log.debug(
            "ExecutionTrace initialized",
            trace_id=context.trace_id,
            expert_type=self.expert_type
        )

    def get_current_trace(self) -> Optional["ExecutionTrace"]:
        """
        Ottiene ExecutionTrace corrente.

        Returns:
            ExecutionTrace o None se non inizializzato
        """
        return self._current_trace

    def get_trace_dict(self) -> Optional[Dict[str, Any]]:
        """
        Ottiene ExecutionTrace come dizionario (per serializzazione).

        Returns:
            Dict rappresentazione del trace o None
        """
        if self._current_trace:
            return self._current_trace.to_dict()
        return None

    async def _get_policy_filtered_relations(
        self,
        context: ExpertContext
    ) -> List[str]:
        """
        Ottiene relazioni filtrate tramite PolicyManager.

        Se PolicyManager disponibile e query_embedding presente,
        usa TraversalPolicy per filtrare relazioni con peso >= threshold.
        Altrimenti ritorna tutte le relazioni da config.

        Args:
            context: ExpertContext con query_embedding

        Returns:
            Lista relazioni da usare per traversal
        """
        available_relations = list(self.traversal_weights.keys()) if self.traversal_weights else []

        if not available_relations:
            # Fallback a relazioni standard
            available_relations = [
                "RIFERIMENTO", "CITATO_DA", "MODIFICA", "MODIFICATO_DA",
                "RELATED_TO"
            ]

        # Se no policy manager o no embedding, usa tutte le relazioni
        if not self.policy_manager or not context.query_embedding:
            return available_relations

        # Usa PolicyManager per filtrare
        try:
            filtered = await self.policy_manager.filter_relations_by_weight(
                query_embedding=context.query_embedding,
                relation_types=available_relations,
                expert_type=self.expert_type,
                trace=self._current_trace
            )

            if filtered:
                log.debug(
                    "Relations filtered by policy",
                    input=len(available_relations),
                    output=len(filtered),
                    filtered=filtered
                )
                return filtered
            else:
                # Se tutte filtrate, usa almeno le top 3 statiche
                log.warning("All relations filtered, using top static weights")
                return available_relations[:3]

        except Exception as e:
            log.warning(f"Policy filtering failed, using all relations: {e}")
            return available_relations

    async def explore_iteratively(
        self,
        context: ExpertContext,
        max_iterations: int = 3,
        source_types: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """
        Esplorazione iterativa con semantic_search + graph_search.

        Ogni Expert può usare questo metodo per esplorare il knowledge graph
        in modo iterativo fino a convergenza.

        Flow per ogni iterazione:
        1. semantic_search con query o concetti estratti
        2. Estrai URN dai risultati
        3. graph_search sui nuovi URN
        4. Aggiungi nuove fonti
        5. Ripeti fino a convergenza o max_iterations

        Args:
            context: ExpertContext con query e dati iniziali
            max_iterations: Numero massimo di iterazioni
            source_types: Tipi di fonte da cercare (expert-specific)

        Returns:
            Lista di tutte le fonti trovate
        """
        all_sources = []
        explored_urns = set()
        exploration_history = []  # Per RLCF feedback

        # PHASE 2: Tracking relazioni usate per RLCF traversal learning
        relation_usage: Dict[str, RelationUsage] = {}

        # Inizia con chunks già recuperati
        if context.retrieved_chunks:
            all_sources.extend(context.retrieved_chunks)
            for chunk in context.retrieved_chunks:
                urn = chunk.get("article_urn") or chunk.get("urn")
                if urn:
                    explored_urns.add(urn)

        # Aggiungi URN da context.norm_references
        urns_to_explore = set(context.norm_references)

        semantic_tool = self._tool_registry.get("semantic_search")
        graph_tool = self._tool_registry.get("graph_search")

        for iteration in range(max_iterations):
            iteration_log = {
                "iteration": iteration + 1,
                "urns_explored": len(explored_urns),
                "sources_found": len(all_sources),
                "new_urns": 0,
                "new_sources": 0,
                "relations_used": {}  # PHASE 2: Relazioni usate in questa iterazione
            }

            # Step 1: Semantic search
            if semantic_tool and iteration == 0:
                # Prima iterazione: cerca con la query originale
                result = await semantic_tool(
                    query=context.query_text,
                    top_k=5,
                    expert_type=f"{self.expert_type.capitalize()}Expert",
                    source_types=source_types
                )
                if result.success and result.data.get("results"):
                    new_sources = result.data["results"]
                    for source in new_sources:
                        # Evita duplicati
                        source_id = source.get("chunk_id") or source.get("urn")
                        if source_id and not any(s.get("chunk_id") == source_id or s.get("urn") == source_id for s in all_sources):
                            all_sources.append(source)
                            iteration_log["new_sources"] += 1

                        # Estrai URN per graph expansion
                        urn = source.get("metadata", {}).get("article_urn") or source.get("urn")
                        if urn and urn not in explored_urns:
                            urns_to_explore.add(urn)
                            iteration_log["new_urns"] += 1

            # Step 2: Graph search su URN non ancora esplorati
            if graph_tool and urns_to_explore:
                urns_this_iteration = list(urns_to_explore - explored_urns)[:5]  # Limita a 5

                # RLCF: Ottieni relazioni filtrate da PolicyManager (se disponibile)
                filtered_relations = await self._get_policy_filtered_relations(context)

                for urn in urns_this_iteration:
                    explored_urns.add(urn)

                    try:
                        result = await graph_tool(
                            start_node=urn,
                            relation_types=filtered_relations,
                            max_hops=2,
                            direction="both"
                        )

                        if result.success:
                            # PHASE 2: Traccia relazioni usate
                            for edge in result.data.get("edges", []):
                                rel_type = edge.get("type", "UNKNOWN")
                                if rel_type not in relation_usage:
                                    relation_usage[rel_type] = RelationUsage(relation_type=rel_type)
                                relation_usage[rel_type].usage_count += 1

                                # Traccia anche nell'iteration log
                                if rel_type not in iteration_log["relations_used"]:
                                    iteration_log["relations_used"][rel_type] = 0
                                iteration_log["relations_used"][rel_type] += 1

                            for node in result.data.get("nodes", []):
                                node_urn = node.get("urn")
                                node_text = node.get("properties", {}).get("testo", "")

                                # PHASE 2: Trova la relazione che ha portato a questo nodo
                                source_relation = None
                                for edge in result.data.get("edges", []):
                                    if edge.get("target") == node_urn or edge.get("source") == node_urn:
                                        source_relation = edge.get("type", "UNKNOWN")
                                        break

                                # Evita nodi vuoti
                                if not node_text:
                                    continue

                                # Evita duplicati
                                if not any(s.get("urn") == node_urn for s in all_sources):
                                    all_sources.append({
                                        "text": node_text,
                                        "urn": node_urn,
                                        "type": node.get("type", ""),
                                        "source": "graph_exploration",
                                        "source_urn": urn,
                                        "iteration": iteration + 1,
                                        "via_relation": source_relation  # PHASE 2: Relazione che ha portato qui
                                    })
                                    iteration_log["new_sources"] += 1

                                    # PHASE 2: Aggiorna sources_found per la relazione
                                    if source_relation and source_relation in relation_usage:
                                        relation_usage[source_relation].sources_found += 1

                                # Aggiungi URN per prossima iterazione
                                if node_urn and node_urn not in explored_urns:
                                    urns_to_explore.add(node_urn)
                                    iteration_log["new_urns"] += 1

                    except Exception as e:
                        log.warning(f"Graph search failed for {urn}: {e}")

            exploration_history.append(iteration_log)

            log.debug(
                f"{self.expert_type} iteration {iteration + 1}",
                new_sources=iteration_log["new_sources"],
                new_urns=iteration_log["new_urns"],
                total_sources=len(all_sources),
                relations_used=list(iteration_log["relations_used"].keys())
            )

            # Convergenza: nessuna nuova fonte trovata
            if iteration_log["new_sources"] == 0 and iteration_log["new_urns"] == 0:
                log.info(
                    f"{self.expert_type} converged",
                    iterations=iteration + 1,
                    total_sources=len(all_sources),
                    total_urns=len(explored_urns)
                )
                break

        # Store exploration history per RLCF feedback
        self._exploration_history = exploration_history
        self._explored_urns = explored_urns
        # PHASE 2: Store relation usage per RLCF traversal learning
        self._relation_usage = relation_usage

        return all_sources

    def get_exploration_metrics(self) -> Dict[str, Any]:
        """
        Ottiene metriche dell'esplorazione per RLCF feedback.

        Returns:
            Dict con metriche: iterations, sources_per_iteration, convergence, etc.
        """
        history = getattr(self, '_exploration_history', [])
        explored = getattr(self, '_explored_urns', set())
        # PHASE 2: Relation usage tracking
        relation_usage = getattr(self, '_relation_usage', {})

        if not history:
            return {"status": "not_explored"}

        return {
            "iterations": len(history),
            "converged": history[-1]["new_sources"] == 0 if history else False,
            "total_sources": sum(h["new_sources"] for h in history),
            "total_urns_explored": len(explored),
            "sources_per_iteration": [h["new_sources"] for h in history],
            "history": history,
            # PHASE 2: Dati relazioni per RLCF traversal learning
            "relation_usage": {k: v.to_dict() for k, v in relation_usage.items()},
            "relation_types_used": list(relation_usage.keys()),
            "total_relation_traversals": sum(r.usage_count for r in relation_usage.values()),
        }

    def get_relation_usage(self) -> Dict[str, "RelationUsage"]:
        """
        Ottiene tracking uso relazioni per RLCF traversal weight learning.

        Returns:
            Dict mapping relation_type -> RelationUsage
        """
        return getattr(self, '_relation_usage', {})

    def update_relation_usage_from_response(
        self,
        response: "ExpertResponse",
        relevance_scores: Optional[Dict[str, float]] = None
    ) -> None:
        """
        Aggiorna relation usage in base alle fonti usate nella risposta.

        Chiamato dopo che l'utente fornisce feedback per tracciare
        quali relazioni hanno portato a fonti effettivamente usate.

        Args:
            response: ExpertResponse finale
            relevance_scores: Score rilevanza per fonte (da feedback utente)
        """
        relation_usage = getattr(self, '_relation_usage', {})
        if not relation_usage:
            return

        # Trova quali fonti sono state usate nella risposta
        used_source_ids = set()
        for source in response.legal_basis:
            used_source_ids.add(source.source_id)

        # Per ogni fonte usata, trova quale relazione l'ha portata
        exploration_history = getattr(self, '_exploration_history', [])
        for iteration in exploration_history:
            relations_used = iteration.get("relations_used", {})
            for rel_type in relations_used:
                if rel_type in relation_usage:
                    # Conta quante fonti da questa relazione sono state usate
                    # (semplificato: aggiungiamo 1 se la relazione è stata usata in questa iterazione)
                    if relations_used[rel_type] > 0:
                        relation_usage[rel_type].sources_used_in_response += 1

        # Aggiorna average relevance se fornita
        if relevance_scores:
            for rel_type, usage in relation_usage.items():
                if usage.sources_found > 0:
                    # Calcola media rilevanza per fonti da questa relazione
                    total_relevance = 0.0
                    count = 0
                    for source_id, score in relevance_scores.items():
                        # Semplificato: usa score medio
                        total_relevance += score
                        count += 1
                    if count > 0:
                        usage.avg_relevance = total_relevance / count

        self._relation_usage = relation_usage

    async def record_feedback(
        self,
        response: "ExpertResponse",
        user_rating: float,
        feedback_type: str = "accuracy",
        feedback_details: Optional[Dict[str, Any]] = None,
        rlcf_orchestrator: Optional[Any] = None,
        user_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Registra feedback dell'utente per apprendimento RLCF.

        Il feedback viene usato per:
        - Aggiornare traversal_weights per il grafo
        - Migliorare routing verso questo expert
        - Ottimizzare parametri di ricerca
        - Persistere nel database RLCF (se orchestrator fornito)

        Args:
            response: ExpertResponse su cui dare feedback
            user_rating: Rating 0-1 (0=scarso, 1=eccellente)
            feedback_type: Tipo di feedback (accuracy, utility, transparency)
            feedback_details: Dettagli aggiuntivi (es. fonti mancanti, errori)
            rlcf_orchestrator: RLCFOrchestrator per persistenza DB (opzionale)
            user_id: ID utente per authority tracking (opzionale)

        Returns:
            Dict con feedback registrato e suggerimenti di update
        """
        # Inizializza feedback history se non esiste
        if not hasattr(self, '_feedback_history'):
            self._feedback_history = []

        exploration_metrics = self.get_exploration_metrics()

        # PHASE 2: Aggiorna relation usage con dati dalla risposta
        if feedback_details and "relevance_scores" in feedback_details:
            self.update_relation_usage_from_response(
                response, feedback_details["relevance_scores"]
            )

        # PHASE 2: Ottieni relation usage aggiornato
        relation_usage = self.get_relation_usage()

        feedback_record = {
            "timestamp": datetime.now().isoformat(),
            "trace_id": response.trace_id,
            "expert_type": self.expert_type,
            "user_rating": user_rating,
            "feedback_type": feedback_type,
            "feedback_details": feedback_details or {},
            "response_confidence": response.confidence,
            "sources_used": len(response.legal_basis),
            "exploration_metrics": exploration_metrics,
            "current_traversal_weights": self.traversal_weights.copy() if self.traversal_weights else {},
            # PHASE 2: Relation usage per traversal weight learning
            "relation_usage": {k: v.to_dict() for k, v in relation_usage.items()},
        }

        # Persist to in-memory history
        self._feedback_history.append(feedback_record)

        # Calcola suggerimenti per aggiornamento pesi
        weight_updates = self._compute_weight_updates(
            user_rating,
            response,
            exploration_metrics
        )

        feedback_record["weight_update_suggestions"] = weight_updates

        # NEW: Persist to RLCF database via orchestrator
        if rlcf_orchestrator:
            try:
                rlcf_result = await rlcf_orchestrator.record_expert_feedback(
                    expert_type=self.expert_type,
                    response=response,
                    user_rating=user_rating,
                    feedback_type=feedback_type,
                    user_id=user_id,
                    feedback_details=feedback_details
                )
                feedback_record["rlcf_result"] = rlcf_result
                feedback_record["persisted_to_db"] = True

                log.info(
                    f"Feedback persisted to RLCF DB for {self.expert_type}",
                    feedback_id=rlcf_result.get("feedback_id"),
                    weights_updated=rlcf_result.get("weights_updated")
                )
            except Exception as e:
                log.error(
                    f"Failed to persist feedback to RLCF DB: {e}",
                    expert_type=self.expert_type,
                    trace_id=response.trace_id
                )
                feedback_record["rlcf_error"] = str(e)
                feedback_record["persisted_to_db"] = False
        else:
            feedback_record["persisted_to_db"] = False

        log.info(
            f"Feedback recorded for {self.expert_type}",
            rating=user_rating,
            trace_id=response.trace_id,
            updates_suggested=len(weight_updates),
            persisted=feedback_record.get("persisted_to_db", False)
        )

        return feedback_record

    def _compute_weight_updates(
        self,
        user_rating: float,
        response: "ExpertResponse",
        exploration_metrics: Dict[str, Any]
    ) -> Dict[str, float]:
        """
        Calcola suggerimenti di aggiornamento pesi basati sul feedback.

        Logica:
        - Se rating alto e fonte usata → aumenta peso della relazione
        - Se rating basso → diminuisci pesi correnti
        - Se convergenza rapida con buon rating → mantieni pesi

        Returns:
            Dict con delta per ogni peso (positivo = aumenta, negativo = diminuisci)
        """
        updates = {}
        learning_rate = 0.1  # Configurable

        if not self.traversal_weights:
            return updates

        # Fattore base: quanto cambiare i pesi
        if user_rating > 0.7:
            # Feedback positivo: rafforza pesi correnti
            factor = learning_rate * (user_rating - 0.5)
        elif user_rating < 0.3:
            # Feedback negativo: riduci pesi correnti
            factor = -learning_rate * (0.5 - user_rating)
        else:
            # Feedback neutro: nessun cambiamento
            return updates

        # Applica factor a tutti i pesi
        for relation, weight in self.traversal_weights.items():
            if relation != "default":
                updates[relation] = factor * weight

        return updates

    def apply_weight_updates(self, updates: Dict[str, float]) -> None:
        """
        Applica aggiornamenti ai traversal weights.

        Args:
            updates: Dict con delta per ogni relazione
        """
        if not self.traversal_weights:
            return

        for relation, delta in updates.items():
            if relation in self.traversal_weights:
                new_weight = self.traversal_weights[relation] + delta
                # Clamp tra 0.1 e 1.0
                self.traversal_weights[relation] = max(0.1, min(1.0, new_weight))

        # Aggiorna config
        self.config["traversal_weights"] = self.traversal_weights

        log.info(
            f"Weights updated for {self.expert_type}",
            updates=updates
        )

    def get_feedback_summary(self) -> Dict[str, Any]:
        """
        Ottiene riepilogo di tutto il feedback ricevuto.

        Returns:
            Dict con statistiche feedback per RLCF dashboard
        """
        history = getattr(self, '_feedback_history', [])

        if not history:
            return {"status": "no_feedback", "total": 0}

        ratings = [f["user_rating"] for f in history]

        return {
            "total_feedback": len(history),
            "average_rating": sum(ratings) / len(ratings) if ratings else 0,
            "min_rating": min(ratings) if ratings else 0,
            "max_rating": max(ratings) if ratings else 0,
            "by_type": self._group_by_type(history),
            "recent": history[-5:] if len(history) > 5 else history
        }

    def _group_by_type(self, history: List[Dict]) -> Dict[str, float]:
        """Raggruppa feedback per tipo."""
        by_type = {}
        for f in history:
            ftype = f.get("feedback_type", "unknown")
            if ftype not in by_type:
                by_type[ftype] = []
            by_type[ftype].append(f["user_rating"])

        return {
            t: sum(ratings) / len(ratings) if ratings else 0
            for t, ratings in by_type.items()
        }

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}(type={self.expert_type}, tools={len(self.tools)})>"


class ExpertWithTools(BaseExpert):
    """
    Expert con tools e integrazione LLM.

    Estende BaseExpert con:
    - ReAct-style tool calling (LLM decide quali tools usare)
    - Parsing strutturato delle risposte
    - Retry logic per JSON malformato

    Esempio:
        >>> expert = ExpertWithTools(
        ...     expert_type="literal",
        ...     description="Interpretazione letterale",
        ...     tools=[SemanticSearchTool(...)],
        ...     ai_service=openrouter_service
        ... )
        >>> response = await expert.analyze(context)
    """

    def __init__(
        self,
        expert_type: str,
        description: str,
        tools: Optional[List[BaseTool]] = None,
        config: Optional[Dict[str, Any]] = None,
        ai_service: Any = None
    ):
        # Set type and description before super().__init__
        self.__class__.expert_type = expert_type
        self.__class__.description = description
        super().__init__(tools=tools, config=config, ai_service=ai_service)

    async def analyze(self, context: ExpertContext) -> ExpertResponse:
        """
        Analizza usando LLM con tools.

        Flow:
        1. Formatta context per LLM
        2. LLM decide tool calls (se necessario)
        3. Esegue tools
        4. LLM produce risposta strutturata
        """
        import time
        start_time = time.time()

        if not self.ai_service:
            return ExpertResponse(
                expert_type=self.expert_type,
                interpretation="AI service non configurato",
                confidence=0.0,
                limitations="Impossibile analizzare senza servizio AI",
                trace_id=context.trace_id
            )

        try:
            # Step 1: Prepara prompt
            system_prompt = self._build_system_prompt()
            user_prompt = self._format_context(context)

            # Step 2: Call LLM
            llm_response = await self._call_llm(system_prompt, user_prompt)

            # Step 3: Parse response
            response = self._parse_response(llm_response, context)
            response.execution_time_ms = (time.time() - start_time) * 1000

            return response

        except Exception as e:
            log.error(f"Expert {self.expert_type} failed: {e}")
            return ExpertResponse(
                expert_type=self.expert_type,
                interpretation=f"Errore durante l'analisi: {str(e)}",
                confidence=0.0,
                limitations=str(e),
                trace_id=context.trace_id,
                execution_time_ms=(time.time() - start_time) * 1000
            )

    def _build_system_prompt(self) -> str:
        """Costruisce il system prompt."""
        tools_schema = self.get_tools_schema()

        prompt = self.prompt_template

        if tools_schema:
            prompt += "\n\nTools disponibili:\n"
            for tool in tools_schema:
                prompt += f"- {tool['name']}: {tool['description']}\n"

        return prompt

    def _format_context(self, context: ExpertContext) -> str:
        """Formatta ExpertContext per LLM."""
        sections = [
            f"## DOMANDA\n{context.query_text}",
        ]

        if context.norm_references:
            sections.append(f"\n## NORME CITATE\n" + ", ".join(context.norm_references))

        if context.legal_concepts:
            sections.append(f"\n## CONCETTI GIURIDICI\n" + ", ".join(context.legal_concepts))

        if context.retrieved_chunks:
            sections.append("\n## FONTI RECUPERATE")
            for i, chunk in enumerate(context.retrieved_chunks[:5], 1):
                text = chunk.get("text", "")[:300]
                sections.append(f"\n### Fonte {i}\n{text}...")

        return "\n".join(sections)

    async def _call_llm(
        self,
        system_prompt: str,
        user_prompt: str,
        max_retries: int = 3
    ) -> Dict[str, Any]:
        """Chiama LLM con retry per JSON."""
        import asyncio
        import json
        import time as _time
        import uuid as _uuid

        call_id = _uuid.uuid4().hex[:8]
        call_started = datetime.now()
        t0 = _time.perf_counter()

        for attempt in range(max_retries):
            try:
                response = await self.ai_service.generate_response_async(
                    prompt=f"{system_prompt}\n\n{user_prompt}",
                    model=self.model,
                    temperature=self.temperature,
                    response_format={"type": "json_object"}  # Garantisce JSON valido
                )

                # Parse content
                if isinstance(response, dict):
                    content = response.get("content", str(response))
                    usage = response.get("usage", {})
                    tokens_in = usage.get("prompt_tokens", 0)
                    tokens_out = usage.get("completion_tokens", 0)
                    tokens = usage.get("total_tokens", tokens_in + tokens_out)
                else:
                    content = str(response)
                    tokens_in = 0
                    tokens_out = 0
                    tokens = 0

                # Fallback: read usage from ai_service if response didn't include it
                if tokens_in == 0 and hasattr(self.ai_service, 'get_last_usage'):
                    svc_usage = self.ai_service.get_last_usage()
                    tokens_in = svc_usage.get("prompt_tokens", 0)
                    tokens_out = svc_usage.get("completion_tokens", 0)
                    tokens = svc_usage.get("total_tokens", tokens_in + tokens_out)

                # Clean markdown fences
                content = content.strip()
                if content.startswith("```json"):
                    content = content[7:]
                elif content.startswith("```"):
                    content = content[3:]
                if content.endswith("```"):
                    content = content[:-3]
                content = content.strip()

                # Validate JSON
                json.loads(content)

                duration_ms = (_time.perf_counter() - t0) * 1000

                # Record trace
                self._llm_call_traces.append({
                    "call_id": call_id,
                    "model": self.model or "unknown",
                    "prompt_summary": user_prompt[:200],
                    "started_at": call_started.isoformat(),
                    "completed_at": datetime.now().isoformat(),
                    "duration_ms": round(duration_ms, 2),
                    "tokens_input": tokens_in,
                    "tokens_output": tokens_out,
                    "temperature": self.temperature,
                    "response_summary": content[:200],
                    "success": True,
                    "error": None,
                })

                return {"content": content, "tokens_used": tokens}

            except json.JSONDecodeError:
                if attempt == max_retries - 1:
                    duration_ms = (_time.perf_counter() - t0) * 1000
                    self._llm_call_traces.append({
                        "call_id": call_id,
                        "model": self.model or "unknown",
                        "prompt_summary": user_prompt[:200],
                        "started_at": call_started.isoformat(),
                        "completed_at": datetime.now().isoformat(),
                        "duration_ms": round(duration_ms, 2),
                        "tokens_input": 0,
                        "tokens_output": 0,
                        "temperature": self.temperature,
                        "response_summary": "",
                        "success": False,
                        "error": "JSON decode failed after retries",
                    })
                    raise
                await asyncio.sleep(0.5 * (2 ** attempt))

            except Exception as e:
                duration_ms = (_time.perf_counter() - t0) * 1000
                self._llm_call_traces.append({
                    "call_id": call_id,
                    "model": self.model or "unknown",
                    "prompt_summary": user_prompt[:200],
                    "started_at": call_started.isoformat(),
                    "completed_at": datetime.now().isoformat(),
                    "duration_ms": round(duration_ms, 2),
                    "tokens_input": 0,
                    "tokens_output": 0,
                    "temperature": self.temperature,
                    "response_summary": "",
                    "success": False,
                    "error": str(e)[:200],
                })
                log.error(f"LLM call failed: {e}")
                raise

    def _parse_response(
        self,
        llm_response: Dict[str, Any],
        context: ExpertContext
    ) -> ExpertResponse:
        """Parse LLM response in ExpertResponse."""
        import json

        content = llm_response["content"]

        try:
            data = json.loads(content)
        except json.JSONDecodeError:
            # Fallback
            data = {
                "interpretation": content[:1000],
                "confidence": 0.3,
                "limitations": "Failed to parse structured response"
            }

        # Build legal basis
        legal_basis = []
        for lb in data.get("legal_basis", []):
            legal_basis.append(LegalSource(
                source_type=lb.get("source_type", "norm"),
                source_id=lb.get("source_id", ""),
                citation=lb.get("citation", ""),
                excerpt=lb.get("excerpt", ""),
                relevance=lb.get("relevance", "")
            ))

        # Build reasoning steps
        reasoning_steps = []
        for rs in data.get("reasoning_steps", []):
            reasoning_steps.append(ReasoningStep(
                step_number=rs.get("step_number", 0),
                description=rs.get("description", ""),
                sources=rs.get("sources", [])
            ))

        # Build confidence factors
        cf_data = data.get("confidence_factors", {})
        confidence_factors = ConfidenceFactors(
            norm_clarity=cf_data.get("norm_clarity", 0.5),
            jurisprudence_alignment=cf_data.get("jurisprudence_alignment", 0.5),
            contextual_ambiguity=cf_data.get("contextual_ambiguity", 0.5),
            source_availability=cf_data.get("source_availability", 0.5)
        )

        return ExpertResponse(
            expert_type=self.expert_type,
            interpretation=data.get("interpretation", ""),
            legal_basis=legal_basis,
            reasoning_steps=reasoning_steps,
            confidence=data.get("confidence", 0.5),
            confidence_factors=confidence_factors,
            limitations=data.get("limitations", ""),
            trace_id=context.trace_id,
            tokens_used=llm_response.get("tokens_used", 0)
        )
