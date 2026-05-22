"""
LLM-as-Judge per valutazione soggettiva delle risposte.

Utilizza un LLM per valutare dimensioni che richiedono giudizio:
- Accuratezza giuridica
- Chiarezza espositiva
- Utilità pratica
- Qualità del ragionamento

Il giudice usa Chain-of-Thought per produrre valutazioni motivate
e consistenti, con punteggi su scala 1-5.
"""

import json
import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)


@dataclass
class SubjectiveMetrics:
    """
    Metriche soggettive valutate dall'LLM Judge.

    Ogni metrica include:
    - score: Punteggio 1-5
    - reasoning: Motivazione del punteggio

    Attributes:
        accuracy: Accuratezza giuridica (1-5)
        clarity: Chiarezza espositiva (1-5)
        utility: Utilità pratica (1-5)
        reasoning_quality: Qualità del ragionamento (1-5)
        overall_assessment: Valutazione complessiva testuale
        raw_response: Risposta grezza dell'LLM
        evaluated_at: Timestamp valutazione
    """

    accuracy: float
    accuracy_reasoning: str
    clarity: float
    clarity_reasoning: str
    utility: float
    utility_reasoning: str
    reasoning_quality: float
    reasoning_reasoning: str
    overall_assessment: str
    raw_response: Optional[str] = None
    evaluated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    judge_model: str = ""
    judge_tokens: int = 0

    @property
    def average_score(self) -> float:
        """Media dei punteggi (1-5)."""
        return (self.accuracy + self.clarity + self.utility + self.reasoning_quality) / 4

    @property
    def normalized_score(self) -> float:
        """Media normalizzata (0-1)."""
        return self.average_score / 5

    @property
    def weighted_score(self) -> float:
        """
        Punteggio pesato secondo importanza per uso legale.

        Pesi:
        - accuracy: 0.35 (più importante)
        - clarity: 0.25
        - utility: 0.25
        - reasoning: 0.15
        """
        return (
            0.35 * self.accuracy +
            0.25 * self.clarity +
            0.25 * self.utility +
            0.15 * self.reasoning_quality
        ) / 5  # Normalizzato 0-1

    def to_dict(self) -> Dict[str, Any]:
        """Serializza le metriche in dizionario."""
        return {
            "accuracy": {"score": self.accuracy, "reasoning": self.accuracy_reasoning},
            "clarity": {"score": self.clarity, "reasoning": self.clarity_reasoning},
            "utility": {"score": self.utility, "reasoning": self.utility_reasoning},
            "reasoning": {"score": self.reasoning_quality, "reasoning": self.reasoning_reasoning},
            "overall_assessment": self.overall_assessment,
            "average_score": self.average_score,
            "normalized_score": self.normalized_score,
            "weighted_score": self.weighted_score,
            "judge_model": self.judge_model,
            "evaluated_at": self.evaluated_at,
        }


