"""
Generatore di output thesis-ready per simulazione RLCF.

Produce output in vari formati:
- JSON: Trace completo per riproducibilità
- CSV: Dati tabulari per analisi esterna
- PDF: Figure matplotlib per tesi
- LaTeX: Tabelle formattate
- Markdown: Report leggibile

Tutte le figure sono ottimizzate per stampa accademica
(alta risoluzione, font appropriati, colori accessibili).
"""

import json
import os
from dataclasses import dataclass
from typing import Dict, List, Any, Optional
from datetime import datetime
from pathlib import Path
import logging

# Import opzionali per visualizzazione
try:
    import numpy as np
    import pandas as pd
    import matplotlib.pyplot as plt
    import matplotlib
    matplotlib.use('Agg')  # Backend non interattivo per server
    import seaborn as sns
    HAS_PLOTTING = True
except ImportError:
    HAS_PLOTTING = False

logger = logging.getLogger(__name__)


@dataclass
class OutputPaths:
    """Percorsi dei file di output generati."""

    json_trace: str = ""
    csv_metrics: str = ""
    csv_weights: str = ""
    csv_authorities: str = ""
    pdf_authority: str = ""
    pdf_weights: str = ""
    pdf_improvement: str = ""
    pdf_users: str = ""
    tex_results: str = ""
    tex_summary: str = ""
    md_report: str = ""


