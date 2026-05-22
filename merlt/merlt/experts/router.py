"""
Expert Router
==============

Router per selezionare quali Expert invocare in base alla query.

Il router analizza la query e decide:
1. Quali Expert sono rilevanti (tutti, alcuni, uno solo)
2. Con quale priorità invocarli
3. Se eseguire in parallelo o sequenziale

Strategia di routing basata su:
- Tipo di query (definitional, interpretive, procedural, constitutional, teleological)
- Entità estratte (norme, concetti, riferimenti giurisprudenziali)
- Keyword specifiche
- Configurazione YAML

Esempio:
    >>> router = ExpertRouter()
    >>> selected = await router.route(context)
    >>> print(selected)
    [('literal', 0.8), ('systemic', 0.6), ('precedent', 0.4)]
"""

import structlog
import re
import json
from typing import Dict, Any, Optional, List, Tuple
from dataclasses import dataclass, field
from pathlib import Path
import yaml

from merlt.experts.base import ExpertContext

log = structlog.get_logger()


@dataclass
class RoutingDecision:
    """
    Decisione di routing per una query.

    Attributes:
        expert_weights: Mappa expert_type -> weight [0-1]
        query_type: Tipo di query identificato
        confidence: Confidenza nella decisione
        reasoning: Motivazione della decisione
        parallel: Se eseguire gli expert in parallelo
    """
    expert_weights: Dict[str, float]
    query_type: str = "general"
    confidence: float = 0.5
    reasoning: str = ""
    parallel: bool = True

    def get_selected_experts(self, threshold: float = 0.3) -> List[Tuple[str, float]]:
        """
        Ritorna expert selezionati sopra la soglia, ordinati per peso.

        Args:
            threshold: Peso minimo per selezionare un expert

        Returns:
            Lista di (expert_type, weight) ordinata per peso decrescente
        """
        selected = [
            (exp, w) for exp, w in self.expert_weights.items()
            if w >= threshold
        ]
        return sorted(selected, key=lambda x: x[1], reverse=True)


