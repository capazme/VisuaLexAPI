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

import re
import structlog
import json
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from datetime import datetime

log = structlog.get_logger()


# Per-canon tool strategy (art. 12 preleggi). Each expert is steered toward the
# instruments proper to its interpretive canon so the ReAct loop diversifies
# instead of collapsing onto semantic_search.
_CANON_STRATEGY: Dict[str, Dict[str, str]] = {
    "literal": {
        "canone": "letterale (art. 12 preleggi — senso proprio delle parole)",
        "tools": "definition_lookup (definizioni dei concetti), article_fetch / fetch_law_article (testo dell'articolo), textual_reference (rinvii testuali), cite_law",
    },
    "systemic": {
        "canone": "sistematico (collegamento con le altre norme del sistema)",
        "tools": "graph_search e hierarchy_navigation (relazioni e struttura nel grafo), citation_chain (catena di rinvii)",
    },
    "principles": {
        "canone": "teleologico / ratio legis (principî e finalità della norma)",
        "tools": "principle_lookup (principî giuridici), constitutional_basis (base costituzionale), cerca_brocardi (dottrina e massime)",
    },
    "precedent": {
        "canone": "giurisprudenziale (orientamenti e precedenti)",
        "tools": "cerca_giurisprudenza, giurisprudenza_su_norma, leggi_sentenza, cerca_giurisprudenza_cgue, citation_chain",
    },
}

# --- Norm-fetch param repair (fetch_law_article & co.) ------------------------
# The ReAct LLM emits sloppy params for the norm-fetch tools: it OMITS the
# required act_type (→ the visible ✗ "Missing required parameter"), and it
# malforms the article ("art. 2051", "2043, 2051", "2043 e 2051" → a silent
# "Normattiva - Errore" body). We repair both from the analyzer-parsed
# legal_references already on the ExpertContext, before the tool runs.
_ART_LABEL_RE = re.compile(r"^\s*(?:articol[oi]|artt?\.?)\s*", re.IGNORECASE)
_MULTI_ART_SEP_RE = re.compile(r"\s*(?:,|;|\bed\b|\be\b)\s*", re.IGNORECASE)
# Trailing act label the LLM sometimes stuffs into the article field
# ("2051 c.c." / "2043 codice civile" / "314 c.p.") — the act belongs in act_type.
_ART_TRAILING_ACT_RE = re.compile(
    r"\s+(?:codice\b.*|cod\.?\s*(?:civ|pen)\w*\.?|c\.?c\.?|c\.?p\.?c\.?|c\.?p\.?p\.?|c\.?p\.?|preleggi\b.*)$",
    re.IGNORECASE,
)
# Accept ISO (YYYY[-M[-D]]) AND the Italian DD/MM/YYYY | DD-MM-YYYY forms, so a
# numbered-act date the LLM supplies isn't silently dropped by the date-sanity step.
_DATE_LIKE_RE = re.compile(
    r"^\s*(?:\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?|\d{1,2}[/-]\d{1,2}[/-]\d{4})\s*$"
)
_DDMMYYYY_RE = re.compile(r"^\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*$")


def _to_iso_date(value: str) -> str:
    """Normalize an Italian ``DD/MM/YYYY`` (or ``DD-MM-YYYY``) date to ISO
    ``YYYY-MM-DD``, so the URN generator downstream (which only accepts ISO /
    'DD nome-mese YYYY') never chokes on a repaired date. ISO / year-only pass
    through unchanged."""
    m = _DDMMYYYY_RE.match(value)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return value.strip()

# Italian param aliases the LLM emits for fetch_law_article instead of the
# schema's English names (audit: {'tipo_atto','numero_articolo'} → Missing param).
_NORM_PARAM_ALIASES = {
    "tipo_atto": "act_type",
    "numero_articolo": "article",
    "numero_atto": "act_number",
    "data_atto": "date",
    "data": "date",
}

