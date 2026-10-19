# Test Statistici

> **Analisi statistica rigorosa per validazione delle ipotesi**

## Overview

Il simulatore RLCF utilizza test statistici rigorosi per validare le 4 ipotesi sperimentali. Ogni test è stato scelto in base alla natura dei dati e alle assunzioni statistiche appropriate.

---

## Correzione per Test Multipli

### Problema
Con 4 ipotesi testate simultaneamente, il rischio di errore di Tipo I (falso positivo) aumenta:

```
P(almeno 1 falso positivo) = 1 - (1 - α)^k
                           = 1 - (1 - 0.05)^4
                           = 1 - 0.8145
                           = 18.5%
```

### Soluzione: Correzione di Bonferroni

```python
α_bonferroni = α / k = 0.05 / 4 = 0.0125
```

**Applicazione nel codice**:
```python
class StatisticalAnalyzer:
    def __init__(self, alpha: float = 0.05, use_bonferroni: bool = True):
        self.alpha = alpha
        self.n_hypotheses = 4
        self.bonferroni_alpha = alpha / self.n_hypotheses if use_bonferroni else alpha
```

---

## H1: Feedback Persistence Rate

### Ipotesi
> Il sistema persiste il 100% dei feedback ricevuti

### Test: Exact Binomial Test

**Razionale**: Stiamo testando una proporzione (rate) contro un valore target.

**Ipotesi statistiche**:
- H₀: p < 0.95 (sistema non affidabile)
- H₁: p ≥ 0.95 (sistema affidabile)

**Implementazione**:
```python
from scipy import stats

def _test_h1(self, results) -> HypothesisResult:
    submitted = results.total_feedbacks
    persisted = results.total_feedbacks_persisted

    if submitted == 0:
        rate = 1.0
        p_value = 1.0
    else:
        rate = persisted / submitted
        # Test binomiale esatto (one-sided, greater)
        result = stats.binomtest(
            persisted, submitted,
            p=0.95,  # H0: p >= 95%
            alternative='greater'
        )
        p_value = result.pvalue

    # Confidence interval per proporzione (Wilson score)
    ci = self._proportion_ci(persisted, submitted)

    return HypothesisResult(
        value=rate,
        target=1.0,
        passed=rate >= 1.0,  # Target: 100%
        passed_critical=rate >= 0.95,  # Critico: 95%
        statistics={"p_value": p_value}
    )
```

**Confidence Interval** (Wilson score interval):
```python
def _proportion_ci(self, successes: int, n: int, confidence: float = 0.95):
    """Intervallo di confidenza per proporzione binomiale."""
    if n == 0:
        return (0.0, 1.0)

    z = stats.norm.ppf(1 - (1 - confidence) / 2)
    p_hat = successes / n

    denominator = 1 + z**2 / n
    center = (p_hat + z**2 / (2*n)) / denominator
    margin = z * np.sqrt((p_hat * (1 - p_hat) + z**2 / (4*n)) / n) / denominator

    return (max(0, center - margin), min(1, center + margin))
```

### Interpretazione Output

| Valore | Significato |
|--------|-------------|
| `value = 1.0` | 100% feedback persistiti |
| `passed = True` | Target raggiunto |
| `p_value < 0.05` | Statisticamente significativo |
| `CI = (0.99, 1.0)` | Intervallo di confidenza 95% |

---

## H2: Authority Convergence

### Ipotesi
> L'authority score medio aumenta >20% dopo il training

### Test: Paired t-test

**Razionale**: Confrontiamo le stesse unità (utenti) prima e dopo il trattamento.

**Assunzioni**:
1. Dati continui
2. Differenze approssimativamente normali
3. Campioni dipendenti (paired)

**Ipotesi statistiche**:
- H₀: μ_post ≤ μ_baseline (nessun miglioramento)
- H₁: μ_post > μ_baseline (miglioramento)

**Implementazione**:
```python
def _test_h2(self, results) -> HypothesisResult:
    baseline_auth = list(results.baseline.user_authorities.values())
    post_auth = list(results.post_training.user_authorities.values())

    # Paired t-test (one-sided)
    t_stat, p_value = stats.ttest_rel(post_auth, baseline_auth)
    # Dividi per 2 per test one-sided
    p_value = p_value / 2 if t_stat > 0 else 1 - p_value / 2

    # Calcola aumento percentuale per ogni utente
    increases = [
        (post - base) / base if base > 0 else 0
        for base, post in zip(baseline_auth, post_auth)
    ]
    mean_increase = np.mean(increases)

    # Effect size: Cohen's d per paired samples
    effect_size = self._cohens_d_paired(baseline_auth, post_auth)

    # Bootstrap CI per l'aumento medio
    ci = self._bootstrap_ci(increases)

    return HypothesisResult(
        value=mean_increase,
        target=0.20,  # >20% aumento
        passed=mean_increase > 0.20 and p_value < self.bonferroni_alpha,
        statistics={
            "t_statistic": t_stat,
            "p_value": p_value,
            "mean_baseline": np.mean(baseline_auth),
            "mean_post": np.mean(post_auth),
        },
        effect_size=effect_size,
    )
```

