"""
Statistics API Models
=====================

Modelli Pydantic per statistiche accademiche di MERL-T.
Fornisce modelli per hypothesis testing, distribuzioni, correlazioni e export.

Progettato per rigore accademico:
- p-values
- effect sizes (Cohen's d, eta squared, r)
- confidence intervals
- degrees of freedom
"""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any, Literal

from pydantic import BaseModel, Field


# =============================================================================
# ENUMS
# =============================================================================


class TestType(str, Enum):
    """Tipo di test statistico."""
    T_TEST = "t-test"
    PAIRED_T_TEST = "paired-t-test"
    ANOVA = "anova"
    MANN_WHITNEY = "mann-whitney"
    WILCOXON = "wilcoxon"
    CORRELATION = "correlation"
    CHI_SQUARE = "chi-square"


class EffectSizeType(str, Enum):
    """Tipo di effect size."""
    COHENS_D = "cohens_d"
    HEDGES_G = "hedges_g"
    ETA_SQUARED = "eta_squared"
    PARTIAL_ETA_SQUARED = "partial_eta_squared"
    R = "r"
    R_SQUARED = "r_squared"
    CRAMERS_V = "cramers_v"


class SignificanceLevel(str, Enum):
    """Livello di significatività."""
    NS = "ns"       # p >= 0.05
    STAR = "*"      # p < 0.05
    STAR2 = "**"    # p < 0.01
    STAR3 = "***"   # p < 0.001


class EffectInterpretation(str, Enum):
    """Interpretazione effect size secondo Cohen."""
    NEGLIGIBLE = "negligible"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"


class ExportFormat(str, Enum):
    """Formato di export."""
    CSV = "csv"
    JSON = "json"
    LATEX = "latex"


# =============================================================================
# HYPOTHESIS TEST MODELS
# =============================================================================


class DescriptiveStats(BaseModel):
    """Statistiche descrittive per un gruppo.

    Attributes:
        mean: Media
        std: Deviazione standard
        n: Numerosità campionaria
        median: Mediana
        min_val: Valore minimo
        max_val: Valore massimo
        ci_lower: Limite inferiore CI 95%
        ci_upper: Limite superiore CI 95%
    """
    mean: float
    std: float
    n: int
    median: Optional[float] = None
    min_val: Optional[float] = None
    max_val: Optional[float] = None
    ci_lower: Optional[float] = None
    ci_upper: Optional[float] = None


class EffectSize(BaseModel):
    """Effect size con interpretazione.

    Attributes:
        value: Valore dell'effect size
        type: Tipo (Cohen's d, eta squared, etc.)
        interpretation: Interpretazione (small, medium, large)
        ci_lower: Limite inferiore CI 95%
        ci_upper: Limite superiore CI 95%
    """
    value: float
    type: EffectSizeType
    interpretation: EffectInterpretation
    ci_lower: Optional[float] = None
    ci_upper: Optional[float] = None


class HypothesisTestResult(BaseModel):
    """Risultato completo di un test di ipotesi.

    Attributes:
        hypothesis_id: Identificativo (H1, H2, etc.)
        description: Descrizione dell'ipotesi
        pre_stats: Statistiche descrittive pre-intervention
        post_stats: Statistiche descrittive post-intervention
        delta: Differenza (post - pre)
        test_type: Tipo di test usato
        statistic: Valore della statistica test (t, F, U, r)
        df: Gradi di libertà
        p_value: p-value
        effect_size: Effect size con CI
        ci_level: Livello di confidenza (default 0.95)
        ci_lower: CI della differenza - limite inferiore
        ci_upper: CI della differenza - limite superiore
        supported: Se l'ipotesi è supportata (p < alpha)
        significance: Livello di significatività (*, **, ***)
        notes: Note aggiuntive
    """
    hypothesis_id: str = Field(..., description="Es. 'H1', 'H2'")
    description: str

    # Statistiche descrittive
    pre_stats: Optional[DescriptiveStats] = None
    post_stats: Optional[DescriptiveStats] = None
    delta: Optional[float] = None

    # Test statistico
    test_type: TestType
    statistic: float = Field(..., description="t, F, U, r, chi2")
    df: Optional[int] = Field(None, description="Gradi di libertà")
    df2: Optional[int] = Field(None, description="Secondo df per ANOVA")
    p_value: float

    # Effect size
    effect_size: EffectSize

    # Confidence interval
    ci_level: float = 0.95
    ci_lower: Optional[float] = None
    ci_upper: Optional[float] = None

    # Conclusione
    supported: bool
    significance: SignificanceLevel

    # Metadata
    notes: Optional[str] = None
    computed_at: datetime = Field(default_factory=datetime.now)


