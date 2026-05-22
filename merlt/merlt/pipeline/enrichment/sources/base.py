"""
Base Enrichment Source
======================

Interfaccia astratta per fonti di enrichment.

Tutte le fonti (Brocardi, Manual, etc.) devono implementare questa interfaccia.

Esempio implementazione:
    class MySource(BaseEnrichmentSource):
        @property
        def source_name(self) -> str:
            return "my_source"

        async def fetch(self, scope) -> AsyncIterator[EnrichmentContent]:
            async for item in self._fetch_items(scope):
                yield EnrichmentContent(
                    id=f"my_source:{item.id}",
                    text=item.text,
                    article_refs=item.refs,
                    source=self.source_name,
                )
"""

from abc import ABC, abstractmethod
from typing import AsyncIterator, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from merlt.pipeline.enrichment.config import EnrichmentScope
    from merlt.pipeline.enrichment.models import EnrichmentContent


class BaseEnrichmentSource(ABC):
    """
    Interfaccia base per fonti di enrichment.

    Ogni fonte deve implementare:
    - source_name: Nome univoco della fonte
    - fetch: Generator asincrono che produce EnrichmentContent

    Attributes:
        _initialized: Flag per inizializzazione lazy
        phase: Fase di esecuzione (1 = primaria, 2 = arricchimento)
    """

    def __init__(self, phase: int = 1):
        """
        Inizializza la fonte base.

        Args:
            phase: Fase di esecuzione. Le fonti vengono eseguite in ordine
                   di fase (1 prima, poi 2, etc.). Default: 1.
        """
        self._initialized = False
        self.phase = phase

    @property
    @abstractmethod
    def source_name(self) -> str:
        """
        Nome univoco della fonte.

        Usato per tracking e logging.

        Returns:
            Nome stringa (es. "brocardi", "manuale:Torrente")
        """
        pass

    @abstractmethod
    async def fetch(
        self,
        scope: Optional["EnrichmentScope"] = None
    ) -> AsyncIterator["EnrichmentContent"]:
        """
        Recupera contenuti dalla fonte.

        Generator asincrono che produce contenuti uno alla volta,
        permettendo elaborazione streaming e checkpoint.

        Args:
            scope: Filtro opzionale per articoli/libro

        Yields:
            EnrichmentContent per ogni contenuto trovato

        Example:
            >>> async for content in source.fetch(scope):
            ...     print(f"Processing: {content.id}")
        """
        pass
        # Placeholder per type checking - subclasses implementano il vero generator
        yield  # type: ignore

    async def initialize(self) -> None:
        """
        Inizializzazione lazy della fonte.

        Chiamato automaticamente prima del primo fetch.
        Override per inizializzazione custom (connessioni, etc.).
        """
        self._initialized = True

    async def close(self) -> None:
        """
        Cleanup risorse.

        Override per chiudere connessioni, file, etc.
        """
        pass

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}({self.source_name})>"
