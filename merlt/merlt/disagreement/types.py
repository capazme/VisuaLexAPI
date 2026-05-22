"""
Disagreement Types - Tassonomia del Disagreement Giuridico
==========================================================

Definisce tipi e strutture dati per il rilevamento delle divergenze
interpretative nel diritto italiano.

Fondamento teorico: Art. 12-14 disp. prel. c.c. (Preleggi)

Esempio:
    >>> from merlt.disagreement.types import DisagreementType, DisagreementLevel
    >>>
    >>> dtype = DisagreementType.METHODOLOGICAL
    >>> dlevel = DisagreementLevel.TELEOLOGICAL
    >>> print(f"Divergenza {dtype.label}: {dtype.description}")
"""

from enum import Enum
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime


# =============================================================================
# TASSONOMIA: Tipi di Disagreement
# =============================================================================

class DisagreementType(str, Enum):
    """
    Tipologia del conflitto interpretativo.

    Fondata sui canoni delle Preleggi (art. 12-14 disp. prel. c.c.).

    Ogni tipo ha un codice breve (3 lettere) per serializzazione
    e un label/description per UI.
    """

    # ANTINOMIA (ANT)
    # Due norme incompatibili, richiedono criteri di soluzione
    # Es: Art. X dice "vietato", Art. Y dice "consentito" per stesso fatto
    ANTINOMY = "ANT"

    # LACUNA INTERPRETATIVA (LAC)
    # Norma ambigua, multiple letture legittime
    # Es: "Buona fede" -> soggettiva vs oggettiva
    INTERPRETIVE_GAP = "LAC"

    # DIVERGENZA METODOLOGICA (MET)
    # Stesso testo, metodi diversi -> conclusioni diverse
    # Es: Letterale dice A, teleologico dice B
    METHODOLOGICAL = "MET"

    # OVERRULING (OVR)
    # Precedente superato ma non formalmente abrogato
    # Es: Cass. SS.UU. 2020 supera Cass. 2015
    OVERRULING = "OVR"

    # CONFLITTO GERARCHICO (GER)
    # Norma inferiore vs superiore nella piramide Kelseniana
    # Es: Legge ordinaria vs Costituzione
    HIERARCHICAL = "GER"

    # SPECIALIZZAZIONE (SPE)
    # Non conflitto vero, ma raffinamento/estensione
    # Es: "Si applica ANCHE quando..." - complementare
    SPECIALIZATION = "SPE"

    @property
    def label(self) -> str:
        """Label leggibile per UI."""
        labels = {
            "ANT": "Antinomia",
            "LAC": "Lacuna Interpretativa",
            "MET": "Divergenza Metodologica",
            "OVR": "Overruling",
            "GER": "Conflitto Gerarchico",
            "SPE": "Specializzazione",
        }
        return labels.get(self.value, self.value)

    @property
    def description(self) -> str:
        """Descrizione estesa per documentazione/UI."""
        descriptions = {
            "ANT": (
                "Due norme incompatibili sullo stesso fatto. "
                "Richiedono criteri di soluzione: lex posterior, specialis, superior."
            ),
            "LAC": (
                "Norma ambigua che ammette multiple letture legittime. "
                "Es: 'buona fede' soggettiva vs oggettiva."
            ),
            "MET": (
                "Stesso testo, metodi interpretativi diversi portano a conclusioni diverse. "
                "Es: interpretazione letterale vs teleologica."
            ),
            "OVR": (
                "Precedente giurisprudenziale superato da decisione successiva. "
                "Es: Cassazione SS.UU. che ribalta orientamento consolidato."
            ),
            "GER": (
                "Conflitto tra norma inferiore e superiore nella gerarchia delle fonti. "
                "Es: legge ordinaria vs Costituzione."
            ),
            "SPE": (
                "Non vero conflitto ma raffinamento o specializzazione. "
                "Le posizioni sono complementari, non contrapposte."
            ),
        }
        return descriptions.get(self.value, "")

    @property
    def resolution_criteria(self) -> List[str]:
        """Criteri applicabili per risolvere questo tipo di disagreement."""
        criteria = {
            "ANT": ["lex posterior derogat priori", "lex specialis derogat generali", "lex superior"],
            "LAC": ["interpretazione sistematica", "interpretazione teleologica", "analogia"],
            "MET": ["gerarchia dei canoni", "ratio legis", "principi generali"],
            "OVR": ["stare decisis", "nomofilachia", "orientamento prevalente"],
            "GER": ["lex superior", "interpretazione conforme", "disapplicazione"],
            "SPE": ["coordinamento", "integrazione", "principio di completezza"],
        }
        return criteria.get(self.value, [])