class HypothesisTestSummary(BaseModel):
    """Summary di tutti i test di ipotesi.

    Attributes:
        tests: Lista risultati test
        supported_count: Numero ipotesi supportate
        total_count: Numero totale ipotesi
        alpha: Livello di significatività usato
    """
    tests: List[HypothesisTestResult] = Field(default_factory=list)
    supported_count: int = 0
    total_count: int = 0
    alpha: float = 0.05


# =============================================================================
# DISTRIBUTION MODELS
# =============================================================================


class DistributionData(BaseModel):
    """Dati per un istogramma/distribuzione.

    Attributes:
        name: Nome della distribuzione
        values: Valori grezzi (per calcoli)
        bins: Confini dei bin per istogramma
        counts: Conteggi per bin
        mean: Media
        std: Deviazione standard
        median: Mediana
        skewness: Asimmetria
        kurtosis: Curtosi
    """
    name: str
    values: Optional[List[float]] = None  # Raw values
    bins: List[float] = Field(default_factory=list)
    counts: List[int] = Field(default_factory=list)
    mean: float = 0.0
    std: float = 0.0
    median: float = 0.0
    skewness: float = 0.0
    kurtosis: float = 0.0
    n: int = 0


class NormalityTest(BaseModel):
    """Test di normalità.

    Attributes:
        test_name: Nome test (Shapiro-Wilk, Kolmogorov-Smirnov)
        statistic: Valore statistica test
        p_value: p-value
        is_normal: Se la distribuzione è normale (p > 0.05)
    """
    test_name: str = "Shapiro-Wilk"
    statistic: float = 0.0
    p_value: float = 0.0
    is_normal: bool = True


class DistributionAnalysis(BaseModel):
    """Analisi completa di una distribuzione.

    Attributes:
        distribution: Dati distribuzione
        normality_test: Test di normalità
        percentiles: Percentili chiave
    """
    distribution: DistributionData
    normality_test: Optional[NormalityTest] = None
    percentiles: Dict[str, float] = Field(default_factory=dict)  # "25": 0.3, "50": 0.5


# =============================================================================
# CORRELATION MODELS
# =============================================================================


class CorrelationPair(BaseModel):
    """Singola correlazione tra due variabili.

    Attributes:
        var1: Nome prima variabile
        var2: Nome seconda variabile
        r: Coefficiente di correlazione
        p_value: p-value
        n: Numerosità
        significance: Livello significatività
    """
    var1: str
    var2: str
    r: float
    p_value: float
    n: int
    significance: SignificanceLevel


class CorrelationMatrix(BaseModel):
    """Matrice di correlazione completa.

    Attributes:
        variables: Lista nomi variabili
        matrix: Matrice dei valori r (lista di liste)
        p_values: Matrice dei p-values
        significant_pairs: Liste coppie significative
    """
    variables: List[str] = Field(default_factory=list)
    matrix: List[List[float]] = Field(default_factory=list)
    p_values: List[List[float]] = Field(default_factory=list)
    significant_pairs: List[CorrelationPair] = Field(default_factory=list)


# =============================================================================
# RLCF SPECIFIC STATISTICS
# =============================================================================


class TrainingMetrics(BaseModel):
    """Metriche di training per epoch.

    Attributes:
        epoch: Numero epoch
        loss: Loss value
        accuracy: Accuracy
        learning_rate: Learning rate
        timestamp: Quando registrato
    """
    epoch: int
    loss: float
    accuracy: Optional[float] = None
    learning_rate: float
    timestamp: datetime = Field(default_factory=datetime.now)


