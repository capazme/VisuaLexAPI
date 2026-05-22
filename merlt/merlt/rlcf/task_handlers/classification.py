"""
Classification Handler
======================

Handler per task di classificazione documenti giuridici.
"""

from typing import Dict, Any, Optional, List
from .base import TaskHandler


class ClassificationHandler(TaskHandler):
    """
    Handler per task di classificazione.

    Gestisce categorizzazione di documenti giuridici:
    - Tipo di atto (legge, decreto, sentenza, etc.)
    - Area del diritto (civile, penale, amministrativo, etc.)
    - Rilevanza per caso specifico
    """

    @property
    def task_type(self) -> str:
        return "CLASSIFICATION"

    @property
    def supported_fields(self) -> List[str]:
        return [
            "category",           # Categoria principale
            "subcategory",        # Sottocategoria
            "confidence",         # Confidenza classificazione
            "alternative_categories",  # Categorie alternative considerate
            "reasoning",
        ]

    async def validate_input(self) -> bool:
        """Valida che l'input contenga documento da classificare."""
        if not await super().validate_input():
            return False

        input_data = self.task.input_data
        # Richiede documento o testo da classificare
        if "document" not in input_data and "text" not in input_data:
            return False
        return True

    async def aggregate_feedback(self) -> Dict[str, Any]:
        """
        Aggrega feedback su classificazione con consenso categoria.

        Returns:
            Dizionario con categoria consenso e alternative
        """
        base_result = await super().aggregate_feedback()

        if "error" in base_result:
            return base_result

        aggregated = base_result.get("aggregated_values", {})

        # Estrai distribuzione categorie
        category_data = aggregated.get("category", {})
        votes = category_data.get("votes", {})

        # Calcola distribuzione percentuale
        total_votes = sum(votes.values()) if votes else 0
        category_distribution = {}
        if total_votes > 0:
            category_distribution = {
                cat: round(weight / total_votes * 100, 1)
                for cat, weight in votes.items()
            }

        # Ordina per peso
        sorted_categories = sorted(
            category_distribution.items(),
            key=lambda x: x[1],
            reverse=True
        )

        # Aggiungi metriche classificazione-specifiche
        base_result["classification_result"] = {
            "primary_category": category_data.get("consensus"),
            "primary_confidence": category_data.get("confidence", 0),
            "category_distribution": dict(sorted_categories),
            "alternative_categories": [cat for cat, _ in sorted_categories[1:4]],
            "agreement_level": self._compute_agreement_level(category_data.get("confidence", 0)),
        }

        return base_result

    def _compute_agreement_level(self, confidence: float) -> str:
        """Converte confidenza in livello di accordo."""
        if confidence >= 0.9:
            return "strong_consensus"
        elif confidence >= 0.7:
            return "moderate_consensus"
        elif confidence >= 0.5:
            return "weak_consensus"
        else:
            return "no_consensus"

    async def compute_accuracy(
        self,
        response_data: Dict[str, Any],
        ground_truth: Optional[Dict[str, Any]] = None
    ) -> float:
        """
        Calcola accuracy classificazione.

        Considera anche match parziale su sottocategorie.

        Args:
            response_data: Classificazione prodotta
            ground_truth: Classificazione corretta

        Returns:
            Score 0.0-1.0
        """
        if not ground_truth:
            ground_truth = self.task.ground_truth_data if self.task else None

        if not ground_truth:
            return 0.0

        score = 0.0

        # Match categoria principale (peso 0.7)
        if "category" in ground_truth and "category" in response_data:
            if response_data["category"] == ground_truth["category"]:
                score += 0.7

        # Match sottocategoria (peso 0.3)
        if "subcategory" in ground_truth and "subcategory" in response_data:
            if response_data["subcategory"] == ground_truth["subcategory"]:
                score += 0.3

        return score
