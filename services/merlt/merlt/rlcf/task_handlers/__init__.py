"""
RLCF Task Handlers
==================

Factory e handler per i diversi tipi di task RLCF.

Ogni task type ha un handler specifico che implementa:
- Validazione input/output
- Aggregazione feedback pesata per autorità
- Calcolo accuracy vs ground truth

Esempio:
    from merlt.rlcf.task_handlers import get_handler

    handler = await get_handler(db, task)
    result = await handler.aggregate_feedback()
"""

from typing import Type, Dict, Any, Optional, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .base import TaskHandler
from .qa import QAHandler, StatutoryRuleQAHandler
from .retrieval import RetrievalValidationHandler
from .classification import ClassificationHandler

# Registry dei handler per task type
_HANDLERS: Dict[str, Type[TaskHandler]] = {
    "QA": QAHandler,
    "STATUTORY_RULE_QA": StatutoryRuleQAHandler,
    "RETRIEVAL_VALIDATION": RetrievalValidationHandler,
    "CLASSIFICATION": ClassificationHandler,
    # Altri handler usano il base handler con comportamento default
    "PREDICTION": TaskHandler,
    "NLI": TaskHandler,
    "RISK_SPOTTING": TaskHandler,
    "DOCTRINE_APPLICATION": TaskHandler,
    "SUMMARIZATION": TaskHandler,
    "NER": TaskHandler,
    "DRAFTING": TaskHandler,
}


async def get_handler(
    db: AsyncSession,
    task: Any,
    feedbacks: Optional[List[Any]] = None
) -> TaskHandler:
    """
    Factory per ottenere l'handler appropriato per un task.

    Args:
        db: Sessione database async
        task: LegalTask da processare
        feedbacks: Lista feedback (se None, vengono caricati da DB)

    Returns:
        TaskHandler specifico per il task type

    Raises:
        ValueError: Se task_type non è supportato
    """
    # Import models qui per evitare circular import
    from ..models import Feedback, Response

    task_type = task.task_type if hasattr(task, 'task_type') else str(task.get('task_type', ''))

    # Trova handler class
    handler_class = _HANDLERS.get(task_type)
    if handler_class is None:
        raise ValueError(f"Task type non supportato: {task_type}")

    # Carica feedback se non forniti
    if feedbacks is None:
        task_id = task.id if hasattr(task, 'id') else task.get('id')
        if task_id:
            result = await db.execute(
                select(Feedback)
                .join(Response)
                .filter(Response.task_id == task_id)
            )
            feedbacks = list(result.scalars().all())
        else:
            feedbacks = []

    # Istanzia handler
    return handler_class(db=db, task=task, feedbacks=feedbacks)


def register_handler(task_type: str, handler_class: Type[TaskHandler]):
    """
    Registra un nuovo handler per un task type.

    Utile per estendere il sistema con handler custom.

    Args:
        task_type: Tipo di task (stringa)
        handler_class: Classe handler (deve ereditare da TaskHandler)
    """
    if not issubclass(handler_class, TaskHandler):
        raise TypeError(f"{handler_class} deve ereditare da TaskHandler")
    _HANDLERS[task_type] = handler_class


def get_supported_task_types() -> List[str]:
    """
    Restituisce lista dei task type supportati.

    Returns:
        Lista stringhe task type
    """
    return list(_HANDLERS.keys())


__all__ = [
    "TaskHandler",
    "QAHandler",
    "StatutoryRuleQAHandler",
    "RetrievalValidationHandler",
    "ClassificationHandler",
    "get_handler",
    "register_handler",
    "get_supported_task_types",
]