class PolicyWeights(BaseModel):
    """Pesi della GatingPolicy.

    Attributes:
        literal: Peso LiteralExpert
        systemic: Peso SystemicExpert
        principles: Peso PrinciplesExpert
        precedent: Peso PrecedentExpert
        timestamp: Quando registrato
    """
    literal: float = 0.25
    systemic: float = 0.25
    principles: float = 0.25
    precedent: float = 0.25
    timestamp: datetime = Field(default_factory=datetime.now)


class AuthorityDistribution(BaseModel):
    """Distribuzione authority degli utenti.

    Attributes:
        novizio: Conteggio tier Novizio (0.0-0.25)
        contributore: Conteggio tier Contributore (0.25-0.50)
        esperto: Conteggio tier Esperto (0.50-0.75)
        autorita: Conteggio tier Autorità (0.75-1.0)
        mean_authority: Authority media
        std_authority: Deviazione standard
    """
    novizio: int = 0
    contributore: int = 0
    esperto: int = 0
    autorita: int = 0
    mean_authority: float = 0.0
    std_authority: float = 0.0


# =============================================================================
# EXPORT MODELS
# =============================================================================


class ExportRequest(BaseModel):
    """Request per export statistiche.

    Attributes:
        format: Formato di export
        include_hypothesis_tests: Includere test ipotesi
        include_descriptive_stats: Includere statistiche descrittive
        include_raw_data: Includere dati grezzi
        include_confidence_intervals: Includere CI
        include_effect_sizes: Includere effect sizes
        date_range_start: Data inizio (opzionale)
        date_range_end: Data fine (opzionale)
    """
    format: ExportFormat = ExportFormat.JSON
    include_hypothesis_tests: bool = True
    include_descriptive_stats: bool = True
    include_raw_data: bool = False
    include_confidence_intervals: bool = True
    include_effect_sizes: bool = True
    date_range_start: Optional[datetime] = None
    date_range_end: Optional[datetime] = None


class ExportResponse(BaseModel):
    """Response con file esportato.

    Attributes:
        success: Se l'export è riuscito
        format: Formato usato
        download_url: URL per scaricare il file
        filename: Nome del file
        file_size_kb: Dimensione in KB
        records_count: Numero di record esportati
        message: Messaggio descrittivo
    """
    success: bool
    format: ExportFormat
    download_url: Optional[str] = None
    filename: str = ""
    file_size_kb: Optional[float] = None
    records_count: int = 0
    message: str = ""


# =============================================================================
# COMPLETE STATISTICS RESPONSE
# =============================================================================


class StatisticsOverview(BaseModel):
    """Overview completo delle statistiche accademiche.

    Attributes:
        hypothesis_tests: Risultati test ipotesi
        distributions: Analisi distribuzioni
        correlations: Matrice correlazioni
        training_history: Storia training RLCF
        policy_weights: Pesi correnti policy
        authority_distribution: Distribuzione authority
        last_computed: Quando calcolato
    """
    hypothesis_tests: HypothesisTestSummary = Field(default_factory=HypothesisTestSummary)
    distributions: Dict[str, DistributionAnalysis] = Field(default_factory=dict)
    correlations: CorrelationMatrix = Field(default_factory=CorrelationMatrix)
    training_history: List[TrainingMetrics] = Field(default_factory=list)
    policy_weights: PolicyWeights = Field(default_factory=PolicyWeights)
    authority_distribution: AuthorityDistribution = Field(default_factory=AuthorityDistribution)
    last_computed: datetime = Field(default_factory=datetime.now)


# =============================================================================
# EXPORTS
# =============================================================================


__all__ = [
    # Enums
    "TestType",
    "EffectSizeType",
    "SignificanceLevel",
    "EffectInterpretation",
    "ExportFormat",
    # Descriptive stats
    "DescriptiveStats",
    "EffectSize",
    # Hypothesis testing
    "HypothesisTestResult",
    "HypothesisTestSummary",
    # Distributions
    "DistributionData",
    "NormalityTest",
    "DistributionAnalysis",
    # Correlations
    "CorrelationPair",
    "CorrelationMatrix",
    # RLCF specific
    "TrainingMetrics",
    "PolicyWeights",
    "AuthorityDistribution",
    # Export
    "ExportRequest",
    "ExportResponse",
    # Complete response
    "StatisticsOverview",
]
