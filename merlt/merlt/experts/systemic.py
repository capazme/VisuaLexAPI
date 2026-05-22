"""
Systemic Expert
================

Expert specializzato nell'interpretazione sistematica e storica.

Fondamento teorico: Art. 12, comma I + Art. 14 disp. prel. c.c.
- Art. 12, I: "...secondo la connessione di esse [parole]..."
- Art. 14: "Le leggi penali e quelle che fanno eccezione... non si applicano
  oltre i casi e i tempi in esse considerati"

L'interpretazione sistematica considera:
- CONNESSIONE: Come la norma si inserisce nel sistema giuridico
- STORICO: Evoluzione della norma nel tempo (modifiche, abrogazioni)
- TOPOGRAFICO: Posizione della norma (libro, titolo, capo, sezione)

Approccio:
1. Colloca la norma nel contesto sistematico (codice, legge speciale)
2. Analizza relazioni con norme collegate (rinvii, deroghe, eccezioni)
3. Ricostruisce l'evoluzione storica (versioni precedenti, modifiche)
4. Considera la ratio sistemica (coerenza dell'ordinamento)
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


class SystemicExpert(BaseExpert, ReActMixin):
    """
    Expert per interpretazione sistematica e storica.

    Art. 12, I: "connessione delle parole" + Art. 14 (elemento storico)

    Epistemologia: Coerenza sistemica dell'ordinamento
    Focus: Come la norma si INSERISCE nel sistema giuridico

    Tools principali:
    - semantic_search: Ricerca norme correlate
    - graph_search: Navigazione relazioni sistematiche

    Traversal weights:
    - CONNESSO_A: 1.0 (connessioni sistematiche)
    - MODIFICA: 0.95 (evoluzione storica - fondamentale)
    - ABROGA: 0.90 (abrogazioni storiche)
    - DEROGA: 0.90 (deroghe)
    - RINVIA: 0.85 (riferimenti incrociati)

    Esempio:
        >>> from merlt.experts import SystemicExpert
        >>>
        >>> expert = SystemicExpert(
        ...     tools=[SemanticSearchTool(retriever, embeddings)],
        ...     ai_service=openrouter_service
        ... )
        >>> response = await expert.analyze(context)
    """

    expert_type = "systemic"
    description = "Interpretazione sistematica e storica (art. 12, I + art. 14 disp. prel. c.c.)"

    # Pesi default per traversal grafo - focus su relazioni sistematiche
    DEFAULT_TRAVERSAL_WEIGHTS = {
        "connesso_a": 1.0,     # Connessioni sistematiche
        "modifica": 0.95,      # Evoluzione storica (fondamentale)
        "abroga": 0.90,        # Abrogazioni storiche
        "deroga": 0.90,        # Deroghe
        "rinvia": 0.85,        # Riferimenti incrociati
        "disciplina": 0.80,    # Norme che regolano stessa materia
        "contiene": 0.75,      # Struttura
        "cita": 0.70,          # Citazioni
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
        Inizializza SystemicExpert.

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
        Analizza la query con approccio sistematico e storico.

        Flow (standard):
        1. Usa semantic_search per trovare norme correlate
        2. Usa graph_search per esplorare connessioni sistematiche
        3. Identifica modifiche storiche tramite relazione MODIFICA
        4. Chiama LLM per analisi sistematica

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
            f"SystemicExpert analyzing",
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
                f"SystemicExpert ReAct completed",
                sources=len(all_sources),
                react_metrics=self.get_react_metrics() if hasattr(self, '_react_result') else {}
            )
        else:
            # Standard mode: fixed tool sequence
            retrieved_sources = await self._retrieve_sources(context)
            systemic_sources = await self._expand_systemic_relations(context, retrieved_sources)
            all_sources = retrieved_sources + systemic_sources

        # Step 2: Costruisci context arricchito
        enriched_context = ExpertContext(
            query_text=context.query_text,
            query_embedding=context.query_embedding,
            entities=context.entities,
            retrieved_chunks=all_sources,
            metadata={
                **context.metadata,
                "systemic_expansion": True,
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
            f"SystemicExpert completed",
            confidence=response.confidence,
            sources=len(response.legal_basis),
            time_ms=response.execution_time_ms,
            trace_actions=self._current_trace.num_actions if self._current_trace else 0
        )

        return response

    def _rewrite_search_query(self, context: ExpertContext) -> str:
        """Rewrite query for systemic interpretation focus.

        Focuses on connections between norms, related articles,
        historical evolution, and normative context.
        """
        query = context.query_text
        articles = context.entities.get("article_numbers", [])
        concepts = context.entities.get("legal_concepts", [])

        if articles and concepts:
            return (
                f"norme correlate articolo {' '.join(articles)} "
                f"{' '.join(concepts)} sistema normativo coordinamento"
            )
        elif concepts:
            return f"{' '.join(concepts)} disciplina normativa correlazione sistema"
        return query

    async def _retrieve_sources(self, context: ExpertContext) -> List[Dict[str, Any]]:
        """
        Recupera fonti usando i tools disponibili.

        Flow:
        1. Usa chunks già recuperati se presenti
        2. Semantic search per trovare norme correlate (query rewritten for systemic focus)
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

        # Semantic search - SOLO norme per SystemicExpert (connessione tra norme)
        # Query rewritten to focus on normative connections and system
        search_query = self._rewrite_search_query(context)
        semantic_tool = self._tool_registry.get("semantic_search")
        if semantic_tool:
            source_types = get_source_types_for_expert("SystemicExpert")
            result = await semantic_tool(
                query=search_query,
                top_k=5,
                expert_type="SystemicExpert",
                source_types=source_types  # ["norma"] - connessione tra norme
            )
            if result.success and result.data.get("results"):
                sources.extend(result.data["results"])
                # Estrai URN dai risultati per graph expansion
                for item in result.data["results"]:
                    urn = item.get("metadata", {}).get("article_urn") or item.get("urn")
                    if urn:
                        self._extracted_urns.add(urn)

        log.debug(
            f"SystemicExpert sources retrieved",
            total=len(sources),
            extracted_urns=len(self._extracted_urns)
        )

        return sources

    async def _expand_systemic_relations(
        self,
        context: ExpertContext,
        initial_sources: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Espande le fonti seguendo relazioni sistematiche.

        Combina:
        - URN estratti da semantic_search (self._extracted_urns)
        - URN da context.norm_references (dal query_analyzer)
        """
        expanded = []

        graph_tool = self._tool_registry.get("graph_search")
        if not graph_tool:
            return expanded

        # Combina URN da context + URN estratti da semantic_search
        urns_to_expand = set(context.norm_references) | getattr(self, '_extracted_urns', set())

        if not urns_to_expand:
            log.debug("SystemicExpert: No URNs to expand")
            return expanded

        # Espandi con relazioni sistematiche
        # Relazioni reali nel grafo (verificate con: MATCH ()-[r]->() RETURN type(r), count(*))
        systemic_relations = ["DISCIPLINA", "modifica", "abroga", "interpreta", "IMPONE"]

        log.debug(
            f"SystemicExpert graph expansion",
            urns_count=len(urns_to_expand),
            urns=list(urns_to_expand)[:3]
        )

        for urn in list(urns_to_expand)[:5]:
            try:
                result = await graph_tool(
                    start_node=urn,
                    relation_types=systemic_relations,
                    max_hops=2,
                    direction="both"  # Bidirezionale per connessioni
                )
                if result.success:
                    graph_nodes = result.data.get("nodes", [])
                    log.debug(
                        f"Systemic expansion for {urn[:50]}...",
                        nodes_found=len(graph_nodes)
                    )
                    for node in graph_nodes:
                        expanded.append({
                            "text": node.get("properties", {}).get("testo", ""),
                            "urn": node.get("urn", ""),
                            "type": node.get("type", ""),
                            "source": "systemic_expansion",
                            "relation": "systemic",
                            "source_urn": urn
                        })
            except Exception as e:
                log.warning(f"Failed to expand {urn}: {e}")

        log.info(
            f"SystemicExpert systemic expansion",
            total_expanded=len(expanded)
        )

        return expanded

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

            # Clean markdown
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
                interpretation=f"Errore nell'analisi sistematica: {str(e)}",
                confidence=0.0,
                limitations=str(e),
                trace_id=context.trace_id
            )

    def _analyze_without_llm(self, context: ExpertContext) -> ExpertResponse:
        """Genera risposta basic senza LLM."""
        sources = context.retrieved_chunks[:5]

        legal_basis = []
        for chunk in sources:
            legal_basis.append(LegalSource(
                source_type="norm",
                source_id=chunk.get("urn", chunk.get("chunk_id", "")),
                citation=chunk.get("urn", ""),
                excerpt=chunk.get("text", "")[:500],
                relevance=f"Connessione sistematica - {chunk.get('source', 'unknown')}"
            ))

        interpretation = "Analisi sistematica delle fonti recuperate:\n\n"
        for i, chunk in enumerate(sources, 1):
            text = chunk.get("text", "")[:200]
            source_type = chunk.get("source", "semantic")
            interpretation += f"{i}. [{source_type}] {text}...\n\n"

        interpretation += "\n[Nota: Analisi sistematica completa richiede servizio AI]"

        return ExpertResponse(
            expert_type=self.expert_type,
            interpretation=interpretation,
            legal_basis=legal_basis,
            confidence=0.3,
            limitations="Analisi senza LLM - solo recupero fonti sistematiche",
            trace_id=context.trace_id
        )

    def _format_context_for_llm(self, context: ExpertContext) -> str:
        """Formatta context per LLM con focus sistematico."""
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
            semantic = [c for c in context.retrieved_chunks if c.get("source") != "systemic_expansion"]
            systemic = [c for c in context.retrieved_chunks if c.get("source") == "systemic_expansion"]

            if semantic:
                sections.append("\n## NORME DIRETTAMENTE RILEVANTI")
                for i, chunk in enumerate(semantic[:5], 1):
                    text = chunk.get("text", "")
                    chunk_id = chunk.get("chunk_id", chunk.get("urn", f"source_{i}"))
                    urn = chunk.get("urn", "N/A")
                    source_type = chunk.get("source_type", "norma")
                    sections.append(f"\n### Fonte {i}")
                    sections.append(f"- **source_id**: `{chunk_id}` ← USA QUESTO ESATTO VALORE")
                    sections.append(f"- **urn**: {urn}")
                    sections.append(f"- **source_type**: {source_type}")
                    sections.append(f"- **testo**:\n{text}")

            if systemic:
                sections.append("\n## NORME SISTEMATICAMENTE CONNESSE")
                for i, chunk in enumerate(systemic[:5], 1):
                    text = chunk.get("text", "")
                    chunk_id = chunk.get("chunk_id", chunk.get("urn", f"systemic_{i}"))
                    urn = chunk.get("urn", "N/A")
                    rel = chunk.get("relation", "N/A")
                    sections.append(f"\n### Connessione {i}")
                    sections.append(f"- **source_id**: `{chunk_id}` ← USA QUESTO ESATTO VALORE")
                    sections.append(f"- **urn**: {urn}")
                    sections.append(f"- **relazione**: {rel}")
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
                source_type=lb.get("source_type", "norm"),
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

        # Aggiungi contesto storico/sistematico alle limitations se presente
        limitations = data.get("limitations", "")
        if data.get("historical_context"):
            limitations += f"\n\nContesto storico: {data['historical_context']}"
        if data.get("systematic_position"):
            limitations += f"\n\nPosizione sistematica: {data['systematic_position']}"

        # Create F4 feedback hook for RLCF (SystemicExpert = F4)
        confidence = data.get("confidence", 0.5)
        interpretation = data.get("interpretation", "")
        feedback_hook = None
        if self.config.get("enable_f4_feedback", True):
            feedback_hook = FeedbackHook(
                feedback_type="F4",
                expert_type=self.expert_type,
                response_id=context.trace_id,
                enabled=True,
                correction_options={
                    "systemic_insight": [
                        "excellent",
                        "good",
                        "superficial",
                        "misleading",
                    ],
                    "graph_coverage": [
                        "comprehensive",
                        "adequate",
                        "incomplete",
                        "poor",
                    ],
                    "crossref_relevance": [
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
                    "isolation_assessment": [
                        "correctly_isolated",
                        "false_isolation",
                        "correctly_connected",
                        "spurious_connections",
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