class LLMJudge:
    """
    Valutatore LLM per metriche soggettive.

    Usa Chain-of-Thought prompting per produrre valutazioni
    motivate e consistenti su scala 1-5.

    Attributes:
        ai_service: Servizio AI per generazione (OpenRouterService)
        judge_model: Modello da usare come giudice
        temperature: Temperatura per consistenza (default 0.1)
    """

    EVALUATION_PROMPT = """Sei un valutatore esperto di risposte legali italiane. Devi valutare la qualità di una risposta a una domanda giuridica.

## QUERY ORIGINALE
{query}

## RISPOSTA DA VALUTARE
{response}

## FONTI CITATE
{sources}

## RUBRICA DI VALUTAZIONE

Per ogni dimensione, PRIMA ragiona step-by-step, POI assegna un punteggio.

### 1. ACCURATEZZA GIURIDICA (accuracy)
Valuta la correttezza sostanziale della risposta:
- Le affermazioni sono giuridicamente corrette?
- Le interpretazioni sono conformi alla dottrina prevalente?
- Ci sono errori di diritto?
- Le citazioni normative sono corrette?

Scala:
- 1 = Errori gravi che invalidano la risposta
- 2 = Errori significativi ma risposta parzialmente valida
- 3 = Risposta corretta nelle linee generali, imprecisioni minori
- 4 = Risposta corretta e precisa
- 5 = Risposta eccellente, tecnicamente impeccabile

### 2. CHIAREZZA ESPOSITIVA (clarity)
Valuta la forma e la struttura:
- La risposta è ben organizzata?
- Il linguaggio giuridico è usato correttamente?
- La logica argomentativa è chiara?
- Il lettore può seguire facilmente il ragionamento?

Scala:
- 1 = Confuso, incomprensibile
- 2 = Difficile da seguire, struttura disordinata
- 3 = Accettabile, comprensibile con sforzo
- 4 = Chiaro e ben strutturato
- 5 = Cristallino, esposizione eccellente

### 3. UTILITÀ PRATICA (utility)
Valuta l'applicabilità pratica:
- La risposta aiuta concretamente l'utente?
- Fornisce indicazioni operative?
- È applicabile al caso concreto?
- Permette di agire o decidere?

Scala:
- 1 = Inutile per scopi pratici
- 2 = Poco utile, troppo astratto
- 3 = Parzialmente utile
- 4 = Utile, fornisce indicazioni concrete
- 5 = Molto utile, immediatamente applicabile

### 4. QUALITÀ DEL RAGIONAMENTO (reasoning)
Valuta la solidità argomentativa:
- I passaggi logici sono espliciti?
- Le conclusioni seguono dalle premesse?
- L'argomentazione è completa?
- Vengono considerati aspetti rilevanti?

Scala:
- 1 = Ragionamento assente o fallace
- 2 = Ragionamento debole, salti logici
- 3 = Ragionamento sufficiente
- 4 = Ragionamento buono e coerente
- 5 = Ragionamento eccellente, rigoroso

## ISTRUZIONI OUTPUT

Rispondi SOLO con un oggetto JSON valido nel seguente formato:
```json
{{
  "accuracy": {{"reasoning": "Analisi step-by-step dell'accuratezza...", "score": X}},
  "clarity": {{"reasoning": "Analisi step-by-step della chiarezza...", "score": X}},
  "utility": {{"reasoning": "Analisi step-by-step dell'utilità...", "score": X}},
  "reasoning": {{"reasoning": "Analisi step-by-step del ragionamento...", "score": X}},
  "overall_assessment": "Valutazione complessiva in 2-3 frasi"
}}
```

Sostituisci X con un numero intero da 1 a 5.
Non aggiungere altro testo prima o dopo il JSON."""

    def __init__(
        self,
        ai_service: Optional[Any] = None,
        judge_model: Optional[str] = None,
        temperature: float = 0.1,
    ):
        """
        Inizializza il giudice LLM.

        Args:
            ai_service: Servizio AI (OpenRouterService). Se None, creato automaticamente.
            judge_model: Modello da usare. Default da env RLCF_JUDGE_MODEL.
            temperature: Temperatura per generazione (0.1 per consistenza).
        """
        self.ai_service = ai_service
        self.judge_model = judge_model or os.getenv(
            "RLCF_JUDGE_MODEL",
            "google/gemini-2.5-flash"
        )
        self.temperature = temperature
        self._initialized = False

    async def _ensure_initialized(self):
        """Inizializza il servizio AI se necessario."""
        if self._initialized:
            return

        if self.ai_service is None:
            # Import dinamico per evitare dipendenze circolari
            try:
                from merlt.rlcf.ai_service import OpenRouterService
                self.ai_service = OpenRouterService()
            except ImportError:
                raise RuntimeError(
                    "OpenRouterService non disponibile. Installa le dipendenze AI "
                    "o passa un ai_service esplicito a LLMJudge(). "
                    "Per testing, usa LLMJudge(ai_service=MockAIService())."
                )

        self._initialized = True

    async def evaluate(
        self,
        query: str,
        response: Any,  # ExpertResponse
        include_raw: bool = False
    ) -> SubjectiveMetrics:
        """
        Valuta una risposta expert usando LLM-as-Judge.

        Args:
            query: Query originale dell'utente
            response: Risposta dell'expert (ExpertResponse)
            include_raw: Se True, include risposta grezza dell'LLM

        Returns:
            SubjectiveMetrics con punteggi e motivazioni
        """
        await self._ensure_initialized()

        # Formatta il prompt
        prompt = self.EVALUATION_PROMPT.format(
            query=query,
            response=self._format_response(response),
            sources=self._format_sources(response)
        )

        # Genera valutazione
        try:
            result = await self.ai_service.generate_response_async(
                prompt=prompt,
                model=self.judge_model,
                temperature=self.temperature,
            )

            # Estrai contenuto
            if isinstance(result, dict):
                content = result.get("content", "")
                tokens = result.get("usage", {}).get("total_tokens", 0)
            else:
                content = str(result)
                tokens = 0

            # Parse JSON
            metrics = self._parse_evaluation(content)
            metrics.judge_model = self.judge_model
            metrics.judge_tokens = tokens

            if include_raw:
                metrics.raw_response = content

            return metrics

        except Exception as e:
            logger.error(f"Errore valutazione LLM: {e}")
            return self._create_fallback_metrics(str(e))

    def _format_response(self, response: Any) -> str:
        """Formatta la risposta per il prompt."""
        if hasattr(response, "interpretation"):
            return response.interpretation
        return str(response)

    def _format_sources(self, response: Any) -> str:
        """Formatta le fonti citate per il prompt."""
        if not hasattr(response, "legal_basis"):
            return "Nessuna fonte citata"

        sources = []
        for i, source in enumerate(response.legal_basis, 1):
            source_id = getattr(source, "source_id", "N/A")
            text = getattr(source, "text", "")[:200]  # Troncato
            relevance = getattr(source, "relevance", "")
            sources.append(f"{i}. [{source_id}] {text}... (Rilevanza: {relevance})")

        return "\n".join(sources) if sources else "Nessuna fonte citata"

    def _parse_evaluation(self, content: str) -> SubjectiveMetrics:
        """
        Parse la risposta JSON dell'LLM.

        Gestisce vari formati e fallback robusti.
        """
        # Pulisci il contenuto
        content = content.strip()

        # Rimuovi markdown code fences
        if content.startswith("```"):
            # Trova prima newline dopo ```
            first_newline = content.find("\n")
            if first_newline > 0:
                content = content[first_newline + 1:]
            else:
                content = content[3:]
        if content.endswith("```"):
            content = content[:-3].strip()

        # Trova JSON nell'output
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            content = json_match.group()

        try:
            data = json.loads(content)
            return self._extract_metrics(data)
        except json.JSONDecodeError as e:
            logger.warning(f"Errore parsing JSON: {e}")
            return self._create_fallback_metrics(f"Parse error: {e}")

    def _extract_metrics(self, data: Dict[str, Any]) -> SubjectiveMetrics:
        """Estrae metriche dal dizionario JSON."""
        def get_score(dimension: str) -> tuple[float, str]:
            dim_data = data.get(dimension, {})
            if isinstance(dim_data, dict):
                score = dim_data.get("score", 3)
                reasoning = dim_data.get("reasoning", "")
            else:
                score = dim_data if isinstance(dim_data, (int, float)) else 3
                reasoning = ""
            # Clamp score a 1-5
            score = max(1, min(5, float(score)))
            return score, reasoning

        accuracy, accuracy_r = get_score("accuracy")
        clarity, clarity_r = get_score("clarity")
        utility, utility_r = get_score("utility")
        reasoning, reasoning_r = get_score("reasoning")

        overall = data.get("overall_assessment", "Valutazione non disponibile")

        return SubjectiveMetrics(
            accuracy=accuracy,
            accuracy_reasoning=accuracy_r,
            clarity=clarity,
            clarity_reasoning=clarity_r,
            utility=utility,
            utility_reasoning=utility_r,
            reasoning_quality=reasoning,
            reasoning_reasoning=reasoning_r,
            overall_assessment=overall,
        )

    def _create_fallback_metrics(self, error_msg: str) -> SubjectiveMetrics:
        """Crea metriche di fallback in caso di errore."""
        return SubjectiveMetrics(
            accuracy=3.0,
            accuracy_reasoning=f"Fallback: {error_msg}",
            clarity=3.0,
            clarity_reasoning="Fallback",
            utility=3.0,
            utility_reasoning="Fallback",
            reasoning_quality=3.0,
            reasoning_reasoning="Fallback",
            overall_assessment=f"Valutazione fallback a causa di errore: {error_msg}",
        )