# --- Reference decoder (cite_law / cerca_brocardi) ---------------------------
# The LLM passes a full Normattiva URL or an invented urn as `reference`, but
# these tools want the HUMAN form "art. N <atto>". Decode it from the machine id
# ITSELF (which encodes act+article) — dictionary-free, can't bind to the wrong
# act, works for retrieved neighbours absent from the query.
_REFERENCE_REPAIR_TOOLS = {"cite_law", "cerca_brocardi"}
_MACHINE_REF_RE = re.compile(r"https?://|urn:", re.IGNORECASE)
_URN_ART_RE = re.compile(
    r"art[.\s_]*([0-9]+(?:[-\s]?(?:bis|ter|quater|quinquies|sexies|septies|octies|novies|decies))?)",
    re.IGNORECASE,
)
# Full-URL NIR act fragments → canonical act name (used by cite_law's NL resolver).
_URN_ACT_FRAGMENTS = (
    ("regio.decreto:1942-03-16;262", "codice civile"),
    ("regio.decreto:1930-10-19;1398", "codice penale"),
    ("regio.decreto:1940-10-28;1443", "codice di procedura civile"),
    ("decreto.presidente.repubblica:1988-09-22;447", "codice di procedura penale"),
)
# Invented short-urn code token (urn:norma:<code>:artN) → canonical act name.
_SHORT_URN_CODES = {
    "cc": "codice civile", "cp": "codice penale",
    "cpc": "codice di procedura civile", "cpp": "codice di procedura penale",
}

# --- graph_search relation_types guard --------------------------------------
_MAX_RELATION_TYPES = 30
_SAFE_REL_TOKEN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _normalize_article(raw: Any) -> Any:
    """Strip an ``art.``/``artt.``/``articolo`` label, drop a trailing act label
    (``"2051 c.c."`` → ``"2051"``), and reduce a multi-article string
    (``"2043, 2051"`` / ``"2043 e 2051"``) to its FIRST article, so a norm-fetch
    tool resolves ONE real article instead of a scraper error body. Returns the
    input unchanged when it is not a str."""
    if not isinstance(raw, str):
        return raw
    s = _ART_LABEL_RE.sub("", raw).strip()
    if not s:
        return raw
    first = _MULTI_ART_SEP_RE.split(s)[0].strip()
    first = _ART_TRAILING_ACT_RE.sub("", first).strip() or first
    return first or s


