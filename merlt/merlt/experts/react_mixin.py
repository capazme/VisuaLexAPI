"""
ReAct Mixin
============

Mixin per implementare il pattern ReAct (Reasoning + Acting) negli Expert.

ReAct Pattern:
    1. THOUGHT: LLM ragiona su cosa fare
    2. ACTION: Esegue tool scelto dall'LLM
    3. OBSERVATION: Processa risultato
    4. Repeat fino a convergenza

Differenza dal semplice explore_iteratively:
- explore_iteratively: sequenza fissa di tool calls
- ReActMixin: LLM DECIDE dinamicamente quale tool usare

Riferimenti:
- Yao et al. 2022: "ReAct: Synergizing Reasoning and Acting in Language Models"
- Wei et al. 2022: Chain-of-Thought Prompting

Esempio:
    >>> from merlt.experts.react_mixin import ReActMixin
    >>> from merlt.experts.base import BaseExpert
    >>>
    >>> class LiteralExpert(BaseExpert, ReActMixin):
    ...     async def analyze(self, context):
    ...         # ReAct loop invece di explore_iteratively
    ...         sources = await self.react_loop(context, max_iterations=5)
    ...         return await self._analyze_with_llm(context, sources)
"""

import structlog
import json
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from datetime import datetime

log = structlog.get_logger()


@dataclass
class ThoughtActionObservation:
    """
    Singola iterazione del ReAct loop.

    Attributes:
        iteration: Numero iterazione
        thought: Ragionamento dell'LLM
        action: Azione decisa (tool name + params)
        observation: Risultato dell'azione
        timestamp: Quando è stata eseguita
    """
    iteration: int
    thought: str
    action: Dict[str, Any]
    observation: Dict[str, Any]
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        return {
            "iteration": self.iteration,
            "thought": self.thought,
            "action": self.action,
            "observation": self.observation,
            "timestamp": self.timestamp
        }


@dataclass
class ReActResult:
    """
    Risultato del ReAct loop.

    Attributes:
        sources: Tutte le fonti raccolte
        iterations: Numero di iterazioni eseguite
        history: Storia completa TAO (Thought-Action-Observation)
        converged: Se il loop è terminato per convergenza
        finish_reason: Motivo della fine (converged, max_iterations, error)
    """
    sources: List[Dict[str, Any]]
    iterations: int
    history: List[ThoughtActionObservation]
    converged: bool
    finish_reason: str
    total_tokens: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sources": self.sources,
            "iterations": self.iterations,
            "history": [h.to_dict() for h in self.history],
            "converged": self.converged,
            "finish_reason": self.finish_reason,
            "total_tokens": self.total_tokens
        }


