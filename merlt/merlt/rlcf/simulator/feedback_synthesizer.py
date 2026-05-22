"""
Sintetizzatore di feedback che combina metriche oggettive e soggettive.

Questo modulo prende:
- ObjectiveMetrics (source grounding, hallucination rate, etc.)
- SubjectiveMetrics (accuracy, clarity, utility, reasoning)
- SyntheticUser (bias, noise, authority)

E produce un feedback simulato realistico che viene poi passato
al loop RLCF per l'aggiornamento dei pesi.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional
from datetime import datetime
import numpy as np

from merlt.rlcf.simulator.users import SyntheticUser
from merlt.rlcf.simulator.objective_metrics import ObjectiveMetrics
from merlt.rlcf.simulator.llm_judge import SubjectiveMetrics


@dataclass
class SimulatedFeedback:
    """
    Feedback simulato pronto per il loop RLCF.

    Questo feedback ha lo stesso formato di un feedback reale
    e può essere passato direttamente a RLCFOrchestrator.

    Attributes:
        user_id: ID dell'utente sintetico
        rating: Rating complessivo (0.0-1.0)
        accuracy_score: Punteggio accuratezza (1-5)
        utility_score: Punteggio utilità (1-5)
        transparency_score: Punteggio trasparenza/chiarezza (1-5)
        feedback_type: Tipo di feedback ("simulated")
        feedback_details: Dettagli completi del feedback
        authority_at_feedback: Authority dell'utente al momento del feedback
        created_at: Timestamp creazione
    """

    user_id: int
    rating: float  # 0.0-1.0
    accuracy_score: float  # 1-5
    utility_score: float  # 1-5
    transparency_score: float  # 1-5
    feedback_type: str = "simulated"
    feedback_details: Dict[str, Any] = field(default_factory=dict)
    authority_at_feedback: float = 0.0
    quality_score: float = 0.0  # Qualità della risposta (per migliorare il sistema)
    feedback_accuracy: float = 0.0  # Accuratezza del feedback utente (per authority)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        """Serializza il feedback in dizionario."""
        return {
            "user_id": self.user_id,
            "rating": self.rating,
            "accuracy_score": self.accuracy_score,
            "utility_score": self.utility_score,
            "transparency_score": self.transparency_score,
            "feedback_type": self.feedback_type,
            "feedback_details": self.feedback_details,
            "authority_at_feedback": self.authority_at_feedback,
            "quality_score": self.quality_score,
            "feedback_accuracy": self.feedback_accuracy,
            "created_at": self.created_at,
        }

    def to_rlcf_format(self) -> Dict[str, Any]:
        """
        Converte in formato compatibile con RLCF database.

        Restituisce un dizionario pronto per essere passato a
        RLCFOrchestrator.record_expert_feedback().
        """
        return {
            "user_rating": self.rating,
            "feedback_type": self.feedback_type,
            "user_id": self.user_id,
            "feedback_details": {
                "accuracy_score": self.accuracy_score,
                "utility_score": self.utility_score,
                "transparency_score": self.transparency_score,
                "simulated": True,
                **self.feedback_details,
            },
        }


class FeedbackSynthesizer:
    """
    Combina metriche oggettive e soggettive in feedback simulato.

    Il processo di sintesi:
    1. Calcola score base da metriche oggettive (40%)
    2. Calcola score da metriche soggettive (60%)
    3. Applica bias del profilo utente
    4. Aggiunge rumore gaussiano
    5. Clamp al range [0, 1]

    Attributes:
        objective_weight: Peso delle metriche oggettive (default 0.4)
        subjective_weight: Peso delle metriche soggettive (default 0.6)
        random_seed: Seed per riproducibilità
    """

    # Pesi per combinazione metriche oggettive
    OBJECTIVE_WEIGHTS = {
        "source_grounding": 0.40,
        "no_hallucination": 0.30,  # 1 - hallucination_rate
        "citation_accuracy": 0.20,
        "coverage": 0.10,
    }

    # Pesi per combinazione metriche soggettive
    SUBJECTIVE_WEIGHTS = {
        "accuracy": 0.35,
        "clarity": 0.25,
        "utility": 0.25,
        "reasoning": 0.15,
    }

    def __init__(
        self,
        objective_weight: float = 0.4,
        subjective_weight: float = 0.6,
        random_seed: Optional[int] = None,
    ):
        """
        Inizializza il sintetizzatore.

        Args:
            objective_weight: Peso metriche oggettive (0-1)
            subjective_weight: Peso metriche soggettive (0-1)
            random_seed: Seed per riproducibilità noise
        """
        if not np.isclose(objective_weight + subjective_weight, 1.0):
            raise ValueError("objective_weight + subjective_weight deve essere 1.0")

        self.objective_weight = objective_weight
        self.subjective_weight = subjective_weight

        if random_seed is not None:
            np.random.seed(random_seed)

    def synthesize(
        self,
        user: SyntheticUser,
        objective: ObjectiveMetrics,
        subjective: SubjectiveMetrics,
        include_reasoning: bool = True,
    ) -> SimulatedFeedback:
        """
        Sintetizza feedback da metriche oggettive e soggettive.

        Args:
            user: Utente sintetico che fornisce il feedback
            objective: Metriche oggettive calcolate
            subjective: Metriche soggettive da LLM-as-Judge
            include_reasoning: Se True, include reasoning nei dettagli

        Returns:
            SimulatedFeedback pronto per RLCF
        """
        # 1. Calcola score oggettivo (0-1)
        objective_score = self._compute_objective_score(objective)

        # 2. Calcola score soggettivo (0-1, normalizzato da scala 1-5)
        subjective_score = self._compute_subjective_score(subjective)

        # 3. Combina con pesi
        base_rating = (
            self.objective_weight * objective_score +
            self.subjective_weight * subjective_score
        )

        # 4. Applica bias del profilo utente
        biased_rating = self._apply_user_bias(base_rating, user, subjective)

        # 5. Aggiungi rumore gaussiano
        noisy_rating = self._add_noise(biased_rating, user.noise_level)

        # 6. Clamp al range [0, 1]
        final_rating = float(np.clip(noisy_rating, 0.0, 1.0))

        # 7. Applica bias anche ai punteggi individuali
        accuracy = self._apply_dimension_bias(
            subjective.accuracy, user, "accuracy"
        )
        utility = self._apply_dimension_bias(
            subjective.utility, user, "utility"
        )
        clarity = self._apply_dimension_bias(
            subjective.clarity, user, "clarity"
        )

        # 8. Costruisci dettagli
        details = self._build_feedback_details(
            user, objective, subjective, include_reasoning
        )

        # 9. Calcola quality score per RLCF (qualità della risposta)
        quality_score = self._compute_quality_score(
            final_rating, objective_score, subjective_score
        )

        # 10. Calcola feedback_accuracy (quanto il rating utente è vicino al ground truth)
        # Ground truth = rating base prima di bias e noise
        feedback_accuracy = self._compute_feedback_accuracy(
            user_rating=final_rating,
            ground_truth=base_rating,
            objective_score=objective_score,
        )

        return SimulatedFeedback(
            user_id=user.user_id,
            rating=final_rating,
            accuracy_score=accuracy,
            utility_score=utility,
            transparency_score=clarity,
            feedback_details=details,
            authority_at_feedback=user.current_authority,
            quality_score=quality_score,
            feedback_accuracy=feedback_accuracy,
        )

    def _compute_objective_score(self, metrics: ObjectiveMetrics) -> float:
        """
        Calcola score oggettivo pesato.

        Formula: Σ weight_i * metric_i
        """
        score = (
            self.OBJECTIVE_WEIGHTS["source_grounding"] * metrics.source_grounding +
            self.OBJECTIVE_WEIGHTS["no_hallucination"] * (1 - metrics.hallucination_rate) +
            self.OBJECTIVE_WEIGHTS["citation_accuracy"] * metrics.citation_accuracy +
            self.OBJECTIVE_WEIGHTS["coverage"] * metrics.coverage_score
        )
        return float(score)

    def _compute_subjective_score(self, metrics: SubjectiveMetrics) -> float:
        """
        Calcola score soggettivo pesato e normalizzato.

        I punteggi LLM sono su scala 1-5, normalizziamo a 0-1.
        Formula: Σ weight_i * (score_i - 1) / 4
        """
        def normalize(score_1_5: float) -> float:
            return (score_1_5 - 1) / 4  # Mappa 1-5 a 0-1

        score = (
            self.SUBJECTIVE_WEIGHTS["accuracy"] * normalize(metrics.accuracy) +
            self.SUBJECTIVE_WEIGHTS["clarity"] * normalize(metrics.clarity) +
            self.SUBJECTIVE_WEIGHTS["utility"] * normalize(metrics.utility) +
            self.SUBJECTIVE_WEIGHTS["reasoning"] * normalize(metrics.reasoning_quality)
        )
        return float(score)

    def _apply_user_bias(
        self,
        base_rating: float,
        user: SyntheticUser,
        subjective: SubjectiveMetrics
    ) -> float:
        """
        Applica il bias del profilo utente al rating.

        Il bias viene calcolato come media pesata dei bias per dimensione,
        poi applicato al rating base.
        """
        # Calcola bias medio pesato
        biases = user.evaluation_bias
        avg_bias = (
            self.SUBJECTIVE_WEIGHTS["accuracy"] * biases.get("accuracy", 0) +
            self.SUBJECTIVE_WEIGHTS["clarity"] * biases.get("clarity", 0) +
            self.SUBJECTIVE_WEIGHTS["utility"] * biases.get("utility", 0) +
            self.SUBJECTIVE_WEIGHTS["reasoning"] * biases.get("reasoning", 0)
        )

        # Applica bias (già normalizzato per scala 0-1)
        return base_rating + avg_bias

    def _apply_dimension_bias(
        self,
        score: float,
        user: SyntheticUser,
        dimension: str
    ) -> float:
        """
        Applica bias a un singolo punteggio dimensionale.

        Args:
            score: Punteggio originale (1-5)
            user: Utente con bias
            dimension: Dimensione (accuracy, clarity, etc.)

        Returns:
            Punteggio con bias applicato e noise (1-5)
        """
        bias = user.evaluation_bias.get(dimension, 0.0)
        # Bias è in scala 0-1, moltiplichiamo per range scala (4)
        biased_score = score + (bias * 4)

        # Aggiungi noise
        noise = np.random.normal(0, user.noise_level * 2)  # Scala per 1-5
        noisy_score = biased_score + noise

        # Clamp a 1-5
        return float(np.clip(noisy_score, 1.0, 5.0))

    def _add_noise(self, rating: float, noise_level: float) -> float:
        """
        Aggiunge rumore gaussiano al rating.

        Args:
            rating: Rating base
            noise_level: Deviazione standard del rumore

        Returns:
            Rating con rumore
        """
        noise = np.random.normal(0, noise_level)
        return rating + noise

    def _build_feedback_details(
        self,
        user: SyntheticUser,
        objective: ObjectiveMetrics,
        subjective: SubjectiveMetrics,
        include_reasoning: bool,
    ) -> Dict[str, Any]:
        """Costruisce i dettagli del feedback."""
        details = {
            "user_profile": user.profile_type,
            "user_authority": user.current_authority,
            "objective_metrics": {
                "source_grounding": objective.source_grounding,
                "hallucination_rate": objective.hallucination_rate,
                "citation_accuracy": objective.citation_accuracy,
                "coverage_score": objective.coverage_score,
                "combined_score": objective.combined_score,
            },
            "subjective_metrics": {
                "accuracy": subjective.accuracy,
                "clarity": subjective.clarity,
                "utility": subjective.utility,
                "reasoning": subjective.reasoning_quality,
                "average": subjective.average_score,
            },
            "synthesis_params": {
                "objective_weight": self.objective_weight,
                "subjective_weight": self.subjective_weight,
            },
        }

        if include_reasoning:
            details["reasoning"] = {
                "overall": subjective.overall_assessment,
                "accuracy": subjective.accuracy_reasoning,
                "clarity": subjective.clarity_reasoning,
                "utility": subjective.utility_reasoning,
            }

        return details

    def _compute_quality_score(
        self,
        final_rating: float,
        objective_score: float,
        subjective_score: float,
    ) -> float:
        """
        Calcola il quality score per il sistema RLCF.

        Questo score viene usato per aggiornare il track record
        dell'utente e calcolare l'authority.

        Formula: media ponderata di rating, consistenza obj/subj, e confidence
        """
        # Consistenza: quanto sono allineati obiettivo e soggettivo
        consistency = 1 - abs(objective_score - subjective_score)

        # Quality score
        quality = (
            0.5 * final_rating +
            0.3 * consistency +
            0.2 * min(objective_score, subjective_score)  # Conservativo
        )

        return float(quality)

    def _compute_feedback_accuracy(
        self,
        user_rating: float,
        ground_truth: float,
        objective_score: float,
    ) -> float:
        """
        Calcola l'accuratezza del feedback utente.

        Questa metrica misura quanto il rating dell'utente è vicino
        al "ground truth" (la valutazione oggettiva). Viene usata per
        aggiornare il track_record e l'authority dell'utente.

        Un utente che valuta correttamente (alto o basso in modo appropriato)
        avrà alta feedback_accuracy, indipendentemente dal quality_score.

        Args:
            user_rating: Rating dato dall'utente (dopo bias e noise)
            ground_truth: Rating base prima di bias e noise
            objective_score: Score oggettivo calcolato dal sistema

        Returns:
            Feedback accuracy (0-1), dove 1 = perfettamente accurato

        Esempio:
            - Sistema dà risposta pessima (objective=0.3)
            - Ground truth = 0.35
            - Strict expert valuta 0.25 (correttamente basso)
            - |0.25 - 0.35| = 0.10 → accuracy = 0.90 (alto!)

            - Random noise valuta 0.80 (sbagliando)
            - |0.80 - 0.35| = 0.45 → accuracy = 0.55 (basso)
        """
        # Usiamo sia il ground_truth (rating pre-bias) che objective_score
        # per una stima più robusta del "valore vero"
        true_value = 0.6 * ground_truth + 0.4 * objective_score

        # Calcola distanza dal valore vero
        distance = abs(user_rating - true_value)

        # Converti in accuracy (0-1)
        # Usiamo una funzione che penalizza meno le piccole deviazioni
        # e più le grandi deviazioni
        accuracy = 1.0 - min(distance * 1.5, 1.0)

        return float(max(0.0, accuracy))


def synthesize_batch(
    synthesizer: FeedbackSynthesizer,
    users: List[SyntheticUser],
    objectives: List[ObjectiveMetrics],
    subjectives: List[SubjectiveMetrics],
) -> List[SimulatedFeedback]:
    """
    Sintetizza feedback per un batch di valutazioni.

    Ogni risposta viene valutata da più utenti (se disponibili).

    Args:
        synthesizer: FeedbackSynthesizer configurato
        users: Lista di utenti che forniranno feedback
        objectives: Lista di metriche oggettive
        subjectives: Lista di metriche soggettive

    Returns:
        Lista di SimulatedFeedback
    """
    if len(objectives) != len(subjectives):
        raise ValueError("objectives e subjectives devono avere la stessa lunghezza")

    feedbacks = []

    for obj, subj in zip(objectives, subjectives):
        # Seleziona utenti che forniranno feedback
        active_users = [u for u in users if u.should_provide_feedback()]

        for user in active_users:
            feedback = synthesizer.synthesize(user, obj, subj)
            feedbacks.append(feedback)

    return feedbacks
