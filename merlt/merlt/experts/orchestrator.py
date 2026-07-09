"""
Multi-Expert Orchestrator
==========================

Orchestratore centrale per il sistema multi-expert.

Il MultiExpertOrchestrator coordina:
1. ExpertRouter: Selezione degli Expert
2. Expert: Esecuzione parallela/sequenziale
3. AdaptiveSynthesizer: Sintesi adattiva con disagreement detection

Pipeline completa:
    Query → Router → [Experts in parallelo] → AdaptiveSynthesizer → SynthesisResult

Il sistema decide automaticamente se:
- CONVERGENT: Integrare le prospettive in risposta unificata
- DIVERGENT: Presentare alternative con spiegazione del conflitto

Esempio:
    >>> from merlt.experts import MultiExpertOrchestrator
    >>>
    >>> orchestrator = MultiExpertOrchestrator(ai_service=openrouter)
    >>> result = await orchestrator.process("Cos'è la legittima difesa?")
    >>> print(result.synthesis)
    >>> print(f"Mode: {result.mode}")
"""

import os
import structlog
import asyncio
import time
import numpy as np
from typing import Dict, Any, Optional, List, Type
from dataclasses import dataclass
from datetime import datetime

from merlt.experts.base import BaseExpert, ExpertContext, ExpertResponse, FeedbackHook
from merlt.experts.router import ExpertRouter, RoutingDecision
from merlt.experts.synthesizer import AdaptiveSynthesizer, SynthesisConfig, SynthesisResult, SynthesisMode
from merlt.experts.circuit_breaker import (
    CircuitBreakerRegistry,
    CircuitOpenError,
    get_expert_circuit_breaker,
    create_unavailable_response,
)
from merlt.experts.pipeline_types import (
    PipelineTrace,
    PipelineMetrics,
    ExpertExecution,
)

# Import opzionale per HybridExpertRouter (neural gating)
try:
    from merlt.experts.neural_gating import (
        HybridExpertRouter,
        HybridRoutingDecision,
        ExpertGatingMLP,
    )
    NEURAL_GATING_AVAILABLE = True
except ImportError:
    NEURAL_GATING_AVAILABLE = False
    HybridExpertRouter = None
    HybridRoutingDecision = None
from merlt.experts.literal import LiteralExpert
from merlt.experts.systemic import SystemicExpert
from merlt.experts.principles import PrinciplesExpert
from merlt.experts.precedent import PrecedentExpert
from merlt.experts.query_analyzer import (
    analyze_query, enrich_context, build_legal_references,
    legal_references_from_citations, merge_legal_references,
)
from merlt.clients import get_visualex_client
from merlt.tools import BaseTool
from merlt.tools.search import SemanticSearchTool
from merlt.rlcf.execution_trace import ExecutionTrace, Action

log = structlog.get_logger()


@dataclass
class OrchestratorConfig:
    """
    Configurazione dell'orchestratore.

    Attributes:
        selection_threshold: Soglia minima per selezionare un expert
        max_experts: Numero massimo di expert da invocare
        parallel_execution: Se eseguire in parallelo
        timeout_seconds: Timeout per ogni expert

    Note:
        La modalità di sintesi (convergent/divergent) è gestita
        automaticamente da AdaptiveSynthesizer tramite disagreement detection.
    """
    selection_threshold: float = 0.2
    expert_weight_threshold: float = 0.1
    max_experts: int = 4
    parallel_execution: bool = True
    timeout_seconds: float = 30.0
    enable_circuit_breaker: bool = True


