"""
6-Dimensional Bias Detection Framework
========================================

Sistema per rilevamento e quantificazione del bias nel feedback RLCF.

Formula totale (RLCF.md Section 4.3):
    B_total = √(Σ b_i²)

Dove le 6 dimensioni sono:
- b1: Demographic correlation - correlazione tra caratteristiche demografiche e posizioni
- b2: Professional clustering - deviazione dal consenso del gruppo professionale
- b3: Temporal drift - cambio di opinione nel tempo
- b4: Geographic concentration - clustering geografico nelle posizioni
- b5: Confirmation bias - tendenza a ripetere posizioni precedenti
- b6: Anchoring bias - influenza delle prime risposte sulle successive

Livelli di bias:
- Low: B_total ≤ 0.5
- Medium: 0.5 < B_total ≤ 1.0
- High: B_total > 1.0

Esempio:
    >>> from merlt.rlcf.bias_detection import BiasDetector
    >>>
    >>> detector = BiasDetector()
    >>> report = await detector.calculate_total_bias(
    ...     task_id="task_001",
    ...     feedbacks=feedbacks
    ... )
    >>> print(f"Total bias: {report.total_bias_score}")
    >>> print(f"Level: {report.bias_level}")

Note:
    Riferimento: RLCF.md Section 4.3 - Extended Bias Detection Framework
"""

import math
import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple, Set
from datetime import datetime, timedelta
from collections import Counter, defaultdict
from enum import Enum

log = structlog.get_logger()


# =============================================================================
# ENUMS
# =============================================================================