class ReActMixin:
    """
    Mixin per implementare ReAct pattern negli Expert.

    Il ReAct loop permette all'LLM di decidere dinamicamente:
    1. Quale tool usare
    2. Con quali parametri
    3. Quando fermarsi

    Questo è più flessibile di una sequenza fissa di tool calls.

    Attributes richiesti dalla classe che usa il mixin:
        - ai_service: Servizio AI per LLM calls
        - get_tools_schema(): Metodo per ottenere schema tools
        - use_tool(): Metodo per eseguire tool
        - expert_type: Tipo di expert

    Esempio:
        >>> class LiteralExpert(BaseExpert, ReActMixin):
        ...     async def analyze(self, context):
        ...         sources = await self.react_loop(context, max_iterations=5)
        ...         # Usa sources per analisi LLM finale
    """

    # Configurazione ReAct
    react_config: Dict[str, Any] = {
        "max_iterations": 5,
        "novelty_threshold": 0.1,  # Stop se < 10% nuove fonti
        "temperature": 0.1,
        "model": "google/gemini-2.5-flash"
    }

    async def react_loop(
        self,
        context: Any,  # ExpertContext
        max_iterations: int = 5,
        novelty_threshold: float = 0.1
    ) -> List[Dict[str, Any]]:
        """
        Esegue il ReAct loop: LLM decide tool, esegue, osserva, ripete.

        Args:
            context: ExpertContext con query e dati iniziali
            max_iterations: Numero massimo di iterazioni
            novelty_threshold: Soglia minima di novità per continuare

        Returns:
            Lista di tutte le fonti raccolte
        """
        # Inizializza con fonti esistenti
        all_sources = list(context.retrieved_chunks) if context.retrieved_chunks else []
        seen_urns = {s.get("urn", s.get("chunk_id", "")) for s in all_sources}
        history: List[ThoughtActionObservation] = []
        total_tokens = 0

        log.info(
            f"ReAct loop started for {self.expert_type}",
            initial_sources=len(all_sources),
            max_iterations=max_iterations
        )

        for iteration in range(max_iterations):
            # Step 1: THOUGHT - LLM decide cosa fare
            decision = await self._decide_next_action(
                context=context,
                current_sources=all_sources,
                history=history
            )

            total_tokens += decision.get("tokens_used", 0)

            # Check if LLM wants to finish
            if decision.get("action") == "finish":
                log.info(
                    f"ReAct loop finished at iteration {iteration + 1}",
                    reason="LLM decided to finish",
                    thought=decision.get("thought", "")[:100]
                )
                history.append(ThoughtActionObservation(
                    iteration=iteration + 1,
                    thought=decision.get("thought", ""),
                    action={"name": "finish", "reason": decision.get("reason", "sufficient sources")},
                    observation={"status": "finished", "total_sources": len(all_sources)}
                ))
                break

            # Step 2: ACTION - Esegui tool scelto
            tool_name = decision.get("tool", "")
            tool_params = decision.get("parameters", {})

            log.debug(
                f"ReAct iteration {iteration + 1}",
                thought=decision.get("thought", "")[:100],
                tool=tool_name,
                params=list(tool_params.keys())
            )

            try:
                result = await self.use_tool(tool_name, **tool_params)
            except Exception as e:
                log.warning(f"Tool {tool_name} failed: {e}")
                result = type('ToolResult', (), {'success': False, 'data': {}, 'error': str(e)})()

            # Step 3: OBSERVATION - Processa risultato
            new_sources = self._extract_sources_from_result(result)
            novel_count = 0

            for source in new_sources:
                source_id = source.get("urn", source.get("chunk_id", ""))
                if source_id and source_id not in seen_urns:
                    all_sources.append(source)
                    seen_urns.add(source_id)
                    novel_count += 1

            # Record iteration
            history.append(ThoughtActionObservation(
                iteration=iteration + 1,
                thought=decision.get("thought", ""),
                action={
                    "name": tool_name,
                    "parameters": tool_params,
                    "success": result.success if hasattr(result, 'success') else True
                },
                observation={
                    "results_found": len(new_sources),
                    "novel_sources": novel_count,
                    "total_sources": len(all_sources)
                }
            ))

            log.debug(
                f"ReAct iteration {iteration + 1} completed",
                new_sources=len(new_sources),
                novel=novel_count,
                total=len(all_sources)
            )

            # Check convergence
            if len(new_sources) > 0:
                novelty_ratio = novel_count / len(new_sources)
            else:
                novelty_ratio = 0

            if novelty_ratio < novelty_threshold and iteration > 0:
                log.info(
                    f"ReAct loop converged at iteration {iteration + 1}",
                    novelty_ratio=novelty_ratio,
                    threshold=novelty_threshold
                )
                break

        # Store history for RLCF feedback
        self._react_history = history
        self._react_result = ReActResult(
            sources=all_sources,
            iterations=len(history),
            history=history,
            converged=len(history) < max_iterations,
            finish_reason="converged" if len(history) < max_iterations else "max_iterations",
            total_tokens=total_tokens
        )

        log.info(
            f"ReAct loop completed for {self.expert_type}",
            iterations=len(history),
            total_sources=len(all_sources),
            converged=len(history) < max_iterations
        )

        return all_sources

    async def _decide_next_action(
        self,
        context: Any,
        current_sources: List[Dict[str, Any]],
        history: List[ThoughtActionObservation]
    ) -> Dict[str, Any]:
        """
        LLM decide quale azione intraprendere.

        Il prompt include:
        - Query originale
        - Tools disponibili con schema
        - Fonti già raccolte
        - Storia delle azioni precedenti

        Returns:
            Dict con:
            - action: "tool" o "finish"
            - tool: nome del tool (se action=tool)
            - parameters: parametri per il tool
            - thought: ragionamento dell'LLM
            - reason: motivo (se action=finish)
        """
        tools_schema = self.get_tools_schema()

        # Build prompt
        prompt = self._build_react_prompt(
            context=context,
            tools_schema=tools_schema,
            current_sources=current_sources,
            history=history
        )

        try:
            response = await self._traced_llm_call(
                prompt=prompt,
                model=self.react_config.get("model", self.model if hasattr(self, 'model') else "google/gemini-2.5-flash"),
                temperature=self.react_config.get("temperature", 0.1),
                response_format={"type": "json_object"}
            )

            # Parse response - generate_response_async returns string directly
            if isinstance(response, str):
                content = response
            elif isinstance(response, dict):
                content = response.get("content", "{}")
            else:
                content = str(response)

            # Clean markdown fences if present
            content = content.strip()
            if content.startswith("```"):
                # Remove opening fence (```json or ```)
                first_newline = content.find("\n")
                if first_newline > 0:
                    content = content[first_newline + 1:]
                else:
                    content = content[3:]
            if content.endswith("```"):
                content = content[:-3].strip()

            decision = json.loads(content)
            # Extract tokens if response is dict with usage info
            decision["tokens_used"] = 0
            if isinstance(response, dict):
                usage = response.get("usage", {})
                decision["tokens_used"] = usage.get("total_tokens", 0) or (
                    usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0)
                )
            # Fallback: read from ai_service._last_usage
            if decision["tokens_used"] == 0 and hasattr(self, 'ai_service') and hasattr(self.ai_service, 'get_last_usage'):
                svc_usage = self.ai_service.get_last_usage()
                decision["tokens_used"] = svc_usage.get("total_tokens", 0) or (
                    svc_usage.get("prompt_tokens", 0) + svc_usage.get("completion_tokens", 0)
                )
            return decision

        except Exception as e:
            log.error(f"ReAct decision failed: {e}")
            # Fallback: finish if can't decide
            return {
                "action": "finish",
                "reason": f"Decision error: {str(e)}",
                "thought": "Unable to decide next action due to error"
            }

    def _build_react_prompt(
        self,
        context: Any,
        tools_schema: List[Dict[str, Any]],
        current_sources: List[Dict[str, Any]],
        history: List[ThoughtActionObservation]
    ) -> str:
        """
        Costruisce il prompt per la decisione ReAct.
        """
        expert_type = getattr(self, 'expert_type', 'expert')

        prompt = f"""Sei un {expert_type} expert per l'interpretazione giuridica italiana.
Il tuo compito è decidere quale strumento usare per raccogliere informazioni.

## QUERY UTENTE
{context.query_text}

## TOOLS DISPONIBILI
{json.dumps(tools_schema, indent=2, ensure_ascii=False)}

## FONTI GIÀ RECUPERATE: {len(current_sources)}
"""

        # Add summary of current sources
        if current_sources:
            prompt += "\nFonti già raccolte:\n"
            for i, src in enumerate(current_sources[:5], 1):
                text_preview = (src.get("text", "") or "")[:100]
                urn = src.get("urn", src.get("chunk_id", "unknown"))
                prompt += f"  {i}. [{urn[:50]}] {text_preview}...\n"
            if len(current_sources) > 5:
                prompt += f"  ... e altre {len(current_sources) - 5} fonti\n"

        # Add history
        if history:
            prompt += "\n## AZIONI PRECEDENTI\n"
            for h in history[-3:]:  # Solo ultime 3
                prompt += f"- Iterazione {h.iteration}: {h.action.get('name', 'unknown')} "
                prompt += f"→ {h.observation.get('novel_sources', 0)} nuove fonti\n"

        prompt += f"""

## ISTRUZIONI
Decidi cosa fare:

1. Se hai ABBASTANZA fonti per rispondere alla query (almeno 3-5 fonti rilevanti):
   Rispondi con: {{"action": "finish", "thought": "...", "reason": "..."}}

2. Se ti servono PIÙ fonti:
   Rispondi con: {{
     "action": "tool",
     "tool": "nome_tool",
     "parameters": {{"param1": "value1", ...}},
     "thought": "Spiego perché uso questo tool..."
   }}

## SUGGERIMENTI
- semantic_search: per cercare per similarità semantica
- graph_search: per navigare relazioni tra norme
- definition_lookup: per cercare definizioni di concetti
- hierarchy_navigation: per esplorare la struttura normativa
- verify_sources: per verificare esistenza fonti

Rispondi SOLO con JSON valido, senza commenti o testo aggiuntivo.
"""

        return prompt

    def _extract_sources_from_result(
        self,
        result: Any  # ToolResult
    ) -> List[Dict[str, Any]]:
        """
        Estrae fonti utilizzabili dal risultato di un tool.
        """
        sources = []

        if not result or not hasattr(result, 'success') or not result.success:
            return sources

        data = result.data if hasattr(result, 'data') else {}

        # Handle different tool result formats
        if "results" in data:
            # SemanticSearchTool format
            sources.extend(data["results"])

        elif "nodes" in data:
            # GraphSearchTool format
            for node in data["nodes"]:
                props = node.get("properties", {})
                sources.append({
                    "urn": node.get("urn", props.get("URN", "")),
                    "text": props.get("testo_vigente", props.get("testo", "")),
                    "type": node.get("type", ""),
                    "source": "graph_search"
                })

        elif "definitions" in data:
            # DefinitionLookupTool format
            for defn in data["definitions"]:
                sources.append({
                    "urn": defn.get("source_urn", ""),
                    "text": defn.get("definition_text", ""),
                    "type": defn.get("source_type", ""),
                    "source": "definition_lookup"
                })

        elif "hierarchy" in data:
            # HierarchyNavigationTool format
            for node in data["hierarchy"]:
                sources.append({
                    "urn": node.get("urn", ""),
                    "text": node.get("testo", ""),
                    "type": node.get("tipo", ""),
                    "estremi": node.get("estremi", ""),
                    "source": "hierarchy_navigation"
                })

        elif "verification_results" in data:
            # VerificationTool - doesn't add sources, just verifies
            pass

        return [s for s in sources if s.get("text") or s.get("urn")]

    def get_react_metrics(self) -> Dict[str, Any]:
        """
        Ottiene metriche del ReAct loop per RLCF feedback.

        Returns:
            Dict con metriche: iterations, convergence, tools_used, etc.
        """
        if not hasattr(self, '_react_result') or not self._react_result:
            return {"status": "not_executed"}

        result = self._react_result

        # Analyze tool usage
        tool_counts = {}
        for h in result.history:
            tool = h.action.get("name", "unknown")
            tool_counts[tool] = tool_counts.get(tool, 0) + 1

        return {
            "iterations": result.iterations,
            "converged": result.converged,
            "finish_reason": result.finish_reason,
            "total_sources": len(result.sources),
            "total_tokens": result.total_tokens,
            "tools_used": tool_counts,
            "history_summary": [
                {
                    "iteration": h.iteration,
                    "tool": h.action.get("name"),
                    "novel_sources": h.observation.get("novel_sources", 0)
                }
                for h in result.history
            ]
        }

    async def react_with_verification(
        self,
        context: Any,
        max_iterations: int = 5
    ) -> List[Dict[str, Any]]:
        """
        ReAct loop con verifica automatica delle fonti.

        Aggiunge una chiamata finale a verify_sources per
        assicurarsi che tutte le fonti siano grounded.

        Args:
            context: ExpertContext
            max_iterations: Numero massimo iterazioni

        Returns:
            Lista di fonti verificate
        """
        # Run standard ReAct loop
        sources = await self.react_loop(context, max_iterations)

        # Verify all sources
        try:
            source_ids = [s.get("urn", s.get("chunk_id", "")) for s in sources if s.get("urn") or s.get("chunk_id")]

            if source_ids:
                result = await self.use_tool(
                    "verify_sources",
                    source_ids=source_ids,
                    strict_mode=True
                )

                if result.success:
                    verified = set(result.data.get("verified", []))
                    # Filter to only verified sources
                    verified_sources = [
                        s for s in sources
                        if s.get("urn", s.get("chunk_id", "")) in verified
                    ]

                    log.info(
                        f"Source verification completed",
                        original=len(sources),
                        verified=len(verified_sources),
                        removed=len(sources) - len(verified_sources)
                    )

                    return verified_sources

        except Exception as e:
            log.warning(f"Source verification failed: {e}")

        return sources
