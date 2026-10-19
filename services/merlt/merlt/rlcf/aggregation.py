from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from . import models
from scipy.stats import entropy
from .config import model_settings
from .task_handlers import get_handler
from collections import Counter, defaultdict


def calculate_disagreement(weighted_feedback: dict) -> float:
    """
    Quantifica il livello di disaccordo (δ) usando l'entropia di Shannon normalizzata.
    
    Implementa la formula di disagreement quantification definita in RLCF.md Sezione 3.2:
    δ = -(1/log|P|) Σ ρ(p)log ρ(p)
    
    dove P è il set di posizioni possibili e ρ(p) è la probabilità ponderata 
    per autorità di ogni posizione p. La normalizzazione per log|P| garantisce
    che δ ∈ [0,1] indipendentemente dal numero di posizioni.

    Args:
        weighted_feedback: Dictionary mapping positions to authority weights

    Returns:
        float: Normalized disagreement score δ using Shannon entropy
        
    References:
        RLCF.md Section 3.2 - Disagreement Quantification
        RLCF.md Section 3.1 - Uncertainty-Preserving Aggregation Algorithm
    """
    if not weighted_feedback or len(weighted_feedback) <= 1:
        return 0.0

    total_authority_weight = sum(weighted_feedback.values())
    if total_authority_weight == 0:
        return 0.0

    probabilities = [
        weight / total_authority_weight for weight in weighted_feedback.values()
    ]

    num_positions = len(probabilities)
    if num_positions <= 1:
        return 0.0

    return entropy(probabilities, base=num_positions)


def extract_positions_from_feedback(feedbacks):
    """
    Estrae le posizioni distinte dai feedback con i loro sostenitori.
    
    Implementa l'estrazione di posizioni P per il calcolo del disagreement δ
    come definito in RLCF.md Sezione 3.2. Ogni posizione è identificata dalla
    serializzazione ordinata dei dati del feedback per garantire consistenza
    nella quantificazione dell'incertezza.

    Args:
        feedbacks: List of feedback objects

    Returns:
        dict: Dictionary mapping position keys to list of supporters with
              authority scores for weighted probability calculation
              
    References:
        RLCF.md Section 3.2 - Disagreement Quantification
    """
    position_supporters = defaultdict(list)

    for fb in feedbacks:
        position_key = str(sorted(fb.feedback_data.items()))
        position_supporters[position_key].append(
            {
                "user_id": fb.user_id,
                "username": fb.author.username,
                "authority": fb.author.authority_score,
                "reasoning": fb.feedback_data.get("reasoning", ""),
            }
        )

    return position_supporters


def identify_consensus_and_contention(feedbacks):
    """
    Identifica aree di consenso e punti di contesa.

    Args:
        feedbacks: List of feedback objects

    Returns:
        tuple: (consensus_areas, contention_points)
    """
    all_keys = set()
    key_values = defaultdict(Counter)

    for fb in feedbacks:
        for key, value in fb.feedback_data.items():
            all_keys.add(key)
            key_values[key][str(value)] += fb.author.authority_score

    consensus_areas = []
    contention_points = []

    for key in all_keys:
        values = key_values[key]
        if len(values) == 1:
            consensus_areas.append(f"{key}: {list(values.keys())[0]}")
        else:
            total = sum(values.values())
            probs = [v / total for v in values.values()]
            disagreement = entropy(probs)
            if disagreement > 0.5:
                contention_points.append(
                    {
                        "aspect": key,
                        "positions": dict(values),
                        "disagreement_level": disagreement,
                    }
                )

    return consensus_areas, contention_points


def extract_reasoning_patterns(feedbacks):
    """
    Estrae pattern di ragionamento dai feedback.

    Args:
        feedbacks: List of feedback objects

    Returns:
        dict: Dictionary mapping reasoning pattern types to user IDs
    """
    patterns = defaultdict(list)

    for fb in feedbacks:
        if "reasoning" in fb.feedback_data:
            reasoning = fb.feedback_data["reasoning"].lower()
            if "precedent" in reasoning or "case law" in reasoning:
                patterns["precedent-based"].append(fb.user_id)
            elif "principle" in reasoning or "fundamental" in reasoning:
                patterns["principle-based"].append(fb.user_id)
            elif "practical" in reasoning or "consequence" in reasoning:
                patterns["pragmatic"].append(fb.user_id)
            else:
                patterns["other"].append(fb.user_id)

    return dict(patterns)