def _human_ref_from_machine_id(value: Any) -> Optional[str]:
    """A full URL or ``urn:norma:<code>:artN`` → ``"art. N <act>"``. Returns None
    (leave as-is) when ``value`` is not a machine id we can DECODE to a known code
    — so a human ref / plain text / numbered-act URL is never rewritten into a
    form ``cite_law`` would reject, and the act is taken from the identifier
    itself (never guessed)."""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v or not _MACHINE_REF_RE.search(v):
        return None
    m = _URN_ART_RE.search(v)
    if not m:
        return None
    art = re.sub(r"\s+", " ", m.group(1).strip())
    low = v.lower()
    act = next((name for frag, name in _URN_ACT_FRAGMENTS if frag in low), None)
    if act is None:
        mc = re.match(r"urn:[a-z]+:([a-z]+):", low)
        act = _SHORT_URN_CODES.get(mc.group(1)) if mc else None
    if not act:
        return None
    return f"art. {art} {act}"


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

    def _repair_norm_tool_params(
        self, tool_name: str, params: Dict[str, Any], context: Any
    ) -> Dict[str, Any]:
        """Repair the sloppy params the ReAct LLM emits for the legal norm tools.

        Two families:
        - reference-keyed (``cite_law`` / ``cerca_brocardi``): the LLM passes a
          full Normattiva URL or an invented urn as ``reference``; decode it back
          to the human ``"art. N <atto>"`` form the tool actually accepts.
        - norm-fetch (``fetch_law_article`` / ``fetch_law_annotations``, declaring
          ``act_type``+``article``): remap Italian param aliases, normalize the
          article, and fill missing act_type/article/date from the analyzer-parsed
          ``context.entities['legal_references']``.

        Pure and best-effort: any problem returns the params unchanged, so a
        repair bug never breaks a working call. A no-op for semantic/graph/etc.
        """
        try:
            registry = getattr(self, "_tool_registry", None)
            tool = registry.get(tool_name) if registry else None
            if tool is None:
                return params
            pnames = {p.name for p in (tool.parameters or [])}

            # W1.1 — reference decoder (cite_law / cerca_brocardi). Allowlist by
            # tool name (NOT bare `reference`: download_law_pdf also has it).
            if tool_name in _REFERENCE_REPAIR_TOOLS and "reference" in pnames:
                human = _human_ref_from_machine_id(params.get("reference"))
                if human and human != params.get("reference"):
                    repaired = dict(params)
                    repaired["reference"] = human
                    log.debug("react.repaired_reference", tool=tool_name, after=human)
                    return repaired
                return params

            if not ({"act_type", "article"} <= pnames):
                return params

            repaired = dict(params)
            # (a0) remap Italian param aliases the LLM emits (tipo_atto→act_type…).
            #      ALWAYS drop the unknown key; convert-only (never override a
            #      well-formed canonical). Runs BEFORE the article-normalize so the
            #      context-fill (b) keys off the intended article.
            for alias, canonical in _NORM_PARAM_ALIASES.items():
                if alias not in repaired:
                    continue
                val = repaired.pop(alias)
                if canonical in pnames and repaired.get(canonical) in (None, "") and val not in (None, ""):
                    repaired[canonical] = val

            # (a) normalize an LLM-supplied article ("art. X" / multi → first)
            if repaired.get("article") not in (None, ""):
                repaired["article"] = _normalize_article(repaired["article"])

            # (b) choose the best parsed reference: prefer one whose article
            #     matches what the LLM asked AND that carries an act_type; else the
            #     first ref with an act_type; else the first ref.
            refs = [
                r for r in ((getattr(context, "entities", None) or {}).get("legal_references") or [])
                if isinstance(r, dict)
            ]
            chosen = None
            if refs:
                want = _normalize_article(repaired.get("article") or "")
                if want:
                    chosen = next(
                        (r for r in refs
                         if _normalize_article(r.get("article") or "") == want and r.get("act_type")),
                        None,
                    )
                chosen = chosen or next((r for r in refs if r.get("act_type")), None) or refs[0]

            # (c) fill ONLY declared + missing/blank keys from the chosen ref
            if chosen:
                if "act_type" in pnames and repaired.get("act_type") in (None, "") and chosen.get("act_type"):
                    repaired["act_type"] = chosen["act_type"]
                if "article" in pnames and repaired.get("article") in (None, "") and chosen.get("article"):
                    repaired["article"] = _normalize_article(chosen["article"])
                if "act_number" in pnames and repaired.get("act_number") in (None, "") and chosen.get("act_number"):
                    repaired["act_number"] = chosen["act_number"]

            # (d) keep 'date' only when it looks like a date. A CLEARLY non-date
            #     value the LLM stuffed here ("art. 2051", free text) is dropped;
            #     a bare 4-digit article number is indistinguishable from a year so
            #     it survives, but the scraper ignores a stray date on a codice
            #     fetch (verified), so it is harmless. Codici need no date; numbered
            #     acts carry a real YYYY-MM-DD (which passes the regex).
            if "date" in pnames:
                d = repaired.get("date")
                if d and not _DATE_LIKE_RE.match(str(d)):
                    repaired.pop("date", None)
                elif d:
                    repaired["date"] = _to_iso_date(str(d))  # DD/MM/YYYY → ISO
                elif chosen and _DATE_LIKE_RE.match(str(chosen.get("date") or "")):
                    repaired["date"] = _to_iso_date(str(chosen["date"]))

            if repaired != params:
                log.debug(
                    "react.repaired_norm_params", tool=tool_name,
                    after={k: repaired.get(k) for k in ("act_type", "article", "date") if k in repaired},
                )
            return repaired
        except Exception as e:  # noqa: BLE001 - best-effort, never break the call
            log.debug("react.repair_norm_params_failed", tool=tool_name, error=str(e))
            return params

    def _repair_graph_tool_params(
        self, tool_name: str, params: Dict[str, Any], context: Any
    ) -> Dict[str, Any]:
        """W1.5 — guard the ``relation_types`` arg of ``graph_search``.

        The LLM sometimes hallucinates a huge (300+) relation-type list, sometimes
        with a corrupted char, which the tool interpolates into a Cypher pattern →
        "Invalid input". When the list is absurdly long, non-list, or holds a
        non-identifier token, DROP the key (not ``[]``) so the traversal runs over
        ALL relations (valid Cypher). A single string is coerced to a list. A
        well-formed list (all safe tokens, ≤ cap) is passed through unchanged.
        Best-effort: any error returns the params unchanged.
        """
        try:
            if "relation_types" not in params:
                return params
            registry = getattr(self, "_tool_registry", None)
            tool = registry.get(tool_name) if registry else None
            if tool is None:
                return params
            pnames = {p.name for p in (tool.parameters or [])}
            if "relation_types" not in pnames:
                return params
            rt = params.get("relation_types")
            if rt is None:
                return params
            if isinstance(rt, str):
                rt = [rt]
            bad = (
                not isinstance(rt, list)
                or len(rt) > _MAX_RELATION_TYPES
                or any((not isinstance(x, str)) or not _SAFE_REL_TOKEN_RE.match(x) for x in rt)
            )
            repaired = dict(params)
            if bad:
                repaired.pop("relation_types", None)
                log.debug("react.dropped_relation_types", tool=tool_name,
                          count=(len(rt) if isinstance(rt, list) else "n/a"))
            else:
                repaired["relation_types"] = rt
            return repaired
        except Exception as e:  # noqa: BLE001 - best-effort, never break the call
            log.debug("react.repair_graph_params_failed", tool=tool_name, error=str(e))
            return params

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
            # Repair sloppy params BEFORE use_tool, so the log below and the
            # ThoughtActionObservation.action record the ACTUALLY executed args.
            tool_params = self._repair_norm_tool_params(tool_name, tool_params, context)
            tool_params = self._repair_graph_tool_params(tool_name, tool_params, context)

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

        # Slice A (graph co-evolution): the ReAct loop bypasses the deterministic
        # `_retrieve_live_legal_sources` path, so `_live_sources_retrieved` stayed
        # empty under ReAct and NOTHING sedimented into the graph (0 live_unconfirmed
        # nodes). Run it here too — deterministic (one call per live tool), fail-open,
        # already filters junk/error bodies and sets `_live_sources_retrieved` — so
        # live-retrieved norms are captured for the orchestrator's post-synthesis
        # sedimentation AND usable as answer sources.
        try:
            if hasattr(self, "_retrieve_live_legal_sources"):
                live = await self._retrieve_live_legal_sources(context)
                for s in (live or []):
                    sid = s.get("source_id") or s.get("urn") or s.get("chunk_id")
                    if sid and sid not in seen_urns:
                        all_sources.append(s)
                        seen_urns.add(sid)
        except Exception as e:
            log.warning(f"live legal capture under ReAct failed: {e}")

        # Slice B (graph co-evolution): capture the REAL canonical graph-node URNs
        # THIS answer served (semantic/graph tools set source["urn"] / metadata
        # ["article_urn"] = the article URN). The orchestrator threads these for
        # TWO signals: (3) link a freshly-sedimented provisional node to the
        # confirmed co-retrievals, and (2) credit re-retrieved provisional nodes
        # ONCE per question. Exclude entries carrying a TOP-LEVEL
        # provenance='live_unconfirmed' — those are THIS question's freshly
        # SCRAPED live sources (set by _retrieve_live_legal_sources), i.e. the
        # nodes being CREATED now; crediting/self-linking them here would be wrong.
        # Re-retrieved provisional nodes (from a prior sedimentation, via semantic
        # search) carry provenance only nested under metadata, so they pass and are
        # correctly credited. Both consumers filter by node type at the Cypher
        # level (bump_usage: live only; _link_related_urns: NOT c:LiveSource).
        try:
            retrieved_urns: List[str] = []
            seen_ret: set = set()
            for s in all_sources:
                if (s.get("provenance") or s.get("source_type")) == "live_unconfirmed":
                    continue
                urn = s.get("urn") or (s.get("metadata") or {}).get("article_urn")
                if not urn or not isinstance(urn, str):
                    continue
                if urn.startswith("live:") or urn in seen_ret:
                    continue
                seen_ret.add(urn)
                retrieved_urns.append(urn)
            self._retrieved_urns = retrieved_urns
        except Exception as e:
            log.warning(f"served-URN capture under ReAct failed: {e}")

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
            from merlt.config.runtime_config import get_runtime_config
            fallback_model = self.react_config.get(
                "model", self.model if hasattr(self, 'model') else "google/gemini-2.5-flash"
            )
            response = await self._traced_llm_call(
                prompt=prompt,
                model=get_runtime_config().get_str("react_decision_model", fallback_model),
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
        strategy = _CANON_STRATEGY.get(
            expert_type, {"canone": expert_type, "tools": "gli strumenti disponibili"}
        )

        # URNs already collected — feed these to URN-keyed tools (graph_search,
        # citation_chain, giurisprudenza_su_norma, ...) instead of re-searching.
        urns: List[str] = []
        for s in current_sources:
            # Prefer the real graph node key (urn / metadata.article_urn) over the
            # chunk_id, and strip the NIR version marker (!vig=) so it matches the
            # seed keys (the graph is seeded without the marker). Same rule as the
            # Slice-B served-URN capture. Guard metadata type — this builder is NOT
            # wrapped in try/except, so a non-dict metadata must not raise.
            md = s.get("metadata")
            u = s.get("urn") or (md.get("article_urn") if isinstance(md, dict) else None) or s.get("chunk_id")
            if u:
                u = str(u).split("!", 1)[0]
                if u and u not in urns:
                    urns.append(u)
        semantic_uses = sum(
            1 for h in history if h.action.get("name") == "semantic_search"
        )

        prompt = f"""Sei l'esperto del canone {strategy['canone']} nell'interpretazione giuridica italiana.
Decidi quale strumento usare per raccogliere le informazioni utili al TUO canone.

## QUERY UTENTE
{context.query_text}

## STRUMENTI D'ELEZIONE DEL TUO CANONE
{strategy['tools']}

## TOOLS DISPONIBILI (schema completo)
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
        if urns:
            prompt += (
                "\nURN disponibili (passali agli strumenti che richiedono un URN, "
                "es. graph_search / citation_chain / giurisprudenza_su_norma):\n  "
                + ", ".join(urns[:10]) + "\n"
            )

        # Add history
        if history:
            prompt += "\n## AZIONI PRECEDENTI\n"
            for h in history[-3:]:  # Solo ultime 3
                prompt += (
                    f"- Iterazione {h.iteration}: {h.action.get('name', 'unknown')} "
                    f"→ {h.observation.get('novel_sources', 0)} nuove fonti\n"
                )

        # Staged strategy: locate first (semantic/text search), then deepen with
        # the canon's own instruments — do not re-run semantic_search once sources
        # exist (that is what collapsed every expert onto vector search).
        if not current_sources:
            prompt += (
                "\n## STRATEGIA — FASE 1 (LOCALIZZA)\n"
                "Non hai ancora fonti. Parti con `semantic_search` (o una ricerca "
                "testuale come cerca_brocardi / cerca_giurisprudenza) per individuare "
                "le norme e le fonti rilevanti per la query.\n"
            )
        else:
            prompt += (
                "\n## STRATEGIA — FASE 2 (APPROFONDISCI)\n"
                "Hai già delle fonti (URN sopra). NON ripetere `semantic_search`: "
                "darebbe risultati simili a quelli che hai già. Usa ORA gli strumenti "
                f"d'elezione del tuo canone ({strategy['tools']}) sugli URN/concetti "
                "trovati, per collegare, verificare e approfondire secondo il tuo "
                "canone. Cambia strumento rispetto alle iterazioni precedenti.\n"
            )
            if semantic_uses >= 2:
                prompt += (
                    "Hai già usato semantic_search più volte: passa a un "
                    "approfondimento specialistico o concludi.\n"
                )

        prompt += """
## ISTRUZIONI
1. Se hai ABBASTANZA fonti per l'analisi del tuo canone (almeno 3-5 rilevanti), o gli strumenti non aggiungono nulla di nuovo:
   {"action": "finish", "thought": "...", "reason": "..."}
2. Se ti servono più fonti, scegli lo strumento più adatto al TUO canone e alla fase attuale:
   {"action": "tool", "tool": "nome_tool", "parameters": {...}, "thought": "perché questo strumento ora"}

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

        elif "timeline" in data:
            # HistoricalEvolutionTool format (HistoricalEvent.to_dict())
            for event in data["timeline"]:
                sources.append({
                    "urn": event.get("by_urn", ""),
                    "text": event.get("description") or event.get("by_estremi", ""),
                    "type": event.get("event", ""),
                    "source": "historical_evolution"
                })

        elif "principles" in data:
            # PrincipleLookupTool format (LegalPrinciple.to_dict()) - no direct
            # URN field, use first attuative norm URN when present
            for principle in data["principles"]:
                norme_urns = principle.get("norme_urns") or []
                sources.append({
                    "urn": norme_urns[0] if norme_urns else "",
                    "text": principle.get("description") or principle.get("nome", ""),
                    "type": principle.get("level", ""),
                    "source": "principle_lookup"
                })

        elif "constitutional_basis" in data:
            # ConstitutionalBasisTool format (ConstitutionalBasis.to_dict())
            for basis in data["constitutional_basis"]:
                sources.append({
                    "urn": basis.get("norm", ""),
                    "text": basis.get("principle") or basis.get("norm_estremi", ""),
                    "type": basis.get("strength", ""),
                    "source": "constitutional_basis"
                })

        elif "citation_chain" in data:
            # CitationChainTool format (Citation.to_dict())
            for citation in data["citation_chain"]:
                sources.append({
                    "urn": citation.get("to_case", ""),
                    "text": citation.get("to_estremi", ""),
                    "type": citation.get("relation", ""),
                    "source": "citation_chain"
                })

        elif "references" in data:
            # TextualReferenceTool format (NormReference.to_dict())
            for ref in data["references"]:
                sources.append({
                    "urn": ref.get("to_urn", ""),
                    "text": ref.get("excerpt") or ref.get("to_estremi", ""),
                    "type": ref.get("reference_type", ""),
                    "source": "textual_reference"
                })

        elif "text" in data and "urn" in data:
            # ArticleFetchTool / ExternalSourceTool format - single article payload
            sources.append({
                "urn": data.get("urn", ""),
                "text": data.get("text", ""),
                "type": data.get("tipo_atto", ""),
                "source": data.get("source", "article_fetch")
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
