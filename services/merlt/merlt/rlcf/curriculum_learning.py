"""
Curriculum Learning
===================

Sistema di curriculum learning per RLCF.

Il curriculum learning addestra il modello su task progressivamente
più difficili, migliorando convergenza e performance finale.

Strategia:
1. Classifica query per difficoltà (easy/medium/hard)
2. Inizia con query facili
3. Progredisce basandosi su performance
4. Adatta dinamicamente se performance cala

Metriche Difficoltà:
1. Complessità linguistica (lunghezza, termini tecnici)
2. Numero di concetti giuridici coinvolti
3. Expert diversity richiesta
4. Storico performance su query simili
5. Ambiguità interpretativa

Esempio:
    >>> from merlt.rlcf.curriculum_learning import CurriculumScheduler
    >>>
    >>> scheduler = CurriculumScheduler()
    >>>
    >>> # Valuta difficoltà query
    >>> difficulty = scheduler.assess_difficulty(query="Cos'è il dolo?")
    >>> print(difficulty.level)  # "easy"
    >>>
    >>> # Ottieni batch appropriato per fase training
    >>> batch = scheduler.get_training_batch(query_pool, batch_size=32)
    >>>
    >>> # Aggiorna dopo training
    >>> scheduler.update_after_epoch(avg_reward=0.75, epoch=5)
    >>> print(scheduler.current_stage)  # "medium"

Note:
    - Stages: warmup -> easy -> medium -> hard -> mixed
    - Progression based on performance thresholds
    - Adaptive regression if performance drops significantly
"""

import math
import random
import structlog
from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List, Tuple, Callable
from datetime import datetime
from enum import Enum
from collections import defaultdict

log = structlog.get_logger()


# =============================================================================
# ENUMS
# =============================================================================

class DifficultyLevel(str, Enum):
    """Livelli di difficoltà."""
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class CurriculumStage(str, Enum):
    """Stage del curriculum."""
    WARMUP = "warmup"      # Solo easy
    EASY = "easy"          # Principalmente easy, alcuni medium
    MEDIUM = "medium"      # Mix easy/medium, alcuni hard
    HARD = "hard"          # Mix medium/hard
    MIXED = "mixed"        # Tutti i livelli


# =============================================================================
# DATACLASSES
# =============================================================================

@dataclass
class DifficultyAssessment:
    """
    Valutazione difficoltà di una query.

    Attributes:
        level: Livello di difficoltà
        score: Score numerico [0-1] dove 1 = più difficile
        factors: Breakdown dei fattori che contribuiscono
        confidence: Confidenza nella valutazione
    """
    level: DifficultyLevel
    score: float  # 0-1
    factors: Dict[str, float] = field(default_factory=dict)
    confidence: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        """Serializza."""
        return {
            "level": self.level.value,
            "score": round(self.score, 4),
            "factors": {k: round(v, 4) for k, v in self.factors.items()},
            "confidence": round(self.confidence, 4)
        }


@dataclass
class CurriculumConfig:
    """
    Configurazione curriculum learning.

    Attributes:
        warmup_epochs: Epochs in warmup stage
        performance_threshold_advance: Reward medio per avanzare
        performance_threshold_regress: Reward sotto cui regredire
        min_epochs_per_stage: Minimo epochs prima di cambiare stage
        difficulty_weights: Pesi per calcolo difficoltà
        stage_difficulty_mix: Distribuzione difficoltà per stage
    """
    warmup_epochs: int = 5
    performance_threshold_advance: float = 0.7
    performance_threshold_regress: float = 0.4
    min_epochs_per_stage: int = 3

    difficulty_weights: Dict[str, float] = field(default_factory=lambda: {
        "linguistic_complexity": 0.2,
        "legal_concepts": 0.25,
        "expert_diversity": 0.2,
        "historical_performance": 0.2,
        "interpretive_ambiguity": 0.15
    })

    stage_difficulty_mix: Dict[str, Dict[str, float]] = field(default_factory=lambda: {
        "warmup": {"easy": 1.0, "medium": 0.0, "hard": 0.0},
        "easy": {"easy": 0.8, "medium": 0.2, "hard": 0.0},
        "medium": {"easy": 0.2, "medium": 0.6, "hard": 0.2},
        "hard": {"easy": 0.1, "medium": 0.3, "hard": 0.6},
        "mixed": {"easy": 0.33, "medium": 0.34, "hard": 0.33}
    })

    def to_dict(self) -> Dict[str, Any]:
        """Serializza."""
        return {
            "warmup_epochs": self.warmup_epochs,
            "performance_threshold_advance": self.performance_threshold_advance,
            "performance_threshold_regress": self.performance_threshold_regress,
            "min_epochs_per_stage": self.min_epochs_per_stage,
            "difficulty_weights": self.difficulty_weights,
            "stage_difficulty_mix": self.stage_difficulty_mix
        }


