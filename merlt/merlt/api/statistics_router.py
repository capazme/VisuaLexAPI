"""
Statistics Router
=================

Endpoints REST per statistiche accademiche di MERL-T.

Fornisce accesso a:
- Test di ipotesi (H1-H4) con p-values, effect sizes, CI
- Distribuzioni (feedback, authority, accuracy)
- Matrice di correlazione
- Export in CSV, JSON, LaTeX

NOTA: Attualmente restituisce dati vuoti/default.
      Per popolare i dati, implementare raccolta e analisi statistica dei dati RLCF.

Endpoints:
- GET /statistics/overview - Tutte le statistiche
- GET /statistics/hypothesis-tests - Solo test ipotesi
- GET /statistics/distributions - Distribuzioni
- GET /statistics/correlations - Matrice correlazione
- POST /statistics/export - Export in vari formati

Example:
    >>> response = await client.get("/api/v1/statistics/hypothesis-tests")
    >>> tests = response.json()
    >>> for h in tests["tests"]:
    ...     print(f"{h['hypothesis_id']}: p={h['p_value']:.4f} {h['significance']}")
"""

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List

import structlog
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey

from merlt.api.models.statistics_models import (
    TestType,
    EffectSizeType,
    SignificanceLevel,
    EffectInterpretation,
    ExportFormat,
    DescriptiveStats,
    EffectSize,
    HypothesisTestResult,
    HypothesisTestSummary,
    DistributionData,
    NormalityTest,
    DistributionAnalysis,
    CorrelationPair,
    CorrelationMatrix,
    TrainingMetrics,
    PolicyWeights,
    AuthorityDistribution,
    ExportRequest,
    ExportResponse,
    StatisticsOverview,
)

log = structlog.get_logger()

router = APIRouter(prefix="/statistics", tags=["statistics"])

# Export directory
EXPORT_DIR = Path("exports")
EXPORT_DIR.mkdir(exist_ok=True)


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def _interpret_effect_size(value: float, effect_type: EffectSizeType) -> EffectInterpretation:
    """Interpreta effect size secondo le convenzioni di Cohen."""
    abs_value = abs(value)

    if effect_type in [EffectSizeType.COHENS_D, EffectSizeType.HEDGES_G]:
        if abs_value < 0.2:
            return EffectInterpretation.NEGLIGIBLE
        elif abs_value < 0.5:
            return EffectInterpretation.SMALL
        elif abs_value < 0.8:
            return EffectInterpretation.MEDIUM
        else:
            return EffectInterpretation.LARGE

    elif effect_type in [EffectSizeType.ETA_SQUARED, EffectSizeType.PARTIAL_ETA_SQUARED]:
        if abs_value < 0.01:
            return EffectInterpretation.NEGLIGIBLE
        elif abs_value < 0.06:
            return EffectInterpretation.SMALL
        elif abs_value < 0.14:
            return EffectInterpretation.MEDIUM
        else:
            return EffectInterpretation.LARGE

    elif effect_type in [EffectSizeType.R, EffectSizeType.CRAMERS_V]:
        if abs_value < 0.1:
            return EffectInterpretation.NEGLIGIBLE
        elif abs_value < 0.3:
            return EffectInterpretation.SMALL
        elif abs_value < 0.5:
            return EffectInterpretation.MEDIUM
        else:
            return EffectInterpretation.LARGE

    return EffectInterpretation.MEDIUM


def _get_significance_level(p_value: float) -> SignificanceLevel:
    """Determina il livello di significatività."""
    if p_value < 0.001:
        return SignificanceLevel.STAR3
    elif p_value < 0.01:
        return SignificanceLevel.STAR2
    elif p_value < 0.05:
        return SignificanceLevel.STAR
    else:
        return SignificanceLevel.NS