class MultiExpertOrchestrator:
    """
    Orchestratore per il sistema multi-expert interpretativo.

    Coordina il flusso completo:
    1. Riceve una query
    2. Il Router decide quali Expert invocare
    3. Gli Expert analizzano in parallelo
    4. AdaptiveSynthesizer sintetizza con disagreement detection
    5. Ritorna SynthesisResult (convergent o divergent)

    Esempio:
        >>> # Setup base
        >>> orchestrator = MultiExpertOrchestrator(
        ...     synthesizer=AdaptiveSynthesizer(ai_service=openrouter)
        ... )
        >>> result = await orchestrator.process("Art. 52 c.p.")
        >>> print(result.mode)  # "convergent" o "divergent"
        >>>
        >>> # Con AI service e tools
        >>> tools = [SemanticSearchTool(...), GraphSearchTool(...)]
        >>> synthesizer = AdaptiveSynthesizer(ai_service=openrouter)
        >>> orchestrator = MultiExpertOrchestrator(
        ...     tools=tools,
        ...     ai_service=openrouter_service,
        ...     synthesizer=synthesizer,
        ...     config=OrchestratorConfig(max_experts=3)
        ... )
        >>> result = await orchestrator.process(
        ...     query="Interpretazione della legittima difesa",
        ...     entities={"norm_references": ["urn:norma:cp:art52"]}
        ... )
        >>> if result.mode == SynthesisMode.DIVERGENT:
        ...     for alt in result.alternatives:
        ...         print(f"- {alt['expert']}: {alt['position'][:50]}")
    """

    # Mapping tipo -> classe Expert
    EXPERT_CLASSES: Dict[str, Type[BaseExpert]] = {
        "literal": LiteralExpert,
        "systemic": SystemicExpert,
        "principles": PrinciplesExpert,
        "precedent": PrecedentExpert,
    }

    def __init__(
        self,
        synthesizer: AdaptiveSynthesizer,
        tools: Optional[List[BaseTool]] = None,
        ai_service: Any = None,
        config: Optional[OrchestratorConfig] = None,
        router: Optional[ExpertRouter] = None,
        hybrid_router: Optional["HybridExpertRouter"] = None,
        gating_policy: Optional[Any] = None,
        embedding_service: Optional[Any] = None,
        tool_selector: Optional[Any] = None,
        policy_manager: Optional[Any] = None,
    ):
        """
        Inizializza l'orchestratore.

        Args:
            synthesizer: AdaptiveSynthesizer per sintesi (OBBLIGATORIO)
            tools: Tools condivisi da tutti gli Expert
            ai_service: Servizio AI per LLM
            config: Configurazione orchestratore
            router: Router regex tradizionale (opzionale, usato come fallback)
            hybrid_router: HybridExpertRouter per neural+regex routing (preferito se presente)
            gating_policy: GatingPolicy per neural routing (legacy, usa hybrid_router invece)
            embedding_service: Servizio per encoding query (richiesto per neural routing)
        """
        self.synthesizer = synthesizer
        self.tools = tools or []
        self.ai_service = ai_service
        self.config = config or OrchestratorConfig()
        self.gating_policy = gating_policy
        self.embedding_service = embedding_service
        # Loop β E.3: optional tool-gating policy (ToolSelector). When None the
        # experts call all curated live tools (A.3 behavior, unchanged).
        self.tool_selector = tool_selector
        # B2: the shared PolicyManager (traversal head) threaded into every
        # expert so the RLCF-trained TraversalPolicy can score graph relations at
        # inference (needs a query_embedding — supplied by the embedding_service /
        # hybrid_router routing stage). None → static curated relation floor.
        self.policy_manager = policy_manager
        # B4: engage the ReAct (Thought-Action-Observation) reasoning loop at
        # inference. Off by default (single-shot LLM). Meaningful only WITH tools
        # (B1) — a ReAct loop with an empty tool registry has nothing to act on.
        # Read from RuntimeConfig (defaults from MERLT_REACT_ENABLED) so the admin
        # "Riavvia motore" reinitialize applies a toggled value.
        from merlt.config.runtime_config import get_runtime_config
        self._expert_use_react = get_runtime_config().get_bool("react_enabled", False)
        # Loop β C.2: strong refs to in-flight sedimentation tasks so fire-and-forget
        # background writes aren't garbage-collected before they complete.
        self._sediment_tasks: set = set()
        self._ner_mining_tasks: set = set()

        # Router: preferisce HybridExpertRouter se disponibile
        self.hybrid_router = hybrid_router
        self.router = router or ExpertRouter(ai_service=ai_service)

        # Determina strategia di routing
        if self.hybrid_router is not None:
            self._routing_strategy = "hybrid"
        elif self.gating_policy is not None and self.embedding_service is not None:
            self._routing_strategy = "neural_policy"
        else:
            self._routing_strategy = "regex"

        # Inizializza Expert
        self._experts: Dict[str, BaseExpert] = {}
        self._init_experts()

        log.info(
            "MultiExpertOrchestrator initialized",
            experts=list(self._experts.keys()),
            tools=len(self.tools),
            has_ai=ai_service is not None,
            routing_strategy=self._routing_strategy,
            has_hybrid_router=hybrid_router is not None,
            synthesis_mode=self.synthesizer.config.mode.value
        )

    # Loop β A.3 (B4): per-expert mcp-legal-it tool map, split by hermeneutic
    # canon (art. 12 preleggi). Core retrieval tools (semantic_search,
    # graph_search) and any other shared tool go to EVERY expert unchanged; only
    # the curated live legal tools are restricted per canon — precedent gets case
    # law (its unique value), principles gets doctrine, literal/systemic get norm
    # text. Tools not listed here (e.g. the ~180 calculators) reach no expert.
    EXPERT_MCP_TOOLS: Dict[str, set] = {
        "literal": {"cite_law", "fetch_law_article"},
        "systemic": {"cite_law"},
        "principles": {"cerca_brocardi", "cite_law"},
        "precedent": {
            "cerca_giurisprudenza",
            "cerca_giurisprudenza_cgue",
            "giurisprudenza_su_norma",
            "leggi_sentenza",
        },
    }

    def _init_experts(self):
        """Inizializza tutti gli Expert con tool instances separate.

        Each expert gets its own cloned tool instances so that
        collect_and_reset_traces() returns only that expert's traces.
        The clones share backend references (retriever, graph_db, etc.)
        but accumulate traces independently.

        Loop β A.3 (B4): the curated live mcp-legal-it tools are filtered per
        expert via EXPERT_MCP_TOOLS; all other tools are attached to every expert
        (backward-compatible when no MCP tools are present).
        """
        all_mcp = set().union(*self.EXPERT_MCP_TOOLS.values())
        for expert_type, expert_class in self.EXPERT_CLASSES.items():
            allowed_mcp = self.EXPERT_MCP_TOOLS.get(expert_type, set())
            expert_tools = [
                t.clone() for t in self.tools
                if t.name not in all_mcp or t.name in allowed_mcp
            ]
            # B4/B2: thread the ReAct toggle and the shared PolicyManager
            # (traversal head) into every expert. `config` merges over the YAML
            # (instance config wins) in _load_config, so use_react activates the
            # ReAct loop while temperature/model/max_tokens stay from experts.yaml.
            self._experts[expert_type] = expert_class(
                tools=expert_tools,
                ai_service=self.ai_service,
                config={"use_react": self._expert_use_react},
                policy_manager=self.policy_manager,
            )

    async def _sediment_live_sources(self, live_sources: List[Dict[str, Any]]) -> None:
        """Loop β C.2: write the query's live mcp-legal-it retrievals into the graph
        as provisional ``live_unconfirmed`` nodes (+ Qdrant chunks), so re-asking
        hits the graph instead of re-scraping.

        Runs as a fire-and-forget background task AFTER the answer is returned —
        fully failure-isolated, so a graph/Qdrant/MCP problem never affects the
        user-facing response. The writer is idempotent (MERGE on a deterministic
        node id), so repeated sedimentation of the same source is a no-op.
        """
        try:
            from merlt.pipeline.provisional_writer import write_provisional_sources
            written = await write_provisional_sources(
                live_sources,
                graph_client=None,  # writer self-builds an env-aware FalkorDBClient
                embeddings=self.embedding_service,
            )
            log.info("live sources sedimented into graph",
                     requested=len(live_sources), written=len(written))
        except Exception as exc:
            log.warning("live-source sedimentation failed (non-fatal)", error=str(exc))

    async def _mine_ner_confirmations(
        self, user_id: str, legal_references: List[Dict[str, Any]]
    ) -> None:
        """Loop β #2 (surface=search_mining): a successful query whose references
        grounded to a canonical URN seeds low-weight ``confirmation`` rows in the
        ``ner_feedback`` RLCF store, bootstrapping the learned-NER training set.

        Fire-and-forget, fully failure-isolated, and idempotent per (user_id, urn)
        via a deterministic feedback_id so repeated searches never flood the table.
        Privacy: only the grounded reference + canonical URN are stored — never
        the raw query text."""
        grounded = [r for r in (legal_references or []) if r.get("urn")]
        if not grounded:
            return
        try:
            import hashlib
            from datetime import datetime as _dt
            from sqlalchemy import select, func as safunc
            from merlt.storage.enrichment.database import get_db_session
            from merlt.storage.enrichment.models import NERFeedback, UserDomainAuthority

            async with get_db_session() as session:
                value = (await session.execute(
                    select(safunc.max(UserDomainAuthority.domain_authority)).where(
                        UserDomainAuthority.user_id == user_id
                    )
                )).scalar()
                authority = float(value) if value is not None else 0.5
                # Same [0.5, 2.0] mapping as ner_router.compute_sample_weight.
                weight = max(0.5, min(2.0, authority * 2.0))
                recorded = 0
                for ref in grounded:
                    urn = ref["urn"]
                    fid = "ner-mining-" + hashlib.sha256(
                        f"{user_id}|{urn}".encode("utf-8")
                    ).hexdigest()[:32]
                    exists = (await session.execute(
                        select(NERFeedback.id).where(NERFeedback.feedback_id == fid)
                    )).first()
                    if exists:
                        continue
                    session.add(NERFeedback(
                        feedback_id=fid,
                        source_surface="search_mining",
                        user_id=user_id,
                        article_urn=urn,
                        selected_text=ref.get("display"),
                        feedback_type="confirmation",
                        original_parsed=ref,
                        user_authority=authority,
                        sample_weight=weight,
                        created_at=_dt.utcnow(),
                    ))
                    recorded += 1
            log.info("ner search-mining confirmations recorded",
                     recorded=recorded, candidates=len(grounded), user_id=user_id)
        except Exception as exc:
            log.warning("ner search-mining failed (non-fatal)", error=str(exc))

    def _get_learned_ner(self):
        """Lazy singleton for the learned legal-reference NER (Loop β #2 P4).
        Loads models/legal_ner_latest (shared volume) or the it_core_news_lg
        base. Cached on the instance; None when unavailable."""
        if getattr(self, "_learned_ner", "unset") == "unset":
            self._learned_ner = None
            try:
                from merlt.ner.spacy_model import LegalNERModel
                model = LegalNERModel()
                self._learned_ner = model if model.is_ready() else None
            except Exception as exc:  # noqa: BLE001
                log.warning("learned NER unavailable", error=str(exc))
                self._learned_ner = None
        return self._learned_ner

    def _augment_with_learned_ner(
        self, query: str, refs: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Add learned-NER reference surfaces not already covered by
        parse_query/regex. Never replaces existing refs; deduped by display."""
        model = self._get_learned_ner()
        if model is None:
            return refs
        existing = {(r.get("display") or "").strip().lower() for r in refs}
        added: List[Dict[str, Any]] = []
        for cit in model.extract_citations(query):
            disp = (getattr(cit, "text", "") or "").strip()
            if disp and disp.lower() not in existing:
                existing.add(disp.lower())
                added.append({"display": disp, "urn": None, "act_type": None,
                              "article": None, "act_number": None, "date": None,
                              "source": "learned_ner"})
        if added:
            log.info("learned NER augmented references", added=len(added))
        return list(refs) + added

    # ------------------------------------------------------------------
    # Loop β E.3 — tool-gating policy hooks (failure-isolated, additive)
    # ------------------------------------------------------------------
    def _resolve_query_embedding(self, trace: "ExecutionTrace") -> Optional[List[float]]:
        """Pull the query embedding from the trace's RLCF actions (set by the
        routing stage). Returns None when no neural routing ran (no embedding)."""
        try:
            for action in trace.actions:
                emb = action.metadata.get("query_embedding")
                if emb:
                    return emb
        except Exception:
            pass
        return None

    def _apply_tool_gating(
        self,
        context: "ExpertContext",
        trace: "ExecutionTrace",
        selected_experts: List[Any],
    ) -> None:
        """Run the tool-gating policy, emit ``tool_use`` actions, and (treatment
        arm) write the pruned per-expert selection into the shared context so
        ``base.py`` calls only the chosen tools. No-op when the selector is
        absent/disabled or no query embedding is available."""
        if self.tool_selector is None:
            return
        try:
            query_embedding = self._resolve_query_embedding(trace)
            expert_types = [e[0] for e in selected_experts]
            selection = self.tool_selector.select_and_trace(
                query_embedding=query_embedding,
                expert_types=expert_types,
                query_id=trace.query_id,
                trace=trace,
            )
            if selection:
                # ExpertContext.entities defaults to {} (never None).
                context.entities["selected_live_tools"] = selection
        except Exception as exc:  # noqa: BLE001 - never break the answer path
            log.warning("tool-gating apply failed (fallback to all tools)", error=str(exc))

    def _merge_expert_traversal_actions(self, trace: "ExecutionTrace", responses: List[Any]) -> None:
        """Slice 4 L3: copy the experts' ``graph_traversal`` actions (recorded by
        the systemic expert's neural relation selection) into the orchestrator's
        persisted ExecutionTrace, so the decision reaches full_trace →
        (a) the traversal trainer can replay it, (b) the FE can show
        "relazioni percorse". Additive: the gating trainer filters on
        ``expert_selection`` + source, the tool trainer on ``tool_use`` +
        source — extra graph_traversal actions are invisible to both.
        Failure-isolated."""
        try:
            for r in responses:
                expert = self._experts.get(getattr(r, "expert_type", None))
                etrace = expert.get_current_trace() if expert else None
                if not etrace:
                    continue
                for action in etrace.actions:
                    if action.action_type == "graph_traversal":
                        trace.add_action(action)
        except Exception as exc:  # noqa: BLE001
            log.debug("graph_traversal action merge skipped", error=str(exc))

    def _annotate_tool_use_outcomes(self, trace: "ExecutionTrace", responses: List[Any]) -> None:
        """Mark each ``tool_use`` action with the observed outcome — did that
        (expert, tool) actually return a live source — so the tool-policy trainer
        can credit productive tools (Loop β E.3 signal a). Must run before the
        trace is serialized. Failure-isolated."""
        try:
            ran_types = {r.expert_type for r in responses}
            productive: set = set()
            for et in ran_types:
                expert = self._experts.get(et)
                for src in (getattr(expert, "_live_sources_retrieved", None) or []):
                    tool_name = src.get("tool_name")
                    if tool_name:
                        productive.add((et, tool_name))
            for action in trace.actions:
                if action.action_type != "tool_use":
                    continue
                et = action.metadata.get("expert_type")
                tool_name = action.parameters.get("tool_name")
                action.metadata["produced_source"] = (et, tool_name) in productive
        except Exception as exc:  # noqa: BLE001
            log.debug("tool_use outcome annotation skipped", error=str(exc))

    async def _apply_gating_policy(
        self,
        context: ExpertContext,
        trace: ExecutionTrace
    ) -> Dict[str, float]:
        """
        Applica GatingPolicy per calcolare pesi expert.

        Args:
            context: Contesto della query
            trace: ExecutionTrace per tracciare azioni

        Returns:
            Dict con pesi expert {expert_type: weight}
        """
        if not self.gating_policy:
            raise ValueError("GatingPolicy non fornita")

        if not self.embedding_service:
            raise ValueError("EmbeddingService richiesto per GatingPolicy")

        # Import torch per device handling
        try:
            import torch
        except ImportError:
            raise ImportError("PyTorch richiesto per GatingPolicy")

        # 1. Encode query
        query_embedding = await self.embedding_service.encode_query_async(
            context.query_text
        )

        # Slice 4 L3: expose the embedding to the experts (neural traversal).
        if context.query_embedding is None:
            context.query_embedding = (
                query_embedding.tolist()
                if hasattr(query_embedding, "tolist") else list(query_embedding)
            )

        # 2. Converti in tensor (usa cpu per evitare problemi MPS in test)
        query_tensor = torch.tensor(
            query_embedding,
            dtype=torch.float32,
            device="cpu"
        ).unsqueeze(0)  # [1, input_dim]

        # 3. Forward pass nella policy
        self.gating_policy.eval()  # Eval mode
        with torch.no_grad():
            weights_tensor, log_probs_tensor = self.gating_policy.forward(query_tensor)

        # 4. Converti in dict
        weights_numpy = weights_tensor.squeeze(0).cpu().numpy()
        log_probs_numpy = log_probs_tensor.squeeze(0).cpu().numpy()

        expert_types = list(self.EXPERT_CLASSES.keys())
        weights_dict = {}

        for i, expert_type in enumerate(expert_types):
            weight = float(weights_numpy[i])
            log_prob = float(log_probs_numpy[i])

            weights_dict[expert_type] = weight

            # Traccia azione di selezione expert con query_embedding per backprop
            trace.add_expert_selection(
                expert_type=expert_type,
                weight=weight,
                log_prob=log_prob,
                metadata={
                    "source": "gating_policy",
                    "query_embedding_dim": len(query_embedding),
                    "query_embedding": query_embedding.tolist(),  # Per REINFORCE backprop
                    "action_index": i  # Indice dell'expert per loss calculation
                }
            )

        log.info(
            "GatingPolicy applied",
            trace_id=context.trace_id,
            weights=weights_dict,
            total_log_prob=trace.total_log_prob
        )

        return weights_dict

    async def process(
        self,
        query: str,
        entities: Optional[Dict[str, List[str]]] = None,
        retrieved_chunks: Optional[List[Dict[str, Any]]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        return_trace: bool = False,
        include_trace: bool = False,
        max_experts: Optional[int] = None,
    ) -> SynthesisResult:
        """
        Processa una query attraverso il sistema multi-expert.

        Args:
            query: Query in linguaggio naturale
            entities: Entità estratte (norm_references, legal_concepts)
            retrieved_chunks: Chunks già recuperati
            metadata: Metadati aggiuntivi
            return_trace: Se True, ritorna (result, trace) invece di solo result
            include_trace: Se True, popola pipeline_trace nel risultato

        Returns:
            SynthesisResult con sintesi finale (o tuple se return_trace=True)
            - mode: "convergent" o "divergent"
            - synthesis: Testo sintesi
            - disagreement_analysis: Analisi del disagreement
            - alternatives: Liste alternative (solo in divergent mode)
        """
        start_time = time.perf_counter()

        # Clear per-pipeline retrieval cache
        SemanticSearchTool.clear_cache()

        trace_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")

        # Inizializza ExecutionTrace (RLCF)
        trace = ExecutionTrace(
            query_id=trace_id,
            metadata={
                "query": query,
                "has_gating_policy": self.gating_policy is not None
            }
        )

        # Inizializza PipelineTrace (scientific observability)
        pipeline_trace = PipelineTrace(
            trace_id=trace_id,
            query_text=query,
        ) if include_trace else None

        pipeline_metrics = PipelineMetrics() if include_trace else None

        # A per-request max_experts can only REDUCE the configured cap (never
        # exceed it), so a "give me a faster N-expert answer" request is honoured
        # while staying inside the routing/quality envelope. None → full cap. The
        # base cap is admin-tunable at runtime (RuntimeConfig), defaulting to the
        # orchestrator config.
        from merlt.config.runtime_config import get_runtime_config
        base_cap = get_runtime_config().get_int("max_experts", self.config.max_experts)
        effective_max_experts = base_cap
        if max_experts is not None:
            effective_max_experts = max(1, min(int(max_experts), base_cap))

        log.info(f"Processing query", query=query[:50], trace_id=trace_id)

        # Step 1: Analizza query per estrarre entità (NER stage)
        ner_t0 = time.perf_counter()
        query_analysis = analyze_query(query)

        # Loop β #2: enrich the regex NER with VisuaLex's shared citation infra.
        # It yields the CORRECT act type + canonical URN AND a human display
        # reference ("art. 1453 codice civile") that cite_law/fetch_law_article
        # actually accept — the raw URN was rejected, the root cause of #2/#3.
        # Best-effort: any failure falls back to the regex analysis above.
        legal_references: List[Dict[str, Any]] = []
        try:
            vlx = get_visualex_client()
            parse_result, citations = await asyncio.gather(
                vlx.parse_query(query), vlx.extract_citations(query),
                return_exceptions=True,
            )
            if isinstance(parse_result, Exception):
                parse_result = None
            if isinstance(citations, Exception):
                citations = None
            legal_references = merge_legal_references(
                build_legal_references(parse_result),
                legal_references_from_citations(citations),
            )
        except Exception as e:
            log.warning(
                "visualex NER enrichment failed; using regex fallback",
                error=str(e), trace_id=trace_id,
            )

        # Loop β #2 Phase 4: augment the references with the learned spaCy NER
        # when MERLT_NER_LEARNED_ENABLED is on AND a trained model is loaded.
        # Additive only (never replaces parse_query/regex); failure-isolated.
        if os.getenv("MERLT_NER_LEARNED_ENABLED", "false").lower() == "true":
            try:
                legal_references = self._augment_with_learned_ner(query, legal_references)
            except Exception as exc:  # noqa: BLE001
                log.warning("learned NER augmentation failed (non-fatal)", error=str(exc))

        ner_time_ms = (time.perf_counter() - ner_t0) * 1000

        log.info(
            "Query analyzed",
            articles=query_analysis.article_numbers,
            concepts=query_analysis.legal_concepts[:3] if query_analysis.legal_concepts else [],
            query_type=query_analysis.query_type,
            trace_id=trace_id
        )

        if pipeline_trace is not None:
            ner_entities = []
            for concept in (query_analysis.legal_concepts or []):
                ner_entities.append({"text": concept, "type": "LEGAL_CONCEPT"})
            for ref in (query_analysis.norm_references or []):
                ner_entities.append({"text": ref, "type": "NORM_REFERENCE"})
            pipeline_trace.ner_result = {
                "time_ms": round(ner_time_ms, 2),
                "entities": ner_entities,
                "query_type": query_analysis.query_type,
            }
            pipeline_trace.stage_times_ms["ner"] = ner_time_ms
            pipeline_metrics.ner_time_ms = ner_time_ms

        # Step 2: Costruisci context con entità estratte.
        # The FE "context basket" (the nodes the jurist selected as context)
        # arrives in `entities`; UNION it with the query-derived references
        # instead of overwriting, so a node chosen as context is honoured even
        # when the question ALSO names a norm/concept (nodes-as-context feature).
        # `dict(...)` copies so the caller's dict is never mutated.
        merged_entities = dict(entities or {})
        user_norms = list(merged_entities.get("norm_references") or [])
        user_concepts = list(merged_entities.get("legal_concepts") or [])
        # Prefer VisuaLex-derived URNs (correct act type); fall back to regex.
        norm_urns = [r["urn"] for r in legal_references if r.get("urn")]
        query_norms = norm_urns or query_analysis.norm_references or []
        merged_norms = list(dict.fromkeys(user_norms + list(query_norms)))
        if merged_norms:
            merged_entities["norm_references"] = merged_norms
        # Human display references for the reference-keyed live tools (cite_law…).
        if legal_references:
            merged_entities["legal_references"] = legal_references
        merged_concepts = list(dict.fromkeys(user_concepts + list(query_analysis.legal_concepts or [])))
        if merged_concepts:
            merged_entities["legal_concepts"] = merged_concepts
        if query_analysis.article_numbers:
            merged_entities["article_numbers"] = query_analysis.article_numbers

        # Loop β #2 (surface=search_mining): seed low-weight confirmations for
        # references that grounded to a canonical URN — bootstraps the learned
        # NER training set. Full-consent only, fire-and-forget, failure-isolated.
        _ner_meta = metadata or {}
        if _ner_meta.get("user_id") and _ner_meta.get("consent_level") == "full" and legal_references:
            _ner_task = asyncio.create_task(
                self._mine_ner_confirmations(_ner_meta["user_id"], legal_references)
            )
            self._ner_mining_tasks.add(_ner_task)
            _ner_task.add_done_callback(self._ner_mining_tasks.discard)

        context = ExpertContext(
            query_text=query,
            entities=merged_entities,
            retrieved_chunks=retrieved_chunks or [],
            metadata={
                **(metadata or {}),
                "query_analysis": {
                    "query_type": query_analysis.query_type,
                    "confidence": query_analysis.confidence,
                    "article_numbers": query_analysis.article_numbers,
                    "legal_concepts": query_analysis.legal_concepts,
                }
            },
            trace_id=trace_id
        )

        # B2: compute the query embedding up front when an embedding_service is
        # wired, so the RLCF-trained TraversalPolicy can score graph relations
        # even under regex routing — systemic._select_traversal_relations and
        # base.py gate on context.query_embedding being present. Best-effort: any
        # embedding failure just leaves the static curated relation floor.
        if self.embedding_service is not None and getattr(context, "query_embedding", None) is None:
            try:
                _enc = getattr(self.embedding_service, "encode_query", None) or getattr(self.embedding_service, "encode", None)
                if _enc is not None:
                    _emb = _enc(query)
                    if asyncio.iscoroutine(_emb):
                        _emb = await _emb
                    context.query_embedding = _emb.tolist() if hasattr(_emb, "tolist") else list(_emb)
            except Exception as _e:
                log.warning("query embedding failed — traversal head stays static", error=str(_e))

        # Step 3: Routing - strategia basata su configurazione
        routing_t0 = time.perf_counter()
        routing_used = "unknown"
        neural_confidence = None
        gating_scores = {}

        if self._routing_strategy == "hybrid" and self.hybrid_router is not None:
            routing_decision = await self.hybrid_router.route(context)
            routing_used = "neural" if routing_decision.neural_used else "llm_fallback"
            neural_confidence = routing_decision.neural_confidence
            gating_scores = routing_decision.expert_weights or {}

            log.info(
                "Hybrid routing decision",
                neural_used=routing_decision.neural_used,
                neural_confidence=routing_decision.neural_confidence,
                query_type=routing_decision.query_type,
                weights=routing_decision.expert_weights
            )

            trace.add_action(Action(
                action_type="routing",
                parameters={
                    "strategy": "hybrid",
                    "neural_used": routing_decision.neural_used,
                    "neural_confidence": routing_decision.neural_confidence,
                    "query_type": routing_decision.query_type,
                },
                log_prob=-0.1 if routing_decision.neural_used else -0.5,
            ))

            # Register expert_selection actions for RLCF training
            if routing_decision.neural_used and routing_decision.query_embedding is not None:
                if not routing_decision.expert_log_probs:
                    log.warning(
                        "expert_log_probs missing from routing decision, "
                        "RLCF trace will use fallback log_prob=-1.0"
                    )
                for expert_name, weight in routing_decision.expert_weights.items():
                    log_prob_val = (
                        routing_decision.expert_log_probs.get(expert_name, -1.0)
                        if routing_decision.expert_log_probs else -1.0
                    )
                    trace.add_action(Action(
                        action_type="expert_selection",
                        parameters={"weight": weight, "expert_type": expert_name},
                        log_prob=log_prob_val,
                        metadata={
                            "source": "neural_gating",
                            "query_embedding": routing_decision.query_embedding,
                        },
                    ))

            # Slice 4 L3: expose the routing-stage query embedding to the experts
            # so the TraversalPolicy can score relations per-query (systemic
            # neural traversal). Additive — nothing downstream required it before.
            if context.query_embedding is None and getattr(routing_decision, "query_embedding", None) is not None:
                emb = routing_decision.query_embedding
                context.query_embedding = emb.tolist() if hasattr(emb, "tolist") else list(emb)

            selected_experts = routing_decision.get_selected_experts(
                threshold=self.config.selection_threshold
            )[:effective_max_experts]

        elif self._routing_strategy == "neural_policy" and self.gating_policy and self.embedding_service:
            weights = await self._apply_gating_policy(context, trace)
            routing_used = "neural_policy"
            gating_scores = weights

            # Propagate query_embedding to PipelineTrace for downstream RLCF training
            if pipeline_trace is not None:
                for action in trace.actions:
                    if action.action_type == "expert_selection":
                        emb = action.metadata.get("query_embedding")
                        if emb:
                            pipeline_trace.query_embedding = emb
                            break

            log.info(
                "Neural routing via GatingPolicy",
                weights=weights,
                trace_actions=trace.num_actions
            )

            selected_experts = [
                (expert_type, weight)
                for expert_type, weight in weights.items()
                if weight >= self.config.selection_threshold
            ][:effective_max_experts]

            if not selected_experts:
                top_expert = max(weights.items(), key=lambda x: x[1])
                selected_experts = [top_expert]

        else:
            routing_decision = await self.router.route(context)
            routing_used = getattr(self.router, '_last_method', 'regex')
            gating_scores = routing_decision.expert_weights or {}

            log.info(
                "Routing decision",
                query_type=routing_decision.query_type,
                weights=routing_decision.expert_weights,
                method=routing_used,
            )

            trace.add_action(Action(
                action_type="routing",
                parameters={
                    "strategy": routing_used,
                    "query_type": routing_decision.query_type,
                },
                log_prob=-0.3 if routing_used == "llm" else -0.5,
            ))

            selected_experts = routing_decision.get_selected_experts(
                threshold=self.config.selection_threshold
            )[:effective_max_experts]

            if not selected_experts:
                selected_experts = [(exp, 1.0 / len(self._experts)) for exp in self._experts.keys()]

        routing_time_ms = (time.perf_counter() - routing_t0) * 1000

        if pipeline_trace is not None:
            routing_trace = {
                "time_ms": round(routing_time_ms, 2),
                "method": routing_used,
                "selected_experts": [e[0] for e in selected_experts],
                "gating_scores": {k: round(v, 4) for k, v in gating_scores.items()} if gating_scores else {},
            }
            # Add neural gating details when hybrid routing is active
            if self._routing_strategy == "hybrid" and hasattr(routing_decision, 'neural_confidence'):
                routing_trace["neural_gating"] = {
                    "neural_used": routing_decision.neural_used,
                    "neural_confidence": round(routing_decision.neural_confidence, 4),
                    "neural_weights": {k: round(v, 4) for k, v in routing_decision.neural_weights.items()} if routing_decision.neural_weights else {},
                    "confidence_threshold": self.hybrid_router.confidence_threshold if self.hybrid_router else None,
                    "expert_priors": self.hybrid_router.neural_gating.get_expert_priors() if self.hybrid_router else {},
                    "trained": getattr(self.hybrid_router, 'loaded_from_checkpoint', False),
                }
            pipeline_trace.routing_decision = routing_trace
            pipeline_trace.stage_times_ms["routing"] = routing_time_ms
            pipeline_metrics.routing_time_ms = routing_time_ms

        # Aggiorna metadata del trace con info routing
        trace.metadata["routing"] = {
            "strategy_used": routing_used,
            "neural_confidence": neural_confidence,
            "selected_experts": [e[0] for e in selected_experts],
        }

        log.info(f"Selected experts", experts=[e[0] for e in selected_experts])

        # Loop β E.3: tool-gating policy — decide which live tools each selected
        # expert will call (treatment arm prunes; control fires all), emit
        # `tool_use` actions for REINFORCE, and write the pruned selection into the
        # shared context BEFORE dispatch. Failure-isolated; no-op when disabled.
        self._apply_tool_gating(context, trace, selected_experts)

        # Step 5: Esegui Expert (con tracing)
        expert_t0 = time.perf_counter()
        if self.config.parallel_execution:
            results_with_timing = await self._run_experts_parallel(selected_experts, context)
        else:
            results_with_timing = await self._run_experts_sequential(selected_experts, context)

        # Extract plain responses for downstream (synthesis etc.)
        responses = [r[0] for r in results_with_timing]

        # Collect traces from experts
        if pipeline_trace is not None:
            expert_executions = []
            total_tokens = 0
            for (expert_type, _), (resp, started_at, completed_at, measured_duration) in zip(selected_experts, results_with_timing):
                expert = self._experts.get(expert_type)
                if not expert:
                    continue

                # Collect traces from expert (LLM + tools + react)
                expert_traces = expert.collect_and_reset_traces()

                # Build retrieval_trace from tool calls
                retrieval_trace = self._build_retrieval_trace(expert_traces["tool_calls"])

                exec_entry = ExpertExecution(
                    expert_type=expert_type,
                    started_at=started_at,
                    completed_at=completed_at,
                    duration_ms=measured_duration,
                    success=resp is not None and resp.confidence > 0.0,
                    error=resp.limitations if resp and resp.confidence == 0.0 else None,
                    input_context={
                        "query": context.query_text[:200],
                        "entities": {k: v[:3] if isinstance(v, list) else v for k, v in context.entities.items()} if context.entities else {},
                    },
                    output={
                        "interpretation_preview": resp.interpretation[:300] if resp and resp.interpretation else "",
                        "sources_count": len(resp.legal_basis) if resp and hasattr(resp, 'legal_basis') else 0,
                    } if resp else None,
                    tokens_used=resp.tokens_used if resp and hasattr(resp, 'tokens_used') else 0,
                    confidence=resp.confidence if resp else 0.0,
                    llm_calls=expert_traces.get("llm_calls", []),
                    tool_calls=expert_traces.get("tool_calls", []),
                    retrieval_trace=retrieval_trace,
                    react_steps=expert_traces.get("react_steps", []),
                    graph_traversal=expert.get_graph_traversal(),
                )
                expert_executions.append(exec_entry.to_dict())
                total_tokens += exec_entry.tokens_used
                pipeline_metrics.expert_times_ms[expert_type] = exec_entry.duration_ms
                pipeline_metrics.experts_activated.append(expert_type)

            pipeline_trace.expert_executions = expert_executions
            pipeline_trace.total_tokens = total_tokens
            pipeline_metrics.total_tokens = total_tokens

        # Step 6: Gating weights (already computed by routing stage)
        weights_dict = {exp: w for exp, w in selected_experts}

        if pipeline_trace is not None:
            pipeline_trace.gating_result = {
                "weights": {k: round(v, 4) for k, v in weights_dict.items()},
                "source": self._routing_strategy,
            }
            pipeline_trace.stage_times_ms["gating"] = 0.0
            pipeline_metrics.gating_time_ms = 0.0

        # Step 7: Sintetizza con AdaptiveSynthesizer (disagreement detection)
        synthesis_t0 = time.perf_counter()
        synthesis_result = await self.synthesizer.synthesize(
            query=query,
            responses=responses,
            weights=weights_dict,
            trace_id=trace_id
        )
        synthesis_time_ms = (time.perf_counter() - synthesis_t0) * 1000

        # Calcola tempo di esecuzione totale
        execution_time_ms = (time.perf_counter() - start_time) * 1000

        if pipeline_trace is not None:
            # Synthesis stage
            synthesis_stage = {
                "time_ms": round(synthesis_time_ms, 2),
                "mode": synthesis_result.mode.value,
                "confidence": round(synthesis_result.confidence, 3),
            }
            if synthesis_result.disagreement_analysis:
                pipeline_trace.disagreement_analysis = synthesis_result.disagreement_analysis.to_dict()
            pipeline_trace.synthesis_result = synthesis_stage
            pipeline_trace.stage_times_ms["synthesis"] = synthesis_time_ms
            pipeline_metrics.synthesis_time_ms = synthesis_time_ms

            # Finalize totals
            pipeline_trace.total_time_ms = execution_time_ms
            pipeline_metrics.total_time_ms = execution_time_ms

            # Attach to synthesis_result metadata for downstream access
            synthesis_result.metadata["pipeline_trace"] = pipeline_trace.to_dict()
            synthesis_result.metadata["pipeline_metrics"] = pipeline_metrics.to_dict()

        # Aggiungi trace summary ai metadati (RLCF)
        trace.metadata["synthesis_result"] = {
            "mode": synthesis_result.mode.value,
            "confidence": synthesis_result.confidence,
            "experts_used": [r.expert_type for r in responses],
            "has_disagreement": synthesis_result.disagreement_analysis.has_disagreement if synthesis_result.disagreement_analysis else False,
            "num_alternatives": len(synthesis_result.alternatives),
            "execution_time_ms": execution_time_ms
        }

        # Loop β Bug-4 fix (0.3): persist the full ExecutionTrace (query_id + the
        # RLCF Actions that carry query_embedding/log_prob) into the result
        # metadata, so the API layer can store it and feed REINFORCE WITHOUT
        # needing return_trace=True. Previously only pipeline_trace.to_dict() was
        # persisted (key 'trace_id', zero actions) → ExecutionTrace.from_dict
        # KeyError'd / trained on nothing (num_actions=0). Always attached.
        # Loop β E.3: BEFORE serializing, annotate each `tool_use` action with the
        # observed outcome (did that tool actually return a live source) so the
        # tool-policy trainer can credit productive tools — must run before to_dict().
        self._annotate_tool_use_outcomes(trace, responses)
        # Slice 4 L3: persist the experts' traversal decisions alongside the
        # routing/tool actions (must run before to_dict()).
        self._merge_expert_traversal_actions(trace, responses)
        synthesis_result.metadata["execution_trace"] = trace.to_dict()

        # Loop β C.2: sediment this query's LIVE retrievals into the graph —
        # provisional, NON-BLOCKING, failure-isolated. Collect the live_unconfirmed
        # sources the experts that RAN pulled from mcp-legal-it (A.3), dedup, and
        # fire a background task: the answer returns immediately, and re-asking the
        # same question later hits the now-sedimented graph node (no 2nd live scrape).
        try:
            ran_types = {r.expert_type for r in responses}
            seen_live: set = set()
            live_sources: List[Dict[str, Any]] = []
            for et in ran_types:
                expert = self._experts.get(et)
                for src in (getattr(expert, "_live_sources_retrieved", None) or []):
                    key = (src.get("source_id"), (src.get("text") or "")[:64])
                    if key in seen_live:
                        continue
                    seen_live.add(key)
                    live_sources.append(src)
            if live_sources:
                _task = asyncio.create_task(self._sediment_live_sources(live_sources))
                self._sediment_tasks.add(_task)
                _task.add_done_callback(self._sediment_tasks.discard)
                log.info("scheduled live-source sedimentation",
                         count=len(live_sources), trace_id=trace_id)
        except Exception as sed_err:
            log.warning("failed to schedule live-source sedimentation (non-fatal)",
                        error=str(sed_err))

        log.info(
            f"Query processed",
            trace_id=trace_id,
            synthesis_mode=synthesis_result.mode.value,
            experts_run=len(responses),
            confidence=synthesis_result.confidence,
            has_disagreement=synthesis_result.disagreement_analysis.has_disagreement if synthesis_result.disagreement_analysis else False,
            time_ms=execution_time_ms,
            trace_actions=trace.num_actions
        )

        # Ritorna trace se richiesto (per RLCF loop)
        if return_trace:
            return synthesis_result, trace

        return synthesis_result

    async def _run_experts_parallel(
        self,
        selected_experts: List[tuple],
        context: ExpertContext
    ) -> List[tuple]:
        """Esegue Expert in parallelo con circuit breaker.

        Returns:
            List of (ExpertResponse, started_at, completed_at, duration_ms) tuples.
        """
        async def run_with_timeout(expert_type: str) -> Optional[tuple]:
            expert = self._experts.get(expert_type)
            if not expert:
                return None

            # Circuit breaker check
            if self.config.enable_circuit_breaker:
                cb = get_expert_circuit_breaker(expert_type)
                if not cb.can_execute():
                    log.warning(
                        "expert_circuit_open",
                        expert=expert_type,
                        trace_id=context.trace_id,
                    )
                    resp = create_unavailable_response(
                        expert_type, context.trace_id
                    )
                    now = datetime.now()
                    return (resp, now, now, 0.0)

            started_at = datetime.now()
            t0 = time.perf_counter()
            try:
                response = await asyncio.wait_for(
                    expert.analyze(context),
                    timeout=self.config.timeout_seconds
                )
                duration_ms = (time.perf_counter() - t0) * 1000
                completed_at = datetime.now()
                # Record success for circuit breaker
                if self.config.enable_circuit_breaker:
                    cb = get_expert_circuit_breaker(expert_type)
                    cb.record_success()
                return (response, started_at, completed_at, duration_ms)
            except asyncio.TimeoutError:
                duration_ms = (time.perf_counter() - t0) * 1000
                completed_at = datetime.now()
                log.warning(f"Expert {expert_type} timed out")
                if self.config.enable_circuit_breaker:
                    cb = get_expert_circuit_breaker(expert_type)
                    cb.record_failure()
                resp = ExpertResponse(
                    expert_type=expert_type,
                    interpretation="Timeout durante l'analisi",
                    confidence=0.0,
                    limitations="Timeout",
                    trace_id=context.trace_id
                )
                return (resp, started_at, completed_at, duration_ms)
            except Exception as e:
                duration_ms = (time.perf_counter() - t0) * 1000
                completed_at = datetime.now()
                log.error(f"Expert {expert_type} failed: {e}")
                if self.config.enable_circuit_breaker:
                    cb = get_expert_circuit_breaker(expert_type)
                    cb.record_failure()
                resp = ExpertResponse(
                    expert_type=expert_type,
                    interpretation=f"Errore: {str(e)}",
                    confidence=0.0,
                    limitations=str(e),
                    trace_id=context.trace_id
                )
                return (resp, started_at, completed_at, duration_ms)

        tasks = [run_with_timeout(exp) for exp, _ in selected_experts]
        results = await asyncio.gather(*tasks)

        return [r for r in results if r is not None]

    async def _run_experts_sequential(
        self,
        selected_experts: List[tuple],
        context: ExpertContext
    ) -> List[tuple]:
        """Esegue Expert in sequenza con circuit breaker.

        Returns:
            List of (ExpertResponse, started_at, completed_at, duration_ms) tuples.
        """
        results = []

        for expert_type, _ in selected_experts:
            expert = self._experts.get(expert_type)
            if not expert:
                continue

            # Circuit breaker check
            if self.config.enable_circuit_breaker:
                cb = get_expert_circuit_breaker(expert_type)
                if not cb.can_execute():
                    log.warning(
                        "expert_circuit_open",
                        expert=expert_type,
                        trace_id=context.trace_id,
                    )
                    resp = create_unavailable_response(
                        expert_type, context.trace_id
                    )
                    now = datetime.now()
                    results.append((resp, now, now, 0.0))
                    continue

            started_at = datetime.now()
            t0 = time.perf_counter()
            try:
                response = await asyncio.wait_for(
                    expert.analyze(context),
                    timeout=self.config.timeout_seconds
                )
                duration_ms = (time.perf_counter() - t0) * 1000
                completed_at = datetime.now()
                if self.config.enable_circuit_breaker:
                    cb = get_expert_circuit_breaker(expert_type)
                    cb.record_success()
                results.append((response, started_at, completed_at, duration_ms))
            except asyncio.TimeoutError:
                duration_ms = (time.perf_counter() - t0) * 1000
                completed_at = datetime.now()
                log.warning(f"Expert {expert_type} timed out")
                if self.config.enable_circuit_breaker:
                    cb = get_expert_circuit_breaker(expert_type)
                    cb.record_failure()
                resp = ExpertResponse(
                    expert_type=expert_type,
                    interpretation="Timeout",
                    confidence=0.0,
                    trace_id=context.trace_id
                )
                results.append((resp, started_at, completed_at, duration_ms))
            except Exception as e:
                duration_ms = (time.perf_counter() - t0) * 1000
                completed_at = datetime.now()
                log.error(f"Expert {expert_type} failed: {e}")
                if self.config.enable_circuit_breaker:
                    cb = get_expert_circuit_breaker(expert_type)
                    cb.record_failure()
                resp = ExpertResponse(
                    expert_type=expert_type,
                    interpretation=f"Errore: {str(e)}",
                    confidence=0.0,
                    limitations=str(e),
                    trace_id=context.trace_id
                )
                results.append((resp, started_at, completed_at, duration_ms))

        return results

    def _build_retrieval_trace(self, tool_calls: list) -> Optional[dict]:
        """Build RetrievalTrace by aggregating data from tool calls."""
        semantic_calls = [t for t in tool_calls if "semantic" in t.get("tool_name", "")]
        graph_calls = [t for t in tool_calls if "graph" in t.get("tool_name", "")]

        if not semantic_calls and not graph_calls:
            return None

        vector_time = sum(t.get("duration_ms", 0) for t in semantic_calls)
        graph_time = sum(t.get("duration_ms", 0) for t in graph_calls)

        # Aggregate across all semantic_search calls
        alpha_used = 0.0
        total_candidates = 0
        total_after_reranking = 0
        all_top_sources: list = []
        seen_sources: set = set()
        source_labels: dict = {}

        for tc in semantic_calls:
            meta = tc.get("result_metadata", {})
            if meta.get("retrieval_alpha"):
                alpha_used = meta["retrieval_alpha"]
            total_candidates += meta.get("total_candidates", 0)
            total_after_reranking += meta.get("chunks_after_reranking", 0) or (tc.get("result_count", 0) or 0)
            source_labels.update(meta.get("top_source_labels", {}) or {})
            for urn in meta.get("top_source_urns", []):
                if urn not in seen_sources:
                    seen_sources.add(urn)
                    all_top_sources.append(urn)

        return {
            "vector_search_time_ms": round(vector_time, 2),
            "graph_enrichment_time_ms": round(graph_time, 2),
            "total_chunks_retrieved": total_candidates,
            "chunks_after_reranking": total_after_reranking,
            "alpha_used": round(alpha_used, 3),
            "top_sources": all_top_sources[:10],
            # urn -> human-readable label, so retrieved_sources never surface an
            # opaque id (provisional live:<hash>) with no valence for feedback.
            "source_labels": source_labels,
        }

    async def process_with_routing(
        self,
        query: str,
        **kwargs
    ) -> tuple:
        """
        Processa e ritorna anche la decisione di routing.

        Returns:
            Tuple (SynthesisResult, RoutingDecision) se non usa GatingPolicy
            Tuple (SynthesisResult, ExecutionTrace) se usa GatingPolicy
        """
        # Se ha GatingPolicy, ritorna trace invece di routing_decision
        if self.gating_policy and self.embedding_service:
            result = await self.process(query, return_trace=True, **kwargs)
            return result  # (synthesis_result, trace)

        # Altrimenti traditional routing
        context = ExpertContext(
            query_text=query,
            entities=kwargs.get("entities") or {},
            retrieved_chunks=kwargs.get("retrieved_chunks") or [],
            metadata=kwargs.get("metadata") or {},
            trace_id=datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        )

        routing_decision = await self.router.route(context)
        synthesis_result = await self.process(query, **kwargs)

        return synthesis_result, routing_decision

    def get_expert(self, expert_type: str) -> Optional[BaseExpert]:
        """Ottiene un Expert per tipo."""
        return self._experts.get(expert_type)

    def list_experts(self) -> List[str]:
        """Lista gli Expert disponibili."""
        return list(self._experts.keys())

    async def run_single_expert(
        self,
        expert_type: str,
        query: str,
        **kwargs
    ) -> ExpertResponse:
        """
        Esegue un singolo Expert specifico.

        Utile per testing o quando si vuole bypassare il routing.
        """
        expert = self._experts.get(expert_type)
        if not expert:
            return ExpertResponse(
                expert_type=expert_type,
                interpretation=f"Expert '{expert_type}' non trovato",
                confidence=0.0
            )

        context = ExpertContext(
            query_text=query,
            entities=kwargs.get("entities") or {},
            retrieved_chunks=kwargs.get("retrieved_chunks") or [],
            metadata=kwargs.get("metadata") or {},
            trace_id=datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        )

        return await expert.analyze(context)