class DisagreementLevel(str, Enum):
    """
    Livello di analisi a cui si manifesta il disagreement.

    Corrisponde ai 4 Expert del sistema MERL-T e ai canoni
    interpretativi dell'art. 12 disp. prel. c.c.
    """

    # SEMANTICO - Cosa dice il testo?
    # LiteralExpert diverge su significato parole
    # "significato proprio delle parole"
    SEMANTIC = "SEM"

    # SISTEMATICO - Come si colloca nel sistema?
    # SystemicExpert diverge su relazioni tra norme
    # "connessione di esse"
    SYSTEMIC = "SIS"

    # TELEOLOGICO - Qual e' lo scopo?
    # PrinciplesExpert diverge su ratio legis
    # "intenzione del legislatore"
    TELEOLOGICAL = "TEL"

    # APPLICATIVO - Come si applica al caso?
    # PrecedentExpert diverge su sussunzione
    # "casi simili" (analogia)
    APPLICATIVE = "APP"

    @property
    def label(self) -> str:
        """Label leggibile per UI."""
        labels = {
            "SEM": "Semantico",
            "SIS": "Sistematico",
            "TEL": "Teleologico",
            "APP": "Applicativo",
        }
        return labels.get(self.value, self.value)

    @property
    def expert_mapping(self) -> str:
        """Expert MERL-T corrispondente."""
        mapping = {
            "SEM": "LiteralExpert",
            "SIS": "SystemicExpert",
            "TEL": "PrinciplesExpert",
            "APP": "PrecedentExpert",
        }
        return mapping.get(self.value, "")

    @property
    def preleggi_reference(self) -> str:
        """Riferimento normativo nelle Preleggi."""
        refs = {
            "SEM": "Art. 12, I c.c. - 'significato proprio delle parole'",
            "SIS": "Art. 12, I c.c. - 'connessione di esse'",
            "TEL": "Art. 12, I c.c. - 'intenzione del legislatore'",
            "APP": "Art. 12, II c.c. - 'casi simili o materie analoghe'",
        }
        return refs.get(self.value, "")


# =============================================================================
# DATACLASSES: Strutture dati per analisi
# =============================================================================

@dataclass
class ExpertPairConflict:
    """
    Conflitto tra una coppia specifica di Expert.

    Attributes:
        expert_a: Nome del primo expert (es. "LiteralExpert")
        expert_b: Nome del secondo expert (es. "PrinciplesExpert")
        conflict_score: Score di conflitto [0-1]
        contention_point: Punto specifico di disaccordo
        excerpt_a: Estratto rilevante dalla risposta di expert_a
        excerpt_b: Estratto rilevante dalla risposta di expert_b
    """
    expert_a: str
    expert_b: str
    conflict_score: float
    contention_point: Optional[str] = None
    excerpt_a: Optional[str] = None
    excerpt_b: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        return {
            "expert_a": self.expert_a,
            "expert_b": self.expert_b,
            "conflict_score": self.conflict_score,
            "contention_point": self.contention_point,
            "excerpt_a": self.excerpt_a,
            "excerpt_b": self.excerpt_b,
        }