class ThesisOutputGenerator:
    """
    Genera output thesis-ready dalla simulazione RLCF.

    Configura matplotlib per output di qualità accademica
    e produce figure, tabelle e report.
    """

    # Configurazione matplotlib per tesi
    FIGURE_PARAMS = {
        "figure.figsize": (8, 6),
        "figure.dpi": 300,
        "font.size": 11,
        "font.family": "serif",
        "axes.labelsize": 12,
        "axes.titlesize": 14,
        "legend.fontsize": 10,
        "xtick.labelsize": 10,
        "ytick.labelsize": 10,
        "lines.linewidth": 1.5,
        "lines.markersize": 6,
    }

    # Palette colori accessibile (colorblind-friendly)
    COLORS = {
        "baseline": "#1f77b4",      # Blu
        "post_training": "#2ca02c", # Verde
        "training": "#ff7f0e",      # Arancione
        "strict_expert": "#d62728", # Rosso
        "domain_specialist": "#9467bd",  # Viola
        "lenient_student": "#8c564b",    # Marrone
        "random_noise": "#7f7f7f",  # Grigio
    }

    def __init__(self, output_dir: str, formats: Optional[List[str]] = None):
        """
        Inizializza il generatore.

        Args:
            output_dir: Directory per output
            formats: Lista di formati da generare (default: tutti)
        """
        self.output_dir = output_dir
        self.formats = formats or ["json", "csv", "pdf", "tex", "md"]

        # Crea directory se non esiste
        os.makedirs(output_dir, exist_ok=True)

        # Configura matplotlib
        if HAS_PLOTTING:
            plt.rcParams.update(self.FIGURE_PARAMS)
            sns.set_style("whitegrid")

    def generate_all(
        self,
        results: Any,  # ExperimentResults
        stats: Any,    # StatisticalReport
    ) -> OutputPaths:
        """
        Genera tutti gli output richiesti.

        Args:
            results: Risultati dell'esperimento
            stats: Report statistico

        Returns:
            OutputPaths con percorsi dei file generati
        """
        paths = OutputPaths()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        # JSON trace
        if "json" in self.formats:
            paths.json_trace = self._export_json(results, stats, timestamp)

        # CSV
        if "csv" in self.formats:
            paths.csv_metrics = self._export_csv_metrics(results, timestamp)
            paths.csv_weights = self._export_csv_weights(results, timestamp)
            paths.csv_authorities = self._export_csv_authorities(results, timestamp)

        # PDF figures
        if "pdf" in self.formats and HAS_PLOTTING:
            paths.pdf_authority = self._plot_authority_evolution(results, timestamp)
            paths.pdf_weights = self._plot_weight_convergence(results, timestamp)
            paths.pdf_improvement = self._plot_improvement_comparison(results, timestamp)
            paths.pdf_users = self._plot_user_distribution(results, timestamp)

        # LaTeX tables
        if "tex" in self.formats:
            paths.tex_results = self._generate_latex_results(stats, timestamp)
            paths.tex_summary = self._generate_latex_summary(results, stats, timestamp)

        # Markdown report
        if "md" in self.formats:
            paths.md_report = self._generate_markdown_report(results, stats, timestamp)

        return paths

    def _export_json(
        self,
        results: Any,
        stats: Any,
        timestamp: str
    ) -> str:
        """Esporta trace completo in JSON."""
        path = os.path.join(self.output_dir, f"experiment_trace_{timestamp}.json")

        data = {
            "results": results.to_dict() if hasattr(results, "to_dict") else str(results),
            "statistics": stats.to_dict() if hasattr(stats, "to_dict") else str(stats),
            "generated_at": datetime.now().isoformat(),
        }

        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)

        logger.info(f"JSON trace saved: {path}")
        return path

    def _export_csv_metrics(self, results: Any, timestamp: str) -> str:
        """Esporta metriche per query in CSV."""
        if not HAS_PLOTTING:
            return ""

        rows = []

        # Baseline
        for r in results.baseline.results:
            rows.append({
                "phase": "baseline",
                "query_id": r.query_id,
                "query_text": r.query_text[:50],
                "expert_type": r.expert_type,
                "source_grounding": r.objective_metrics.source_grounding,
                "hallucination_rate": r.objective_metrics.hallucination_rate,
                "combined_score": r.objective_metrics.combined_score,
                "confidence": r.response.confidence if hasattr(r.response, "confidence") else 0,
                "execution_time_ms": r.execution_time_ms,
            })

        # Post-training
        for r in results.post_training.results:
            rows.append({
                "phase": "post_training",
                "query_id": r.query_id,
                "query_text": r.query_text[:50],
                "expert_type": r.expert_type,
                "source_grounding": r.objective_metrics.source_grounding,
                "hallucination_rate": r.objective_metrics.hallucination_rate,
                "combined_score": r.objective_metrics.combined_score,
                "confidence": r.response.confidence if hasattr(r.response, "confidence") else 0,
                "execution_time_ms": r.execution_time_ms,
            })

        df = pd.DataFrame(rows)
        path = os.path.join(self.output_dir, f"metrics_{timestamp}.csv")
        df.to_csv(path, index=False)

        logger.info(f"CSV metrics saved: {path}")
        return path

    def _export_csv_weights(self, results: Any, timestamp: str) -> str:
        """Esporta evoluzione pesi in CSV."""
        if not results.weight_evolution:
            return ""

        rows = []
        for entry in results.weight_evolution:
            row = {
                "label": entry["label"],
                "timestamp": entry["timestamp"],
            }
            weights = entry.get("weights", {})
            if isinstance(weights, dict):
                for k, v in weights.items():
                    if isinstance(v, (int, float)):
                        row[f"weight_{k}"] = v
            rows.append(row)

        df = pd.DataFrame(rows)
        path = os.path.join(self.output_dir, f"weights_evolution_{timestamp}.csv")
        df.to_csv(path, index=False)

        logger.info(f"CSV weights saved: {path}")
        return path

    def _export_csv_authorities(self, results: Any, timestamp: str) -> str:
        """Esporta evoluzione authority in CSV."""
        if not results.authority_evolution:
            return ""

        rows = []
        for entry in results.authority_evolution:
            label = entry["label"]
            for user_id, data in entry.get("authorities", {}).items():
                rows.append({
                    "iteration": label,
                    "user_id": user_id,
                    "profile": data.get("profile", ""),
                    "authority": data.get("authority", 0),
                    "track_record": data.get("track_record", 0),
                    "feedback_count": data.get("feedback_count", 0),
                })

        df = pd.DataFrame(rows)
        path = os.path.join(self.output_dir, f"authorities_{timestamp}.csv")
        df.to_csv(path, index=False)

        logger.info(f"CSV authorities saved: {path}")
        return path

    def _plot_authority_evolution(self, results: Any, timestamp: str) -> str:
        """Genera grafico evoluzione authority per profilo."""
        if not HAS_PLOTTING or not results.authority_evolution:
            return ""

        fig, ax = plt.subplots(figsize=(10, 6))

        # Organizza dati per profilo
        profiles_data = {}
        iterations = []

        for entry in results.authority_evolution:
            label = entry["label"]
            iterations.append(label)

            for user_id, data in entry.get("authorities", {}).items():
                profile = data.get("profile", "unknown")
                authority = data.get("authority", 0)

                if profile not in profiles_data:
                    profiles_data[profile] = []
                profiles_data[profile].append(authority)

        # Plot per profilo (media)
        x = range(len(iterations))
        for profile, auths in profiles_data.items():
            if len(auths) >= len(iterations):
                # Calcola media per iterazione
                n_users = len(auths) // len(iterations)
                means = [np.mean(auths[i*n_users:(i+1)*n_users]) for i in range(len(iterations))]
                color = self.COLORS.get(profile, "#333333")
                ax.plot(x, means, marker='o', label=profile.replace("_", " ").title(), color=color)

        ax.set_xlabel("Iterazione")
        ax.set_ylabel("Authority Score")
        ax.set_title("Evoluzione Authority per Profilo Utente")
        ax.set_xticks(x)
        ax.set_xticklabels(iterations, rotation=45, ha='right')
        ax.legend(loc='upper left')
        ax.grid(True, alpha=0.3)

        plt.tight_layout()
        path = os.path.join(self.output_dir, f"authority_evolution_{timestamp}.pdf")
        plt.savefig(path, bbox_inches='tight', dpi=300)
        plt.close()

        logger.info(f"PDF authority evolution saved: {path}")
        return path

    def _plot_weight_convergence(self, results: Any, timestamp: str) -> str:
        """Genera grafico convergenza pesi."""
        if not HAS_PLOTTING or not results.weight_evolution:
            return ""

        fig, ax = plt.subplots(figsize=(10, 6))

        # Estrai pesi numerici
        iterations = []
        weights_over_time = {}

        for entry in results.weight_evolution:
            iterations.append(entry["label"])
            weights = entry.get("weights", {})

            if isinstance(weights, dict):
                for k, v in weights.items():
                    if isinstance(v, (int, float)):
                        if k not in weights_over_time:
                            weights_over_time[k] = []
                        weights_over_time[k].append(v)

        # Plot top 5 pesi per variazione
        if weights_over_time:
            variations = {k: np.std(v) for k, v in weights_over_time.items() if len(v) == len(iterations)}
            top_weights = sorted(variations.items(), key=lambda x: x[1], reverse=True)[:5]

            x = range(len(iterations))
            for i, (weight_name, _) in enumerate(top_weights):
                values = weights_over_time[weight_name]
                ax.plot(x, values, marker='o', label=weight_name[:20])

        ax.set_xlabel("Iterazione")
        ax.set_ylabel("Valore Peso")
        ax.set_title("Convergenza Pesi RLCF")
        ax.set_xticks(range(len(iterations)))
        ax.set_xticklabels(iterations, rotation=45, ha='right')
        ax.legend(loc='upper right', fontsize=8)
        ax.grid(True, alpha=0.3)

        plt.tight_layout()
        path = os.path.join(self.output_dir, f"weight_convergence_{timestamp}.pdf")
        plt.savefig(path, bbox_inches='tight', dpi=300)
        plt.close()

        logger.info(f"PDF weight convergence saved: {path}")
        return path

    def _plot_improvement_comparison(self, results: Any, timestamp: str) -> str:
        """Genera box plot confronto baseline vs post-training."""
        if not HAS_PLOTTING:
            return ""

        fig, axes = plt.subplots(1, 3, figsize=(14, 5))

        # Estrai dati
        baseline_sg = [r.objective_metrics.source_grounding for r in results.baseline.results]
        post_sg = [r.objective_metrics.source_grounding for r in results.post_training.results]

        baseline_hr = [r.objective_metrics.hallucination_rate for r in results.baseline.results]
        post_hr = [r.objective_metrics.hallucination_rate for r in results.post_training.results]

        baseline_combined = [r.objective_metrics.combined_score for r in results.baseline.results]
        post_combined = [r.objective_metrics.combined_score for r in results.post_training.results]

        # Source Grounding
        axes[0].boxplot([baseline_sg, post_sg], labels=['Baseline', 'Post-Training'])
        axes[0].set_ylabel('Source Grounding')
        axes[0].set_title('Source Grounding')
        axes[0].set_ylim(0, 1)

        # Hallucination Rate
        axes[1].boxplot([baseline_hr, post_hr], labels=['Baseline', 'Post-Training'])
        axes[1].set_ylabel('Hallucination Rate')
        axes[1].set_title('Hallucination Rate')
        axes[1].set_ylim(0, 1)

        # Combined Score
        axes[2].boxplot([baseline_combined, post_combined], labels=['Baseline', 'Post-Training'])
        axes[2].set_ylabel('Combined Score')
        axes[2].set_title('Combined Quality Score')
        axes[2].set_ylim(0, 1)

        # Colora box
        for ax in axes:
            for i, box in enumerate(ax.patches if hasattr(ax, 'patches') else []):
                color = self.COLORS["baseline"] if i == 0 else self.COLORS["post_training"]
                box.set_facecolor(color)

        plt.suptitle('Confronto Metriche: Baseline vs Post-Training', fontsize=14)
        plt.tight_layout()

        path = os.path.join(self.output_dir, f"improvement_comparison_{timestamp}.pdf")
        plt.savefig(path, bbox_inches='tight', dpi=300)
        plt.close()

        logger.info(f"PDF improvement comparison saved: {path}")
        return path

    def _plot_user_distribution(self, results: Any, timestamp: str) -> str:
        """Genera grafico distribuzione authority finale per profilo."""
        if not HAS_PLOTTING or not results.authority_evolution:
            return ""

        fig, ax = plt.subplots(figsize=(10, 6))

        # Estrai authority finali
        final_entry = results.authority_evolution[-1] if results.authority_evolution else {}
        authorities = final_entry.get("authorities", {})

        # Organizza per profilo
        profile_auths = {}
        for user_id, data in authorities.items():
            profile = data.get("profile", "unknown")
            auth = data.get("authority", 0)
            if profile not in profile_auths:
                profile_auths[profile] = []
            profile_auths[profile].append(auth)

        # Bar chart con error bars
        profiles = list(profile_auths.keys())
        means = [np.mean(profile_auths[p]) for p in profiles]
        stds = [np.std(profile_auths[p]) for p in profiles]
        colors = [self.COLORS.get(p, "#333333") for p in profiles]

        x = range(len(profiles))
        bars = ax.bar(x, means, yerr=stds, color=colors, capsize=5, alpha=0.8)

        ax.set_xlabel("Profilo Utente")
        ax.set_ylabel("Authority Score (media ± std)")
        ax.set_title("Distribuzione Authority Finale per Profilo")
        ax.set_xticks(x)
        ax.set_xticklabels([p.replace("_", " ").title() for p in profiles], rotation=45, ha='right')
        ax.set_ylim(0, 1)
        ax.grid(True, alpha=0.3, axis='y')

        plt.tight_layout()
        path = os.path.join(self.output_dir, f"user_distribution_{timestamp}.pdf")
        plt.savefig(path, bbox_inches='tight', dpi=300)
        plt.close()

        logger.info(f"PDF user distribution saved: {path}")
        return path

    def _generate_latex_results(self, stats: Any, timestamp: str) -> str:
        """Genera tabella LaTeX dei risultati ipotesi."""
        from merlt.rlcf.simulator.statistics import generate_latex_table

        latex = generate_latex_table(stats)

        path = os.path.join(self.output_dir, f"hypothesis_results_{timestamp}.tex")
        with open(path, "w", encoding="utf-8") as f:
            f.write(latex)

        logger.info(f"LaTeX results table saved: {path}")
        return path

    def _generate_latex_summary(self, results: Any, stats: Any, timestamp: str) -> str:
        """Genera tabella LaTeX di summary."""
        latex = r"""\begin{table}[h]
\centering
\caption{Riepilogo Esperimento RLCF}
\label{tab:rlcf_summary}
\begin{tabular}{ll}
\toprule
\textbf{Parametro} & \textbf{Valore} \\
\midrule
"""
        # Aggiungi righe
        latex += f"Experiment ID & {results.experiment_id} \\\\\n"
        latex += f"Query totali processate & {results.baseline.queries_processed + sum(t.queries_processed for t in results.training) + results.post_training.queries_processed} \\\\\n"
        latex += f"Feedback totali & {results.total_feedbacks} \\\\\n"
        latex += f"Feedback persistiti & {results.total_feedbacks_persisted} \\\\\n"
        latex += f"Durata totale & {results.total_duration_seconds:.1f}s \\\\\n"
        latex += f"Successo complessivo & {'S\\`i' if stats.overall_success else 'No'} \\\\\n"

        latex += r"""\bottomrule
\end{tabular}
\end{table}"""

        path = os.path.join(self.output_dir, f"experiment_summary_{timestamp}.tex")
        with open(path, "w", encoding="utf-8") as f:
            f.write(latex)

        logger.info(f"LaTeX summary table saved: {path}")
        return path

    def _generate_markdown_report(self, results: Any, stats: Any, timestamp: str) -> str:
        """Genera report completo in Markdown."""
        md = f"""# Report Esperimento RLCF

**Experiment ID**: {results.experiment_id}
**Data**: {timestamp}
**Durata**: {results.total_duration_seconds:.1f} secondi

---

## Risultati Ipotesi

| Ipotesi | Metrica | Valore | Target | Esito |
|---------|---------|--------|--------|-------|
| H1: Persistence | FPR | {stats.h1_feedback_persistence.value:.1%} | {stats.h1_feedback_persistence.target:.0%} | {"✓" if stats.h1_feedback_persistence.passed else "✗"} |
| H2: Authority | ΔA | {stats.h2_authority_convergence.value:+.1%} | >{stats.h2_authority_convergence.target:.0%} | {"✓" if stats.h2_authority_convergence.passed else "✗"} |
| H3: Convergence | WDC | {stats.h3_weight_stability.value:.2f} | <{stats.h3_weight_stability.target:.1f} | {"✓" if stats.h3_weight_stability.passed else "✗"} |
| H4: Improvement | ΔQ | {stats.h4_response_improvement.value:+.1%} | >{stats.h4_response_improvement.target:.0%} | {"✓" if stats.h4_response_improvement.passed else "✗"} |

**Successo Complessivo**: {"✓ Tutte le ipotesi confermate" if stats.overall_success else "✗ Alcune ipotesi non confermate"}

---

## Metriche Fase Baseline

- Query processate: {results.baseline.queries_processed}
- Confidence media: {results.baseline.avg_confidence:.2%}
- Source Grounding: {results.baseline.avg_source_grounding:.2%}
- Hallucination Rate: {results.baseline.avg_hallucination_rate:.2%}

## Metriche Fase Post-Training

- Query processate: {results.post_training.queries_processed}
- Confidence media: {results.post_training.avg_confidence:.2%}
- Source Grounding: {results.post_training.avg_source_grounding:.2%}
- Hallucination Rate: {results.post_training.avg_hallucination_rate:.2%}

---

## Statistiche Training

- Iterazioni: {len(results.training)}
- Feedback totali: {results.total_feedbacks}
- Feedback persistiti: {results.total_feedbacks_persisted}

---

## File Generati

- JSON trace: `experiment_trace_{timestamp}.json`
- CSV metrics: `metrics_{timestamp}.csv`
- CSV weights: `weights_evolution_{timestamp}.csv`
- PDF authority: `authority_evolution_{timestamp}.pdf`
- PDF weights: `weight_convergence_{timestamp}.pdf`
- PDF improvement: `improvement_comparison_{timestamp}.pdf`
- LaTeX results: `hypothesis_results_{timestamp}.tex`

---

*Report generato automaticamente da RLCF Simulator*
"""

        path = os.path.join(self.output_dir, f"analysis_{timestamp}.md")
        with open(path, "w", encoding="utf-8") as f:
            f.write(md)

        logger.info(f"Markdown report saved: {path}")
        return path