def _get_empty_hypothesis_tests() -> HypothesisTestSummary:
    """
    Restituisce struttura vuota per i test di ipotesi.

    TODO: Implementare calcolo statistico reale quando dati disponibili.
    """
    # Placeholder hypothesis tests con valori vuoti
    empty_stats = DescriptiveStats(
        mean=0.0, std=0.0, n=0,
        ci_lower=0.0, ci_upper=0.0,
    )

    empty_effect = EffectSize(
        value=0.0,
        type=EffectSizeType.COHENS_D,
        interpretation=EffectInterpretation.NEGLIGIBLE,
        ci_lower=0.0,
        ci_upper=0.0,
    )

    tests = [
        HypothesisTestResult(
            hypothesis_id="H1",
            description="RLCF training improves expert routing accuracy",
            pre_stats=empty_stats,
            post_stats=empty_stats,
            delta=0.0,
            test_type=TestType.PAIRED_T_TEST,
            statistic=0.0,
            df=0,
            p_value=1.0,
            effect_size=empty_effect,
            ci_lower=0.0,
            ci_upper=0.0,
            supported=False,
            significance=SignificanceLevel.NS,
            notes="Dati insufficienti per il test",
        ),
        HypothesisTestResult(
            hypothesis_id="H2",
            description="User authority correlates with feedback quality",
            test_type=TestType.CORRELATION,
            statistic=0.0,
            df=0,
            p_value=1.0,
            effect_size=empty_effect,
            supported=False,
            significance=SignificanceLevel.NS,
            notes="Dati insufficienti per il test",
        ),
        HypothesisTestResult(
            hypothesis_id="H3",
            description="Multi-expert outperforms single-expert baseline",
            pre_stats=empty_stats,
            post_stats=empty_stats,
            delta=0.0,
            test_type=TestType.ANOVA,
            statistic=0.0,
            df=0,
            p_value=1.0,
            effect_size=empty_effect,
            ci_lower=0.0,
            ci_upper=0.0,
            supported=False,
            significance=SignificanceLevel.NS,
            notes="Dati insufficienti per il test",
        ),
        HypothesisTestResult(
            hypothesis_id="H4",
            description="Feedback diversity improves generalization",
            pre_stats=empty_stats,
            post_stats=empty_stats,
            delta=0.0,
            test_type=TestType.MANN_WHITNEY,
            statistic=0.0,
            p_value=1.0,
            effect_size=empty_effect,
            ci_lower=0.0,
            ci_upper=0.0,
            supported=False,
            significance=SignificanceLevel.NS,
            notes="Dati insufficienti per il test",
        ),
    ]

    return HypothesisTestSummary(
        tests=tests,
        supported_count=0,
        total_count=len(tests),
        alpha=0.05,
    )


def _get_empty_distributions() -> Dict[str, DistributionAnalysis]:
    """
    Restituisce distribuzioni vuote.

    TODO: Implementare analisi distributiva reale quando dati disponibili.
    """
    empty_dist = DistributionData(
        name="No data",
        bins=[],
        counts=[],
        mean=0.0,
        std=0.0,
        median=0.0,
        skewness=0.0,
        kurtosis=0.0,
        n=0,
    )

    empty_normality = NormalityTest(
        test_name="Shapiro-Wilk",
        statistic=0.0,
        p_value=1.0,
        is_normal=False,
    )

    empty_analysis = DistributionAnalysis(
        distribution=empty_dist,
        normality_test=empty_normality,
        percentiles={},
    )

    return {
        "feedback_scores": empty_analysis,
        "authority": empty_analysis,
        "accuracy": empty_analysis,
    }


def _get_empty_correlations() -> CorrelationMatrix:
    """
    Restituisce matrice di correlazione vuota.

    TODO: Implementare calcolo correlazioni quando dati disponibili.
    """
    variables = ["Authority", "Accuracy", "Feedback", "Latency"]

    # Empty identity matrix
    matrix = [[1.0 if i == j else 0.0 for j in range(4)] for i in range(4)]
    p_values = [[0.0 if i == j else 1.0 for j in range(4)] for i in range(4)]

    return CorrelationMatrix(
        variables=variables,
        matrix=matrix,
        p_values=p_values,
        significant_pairs=[],
    )


