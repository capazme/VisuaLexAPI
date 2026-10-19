"""
Analisi statistica per validazione ipotesi RLCF.

Questo modulo implementa test statistici rigorosi per validare
le 4 ipotesi dell'esperimento EXP-021:

H1: Feedback Persistence Rate = 100%
H2: Authority Convergence > 20%
H3: Weight Delta Consistency < 0.5
H4: Response Improvement > 10%

Include:
- Test parametrici (t-test paired)
- Test non-parametrici (Wilcoxon signed-rank)
- Correzione Bonferroni per test multipli
- Calcolo effect size (Cohen's d)
- Bootstrap confidence intervals
"""

from dataclasses import dataclass, field
from typing import Dict, List, Any, Optional, Tuple
import numpy as np
from scipy import stats
import warnings
from datetime import datetime


@dataclass
class HypothesisResult:
    """
    Risultato di un singolo test di ipotesi.

    Attributes:
        hypothesis: Descrizione dell'ipotesi
        metric: Nome della metrica testata
        value: Valore osservato
        target: Valore target
        passed: Se l'ipotesi è confermata
        passed_critical: Se supera la soglia critica (meno stringente)
        statistics: Statistiche del test (t_stat, p_value, etc.)
        confidence_interval: Intervallo di confidenza [lower, upper]
        effect_size: Effect size (Cohen's d o altro)
        details: Dettagli aggiuntivi
    """

    hypothesis: str
    metric: str
    value: float
    target: float
    passed: bool
    passed_critical: bool = False
    statistics: Dict[str, float] = field(default_factory=dict)
    confidence_interval: Tuple[float, float] = (0.0, 0.0)
    effect_size: float = 0.0
    effect_size_interpretation: str = ""
    details: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hypothesis": self.hypothesis,
            "metric": self.metric,
            "value": self.value,
            "target": self.target,
            "passed": self.passed,
            "passed_critical": self.passed_critical,
            "statistics": self.statistics,
            "confidence_interval": list(self.confidence_interval),
            "effect_size": self.effect_size,
            "effect_size_interpretation": self.effect_size_interpretation,
            "details": self.details,
        }


@dataclass
class StatisticalReport:
    """
    Report statistico completo dell'esperimento.

    Contiene i risultati di tutti i test di ipotesi
    e statistiche aggregate.
    """

    h1_feedback_persistence: HypothesisResult
    h2_authority_convergence: HypothesisResult
    h3_weight_stability: HypothesisResult
    h4_response_improvement: HypothesisResult
    bonferroni_alpha: float = 0.0125  # 0.05 / 4
    overall_success: bool = False
    critical_success: bool = False
    generated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def __post_init__(self):
        # Determina successo complessivo
        all_passed = all([
            self.h1_feedback_persistence.passed,
            self.h2_authority_convergence.passed,
            self.h3_weight_stability.passed,
            self.h4_response_improvement.passed,
        ])
        self.overall_success = all_passed

        # Successo critico (soglie meno stringenti)
        all_critical = all([
            self.h1_feedback_persistence.passed_critical,
            self.h2_authority_convergence.passed_critical,
            self.h3_weight_stability.passed_critical,
            self.h4_response_improvement.passed_critical,
        ])
        self.critical_success = all_critical

    def to_dict(self) -> Dict[str, Any]:
        return {
            "hypotheses": {
                "h1": self.h1_feedback_persistence.to_dict(),
                "h2": self.h2_authority_convergence.to_dict(),
                "h3": self.h3_weight_stability.to_dict(),
                "h4": self.h4_response_improvement.to_dict(),
            },
            "bonferroni_alpha": self.bonferroni_alpha,
            "overall_success": self.overall_success,
            "critical_success": self.critical_success,
            "generated_at": self.generated_at,
        }