async def aggregate_with_uncertainty(db: AsyncSession, task_id: int) -> dict:
    """
    Implementazione completa dell'Algorithm 1: RLCF Aggregation with Uncertainty Preservation.
    
    Implementa l'algoritmo centrale definito in RLCF.md Sezione 3.1 che:
    1. Calcola pesi di autorità per ogni feedback usando A_u(t)
    2. Quantifica il disagreement δ tramite entropia di Shannon normalizzata
    3. Se δ > τ (soglia=0.4), produce output uncertainty-preserving completo
    4. Altrimenti, restituisce output di consenso semplificato
    
    Il threshold τ=0.4 è ottimizzato empiricamente per bilanciare preservazione
    dell'incertezza con usabilità pratica del sistema.

    Args:
        db: AsyncSession for database operations
        task_id: ID of the task to aggregate feedback for

    Returns:
        dict: Aggregated result with uncertainty information following the
              uncertainty-preserving output structure from RLCF.md Section 3.3
              
    References:
        RLCF.md Section 3.1 - Algorithm 1: RLCF Aggregation with Uncertainty Preservation
        RLCF.md Section 3.2 - Disagreement Quantification
        RLCF.md Section 3.3 - Uncertainty-Preserving Output Structure
    """
    result = await db.execute(
        select(models.LegalTask).filter(models.LegalTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        return {"error": "Task not found.", "type": "Error"}

    # Get all feedback for this task
    feedback_result = await db.execute(
        select(models.Feedback)
        .join(models.Response)
        .filter(models.Response.task_id == task_id)
    )
    feedbacks = feedback_result.scalars().all()

    if not feedbacks:
        return {"error": "No feedback found for this task.", "type": "NoFeedback"}

    # Calculate weighted positions
    handler = await get_handler(db, task)
    aggregated_data = await handler.aggregate_feedback()

    if "error" in aggregated_data:
        return aggregated_data

    # Extract positions and calculate disagreement
    position_supporters = extract_positions_from_feedback(feedbacks)

    # Calculate disagreement score
    weighted_positions = {}
    for pos, supporters in position_supporters.items():
        total_authority = sum(s["authority"] for s in supporters)
        weighted_positions[pos] = total_authority

    disagreement_score = calculate_disagreement(weighted_positions)

    # Identify consensus and contention
    consensus_areas, contention_points = identify_consensus_and_contention(feedbacks)

    # Extract reasoning patterns
    reasoning_patterns = extract_reasoning_patterns(feedbacks)

    # Build uncertainty-aware output
    if disagreement_score > model_settings.thresholds["disagreement"]:
        # High disagreement - produce full uncertainty-preserving output

        # Find majority and minority positions
        sorted_positions = sorted(
            weighted_positions.items(), key=lambda x: x[1], reverse=True
        )

        alternative_positions = []
        for pos, weight in sorted_positions[1:]:
            supporters = position_supporters[pos]
            alternative_positions.append(
                {
                    "position": pos,
                    "support": f"{(weight / sum(weighted_positions.values()) * 100):.1f}%",
                    "supporters": [s["username"] for s in supporters[:3]],
                    "reasoning": supporters[0]["reasoning"] if supporters else "",
                }
            )

        # Generate research suggestions based on contention points
        research_suggestions = []
        for point in contention_points[:3]:
            research_suggestions.append(
                f"Further investigate {point['aspect']} - "
                f"disagreement level: {point['disagreement_level']:.2f}"
            )

        return {
            "primary_answer": aggregated_data.get("consensus_answer"),
            "confidence_level": round(1 - disagreement_score, 2),
            "alternative_positions": alternative_positions,
            "expert_disagreement": {
                "consensus_areas": consensus_areas,
                "contention_points": contention_points,
                "reasoning_patterns": reasoning_patterns,
            },
            "epistemic_metadata": {
                "uncertainty_sources": [
                    "expert_disagreement",
                    "multiple_valid_interpretations",
                ],
                "suggested_research": research_suggestions,
            },
            "transparency_metrics": {
                "evaluator_count": len(feedbacks),
                "total_authority_weight": sum(weighted_positions.values()),
                "disagreement_score": round(disagreement_score, 3),
            },
        }
    else:
        # Low disagreement - return consensus output
        return {
            "consensus_answer": aggregated_data.get("consensus_answer"),
            "confidence_level": round(1 - disagreement_score, 2),
            "transparency_metrics": {
                "evaluator_count": len(feedbacks),
                "consensus_strength": "high",
                "disagreement_score": round(disagreement_score, 3),
            },
        }
