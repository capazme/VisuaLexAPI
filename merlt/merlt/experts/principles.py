"""
Principles Expert
==================

Expert specializzato nell'interpretazione teleologica e basata sui principi.

Fondamento teorico: Art. 12, comma II, disp. prel. c.c.
"Se una controversia non può essere decisa con una precisa disposizione,
si ha riguardo alle disposizioni che regolano casi simili o materie analoghe;
se il caso rimane ancora dubbio, si decide secondo i principi generali
dell'ordinamento giuridico dello Stato."

L'interpretazione teleologica/per principi considera:
- RATIO LEGIS: Scopo e finalità della norma
- INTENZIONE DEL LEGISLATORE: Obiettivi perseguiti
- PRINCIPI GENERALI: Costituzione, principi UE, principi generali del diritto
- ANALOGIA: Casi simili e materie analoghe

Approccio:
1. Identifica la ratio legis (scopo della norma)
2. Ricostruisce l'intenzione del legislatore (lavori preparatori, relazioni)
3. Ricerca principi costituzionali e sovranazionali applicabili
4. Applica interpretazione conforme (a Costituzione, diritto UE)
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
from merlt.tools import BaseTool
from merlt.storage.retriever.models import get_source_types_for_expert

log = structlog.get_logger()


class PrinciplesExpert(BaseExpert, ReActMixin):
    """
    Expert per interpretazione teleologica e per principi.

    Art. 12, II: "intenzione del legislatore" + principi generali

    Epistemologia: Finalismo giuridico
    Focus: PERCHÉ la legge esiste e quali VALORI tutela

    Tools principali:
    - semantic_search: Ricerca principi e norme costituzionali
    - graph_search: Navigazione verso fonti superiori

    Traversal weights:
    - ATTUA: 1.0 (attuazione di principi)
    - ESPRIME: 0.95 (espressione di principi)
    - COSTITUZIONALE: 0.95 (norme costituzionali)
    - COMUNITARIO: 0.90 (norme EU)
    - PRINCIPIO: 0.90 (principi generali)
    - FINALITA: 0.85 (finalità normativa)

    Esempio:
        >>> from merlt.experts import PrinciplesExpert
        >>>
        >>> expert = PrinciplesExpert(
        ...     tools=[SemanticSearchTool(retriever, embeddings)],
        ...     ai_service=openrouter_service
        ... )
        >>> response = await expert.analyze(context)
    """

    expert_type = "principles"
    description = "Interpretazione teleologica e per principi (art. 12, II disp. prel. c.c.)"

    # Pesi default per traversal grafo - focus su principi e ratio
    DEFAULT_TRAVERSAL_WEIGHTS = {
        "attua": 1.0,           # Attuazione di principi
        "esprime": 0.95,        # Espressione di principi
        "costituzionale": 0.95, # Norme costituzionali
        "comunitario": 0.90,    # Norme EU
        "principio": 0.90,      # Principi generali
        "finalita": 0.85,       # Finalità normativa
        "ratio": 0.85,          # Ratio legis
        "tutela": 0.80,         # Beni tutelati
        "disciplina": 0.75,     # Materie regolate
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
        Inizializza PrinciplesExpert.

        Args:
            tools: Tools per ricerca
            config: Configurazione (prompt, temperature, traversal_weights, use_react)
            ai_service: Servizio AI per LLM calls
            policy_manager: PolicyManager per pesi traversal neurali (opzionale)
        """
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
        Analizza la query con approccio teleologico.

        Flow (standard):
        1. Recupera norme e principi rilevanti
        2. Cerca fonti costituzionali e sovranazionali
        3. Identifica la ratio legis
        4. Produce interpretazione orientata ai principi

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
            f"PrinciplesExpert analyzing",
            query=context.query_text[:50],
            trace_id=context.trace_id,
            use_react=self.use_react,
            has_policy_manager=self.policy_manager is not None
        )

        # Step 1: Recupera fonti (ReAct o standard)
        if self.use_react and self.ai_service:
            # ReAct mode: LLM-driven tool selection
            all_sources = await self.react_loop(
                context,
                max_iterations=self.react_config.get("max_iterations", 5),
                novelty_threshold=self.react_config.get("novelty_threshold", 0.1)
            )
            log.info(
                f"PrinciplesExpert ReAct completed",
                sources=len(all_sources),
                react_metrics=self.get_react_metrics() if hasattr(self, '_react_result') else {}
            )
        else:
            # Standard mode: fixed tool sequence
            retrieved_sources = await self._retrieve_sources(context)
            principle_sources = await self._search_principles(context)
            all_sources = retrieved_sources + principle_sources

        # Step 2: Costruisci context arricchito
        enriched_context = ExpertContext(
            query_text=context.query_text,
            query_embedding=context.query_embedding,
            entities=context.entities,
            retrieved_chunks=all_sources,
            metadata={
                **context.metadata,
                "principles_search": True,
                "react_mode": self.use_react,
                "react_metrics": self.get_react_metrics() if self.use_react and hasattr(self, '_react_result') else {}
            },
            trace_id=context.trace_id
        )

        # Step 3: Analisi
        if self.ai_service:
            response = await self._analyze_with_llm(enriched_context)
        else:
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
            f"PrinciplesExpert completed",
            confidence=response.confidence,
            sources=len(response.legal_basis),
            time_ms=response.execution_time_ms,
            trace_actions=self._current_trace.num_actions if self._current_trace else 0
        )

        return response

    def _rewrite_search_query(self, context: ExpertContext) -> str:
        """Rewrite query for principles/teleological interpretation focus.

        Focuses on ratio legis, legislative intent, constitutional
        principles, and the purpose behind the norm.
        """
        concepts = context.entities.get("legal_concepts", [])
        articles = context.entities.get("article_numbers", [])

        if concepts:
            return (
                f"ratio legis finalità principio {' '.join(concepts)} "
                f"intenzione legislatore tutela"
            )
        elif articles:
            return f"ratio legis articolo {' '.join(articles)} finalità scopo norma"
        return context.query_text

    async def _retrieve_sources(self, context: ExpertContext) -> List[Dict[str, Any]]:
        """
        Recupera fonti usando i tools disponibili.

        Flow:
        1. Usa chunks già recuperati se presenti
        2. Semantic search per trovare ratio e spiegazioni (query rewritten)
        3. Estrai URN dai risultati per graph expansion
        """
        sources = []
        self._extracted_urns = set()  # Store for later graph expansion

        if context.retrieved_chunks:
            sources.extend(context.retrieved_chunks)
            # Estrai URN dai chunks già presenti
            for chunk in context.retrieved_chunks:
                urn = chunk.get("article_urn") or chunk.get("urn")
                if urn:
                    self._extracted_urns.add(urn)

        # Semantic search - ratio e spiegazioni per PrinciplesExpert (art. 12, II)
        search_query = self._rewrite_search_query(context)
        semantic_tool = self._tool_registry.get("semantic_search")
        if semantic_tool:
            source_types = get_source_types_for_expert("PrinciplesExpert")
            result = await semantic_tool(
                query=search_query,
                top_k=5,
                expert_type="PrinciplesExpert",
                source_types=source_types  # ["ratio", "spiegazione"] - principi generali
            )
            if result.success and result.data.get("results"):
                sources.extend(result.data["results"])
                # Estrai URN dai risultati per graph expansion
                for item in result.data["results"]:
                    urn = item.get("metadata", {}).get("article_urn") or item.get("urn")
                    if urn:
                        self._extracted_urns.add(urn)

        log.debug(
            f"PrinciplesExpert sources retrieved",
            total=len(sources),
            extracted_urns=len(self._extracted_urns)
        )

        return sources

    async def _search_principles(self, context: ExpertContext) -> List[Dict[str, Any]]:
        """Cerca principi costituzionali e generali."""
        principles = []

        semantic_tool = self._tool_registry.get("semantic_search")
        if not semantic_tool:
            return principles

        # Query specifiche per principi
        principle_queries = [
            f"principi costituzionali {context.query_text}",
            f"diritti fondamentali {' '.join(context.legal_concepts[:2]) if context.legal_concepts else context.query_text[:30]}"
        ]

        source_types = get_source_types_for_expert("PrinciplesExpert")
        for query in principle_queries:
            try:
                result = await semantic_tool(
                    query=query,
                    top_k=3,
                    expert_type="PrinciplesExpert",
                    source_types=source_types  # ["ratio", "spiegazione"]
                )
                if result.success and result.data.get("results"):
                    for r in result.data["results"]:
                        r["source"] = "principles_search"
                    principles.extend(result.data["results"])
            except Exception as e:
                log.warning(f"Principles search failed: {e}")

        # Ricerca grafo per relazioni con principi
        # Combina URN da context + URN estratti da semantic_search
        urns_to_explore = set(context.norm_references) | getattr(self, '_extracted_urns', set())

        graph_tool = self._tool_registry.get("graph_search")
        if graph_tool and urns_to_explore:
            # Relazioni reali nel grafo per principi (ESPRIME_PRINCIPIO: 740 occorrenze)
            principle_relations = ["ESPRIME_PRINCIPIO", "DISCIPLINA", "interpreta", "commenta"]

            log.debug(
                f"PrinciplesExpert graph expansion",
                urns_count=len(urns_to_explore),
                urns=list(urns_to_explore)[:3]
            )

            for urn in list(urns_to_explore)[:3]:
                try:
                    result = await graph_tool(
                        start_node=urn,
                        relation_types=principle_relations,
                        max_hops=2
                    )
                    if result.success:
                        graph_nodes = result.data.get("nodes", [])
                        log.debug(
                            f"Principles expansion for {urn[:50]}...",
                            nodes_found=len(graph_nodes)
                        )
                        for node in graph_nodes:
                            node_type = node.get("type", "")
                            if "Principio" in node_type or "Costituzionale" in node_type:
                                principles.append({
                                    "text": node.get("properties", {}).get("testo", ""),
                                    "urn": node.get("urn", ""),
                                    "type": node_type,
                                    "source": "principle_graph",
                                    "source_urn": urn
                                })
                except Exception as e:
                    log.warning(f"Graph principle search failed: {e}")

        log.info(
            f"PrinciplesExpert principles found",
            total=len(principles)
        )

        return principles

    async def _analyze_with_llm(self, context: ExpertContext) -> ExpertResponse:
        """Analizza con LLM."""
        import json

        system_prompt = self.prompt_template
        user_prompt = self._format_context_for_llm(context)

        try:
            response = await self._traced_llm_call(
                prompt=f"{system_prompt}\n\n{user_prompt}",
                model=self.model,
                temperature=self.temperature
            )

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

            content = content.strip()
            if content.startswith("```json"):
                content = content[7:]
            elif content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

            data = json.loads(content)
            return self._build_response(data, context, tokens)

        except Exception as e:
            log.error(f"LLM analysis failed: {e}")
            return ExpertResponse(
                expert_type=self.expert_type,
                interpretation=f"Errore nell'analisi teleologica: {str(e)}",
                confidence=0.0,
                limitations=str(e),
                trace_id=context.trace_id
            )

    def _analyze_without_llm(self, context: ExpertContext) -> ExpertResponse:
        """Genera risposta basic senza LLM."""
        sources = context.retrieved_chunks[:5]

        legal_basis = []
        for chunk in sources:
            source_type = "principle" if chunk.get("source") in ["principles_search", "principle_graph"] else "norm"
            legal_basis.append(LegalSource(
                source_type=source_type,
                source_id=chunk.get("urn", chunk.get("chunk_id", "")),
                citation=chunk.get("urn", ""),
                excerpt=chunk.get("text", "")[:500],
                relevance=f"Rilevanza teleologica - {chunk.get('source', 'unknown')}"
            ))

        interpretation = "Fonti e principi recuperati per analisi teleologica:\n\n"
        for i, chunk in enumerate(sources, 1):
            text = chunk.get("text", "")[:200]
            source_type = chunk.get("source", "semantic")
            interpretation += f"{i}. [{source_type}] {text}...\n\n"

        interpretation += "\n[Nota: Analisi teleologica completa richiede servizio AI]"

        return ExpertResponse(
            expert_type=self.expert_type,
            interpretation=interpretation,
            legal_basis=legal_basis,
            confidence=0.3,
            limitations="Analisi senza LLM - solo recupero principi",
            trace_id=context.trace_id
        )

    def _format_context_for_llm(self, context: ExpertContext) -> str:
        """Formatta context per LLM con focus su principi."""
        sections = [
            f"## DOMANDA DELL'UTENTE\n{context.query_text}"
        ]

        if context.norm_references:
            sections.append(f"\n## NORME CITATE\n" + ", ".join(context.norm_references))

        if context.legal_concepts:
            sections.append(f"\n## CONCETTI GIURIDICI\n" + ", ".join(context.legal_concepts))

        if context.retrieved_chunks:
            sections.append("⚠️ USA ESATTAMENTE il source_id indicato per ogni fonte nel campo legal_basis!")

            # Separa fonti per tipo
            norms = [c for c in context.retrieved_chunks if c.get("source") not in ["principles_search", "principle_graph"]]
            principles = [c for c in context.retrieved_chunks if c.get("source") in ["principles_search", "principle_graph"]]

            if norms:
                sections.append("\n## NORME ORDINARIE")
                for i, chunk in enumerate(norms[:5], 1):
                    text = chunk.get("text", "")
                    chunk_id = chunk.get("chunk_id", chunk.get("urn", f"norm_{i}"))
                    urn = chunk.get("urn", "N/A")
                    source_type = chunk.get("source_type", "norma")
                    sections.append(f"\n### Norma {i}")
                    sections.append(f"- **source_id**: `{chunk_id}` ← USA QUESTO ESATTO VALORE")
                    sections.append(f"- **urn**: {urn}")
                    sections.append(f"- **source_type**: {source_type}")
                    sections.append(f"- **testo**:\n{text}")

            if principles:
                sections.append("\n## PRINCIPI E NORME COSTITUZIONALI/EU")
                for i, chunk in enumerate(principles[:5], 1):
                    text = chunk.get("text", "")
                    chunk_id = chunk.get("chunk_id", chunk.get("urn", f"principle_{i}"))
                    urn = chunk.get("urn", "N/A")
                    p_type = chunk.get("type", "Principio")
                    sections.append(f"\n### {p_type} {i}")
                    sections.append(f"- **source_id**: `{chunk_id}` ← USA QUESTO ESATTO VALORE")
                    sections.append(f"- **urn**: {urn}")
                    sections.append(f"- **testo**:\n{text}")

        return "\n".join(sections)

    def _build_response(
        self,
        data: Dict[str, Any],
        context: ExpertContext,
        tokens: int
    ) -> ExpertResponse:
        """Costruisce ExpertResponse da JSON LLM."""
        legal_basis = []
        for lb in data.get("legal_basis", []):
            legal_basis.append(LegalSource(
                source_type=lb.get("source_type", "principle"),
                source_id=lb.get("source_id", ""),
                citation=lb.get("citation", ""),
                excerpt=lb.get("excerpt", ""),
                relevance=lb.get("relevance", "")
            ))

        reasoning_steps = []
        for rs in data.get("reasoning_steps", []):
            reasoning_steps.append(ReasoningStep(
                step_number=rs.get("step_number", 0),
                description=rs.get("description", ""),
                sources=rs.get("sources", [])
            ))

        cf_data = data.get("confidence_factors", {})
        confidence_factors = ConfidenceFactors(
            norm_clarity=cf_data.get("norm_clarity", 0.5),
            jurisprudence_alignment=cf_data.get("jurisprudence_alignment", 0.5),
            contextual_ambiguity=cf_data.get("contextual_ambiguity", 0.5),
            source_availability=cf_data.get("source_availability", 0.5)
        )

        limitations = data.get("limitations", "")
        if data.get("ratio_legis"):
            limitations += f"\n\nRatio legis: {data['ratio_legis']}"
        if data.get("constitutional_framework"):
            limitations += f"\n\nQuadro costituzionale: {data['constitutional_framework']}"

        # Create F5 feedback hook for RLCF (PrinciplesExpert = F5)
        confidence = data.get("confidence", 0.5)
        interpretation = data.get("interpretation", "")
        feedback_hook = None
        if self.config.get("enable_f5_feedback", True):
            feedback_hook = FeedbackHook(
                feedback_type="F5",
                expert_type=self.expert_type,
                response_id=context.trace_id,
                enabled=True,
                correction_options={
                    "ratio_legis_quality": [
                        "excellent",
                        "good",
                        "partial",
                        "incorrect",
                    ],
                    "principle_relevance": [
                        "all_relevant",
                        "mostly_relevant",
                        "some_irrelevant",
                        "mostly_irrelevant",
                    ],
                    "constitutional_grounding": [
                        "well_grounded",
                        "reasonable",
                        "weak",
                        "not_applicable",
                    ],
                    "doctrinal_support": [
                        "strong_consensus",
                        "majority_view",
                        "divided",
                        "minority_view",
                    ],
                    "confidence_calibration": [
                        "well_calibrated",
                        "overconfident",
                        "underconfident",
                    ],
                },
                context_snapshot={
                    "query": context.query_text[:200],
                    "sources_count": len(legal_basis),
                    "confidence": confidence,
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
            limitations=limitations.strip(),
            trace_id=context.trace_id,
            tokens_used=tokens,
            feedback_hook=feedback_hook,
        )
