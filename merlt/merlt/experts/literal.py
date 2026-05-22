"""
Literal Expert
===============

Expert specializzato nell'interpretazione letterale.

Fondamento teorico: Art. 12, comma I, disp. prel. c.c.
"Nell'applicare la legge non si può ad essa attribuire altro senso
che quello fatto palese dal significato proprio delle parole
secondo la connessione di esse..."

L'interpretazione letterale è il primo e fondamentale canone ermeneutico:
- Focus sul TESTO della norma
- "Significato proprio delle parole" = significato tecnico-giuridico se esiste,
  altrimenti significato comune
- Limite: "in claris non fit interpretatio"

Approccio:
1. Recupera il testo esatto della norma
2. Identifica termini tecnici e definizioni legali
3. Analizza la struttura sintattica
4. Segue riferimenti interni (rinvii normativi)
5. Produce interpretazione basata sul dato testuale
"""

import structlog
from typing import Dict, Any, Optional, List

from merlt.experts.base import (
    BaseExpert,
    ExpertContext,
    ExpertResponse,
    LegalSource,
    ReasoningStep,
    ConfidenceFactors,
    FeedbackHook,
)
from merlt.experts.react_mixin import ReActMixin
from merlt.tools import BaseTool, SemanticSearchTool, GraphSearchTool
from merlt.storage.retriever.models import get_source_types_for_expert

log = structlog.get_logger()


