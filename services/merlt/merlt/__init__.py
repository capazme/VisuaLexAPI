"""
MERL-T: Multi-Expert Reinforcement Learning from AI Feedback

A framework for Italian legal text analysis using multi-expert
architecture and reinforcement learning from AI feedback.

Modules:
    - pipeline: Main processing pipeline
    - experts: Multi-expert system components
    - rlcf: Reinforcement learning from AI feedback
    - storage: Knowledge graph and database
    - ner: Named entity recognition
"""

__version__ = "0.1.0"

from . import pipeline
from . import experts
from . import rlcf
from . import storage
from . import ner
from . import core

# Re-export core classes for convenience
from .core import LegalKnowledgeGraph, MerltConfig
from .core.legal_knowledge_graph import InterpretationResult

__all__ = [
    "pipeline",
    "experts",
    "rlcf",
    "storage",
    "ner",
    "core",
    "LegalKnowledgeGraph",
    "MerltConfig",
    "InterpretationResult",
    "__version__",
]