@dataclass
class CurriculumStats:
    """
    Statistiche del curriculum.

    Attributes:
        current_stage: Stage corrente
        epochs_in_stage: Epochs nello stage corrente
        total_epochs: Totale epochs
        stage_history: Storia transizioni stage
        performance_history: Storia performance per epoch
        difficulty_distribution: Distribuzione difficoltà usata
    """
    current_stage: CurriculumStage = CurriculumStage.WARMUP
    epochs_in_stage: int = 0
    total_epochs: int = 0
    stage_history: List[Dict[str, Any]] = field(default_factory=list)
    performance_history: List[float] = field(default_factory=list)
    difficulty_distribution: Dict[str, int] = field(default_factory=lambda: {
        "easy": 0, "medium": 0, "hard": 0
    })

    def to_dict(self) -> Dict[str, Any]:
        """Serializza."""
        return {
            "current_stage": self.current_stage.value,
            "epochs_in_stage": self.epochs_in_stage,
            "total_epochs": self.total_epochs,
            "avg_recent_performance": sum(self.performance_history[-5:]) / max(len(self.performance_history[-5:]), 1),
            "difficulty_distribution": self.difficulty_distribution
        }


# =============================================================================
# DIFFICULTY ASSESSOR
# =============================================================================

# Termini tecnici giuridici italiani (campione)
TECHNICAL_TERMS = {
    # Base
    "contratto", "obbligazione", "diritto", "dovere", "norma", "legge",
    "articolo", "comma", "codice", "costituzione",
    # Medium
    "inadempimento", "risarcimento", "responsabilità", "colpa", "dolo",
    "negligenza", "diligenza", "buona fede", "mala fede", "vizio",
    "nullità", "annullabilità", "rescissione", "risoluzione",
    # Hard
    "culpa in contrahendo", "exceptio non adimpleti contractus",
    "condizione risolutiva", "condizione sospensiva", "termine essenziale",
    "impossibilità sopravvenuta", "eccessiva onerosità", "clausola penale",
    "fideiussione", "ipoteca", "pegno", "privilegio", "prelazione",
    "revocatoria", "surrogatoria", "simulazione", "frode alla legge"
}

# Concetti che indicano complessità alta
COMPLEX_INDICATORS = {
    "interpretazione", "bilanciamento", "contemperamento", "deroga",
    "eccezione", "limite", "confine", "conflitto", "contrasto",
    "antinomia", "lacuna", "analogia", "estensione", "restrizione"
}


