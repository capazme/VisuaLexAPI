"""
Devil's Advocate System
========================

Sistema per l'assegnazione e gestione di devil's advocates nel framework RLCF.

Il Devil's Advocate contrasta il groupthink garantendo valutazione critica
delle risposte AI nel dominio giuridico.

Formula di assegnazione (RLCF.md Section 3.5):
    P(advocate) = min(0.1, 3/|E|)

Dove:
- P(advocate) ∈ [0, 0.1]: Probabilità di assegnazione
- |E|: Numero totale di evaluator eligibili
- 3: Minimo numero di advocate per valutazione critica efficace
- 0.1: Proporzione massima per non sovraccaricare il sistema

Metriche di Effectiveness:
- Diversity: Posizioni nuove introdotte dagli advocate
- Engagement: Qualità del pensiero critico (lunghezza + elementi critici)

Esempio:
    >>> from merlt.rlcf.devils_advocate import DevilsAdvocateAssigner
    >>>
    >>> assigner = DevilsAdvocateAssigner()
    >>> advocates = await assigner.assign_advocates_for_task(
    ...     task_id="task_001",
    ...     eligible_users=users,
    ...     task_type="QA"
    ... )
    >>> print(f"Assigned {len(advocates)} advocates")
    >>>
    >>> # Generate critical prompt
    >>> prompt = assigner.generate_critical_prompt(task_type="QA")
    >>>
    >>> # Analyze effectiveness
    >>> metrics = assigner.analyze_advocate_effectiveness(
    ...     advocate_feedbacks, regular_feedbacks
    ... )

Note:
    Riferimento: RLCF.md Section 3.5 - Devil's Advocate System
"""

import random
import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple, Set
from datetime import datetime
from enum import Enum

log = structlog.get_logger()


# =============================================================================
# CONSTANTS
# =============================================================================

# Critical keywords per rilevare pensiero critico (italiano + inglese)
CRITICAL_KEYWORDS_EN = [
    "however", "although", "but", "weakness", "problem", "issue",
    "alternative", "concern", "risk", "limitation", "exception",
    "nevertheless", "despite", "contrary", "challenge", "flaw",
    "counterargument", "objection", "critique", "disagree"
]

CRITICAL_KEYWORDS_IT = [
    "tuttavia", "sebbene", "però", "debolezza", "problema", "questione",
    "alternativa", "preoccupazione", "rischio", "limite", "eccezione",
    "nonostante", "malgrado", "contrario", "sfida", "difetto",
    "contrargomentazione", "obiezione", "critica", "dissenso",
    "discutibile", "controverso", "dubbio", "incerto", "problematico"
]

CRITICAL_KEYWORDS = set(CRITICAL_KEYWORDS_EN + CRITICAL_KEYWORDS_IT)


# =============================================================================
# ENUMS
# =============================================================================

class TaskType(str, Enum):
    """Tipi di task giuridici supportati."""
    QA = "QA"
    CLASSIFICATION = "CLASSIFICATION"
    PREDICTION = "PREDICTION"
    DRAFTING = "DRAFTING"
    SUMMARIZATION = "SUMMARIZATION"
    NLI = "NLI"
    RETRIEVAL = "RETRIEVAL"
    DOCTRINE = "DOCTRINE"


# =============================================================================
# DATACLASSES
# =============================================================================

@dataclass
class DevilsAdvocateAssignment:
    """
    Assegnazione di un devil's advocate a un task.

    Attributes:
        assignment_id: ID univoco dell'assegnazione
        task_id: ID del task
        user_id: ID dell'utente assegnato come advocate
        assigned_at: Timestamp assegnazione
        critical_prompt: Prompt critico generato per il task
        instructions: Istruzioni specifiche per l'advocate
        completed: Se l'advocate ha completato la valutazione
        effectiveness_score: Score effectiveness (post-valutazione)
    """
    assignment_id: str
    task_id: str
    user_id: str
    assigned_at: str = field(default_factory=lambda: datetime.now().isoformat())
    critical_prompt: str = ""
    instructions: str = ""
    completed: bool = False
    effectiveness_score: Optional[float] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "assignment_id": self.assignment_id,
            "task_id": self.task_id,
            "user_id": self.user_id,
            "assigned_at": self.assigned_at,
            "critical_prompt": self.critical_prompt,
            "instructions": self.instructions,
            "completed": self.completed,
            "effectiveness_score": self.effectiveness_score,
            "metadata": self.metadata
        }