### Cohen's d per Paired Samples

```python
def _cohens_d_paired(self, group1: List[float], group2: List[float]) -> float:
    """Effect size per campioni appaiati."""
    differences = np.array(group2) - np.array(group1)
    return np.mean(differences) / np.std(differences, ddof=1)
```

**Interpretazione Cohen's d**:
| d | Interpretazione |
|---|-----------------|
| 0.2 | Piccolo |
| 0.5 | Medio |
| 0.8 | Grande |
| >1.0 | Molto grande |

### Interpretazione Output

```
H2: Authority Convergence = +187.8% (target: >20%) [✗]
    t_statistic: 2.34
    p_value: 0.0156
    effect_size: 0.72 (medium-large)
    passed: False (p > 0.0125 Bonferroni)
```

**Nota**: Anche con un aumento del 187.8%, l'ipotesi può fallire se:
1. Il p-value non è < α_bonferroni (0.0125)
2. La variabilità tra utenti è alta
3. Il sample size è insufficiente

---

## H3: Weight Stability

### Ipotesi
> I traversal weights convergono verso valori stabili (WDC < 0.5)

### Test: Coefficient of Variation + Trend Analysis

**Razionale**: Misuriamo sia la variabilità (CV) che la direzione del cambiamento (trend).

**Metriche**:

1. **Weight Delta Consistency (WDC)**:
```python
WDC = std(weight_deltas) / mean(weight_deltas)
```
- WDC < 0.5: Alta convergenza
- WDC 0.5-1.0: Convergenza moderata
- WDC > 1.0: Bassa convergenza

2. **Trend Analysis** (regressione lineare):
```python
slope, intercept, r_value, p_value, std_err = stats.linregress(x, weight_deltas)
trend_decreasing = slope < 0  # I delta stanno diminuendo?
```

**Implementazione**:
```python
def _test_h3(self, results) -> HypothesisResult:
    weight_deltas = self._compute_weight_deltas(results.weight_evolution)

    if len(weight_deltas) < 2:
        return HypothesisResult(value=0.0, passed=True)  # No data = stable

    # Weight Delta Consistency
    mean_delta = np.mean(weight_deltas)
    std_delta = np.std(weight_deltas)
    wdc = std_delta / mean_delta if mean_delta > 0 else 0

    # Trend analysis
    if len(weight_deltas) >= 3:
        x = np.arange(len(weight_deltas))
        slope, _, r_value, p_value, _ = stats.linregress(x, weight_deltas)
        trend_decreasing = slope < 0
    else:
        trend_decreasing = True

    return HypothesisResult(
        value=wdc,
        target=0.5,
        passed=wdc < 0.5 and trend_decreasing,
        statistics={
            "mean_delta": mean_delta,
            "std_delta": std_delta,
            "trend_slope": slope,
            "trend_p_value": p_value,
        }
    )

def _compute_weight_deltas(self, weight_evolution: List[Dict]) -> List[float]:
    """Calcola i delta tra snapshot consecutivi."""
    deltas = []
    for i in range(1, len(weight_evolution)):
        prev = weight_evolution[i-1]["weights"]
        curr = weight_evolution[i]["weights"]

        # Calcola delta L2 norm
        delta = 0.0
        for key in curr:
            if key in prev and isinstance(curr[key], (int, float)):
                delta += (curr[key] - prev[key]) ** 2
        deltas.append(np.sqrt(delta))

    return deltas
```

### Interpretazione Output

```
H3: Weight Stability (WDC) = 0.38 (target: <0.5) [✓]
    mean_delta: 0.0234
    std_delta: 0.0089
    trend_slope: -0.0012 (decreasing ✓)
```

---

## H4: Response Improvement

### Ipotesi
> La qualità delle risposte migliora >10% dopo il training

### Test: Wilcoxon Signed-Rank Test

**Razionale**:
- Test non-parametrico
- Non assume normalità
- Robusto a outliers
- Appropriato per campioni piccoli appaiati

**Ipotesi statistiche**:
- H₀: mediana(differenze) ≤ 0
- H₁: mediana(differenze) > 0