class ExpertRouter:
    """
    Router per selezionare Expert in base alla query.

    Analizza la query e determina quali Expert invocare.

    Tipi di query supportati:
    - definitional: "Cos'è...", "Definizione di..."
    - interpretive: "Come interpretare...", "Significato di..."
    - procedural: "Come fare...", "Procedura per..."
    - constitutional: "Diritti...", "Costituzionalità..."
    - jurisprudential: "Orientamento...", "Cassazione..."
    - general: Query generiche

    Esempio:
        >>> router = ExpertRouter()
        >>> context = ExpertContext(query_text="Cos'è la legittima difesa?")
        >>> decision = await router.route(context)
        >>> print(decision.query_type)
        definitional
        >>> print(decision.get_selected_experts())
        [('literal', 0.6), ('precedent', 0.3)]
    """

    # Pattern per identificare tipi di query
    QUERY_PATTERNS = {
        "definitional": [
            r"cos['\s]?[eè]\s",
            r"definizione\s+di",
            r"cosa\s+(si\s+)?intende\s+per",
            r"significato\s+di",
            r"nozione\s+di",
        ],
        "interpretive": [
            r"come\s+(si\s+)?interpreta",
            r"interpretazione\s+di",
            r"senso\s+di",
            r"portata\s+di",
            r"ambito\s+di\s+applicazione",
        ],
        "procedural": [
            r"come\s+(si\s+)?fa",
            r"procedura\s+per",
            r"termini\s+per",
            r"modalit[aà]\s+di",
            r"adempimenti",
        ],
        "constitutional": [
            r"costituzional",
            r"diritti?\s+fondamental",
            r"libert[aà]\s+",
            r"principi?\s+costituzional",
            r"art\.\s*\d+\s+cost",
        ],
        "jurisprudential": [
            r"cassazione",
            r"giurisprudenz",
            r"orientamento",
            r"sentenz[ae]",
            r"massim[ae]",
            r"precedent[ei]",
        ],
        "systemic": [
            r"relazione\s+tra",
            r"connessione\s+",
            r"coordinamento",
            r"sistema",
            r"evoluzione\s+(storica|normativa)",
        ],
        "teleological": [
            r"ratio\s+(legis|della|dell)",
            r"finalit[aà]\s+(della|dell)",
            r"scopo\s+(della|dell)",
            r"perch[eé]\s+il\s+legislatore",
            r"intenzione\s+(del\s+legislatore|della\s+norma)",
            r"funzione\s+(della|dell)",
        ],
    }

    # Pesi default per tipo di query
    DEFAULT_QUERY_WEIGHTS = {
        "definitional": {
            "literal": 0.6,
            "systemic": 0.2,
            "principles": 0.1,
            "precedent": 0.1,
        },
        "interpretive": {
            "literal": 0.35,
            "systemic": 0.25,
            "principles": 0.20,
            "precedent": 0.20,
        },
        "procedural": {
            "literal": 0.4,
            "systemic": 0.2,
            "principles": 0.1,
            "precedent": 0.3,
        },
        "constitutional": {
            "literal": 0.2,
            "systemic": 0.2,
            "principles": 0.5,
            "precedent": 0.1,
        },
        "jurisprudential": {
            "literal": 0.15,
            "systemic": 0.15,
            "principles": 0.10,
            "precedent": 0.60,
        },
        "systemic": {
            "literal": 0.2,
            "systemic": 0.5,
            "principles": 0.15,
            "precedent": 0.15,
        },
        "general": {
            "literal": 0.35,
            "systemic": 0.25,
            "principles": 0.20,
            "precedent": 0.20,
        },
        "teleological": {
            "literal": 0.15,
            "systemic": 0.25,
            "principles": 0.50,
            "precedent": 0.10,
        },
    }

    # Prompt template for LLM-based query classification
    LLM_CLASSIFY_PROMPT = """\
Classifica la seguente domanda giuridica in UNO dei seguenti tipi.
Rispondi SOLO con un JSON valido, senza altro testo.

Tipi disponibili:
- "definitional": definizioni, "cos'è", "cosa si intende per"
- "interpretive": interpretazione di norme, conseguenze giuridiche, significato di articoli
- "procedural": procedure, termini, adempimenti, "come si fa"
- "constitutional": diritti fondamentali, principi costituzionali
- "jurisprudential": orientamenti giurisprudenziali, sentenze, massime, precedenti
- "systemic": relazioni tra norme, evoluzione storica, coordinamento normativo
- "teleological": ratio legis, finalità, scopo della norma, intenzione del legislatore

Domanda: {query}

Rispondi con: {{"type": "<tipo>", "confidence": <0.0-1.0>}}"""

    def __init__(
        self,
        config_path: Optional[Path] = None,
        ai_service: Any = None,
        classification_model: str = "google/gemini-2.0-flash-001",
        disable_regex: bool = False,
    ):
        """
        Inizializza il router.

        Args:
            config_path: Path opzionale a config YAML
            ai_service: Servizio AI per LLM-based classification (opzionale, fallback a regex)
            classification_model: Modello per classificazione (default: gemini-2.0-flash)
            disable_regex: Se True, non usa regex classification; se LLM fallisce usa "general"
        """
        self.config_path = config_path
        self.ai_service = ai_service
        self.classification_model = classification_model
        self.disable_regex = disable_regex
        self.query_weights = self.DEFAULT_QUERY_WEIGHTS.copy()

        # Carica config da YAML se presente
        self._load_config()

        # Compila pattern regex
        self._compiled_patterns = {
            query_type: [re.compile(p, re.IGNORECASE) for p in patterns]
            for query_type, patterns in self.QUERY_PATTERNS.items()
        }

        # Tracks which method was last used (for trace reporting)
        self._last_method: str = "regex"

        if disable_regex:
            routing_mode = "llm" if ai_service else "general"
        else:
            routing_mode = "llm+regex" if ai_service else "regex"
        log.info("ExpertRouter initialized", mode=routing_mode)

    def _load_config(self):
        """Carica configurazione da YAML."""
        config_path = self.config_path or Path(__file__).parent / "config" / "experts.yaml"

        if config_path.exists():
            try:
                with open(config_path) as f:
                    config = yaml.safe_load(f)
                    gating_config = config.get("gating", {})
                    if "query_type_weights" in gating_config:
                        self.query_weights.update(gating_config["query_type_weights"])
            except Exception as e:
                log.warning(f"Failed to load router config: {e}")

    async def route(self, context: ExpertContext) -> RoutingDecision:
        """
        Determina quali Expert invocare per la query.

        Strategy: LLM classification first (if ai_service available),
        regex fallback otherwise.

        Args:
            context: ExpertContext con la query

        Returns:
            RoutingDecision con pesi per ogni expert
        """
        query = context.query_text.lower()
        self._last_method = "regex"

        # Step 1: Identifica tipo di query (LLM-first, regex/general fallback)
        if self.ai_service is not None:
            llm_result = await self._classify_with_llm(context.query_text)
            if llm_result is not None:
                query_type, type_confidence = llm_result
                self._last_method = "llm"
            elif self.disable_regex:
                query_type, type_confidence = "general", 0.5
                self._last_method = "general_fallback"
            else:
                query_type, type_confidence = self._identify_query_type(query)
        elif self.disable_regex:
            query_type, type_confidence = "general", 0.5
            self._last_method = "general_fallback"
        else:
            query_type, type_confidence = self._identify_query_type(query)

        # Step 2: Ottieni pesi base per tipo
        base_weights = self.query_weights.get(query_type, self.query_weights["general"]).copy()

        # Step 3: Aggiusta in base a entità estratte
        adjusted_weights = self._adjust_for_entities(base_weights, context)

        # Step 4: Aggiusta in base a keyword specifiche
        final_weights = self._adjust_for_keywords(adjusted_weights, query)

        # Step 5: Normalizza pesi
        total = sum(final_weights.values())
        if total > 0:
            final_weights = {k: v / total for k, v in final_weights.items()}

        reasoning = self._build_reasoning(query_type, context, final_weights)

        log.info(
            "Router decision",
            query_type=query_type,
            confidence=type_confidence,
            weights=final_weights,
            method=self._last_method,
        )

        return RoutingDecision(
            expert_weights=final_weights,
            query_type=query_type,
            confidence=type_confidence,
            reasoning=reasoning,
            parallel=True,
        )

    async def _classify_with_llm(self, query: str) -> Optional[Tuple[str, float]]:
        """Classify query type using a fast LLM.

        Returns:
            (query_type, confidence) or None if classification fails.
        """
        valid_types = set(self.query_weights.keys())
        prompt = self.LLM_CLASSIFY_PROMPT.format(query=query)

        try:
            response = await self.ai_service.generate_response_async(
                prompt=prompt,
                model=self.classification_model,
                temperature=0.0,
            )

            text = response.get("content", str(response)) if isinstance(response, dict) else str(response)

            # Strip markdown fences if present
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[-1]
            if text.endswith("```"):
                text = text.rsplit("```", 1)[0]
            text = text.strip()

            parsed = json.loads(text)
            q_type = parsed.get("type", "").strip().lower()
            q_conf = float(parsed.get("confidence", 0.5))

            if q_type not in valid_types:
                log.warning("llm_classify_unknown_type", llm_type=q_type)
                return None

            log.info("llm_classification", query_type=q_type, confidence=q_conf)
            return q_type, q_conf

        except Exception as e:
            log.warning("llm_classification_failed", error=str(e)[:100])
            return None

    def _identify_query_type(self, query: str) -> Tuple[str, float]:
        """
        Identifica il tipo di query.

        Returns:
            Tuple (query_type, confidence)
        """
        scores = {}

        for query_type, patterns in self._compiled_patterns.items():
            matches = sum(1 for p in patterns if p.search(query))
            if matches > 0:
                scores[query_type] = matches / len(patterns)

        if not scores:
            return "general", 0.5

        best_type = max(scores, key=scores.get)
        confidence = min(scores[best_type] * 2, 1.0)  # Scale up confidence

        return best_type, confidence

    def _adjust_for_entities(
        self,
        weights: Dict[str, float],
        context: ExpertContext
    ) -> Dict[str, float]:
        """Aggiusta pesi in base alle entità estratte."""
        adjusted = weights.copy()

        # Se ci sono riferimenti normativi specifici, boost literal
        if context.norm_references:
            adjusted["literal"] = min(adjusted["literal"] * 1.2, 1.0)

        # Se ci sono concetti giuridici astratti, boost principles
        abstract_concepts = ["principio", "diritto", "libertà", "tutela"]
        if any(c for c in context.legal_concepts if any(a in c.lower() for a in abstract_concepts)):
            adjusted["principles"] = min(adjusted["principles"] * 1.3, 1.0)

        # Se ci sono riferimenti a sentenze, boost precedent
        jur_indicators = ["sentenza", "cassazione", "corte", "tribunale"]
        if any(r for r in context.norm_references if any(j in r.lower() for j in jur_indicators)):
            adjusted["precedent"] = min(adjusted["precedent"] * 1.4, 1.0)

        return adjusted

    def _adjust_for_keywords(
        self,
        weights: Dict[str, float],
        query: str
    ) -> Dict[str, float]:
        """Aggiusta pesi in base a keyword specifiche."""
        adjusted = weights.copy()

        # Keyword che influenzano il routing
        if "storico" in query or "evoluzione" in query or "modifica" in query:
            adjusted["systemic"] = min(adjusted["systemic"] * 1.3, 1.0)

        if "ratio" in query or "scopo" in query or "finalità" in query:
            adjusted["principles"] = min(adjusted["principles"] * 1.3, 1.0)

        if "letterale" in query or "testuale" in query or "parola" in query:
            adjusted["literal"] = min(adjusted["literal"] * 1.3, 1.0)

        if "applicazione" in query or "prassi" in query or "giurisprudenza" in query:
            adjusted["precedent"] = min(adjusted["precedent"] * 1.3, 1.0)

        return adjusted

    def _build_reasoning(
        self,
        query_type: str,
        context: ExpertContext,
        weights: Dict[str, float]
    ) -> str:
        """Costruisce spiegazione della decisione."""
        parts = [f"Query classificata come '{query_type}'."]

        top_experts = sorted(weights.items(), key=lambda x: x[1], reverse=True)[:2]
        parts.append(f"Expert principali: {top_experts[0][0]} ({top_experts[0][1]:.2f})")

        if context.norm_references:
            parts.append(f"Riferimenti normativi: {len(context.norm_references)}")

        if context.legal_concepts:
            parts.append(f"Concetti giuridici: {len(context.legal_concepts)}")

        return " ".join(parts)

    def route_sync(self, context: ExpertContext) -> RoutingDecision:
        """Versione sincrona di route()."""
        import asyncio
        return asyncio.get_event_loop().run_until_complete(self.route(context))
