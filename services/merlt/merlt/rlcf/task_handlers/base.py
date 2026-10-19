"""
Task Handler Base
=================

Classe base astratta per tutti i task handler RLCF.

Ogni task type ha un handler specifico che implementa:
- Validazione input/output
- Aggregazione feedback
- Calcolo accuracy vs ground truth
"""

from typing import Dict, Any, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from collections import Counter


class TaskHandler:
    """
    Handler base per task RLCF.

    Fornisce interfaccia comune per:
    - Validazione input task
    - Validazione feedback
    - Aggregazione feedback pesata per autorità
    - Calcolo accuracy vs ground truth

    Può essere usato direttamente per task generici o come
    base class per handler specializzati.

    Esempio:
        handler = QAHandler(db, task, feedbacks)
        result = await handler.aggregate_feedback()
    """

    def __init__(
        self,
        db: AsyncSession,
        task: Any,
        feedbacks: Optional[List[Any]] = None
    ):
        """
        Inizializza handler.

        Args:
            db: Sessione database async
            task: LegalTask da processare
            feedbacks: Lista feedback per il task (opzionale)
        """
        self.db = db
        self.task = task
        self.feedbacks = feedbacks or []

    @property
    def task_type(self) -> str:
        """
        Tipo di task gestito da questo handler.

        Default: legge dal task. Override per handler specializzati.
        """
        if hasattr(self.task, 'task_type'):
            return self.task.task_type
        return "GENERIC"

    @property
    def supported_fields(self) -> List[str]:
        """
        Campi supportati per aggregazione.

        Override per task type specifici.
        Default: tutti i campi nel feedback_data.
        """
        return []

    async def validate_input(self) -> bool:
        """
        Valida che l'input del task sia valido per questo tipo.

        Returns:
            True se valido, False altrimenti
        """
        if not self.task:
            return False
        if not self.task.input_data:
            return False
        return True

    async def validate_feedback(self, feedback: Any) -> bool:
        """
        Valida che un singolo feedback sia valido.

        Args:
            feedback: Feedback da validare

        Returns:
            True se valido, False altrimenti
        """
        if not feedback:
            return False
        if not feedback.feedback_data:
            return False
        return True

    async def aggregate_feedback(self) -> Dict[str, Any]:
        """
        Aggrega tutti i feedback pesati per autorità.

        Implementazione di default che:
        1. Estrae valori per ogni campo
        2. Pesa per autorità utente
        3. Restituisce consenso per campo

        Returns:
            Dizionario con risultato aggregato
        """
        if not self.feedbacks:
            return {"error": "No feedback to aggregate", "type": "NoFeedback"}

        # Raccogli tutti i campi da tutti i feedback
        all_fields = set()
        for fb in self.feedbacks:
            if fb.feedback_data:
                all_fields.update(fb.feedback_data.keys())

        # Filtra per campi supportati se specificati
        if self.supported_fields:
            all_fields = all_fields & set(self.supported_fields)

        # Aggrega per campo
        aggregated = {}
        for field in all_fields:
            field_result = await self._aggregate_field(field)
            aggregated[field] = field_result

        # Calcola answer di consenso
        consensus_answer = await self._compute_consensus_answer(aggregated)

        return {
            "task_type": self.task_type,
            "task_id": self.task.id,
            "feedback_count": len(self.feedbacks),
            "fields_aggregated": list(all_fields),
            "aggregated_values": aggregated,
            "consensus_answer": consensus_answer,
        }

    async def _aggregate_field(self, field: str) -> Dict[str, Any]:
        """
        Aggrega un singolo campo pesando per autorità.

        Args:
            field: Nome campo da aggregare

        Returns:
            Dizionario con valori pesati e consenso
        """
        weighted_values: Counter = Counter()

        for fb in self.feedbacks:
            if not fb.feedback_data:
                continue

            value = fb.feedback_data.get(field)
            if value is None:
                continue

            # Peso = autorità utente (default 1.0 se non disponibile)
            weight = getattr(fb.author, 'authority_score', 1.0) if fb.author else 1.0
            # Normalizza valore per Counter (deve essere hashable)
            value_key = str(value) if not isinstance(value, (str, int, float, bool)) else value
            weighted_values[value_key] += weight

        if not weighted_values:
            return {"consensus": None, "votes": {}}

        # Trova consenso (valore con peso maggiore)
        consensus_value, max_weight = weighted_values.most_common(1)[0]
        total_weight = sum(weighted_values.values())

        return {
            "consensus": consensus_value,
            "consensus_weight": max_weight,
            "total_weight": total_weight,
            "confidence": max_weight / total_weight if total_weight > 0 else 0,
            "votes": dict(weighted_values),
        }

    async def _compute_consensus_answer(
        self,
        aggregated: Dict[str, Any]
    ) -> Optional[str]:
        """
        Calcola risposta di consenso da campi aggregati.

        Override per task type specifici con logica custom.

        Args:
            aggregated: Dizionario campi aggregati

        Returns:
            Risposta consenso o None
        """
        # Default: restituisci il consenso del campo "answer" se esiste
        if "answer" in aggregated:
            return aggregated["answer"].get("consensus")
        return None

    async def compute_accuracy(
        self,
        response_data: Dict[str, Any],
        ground_truth: Optional[Dict[str, Any]] = None
    ) -> float:
        """
        Calcola accuracy della risposta vs ground truth.

        Args:
            response_data: Dati risposta da valutare
            ground_truth: Ground truth per confronto

        Returns:
            Score accuracy 0.0-1.0
        """
        if not ground_truth:
            ground_truth = self.task.ground_truth_data if self.task else None

        if not ground_truth:
            return 0.0

        # Default: confronto esatto
        matches = 0
        total = 0
        for key, expected in ground_truth.items():
            if key in response_data:
                total += 1
                if response_data[key] == expected:
                    matches += 1

        return matches / total if total > 0 else 0.0