@dataclass
class AdvocateFeedback:
    """
    Feedback fornito da un devil's advocate.

    Attributes:
        user_id: ID dell'advocate
        task_id: ID del task
        position: Posizione/valutazione (es. "incorrect", "needs_revision")
        reasoning: Ragionamento critico dettagliato
        critical_points: Lista di punti critici specifici
        suggested_alternatives: Alternative proposte
        confidence: Confidenza nella critica [0-1]
    """
    user_id: str
    task_id: str
    position: str
    reasoning: str
    critical_points: List[str] = field(default_factory=list)
    suggested_alternatives: List[str] = field(default_factory=list)
    confidence: float = 0.5
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "user_id": self.user_id,
            "task_id": self.task_id,
            "position": self.position,
            "reasoning": self.reasoning,
            "critical_points": self.critical_points,
            "suggested_alternatives": self.suggested_alternatives,
            "confidence": self.confidence,
            "timestamp": self.timestamp
        }


@dataclass
class EffectivenessMetrics:
    """
    Metriche di effectiveness per devil's advocates.

    Formule RLCF.md Section 3.5.3:
    - Diversity = |Positions_advocates - Positions_regular| / |Positions_all|
    - Engagement = 0.6 * (avg_reasoning_length/50) + 0.4 * (critical_elements/total)

    Attributes:
        diversity_score: Score di diversità posizioni [0-1]
        engagement_score: Score di engagement critico [0-1]
        critical_elements_ratio: Ratio elementi critici
        avg_reasoning_length: Lunghezza media reasoning
        unique_positions_introduced: Numero posizioni uniche introdotte
        total_advocate_feedbacks: Numero totale feedback advocate
        total_regular_feedbacks: Numero totale feedback regolari
    """
    diversity_score: float = 0.0
    engagement_score: float = 0.0
    critical_elements_ratio: float = 0.0
    avg_reasoning_length: float = 0.0
    unique_positions_introduced: int = 0
    total_advocate_feedbacks: int = 0
    total_regular_feedbacks: int = 0
    overall_effectiveness: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "diversity_score": round(self.diversity_score, 4),
            "engagement_score": round(self.engagement_score, 4),
            "critical_elements_ratio": round(self.critical_elements_ratio, 4),
            "avg_reasoning_length": round(self.avg_reasoning_length, 2),
            "unique_positions_introduced": self.unique_positions_introduced,
            "total_advocate_feedbacks": self.total_advocate_feedbacks,
            "total_regular_feedbacks": self.total_regular_feedbacks,
            "overall_effectiveness": round(self.overall_effectiveness, 4)
        }


# =============================================================================
# CRITICAL PROMPTS
# =============================================================================

# Base critical questions (RLCF.md Section 3.5.2)
BASE_CRITICAL_QUESTIONS = [
    "Quali sono i potenziali punti deboli in questo ragionamento?",
    "Esistono interpretazioni alternative non considerate?",
    "Come potrebbe essere contestata questa conclusione dalla controparte?",
    "Quali prove aggiuntive rafforzerebbero o indebolirebbero questa posizione?"
]

