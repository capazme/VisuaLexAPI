"""
MERL-T Tools Module
====================

Tools sono funzioni atomiche che gli Expert possono invocare per:
- Cercare nel knowledge graph (SemanticSearchTool, GraphSearchTool)
- Recuperare documenti (ArticleRetrieveTool, DottrinaRetrieveTool)
- Calcolare termini/prescrizioni (TerminiTool, PrescrizioneTool)
- Navigare relazioni (TraverseTool, PathFindTool)

Ogni tool:
- Implementa BaseTool
- Ha schema JSON per LLM function calling
- E' registrato in ToolRegistry

Esempio:
    >>> from merlt.tools import get_tool_registry, SemanticSearchTool
    >>>
    >>> # Registra tool
    >>> registry = get_tool_registry()
    >>> registry.register(SemanticSearchTool(retriever))
    >>>
    >>> # Usa tool
    >>> tool = registry.get("semantic_search")
    >>> result = await tool(query="contratto", top_k=5)
    >>> print(result.data)
"""

from merlt.tools.base import (
    BaseTool,
    ToolResult,
    ToolParameter,
    ParameterType,
    ToolChain,
)
from merlt.tools.registry import (
    ToolRegistry,
    get_tool_registry,
    register_tool,
)
from merlt.tools.search import (
    SemanticSearchTool,
    GraphSearchTool,
    ArticleFetchTool,
    SearchResultItem,
)
from merlt.tools.verification import (
    VerificationTool,
    VerificationResult,
    SourceVerificationMixin,
)
from merlt.tools.definition import (
    DefinitionLookupTool,
    DefinitionEntry,
)
from merlt.tools.hierarchy import (
    HierarchyNavigationTool,
    HierarchyNode,
    NavigationDirection,
)
from merlt.tools.historical_evolution import (
    HistoricalEvolutionTool,
    HistoricalEvent,
)
from merlt.tools.principle_lookup import (
    PrincipleLookupTool,
    LegalPrinciple,
)
from merlt.tools.external_source import (
    ExternalSourceTool,
)
from merlt.tools.textual_reference import (
    TextualReferenceTool,
    NormReference,
)
from merlt.tools.constitutional_basis import (
    ConstitutionalBasisTool,
    ConstitutionalBasis,
    EUBasis,
)
from merlt.tools.citation_chain import (
    CitationChainTool,
    Citation,
    OverrulingEvent,
    LeadingCase,
    CitationDirection,
)

__all__ = [
    # Base classes
    "BaseTool",
    "ToolResult",
    "ToolParameter",
    "ParameterType",
    "ToolChain",
    # Registry
    "ToolRegistry",
    "get_tool_registry",
    "register_tool",
    # Search tools
    "SemanticSearchTool",
    "GraphSearchTool",
    "ArticleFetchTool",
    "SearchResultItem",
    # Verification tools
    "VerificationTool",
    "VerificationResult",
    "SourceVerificationMixin",
    # Definition tools
    "DefinitionLookupTool",
    "DefinitionEntry",
    # Hierarchy tools
    "HierarchyNavigationTool",
    "HierarchyNode",
    "NavigationDirection",
    # Historical tools
    "HistoricalEvolutionTool",
    "HistoricalEvent",
    # Principle tools
    "PrincipleLookupTool",
    "LegalPrinciple",
    # External source tools
    "ExternalSourceTool",
    # Textual reference tools
    "TextualReferenceTool",
    "NormReference",
    # Constitutional basis tools
    "ConstitutionalBasisTool",
    "ConstitutionalBasis",
    "EUBasis",
    # Citation chain tools
    "CitationChainTool",
    "Citation",
    "OverrulingEvent",
    "LeadingCase",
    "CitationDirection",
]