def _generate_latex_tables(summary: HypothesisTestSummary) -> str:
    """Genera tabelle LaTeX per i test di ipotesi."""
    latex = r"""
\begin{table}[htbp]
\centering
\caption{Risultati Test di Ipotesi}
\label{tab:hypothesis-tests}
\begin{tabular}{lcccccc}
\toprule
Ipotesi & Test & Statistica & df & p-value & Effect Size & Supportata \\
\midrule
"""
    for test in summary.tests:
        es_val = f"{test.effect_size.value:.2f}"
        es_type = test.effect_size.type.value.replace("_", " ")
        sig = test.significance.value

        latex += f"{test.hypothesis_id} & {test.test_type.value} & {test.statistic:.2f} & "
        latex += f"{test.df or '-'} & {test.p_value:.4f}{sig} & {es_val} ({es_type}) & "
        latex += f"{'Sì' if test.supported else 'No'} \\\\\n"

    latex += r"""\bottomrule
\end{tabular}
\end{table}

\begin{table}[htbp]
\centering
\caption{Effect Sizes e Intervalli di Confidenza}
\label{tab:effect-sizes}
\begin{tabular}{lccc}
\toprule
Ipotesi & Effect Size & 95\% CI & Interpretazione \\
\midrule
"""
    for test in summary.tests:
        es = test.effect_size
        ci = f"[{es.ci_lower:.2f}, {es.ci_upper:.2f}]" if es.ci_lower else "-"
        latex += f"{test.hypothesis_id} & {es.value:.2f} ({es.type.value}) & {ci} & {es.interpretation.value} \\\\\n"

    latex += r"""\bottomrule
\end{tabular}
\end{table}
"""
    return latex


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/overview", response_model=StatisticsOverview)
async def get_statistics_overview(
    api_key: ApiKey = Depends(verify_api_key),
) -> StatisticsOverview:
    """
    Recupera tutte le statistiche accademiche.

    NOTA: Attualmente restituisce dati vuoti.
          Per popolare i dati, implementare raccolta statistiche RLCF.

    Returns:
        StatisticsOverview con hypothesis tests, distribuzioni, correlazioni

    Example:
        >>> GET /api/v1/statistics/overview
        {
          "hypothesis_tests": {"tests": [...], "supported_count": 0},
          "distributions": {...},
          "correlations": {...}
        }
    """
    log.warning("Statistics endpoints return empty data — RLCF data collection not yet implemented")

    hypothesis_tests = _get_empty_hypothesis_tests()
    distributions = _get_empty_distributions()
    correlations = _get_empty_correlations()

    # Empty training history
    training_history: List[TrainingMetrics] = []

    # Default policy weights
    policy_weights = PolicyWeights(
        literal=0.25,
        systemic=0.25,
        principles=0.25,
        precedent=0.25,
    )

    # Empty authority distribution
    authority_dist = AuthorityDistribution(
        novizio=0,
        contributore=0,
        esperto=0,
        autorita=0,
        mean_authority=0.0,
        std_authority=0.0,
    )

    return StatisticsOverview(
        hypothesis_tests=hypothesis_tests,
        distributions=distributions,
        correlations=correlations,
        training_history=training_history,
        policy_weights=policy_weights,
        authority_distribution=authority_dist,
        last_computed=datetime.now(),
    )


@router.get("/hypothesis-tests", response_model=HypothesisTestSummary)
async def get_hypothesis_tests(
    api_key: ApiKey = Depends(verify_api_key),
) -> HypothesisTestSummary:
    """
    Recupera risultati dei test di ipotesi H1-H4.

    NOTA: Attualmente restituisce test con dati insufficienti.
          Per popolare i dati, implementare raccolta statistiche RLCF.

    Returns:
        HypothesisTestSummary con dettagli statistici

    Example:
        >>> GET /api/v1/statistics/hypothesis-tests
        {
          "tests": [
            {
              "hypothesis_id": "H1",
              "description": "RLCF training improves expert routing accuracy",
              "p_value": 1.0,
              "supported": false,
              "significance": "ns"
            },
            ...
          ],
          "supported_count": 0,
          "total_count": 4
        }
    """
    log.info("Getting hypothesis tests")
    return _get_empty_hypothesis_tests()


@router.get("/distributions")
async def get_distributions(
    api_key: ApiKey = Depends(verify_api_key),
) -> Dict[str, DistributionAnalysis]:
    """
    Recupera analisi delle distribuzioni.

    NOTA: Attualmente restituisce distribuzioni vuote.

    Returns:
        Dict con distribuzioni per feedback_scores, authority, accuracy

    Example:
        >>> GET /api/v1/statistics/distributions
        {
          "feedback_scores": {
            "distribution": {"mean": 0.0, "std": 0.0, "n": 0, ...},
            "normality_test": {"p_value": 1.0, "is_normal": false}
          },
          ...
        }
    """
    log.info("Getting distributions")
    return _get_empty_distributions()