# Task-specific critical prompts
TASK_CRITICAL_PROMPTS: Dict[TaskType, Dict[str, Any]] = {
    TaskType.QA: {
        "focus": "Completezza e Contesto",
        "prompts": [
            "Quali sfumature o eccezioni importanti mancano nella risposta?",
            "Il contesto normativo è stato considerato completamente?",
            "Ci sono casi limite non affrontati?",
            "La giurisprudenza recente è stata adeguatamente considerata?"
        ]
    },
    TaskType.CLASSIFICATION: {
        "focus": "Casi Limite",
        "prompts": [
            "Questo testo potrebbe legittimamente appartenere a più categorie?",
            "I criteri di classificazione sono stati applicati correttamente?",
            "Esistono ambiguità nella definizione delle categorie?",
            "Come verrebbe classificato da un giurista di orientamento diverso?"
        ]
    },
    TaskType.PREDICTION: {
        "focus": "Esiti Alternativi",
        "prompts": [
            "Quali fattori potrebbero portare a un esito diverso?",
            "La previsione considera adeguatamente l'incertezza giuridica?",
            "Esistono precedenti contrari non considerati?",
            "Come cambierebbe la previsione con interpretazioni alternative?"
        ]
    },
    TaskType.DRAFTING: {
        "focus": "Precisione Giuridica",
        "prompts": [
            "Quali ambiguità potrebbero essere sfruttate dalla controparte?",
            "Le clausole sono sufficientemente precise e vincolanti?",
            "Esistono lacune nella tutela degli interessi del cliente?",
            "Il linguaggio è conforme alla prassi giuridica consolidata?"
        ]
    },
    TaskType.SUMMARIZATION: {
        "focus": "Completezza e Accuratezza",
        "prompts": [
            "Quali elementi essenziali sono stati omessi?",
            "La sintesi altera il significato originale?",
            "Le proporzioni tra i diversi aspetti sono corrette?",
            "I passaggi critici sono stati adeguatamente rappresentati?"
        ]
    },
    TaskType.NLI: {
        "focus": "Relazioni Logiche",
        "prompts": [
            "L'inferenza è valida in tutti i contesti possibili?",
            "Esistono presupposti impliciti non giustificati?",
            "La conclusione è necessaria o solo plausibile?",
            "Quali condizioni potrebbero invalidare l'inferenza?"
        ]
    },
    TaskType.RETRIEVAL: {
        "focus": "Rilevanza e Completezza",
        "prompts": [
            "Sono state recuperate tutte le fonti pertinenti?",
            "Alcune fonti recuperate sono irrilevanti o fuorvianti?",
            "Il ranking riflette la reale importanza delle fonti?",
            "Mancano fonti autorevoli che contraddicono la posizione?"
        ]
    },
    TaskType.DOCTRINE: {
        "focus": "Fondamento Dottrinale",
        "prompts": [
            "L'applicazione del principio è corretta nel caso specifico?",
            "Esistono dottrine alternative applicabili?",
            "Il principio è stato interpretato troppo restrittivamente o estensivamente?",
            "La dottrina citata è ancora attuale e applicabile?"
        ]
    }
}


# =============================================================================
# DEVIL'S ADVOCATE ASSIGNER
# =============================================================================