class LiteralExpert(BaseExpert, ReActMixin):
    """
    Expert per interpretazione letterale (art. 12, I disp. prel. c.c.).

    Epistemologia: Positivismo giuridico
    Focus: Cosa DICE la legge (interpretazione basata sul testo)

    Tools principali:
    - semantic_search: Ricerca semantica per trovare norme rilevanti
    - graph_search: Navigazione grafo per seguire riferimenti

    Traversal weights:
    - CONTIENE: 1.0 (struttura interna articolo)
    - DISCIPLINA: 0.95 (relazione norma-concetto)
    - DEFINISCE: 0.95 (definizioni legali)
    - RINVIA: 0.90 (riferimenti normativi)
    - MODIFICA: 0.85 (versioni successive)

    Esempio:
        >>> from merlt.experts import LiteralExpert
        >>> from merlt.tools import SemanticSearchTool
        >>>
        >>> expert = LiteralExpert(
        ...     tools=[SemanticSearchTool(retriever, embeddings)],
        ...     ai_service=openrouter_service
        ... )
        >>> response = await expert.analyze(context)
        >>> print(response.interpretation)
    """

    expert_type = "literal"
    description = "Interpretazione letterale (art. 12, I disp. prel. c.c.)"

    # Pesi default per traversal grafo
    DEFAULT_TRAVERSAL_WEIGHTS = {
        "contiene": 1.0,
        "disciplina": 0.95,
        "definisce": 0.95,
        "rinvia": 0.90,
        "modifica": 0.85,
        "abroga": 0.80,
        "cita": 0.75,
        "default": 0.50
    }

    def __init__(
        self,
        tools: Optional[List[BaseTool]] = None,
        config: Optional[Dict[str, Any]] = None,
        ai_service: Any = None,
        policy_manager: Any = None
    ):
        """
        Inizializza LiteralExpert.

        Args:
            tools: Tools per ricerca (SemanticSearchTool, GraphSearchTool)
            config: Configurazione (prompt, temperature, traversal_weights, use_react)
            ai_service: Servizio AI per LLM calls
            policy_manager: PolicyManager per pesi traversal neurali (opzionale)
        """
        # Merge traversal weights with defaults
        config = config or {}
        if "traversal_weights" not in config:
            config["traversal_weights"] = self.DEFAULT_TRAVERSAL_WEIGHTS

        super().__init__(
            tools=tools,
            config=config,
            ai_service=ai_service,
            policy_manager=policy_manager
        )

        # ReAct mode configuration
        self.use_react = config.get("use_react", False)
        self.react_config = {
            "max_iterations": config.get("react_max_iterations", 5),
            "novelty_threshold": config.get("react_novelty_threshold", 0.1),
            "temperature": 0.1,
            "model": config.get("react_model", self.model)
        }

        # Prompt caricato da YAML via PromptLoader (nella base class)

    async def analyze(self, context: ExpertContext) -> ExpertResponse:
        """
        Analizza la query con approccio letterale.

        Flow (standard):
        1. Usa semantic_search per trovare norme rilevanti
        2. Se ci sono riferimenti normativi, usa graph_search per espandere
        3. Chiama LLM con testo delle norme recuperate
        4. Produce ExpertResponse con interpretazione letterale

        Flow (ReAct mode - use_react=True):
        1. ReAct loop: LLM decide quali tool usare iterativamente
        2. Convergenza automatica basata su novelty threshold
        3. Analisi LLM finale con tutte le fonti raccolte
        """
        import time
        start_time = time.time()

        # RLCF: Inizializza ExecutionTrace per tracciare azioni
        self._init_trace(context)

        log.info(
            f"LiteralExpert analyzing",
            query=context.query_text[:50],
            trace_id=context.trace_id,
            use_react=self.use_react,
            has_policy_manager=self.policy_manager is not None
        )

        # Step 1: Recupera fonti (ReAct o standard)
        if self.use_react and self.ai_service:
            # ReAct mode: LLM-driven tool selection
            retrieved_sources = await self.react_loop(
                context,
                max_iterations=self.react_config.get("max_iterations", 5),
                novelty_threshold=self.react_config.get("novelty_threshold", 0.1)
            )
            log.info(
                f"LiteralExpert ReAct completed",
                sources=len(retrieved_sources),
                react_metrics=self.get_react_metrics() if hasattr(self, '_react_result') else {}
            )
        else:
            # Standard mode: fixed tool sequence
            retrieved_sources = await self._retrieve_sources(context)

        # Step 2: Costruisci context arricchito
        enriched_context = ExpertContext(
            query_text=context.query_text,
            query_embedding=context.query_embedding,
            entities=context.entities,
            retrieved_chunks=retrieved_sources,
            metadata={
                **context.metadata,
                "react_mode": self.use_react,
                "react_metrics": self.get_react_metrics() if self.use_react and hasattr(self, '_react_result') else {}
            },
            trace_id=context.trace_id
        )

        # Step 3: Se abbiamo AI service, chiama LLM
        if self.ai_service:
            response = await self._analyze_with_llm(enriched_context)
        else:
            # Fallback: genera risposta senza LLM
            response = self._analyze_without_llm(enriched_context)

        response.execution_time_ms = (time.time() - start_time) * 1000

        # Aggiungi metriche ReAct se disponibili
        if self.use_react and hasattr(self, '_react_result'):
            response.metadata = response.metadata or {}
            response.metadata["react_metrics"] = self.get_react_metrics()

        # RLCF: Aggiungi ExecutionTrace ai metadati per training
        if self._current_trace:
            response.metadata = response.metadata or {}
            response.metadata["execution_trace"] = self.get_trace_dict()

        log.info(
            f"LiteralExpert completed",
            confidence=response.confidence,
            sources=len(response.legal_basis),
            time_ms=response.execution_time_ms,
            trace_actions=self._current_trace.num_actions if self._current_trace else 0
        )

        return response

    def _rewrite_search_query(self, context: ExpertContext) -> str:
        """Rewrite query for literal interpretation focus.

        Focuses on exact text, definitions, and term meanings.
        Extracts article numbers and legal terms for targeted search.
        """
        query = context.query_text
        # Extract article references for more focused search
        articles = context.entities.get("article_numbers", [])
        concepts = context.entities.get("legal_concepts", [])

        if articles and concepts:
            # Focus on the article text and key terms
            return f"testo articolo {' '.join(articles)} {' '.join(concepts)} definizione significato"
        elif articles:
            return f"testo articolo {' '.join(articles)} disposizione normativa"
        # Fallback: original query (will hit cache if systemic uses same)
        return query

    async def _retrieve_sources(self, context: ExpertContext) -> List[Dict[str, Any]]:
        """
        Recupera fonti usando i tools disponibili.

        Flow:
        1. Usa chunks già recuperati se presenti
        2. Semantic search per trovare norme rilevanti (query rewritten for literal focus)
        3. Estrai URN dai risultati semantic search
        4. Graph search per espandere le relazioni (SEMPRE, non solo se norm_references)
        """
        sources = []
        explored_urns = set()

        # Step 1: Usa chunks già recuperati se presenti
        if context.retrieved_chunks:
            sources.extend(context.retrieved_chunks)
            # Estrai URN dai chunks già presenti
            for chunk in context.retrieved_chunks:
                urn = chunk.get("article_urn") or chunk.get("urn")
                if urn:
                    explored_urns.add(urn)

        # Step 2: Semantic search - SOLO norme per LiteralExpert (art. 12, I)
        # Query rewritten to focus on exact text and definitions
        search_query = self._rewrite_search_query(context)
        semantic_tool = self._tool_registry.get("semantic_search")
        semantic_results = []
        if semantic_tool:
            source_types = get_source_types_for_expert("LiteralExpert")
            result = await semantic_tool(
                query=search_query,
                top_k=5,
                expert_type="LiteralExpert",
                source_types=source_types  # ["norma"] - significato proprio delle parole
            )
            if result.success and result.data.get("results"):
                semantic_results = result.data["results"]
                sources.extend(semantic_results)

                # Estrai URN dai risultati per graph expansion
                for item in semantic_results:
                    urn = item.get("metadata", {}).get("article_urn") or item.get("urn")
                    if urn:
                        explored_urns.add(urn)

        # Step 3: Graph search per espandere le relazioni
        # Combina: URN da context.norm_references + URN estratti da semantic search
        urns_to_explore = set(context.norm_references) | explored_urns

        graph_tool = self._tool_registry.get("graph_search")
        if graph_tool and urns_to_explore:
            log.debug(
                f"LiteralExpert graph expansion",
                urns_count=len(urns_to_explore),
                urns=list(urns_to_explore)[:3]  # Log solo primi 3
            )

            for urn in list(urns_to_explore)[:3]:  # Limita a 3 per performance
                result = await graph_tool(
                    start_node=urn,
                    relation_types=["contiene", "DEFINISCE", "DISCIPLINA"],  # Relazioni reali nel grafo
                    max_hops=2
                )
                if result.success:
                    graph_nodes = result.data.get("nodes", [])
                    log.debug(
                        f"Graph expansion for {urn[:50]}...",
                        nodes_found=len(graph_nodes)
                    )
                    for node in graph_nodes:
                        sources.append({
                            "text": node.get("properties", {}).get("testo", ""),
                            "urn": node.get("urn", ""),
                            "type": node.get("type", ""),
                            "source": "graph_traversal",
                            "source_urn": urn  # Traccia da dove viene
                        })

        log.info(
            f"LiteralExpert sources retrieved",
            total=len(sources),
            from_semantic=len(semantic_results),
            from_graph=len(sources) - len(semantic_results) - len(context.retrieved_chunks)
        )

        return sources

    async def _analyze_with_llm(self, context: ExpertContext) -> ExpertResponse:
        """Analizza con LLM."""
        import json

        # Formatta prompt
        system_prompt = self.prompt_template
        user_prompt = self._format_context_for_llm(context)

        try:
            # Call LLM (traced)
            response = await self._traced_llm_call(
                prompt=f"{system_prompt}\n\n{user_prompt}",
                model=self.model,
                temperature=self.temperature
            )

            # Parse response
            if isinstance(response, dict):
                content = response.get("content", str(response))
                tokens = response.get("usage", {}).get("total_tokens", 0)
            else:
                content = str(response)
                tokens = 0
            # Fallback: read usage from ai_service
            if tokens == 0 and hasattr(self.ai_service, 'get_last_usage'):
                svc_usage = self.ai_service.get_last_usage()
                tokens = svc_usage.get("total_tokens", 0)

            # Clean markdown
            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            elif content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            # Parse JSON
            data = json.loads(content)

            return self._build_response(data, context, tokens)

        except Exception as e:
            log.error(f"LLM analysis failed: {e}")
            return ExpertResponse(
                expert_type=self.expert_type,
                interpretation=f"Errore nell'analisi: {str(e)}",
                confidence=0.0,
                limitations=str(e),
                trace_id=context.trace_id
            )

    def _analyze_without_llm(self, context: ExpertContext) -> ExpertResponse:
        """Genera risposta basic senza LLM."""
        # Estrai informazioni dai chunks recuperati
        sources = context.retrieved_chunks[:5]

        legal_basis = []
        for chunk in sources:
            legal_basis.append(LegalSource(
                source_type="norm",
                source_id=chunk.get("urn", chunk.get("chunk_id", "")),
                citation=chunk.get("urn", ""),
                excerpt=chunk.get("text", "")[:500],
                relevance="Recuperato per similarità semantica"
            ))

        interpretation = "Fonti recuperate per la query:\n\n"
        for i, chunk in enumerate(sources, 1):
            text = chunk.get("text", "")[:200]
            interpretation += f"{i}. {text}...\n\n"

        interpretation += "\n[Nota: Interpretazione completa richiede servizio AI]"

        return ExpertResponse(
            expert_type=self.expert_type,
            interpretation=interpretation,
            legal_basis=legal_basis,
            confidence=0.3,  # Low confidence without LLM
            limitations="Analisi senza LLM - solo recupero fonti",
            trace_id=context.trace_id
        )

    def _format_context_for_llm(self, context: ExpertContext) -> str:
        """Formatta context per LLM."""
        sections = [
            f"## DOMANDA DELL'UTENTE\n{context.query_text}"
        ]

        if context.norm_references:
            sections.append(f"\n## NORME CITATE NELLA DOMANDA\n" + ", ".join(context.norm_references))

        if context.legal_concepts:
            sections.append(f"\n## CONCETTI GIURIDICI IDENTIFICATI\n" + ", ".join(context.legal_concepts))

        if context.retrieved_chunks:
            sections.append("\n## TESTI NORMATIVI RECUPERATI")
            sections.append("⚠️ USA ESATTAMENTE il source_id indicato per ogni fonte nel campo legal_basis!")
            for i, chunk in enumerate(context.retrieved_chunks[:5], 1):
                text = chunk.get("text", "")
                # chunk_id è l'identificativo univoco da usare come source_id
                chunk_id = chunk.get("chunk_id", chunk.get("urn", f"source_{i}"))
                urn = chunk.get("urn", "N/A")
                score = chunk.get("final_score", chunk.get("similarity_score", "N/A"))
                source_type = chunk.get("source_type", "norma")
                sections.append(f"\n### Fonte {i}")
                sections.append(f"- **source_id**: `{chunk_id}` ← USA QUESTO ESATTO VALORE")
                sections.append(f"- **urn**: {urn}")
                sections.append(f"- **source_type**: {source_type}")
                sections.append(f"- **score**: {score}")
                sections.append(f"- **testo**:\n{text}")

        return "\n".join(sections)

    def _build_response(
        self,
        data: Dict[str, Any],
        context: ExpertContext,
        tokens: int
    ) -> ExpertResponse:
        """Costruisce ExpertResponse da JSON LLM."""
        # Parse legal_basis
        legal_basis = []
        for lb in data.get("legal_basis", []):
            legal_basis.append(LegalSource(
                source_type=lb.get("source_type", "norm"),
                source_id=lb.get("source_id", ""),
                citation=lb.get("citation", ""),
                excerpt=lb.get("excerpt", ""),
                relevance=lb.get("relevance", "")
            ))

        # Parse reasoning_steps
        reasoning_steps = []
        for rs in data.get("reasoning_steps", []):
            reasoning_steps.append(ReasoningStep(
                step_number=rs.get("step_number", 0),
                description=rs.get("description", ""),
                sources=rs.get("sources", [])
            ))

        # Parse confidence_factors
        cf_data = data.get("confidence_factors", {})
        confidence_factors = ConfidenceFactors(
            norm_clarity=cf_data.get("norm_clarity", 0.5),
            jurisprudence_alignment=cf_data.get("jurisprudence_alignment", 0.5),
            contextual_ambiguity=cf_data.get("contextual_ambiguity", 0.5),
            source_availability=cf_data.get("source_availability", 0.5)
        )

        # Create F3 feedback hook for RLCF (LiteralExpert = F3)
        confidence = data.get("confidence", 0.5)
        interpretation = data.get("interpretation", "")
        feedback_hook = None
        if self.config.get("enable_f3_feedback", True):
            feedback_hook = FeedbackHook(
                feedback_type="F3",
                expert_type=self.expert_type,
                response_id=context.trace_id,
                enabled=True,
                correction_options={
                    "interpretation_quality": [
                        "excellent",
                        "good",
                        "fair",
                        "poor",
                    ],
                    "source_relevance": [
                        "all_relevant",
                        "mostly_relevant",
                        "some_irrelevant",
                        "mostly_irrelevant",
                    ],
                    "confidence_calibration": [
                        "well_calibrated",
                        "overconfident",
                        "underconfident",
                    ],
                    "textual_accuracy": [
                        "faithful",
                        "reasonable",
                        "stretched",
                        "incorrect",
                    ],
                    "missing_elements": [
                        "none",
                        "minor_details",
                        "key_articles",
                        "fundamental",
                    ],
                },
                context_snapshot={
                    "query": context.query_text[:200],
                    "sources_count": len(legal_basis),
                    "source_ids": [s.source_id for s in legal_basis[:5]],
                    "confidence": confidence,
                    "confidence_factors": confidence_factors.to_dict(),
                    "interpretation_preview": interpretation[:300],
                },
            )

        return ExpertResponse(
            expert_type=self.expert_type,
            interpretation=interpretation,
            legal_basis=legal_basis,
            reasoning_steps=reasoning_steps,
            confidence=confidence,
            confidence_factors=confidence_factors,
            limitations=data.get("limitations", ""),
            trace_id=context.trace_id,
            tokens_used=tokens,
            feedback_hook=feedback_hook,
        )