class DifficultyAssessor:
    """
    Valuta difficoltà delle query giuridiche.

    Usa multiple euristiche per stimare quanto una query sia difficile
    per il sistema MERL-T.
    """

    def __init__(
        self,
        weights: Optional[Dict[str, float]] = None,
        historical_performance: Optional[Dict[str, float]] = None
    ):
        """
        Inizializza DifficultyAssessor.

        Args:
            weights: Pesi per i fattori di difficoltà
            historical_performance: Performance storica per query simili
        """
        self.weights = weights or {
            "linguistic_complexity": 0.2,
            "legal_concepts": 0.25,
            "expert_diversity": 0.2,
            "historical_performance": 0.2,
            "interpretive_ambiguity": 0.15
        }

        # Cache performance storiche per query type
        self.historical_performance = historical_performance or {}

        log.info("DifficultyAssessor initialized", weights=self.weights)

    def assess(self, query: str, metadata: Optional[Dict[str, Any]] = None) -> DifficultyAssessment:
        """
        Valuta difficoltà di una query.

        Args:
            query: Testo della query
            metadata: Metadati aggiuntivi (domain, expected_experts, etc.)

        Returns:
            DifficultyAssessment con livello e score
        """
        metadata = metadata or {}

        # Calcola ogni fattore
        factors = {}

        # 1. Complessità linguistica
        factors["linguistic_complexity"] = self._assess_linguistic_complexity(query)

        # 2. Numero concetti giuridici
        factors["legal_concepts"] = self._assess_legal_concepts(query)

        # 3. Expert diversity richiesta
        factors["expert_diversity"] = self._assess_expert_diversity(query, metadata)

        # 4. Performance storica
        factors["historical_performance"] = self._assess_historical_performance(query, metadata)

        # 5. Ambiguità interpretativa
        factors["interpretive_ambiguity"] = self._assess_interpretive_ambiguity(query)

        # Calcola score pesato
        score = sum(
            factors.get(k, 0.5) * self.weights.get(k, 0)
            for k in self.weights
        )

        # Clamp to [0, 1]
        score = max(0.0, min(1.0, score))

        # Determina livello
        if score < 0.35:
            level = DifficultyLevel.EASY
        elif score < 0.65:
            level = DifficultyLevel.MEDIUM
        else:
            level = DifficultyLevel.HARD

        # Confidenza basata su varianza fattori
        factor_values = list(factors.values())
        variance = sum((f - score) ** 2 for f in factor_values) / len(factor_values)
        confidence = 1.0 - min(variance, 0.5) * 2  # Alta varianza = bassa confidenza

        return DifficultyAssessment(
            level=level,
            score=score,
            factors=factors,
            confidence=confidence
        )

    def _assess_linguistic_complexity(self, query: str) -> float:
        """
        Valuta complessità linguistica.

        Fattori:
        - Lunghezza query
        - Numero termini tecnici
        - Struttura sintattica (approssimata)
        """
        words = query.lower().split()
        n_words = len(words)

        # Lunghezza (normalizzata)
        length_score = min(n_words / 50, 1.0)  # 50 parole = max

        # Termini tecnici
        technical_count = sum(1 for w in words if w in TECHNICAL_TERMS)
        technical_score = min(technical_count / 10, 1.0)  # 10 termini = max

        # Complessità indicatori
        complex_count = sum(1 for w in words if w in COMPLEX_INDICATORS)
        complex_score = min(complex_count / 3, 1.0)  # 3 = max

        return (length_score * 0.3 + technical_score * 0.4 + complex_score * 0.3)

    def _assess_legal_concepts(self, query: str) -> float:
        """
        Valuta numero di concetti giuridici nella query.

        Più concetti = più difficile da rispondere correttamente.
        """
        query_lower = query.lower()

        # Categorie di concetti
        concepts = {
            "soggetti": ["parte", "creditore", "debitore", "terzo", "contraente"],
            "atti": ["contratto", "negozio", "atto", "dichiarazione"],
            "effetti": ["obbligazione", "diritto", "dovere", "responsabilità"],
            "rimedi": ["risarcimento", "risoluzione", "recesso", "nullità"],
            "condizioni": ["termine", "condizione", "modo", "causa"]
        }

        # Conta categorie presenti
        categories_found = sum(
            1 for category, terms in concepts.items()
            if any(term in query_lower for term in terms)
        )

        # Normalizza (5 categorie = massima complessità)
        return min(categories_found / 4, 1.0)

    def _assess_expert_diversity(
        self,
        query: str,
        metadata: Dict[str, Any]
    ) -> float:
        """
        Valuta quanti expert sono necessari.

        Query che richiedono multiple prospettive = più difficili.
        """
        # Se specificato in metadata
        if "expected_experts" in metadata:
            n_experts = len(metadata["expected_experts"])
            return min(n_experts / 4, 1.0)  # 4 expert = max

        # Euristica basata su keywords
        query_lower = query.lower()

        # Indicatori per ogni expert
        literal_indicators = ["significato", "definizione", "cosa significa", "cosa si intende"]
        systemic_indicators = ["sistema", "coordinamento", "insieme", "rapporto con"]
        principles_indicators = ["ratio", "finalità", "scopo", "principio", "perché"]
        precedent_indicators = ["giurisprudenza", "sentenza", "cassazione", "prassi"]

        expert_count = 0
        expert_count += 1 if any(ind in query_lower for ind in literal_indicators) else 0
        expert_count += 1 if any(ind in query_lower for ind in systemic_indicators) else 0
        expert_count += 1 if any(ind in query_lower for ind in principles_indicators) else 0
        expert_count += 1 if any(ind in query_lower for ind in precedent_indicators) else 0

        # Default minimo 1
        expert_count = max(expert_count, 1)

        return min(expert_count / 4, 1.0)

    def _assess_historical_performance(
        self,
        query: str,
        metadata: Dict[str, Any]
    ) -> float:
        """
        Valuta basandosi su performance storica.

        Query simili con bassa performance = più difficili.
        """
        # Se abbiamo domain info
        domain = metadata.get("domain", "general")

        if domain in self.historical_performance:
            perf = self.historical_performance[domain]
            # Inverti: bassa performance = alta difficoltà
            return 1.0 - perf

        # Default: difficoltà media
        return 0.5

    def _assess_interpretive_ambiguity(self, query: str) -> float:
        """
        Valuta ambiguità interpretativa.

        Query con possibili interpretazioni multiple = più difficili.
        """
        query_lower = query.lower()

        # Indicatori di ambiguità
        ambiguity_indicators = [
            "può essere", "potrebbe", "secondo alcuni", "controverso",
            "dibattito", "discusso", "opinioni", "interpretazioni",
            "sempre", "mai", "necessariamente", "inevitabilmente"
        ]

        # Domande aperte
        open_questions = [
            "come", "perché", "quando si applica", "in quali casi",
            "qual è il rapporto", "quale interpretazione"
        ]

        ambiguity_count = sum(1 for ind in ambiguity_indicators if ind in query_lower)
        open_count = sum(1 for q in open_questions if q in query_lower)

        score = (ambiguity_count * 0.2 + open_count * 0.3)
        return min(score, 1.0)

    def update_historical_performance(self, domain: str, performance: float) -> None:
        """
        Aggiorna performance storica per un domain.

        Args:
            domain: Domain giuridico
            performance: Reward medio recente [0-1]
        """
        # Exponential moving average
        if domain in self.historical_performance:
            self.historical_performance[domain] = (
                0.9 * self.historical_performance[domain] + 0.1 * performance
            )
        else:
            self.historical_performance[domain] = performance


