"""
Adaptive Synthesizer
=====================

Sintetizzatore adattivo che usa LegalDisagreementNet per decidere
come combinare le risposte degli Expert.

Modalita':
- **CONVERGENT**: Integra le prospettive in una risposta unificata
  (basso disagreement, alta resolvability)
- **DIVERGENT**: Presenta le alternative con spiegazioni del conflitto
  (alto disagreement, bassa resolvability)

Pipeline:
    ExpertResponses → DisagreementAnalysis → Mode Selection → Synthesis

Esempio:
    >>> from merlt.experts.synthesizer import AdaptiveSynthesizer
    >>>
    >>> synthesizer = AdaptiveSynthesizer()
    >>> result = await synthesizer.synthesize(
    ...     query="Il venditore puo' recedere?",
    ...     responses=expert_responses,
    ... )
    >>> print(result.mode)  # "convergent" o "divergent"
    >>> print(result.synthesis)
"""

import structlog
import time
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from merlt.experts.base import ExpertResponse, LegalSource, ReasoningStep, FeedbackHook
from merlt.disagreement.types import (
    DisagreementType,
    DisagreementLevel,
    DisagreementAnalysis,
    DisagreementExplanation,
    EXPERT_NAMES,
)

log = structlog.get_logger()


class SynthesisMode(str, Enum):
    """Modalita' di sintesi."""
    CONVERGENT = "convergent"
    DIVERGENT = "divergent"
    AUTO = "auto"  # Deciso automaticamente da DisagreementAnalysis


class UserProfile(str, Enum):
    """Profili utente per sintesi adattiva."""
    CONSULENZA = "consulenza"      # Summary + conclusion
    RICERCA = "ricerca"            # Summary + expandable details
    ANALISI = "analisi"            # Full trace
    CONTRIBUTORE = "contributore"  # Full trace + feedback hooks


@dataclass
class AccordionSection:
    """
    Sezione collassabile per progressive disclosure.

    Attributes:
        expert_type: Tipo di expert
        header: Intestazione sezione
        content: Contenuto sezione
        confidence: Confidenza dell'expert
        is_expanded: Se mostrare espansa di default
    """
    expert_type: str
    header: str
    content: str
    confidence: float
    is_expanded: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "expert_type": self.expert_type,
            "header": self.header,
            "content": self.content,
            "confidence": round(self.confidence, 3),
            "is_expanded": self.is_expanded,
        }


@dataclass
class SynthesisConfig:
    """
    Configurazione del sintetizzatore.

    Attributes:
        mode: Modalita' sintesi (auto, convergent, divergent)
        convergent_threshold: Soglia intensity sotto cui usare convergent
        resolvability_weight: Peso della resolvability nella decisione
        include_disagreement_explanation: Include spiegazione del disagreement
        max_alternatives: Numero max alternative in divergent mode
    """
    mode: SynthesisMode = SynthesisMode.AUTO
    convergent_threshold: float = 0.5
    resolvability_weight: float = 0.3
    include_disagreement_explanation: bool = True
    max_alternatives: int = 3


