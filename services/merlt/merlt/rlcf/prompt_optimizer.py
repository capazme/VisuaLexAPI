"""
Prompt Optimizer (APE)
=======================

Automatic Prompt Engineering via LLM-based optimization.

Quando il feedback medio per un expert scende sotto una soglia,
il sistema genera automaticamente candidati prompt migliorati
e seleziona il migliore.

Pipeline:
    1. Detect low performance (avg_rating < threshold)
    2. Generate candidate prompts via LLM
    3. Evaluate candidates on test queries
    4. Select best performing candidate
    5. Update prompts.yaml con nuova versione

Esempio:
    >>> from merlt.rlcf.prompt_optimizer import PromptOptimizer
    >>>
    >>> optimizer = PromptOptimizer(ai_service=openrouter)
    >>> await optimizer.optimize_if_needed(
    ...     expert_type="literal",
    ...     avg_rating=0.45,  # Sotto soglia 0.65
    ...     threshold=0.65
    ... )
"""

import structlog
import yaml
import asyncio
from pathlib import Path
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime

log = structlog.get_logger()


@dataclass
class PromptCandidate:
    """
    Candidato prompt generato da APE.

    Attributes:
        prompt: Testo del prompt candidato
        rationale: Motivazione del cambiamento
        focus_area: Area di miglioramento (clarity, specificity, etc.)
        score: Score di valutazione (dopo test)
        metadata: Metadati aggiuntivi
    """
    prompt: str
    rationale: str = ""
    focus_area: str = "general"
    score: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "prompt": self.prompt,
            "rationale": self.rationale,
            "focus_area": self.focus_area,
            "score": self.score,
            "metadata": self.metadata,
        }


@dataclass
class OptimizationResult:
    """
    Risultato di un ciclo di ottimizzazione.

    Attributes:
        expert_type: Expert ottimizzato
        original_prompt: Prompt originale
        new_prompt: Nuovo prompt selezionato
        original_score: Score originale
        new_score: Score nuovo prompt
        candidates_evaluated: Numero candidati valutati
        improvement: Miglioramento percentuale
    """
    expert_type: str
    original_prompt: str
    new_prompt: str
    original_score: float
    new_score: float
    candidates_evaluated: int
    improvement: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def __post_init__(self):
        if self.original_score > 0:
            self.improvement = (self.new_score - self.original_score) / self.original_score * 100


@dataclass
class APEConfig:
    """
    Configurazione per Automatic Prompt Engineering.

    Attributes:
        trigger_threshold: Soglia rating sotto cui triggerare APE
        num_candidates: Numero di candidati da generare
        evaluation_queries: Numero di query per valutazione
        min_improvement: Miglioramento minimo per accettare nuovo prompt
        cooldown_hours: Ore di cooldown tra ottimizzazioni stesso expert
    """
    trigger_threshold: float = 0.65
    num_candidates: int = 3
    evaluation_queries: int = 5
    min_improvement: float = 0.05
    cooldown_hours: int = 24


