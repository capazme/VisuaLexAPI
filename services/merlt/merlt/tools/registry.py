"""
Tool Registry
==============

Registro centralizzato per tutti i tools disponibili.

Il ToolRegistry:
1. Registra tools con nomi univoci
2. Fornisce discovery (list, get, search)
3. Genera schema per LLM function calling
4. Supporta lazy loading e dependency injection

Architettura:
    Expert -> ToolRegistry -> BaseTool instances
                   |
            YAML config (tools.yaml)

Esempio:
    >>> registry = ToolRegistry()
    >>> registry.register(SemanticSearchTool())
    >>> registry.register(ArticleRetrieveTool())
    >>>
    >>> # Get tool
    >>> tool = registry.get("semantic_search")
    >>> result = await tool(query="contratto")
    >>>
    >>> # Schema per LLM
    >>> schema = registry.get_all_schemas()
"""

import structlog
from typing import Dict, List, Optional, Any, Type
from pathlib import Path
import yaml

from merlt.tools.base import BaseTool, ToolResult

log = structlog.get_logger()


class ToolRegistry:
    """
    Registro centralizzato per i tools del sistema.

    Features:
    - Registrazione tools con nomi univoci
    - Get/List tools disponibili
    - Schema generation per LLM function calling
    - Filtering per categoria
    - Lazy loading da config YAML

    Esempio:
        >>> registry = ToolRegistry()
        >>> registry.register(search_tool)
        >>> registry.register(retrieve_tool)
        >>>
        >>> # Lista tools
        >>> for name in registry.list():
        ...     print(name)
        semantic_search
        article_retrieve
        >>>
        >>> # Get e usa
        >>> tool = registry.get("semantic_search")
        >>> result = await tool(query="contratto")
    """

    def __init__(self, config_path: Optional[Path] = None):
        """
        Inizializza il registry.

        Args:
            config_path: Path opzionale a tools.yaml per config
        """
        self._tools: Dict[str, BaseTool] = {}
        self._categories: Dict[str, List[str]] = {}
        self.config_path = config_path

        log.info("ToolRegistry initialized")

    def register(
        self,
        tool: BaseTool,
        category: Optional[str] = None
    ) -> None:
        """
        Registra un tool nel registry.

        Args:
            tool: Istanza del tool da registrare
            category: Categoria opzionale (es. "search", "retrieve", "calculate")

        Raises:
            ValueError: Se un tool con lo stesso nome esiste gia'
        """
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' already registered")

        self._tools[tool.name] = tool

        # Track category
        if category:
            if category not in self._categories:
                self._categories[category] = []
            self._categories[category].append(tool.name)

        log.info(f"Tool registered: {tool.name}", category=category)

    def unregister(self, name: str) -> bool:
        """
        Rimuove un tool dal registry.

        Args:
            name: Nome del tool da rimuovere

        Returns:
            True se rimosso, False se non trovato
        """
        if name not in self._tools:
            return False

        del self._tools[name]

        # Remove from categories
        for category, tools in self._categories.items():
            if name in tools:
                tools.remove(name)

        log.info(f"Tool unregistered: {name}")
        return True

    def get(self, name: str) -> Optional[BaseTool]:
        """
        Ottiene un tool per nome.

        Args:
            name: Nome del tool

        Returns:
            BaseTool se trovato, None altrimenti
        """
        return self._tools.get(name)

    def get_required(self, name: str) -> BaseTool:
        """
        Ottiene un tool per nome, solleva errore se non trovato.

        Args:
            name: Nome del tool

        Returns:
            BaseTool

        Raises:
            KeyError: Se tool non trovato
        """
        if name not in self._tools:
            raise KeyError(f"Tool '{name}' not found in registry")
        return self._tools[name]

    def list(self, category: Optional[str] = None) -> List[str]:
        """
        Lista nomi dei tools registrati.

        Args:
            category: Filtra per categoria (opzionale)

        Returns:
            Lista di nomi tools
        """
        if category:
            return self._categories.get(category, [])
        return list(self._tools.keys())

    def list_categories(self) -> List[str]:
        """Lista le categorie disponibili."""
        return list(self._categories.keys())

    def get_all(self, category: Optional[str] = None) -> List[BaseTool]:
        """
        Ottiene tutti i tools.

        Args:
            category: Filtra per categoria (opzionale)

        Returns:
            Lista di BaseTool
        """
        names = self.list(category)
        return [self._tools[n] for n in names]

    def get_schema(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Ottiene lo schema JSON di un tool.

        Args:
            name: Nome del tool

        Returns:
            Schema JSON per function calling, o None
        """
        tool = self.get(name)
        if tool:
            return tool.get_schema()
        return None

    def get_all_schemas(
        self,
        category: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Ottiene gli schemi di tutti i tools.

        Utile per passare a LLM per function calling.

        Args:
            category: Filtra per categoria (opzionale)

        Returns:
            Lista di schemi JSON
        """
        tools = self.get_all(category)
        return [t.get_schema() for t in tools]

    async def execute(self, name: str, **kwargs) -> ToolResult:
        """
        Esegue un tool per nome.

        Shortcut per get() + execute().

        Args:
            name: Nome del tool
            **kwargs: Parametri per il tool

        Returns:
            ToolResult
        """
        tool = self.get(name)
        if not tool:
            return ToolResult.fail(f"Tool '{name}' not found")

        return await tool(**kwargs)

    def __len__(self) -> int:
        """Numero di tools registrati."""
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        """Check se tool esiste."""
        return name in self._tools

    def __iter__(self):
        """Itera sui nomi dei tools."""
        return iter(self._tools.keys())


# Singleton instance
_default_registry: Optional[ToolRegistry] = None


def get_tool_registry() -> ToolRegistry:
    """
    Ottiene l'istanza singleton del ToolRegistry.

    Returns:
        ToolRegistry condiviso
    """
    global _default_registry
    if _default_registry is None:
        _default_registry = ToolRegistry()
    return _default_registry


def register_tool(tool: BaseTool, category: Optional[str] = None) -> None:
    """
    Registra un tool nel registry singleton.

    Shortcut per get_tool_registry().register().
    """
    get_tool_registry().register(tool, category)
