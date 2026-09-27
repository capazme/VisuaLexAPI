"""
Retrieval Validation Handler
============================

Handler per validazione della qualità del retrieval.
Valuta risultati da KG, API e Vector search.
"""

from typing import Dict, Any, Optional, List
from .base import TaskHandler


class RetrievalValidationHandler(TaskHandler):
    """
    Handler per validazione qualità retrieval.

    Valuta la rilevanza dei documenti/nodi recuperati
    per una query specifica. Usato per feedback su:
    - KG retrieval (Cypher queries)
    - Vector retrieval (embedding similarity)
    - API retrieval (Normattiva, Brocardi)
    """

    @property
    def task_type(self) -> str:
        return "RETRIEVAL_VALIDATION"

    @property
    def supported_fields(self) -> List[str]:
        return [
            "relevance_score",       # 1-5 scala rilevanza
            "completeness_score",    # 1-5 copertura risultati
            "precision_score",       # 1-5 precisione (no rumore)
            "missing_documents",     # Documenti mancanti
            "irrelevant_documents",  # Documenti non rilevanti
            "reasoning",
        ]

    async def validate_input(self) -> bool:
        """Valida che l'input contenga query e risultati."""
        if not await super().validate_input():
            return False

        input_data = self.task.input_data
        # Richiede query e risultati da validare
        if "query" not in input_data:
            return False
        if "retrieved_documents" not in input_data:
            return False
        return True

    async def aggregate_feedback(self) -> Dict[str, Any]:
        """
        Aggrega feedback su retrieval con metriche specifiche.

        Returns:
            Dizionario con metriche aggregate e raccomandazioni
        """
        base_result = await super().aggregate_feedback()

        if "error" in base_result:
            return base_result

        aggregated = base_result.get("aggregated_values", {})

        # Calcola metriche aggregate
        relevance = aggregated.get("relevance_score", {}).get("consensus")
        completeness = aggregated.get("completeness_score", {}).get("consensus")
        precision = aggregated.get("precision_score", {}).get("consensus")

        # Converti a float se sono stringhe
        try:
            relevance = float(relevance) if relevance else 0.0
            completeness = float(completeness) if completeness else 0.0
            precision = float(precision) if precision else 0.0
        except (ValueError, TypeError):
            relevance = completeness = precision = 0.0

        # Score complessivo
        overall_score = (relevance + completeness + precision) / 3 if all([relevance, completeness, precision]) else 0.0

        # Raccogli documenti problematici
        missing_docs = []
        irrelevant_docs = []
        for fb in self.feedbacks:
            if fb.feedback_data:
                missing = fb.feedback_data.get("missing_documents", [])
                if isinstance(missing, list):
                    missing_docs.extend(missing)
                irrelevant = fb.feedback_data.get("irrelevant_documents", [])
                if isinstance(irrelevant, list):
                    irrelevant_docs.extend(irrelevant)

        # Aggiungi metriche retrieval-specifiche
        base_result["retrieval_metrics"] = {
            "relevance_score": relevance,
            "completeness_score": completeness,
            "precision_score": precision,
            "overall_score": overall_score,
            "quality_level": self._score_to_level(overall_score),
        }

        base_result["issues"] = {
            "missing_documents": list(set(missing_docs)),
            "irrelevant_documents": list(set(irrelevant_docs)),
        }

        base_result["recommendations"] = self._generate_recommendations(
            relevance, completeness, precision, missing_docs, irrelevant_docs
        )

        return base_result

    def _score_to_level(self, score: float) -> str:
        """Converte score numerico in livello qualitativo."""
        if score >= 4.5:
            return "excellent"
        elif score >= 3.5:
            return "good"
        elif score >= 2.5:
            return "acceptable"
        elif score >= 1.5:
            return "poor"
        else:
            return "critical"

    def _generate_recommendations(
        self,
        relevance: float,
        completeness: float,
        precision: float,
        missing_docs: List[str],
        irrelevant_docs: List[str]
    ) -> List[str]:
        """Genera raccomandazioni basate sui feedback."""
        recommendations = []

        if relevance < 3.0:
            recommendations.append(
                "Migliorare la rilevanza: considerare embedding più specifici "
                "per il dominio giuridico italiano"
            )

        if completeness < 3.0:
            recommendations.append(
                "Aumentare la completezza: espandere la ricerca includendo "
                "sinonimi e concetti correlati"
            )
            if missing_docs:
                recommendations.append(
                    f"Documenti mancanti segnalati: {', '.join(missing_docs[:5])}"
                )

        if precision < 3.0:
            recommendations.append(
                "Migliorare la precisione: raffinare i filtri per ridurre "
                "risultati non pertinenti"
            )
            if irrelevant_docs:
                recommendations.append(
                    f"Documenti non pertinenti segnalati: {', '.join(irrelevant_docs[:5])}"
                )

        if not recommendations:
            recommendations.append("Retrieval quality soddisfacente")

        return recommendations

    async def compute_accuracy(
        self,
        response_data: Dict[str, Any],
        ground_truth: Optional[Dict[str, Any]] = None
    ) -> float:
        """
        Calcola accuracy retrieval basata su documenti attesi.

        Args:
            response_data: Documenti recuperati
            ground_truth: Documenti attesi

        Returns:
            F1 score 0.0-1.0
        """
        if not ground_truth:
            ground_truth = self.task.ground_truth_data if self.task else None

        if not ground_truth:
            return 0.0

        expected = set(ground_truth.get("expected_documents", []))
        retrieved = set(response_data.get("retrieved_documents", []))

        if not expected:
            return 0.0

        # Calcola precision, recall, F1
        true_positives = len(expected & retrieved)
        precision = true_positives / len(retrieved) if retrieved else 0.0
        recall = true_positives / len(expected) if expected else 0.0

        if precision + recall == 0:
            return 0.0

        f1 = 2 * (precision * recall) / (precision + recall)
        return f1