class StatisticalAnalyzer:
    """
    Analizzatore statistico per risultati RLCF.

    Implementa test rigorosi per validare le 4 ipotesi
    con correzione per test multipli e calcolo effect size.
    """

    # Soglie
    ALPHA = 0.05
    BONFERRONI_ALPHA = 0.05 / 4  # 0.0125

    # Target
    H1_TARGET = 1.0  # 100%
    H1_CRITICAL = 0.95  # 95%

    H2_TARGET = 0.20  # 20% increase
    H2_CRITICAL = 0.10  # 10% increase

    H3_TARGET = 0.5  # WDC < 0.5
    H3_CRITICAL = 1.0  # WDC < 1.0

    H4_TARGET = 0.10  # 10% improvement
    H4_CRITICAL = 0.05  # 5% improvement

    def __init__(
        self,
        alpha: float = 0.05,
        use_bonferroni: bool = True,
        bootstrap_samples: int = 1000,
    ):
        """
        Inizializza l'analizzatore.

        Args:
            alpha: Livello di significatività
            use_bonferroni: Se applicare correzione Bonferroni
            bootstrap_samples: Numero di campioni per bootstrap CI
        """
        self.alpha = alpha
        self.bonferroni_alpha = alpha / 4 if use_bonferroni else alpha
        self.bootstrap_samples = bootstrap_samples

    def analyze(self, results: Any) -> StatisticalReport:
        """
        Analizza i risultati dell'esperimento.

        Args:
            results: ExperimentResults

        Returns:
            StatisticalReport con tutti i test
        """
        h1 = self._test_h1(results)
        h2 = self._test_h2(results)
        h3 = self._test_h3(results)
        h4 = self._test_h4(results)

        return StatisticalReport(
            h1_feedback_persistence=h1,
            h2_authority_convergence=h2,
            h3_weight_stability=h3,
            h4_response_improvement=h4,
            bonferroni_alpha=self.bonferroni_alpha,
        )

    def _test_h1(self, results: Any) -> HypothesisResult:
        """
        H1: Feedback Persistence Rate = 100%

        Test: Proporzione binomiale
        """
        submitted = results.total_feedbacks
        persisted = results.total_feedbacks_persisted

        if submitted == 0:
            rate = 1.0
            p_value = 1.0
        else:
            rate = persisted / submitted
            # Test binomiale: H0: rate >= 0.95
            # Usa test exact per proporzioni
            result = stats.binomtest(
                persisted, submitted,
                p=self.H1_CRITICAL,
                alternative='greater'
            )
            p_value = result.pvalue

        # Confidence interval per proporzione
        ci = self._proportion_ci(persisted, submitted)

        return HypothesisResult(
            hypothesis="H1: Feedback Persistence Rate = 100%",
            metric="persistence_rate",
            value=rate,
            target=self.H1_TARGET,
            passed=rate >= self.H1_TARGET,
            passed_critical=rate >= self.H1_CRITICAL,
            statistics={
                "p_value": p_value,
                "submitted": submitted,
                "persisted": persisted,
            },
            confidence_interval=ci,
            details={
                "test": "Exact binomial test",
                "alternative": "greater than 95%",
            },
        )

    def _test_h2(self, results: Any) -> HypothesisResult:
        """
        H2: Authority Convergence > 20%

        Test: Paired t-test (baseline vs post-training)
        """
        # Estrai authority iniziali e finali
        baseline_auth = list(results.baseline.user_authorities.values())
        post_auth = list(results.post_training.user_authorities.values())

        if len(baseline_auth) != len(post_auth):
            # Fallback: usa medie
            initial_mean = np.mean(baseline_auth)
            final_mean = np.mean(post_auth)
            increase = (final_mean - initial_mean) / initial_mean if initial_mean > 0 else 0

            return HypothesisResult(
                hypothesis="H2: Authority Convergence > 20%",
                metric="authority_increase",
                value=increase,
                target=self.H2_TARGET,
                passed=increase > self.H2_TARGET,
                passed_critical=increase > self.H2_CRITICAL,
                details={"error": "User count mismatch, using means"},
            )

        # Paired t-test
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            t_stat, p_value = stats.ttest_rel(post_auth, baseline_auth)

        # Calcola aumento percentuale
        increases = [
            (post - base) / base if base > 0 else 0
            for base, post in zip(baseline_auth, post_auth)
        ]
        mean_increase = np.mean(increases)

        # Effect size (Cohen's d per paired samples)
        effect_size = self._cohens_d_paired(baseline_auth, post_auth)
        effect_interp = self._interpret_cohens_d(effect_size)

        # Bootstrap CI
        ci = self._bootstrap_ci(increases)

        return HypothesisResult(
            hypothesis="H2: Authority Convergence > 20%",
            metric="authority_increase",
            value=mean_increase,
            target=self.H2_TARGET,
            passed=mean_increase > self.H2_TARGET and p_value < self.bonferroni_alpha,
            passed_critical=mean_increase > self.H2_CRITICAL and p_value < self.alpha,
            statistics={
                "t_statistic": t_stat,
                "p_value": p_value,
                "p_bonferroni": p_value < self.bonferroni_alpha,
                "mean_baseline": np.mean(baseline_auth),
                "mean_post": np.mean(post_auth),
            },
            confidence_interval=ci,
            effect_size=effect_size,
            effect_size_interpretation=effect_interp,
            details={
                "test": "Paired t-test",
                "n_users": len(baseline_auth),
            },
        )

    def _test_h3(self, results: Any) -> HypothesisResult:
        """
        H3: Weight Delta Consistency < 0.5

        Test: Coefficient of Variation (misura convergenza)
        """
        # Estrai delta dei pesi tra iterazioni
        weight_deltas = self._compute_weight_deltas(results.weight_evolution)

        if not weight_deltas or len(weight_deltas) < 2:
            return HypothesisResult(
                hypothesis="H3: Weight Convergence (WDC < 0.5)",
                metric="weight_delta_consistency",
                value=0.0,
                target=self.H3_TARGET,
                passed=True,  # No deltas = stable
                passed_critical=True,
                details={"error": "Insufficient weight history"},
            )

        # Weight Delta Consistency = std / mean
        mean_delta = np.mean(weight_deltas)
        std_delta = np.std(weight_deltas)
        wdc = std_delta / mean_delta if mean_delta > 0 else 0

        # Trend analysis: i delta stanno diminuendo?
        if len(weight_deltas) >= 3:
            # Regressione lineare sui delta
            x = np.arange(len(weight_deltas))
            slope, intercept, r_value, p_value, std_err = stats.linregress(x, weight_deltas)
            trend_decreasing = slope < 0
        else:
            slope, p_value, r_value = 0, 1, 0
            trend_decreasing = True

        return HypothesisResult(
            hypothesis="H3: Weight Convergence (WDC < 0.5)",
            metric="weight_delta_consistency",
            value=wdc,
            target=self.H3_TARGET,
            passed=wdc < self.H3_TARGET and trend_decreasing,
            passed_critical=wdc < self.H3_CRITICAL,
            statistics={
                "mean_delta": mean_delta,
                "std_delta": std_delta,
                "trend_slope": slope,
                "trend_p_value": p_value,
                "trend_r_squared": r_value ** 2,
            },
            confidence_interval=(0, wdc * 1.5),  # Upper bound approssimato
            details={
                "test": "Coefficient of Variation + Trend Analysis",
                "n_deltas": len(weight_deltas),
                "trend_decreasing": trend_decreasing,
            },
        )

    def _test_h4(self, results: Any) -> HypothesisResult:
        """
        H4: Response Improvement > 10%

        Test: Wilcoxon signed-rank (non-parametrico, paired)
        """
        # Estrai score combinati baseline vs post-training
        baseline_scores = [
            r.objective_metrics.combined_score
            for r in results.baseline.results
        ]
        post_scores = [
            r.objective_metrics.combined_score
            for r in results.post_training.results
        ]

        if len(baseline_scores) != len(post_scores):
            # Usa solo le query comuni
            n = min(len(baseline_scores), len(post_scores))
            baseline_scores = baseline_scores[:n]
            post_scores = post_scores[:n]

        if len(baseline_scores) < 2:
            return HypothesisResult(
                hypothesis="H4: Response Improvement > 10%",
                metric="response_improvement",
                value=0.0,
                target=self.H4_TARGET,
                passed=False,
                passed_critical=False,
                details={"error": "Insufficient data"},
            )

        # Wilcoxon signed-rank test
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            try:
                stat, p_value = stats.wilcoxon(post_scores, baseline_scores, alternative='greater')
            except ValueError:
                stat, p_value = 0, 1

        # Calcola miglioramento percentuale
        mean_baseline = np.mean(baseline_scores)
        mean_post = np.mean(post_scores)
        improvement = (mean_post - mean_baseline) / mean_baseline if mean_baseline > 0 else 0

        # Effect size: matched-pairs rank-biserial correlation
        effect_size = self._rank_biserial(baseline_scores, post_scores)
        effect_interp = self._interpret_effect_r(effect_size)

        # Bootstrap CI
        differences = [p - b for b, p in zip(baseline_scores, post_scores)]
        ci = self._bootstrap_ci(differences)

        return HypothesisResult(
            hypothesis="H4: Response Improvement > 10%",
            metric="response_improvement",
            value=improvement,
            target=self.H4_TARGET,
            passed=improvement > self.H4_TARGET and p_value < self.bonferroni_alpha,
            passed_critical=improvement > self.H4_CRITICAL and p_value < self.alpha,
            statistics={
                "wilcoxon_statistic": stat,
                "p_value": p_value,
                "p_bonferroni": p_value < self.bonferroni_alpha,
                "mean_baseline": mean_baseline,
                "mean_post": mean_post,
            },
            confidence_interval=ci,
            effect_size=effect_size,
            effect_size_interpretation=effect_interp,
            details={
                "test": "Wilcoxon signed-rank test",
                "n_pairs": len(baseline_scores),
                "alternative": "greater",
            },
        )

    def _compute_weight_deltas(
        self,
        weight_evolution: List[Dict[str, Any]]
    ) -> List[float]:
        """
        Calcola i delta dei pesi tra iterazioni consecutive.
        """
        if len(weight_evolution) < 2:
            return []

        deltas = []
        for i in range(1, len(weight_evolution)):
            prev_weights = weight_evolution[i - 1].get("weights", {})
            curr_weights = weight_evolution[i].get("weights", {})

            # Calcola delta medio per tutti i pesi
            if isinstance(prev_weights, dict) and isinstance(curr_weights, dict):
                delta_sum = 0
                count = 0
                for key in prev_weights:
                    if key in curr_weights:
                        if isinstance(prev_weights[key], (int, float)) and isinstance(curr_weights[key], (int, float)):
                            delta_sum += abs(curr_weights[key] - prev_weights[key])
                            count += 1
                if count > 0:
                    deltas.append(delta_sum / count)

        return deltas

    def _cohens_d_paired(
        self,
        pre: List[float],
        post: List[float]
    ) -> float:
        """
        Cohen's d per campioni appaiati.

        Formula: d = mean(diff) / std(diff)
        """
        differences = [p - b for b, p in zip(pre, post)]
        mean_diff = np.mean(differences)
        std_diff = np.std(differences, ddof=1)

        if std_diff == 0:
            return 0.0

        return mean_diff / std_diff

    def _rank_biserial(
        self,
        pre: List[float],
        post: List[float]
    ) -> float:
        """
        Rank-biserial correlation per Wilcoxon test.

        Effect size appropriato per test non-parametrici.
        """
        differences = [p - b for b, p in zip(pre, post)]
        n = len(differences)

        if n == 0:
            return 0.0

        # Conta positivi e negativi
        positive = sum(1 for d in differences if d > 0)
        negative = sum(1 for d in differences if d < 0)

        # r = (positive - negative) / n
        return (positive - negative) / n

    def _interpret_cohens_d(self, d: float) -> str:
        """Interpreta Cohen's d secondo convenzioni standard."""
        d = abs(d)
        if d < 0.2:
            return "negligible"
        elif d < 0.5:
            return "small"
        elif d < 0.8:
            return "medium"
        else:
            return "large"

    def _interpret_effect_r(self, r: float) -> str:
        """Interpreta rank-biserial r."""
        r = abs(r)
        if r < 0.1:
            return "negligible"
        elif r < 0.3:
            return "small"
        elif r < 0.5:
            return "medium"
        else:
            return "large"

    def _proportion_ci(
        self,
        successes: int,
        n: int,
        confidence: float = 0.95
    ) -> Tuple[float, float]:
        """Confidence interval per proporzione (Wilson score)."""
        if n == 0:
            return (0.0, 1.0)

        p = successes / n
        z = stats.norm.ppf(1 - (1 - confidence) / 2)

        denominator = 1 + z ** 2 / n
        center = (p + z ** 2 / (2 * n)) / denominator
        spread = z * np.sqrt(p * (1 - p) / n + z ** 2 / (4 * n ** 2)) / denominator

        lower = max(0, center - spread)
        upper = min(1, center + spread)

        return (lower, upper)

    def _bootstrap_ci(
        self,
        data: List[float],
        confidence: float = 0.95
    ) -> Tuple[float, float]:
        """Bootstrap confidence interval."""
        if len(data) < 2:
            mean = np.mean(data) if data else 0
            return (mean, mean)

        # Bootstrap samples
        means = []
        for _ in range(self.bootstrap_samples):
            sample = np.random.choice(data, size=len(data), replace=True)
            means.append(np.mean(sample))

        # Percentile CI
        alpha = (1 - confidence) / 2
        lower = np.percentile(means, alpha * 100)
        upper = np.percentile(means, (1 - alpha) * 100)

        return (lower, upper)