@dataclass
class SynthesisResult:
    """
    Risultato della sintesi adattiva.

    Attributes:
        synthesis: Testo sintesi finale
        mode: Modalita' usata (convergent/divergent)
        disagreement_analysis: Analisi del disagreement (se calcolata)
        alternatives: Alternative presentate (solo in divergent mode)
        expert_contributions: Contributi di ogni expert
        combined_legal_basis: Fonti combinate
        confidence: Confidenza aggregata
        explanation: Spiegazione del disagreement (se presente)
        execution_time_ms: Tempo di esecuzione in millisecondi
        trace_id: ID per tracing
    """
    synthesis: str
    mode: SynthesisMode
    disagreement_analysis: Optional[DisagreementAnalysis] = None
    alternatives: List[Dict[str, Any]] = field(default_factory=list)
    expert_contributions: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    combined_legal_basis: List[LegalSource] = field(default_factory=list)
    confidence: float = 0.5
    explanation: Optional[str] = None
    execution_time_ms: float = 0.0
    trace_id: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    # Profile-aware fields
    user_profile: str = ""
    confidence_indicator: str = ""
    expert_accordion: List[AccordionSection] = field(default_factory=list)
    source_links: List[Dict[str, str]] = field(default_factory=list)
    devils_advocate_flag: bool = False
    feedback_hook: Optional[FeedbackHook] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        result = {
            "synthesis": self.synthesis,
            "mode": self.mode.value,
            "disagreement_analysis": (
                self.disagreement_analysis.to_dict()
                if self.disagreement_analysis else None
            ),
            "alternatives": self.alternatives,
            "expert_contributions": self.expert_contributions,
            "combined_legal_basis": [
                lb.to_dict() for lb in self.combined_legal_basis
            ],
            "confidence": round(self.confidence, 3),
            "explanation": self.explanation,
            "execution_time_ms": round(self.execution_time_ms, 2),
            "trace_id": self.trace_id,
            "timestamp": self.timestamp,
            "metadata": self.metadata,
        }
        if self.user_profile:
            result["user_profile"] = self.user_profile
        if self.confidence_indicator:
            result["confidence_indicator"] = self.confidence_indicator
        if self.expert_accordion:
            result["expert_accordion"] = [
                s.to_dict() for s in self.expert_accordion
            ]
        if self.source_links:
            result["source_links"] = self.source_links
        if self.devils_advocate_flag:
            result["devils_advocate_flag"] = True
        if self.feedback_hook:
            result["feedback_hook"] = self.feedback_hook.to_dict()
        return result