@router.get("/correlations", response_model=CorrelationMatrix)
async def get_correlations(
    api_key: ApiKey = Depends(verify_api_key),
) -> CorrelationMatrix:
    """
    Recupera matrice di correlazione.

    NOTA: Attualmente restituisce matrice vuota.

    Returns:
        CorrelationMatrix con r, p-values e coppie significative

    Example:
        >>> GET /api/v1/statistics/correlations
        {
          "variables": ["Authority", "Accuracy", "Feedback", "Latency"],
          "matrix": [[1.0, 0.0, ...], ...],
          "significant_pairs": []
        }
    """
    log.info("Getting correlations")
    return _get_empty_correlations()


@router.post("/export", response_model=ExportResponse)
async def export_statistics(
    request: ExportRequest,
    api_key: ApiKey = Depends(verify_api_key),
) -> ExportResponse:
    """
    Esporta statistiche in vari formati.

    Args:
        request: ExportRequest con formato e opzioni

    Returns:
        ExportResponse con URL per download

    Example:
        >>> POST /api/v1/statistics/export
        >>> {"format": "latex", "include_hypothesis_tests": true}
        {
          "success": true,
          "download_url": "/api/v1/statistics/download/export_abc123.tex",
          "format": "latex"
        }
    """
    log.info("Exporting statistics", format=request.format)

    # Generate data
    overview = await get_statistics_overview()

    # Generate export
    export_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    if request.format == ExportFormat.JSON:
        filename = f"merl_t_statistics_{timestamp}_{export_id}.json"
        filepath = EXPORT_DIR / filename

        export_data = {
            "exported_at": datetime.now().isoformat(),
            "note": "Dati vuoti - statistiche non ancora raccolte",
            "hypothesis_tests": [t.model_dump() for t in overview.hypothesis_tests.tests] if request.include_hypothesis_tests else [],
            "distributions": {k: v.model_dump() for k, v in overview.distributions.items()} if request.include_descriptive_stats else {},
            "correlations": overview.correlations.model_dump() if request.include_descriptive_stats else {},
            "training_history": [t.model_dump() for t in overview.training_history] if request.include_raw_data else [],
        }

        with open(filepath, "w") as f:
            json.dump(export_data, f, indent=2, default=str)

    elif request.format == ExportFormat.CSV:
        filename = f"merl_t_statistics_{timestamp}_{export_id}.csv"
        filepath = EXPORT_DIR / filename

        # CSV with hypothesis tests
        lines = ["hypothesis_id,description,test_type,statistic,df,p_value,effect_size,effect_type,supported,significance"]
        for test in overview.hypothesis_tests.tests:
            line = f"{test.hypothesis_id},{test.description},{test.test_type.value},"
            line += f"{test.statistic},{test.df or ''},{test.p_value},"
            line += f"{test.effect_size.value},{test.effect_size.type.value},"
            line += f"{test.supported},{test.significance.value}"
            lines.append(line)

        with open(filepath, "w") as f:
            f.write("\n".join(lines))

    elif request.format == ExportFormat.LATEX:
        filename = f"merl_t_statistics_{timestamp}_{export_id}.tex"
        filepath = EXPORT_DIR / filename

        latex_content = _generate_latex_tables(overview.hypothesis_tests)

        with open(filepath, "w") as f:
            f.write(latex_content)

    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {request.format}")

    file_size_kb = filepath.stat().st_size / 1024

    return ExportResponse(
        success=True,
        format=request.format,
        download_url=f"/api/v1/statistics/download/{filename}",
        filename=filename,
        file_size_kb=file_size_kb,
        records_count=len(overview.hypothesis_tests.tests),
        message=f"Export {request.format.value} generato con successo (dati vuoti)",
    )


@router.get("/download/{filename}")
async def download_export(
    filename: str,
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Download file esportato.

    Args:
        filename: Nome del file da scaricare

    Returns:
        FileResponse con il file

    Example:
        >>> GET /api/v1/statistics/download/merl_t_statistics_20260109.json
    """
    filepath = EXPORT_DIR / filename

    if not filepath.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")

    # Determine media type
    if filename.endswith(".json"):
        media_type = "application/json"
    elif filename.endswith(".csv"):
        media_type = "text/csv"
    elif filename.endswith(".tex"):
        media_type = "application/x-latex"
    else:
        media_type = "application/octet-stream"

    return FileResponse(
        path=filepath,
        filename=filename,
        media_type=media_type,
    )