class BiasLevel(str, Enum):
    """Livelli di bias."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class BiasDimension(str, Enum):
    """Le 6 dimensioni di bias."""
    DEMOGRAPHIC = "demographic"
    PROFESSIONAL = "professional"
    TEMPORAL = "temporal"
    GEOGRAPHIC = "geographic"
    CONFIRMATION = "confirmation"
    ANCHORING = "anchoring"


# =============================================================================
# DATACLASSES
# =============================================================================

@dataclass
class UserProfile:
    """
    Profilo utente per bias detection.

    Attributes:
        user_id: ID utente
        profession: Professione (avvocato, magistrato, etc.)
        specializations: Specializzazioni
        region: Regione geografica
        age_group: Fascia età (per demographic)
        gender: Genere (per demographic)
        experience_years: Anni di esperienza
    """
    user_id: str
    profession: str = ""
    specializations: List[str] = field(default_factory=list)
    region: str = ""
    age_group: str = ""  # "18-30", "31-45", "46-60", "60+"
    gender: str = ""  # "M", "F", "other", "not_specified"
    experience_years: int = 0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class FeedbackForBias:
    """
    Feedback strutturato per analisi bias.

    Attributes:
        feedback_id: ID feedback
        user_id: ID utente
        task_id: ID task
        position: Posizione/valutazione espressa
        timestamp: Timestamp del feedback
        user_profile: Profilo utente
    """
    feedback_id: str
    user_id: str
    task_id: str
    position: str
    timestamp: datetime
    user_profile: Optional[UserProfile] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "FeedbackForBias":
        """Crea da dizionario."""
        profile = None
        if data.get("user_profile"):
            profile = UserProfile(**data["user_profile"])

        timestamp = data.get("timestamp")
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp)

        return cls(
            feedback_id=data["feedback_id"],
            user_id=data["user_id"],
            task_id=data["task_id"],
            position=data["position"],
            timestamp=timestamp,
            user_profile=profile,
            metadata=data.get("metadata", {})
        )


@dataclass
class BiasReport:
    """
    Report completo di analisi bias.

    Attributes:
        task_id: ID del task analizzato
        bias_scores: Score per ogni dimensione {dimension: score}
        total_bias_score: B_total = √(Σ b_i²)
        bias_level: Livello di bias (low/medium/high)
        mitigation_recommendations: Raccomandazioni per mitigare
        details: Dettagli per ogni dimensione
        generated_at: Timestamp generazione
    """
    task_id: str
    bias_scores: Dict[str, float]
    total_bias_score: float
    bias_level: BiasLevel
    mitigation_recommendations: List[str] = field(default_factory=list)
    details: Dict[str, Any] = field(default_factory=dict)
    generated_at: str = field(default_factory=lambda: datetime.now().isoformat())
    num_feedbacks_analyzed: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "task_id": self.task_id,
            "bias_scores": {k: round(v, 4) for k, v in self.bias_scores.items()},
            "total_bias_score": round(self.total_bias_score, 4),
            "bias_level": self.bias_level.value,
            "mitigation_recommendations": self.mitigation_recommendations,
            "details": self.details,
            "generated_at": self.generated_at,
            "num_feedbacks_analyzed": self.num_feedbacks_analyzed
        }


# =============================================================================
# BIAS CALCULATOR FUNCTIONS
# =============================================================================

def calculate_demographic_bias(
    feedbacks: List[FeedbackForBias],
    attribute: str = "profession"
) -> Tuple[float, Dict[str, Any]]:
    """
    Calcola b1: Demographic correlation bias.

    Misura la correlazione tra caratteristiche demografiche e posizioni.
    Alto bias se certi gruppi demografici votano sempre nello stesso modo.

    Formula:
        b1 = 1 - (unique_positions_per_group / total_unique_positions)

    Args:
        feedbacks: Lista di feedback con profili utente
        attribute: Attributo demografico da analizzare

    Returns:
        Tuple (bias_score, details)
    """
    if not feedbacks:
        return 0.0, {"message": "No feedbacks to analyze"}

    # Raggruppa per attributo demografico
    groups: Dict[str, Set[str]] = defaultdict(set)

    for fb in feedbacks:
        if fb.user_profile:
            attr_value = getattr(fb.user_profile, attribute, "unknown")
            groups[attr_value].add(fb.position)
        else:
            groups["unknown"].add(fb.position)

    # Tutte le posizioni uniche
    all_positions = set()
    for fb in feedbacks:
        all_positions.add(fb.position)

    if len(all_positions) <= 1:
        return 0.0, {"message": "Only one position, no demographic variation possible"}

    # Calcola diversità per gruppo
    # Se ogni gruppo ha poche posizioni rispetto al totale, c'è bias
    group_diversities = []
    for group, positions in groups.items():
        diversity = len(positions) / len(all_positions)
        group_diversities.append(diversity)

    # Media delle diversità (1 = nessun bias, 0 = massimo bias)
    avg_diversity = sum(group_diversities) / len(group_diversities) if group_diversities else 1.0

    # Inverti: bias = 1 - diversity
    bias_score = 1.0 - avg_diversity

    details = {
        "attribute": attribute,
        "num_groups": len(groups),
        "total_positions": len(all_positions),
        "group_positions": {k: list(v) for k, v in groups.items()},
        "avg_diversity": round(avg_diversity, 4)
    }

    return min(1.0, bias_score), details


def calculate_professional_clustering_bias(
    feedbacks: List[FeedbackForBias]
) -> Tuple[float, Dict[str, Any]]:
    """
    Calcola b2: Professional clustering bias.

    Misura quanto i professionisti dello stesso tipo tendono
    a dare valutazioni simili (deviazione dal consenso professionale).

    Formula:
        b2 = std_dev(position_counts_per_profession) / max_std_dev

    Args:
        feedbacks: Lista di feedback con profili utente

    Returns:
        Tuple (bias_score, details)
    """
    if not feedbacks:
        return 0.0, {"message": "No feedbacks to analyze"}

    # Raggruppa per professione -> posizioni
    profession_positions: Dict[str, Counter] = defaultdict(Counter)

    for fb in feedbacks:
        profession = "unknown"
        if fb.user_profile and fb.user_profile.profession:
            profession = fb.user_profile.profession
        profession_positions[profession][fb.position] += 1

    if len(profession_positions) <= 1:
        return 0.0, {"message": "Single profession, clustering not measurable"}

    # Per ogni professione, calcola quanto è concentrata su poche posizioni
    concentration_scores = []

    for profession, position_counts in profession_positions.items():
        total = sum(position_counts.values())
        if total == 0:
            continue

        # Calcola concentrazione (1 se tutti stessa posizione, 0 se uniforme)
        max_count = max(position_counts.values())
        concentration = max_count / total
        concentration_scores.append(concentration)

    if not concentration_scores:
        return 0.0, {"message": "No valid profession data"}

    # Bias = media delle concentrazioni (normalizzato)
    # Se tutti i professionisti sono concentrati su poche posizioni, alto bias
    avg_concentration = sum(concentration_scores) / len(concentration_scores)

    # Calcola quanto le professioni divergono tra loro
    # Se ogni professione ha posizioni diverse, c'è clustering
    all_positions = set()
    for counts in profession_positions.values():
        all_positions.update(counts.keys())

    # Overlap tra professioni
    if len(all_positions) > 1:
        profession_dominant = {}
        for prof, counts in profession_positions.items():
            if counts:
                profession_dominant[prof] = counts.most_common(1)[0][0]

        # Se professioni diverse hanno dominanti diverse, c'è clustering
        unique_dominants = len(set(profession_dominant.values()))
        clustering_factor = unique_dominants / len(profession_dominant) if profession_dominant else 0
    else:
        clustering_factor = 0

    # Combina concentrazione e clustering
    bias_score = 0.5 * avg_concentration + 0.5 * clustering_factor

    details = {
        "num_professions": len(profession_positions),
        "profession_distributions": {k: dict(v) for k, v in profession_positions.items()},
        "avg_concentration": round(avg_concentration, 4),
        "clustering_factor": round(clustering_factor, 4)
    }

    return min(1.0, bias_score), details


def calculate_temporal_bias(
    feedbacks: List[FeedbackForBias],
    time_window_hours: int = 24
) -> Tuple[float, Dict[str, Any]]:
    """
    Calcola b3: Temporal drift bias.

    Misura quanto le opinioni cambiano nel tempo durante la valutazione.
    Alto bias se le prime risposte sono sistematicamente diverse dalle ultime.

    Args:
        feedbacks: Lista di feedback con timestamp
        time_window_hours: Finestra temporale per dividere in periodi

    Returns:
        Tuple (bias_score, details)
    """
    if len(feedbacks) < 4:
        return 0.0, {"message": "Not enough feedbacks for temporal analysis"}

    # Ordina per timestamp
    sorted_feedbacks = sorted(feedbacks, key=lambda f: f.timestamp)

    # Dividi in prima metà e seconda metà
    mid = len(sorted_feedbacks) // 2
    first_half = sorted_feedbacks[:mid]
    second_half = sorted_feedbacks[mid:]

    # Conta posizioni per metà
    first_positions = Counter(f.position for f in first_half)
    second_positions = Counter(f.position for f in second_half)

    # Calcola distribuzione normalizzata
    first_total = sum(first_positions.values())
    second_total = sum(second_positions.values())

    if first_total == 0 or second_total == 0:
        return 0.0, {"message": "Empty time periods"}

    first_dist = {k: v/first_total for k, v in first_positions.items()}
    second_dist = {k: v/second_total for k, v in second_positions.items()}

    # Calcola divergenza (somma differenze assolute / 2)
    all_positions = set(first_dist.keys()) | set(second_dist.keys())
    divergence = 0.0
    for pos in all_positions:
        p1 = first_dist.get(pos, 0)
        p2 = second_dist.get(pos, 0)
        divergence += abs(p1 - p2)
    divergence /= 2  # Normalizza a [0, 1]

    # Calcola anche drift per posizione dominante
    first_dominant = first_positions.most_common(1)[0][0] if first_positions else None
    second_dominant = second_positions.most_common(1)[0][0] if second_positions else None
    dominant_changed = first_dominant != second_dominant

    details = {
        "first_half_distribution": first_dist,
        "second_half_distribution": second_dist,
        "distribution_divergence": round(divergence, 4),
        "dominant_position_changed": dominant_changed,
        "first_dominant": first_dominant,
        "second_dominant": second_dominant
    }

    # Bias score
    bias_score = divergence
    if dominant_changed:
        bias_score = min(1.0, bias_score + 0.2)  # Penalty se cambia dominante

    return min(1.0, bias_score), details


def calculate_geographic_bias(
    feedbacks: List[FeedbackForBias]
) -> Tuple[float, Dict[str, Any]]:
    """
    Calcola b4: Geographic concentration bias.

    Misura il clustering geografico nelle posizioni.
    Alto bias se certe regioni votano sistematicamente in modo diverso.

    Args:
        feedbacks: Lista di feedback con profili utente (region)

    Returns:
        Tuple (bias_score, details)
    """
    if not feedbacks:
        return 0.0, {"message": "No feedbacks to analyze"}

    # Raggruppa per regione -> posizioni
    region_positions: Dict[str, Counter] = defaultdict(Counter)

    for fb in feedbacks:
        region = "unknown"
        if fb.user_profile and fb.user_profile.region:
            region = fb.user_profile.region
        region_positions[region][fb.position] += 1

    if len(region_positions) <= 1:
        return 0.0, {"message": "Single region, geographic bias not measurable"}

    # Simile a professional clustering
    # Calcola concentrazione per regione
    concentration_scores = []
    for region, position_counts in region_positions.items():
        total = sum(position_counts.values())
        if total > 0:
            max_count = max(position_counts.values())
            concentration = max_count / total
            concentration_scores.append(concentration)

    if not concentration_scores:
        return 0.0, {"message": "No valid region data"}

    avg_concentration = sum(concentration_scores) / len(concentration_scores)

    # Calcola divergenza tra regioni
    all_positions = set()
    for counts in region_positions.values():
        all_positions.update(counts.keys())

    region_dominants = {}
    for region, counts in region_positions.items():
        if counts:
            region_dominants[region] = counts.most_common(1)[0][0]

    unique_dominants = len(set(region_dominants.values()))
    clustering_factor = unique_dominants / len(region_dominants) if region_dominants else 0

    bias_score = 0.5 * avg_concentration + 0.5 * clustering_factor

    details = {
        "num_regions": len(region_positions),
        "region_distributions": {k: dict(v) for k, v in region_positions.items()},
        "avg_concentration": round(avg_concentration, 4),
        "clustering_factor": round(clustering_factor, 4)
    }

    return min(1.0, bias_score), details


def calculate_confirmation_bias(
    feedbacks: List[FeedbackForBias],
    user_history: Dict[str, List[str]] = None
) -> Tuple[float, Dict[str, Any]]:
    """
    Calcola b5: Confirmation bias.

    Misura la tendenza degli utenti a ripetere posizioni precedenti.

    Formula RLCF.md:
        b5 = (1/|U|) Σ (|similar_positions_u| / |previous_positions_u|)

    Args:
        feedbacks: Lista di feedback correnti
        user_history: Dict {user_id: [previous_positions]} per storico

    Returns:
        Tuple (bias_score, details)
    """
    if not feedbacks:
        return 0.0, {"message": "No feedbacks to analyze"}

    if not user_history:
        # Senza storico, non possiamo calcolare confirmation bias
        return 0.0, {"message": "No user history available"}

    user_confirmation_scores = []

    for fb in feedbacks:
        user_id = fb.user_id
        if user_id not in user_history:
            continue

        prev_positions = user_history[user_id]
        if not prev_positions:
            continue

        # Conta quante posizioni precedenti sono simili alla corrente
        current_position = fb.position
        similar_count = sum(1 for p in prev_positions if p == current_position)

        # Ratio
        confirmation_ratio = similar_count / len(prev_positions)
        user_confirmation_scores.append(confirmation_ratio)

    if not user_confirmation_scores:
        return 0.0, {"message": "No users with history found"}

    # Media dei ratio di conferma
    avg_confirmation = sum(user_confirmation_scores) / len(user_confirmation_scores)

    details = {
        "users_with_history": len(user_confirmation_scores),
        "avg_confirmation_ratio": round(avg_confirmation, 4),
        "high_confirmation_users": sum(1 for s in user_confirmation_scores if s > 0.7)
    }

    return min(1.0, avg_confirmation), details


def calculate_anchoring_bias(
    feedbacks: List[FeedbackForBias],
    anchor_window: int = 3
) -> Tuple[float, Dict[str, Any]]:
    """
    Calcola b6: Anchoring bias.

    Misura l'influenza delle prime risposte sulle successive.

    Formula RLCF.md:
        b6 = |anchor_followers| / |subsequent_responses|

    Dove l'anchor è la posizione dominante nelle prime `anchor_window` risposte.

    Args:
        feedbacks: Lista di feedback ordinati per timestamp
        anchor_window: Numero di risposte iniziali che definiscono l'anchor

    Returns:
        Tuple (bias_score, details)
    """
    if len(feedbacks) <= anchor_window:
        return 0.0, {"message": f"Need more than {anchor_window} feedbacks"}

    # Ordina per timestamp
    sorted_feedbacks = sorted(feedbacks, key=lambda f: f.timestamp)

    # Prime N risposte = anchor
    anchor_feedbacks = sorted_feedbacks[:anchor_window]
    subsequent_feedbacks = sorted_feedbacks[anchor_window:]

    # Trova posizione dominante nell'anchor
    anchor_positions = Counter(f.position for f in anchor_feedbacks)
    anchor_dominant = anchor_positions.most_common(1)[0][0]

    # Conta quanti successivi seguono l'anchor
    anchor_followers = sum(
        1 for f in subsequent_feedbacks
        if f.position == anchor_dominant
    )

    total_subsequent = len(subsequent_feedbacks)

    # Bias = proporzione di follower
    if total_subsequent == 0:
        return 0.0, {"message": "No subsequent feedbacks"}

    bias_score = anchor_followers / total_subsequent

    details = {
        "anchor_window": anchor_window,
        "anchor_dominant_position": anchor_dominant,
        "anchor_position_counts": dict(anchor_positions),
        "subsequent_count": total_subsequent,
        "anchor_followers": anchor_followers,
        "follower_ratio": round(bias_score, 4)
    }

    return min(1.0, bias_score), details


def classify_bias_level(total_bias: float) -> BiasLevel:
    """
    Classifica il livello di bias totale.

    Soglie da RLCF.md:
    - Low: B_total ≤ 0.5
    - Medium: 0.5 < B_total ≤ 1.0
    - High: B_total > 1.0

    Args:
        total_bias: B_total calcolato

    Returns:
        BiasLevel enum
    """
    if total_bias <= 0.5:
        return BiasLevel.LOW
    elif total_bias <= 1.0:
        return BiasLevel.MEDIUM
    else:
        return BiasLevel.HIGH


def generate_mitigation_recommendations(
    bias_scores: Dict[str, float],
    threshold: float = 0.5
) -> List[str]:
    """
    Genera raccomandazioni per mitigare i bias rilevati.

    Args:
        bias_scores: Score per ogni dimensione
        threshold: Soglia per raccomandare mitigazione

    Returns:
        Lista di raccomandazioni
    """
    recommendations = []

    if bias_scores.get(BiasDimension.DEMOGRAPHIC.value, 0) > threshold:
        recommendations.append(
            "Bias demografico elevato: considerare stratificazione del campione "
            "per garantire diversità nelle caratteristiche degli evaluator."
        )

    if bias_scores.get(BiasDimension.PROFESSIONAL.value, 0) > threshold:
        recommendations.append(
            "Clustering professionale rilevato: includere evaluator da diverse "
            "specializzazioni e background professionali."
        )

    if bias_scores.get(BiasDimension.TEMPORAL.value, 0) > threshold:
        recommendations.append(
            "Drift temporale significativo: verificare se ci sono state "
            "informazioni esterne che hanno influenzato le valutazioni successive."
        )

    if bias_scores.get(BiasDimension.GEOGRAPHIC.value, 0) > threshold:
        recommendations.append(
            "Concentrazione geografica: assicurare rappresentanza da diverse "
            "regioni e considerare differenze giurisprudenziali locali."
        )

    if bias_scores.get(BiasDimension.CONFIRMATION.value, 0) > threshold:
        recommendations.append(
            "Confirmation bias elevato: implementare blind evaluation più rigorosa "
            "e variare l'ordine di presentazione delle opzioni."
        )

    if bias_scores.get(BiasDimension.ANCHORING.value, 0) > threshold:
        recommendations.append(
            "Anchoring bias rilevato: randomizzare l'ordine di raccolta feedback "
            "e non mostrare valutazioni precedenti durante l'evaluation."
        )

    if not recommendations:
        recommendations.append(
            "Nessun bias significativo rilevato. Il processo di valutazione "
            "appare equilibrato."
        )

    return recommendations


# =============================================================================
# BIAS DETECTOR CLASS
# =============================================================================

class BiasDetector:
    """
    Detector completo per analisi bias 6-dimensionale.

    Implementa B_total = √(Σ b_i²) con tutte le 6 dimensioni di bias
    definite in RLCF.md Section 4.3.

    Attributes:
        threshold: Soglia per raccomandazioni mitigazione
        anchor_window: Finestra per calcolo anchoring bias
        time_window_hours: Finestra per temporal bias
    """

    def __init__(
        self,
        threshold: float = 0.5,
        anchor_window: int = 3,
        time_window_hours: int = 24
    ):
        """
        Inizializza BiasDetector.

        Args:
            threshold: Soglia per mitigazione (default 0.5)
            anchor_window: Finestra anchoring (default 3)
            time_window_hours: Finestra temporal (default 24h)
        """
        self.threshold = threshold
        self.anchor_window = anchor_window
        self.time_window_hours = time_window_hours

        log.info(
            "BiasDetector initialized",
            threshold=threshold,
            anchor_window=anchor_window,
            time_window_hours=time_window_hours
        )

    async def calculate_total_bias(
        self,
        task_id: str,
        feedbacks: List[FeedbackForBias],
        user_history: Dict[str, List[str]] = None
    ) -> BiasReport:
        """
        Calcola bias totale su tutte le 6 dimensioni.

        Formula: B_total = √(Σ b_i²)

        Args:
            task_id: ID del task
            feedbacks: Lista di feedback da analizzare
            user_history: Storico posizioni utenti (per confirmation bias)

        Returns:
            BiasReport completo
        """
        if not feedbacks:
            return BiasReport(
                task_id=task_id,
                bias_scores={},
                total_bias_score=0.0,
                bias_level=BiasLevel.LOW,
                mitigation_recommendations=["Nessun feedback da analizzare."],
                num_feedbacks_analyzed=0
            )

        # Calcola ogni dimensione
        b1, d1 = calculate_demographic_bias(feedbacks)
        b2, d2 = calculate_professional_clustering_bias(feedbacks)
        b3, d3 = calculate_temporal_bias(feedbacks, self.time_window_hours)
        b4, d4 = calculate_geographic_bias(feedbacks)
        b5, d5 = calculate_confirmation_bias(feedbacks, user_history or {})
        b6, d6 = calculate_anchoring_bias(feedbacks, self.anchor_window)

        bias_scores = {
            BiasDimension.DEMOGRAPHIC.value: b1,
            BiasDimension.PROFESSIONAL.value: b2,
            BiasDimension.TEMPORAL.value: b3,
            BiasDimension.GEOGRAPHIC.value: b4,
            BiasDimension.CONFIRMATION.value: b5,
            BiasDimension.ANCHORING.value: b6,
        }

        # B_total = √(Σ b_i²)
        sum_squared = sum(b**2 for b in bias_scores.values())
        total_bias = math.sqrt(sum_squared)

        # Classifica livello
        bias_level = classify_bias_level(total_bias)

        # Genera raccomandazioni
        recommendations = generate_mitigation_recommendations(
            bias_scores,
            self.threshold
        )

        # Compila details
        details = {
            BiasDimension.DEMOGRAPHIC.value: d1,
            BiasDimension.PROFESSIONAL.value: d2,
            BiasDimension.TEMPORAL.value: d3,
            BiasDimension.GEOGRAPHIC.value: d4,
            BiasDimension.CONFIRMATION.value: d5,
            BiasDimension.ANCHORING.value: d6,
        }

        report = BiasReport(
            task_id=task_id,
            bias_scores=bias_scores,
            total_bias_score=total_bias,
            bias_level=bias_level,
            mitigation_recommendations=recommendations,
            details=details,
            num_feedbacks_analyzed=len(feedbacks)
        )

        log.info(
            "Bias analysis completed",
            task_id=task_id,
            total_bias=round(total_bias, 4),
            bias_level=bias_level.value,
            num_feedbacks=len(feedbacks)
        )

        return report

    def calculate_single_dimension(
        self,
        dimension: BiasDimension,
        feedbacks: List[FeedbackForBias],
        user_history: Dict[str, List[str]] = None
    ) -> Tuple[float, Dict[str, Any]]:
        """
        Calcola una singola dimensione di bias.

        Args:
            dimension: Dimensione da calcolare
            feedbacks: Lista di feedback
            user_history: Storico utenti (per confirmation)

        Returns:
            Tuple (score, details)
        """
        if dimension == BiasDimension.DEMOGRAPHIC:
            return calculate_demographic_bias(feedbacks)
        elif dimension == BiasDimension.PROFESSIONAL:
            return calculate_professional_clustering_bias(feedbacks)
        elif dimension == BiasDimension.TEMPORAL:
            return calculate_temporal_bias(feedbacks, self.time_window_hours)
        elif dimension == BiasDimension.GEOGRAPHIC:
            return calculate_geographic_bias(feedbacks)
        elif dimension == BiasDimension.CONFIRMATION:
            return calculate_confirmation_bias(feedbacks, user_history or {})
        elif dimension == BiasDimension.ANCHORING:
            return calculate_anchoring_bias(feedbacks, self.anchor_window)
        else:
            raise ValueError(f"Unknown dimension: {dimension}")


# =============================================================================
# FACTORY FUNCTIONS
# =============================================================================

def create_bias_detector(
    threshold: float = 0.5,
    anchor_window: int = 3,
    time_window_hours: int = 24
) -> BiasDetector:
    """
    Factory per creare BiasDetector.

    Args:
        threshold: Soglia mitigazione
        anchor_window: Finestra anchoring
        time_window_hours: Finestra temporal

    Returns:
        BiasDetector configurato
    """
    return BiasDetector(
        threshold=threshold,
        anchor_window=anchor_window,
        time_window_hours=time_window_hours
    )


def calculate_bias_summary(
    feedbacks: List[FeedbackForBias],
    user_history: Dict[str, List[str]] = None
) -> Dict[str, float]:
    """
    Calcola un sommario veloce dei bias senza report completo.

    Args:
        feedbacks: Lista di feedback
        user_history: Storico utenti

    Returns:
        Dict con score per dimensione e totale
    """
    b1, _ = calculate_demographic_bias(feedbacks)
    b2, _ = calculate_professional_clustering_bias(feedbacks)
    b3, _ = calculate_temporal_bias(feedbacks)
    b4, _ = calculate_geographic_bias(feedbacks)
    b5, _ = calculate_confirmation_bias(feedbacks, user_history or {})
    b6, _ = calculate_anchoring_bias(feedbacks)

    sum_squared = b1**2 + b2**2 + b3**2 + b4**2 + b5**2 + b6**2
    total = math.sqrt(sum_squared)

    return {
        "demographic": b1,
        "professional": b2,
        "temporal": b3,
        "geographic": b4,
        "confirmation": b5,
        "anchoring": b6,
        "total": total,
        "level": classify_bias_level(total).value
    }