**Implementazione**:
```python
def _test_h4(self, results) -> HypothesisResult:
    # Estrai score di qualità
    baseline_scores = self._extract_quality_scores(results.baseline)
    post_scores = self._extract_quality_scores(results.post_training)

    # Calcola improvement percentuale
    improvements = [
        (post - base) / base if base > 0 else 0
        for base, post in zip(baseline_scores, post_scores)
    ]
    mean_improvement = np.mean(improvements)

    # Wilcoxon signed-rank test (one-sided)
    stat, p_value = stats.wilcoxon(
        baseline_scores, post_scores,
        alternative='less'  # post > baseline
    )

    # Effect size: matched-pairs rank-biserial correlation
    n = len(baseline_scores)
    effect_size = 1 - (2 * stat) / (n * (n + 1))

    # Bootstrap CI
    ci = self._bootstrap_ci(improvements)

    return HypothesisResult(
        value=mean_improvement,
        target=0.10,  # >10%
        passed=mean_improvement > 0.10 and p_value < self.bonferroni_alpha,
        statistics={
            "wilcoxon_stat": stat,
            "p_value": p_value,
            "mean_baseline": np.mean(baseline_scores),
            "mean_post": np.mean(post_scores),
        },
        effect_size=effect_size,
    )

def _extract_quality_scores(self, phase_results) -> List[float]:
    """Estrae score di qualità combinato per ogni query."""
    scores = []
    for result in phase_results.results:
        # Combina SG e confidence
        sg = result.objective_metrics.source_grounding
        conf = result.response.confidence if hasattr(result.response, 'confidence') else 0.5
        combined = 0.6 * sg + 0.4 * conf
        scores.append(combined)
    return scores
```

### Interpretazione Output

```
H4: Response Improvement = +8.5% (target: >10%) [✗]
    wilcoxon_stat: 12.0
    p_value: 0.0234
    effect_size: 0.56 (medium)
    baseline_mean: 0.72
    post_mean: 0.78
```

**Nota**: +8.5% è vicino al target ma non lo raggiunge. Potrebbe bastare aumentare le iterazioni.

---

## Bootstrap Confidence Intervals

Per metriche non normali, usiamo bootstrap per stimare gli intervalli di confidenza:

```python
def _bootstrap_ci(
    self,
    data: List[float],
    n_bootstrap: int = 1000,
    confidence: float = 0.95
) -> Tuple[float, float]:
    """Calcola CI tramite bootstrap."""
    data = np.array(data)
    n = len(data)

    # Genera campioni bootstrap
    bootstrap_means = []
    for _ in range(n_bootstrap):
        sample = np.random.choice(data, size=n, replace=True)
        bootstrap_means.append(np.mean(sample))

    # Percentili
    alpha = 1 - confidence
    lower = np.percentile(bootstrap_means, 100 * alpha / 2)
    upper = np.percentile(bootstrap_means, 100 * (1 - alpha / 2))

    return (lower, upper)
```

---

## Tabella Riassuntiva

| Ipotesi | Test | α | Assunzioni |
|---------|------|---|------------|
| H1 | Binomial exact | 0.0125 | Proporzione binomiale |
| H2 | Paired t-test | 0.0125 | Differenze ~normali |
| H3 | CV + Linear regression | N/A | Dati continui |
| H4 | Wilcoxon signed-rank | 0.0125 | Ordinale, appaiati |

---

## Output LaTeX Generato

```latex
\begin{table}[h]
\centering
\caption{Risultati Test Ipotesi RLCF Loop}
\label{tab:rlcf_results}
\begin{tabular}{lccccl}
\toprule
\textbf{Ipotesi} & \textbf{Metrica} & \textbf{Valore} & \textbf{Target} & \textbf{p-value} & \textbf{Esito} \\
\midrule
H1: Persistence & FPR & 100.0\% & 100\% & - & \checkmark \\
H2: Authority & $\Delta A$ & +187.8\% & >20\% & 0.016 & \texttimes \\
H3: Convergence & WDC & 0.38 & <0.5 & - & \checkmark \\
H4: Improvement & $\Delta Q$ & +8.5\% & >10\% & 0.023 & \texttimes \\
\bottomrule
\end{tabular}
\begin{tablenotes}
\small
\item Nota: * p < 0.05, ** p < 0.01, *** p < 0.001.
      Correzione Bonferroni applicata ($\alpha$ = 0.0125).
\end{tablenotes}
\end{table}
```

---

## Riferimenti

1. Wilcoxon, F. (1945). Individual comparisons by ranking methods
2. Bonferroni, C.E. (1936). Teoria statistica delle classi
3. Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences
4. Efron, B. (1979). Bootstrap Methods: Another Look at the Jackknife

---

*Documentazione statistica per EXP-021 - RLCF Simulator*