class AdaptiveSynthesizer:
    """
    Sintetizzatore adattivo basato su disagreement detection.

    Usa LegalDisagreementNet per analizzare il disagreement tra expert
    e decide automaticamente se convergere in una risposta unica
    o presentare le alternative.

    Esempio:
        >>> synthesizer = AdaptiveSynthesizer(ai_service=openrouter)
        >>>
        >>> # Mode auto (default)
        >>> result = await synthesizer.synthesize(
        ...     query="Cos'e' la buona fede?",
        ...     responses=expert_responses,
        ... )
        >>>
        >>> if result.mode == SynthesisMode.DIVERGENT:
        ...     print("Sono state rilevate posizioni alternative:")
        ...     for alt in result.alternatives:
        ...         print(f"  - {alt['expert']}: {alt['position']}")
    """

    def __init__(
        self,
        config: Optional[SynthesisConfig] = None,
        ai_service: Any = None,
        detector: Any = None,  # LegalDisagreementNet (lazy load)
    ):
        """
        Inizializza sintetizzatore.

        Args:
            config: Configurazione sintesi
            ai_service: Servizio AI per generazione testo
            detector: LegalDisagreementNet instance (lazy load se None)
        """
        self.config = config or SynthesisConfig()
        self.ai_service = ai_service
        self._detector = detector

        log.info(
            "AdaptiveSynthesizer initialized",
            mode=self.config.mode.value,
            threshold=self.config.convergent_threshold,
        )

    @property
    def detector(self):
        """Lazy load del detector."""
        if self._detector is None:
            try:
                from merlt.disagreement.detector import get_disagreement_detector
                self._detector = get_disagreement_detector()
            except ImportError:
                log.warning("LegalDisagreementNet non disponibile, uso fallback")
                self._detector = None
        return self._detector

    async def synthesize(
        self,
        query: str,
        responses: List[ExpertResponse],
        weights: Optional[Dict[str, float]] = None,
        trace_id: str = "",
        user_profile: Optional[str] = None,
    ) -> SynthesisResult:
        """
        Sintetizza le risposte degli expert.

        Args:
            query: Query originale
            responses: Lista di ExpertResponse
            weights: Pesi per ogni expert (opzionale)
            trace_id: ID per tracing
            user_profile: Profilo utente per sintesi adattiva

        Returns:
            SynthesisResult con sintesi e metadata
        """
        start_time = time.perf_counter()

        if not trace_id:
            trace_id = datetime.now().strftime("%Y%m%d_%H%M%S_%f")

        profile = self._resolve_profile(user_profile)

        log.info(
            "Synthesizing responses",
            query=query[:50],
            num_responses=len(responses),
            trace_id=trace_id,
            profile=profile.value,
        )

        # Normalizza pesi
        if weights is None:
            weights = (
                {r.expert_type: 1.0 / len(responses) for r in responses}
                if responses else {}
            )
        else:
            # Ensure weights sum to 1.0 for correct confidence calculation
            total_w = sum(weights.get(r.expert_type, 0.0) for r in responses)
            if total_w > 0 and abs(total_w - 1.0) > 0.01:
                weights = {
                    k: v / total_w for k, v in weights.items()
                }

        # Step 1: Analizza disagreement
        disagreement_analysis = await self._analyze_disagreement(
            query, responses
        )

        # Step 2: Determina modalita'
        mode = self._determine_mode(disagreement_analysis)

        # Step 3: Esegui sintesi appropriata
        if mode == SynthesisMode.CONVERGENT:
            result = await self._synthesize_convergent(
                query, responses, weights, disagreement_analysis, trace_id
            )
        else:
            result = await self._synthesize_divergent(
                query, responses, weights, disagreement_analysis, trace_id
            )

        result.disagreement_analysis = disagreement_analysis
        result.mode = mode

        # Calibrate confidence using α-blending with disagreement analysis
        result.confidence = self._calibrate_confidence(
            result.confidence, disagreement_analysis
        )

        # Calcola execution_time_ms
        result.execution_time_ms = (
            (time.perf_counter() - start_time) * 1000
        )

        # Profile-aware enhancements
        result.user_profile = profile.value
        result.confidence_indicator = self._compute_confidence_indicator(
            result.confidence
        )
        result.expert_accordion = self._build_accordion(
            responses, weights, profile
        )
        result.source_links = self._build_source_links(responses)

        has_disagreement = (
            disagreement_analysis.has_disagreement
            if disagreement_analysis else False
        )
        result.devils_advocate_flag = has_disagreement

        # F7 feedback hook for RLCF (only for analisi/contributore)
        if profile in (UserProfile.ANALISI, UserProfile.CONTRIBUTORE):
            result.feedback_hook = FeedbackHook(
                feedback_type="F7",
                expert_type="synthesizer",
                response_id=trace_id,
                enabled=True,
            )

        result.metadata = {
            "expert_count": len(responses),
            "source_count": sum(
                len(r.legal_basis) for r in responses
            ),
            "profile": profile.value,
        }

        log.info(
            "Synthesis completed",
            mode=mode.value,
            has_disagreement=has_disagreement,
            execution_time_ms=result.execution_time_ms,
            trace_id=trace_id,
            profile=profile.value,
        )

        return result

    def _calibrate_confidence(
        self,
        expert_confidence: float,
        analysis: Optional[DisagreementAnalysis],
    ) -> float:
        """Calibrate final confidence by blending expert and disagreement signals.

        Uses α-blending: final = α * expert_conf + (1-α) * disagr_conf
        where α increases as disagreement intensity → 0.

        When experts agree (intensity=0, has_disagreement=false), α≈1.0
        so expert confidence dominates. When intensity is high, the
        disagreement detector's confidence weighs in more heavily.
        """
        if analysis is None:
            return expert_confidence

        disagr_conf = analysis.confidence
        intensity = analysis.intensity

        # α = 1 - intensity^0.5 (square root for softer curve)
        # intensity=0 → α=1.0 (pure expert confidence)
        # intensity=0.5 → α≈0.29
        # intensity=1.0 → α=0.0 (pure disagreement confidence)
        alpha = 1.0 - (intensity ** 0.5)

        # Floor: never let α go below 0.3 to avoid disagreement
        # detector dominating when it might not be well-calibrated
        alpha = max(alpha, 0.3)

        calibrated = alpha * expert_confidence + (1.0 - alpha) * disagr_conf
        return max(0.0, min(1.0, calibrated))

    def _resolve_profile(
        self, user_profile: Optional[str]
    ) -> UserProfile:
        """Resolve user profile from string."""
        if user_profile is None:
            return UserProfile.RICERCA
        try:
            return UserProfile(user_profile)
        except ValueError:
            log.warning(
                "unknown_user_profile",
                profile=user_profile,
                fallback="ricerca",
            )
            return UserProfile.RICERCA

    def _compute_confidence_indicator(self, confidence: float) -> str:
        """Compute human-readable confidence indicator."""
        if confidence >= 0.75:
            return "alta"
        elif confidence >= 0.5:
            return "media"
        else:
            return "bassa"

    def _build_accordion(
        self,
        responses: List[ExpertResponse],
        weights: Dict[str, float],
        profile: UserProfile,
    ) -> List[AccordionSection]:
        """Build collapsible expert sections based on profile."""
        if profile == UserProfile.CONSULENZA:
            return []  # No accordion for summary-only profile

        header_map = {
            "literal": "Interpretazione Letterale",
            "systemic": "Interpretazione Sistematica",
            "principles": "Ratio Legis e Principi",
            "precedent": "Giurisprudenza e Precedenti",
        }

        sorted_responses = sorted(
            responses,
            key=lambda r: weights.get(r.expert_type, 0),
            reverse=True,
        )

        sections = []
        for resp in sorted_responses:
            is_expanded = profile in (
                UserProfile.ANALISI, UserProfile.CONTRIBUTORE
            )
            sections.append(AccordionSection(
                expert_type=resp.expert_type,
                header=header_map.get(
                    resp.expert_type, resp.expert_type.title()
                ),
                content=resp.interpretation,
                confidence=resp.confidence,
                is_expanded=is_expanded,
            ))
        return sections

    def _build_source_links(
        self, responses: List[ExpertResponse]
    ) -> List[Dict[str, str]]:
        """Build source links from expert responses."""
        seen = set()
        links = []
        for resp in responses:
            for lb in resp.legal_basis:
                if lb.source_id not in seen:
                    seen.add(lb.source_id)
                    links.append({
                        "citation": lb.citation,
                        "source_id": lb.source_id,
                        "urn": (
                            lb.source_id
                            if lb.source_id.startswith("urn:")
                            else ""
                        ),
                        "expert": resp.expert_type,
                    })
        return links[:8]

    async def _analyze_disagreement(
        self,
        query: str,
        responses: List[ExpertResponse],
    ) -> Optional[DisagreementAnalysis]:
        """Analizza il disagreement tra le risposte."""
        # Short-circuit: disagreement is meaningless with fewer than 2 responses
        if len(responses) < 2:
            return self._heuristic_disagreement(responses)

        if self.detector is None:
            return self._heuristic_disagreement(responses)

        try:
            # Prepara input per detector
            expert_responses = {
                r.expert_type: r.interpretation
                for r in responses
            }

            analysis = await self.detector.detect(
                expert_responses=expert_responses,
                query=query,
            )

            return analysis

        except Exception as e:
            log.warning(f"Disagreement detection failed, using heuristic: {e}")
            return self._heuristic_disagreement(responses)

    def _heuristic_disagreement(
        self,
        responses: List[ExpertResponse],
    ) -> DisagreementAnalysis:
        """Fallback euristico per disagreement detection."""
        if len(responses) < 2:
            return DisagreementAnalysis(has_disagreement=False, confidence=0.9)

        # Calcola varianza delle confidenze
        confidences = [r.confidence for r in responses]
        variance = sum((c - sum(confidences)/len(confidences))**2 for c in confidences) / len(confidences)

        # Alta varianza = possibile disagreement
        has_disagreement = variance > 0.05

        # Controlla sovrapposizione fonti
        if len(responses) >= 2:
            source_sets = [
                {lb.source_id for lb in r.legal_basis}
                for r in responses
                if r.legal_basis
            ]
            if len(source_sets) >= 2:
                common = source_sets[0].intersection(*source_sets[1:])
                total = source_sets[0].union(*source_sets[1:])
                overlap = len(common) / max(len(total), 1)
                # Bassa sovrapposizione = probabile disagreement
                if overlap < 0.2:
                    has_disagreement = True

        intensity = variance * 4  # Scale variance to [0-1]
        intensity = min(intensity, 1.0)

        return DisagreementAnalysis(
            has_disagreement=has_disagreement,
            disagreement_type=DisagreementType.METHODOLOGICAL if has_disagreement else None,
            intensity=intensity,
            resolvability=0.5,
            confidence=0.6,  # Bassa confidence per euristica
        )

    def _determine_mode(
        self,
        analysis: Optional[DisagreementAnalysis],
    ) -> SynthesisMode:
        """Determina la modalita' di sintesi."""
        if self.config.mode != SynthesisMode.AUTO:
            return self.config.mode

        if analysis is None:
            return SynthesisMode.CONVERGENT

        # Usa logic dal DisagreementAnalysis
        if not analysis.has_disagreement:
            return SynthesisMode.CONVERGENT

        # Combina intensity e resolvability
        diverge_score = (
            analysis.intensity * (1 - self.config.resolvability_weight) +
            (1 - analysis.resolvability) * self.config.resolvability_weight
        )

        if diverge_score > self.config.convergent_threshold:
            return SynthesisMode.DIVERGENT
        else:
            return SynthesisMode.CONVERGENT

    async def _synthesize_convergent(
        self,
        query: str,
        responses: List[ExpertResponse],
        weights: Dict[str, float],
        analysis: Optional[DisagreementAnalysis],
        trace_id: str,
    ) -> SynthesisResult:
        """
        Sintesi convergente: integra le prospettive.

        Produce una risposta unificata che combina le diverse
        interpretazioni degli expert.
        """
        contributions = {}
        for resp in responses:
            w = weights.get(resp.expert_type, 0.0)
            contributions[resp.expert_type] = {
                "interpretation": resp.interpretation,
                "confidence": resp.confidence,
                "weight": w,
            }

        # Combina fonti (deduplica)
        combined_basis = []
        seen = set()
        for resp in sorted(responses, key=lambda r: weights.get(r.expert_type, 0), reverse=True):
            for lb in resp.legal_basis:
                if lb.source_id not in seen:
                    combined_basis.append(lb)
                    seen.add(lb.source_id)

        # Confidenza aggregata
        confidence = sum(
            r.confidence * weights.get(r.expert_type, 0.0)
            for r in responses
        )

        # Genera sintesi
        if self.ai_service:
            synthesis = await self._generate_convergent_synthesis(
                query, responses, weights, analysis
            )
        else:
            synthesis = self._simple_convergent_synthesis(
                responses, weights, analysis
            )

        return SynthesisResult(
            synthesis=synthesis,
            mode=SynthesisMode.CONVERGENT,
            expert_contributions=contributions,
            combined_legal_basis=combined_basis[:10],
            confidence=confidence,
            trace_id=trace_id,
        )

    async def _synthesize_divergent(
        self,
        query: str,
        responses: List[ExpertResponse],
        weights: Dict[str, float],
        analysis: Optional[DisagreementAnalysis],
        trace_id: str,
    ) -> SynthesisResult:
        """
        Sintesi divergente: presenta le alternative.

        Mostra le diverse posizioni con spiegazione del disagreement.
        """
        contributions = {}
        alternatives = []

        # Ordina per peso/confidenza
        sorted_responses = sorted(
            responses,
            key=lambda r: weights.get(r.expert_type, 0) * r.confidence,
            reverse=True,
        )

        for resp in sorted_responses[:self.config.max_alternatives]:
            contributions[resp.expert_type] = {
                "interpretation": resp.interpretation,
                "confidence": resp.confidence,
                "weight": weights.get(resp.expert_type, 0),
            }

            alternatives.append({
                "expert": resp.expert_type,
                "position": resp.interpretation[:500] + ("..." if len(resp.interpretation) > 500 else ""),
                "confidence": resp.confidence,
                "legal_basis": [lb.citation for lb in resp.legal_basis[:3]],
                "reasoning_type": self._get_reasoning_type(resp.expert_type),
            })

        # Combina fonti
        combined_basis = []
        seen = set()
        for resp in responses:
            for lb in resp.legal_basis:
                if lb.source_id not in seen:
                    combined_basis.append(lb)
                    seen.add(lb.source_id)

        # Genera spiegazione del disagreement
        explanation = None
        if self.config.include_disagreement_explanation and analysis:
            explanation = self._generate_disagreement_explanation(analysis, responses)

        # Genera sintesi
        if self.ai_service:
            synthesis = await self._generate_divergent_synthesis(
                query, responses, weights, analysis, alternatives
            )
        else:
            synthesis = self._simple_divergent_synthesis(
                alternatives, analysis, explanation
            )

        # Confidenza media (con penalty per disagreement)
        avg_confidence = sum(r.confidence for r in responses) / len(responses) if responses else 0.0
        if analysis and analysis.intensity:
            avg_confidence *= (1 - analysis.intensity * 0.3)

        return SynthesisResult(
            synthesis=synthesis,
            mode=SynthesisMode.DIVERGENT,
            alternatives=alternatives,
            expert_contributions=contributions,
            combined_legal_basis=combined_basis[:15],
            confidence=avg_confidence,
            explanation=explanation,
            trace_id=trace_id,
        )

    def _get_reasoning_type(self, expert_type: str) -> str:
        """Restituisce il tipo di ragionamento per l'expert."""
        mapping = {
            "literal": "Interpretazione letterale (significato proprio delle parole)",
            "systemic": "Interpretazione sistematica (connessione tra norme)",
            "principles": "Interpretazione teleologica (ratio legis e principi)",
            "precedent": "Interpretazione applicativa (giurisprudenza e casi simili)",
        }
        return mapping.get(expert_type, "Interpretazione giuridica")

    def _generate_disagreement_explanation(
        self,
        analysis: DisagreementAnalysis,
        responses: List[ExpertResponse],
    ) -> str:
        """Genera spiegazione del disagreement."""
        parts = []

        if analysis.disagreement_type:
            parts.append(f"**Tipo di divergenza**: {analysis.disagreement_type.label}")
            parts.append(f"_{analysis.disagreement_type.description}_")

        if analysis.disagreement_level:
            parts.append(f"\n**Livello**: {analysis.disagreement_level.label}")
            parts.append(f"_{analysis.disagreement_level.preleggi_reference}_")

        parts.append(f"\n**Intensita'**: {analysis.intensity:.0%}")
        parts.append(f"**Risolvibilita'**: {analysis.resolvability:.0%}")

        if analysis.conflicting_pairs:
            parts.append("\n**Coppie in conflitto**:")
            for pair in analysis.conflicting_pairs[:3]:
                parts.append(f"  - {pair.expert_a} vs {pair.expert_b} (score: {pair.conflict_score:.2f})")

        if analysis.disagreement_type:
            criteria = analysis.disagreement_type.resolution_criteria
            if criteria:
                parts.append("\n**Criteri di risoluzione applicabili**:")
                for c in criteria[:3]:
                    parts.append(f"  - {c}")

        return "\n".join(parts)

    def _simple_convergent_synthesis(
        self,
        responses: List[ExpertResponse],
        weights: Dict[str, float],
        analysis: Optional[DisagreementAnalysis],
    ) -> str:
        """Sintesi convergente semplice (senza LLM)."""
        sections = ["# Sintesi Integrata\n"]

        sorted_responses = sorted(
            responses,
            key=lambda r: weights.get(r.expert_type, 0),
            reverse=True,
        )

        sections.append("## Interpretazione Unificata\n")

        for resp in sorted_responses:
            w = weights.get(resp.expert_type, 0)
            if w > 0.15:  # Solo expert con peso significativo
                sections.append(f"Secondo l'approccio **{resp.expert_type}** (peso: {w:.0%}):\n")
                sections.append(resp.interpretation[:400] + "...\n" if len(resp.interpretation) > 400 else resp.interpretation + "\n")

        if analysis and analysis.has_disagreement:
            sections.append("\n*Nota: Sono state rilevate alcune divergenze minori tra le interpretazioni, "
                          "tuttavia le posizioni risultano integrabili.*")

        return "\n".join(sections)

    def _simple_divergent_synthesis(
        self,
        alternatives: List[Dict[str, Any]],
        analysis: Optional[DisagreementAnalysis],
        explanation: Optional[str],
    ) -> str:
        """Sintesi divergente semplice (senza LLM)."""
        sections = ["# Posizioni Alternative\n"]

        sections.append("**Attenzione**: Sono state rilevate divergenze significative "
                       "tra le interpretazioni degli expert. Di seguito le posizioni alternative.\n")

        if explanation:
            sections.append("---\n")
            sections.append(explanation)
            sections.append("\n---\n")

        for i, alt in enumerate(alternatives, 1):
            sections.append(f"## Posizione {i}: {alt['expert'].title()}")
            sections.append(f"*{alt['reasoning_type']}*\n")
            sections.append(alt['position'])
            if alt['legal_basis']:
                sections.append(f"\nFonti: {', '.join(alt['legal_basis'])}")
            sections.append(f"\nConfidenza: {alt['confidence']:.0%}\n")

        sections.append("\n*Il lettore e' invitato a valutare criticamente le diverse posizioni.*")

        return "\n".join(sections)

    async def _generate_convergent_synthesis(
        self,
        query: str,
        responses: List[ExpertResponse],
        weights: Dict[str, float],
        analysis: Optional[DisagreementAnalysis],
    ) -> str:
        """Genera sintesi convergente con LLM."""
        if not self.ai_service:
            return self._simple_convergent_synthesis(responses, weights, analysis)

        prompt = self._build_convergent_prompt(query, responses, weights, analysis)

        try:
            result = await self.ai_service.generate_response_async(
                prompt=prompt,
                temperature=0.3,
            )
            return result.get("content", str(result)) if isinstance(result, dict) else str(result)
        except Exception as e:
            log.error(f"LLM synthesis failed: {e}")
            return self._simple_convergent_synthesis(responses, weights, analysis)

    async def _generate_divergent_synthesis(
        self,
        query: str,
        responses: List[ExpertResponse],
        weights: Dict[str, float],
        analysis: Optional[DisagreementAnalysis],
        alternatives: List[Dict[str, Any]],
    ) -> str:
        """Genera sintesi divergente con LLM."""
        if not self.ai_service:
            return self._simple_divergent_synthesis(
                alternatives, analysis,
                self._generate_disagreement_explanation(analysis, responses) if analysis else None
            )

        prompt = self._build_divergent_prompt(query, responses, analysis, alternatives)

        try:
            result = await self.ai_service.generate_response_async(
                prompt=prompt,
                temperature=0.3,
            )
            return result.get("content", str(result)) if isinstance(result, dict) else str(result)
        except Exception as e:
            log.error(f"LLM synthesis failed: {e}")
            explanation = self._generate_disagreement_explanation(analysis, responses) if analysis else None
            return self._simple_divergent_synthesis(alternatives, analysis, explanation)

    def _build_convergent_prompt(
        self,
        query: str,
        responses: List[ExpertResponse],
        weights: Dict[str, float],
        analysis: Optional[DisagreementAnalysis],
    ) -> str:
        """Prompt per sintesi convergente."""
        sections = [
            "Sei un giurista esperto. Sintetizza le seguenti interpretazioni "
            "in una risposta **unificata e coerente**.\n",
            f"## Query\n{query}\n",
        ]

        for resp in sorted(responses, key=lambda r: weights.get(r.expert_type, 0), reverse=True):
            sections.append(f"### {resp.expert_type.upper()}")
            sections.append(resp.interpretation)
            if resp.legal_basis:
                sections.append("Fonti: " + ", ".join(lb.citation for lb in resp.legal_basis[:3]))
            sections.append("")

        sections.append(
            "\n**Istruzioni**:\n"
            "- Integra le prospettive in un'unica risposta coerente\n"
            "- Evidenzia i punti di accordo\n"
            "- Cita le fonti piu' rilevanti\n"
            "- Mantieni un tono professionale e chiaro"
        )

        return "\n".join(sections)

    def _build_divergent_prompt(
        self,
        query: str,
        responses: List[ExpertResponse],
        analysis: Optional[DisagreementAnalysis],
        alternatives: List[Dict[str, Any]],
    ) -> str:
        """Prompt per sintesi divergente."""
        sections = [
            "Sei un giurista esperto. Presenta le seguenti **posizioni alternative** "
            "in modo chiaro e imparziale, evidenziando le divergenze.\n",
            f"## Query\n{query}\n",
        ]

        if analysis and analysis.disagreement_type:
            sections.append(f"## Tipo di Divergenza\n{analysis.disagreement_type.label}: "
                          f"{analysis.disagreement_type.description}\n")

        for alt in alternatives:
            sections.append(f"### {alt['expert'].upper()}")
            sections.append(f"*{alt['reasoning_type']}*")
            sections.append(alt['position'])
            sections.append("")

        sections.append(
            "\n**Istruzioni**:\n"
            "- Presenta le posizioni in modo imparziale\n"
            "- Spiega chiaramente le differenze\n"
            "- Indica i criteri per scegliere tra le alternative\n"
            "- Non prendere posizione, lascia decidere al lettore"
        )

        return "\n".join(sections)