# =============================================================================
# CURRICULUM SCHEDULER
# =============================================================================

class CurriculumScheduler:
    """
    Scheduler per curriculum learning.

    Gestisce la progressione attraverso gli stage del curriculum
    e la selezione di batch appropriati.
    """

    def __init__(
        self,
        config: Optional[CurriculumConfig] = None,
        assessor: Optional[DifficultyAssessor] = None
    ):
        """
        Inizializza CurriculumScheduler.

        Args:
            config: Configurazione curriculum
            assessor: DifficultyAssessor custom
        """
        self.config = config or CurriculumConfig()
        self.assessor = assessor or DifficultyAssessor(
            weights=self.config.difficulty_weights
        )

        self.stats = CurriculumStats()
        self._epoch_rewards: List[float] = []

        log.info(
            "CurriculumScheduler initialized",
            config=self.config.to_dict()
        )

    @property
    def current_stage(self) -> CurriculumStage:
        """Stage corrente."""
        return self.stats.current_stage

    def assess_difficulty(
        self,
        query: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> DifficultyAssessment:
        """
        Valuta difficoltà di una query.

        Args:
            query: Testo query
            metadata: Metadati aggiuntivi

        Returns:
            DifficultyAssessment
        """
        return self.assessor.assess(query, metadata)

    def should_include_in_batch(
        self,
        query: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, float]:
        """
        Determina se una query dovrebbe essere inclusa nel batch corrente.

        Args:
            query: Testo query
            metadata: Metadati

        Returns:
            Tuple (should_include, probability)
        """
        assessment = self.assess_difficulty(query, metadata)
        difficulty_mix = self.config.stage_difficulty_mix[self.current_stage.value]

        # Probabilità basata su distribuzione stage
        probability = difficulty_mix.get(assessment.level.value, 0.0)

        # Sampling stocastico
        include = random.random() < probability

        return include, probability

    def filter_batch_by_curriculum(
        self,
        queries: List[Dict[str, Any]],
        target_size: int
    ) -> List[Dict[str, Any]]:
        """
        Filtra batch di query secondo curriculum corrente.

        Args:
            queries: Lista di dict con "query" e opzionalmente "metadata"
            target_size: Dimensione target del batch

        Returns:
            Lista filtrata di query
        """
        difficulty_mix = self.config.stage_difficulty_mix[self.current_stage.value]

        # Categorizza tutte le query
        categorized = {"easy": [], "medium": [], "hard": []}

        for q in queries:
            query_text = q.get("query", q) if isinstance(q, dict) else str(q)
            metadata = q.get("metadata", {}) if isinstance(q, dict) else {}

            assessment = self.assess_difficulty(query_text, metadata)
            categorized[assessment.level.value].append(q)

            # Track distribution
            self.stats.difficulty_distribution[assessment.level.value] += 1

        # Seleziona secondo distribuzione
        selected = []

        for level, target_ratio in difficulty_mix.items():
            n_target = int(target_size * target_ratio)
            available = categorized[level]

            if len(available) >= n_target:
                selected.extend(random.sample(available, n_target))
            else:
                selected.extend(available)

        # Se non abbastanza, riempi con qualsiasi livello
        remaining = target_size - len(selected)
        if remaining > 0:
            all_remaining = [q for level in categorized.values() for q in level if q not in selected]
            if all_remaining:
                selected.extend(random.sample(
                    all_remaining,
                    min(remaining, len(all_remaining))
                ))

        return selected[:target_size]

    def update_after_epoch(
        self,
        avg_reward: float,
        epoch: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Aggiorna scheduler dopo un epoch di training.

        Args:
            avg_reward: Reward medio dell'epoch
            epoch: Numero epoch (se None, incrementa automaticamente)

        Returns:
            Dict con info su eventuale transizione stage
        """
        self.stats.total_epochs += 1
        self.stats.epochs_in_stage += 1
        self.stats.performance_history.append(avg_reward)
        self._epoch_rewards.append(avg_reward)

        result = {
            "stage_changed": False,
            "previous_stage": self.current_stage.value,
            "new_stage": self.current_stage.value,
            "reason": None
        }

        # Check transizioni
        transition = self._check_stage_transition(avg_reward)

        if transition:
            result["stage_changed"] = True
            result["new_stage"] = self.current_stage.value
            result["reason"] = transition

            self.stats.stage_history.append({
                "epoch": self.stats.total_epochs,
                "from_stage": result["previous_stage"],
                "to_stage": result["new_stage"],
                "reason": transition,
                "avg_reward": avg_reward
            })

        log.info(
            "Curriculum epoch completed",
            epoch=self.stats.total_epochs,
            avg_reward=round(avg_reward, 4),
            stage=self.current_stage.value,
            epochs_in_stage=self.stats.epochs_in_stage,
            **result
        )

        return result

    def _check_stage_transition(self, avg_reward: float) -> Optional[str]:
        """
        Verifica se dovremmo cambiare stage.

        Returns:
            Reason for transition o None
        """
        # Check minimo epochs
        if self.stats.epochs_in_stage < self.config.min_epochs_per_stage:
            return None

        current = self.current_stage

        # Check progression (avanzamento)
        if avg_reward >= self.config.performance_threshold_advance:
            next_stage = self._get_next_stage(current)
            if next_stage != current:
                self._transition_to(next_stage)
                return f"performance_advance (reward={avg_reward:.3f} >= {self.config.performance_threshold_advance})"

        # Check regression (regressione)
        if avg_reward <= self.config.performance_threshold_regress:
            prev_stage = self._get_previous_stage(current)
            if prev_stage != current:
                self._transition_to(prev_stage)
                return f"performance_regress (reward={avg_reward:.3f} <= {self.config.performance_threshold_regress})"

        # Warmup auto-progression
        if current == CurriculumStage.WARMUP:
            if self.stats.epochs_in_stage >= self.config.warmup_epochs:
                self._transition_to(CurriculumStage.EASY)
                return f"warmup_complete (epochs={self.stats.epochs_in_stage})"

        return None

    def _get_next_stage(self, current: CurriculumStage) -> CurriculumStage:
        """Ottieni stage successivo."""
        progression = [
            CurriculumStage.WARMUP,
            CurriculumStage.EASY,
            CurriculumStage.MEDIUM,
            CurriculumStage.HARD,
            CurriculumStage.MIXED
        ]
        try:
            idx = progression.index(current)
            if idx < len(progression) - 1:
                return progression[idx + 1]
        except ValueError:
            pass
        return current

    def _get_previous_stage(self, current: CurriculumStage) -> CurriculumStage:
        """Ottieni stage precedente."""
        progression = [
            CurriculumStage.WARMUP,
            CurriculumStage.EASY,
            CurriculumStage.MEDIUM,
            CurriculumStage.HARD,
            CurriculumStage.MIXED
        ]
        try:
            idx = progression.index(current)
            if idx > 0:
                return progression[idx - 1]
        except ValueError:
            pass
        return current

    def _transition_to(self, new_stage: CurriculumStage) -> None:
        """Transizione a nuovo stage."""
        self.stats.current_stage = new_stage
        self.stats.epochs_in_stage = 0

    def get_stats(self) -> CurriculumStats:
        """Restituisce statistiche."""
        return self.stats

    def reset(self) -> None:
        """Reset curriculum a stato iniziale."""
        self.stats = CurriculumStats()
        self._epoch_rewards = []
        log.info("Curriculum reset to initial state")


# =============================================================================
# QUERY POOL
# =============================================================================

@dataclass
class CurriculumQuery:
    """Query con metadata per curriculum."""
    query: str
    domain: str = "general"
    difficulty_override: Optional[DifficultyLevel] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


class QueryPool:
    """
    Pool di query per curriculum learning.

    Gestisce un insieme di query categorizzate per difficoltà.
    """

    def __init__(self, assessor: Optional[DifficultyAssessor] = None):
        """
        Inizializza QueryPool.

        Args:
            assessor: DifficultyAssessor per valutazione
        """
        self.assessor = assessor or DifficultyAssessor()

        self.queries: Dict[DifficultyLevel, List[CurriculumQuery]] = {
            DifficultyLevel.EASY: [],
            DifficultyLevel.MEDIUM: [],
            DifficultyLevel.HARD: []
        }

        self._all_queries: List[CurriculumQuery] = []

    def add(
        self,
        query: str,
        domain: str = "general",
        difficulty: Optional[DifficultyLevel] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> DifficultyLevel:
        """
        Aggiunge query al pool.

        Args:
            query: Testo query
            domain: Domain giuridico
            difficulty: Override difficoltà (se None, calcolata)
            metadata: Metadati aggiuntivi

        Returns:
            DifficultyLevel assegnato
        """
        cq = CurriculumQuery(
            query=query,
            domain=domain,
            difficulty_override=difficulty,
            metadata=metadata or {}
        )

        # Determina difficoltà
        if difficulty:
            level = difficulty
        else:
            assessment = self.assessor.assess(query, metadata)
            level = assessment.level

        self.queries[level].append(cq)
        self._all_queries.append(cq)

        return level

    def add_batch(self, queries: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        Aggiunge batch di query.

        Args:
            queries: Lista di dict con "query", opzionalmente "domain", "difficulty", "metadata"

        Returns:
            Dict con conteggio per livello
        """
        counts = {"easy": 0, "medium": 0, "hard": 0}

        for q in queries:
            query_text = q.get("query", str(q))
            domain = q.get("domain", "general")
            difficulty = q.get("difficulty")
            metadata = q.get("metadata", {})

            if difficulty and isinstance(difficulty, str):
                difficulty = DifficultyLevel(difficulty)

            level = self.add(query_text, domain, difficulty, metadata)
            counts[level.value] += 1

        log.info("Batch added to query pool", **counts)

        return counts

    def sample(
        self,
        n: int,
        difficulty_mix: Optional[Dict[str, float]] = None
    ) -> List[CurriculumQuery]:
        """
        Campiona query dal pool.

        Args:
            n: Numero di query da campionare
            difficulty_mix: Distribuzione desiderata per livello

        Returns:
            Lista di CurriculumQuery
        """
        if difficulty_mix is None:
            # Uniform
            difficulty_mix = {"easy": 0.33, "medium": 0.34, "hard": 0.33}

        selected = []

        for level_str, ratio in difficulty_mix.items():
            level = DifficultyLevel(level_str)
            n_level = int(n * ratio)
            available = self.queries[level]

            if len(available) >= n_level:
                selected.extend(random.sample(available, n_level))
            else:
                selected.extend(available)

        # Fill remaining
        remaining = n - len(selected)
        if remaining > 0:
            all_available = [q for q in self._all_queries if q not in selected]
            if all_available:
                selected.extend(random.sample(
                    all_available,
                    min(remaining, len(all_available))
                ))

        random.shuffle(selected)
        return selected[:n]

    def get_by_difficulty(self, level: DifficultyLevel) -> List[CurriculumQuery]:
        """Ottieni tutte le query di un livello."""
        return list(self.queries[level])

    def __len__(self) -> int:
        return len(self._all_queries)

    def stats(self) -> Dict[str, int]:
        """Statistiche del pool."""
        return {
            "total": len(self._all_queries),
            "easy": len(self.queries[DifficultyLevel.EASY]),
            "medium": len(self.queries[DifficultyLevel.MEDIUM]),
            "hard": len(self.queries[DifficultyLevel.HARD])
        }