class MockAIService:
    """Mock AI service per testing senza API.

    ATTENZIONE: produce punteggi randomizzati, NON usare in produzione.
    Uso corretto: LLMJudge(ai_service=MockAIService()) nei test.
    """

    async def generate_response_async(
        self,
        prompt: str,
        model: str,
        temperature: float = 0.1,
        **kwargs
    ) -> Dict[str, Any]:
        """Genera risposta mock con punteggi randomizzati ma realistici."""
        import random

        # Punteggi base con variazione
        base_score = 3.5
        variation = 0.8

        scores = {
            "accuracy": min(5, max(1, round(base_score + random.uniform(-variation, variation)))),
            "clarity": min(5, max(1, round(base_score + random.uniform(-variation, variation)))),
            "utility": min(5, max(1, round(base_score + random.uniform(-variation, variation)))),
            "reasoning": min(5, max(1, round(base_score + random.uniform(-variation, variation)))),
        }

        response = {
            "accuracy": {"score": scores["accuracy"], "reasoning": "Mock evaluation"},
            "clarity": {"score": scores["clarity"], "reasoning": "Mock evaluation"},
            "utility": {"score": scores["utility"], "reasoning": "Mock evaluation"},
            "reasoning": {"score": scores["reasoning"], "reasoning": "Mock evaluation"},
            "overall_assessment": "Mock evaluation - valutazione simulata per testing"
        }

        return {
            "content": json.dumps(response),
            "usage": {"total_tokens": 100}
        }


async def evaluate_batch(
    judge: LLMJudge,
    queries: List[str],
    responses: List[Any],
) -> List[SubjectiveMetrics]:
    """
    Valuta un batch di risposte.

    Args:
        judge: LLMJudge configurato
        queries: Lista di query originali
        responses: Lista di ExpertResponse

    Returns:
        Lista di SubjectiveMetrics
    """
    if len(queries) != len(responses):
        raise ValueError("queries e responses devono avere la stessa lunghezza")

    results = []
    for query, response in zip(queries, responses):
        metrics = await judge.evaluate(query, response)
        results.append(metrics)

    return results
