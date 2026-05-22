"""
Precedent Expert
=================

Expert specializzato nell'interpretazione giurisprudenziale.

Fondamento teorico: Prassi applicativa
Nel sistema italiano, pur non essendo i precedenti formalmente vincolanti
(a differenza del common law), la giurisprudenza ha un ruolo cruciale:
- Corte Costituzionale: interpretazione conforme, sentenze additive/ablative
- Corte di Cassazione: funzione nomofilattica (art. 65 Ord. Giud.)
- Corti EU: CGUE, CEDU - vincolanti per il giudice nazionale

L'interpretazione giurisprudenziale considera:
- GIURISPRUDENZA COSTANTE: Orientamenti consolidati
- NOMOFILACHIA: Decisioni della Cassazione a SU
- OVERRULING: Cambiamenti di orientamento
- DIRITTO VIVENTE: Come la norma è effettivamente applicata

Approccio:
1. Cerca precedenti giurisprudenziali rilevanti
2. Identifica orientamenti consolidati vs. contrasti
3. Valuta pronunce delle Corti superiori
4. Considera il "diritto vivente" (prassi applicativa)
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


class PrecedentExpert(BaseExpert, ReActMixin):
    """
    Expert per interpretazione giurisprudenziale.

    Focus sulla prassi applicativa e sul "diritto vivente".

    Epistemologia: Realismo giuridico
    Focus: Come la norma VIENE APPLICATA in concreto

    Tools principali:
    - semantic_search: Ricerca massime e sentenze
    - graph_search: Navigazione tra sentenze e norme interpretate

    Traversal weights:
    - INTERPRETA: 1.0 (sentenze che interpretano norme)
    - APPLICA: 0.95 (applicazione giurisprudenziale)
    - CITA: 0.90 (citazioni in sentenze)
    - CONFERMA: 0.85 (conferme giurisprudenziali)
    - COMMENTA: 0.85 (commenti dottrinali)
    - SUPERA: 0.80 (overruling)

    Esempio:
        >>> from merlt.experts import PrecedentExpert
        >>>
        >>> expert = PrecedentExpert(
        ...     tools=[SemanticSearchTool(retriever, embeddings)],
        ...     ai_service=openrouter_service
        ... )
        >>> response = await expert.analyze(context)
    """

    expert_type = "precedent"
    description = "Interpretazione giurisprudenziale (prassi applicativa)"

    # Pesi default per traversal grafo - focus su giurisprudenza
    DEFAULT_TRAVERSAL_WEIGHTS = {
        "interpreta": 1.0,     # Sentenze che interpretano norme
        "applica": 0.95,       # Applicazione giurisprudenziale
        "cita": 0.90,          # Citazioni in sentenze
        "conferma": 0.85,      # Conferme giurisprudenziali
        "commenta": 0.85,      # Commenti dottrinali
        "supera": 0.80,        # Overruling
        "contrasta": 0.75,     # Contrasti giurisprudenziali
        "disciplina": 0.70,    # Norme di riferimento
        "default": 0.50
    }

    # Gerarchia delle fonti giurisprudenziali
    COURT_HIERARCHY = {
        "corte_costituzionale": 1.0,  # Massima autorità
        "cassazione_su": 0.95,         # Sezioni Unite
        "cassazione": 0.85,            # Cassazione ordinaria
        "cgue": 0.90,                  # Corte di Giustizia UE
        "cedu": 0.88,                  # Corte Europea Diritti Uomo
        "consiglio_stato": 0.80,       # Giustizia amministrativa
        "corte_appello": 0.70,         # Secondo grado
        "tribunale": 0.60,             # Primo grado
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
        Inizializza PrecedentExpert.

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
        Analizza la query cercando precedenti giurisprudenziali.

        Flow (standard):
        1. Cerca massime e sentenze rilevanti
        2. Identifica orientamenti consolidati
        3. Valuta gerarchia delle fonti
        4. Produce interpretazione basata sulla prassi

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
            f"PrecedentExpert analyzing",
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
            # Still apply authority ranking
            all_sources = self._rank_by_authority(all_sources)
            log.info(
                f"PrecedentExpert ReAct completed",
                sources=len(all_sources),
                react_metrics=self.get_react_metrics() if hasattr(self, '_react_result') else {}
            )
        else:
            # Standard mode: fixed tool sequence
            retrieved_sources = await self._retrieve_sources(context)
            jurisprudence_sources = await self._search_jurisprudence(context)
            all_sources = self._rank_by_authority(retrieved_sources + jurisprudence_sources)

        # Step 2: Costruisci context arricchito
        enriched_context = ExpertContext(
            query_text=context.query_text,
            query_embedding=context.query_embedding,
            entities=context.entities,
            retrieved_chunks=all_sources,
            metadata={
                **context.metadata,
                "jurisprudence_search": True,
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
            f"PrecedentExpert completed",
            confidence=response.confidence,
            sources=len(response.legal_basis),
            time_ms=response.execution_time_ms,
            trace_actions=self._current_trace.num_actions if self._current_trace else 0
        )

        return response

    def _rewrite_search_query(self, context: ExpertContext) -> str:
        """Rewrite query for precedent/jurisprudential focus.

        Focuses on case law, court decisions, established
        interpretation, and practical application.
        """
        concepts = context.entities.get("legal_concepts", [])
        articles = context.entities.get("article_numbers", [])

        if concepts and articles:
            return (
                f"giurisprudenza sentenza articolo {' '.join(articles)} "
                f"{' '.join(concepts)} orientamento cassazione"
            )
        elif concepts:
            return f"giurisprudenza {' '.join(concepts)} orientamento precedente massima"
        elif articles:
            return f"giurisprudenza articolo {' '.join(articles)} sentenza cassazione"
        return context.query_text

    async def _retrieve_sources(self, context: ExpertContext) -> List[Dict[str, Any]]:
        """
        Recupera fonti usando i tools disponibili.

        Flow:
        1. Usa chunks già recuperati se presenti
        2. Semantic search per trovare massime (query rewritten)
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

        # Semantic search - SOLO massime per PrecedentExpert (diritto vivente)
        search_query = self._rewrite_search_query(context)
        semantic_tool = self._tool_registry.get("semantic_search")
        if semantic_tool:
            source_types = get_source_types_for_expert("PrecedentExpert")
            result = await semantic_tool(
                query=search_query,
                top_k=5,
                expert_type="PrecedentExpert",
                source_types=source_types  # ["massima"] - prassi giurisprudenziale
            )
            if result.success and result.data.get("results"):
                sources.extend(result.data["results"])
                # Estrai URN dai risultati per graph expansion
                for item in result.data["results"]:
                    urn = item.get("metadata", {}).get("article_urn") or item.get("urn")
                    if urn:
                        self._extracted_urns.add(urn)

        log.debug(
            f"PrecedentExpert sources retrieved",
            total=len(sources),
            extracted_urns=len(self._extracted_urns)
        )

        return sources

    async def _search_jurisprudence(self, context: ExpertContext) -> List[Dict[str, Any]]:
        """Cerca specificamente fonti giurisprudenziali."""
        jurisprudence = []

        semantic_tool = self._tool_registry.get("semantic_search")
        if not semantic_tool:
            return jurisprudence

        # Query specifiche per giurisprudenza
        base_query = context.query_text[:100]
        jur_queries = [
            f"giurisprudenza cassazione {base_query}",
            f"massima {' '.join(context.legal_concepts[:2]) if context.legal_concepts else base_query}"
        ]

        source_types = get_source_types_for_expert("PrecedentExpert")
        for query in jur_queries:
            try:
                result = await semantic_tool(
                    query=query,
                    top_k=3,
                    expert_type="PrecedentExpert",
                    source_types=source_types  # ["massima"]
                )
                if result.success and result.data.get("results"):
                    for r in result.data["results"]:
                        r["source"] = "jurisprudence_search"
                    jurisprudence.extend(result.data["results"])
            except Exception as e:
                log.warning(f"Jurisprudence search failed: {e}")

        # Ricerca grafo per relazioni giurisprudenziali
        # Combina URN da context + URN estratti da semantic_search
        urns_to_explore = set(context.norm_references) | getattr(self, '_extracted_urns', set())

        graph_tool = self._tool_registry.get("graph_search")
        if graph_tool and urns_to_explore:
            # Relazioni reali nel grafo (interpreta: 11,343, commenta: 2,609)
            jur_relations = ["interpreta", "commenta", "DISCIPLINA", "APPLICA_A"]

            log.debug(
                f"PrecedentExpert graph expansion",
                urns_count=len(urns_to_explore),
                urns=list(urns_to_explore)[:3]
            )

            for urn in list(urns_to_explore)[:3]:
                try:
                    result = await graph_tool(
                        start_node=urn,
                        relation_types=jur_relations,
                        max_hops=2,
                        direction="incoming"  # Sentenze che citano la norma
                    )
                    if result.success:
                        graph_nodes = result.data.get("nodes", [])
                        log.debug(
                            f"Jurisprudence expansion for {urn[:50]}...",
                            nodes_found=len(graph_nodes)
                        )
                        for node in graph_nodes:
                            node_type = node.get("type", "")
                            if "Massima" in node_type or "Sentenza" in node_type:
                                jurisprudence.append({
                                    "text": node.get("properties", {}).get("testo", ""),
                                    "urn": node.get("urn", ""),
                                    "type": node_type,
                                    "source": "jurisprudence_graph",
                                    "court": node.get("properties", {}).get("corte", "unknown"),
                                    "source_urn": urn
                                })
                except Exception as e:
                    log.warning(f"Graph jurisprudence search failed: {e}")

        log.info(
            f"PrecedentExpert jurisprudence found",
            total=len(jurisprudence)
        )

        return jurisprudence

    def _rank_by_authority(self, sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Ordina le fonti per autorità della corte."""
        def get_authority_score(source: Dict[str, Any]) -> float:
            court = (source.get("court") or "").lower()
            text = (source.get("text") or "").lower()

            # Identifica la corte dal testo o metadati
            if "corte costituzionale" in court or "corte costituzionale" in text:
                return self.COURT_HIERARCHY["corte_costituzionale"]
            elif "sezioni unite" in court or "s.u." in text or "ss.uu." in text:
                return self.COURT_HIERARCHY["cassazione_su"]
            elif "cassazione" in court or "cass." in text:
                return self.COURT_HIERARCHY["cassazione"]
            elif "cgue" in court or "corte di giustizia" in text:
                return self.COURT_HIERARCHY["cgue"]
            elif "cedu" in court or "corte europea" in text:
                return self.COURT_HIERARCHY["cedu"]
            elif "consiglio di stato" in court or "cons. stato" in text:
                return self.COURT_HIERARCHY["consiglio_stato"]

            # Fallback: usa score esistente se presente
            return source.get("final_score", self.COURT_HIERARCHY["default"])

        # Aggiungi authority score
        for source in sources:
            source["authority_score"] = get_authority_score(source)

        # Ordina per authority (decrescente)
        return sorted(sources, key=lambda x: x.get("authority_score", 0), reverse=True)

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
                interpretation=f"Errore nell'analisi giurisprudenziale: {str(e)}",
                confidence=0.0,
                limitations=str(e),
                trace_id=context.trace_id
            )

    def _analyze_without_llm(self, context: ExpertContext) -> ExpertResponse:
        """Genera risposta basic senza LLM."""
        sources = context.retrieved_chunks[:5]

        legal_basis = []
        for chunk in sources:
            source_type = "jurisprudence" if chunk.get("source") in ["jurisprudence_search", "jurisprudence_graph"] else "norm"
            legal_basis.append(LegalSource(
                source_type=source_type,
                source_id=chunk.get("urn", chunk.get("chunk_id", "")),
                citation=chunk.get("urn", ""),
                excerpt=chunk.get("text", "")[:500],
                relevance=f"Autorità: {chunk.get('authority_score', 'N/A')}"
            ))

        interpretation = "Fonti giurisprudenziali recuperate (ordinate per autorità):\n\n"
        for i, chunk in enumerate(sources, 1):
            text = chunk.get("text", "")[:200]
            authority = chunk.get("authority_score", "N/A")
            source_type = chunk.get("source", "semantic")
            interpretation += f"{i}. [{source_type}] (autorità: {authority}) {text}...\n\n"

        interpretation += "\n[Nota: Analisi giurisprudenziale completa richiede servizio AI]"

        return ExpertResponse(
            expert_type=self.expert_type,
            interpretation=interpretation,
            legal_basis=legal_basis,
            confidence=0.3,
            limitations="Analisi senza LLM - solo recupero giurisprudenza",
            trace_id=context.trace_id
        )

    def _format_context_for_llm(self, context: ExpertContext) -> str:
        """Formatta context per LLM con focus su giurisprudenza."""
        sections = [
            f"## DOMANDA DELL'UTENTE\n{context.query_text}"
        ]

        if context.norm_references:
            sections.append(f"\n## NORME DI RIFERIMENTO\n" + ", ".join(context.norm_references))

        if context.legal_concepts:
            sections.append(f"\n## CONCETTI GIURIDICI\n" + ", ".join(context.legal_concepts))

        if context.retrieved_chunks:
            sections.append("⚠️ USA ESATTAMENTE il source_id indicato per ogni fonte nel campo legal_basis!")

            # Separa per tipo e ordina per autorità
            norms = [c for c in context.retrieved_chunks if c.get("source") not in ["jurisprudence_search", "jurisprudence_graph"]]
            jur = [c for c in context.retrieved_chunks if c.get("source") in ["jurisprudence_search", "jurisprudence_graph"]]

            if jur:
                sections.append("\n## FONTI GIURISPRUDENZIALI (ordinate per autorità)")
                for i, chunk in enumerate(jur[:7], 1):
                    text = chunk.get("text", "")
                    chunk_id = chunk.get("chunk_id", chunk.get("urn", f"jur_{i}"))
                    urn = chunk.get("urn", "N/A")
                    authority = chunk.get("authority_score", "N/A")
                    court = chunk.get("court", "N/D")
                    sections.append(f"\n### Precedente {i}")
                    sections.append(f"- **source_id**: `{chunk_id}` ← USA QUESTO ESATTO VALORE")
                    sections.append(f"- **urn**: {urn}")
                    sections.append(f"- **autorità**: {authority}")
                    sections.append(f"- **corte**: {court}")
                    sections.append(f"- **testo**:\n{text}")

            if norms:
                sections.append("\n## NORME INTERPRETATE")
                for i, chunk in enumerate(norms[:3], 1):
                    text = chunk.get("text", "")
                    chunk_id = chunk.get("chunk_id", chunk.get("urn", f"norm_{i}"))
                    urn = chunk.get("urn", "N/A")
                    sections.append(f"\n### Norma {i}")
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
                source_type=lb.get("source_type", "jurisprudence"),
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
        if data.get("jurisprudential_trend"):
            limitations += f"\n\nTendenza giurisprudenziale: {data['jurisprudential_trend']}"
        if data.get("key_precedents"):
            limitations += f"\n\nPrecedenti chiave: {', '.join(data['key_precedents'])}"

        # Create F6 feedback hook for RLCF (PrecedentExpert = F6)
        confidence = data.get("confidence", 0.5)
        interpretation = data.get("interpretation", "")
        feedback_hook = None
        if self.config.get("enable_f6_feedback", True):
            feedback_hook = FeedbackHook(
                feedback_type="F6",
                expert_type=self.expert_type,
                response_id=context.trace_id,
                enabled=True,
                correction_options={
                    "case_relevance": [
                        "all_relevant",
                        "mostly_relevant",
                        "some_irrelevant",
                        "mostly_irrelevant",
                    ],
                    "jurisprudence_currency": [
                        "current",
                        "mostly_current",
                        "outdated",
                    ],
                    "conflict_detection": [
                        "correctly_detected",
                        "missed_conflict",
                        "false_conflict",
                        "no_conflict",
                    ],
                    "hierarchy_respect": [
                        "properly_weighted",
                        "underweighted_supreme",
                        "overweighted_merit",
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
