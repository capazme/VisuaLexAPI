"""
QA Task Handlers
================

Handler per task di tipo Question Answering:
- QA: Domande generali sul diritto
- STATUTORY_RULE_QA: Interpretazione letterale di norme
"""

from typing import Dict, Any, Optional, List
from .base import TaskHandler


class QAHandler(TaskHandler):
    """
    Handler per task QA generici.

    Gestisce domande in linguaggio naturale sulla legislazione italiana.
    Aggrega feedback su: answer, citations, reasoning.
    """

    @property
    def task_type(self) -> str:
        return "QA"

    @property
    def supported_fields(self) -> List[str]:
        return ["answer", "citations", "reasoning", "confidence", "utility"]

    async def _compute_consensus_answer(
        self,
        aggregated: Dict[str, Any]
    ) -> Optional[str]:
        """
        Compone risposta consenso da answer e citations.

        Returns:
            Risposta formattata con citazioni
        """
        answer = aggregated.get("answer", {}).get("consensus")
        citations = aggregated.get("citations", {}).get("consensus")

        if not answer:
            return None

        if citations:
            return f"{answer}\n\nRiferimenti: {citations}"
        return answer


class StatutoryRuleQAHandler(TaskHandler):
    """
    Handler per interpretazione letterale di norme.

    Specializzato per domande su articoli specifici del codice.
    Richiede citazione precisa della norma.
    """

    @property
    def task_type(self) -> str:
        return "STATUTORY_RULE_QA"

    @property
    def supported_fields(self) -> List[str]:
        return [
            "answer",
            "article_reference",
            "literal_interpretation",
            "applicable_conditions",
            "exceptions",
        ]

    async def validate_input(self) -> bool:
        """Valida che l'input contenga riferimento normativo."""
        if not await super().validate_input():
            return False

        input_data = self.task.input_data
        # Richiede riferimento a norma specifica
        if "article" not in input_data and "urn" not in input_data:
            return False
        return True

    async def _compute_consensus_answer(
        self,
        aggregated: Dict[str, Any]
    ) -> Optional[str]:
        """
        Compone risposta con interpretazione letterale.

        Returns:
            Risposta strutturata per interpretazione normativa
        """
        answer = aggregated.get("answer", {}).get("consensus")
        article_ref = aggregated.get("article_reference", {}).get("consensus")
        literal = aggregated.get("literal_interpretation", {}).get("consensus")
        conditions = aggregated.get("applicable_conditions", {}).get("consensus")
        exceptions = aggregated.get("exceptions", {}).get("consensus")

        if not answer:
            return None

        parts = [answer]

        if article_ref:
            parts.insert(0, f"Riferimento normativo: {article_ref}")

        if literal:
            parts.append(f"\nInterpretazione letterale: {literal}")

        if conditions:
            parts.append(f"\nCondizioni di applicabilità: {conditions}")

        if exceptions:
            parts.append(f"\nEccezioni: {exceptions}")

        return "\n".join(parts)

    async def compute_accuracy(
        self,
        response_data: Dict[str, Any],
        ground_truth: Optional[Dict[str, Any]] = None
    ) -> float:
        """
        Calcola accuracy con peso maggiore per citazione corretta.

        Args:
            response_data: Risposta da valutare
            ground_truth: Ground truth

        Returns:
            Score 0.0-1.0 con peso per citazione
        """
        if not ground_truth:
            ground_truth = self.task.ground_truth_data if self.task else None

        if not ground_truth:
            return 0.0

        score = 0.0
        weights = {
            "article_reference": 0.3,  # Citazione corretta pesa di più
            "answer": 0.4,
            "literal_interpretation": 0.2,
            "applicable_conditions": 0.1,
        }

        for field, weight in weights.items():
            if field in ground_truth and field in response_data:
                if response_data[field] == ground_truth[field]:
                    score += weight

        return score