class DevilsAdvocateAssigner:
    """
    Gestisce l'assegnazione probabilistica di devil's advocates.

    Implementa la formula P(advocate) = min(0.1, 3/|E|) per garantire
    valutazione critica senza sovraccaricare il sistema.

    Attributes:
        max_advocate_ratio: Proporzione massima di advocate (default 0.1)
        min_advocates: Numero minimo di advocate per valutazione efficace
        min_authority_threshold: Soglia minima di authority per essere advocate
        assignments: Cache delle assegnazioni correnti
    """

    def __init__(
        self,
        max_advocate_ratio: float = 0.1,
        min_advocates: int = 3,
        min_authority_threshold: float = 0.5
    ):
        """
        Inizializza DevilsAdvocateAssigner.

        Args:
            max_advocate_ratio: Proporzione massima (default 0.1 = 10%)
            min_advocates: Minimo numero advocate (default 3)
            min_authority_threshold: Soglia authority minima (default 0.5)
        """
        self.max_advocate_ratio = max_advocate_ratio
        self.min_advocates = min_advocates
        self.min_authority_threshold = min_authority_threshold
        self.assignments: Dict[str, List[DevilsAdvocateAssignment]] = {}

        log.info(
            "DevilsAdvocateAssigner initialized",
            max_ratio=max_advocate_ratio,
            min_advocates=min_advocates,
            min_authority=min_authority_threshold
        )

    def calculate_advocate_probability(self, num_eligible: int) -> float:
        """
        Calcola probabilità di assegnazione come advocate.

        Formula: P(advocate) = min(0.1, 3/|E|)

        Args:
            num_eligible: Numero di evaluator eligibili |E|

        Returns:
            Probabilità di assegnazione [0, max_advocate_ratio]
        """
        if num_eligible <= 0:
            return 0.0

        # P = min(max_ratio, min_advocates / |E|)
        probability = min(
            self.max_advocate_ratio,
            self.min_advocates / num_eligible
        )

        return probability

    def calculate_num_advocates(self, num_eligible: int) -> int:
        """
        Calcola numero di advocate da assegnare.

        Args:
            num_eligible: Numero di evaluator eligibili

        Returns:
            Numero di advocate da assegnare (almeno 1 se eligible > 0)
        """
        if num_eligible <= 0:
            return 0

        prob = self.calculate_advocate_probability(num_eligible)
        num_advocates = max(1, int(num_eligible * prob))

        # Non più di min_advocates se il pool è piccolo
        return min(num_advocates, num_eligible, self.min_advocates)

    async def assign_advocates_for_task(
        self,
        task_id: str,
        eligible_users: List[Dict[str, Any]],
        task_type: TaskType = TaskType.QA
    ) -> List[DevilsAdvocateAssignment]:
        """
        Assegna devil's advocates per un task.

        Implementa P(advocate) = min(0.1, 3/|E|) con filtro per authority.

        Args:
            task_id: ID del task
            eligible_users: Lista utenti eligibili con {"user_id", "authority"}
            task_type: Tipo di task per prompt specifici

        Returns:
            Lista di DevilsAdvocateAssignment
        """
        # Filtra per authority minima
        qualified_users = [
            u for u in eligible_users
            if u.get("authority", 0) >= self.min_authority_threshold
        ]

        num_eligible = len(qualified_users)
        if num_eligible == 0:
            log.warning(
                "No eligible advocates",
                task_id=task_id,
                total_users=len(eligible_users),
                min_authority=self.min_authority_threshold
            )
            return []

        # Calcola numero di advocate
        num_advocates = self.calculate_num_advocates(num_eligible)

        # Random sampling
        selected_users = random.sample(
            qualified_users,
            min(num_advocates, len(qualified_users))
        )

        # Genera prompt critico
        critical_prompt = self.generate_critical_prompt(task_type)
        instructions = self._generate_advocate_instructions(task_type)

        # Crea assignments
        assignments = []
        for user in selected_users:
            assignment = DevilsAdvocateAssignment(
                assignment_id=f"adv_{task_id}_{user['user_id']}_{datetime.now().strftime('%Y%m%d%H%M%S')}",
                task_id=task_id,
                user_id=user["user_id"],
                critical_prompt=critical_prompt,
                instructions=instructions,
                metadata={
                    "user_authority": user.get("authority"),
                    "task_type": task_type.value,
                    "selection_probability": self.calculate_advocate_probability(num_eligible)
                }
            )
            assignments.append(assignment)

        # Cache
        self.assignments[task_id] = assignments

        log.info(
            "Devils advocates assigned",
            task_id=task_id,
            num_advocates=len(assignments),
            num_eligible=num_eligible,
            probability=self.calculate_advocate_probability(num_eligible)
        )

        return assignments

    def generate_critical_prompt(self, task_type: TaskType = TaskType.QA) -> str:
        """
        Genera prompt critico task-specific.

        Combina domande base con domande specifiche per il tipo di task.

        Args:
            task_type: Tipo di task

        Returns:
            Prompt critico formattato
        """
        # Base questions
        base_section = "## Domande Critiche Fondamentali\n\n"
        for i, q in enumerate(BASE_CRITICAL_QUESTIONS, 1):
            base_section += f"{i}. {q}\n"

        # Task-specific questions
        task_config = TASK_CRITICAL_PROMPTS.get(task_type, TASK_CRITICAL_PROMPTS[TaskType.QA])
        focus = task_config["focus"]
        task_questions = task_config["prompts"]

        task_section = f"\n## Focus Specifico: {focus}\n\n"
        for i, q in enumerate(task_questions, 1):
            task_section += f"{i}. {q}\n"

        # Final prompt
        prompt = f"""# Ruolo: Devil's Advocate

Il tuo compito è fornire una valutazione critica costruttiva della risposta AI.
Non cercare di confermare la risposta, ma di identificarne i punti deboli.

{base_section}
{task_section}

## Istruzioni

1. Analizza criticamente ogni aspetto della risposta
2. Identifica debolezze, omissioni e possibili contraddizioni
3. Proponi interpretazioni alternative legittime
4. Mantieni un approccio costruttivo e professionale
5. Fondi le tue critiche su basi giuridiche solide

La tua valutazione contribuirà al miglioramento del sistema."""

        return prompt

    def _generate_advocate_instructions(self, task_type: TaskType) -> str:
        """
        Genera istruzioni specifiche per l'advocate.

        Args:
            task_type: Tipo di task

        Returns:
            Istruzioni formattate
        """
        task_focus = TASK_CRITICAL_PROMPTS.get(
            task_type,
            TASK_CRITICAL_PROMPTS[TaskType.QA]
        )["focus"]

        return f"""Sei stato selezionato come Devil's Advocate per questo task.

Il tuo focus principale è: {task_focus}

Come Devil's Advocate, il tuo ruolo è:
1. Sfidare le conclusioni presentate
2. Identificare punti deboli e lacune
3. Proporre prospettive alternative
4. Garantire che tutte le obiezioni ragionevoli siano considerate

NON devi:
- Cercare di confermare la risposta esistente
- Essere critico senza fondamento
- Ignorare i punti di forza della risposta

Il tuo contributo è essenziale per la qualità del sistema."""

    def analyze_critical_engagement(self, text: str) -> Tuple[float, int]:
        """
        Analizza l'engagement critico di un testo.

        Quantifica il pensiero critico attraverso pattern linguistici.

        Args:
            text: Testo da analizzare

        Returns:
            Tuple (score [0-1], count keywords trovate)
        """
        if not text:
            return 0.0, 0

        text_lower = text.lower()

        # Conta keyword critiche
        critical_count = sum(
            1 for keyword in CRITICAL_KEYWORDS
            if keyword in text_lower
        )

        # Normalizza a [0, 1] (threshold a 3 keywords per score massimo)
        score = min(1.0, critical_count / 3)

        return score, critical_count

    def analyze_advocate_effectiveness(
        self,
        advocate_feedbacks: List[AdvocateFeedback],
        regular_feedbacks: List[Dict[str, Any]]
    ) -> EffectivenessMetrics:
        """
        Analizza l'effectiveness complessiva degli advocate.

        Implementa le formule RLCF.md Section 3.5.3:
        - Diversity = |Positions_advocates - Positions_regular| / |Positions_all|
        - Engagement = 0.6 * (avg_reasoning_length/50) + 0.4 * (critical_elements/total)

        Args:
            advocate_feedbacks: Lista feedback degli advocate
            regular_feedbacks: Lista feedback regolari (dict con "position", "reasoning")

        Returns:
            EffectivenessMetrics con tutte le metriche
        """
        if not advocate_feedbacks:
            return EffectivenessMetrics()

        # Estrai posizioni
        advocate_positions: Set[str] = {f.position for f in advocate_feedbacks}
        regular_positions: Set[str] = {
            f.get("position", "") for f in regular_feedbacks
            if f.get("position")
        }
        all_positions = advocate_positions | regular_positions

        # 1. Diversity Score
        # Posizioni uniche introdotte dagli advocate
        unique_positions = advocate_positions - regular_positions
        diversity_score = (
            len(unique_positions) / len(all_positions)
            if all_positions else 0.0
        )

        # 2. Engagement Score
        # 2a. Average reasoning length
        reasoning_lengths = [
            len(f.reasoning) for f in advocate_feedbacks
            if f.reasoning
        ]
        avg_reasoning_length = (
            sum(reasoning_lengths) / len(reasoning_lengths)
            if reasoning_lengths else 0.0
        )
        # Normalizzato a 50 caratteri come baseline
        length_component = min(1.0, avg_reasoning_length / 50)

        # 2b. Critical elements ratio
        total_critical = 0
        for feedback in advocate_feedbacks:
            _, count = self.analyze_critical_engagement(feedback.reasoning)
            total_critical += count

        critical_ratio = (
            total_critical / len(advocate_feedbacks)
            if advocate_feedbacks else 0.0
        )
        # Normalizzato a 3 elementi critici come baseline
        critical_component = min(1.0, critical_ratio / 3)

        # Engagement = 0.6 * length + 0.4 * critical
        engagement_score = 0.6 * length_component + 0.4 * critical_component

        # 3. Overall effectiveness
        # Media pesata di diversity (0.4) e engagement (0.6)
        overall = 0.4 * diversity_score + 0.6 * engagement_score

        metrics = EffectivenessMetrics(
            diversity_score=diversity_score,
            engagement_score=engagement_score,
            critical_elements_ratio=critical_ratio,
            avg_reasoning_length=avg_reasoning_length,
            unique_positions_introduced=len(unique_positions),
            total_advocate_feedbacks=len(advocate_feedbacks),
            total_regular_feedbacks=len(regular_feedbacks),
            overall_effectiveness=overall
        )

        log.info(
            "Advocate effectiveness analyzed",
            **metrics.to_dict()
        )

        return metrics

    def get_assignments_for_task(self, task_id: str) -> List[DevilsAdvocateAssignment]:
        """
        Recupera assegnazioni per un task.

        Args:
            task_id: ID del task

        Returns:
            Lista di assegnazioni (vuota se non trovate)
        """
        return self.assignments.get(task_id, [])

    def mark_assignment_completed(
        self,
        task_id: str,
        user_id: str,
        effectiveness_score: Optional[float] = None
    ) -> bool:
        """
        Marca un'assegnazione come completata.

        Args:
            task_id: ID del task
            user_id: ID dell'utente advocate
            effectiveness_score: Score effectiveness opzionale

        Returns:
            True se aggiornato, False se non trovato
        """
        assignments = self.assignments.get(task_id, [])
        for assignment in assignments:
            if assignment.user_id == user_id:
                assignment.completed = True
                assignment.effectiveness_score = effectiveness_score
                log.info(
                    "Advocate assignment completed",
                    task_id=task_id,
                    user_id=user_id,
                    effectiveness=effectiveness_score
                )
                return True
        return False