@dataclass
class DisagreementAnalysis:
    """
    Analisi completa del disagreement tra expert responses.

    Output principale di LegalDisagreementNet.

    Attributes:
        has_disagreement: True se rilevato disagreement significativo
        disagreement_type: Tipo di disagreement (se rilevato)
        disagreement_level: Livello di analisi (se rilevato)
        intensity: Intensita' del disaccordo [0-1]
        resolvability: Probabilita' che sia risolvibile con criteri oggettivi [0-1]
        confidence: Confidence del modello nella predizione [0-1]
        conflicting_pairs: Lista di coppie expert in conflitto
    """
    has_disagreement: bool
    disagreement_type: Optional[DisagreementType] = None
    disagreement_level: Optional[DisagreementLevel] = None
    intensity: float = 0.0
    resolvability: float = 0.5
    confidence: float = 0.0
    conflicting_pairs: List[ExpertPairConflict] = field(default_factory=list)
    pairwise_matrix: Optional[List[List[float]]] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario per JSON/storage."""
        return {
            "has_disagreement": self.has_disagreement,
            "disagreement_type": self.disagreement_type.value if self.disagreement_type else None,
            "disagreement_level": self.disagreement_level.value if self.disagreement_level else None,
            "intensity": self.intensity,
            "resolvability": self.resolvability,
            "confidence": self.confidence,
            "conflicting_pairs": [p.to_dict() for p in self.conflicting_pairs],
            "pairwise_matrix": self.pairwise_matrix,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DisagreementAnalysis":
        """Deserializza da dizionario."""
        dtype = DisagreementType(data["disagreement_type"]) if data.get("disagreement_type") else None
        dlevel = DisagreementLevel(data["disagreement_level"]) if data.get("disagreement_level") else None

        pairs = [
            ExpertPairConflict(**p)
            for p in data.get("conflicting_pairs", [])
        ]

        return cls(
            has_disagreement=data["has_disagreement"],
            disagreement_type=dtype,
            disagreement_level=dlevel,
            intensity=data.get("intensity", 0.0),
            resolvability=data.get("resolvability", 0.5),
            confidence=data.get("confidence", 0.0),
            conflicting_pairs=pairs,
            pairwise_matrix=data.get("pairwise_matrix"),
        )

    @property
    def synthesis_mode(self) -> str:
        """
        Determina la modalita' di sintesi raccomandata.

        Returns:
            "convergent" se basso disagreement, "divergent" altrimenti
        """
        if not self.has_disagreement:
            return "convergent"

        # Se alta resolvability, possiamo ancora convergere
        if self.resolvability > 0.7 and self.intensity < 0.5:
            return "convergent"

        return "divergent"


@dataclass
class TokenAttribution:
    """
    Attribution di un singolo token per explainability.

    Attributes:
        token: Il token originale
        score: Score di importanza (puo' essere negativo)
        expert_source: Da quale expert proviene
        position: Posizione nel testo
    """
    token: str
    score: float
    expert_source: str
    position: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "token": self.token,
            "score": self.score,
            "expert_source": self.expert_source,
            "position": self.position,
        }


@dataclass
class DisagreementExplanation:
    """
    Spiegazione human-readable del disagreement.

    Output del modulo ExplainabilityModule.

    Attributes:
        natural_explanation: Spiegazione in linguaggio naturale
        key_tokens: Token piu' rilevanti per il disagreement
        token_attributions: Attribution completa per expert
        expert_pair_scores: Score di conflitto per ogni coppia
        resolution_suggestions: Suggerimenti per risolvere il disagreement
    """
    natural_explanation: str
    key_tokens: List[str] = field(default_factory=list)
    token_attributions: Dict[str, List[TokenAttribution]] = field(default_factory=dict)
    expert_pair_scores: Dict[Tuple[str, str], float] = field(default_factory=dict)
    resolution_suggestions: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario."""
        # Converti tuple keys in stringhe per JSON
        pair_scores_serializable = {
            f"{k[0]}__vs__{k[1]}": v
            for k, v in self.expert_pair_scores.items()
        }

        return {
            "natural_explanation": self.natural_explanation,
            "key_tokens": self.key_tokens,
            "token_attributions": {
                expert: [t.to_dict() for t in tokens]
                for expert, tokens in self.token_attributions.items()
            },
            "expert_pair_scores": pair_scores_serializable,
            "resolution_suggestions": self.resolution_suggestions,
        }


# =============================================================================
# DATACLASSES: Strutture per Dataset e Training
# =============================================================================

@dataclass
class ExpertResponseData:
    """
    Dati di una risposta expert per il sample di training.

    Versione serializzabile dei dati necessari per il modello.
    """
    expert_type: str  # "literal", "systemic", "principles", "precedent"
    interpretation: str  # Testo della risposta
    confidence: float  # Confidence dell'expert [0-1]
    sources_cited: List[str] = field(default_factory=list)  # URN delle fonti
    reasoning_pattern: Optional[str] = None  # "literal", "teleological", etc.

    def to_dict(self) -> Dict[str, Any]:
        return {
            "expert_type": self.expert_type,
            "interpretation": self.interpretation,
            "confidence": self.confidence,
            "sources_cited": self.sources_cited,
            "reasoning_pattern": self.reasoning_pattern,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExpertResponseData":
        return cls(
            expert_type=data["expert_type"],
            interpretation=data["interpretation"],
            confidence=data.get("confidence", 0.5),
            sources_cited=data.get("sources_cited", []),
            reasoning_pattern=data.get("reasoning_pattern"),
        )


@dataclass
class DisagreementSample:
    """
    Singolo sample per training/inference di LegalDisagreementNet.

    Attributes:
        sample_id: ID univoco del sample
        query: Query originale dell'utente
        expert_responses: Risposte dei 4 expert
        has_disagreement: Label binaria
        disagreement_type: Tipo di disagreement (se presente)
        disagreement_level: Livello di disagreement (se presente)
        intensity: Intensita' [0-1]
        resolvability: Risolvibilita' [0-1]
        conflicting_pairs: Coppie in conflitto
        explanation: Spiegazione human-provided (gold)
        key_terms: Termini chiave identificati
        source: Origine del sample ("rlcf", "overruling", "synthetic", "expert")
        legal_domain: Dominio giuridico (es. "civile", "penale")
        created_at: Timestamp creazione
        annotator_id: ID annotatore (se manual)
        annotation_confidence: Confidence annotazione
    """
    sample_id: str
    query: str
    expert_responses: Dict[str, ExpertResponseData]

    # Labels (possono essere None per inference)
    has_disagreement: Optional[bool] = None
    disagreement_type: Optional[DisagreementType] = None
    disagreement_level: Optional[DisagreementLevel] = None
    intensity: Optional[float] = None
    resolvability: Optional[float] = None
    conflicting_pairs: Optional[List[Tuple[str, str]]] = None
    explanation: Optional[str] = None
    key_terms: Optional[List[str]] = None

    # Metadata
    source: str = "unknown"
    legal_domain: str = "generale"
    created_at: datetime = field(default_factory=datetime.now)
    annotator_id: Optional[str] = None
    annotation_confidence: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        """Serializza in dizionario per storage."""
        return {
            "sample_id": self.sample_id,
            "query": self.query,
            "expert_responses": {
                k: v.to_dict() for k, v in self.expert_responses.items()
            },
            "has_disagreement": self.has_disagreement,
            "disagreement_type": self.disagreement_type.value if self.disagreement_type else None,
            "disagreement_level": self.disagreement_level.value if self.disagreement_level else None,
            "intensity": self.intensity,
            "resolvability": self.resolvability,
            "conflicting_pairs": self.conflicting_pairs,
            "explanation": self.explanation,
            "key_terms": self.key_terms,
            "source": self.source,
            "legal_domain": self.legal_domain,
            "created_at": self.created_at.isoformat(),
            "annotator_id": self.annotator_id,
            "annotation_confidence": self.annotation_confidence,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DisagreementSample":
        """Deserializza da dizionario."""
        expert_responses = {
            k: ExpertResponseData.from_dict(v)
            for k, v in data.get("expert_responses", {}).items()
        }

        dtype = DisagreementType(data["disagreement_type"]) if data.get("disagreement_type") else None
        dlevel = DisagreementLevel(data["disagreement_level"]) if data.get("disagreement_level") else None

        created_at = data.get("created_at")
        if isinstance(created_at, str):
            created_at = datetime.fromisoformat(created_at)
        elif created_at is None:
            created_at = datetime.now()

        return cls(
            sample_id=data["sample_id"],
            query=data["query"],
            expert_responses=expert_responses,
            has_disagreement=data.get("has_disagreement"),
            disagreement_type=dtype,
            disagreement_level=dlevel,
            intensity=data.get("intensity"),
            resolvability=data.get("resolvability"),
            conflicting_pairs=data.get("conflicting_pairs"),
            explanation=data.get("explanation"),
            key_terms=data.get("key_terms"),
            source=data.get("source", "unknown"),
            legal_domain=data.get("legal_domain", "generale"),
            created_at=created_at,
            annotator_id=data.get("annotator_id"),
            annotation_confidence=data.get("annotation_confidence"),
        )

    @property
    def is_labeled(self) -> bool:
        """True se il sample ha labels complete per training."""
        return self.has_disagreement is not None

    @property
    def is_fully_labeled(self) -> bool:
        """True se il sample ha tutte le labels (per gold standard)."""
        if not self.is_labeled:
            return False
        if self.has_disagreement:
            return (
                self.disagreement_type is not None and
                self.disagreement_level is not None and
                self.intensity is not None
            )
        return True


# =============================================================================
# DATACLASSES: Active Learning
# =============================================================================

@dataclass
class AnnotationQuestion:
    """
    Singola domanda per l'annotatore.

    Attributes:
        id: ID univoco della domanda
        text: Testo della domanda
        question_type: Tipo ("boolean", "single_choice", "scale", "text")
        options: Opzioni se single_choice
        min_value: Min se scale
        max_value: Max se scale
    """
    id: str
    text: str
    question_type: str  # "boolean", "single_choice", "scale", "text"
    options: Optional[List[str]] = None
    min_value: Optional[int] = None
    max_value: Optional[int] = None


@dataclass
class AnnotationCandidate:
    """
    Candidato per annotazione umana selezionato da Active Learning.

    Attributes:
        sample: Il sample da annotare
        model_prediction: Predizione corrente del modello
        uncertainty: Uncertainty del modello su questo sample
        diversity_score: Quanto e' diverso da samples gia' annotati
        priority_score: Score combinato per priorita'
        created_at: Quando e' stato aggiunto al pool
    """
    sample: DisagreementSample
    model_prediction: Optional[DisagreementAnalysis] = None
    uncertainty: float = 0.0
    diversity_score: float = 0.0
    priority_score: float = 0.0
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sample": self.sample.to_dict(),
            "model_prediction": self.model_prediction.to_dict() if self.model_prediction else None,
            "uncertainty": self.uncertainty,
            "diversity_score": self.diversity_score,
            "priority_score": self.priority_score,
            "created_at": self.created_at.isoformat(),
        }


@dataclass
class Annotation:
    """
    Annotazione completata da un utente.

    Attributes:
        sample_id: ID del sample annotato
        annotator_id: ID dell'annotatore
        has_disagreement: Risposta a "c'e' disagreement?"
        disagreement_type: Tipo selezionato
        disagreement_level: Livello selezionato
        intensity: Intensita' (scala 1-5 -> normalizzata [0-1])
        resolvability: Risolvibilita' (scala 1-5 -> normalizzata [0-1])
        explanation: Spiegazione testuale
        completed_at: Timestamp completamento
        time_spent_seconds: Tempo speso per annotare
    """
    sample_id: str
    annotator_id: str
    has_disagreement: bool
    disagreement_type: Optional[DisagreementType] = None
    disagreement_level: Optional[DisagreementLevel] = None
    intensity: Optional[float] = None
    resolvability: Optional[float] = None
    explanation: Optional[str] = None
    completed_at: datetime = field(default_factory=datetime.now)
    time_spent_seconds: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sample_id": self.sample_id,
            "annotator_id": self.annotator_id,
            "has_disagreement": self.has_disagreement,
            "disagreement_type": self.disagreement_type.value if self.disagreement_type else None,
            "disagreement_level": self.disagreement_level.value if self.disagreement_level else None,
            "intensity": self.intensity,
            "resolvability": self.resolvability,
            "explanation": self.explanation,
            "completed_at": self.completed_at.isoformat(),
            "time_spent_seconds": self.time_spent_seconds,
        }


# =============================================================================
# CONSTANTS: Matrice Tipo x Livello (frequenze attese)
# =============================================================================

TYPE_LEVEL_FREQUENCY = {
    # Matrice che indica quanto e' comune ogni combinazione tipo-livello
    # 0 = raro, 1 = comune, 2 = molto comune
    DisagreementType.ANTINOMY: {
        DisagreementLevel.SEMANTIC: 0,
        DisagreementLevel.SYSTEMIC: 1,
        DisagreementLevel.TELEOLOGICAL: 0,
        DisagreementLevel.APPLICATIVE: 1,
    },
    DisagreementType.INTERPRETIVE_GAP: {
        DisagreementLevel.SEMANTIC: 2,
        DisagreementLevel.SYSTEMIC: 1,
        DisagreementLevel.TELEOLOGICAL: 1,
        DisagreementLevel.APPLICATIVE: 1,
    },
    DisagreementType.METHODOLOGICAL: {
        DisagreementLevel.SEMANTIC: 1,
        DisagreementLevel.SYSTEMIC: 1,
        DisagreementLevel.TELEOLOGICAL: 2,
        DisagreementLevel.APPLICATIVE: 1,
    },
    DisagreementType.OVERRULING: {
        DisagreementLevel.SEMANTIC: 0,
        DisagreementLevel.SYSTEMIC: 0,
        DisagreementLevel.TELEOLOGICAL: 0,
        DisagreementLevel.APPLICATIVE: 2,
    },
    DisagreementType.HIERARCHICAL: {
        DisagreementLevel.SEMANTIC: 0,
        DisagreementLevel.SYSTEMIC: 1,
        DisagreementLevel.TELEOLOGICAL: 2,
        DisagreementLevel.APPLICATIVE: 0,
    },
    DisagreementType.SPECIALIZATION: {
        DisagreementLevel.SEMANTIC: 1,
        DisagreementLevel.SYSTEMIC: 2,
        DisagreementLevel.TELEOLOGICAL: 1,
        DisagreementLevel.APPLICATIVE: 1,
    },
}


# =============================================================================
# CONSTANTS: Expert Names
# =============================================================================

EXPERT_NAMES = ["literal", "systemic", "principles", "precedent"]

EXPERT_DISPLAY_NAMES = {
    "literal": "LiteralExpert",
    "systemic": "SystemicExpert",
    "principles": "PrinciplesExpert",
    "precedent": "PrecedentExpert",
}

# Coppie di expert per pairwise comparison (6 coppie)
EXPERT_PAIRS = [
    ("literal", "systemic"),
    ("literal", "principles"),
    ("literal", "precedent"),
    ("systemic", "principles"),
    ("systemic", "precedent"),
    ("principles", "precedent"),
]