class PromptOptimizer:
    """
    Ottimizzatore automatico di prompt via LLM.

    Genera candidati prompt migliori quando le performance
    calano sotto una soglia configurabile.
    """

    # Meta-prompt per generazione candidati
    META_PROMPT = """Sei un esperto di prompt engineering per sistemi giuridici.

Devi migliorare il seguente prompt per un expert di interpretazione giuridica.

## PROMPT ATTUALE
```
{current_prompt}
```

## FEEDBACK RICEVUTO
- Rating medio: {avg_rating:.2f}/1.0
- Problemi principali: {issues}
- Feedback recenti: {recent_feedback}

## AREA DI FOCUS
{focus_area}

## ISTRUZIONI
1. Analizza il prompt attuale e identifica i punti deboli
2. Proponi una versione migliorata che:
   - Mantenga la struttura generale
   - Sia più chiaro e specifico
   - Guidi meglio l'LLM verso risposte accurate
   - Riduca gli errori identificati

## OUTPUT
Rispondi SOLO con il nuovo prompt, senza spiegazioni o commenti.
"""

    FOCUS_AREAS = [
        "clarity",       # Chiarezza delle istruzioni
        "specificity",   # Specificitàdegli output attesi
        "grounding",     # Ancoraggio alle fonti
        "structure",     # Struttura dell'output
        "completeness",  # Completezza delle istruzioni
    ]

    def __init__(
        self,
        ai_service: Any = None,
        config: Optional[APEConfig] = None,
        prompts_path: Optional[Path] = None,
    ):
        """
        Inizializza l'ottimizzatore.

        Args:
            ai_service: Servizio AI per generazione
            config: Configurazione APE
            prompts_path: Path al file prompts.yaml
        """
        self.ai_service = ai_service
        self.config = config or APEConfig()

        if prompts_path is None:
            prompts_path = Path(__file__).parent.parent / "experts" / "config" / "prompts.yaml"
        self.prompts_path = prompts_path

        # Tracking ultimo optimization per cooldown
        self._last_optimization: Dict[str, datetime] = {}
        self._optimization_history: List[OptimizationResult] = []

        log.info(
            "PromptOptimizer initialized",
            config=self.config.__dict__,
            prompts_path=str(prompts_path),
        )

    async def optimize_if_needed(
        self,
        expert_type: str,
        avg_rating: float,
        threshold: Optional[float] = None,
        feedback_history: Optional[List[Dict]] = None,
    ) -> Optional[OptimizationResult]:
        """
        Esegue ottimizzazione se necessaria.

        Args:
            expert_type: Tipo di expert da ottimizzare
            avg_rating: Rating medio recente
            threshold: Soglia (default da config)
            feedback_history: Storia dei feedback recenti

        Returns:
            OptimizationResult se ottimizzato, None altrimenti
        """
        threshold = threshold or self.config.trigger_threshold

        # Check se sopra soglia
        if avg_rating >= threshold:
            log.debug(
                "APE not triggered - rating above threshold",
                expert_type=expert_type,
                avg_rating=avg_rating,
                threshold=threshold,
            )
            return None

        # Check cooldown
        if self._is_in_cooldown(expert_type):
            log.info(
                "APE skipped - in cooldown",
                expert_type=expert_type,
            )
            return None

        log.info(
            "APE triggered",
            expert_type=expert_type,
            avg_rating=avg_rating,
            threshold=threshold,
        )

        # Esegui ottimizzazione
        result = await self._optimize_prompt(
            expert_type=expert_type,
            avg_rating=avg_rating,
            feedback_history=feedback_history or [],
        )

        if result:
            self._last_optimization[expert_type] = datetime.now()
            self._optimization_history.append(result)

        return result

    def _is_in_cooldown(self, expert_type: str) -> bool:
        """Verifica se expert e' in cooldown."""
        last = self._last_optimization.get(expert_type)
        if last is None:
            return False

        hours_since = (datetime.now() - last).total_seconds() / 3600
        return hours_since < self.config.cooldown_hours

    async def _optimize_prompt(
        self,
        expert_type: str,
        avg_rating: float,
        feedback_history: List[Dict],
    ) -> Optional[OptimizationResult]:
        """
        Esegue il ciclo di ottimizzazione.

        1. Carica prompt corrente
        2. Genera candidati
        3. Valuta candidati
        4. Seleziona migliore
        5. Salva se migliorato
        """
        # Step 1: Carica prompt corrente
        current_prompt = self._load_current_prompt(expert_type)
        if not current_prompt:
            log.error(f"Cannot load prompt for {expert_type}")
            return None

        # Step 2: Genera candidati
        candidates = await self.generate_candidates(
            expert_type=expert_type,
            current_prompt=current_prompt,
            feedback_history=feedback_history,
            num_candidates=self.config.num_candidates,
        )

        if not candidates:
            log.warning("No candidates generated")
            return None

        # Step 3: Valuta candidati
        # Per ora usiamo una valutazione semplificata
        # In produzione si userebbero query di test reali
        best_candidate = await self._evaluate_candidates(
            candidates=candidates,
            expert_type=expert_type,
        )

        if not best_candidate:
            return None

        # Step 4: Verifica miglioramento
        improvement = best_candidate.score - avg_rating
        if improvement < self.config.min_improvement:
            log.info(
                "APE: improvement too small, keeping current prompt",
                improvement=improvement,
                min_required=self.config.min_improvement,
            )
            return None

        # Step 5: Salva nuovo prompt
        self._save_new_prompt(expert_type, best_candidate.prompt)

        result = OptimizationResult(
            expert_type=expert_type,
            original_prompt=current_prompt[:200] + "...",  # Tronca per log
            new_prompt=best_candidate.prompt[:200] + "...",
            original_score=avg_rating,
            new_score=best_candidate.score,
            candidates_evaluated=len(candidates),
        )

        log.info(
            "APE: prompt optimized",
            expert_type=expert_type,
            improvement=f"{result.improvement:.1f}%",
            new_score=best_candidate.score,
        )

        return result

    async def generate_candidates(
        self,
        expert_type: str,
        current_prompt: str,
        feedback_history: List[Dict],
        num_candidates: int = 3,
    ) -> List[PromptCandidate]:
        """
        Genera candidati prompt migliorati.

        Args:
            expert_type: Tipo di expert
            current_prompt: Prompt corrente
            feedback_history: Storia feedback
            num_candidates: Numero candidati

        Returns:
            Lista di PromptCandidate
        """
        if not self.ai_service:
            log.warning("No AI service - using fallback candidates")
            return self._generate_fallback_candidates(current_prompt)

        candidates = []

        # Genera candidati con diversi focus
        focus_areas = self.FOCUS_AREAS[:num_candidates]

        for focus in focus_areas:
            try:
                candidate = await self._generate_candidate(
                    current_prompt=current_prompt,
                    focus_area=focus,
                    feedback_history=feedback_history,
                )
                if candidate:
                    candidates.append(candidate)
            except Exception as e:
                log.warning(f"Failed to generate candidate with focus {focus}: {e}")

        return candidates

    async def _generate_candidate(
        self,
        current_prompt: str,
        focus_area: str,
        feedback_history: List[Dict],
    ) -> Optional[PromptCandidate]:
        """Genera singolo candidato via LLM."""
        # Prepara feedback summary
        recent_feedback = self._summarize_feedback(feedback_history[-5:])
        issues = self._identify_issues(feedback_history)

        prompt = self.META_PROMPT.format(
            current_prompt=current_prompt,
            avg_rating=sum(f.get("rating", 0.5) for f in feedback_history[-10:]) / max(len(feedback_history[-10:]), 1),
            issues=issues,
            recent_feedback=recent_feedback,
            focus_area=focus_area,
        )

        try:
            response = await self.ai_service.complete(
                prompt=prompt,
                max_tokens=4000,
                temperature=0.7,  # Un po' di creativita'
            )

            return PromptCandidate(
                prompt=response.strip(),
                focus_area=focus_area,
                rationale=f"Ottimizzato per {focus_area}",
            )

        except Exception as e:
            log.error(f"LLM generation failed: {e}")
            return None

    def _generate_fallback_candidates(self, current_prompt: str) -> List[PromptCandidate]:
        """Candidati fallback quando LLM non disponibile."""
        # Varianti minori del prompt corrente
        return [
            PromptCandidate(
                prompt=current_prompt + "\n\nRicorda: sii preciso e cita sempre le fonti.",
                focus_area="grounding",
                rationale="Aggiunto reminder su fonti",
                score=0.55,
            ),
            PromptCandidate(
                prompt=current_prompt + "\n\nFormatta la risposta in modo chiaro e strutturato.",
                focus_area="structure",
                rationale="Aggiunto reminder su struttura",
                score=0.52,
            ),
        ]

    async def _evaluate_candidates(
        self,
        candidates: List[PromptCandidate],
        expert_type: str,
    ) -> Optional[PromptCandidate]:
        """
        Valuta i candidati e seleziona il migliore.

        Per ora usa una valutazione euristica.
        In produzione userebbe query di test reali.
        """
        if not candidates:
            return None

        # Valutazione euristica basata su lunghezza e parole chiave
        for candidate in candidates:
            score = 0.5

            # Bonus per lunghezza ragionevole
            if 500 < len(candidate.prompt) < 5000:
                score += 0.1

            # Bonus per parole chiave importanti
            keywords = ["fonte", "citazione", "JSON", "confidence", "legal_basis"]
            for kw in keywords:
                if kw.lower() in candidate.prompt.lower():
                    score += 0.05

            # Bonus per struttura (headers)
            if "##" in candidate.prompt:
                score += 0.05

            candidate.score = min(score, 1.0)

        # Seleziona migliore
        best = max(candidates, key=lambda c: c.score)

        log.info(
            "Candidates evaluated",
            num_candidates=len(candidates),
            best_score=best.score,
            best_focus=best.focus_area,
        )

        return best

    def _load_current_prompt(self, expert_type: str) -> Optional[str]:
        """Carica prompt corrente da YAML."""
        try:
            with open(self.prompts_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)

            return data.get("experts", {}).get(expert_type, {}).get("system_prompt")

        except Exception as e:
            log.error(f"Failed to load prompt: {e}")
            return None

    def _save_new_prompt(self, expert_type: str, new_prompt: str) -> bool:
        """Salva nuovo prompt nel YAML."""
        try:
            with open(self.prompts_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)

            # Aggiorna prompt
            if "experts" not in data:
                data["experts"] = {}
            if expert_type not in data["experts"]:
                data["experts"][expert_type] = {}

            data["experts"][expert_type]["system_prompt"] = new_prompt

            # Aggiorna versione
            old_version = data.get("version", "1.0.0")
            parts = old_version.split(".")
            parts[-1] = str(int(parts[-1]) + 1)
            data["version"] = ".".join(parts)

            # Salva
            with open(self.prompts_path, "w", encoding="utf-8") as f:
                yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

            log.info(
                "New prompt saved",
                expert_type=expert_type,
                new_version=data["version"],
            )

            return True

        except Exception as e:
            log.error(f"Failed to save prompt: {e}")
            return False

    def _summarize_feedback(self, feedback_list: List[Dict]) -> str:
        """Riassume feedback recenti."""
        if not feedback_list:
            return "Nessun feedback recente"

        comments = [f.get("comment", "") for f in feedback_list if f.get("comment")]
        if comments:
            return "; ".join(comments[:3])

        return "Feedback senza commenti specifici"

    def _identify_issues(self, feedback_list: List[Dict]) -> str:
        """Identifica problemi comuni nei feedback."""
        issues = []

        low_ratings = [f for f in feedback_list if f.get("rating", 1) < 0.5]
        if len(low_ratings) > len(feedback_list) * 0.3:
            issues.append("Rating frequentemente bassi")

        # Placeholder per analisi più sofisticate
        if not issues:
            issues.append("Performance sotto le attese")

        return "; ".join(issues)

    def get_optimization_history(self) -> List[Dict]:
        """Restituisce storia delle ottimizzazioni."""
        return [r.__dict__ for r in self._optimization_history]