# =============================================================================
# FACTORY FUNCTIONS
# =============================================================================

def create_devils_advocate_assigner(
    max_advocate_ratio: float = 0.1,
    min_advocates: int = 3,
    min_authority_threshold: float = 0.5
) -> DevilsAdvocateAssigner:
    """
    Factory per creare DevilsAdvocateAssigner.

    Args:
        max_advocate_ratio: Proporzione massima advocate
        min_advocates: Minimo numero advocate
        min_authority_threshold: Soglia authority minima

    Returns:
        DevilsAdvocateAssigner configurato
    """
    return DevilsAdvocateAssigner(
        max_advocate_ratio=max_advocate_ratio,
        min_advocates=min_advocates,
        min_authority_threshold=min_authority_threshold
    )


def analyze_feedback_for_critical_thinking(
    feedback_text: str,
    language: str = "it"
) -> Dict[str, Any]:
    """
    Analizza un feedback per indicatori di pensiero critico.

    Utility function per valutare qualità critica.

    Args:
        feedback_text: Testo del feedback
        language: Lingua ("it" o "en")

    Returns:
        Dict con analisi del pensiero critico
    """
    if not feedback_text:
        return {
            "has_critical_thinking": False,
            "score": 0.0,
            "keywords_found": [],
            "word_count": 0
        }

    text_lower = feedback_text.lower()

    # Seleziona keywords per lingua
    keywords = CRITICAL_KEYWORDS_IT if language == "it" else CRITICAL_KEYWORDS_EN

    # Trova keywords
    found_keywords = [
        kw for kw in keywords
        if kw in text_lower
    ]

    # Score
    score = min(1.0, len(found_keywords) / 3)

    return {
        "has_critical_thinking": len(found_keywords) > 0,
        "score": score,
        "keywords_found": found_keywords,
        "word_count": len(feedback_text.split())
    }