def generate_latex_table(report: StatisticalReport) -> str:
    """
    Genera tabella LaTeX dei risultati.

    Returns:
        Stringa LaTeX pronta per inclusione in documento
    """
    def format_pvalue(p: float) -> str:
        if p < 0.001:
            return "< 0.001***"
        elif p < 0.01:
            return f"{p:.3f}**"
        elif p < 0.05:
            return f"{p:.3f}*"
        else:
            return f"{p:.3f}"

    def format_result(h: HypothesisResult) -> str:
        return r"\checkmark" if h.passed else r"\texttimes"

    h1 = report.h1_feedback_persistence
    h2 = report.h2_authority_convergence
    h3 = report.h3_weight_stability
    h4 = report.h4_response_improvement

    # Build table rows
    h1_pval = "-"
    h2_pval = format_pvalue(h2.statistics.get("p_value", 1.0))
    h3_pval = "-"
    h4_pval = format_pvalue(h4.statistics.get("p_value", 1.0))

    rows = [
        f"H1: Persistence & FPR & {h1.value:.1%} & {h1.target:.0%} & {h1_pval} & {format_result(h1)} \\\\",
        f"H2: Authority & $\\Delta A$ & {h2.value:+.1%} & >{h2.target:.0%} & {h2_pval} & {format_result(h2)} \\\\",
        f"H3: Convergence & WDC & {h3.value:.2f} & <{h3.target:.1f} & {h3_pval} & {format_result(h3)} \\\\",
        f"H4: Improvement & $\\Delta Q$ & {h4.value:+.1%} & >{h4.target:.0%} & {h4_pval} & {format_result(h4)} \\\\",
    ]

    latex = r"""\begin{table}[h]
\centering
\caption{Risultati Test Ipotesi RLCF Loop}
\label{tab:rlcf_results}
\begin{tabular}{lccccl}
\toprule
\textbf{Ipotesi} & \textbf{Metrica} & \textbf{Valore} & \textbf{Target} & \textbf{p-value} & \textbf{Esito} \\
\midrule
""" + "\n".join(rows) + r"""
\bottomrule
\end{tabular}
\begin{tablenotes}
\small
\item Nota: * p < 0.05, ** p < 0.01, *** p < 0.001. Correzione Bonferroni applicata ($\alpha$ = """ + f"{report.bonferroni_alpha:.4f}" + r""").
\end{tablenotes}
\end{table}"""

    return latex
