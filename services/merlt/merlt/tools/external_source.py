"""
External Source Tool - Recupero fonti esterne con strategia cascata.

Strategia:
1. Grafo locale (FalkorDB) - veloce, già indicizzato
2. Normattiva (NormattivaScraper) - norme italiane ufficiali
3. Brocardi (BrocardiScraper) - spiegazioni, massime, commenti

Esempio:
    >>> from merlt.tools import ExternalSourceTool
    >>>
    >>> tool = ExternalSourceTool(graph_db=falkordb)
    >>> result = await tool(
    ...     query="art. 1453 c.c.",
    ...     source_priority=["graph", "normattiva", "brocardi"]
    ... )
    >>> print(result.data["source"])  # "graph" o "normattiva" o "brocardi"
"""

import re
import structlog
from typing import Any, Dict, List, Optional

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


class ExternalSourceTool(BaseTool):
    """
    Tool unificato per recupero fonti esterne con strategia cascata.

    Cerca in ordine:
    1. Grafo locale (FalkorDB) - veloce, già indicizzato
    2. Normattiva (NormattivaScraper) - norme italiane ufficiali
    3. Brocardi (BrocardiScraper) - spiegazioni, massime, commenti

    Particolarmente utile per:
    - Expert che hanno bisogno di testo normativo non presente nel grafo
    - Fallback quando la ricerca nel grafo non restituisce risultati
    - Recupero di spiegazioni e massime da Brocardi

    Esempio:
        >>> tool = ExternalSourceTool(graph_db=falkordb, normattiva=scraper)
        >>> result = await tool(
        ...     query="art. 1453 c.c.",
        ...     require_official=True  # Solo Normattiva
        ... )
        >>> print(f"Fonte: {result.data['source']}")
    """

    name = "external_source"
    description = (
        "Recupera il testo di una fonte normativa da sorgenti esterne. "
        "Supporta ricerca a cascata su grafo locale, Normattiva e Brocardi. "
        "Usa questo tool quando hai bisogno del testo completo di una norma "
        "che potrebbe non essere nel database locale."
    )

    def __init__(
        self,
        graph_db: Any = None,
        normattiva_scraper: Any = None,
        brocardi_scraper: Any = None,
    ):
        """
        Inizializza ExternalSourceTool.

        Args:
            graph_db: FalkorDBClient per query al grafo locale
            normattiva_scraper: NormattivaScraper (lazy init se None)
            brocardi_scraper: BrocardiScraper (lazy init se None)
        """
        super().__init__()
        self.graph_db = graph_db
        self._normattiva_scraper = normattiva_scraper
        self._brocardi_scraper = brocardi_scraper

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="query",
                param_type=ParameterType.STRING,
                description=(
                    "Identificativo della norma. "
                    "Es: 'art. 1453 c.c.', 'codice penale art. 52', "
                    "'legittima difesa', 'urn:norma:cc:art1453'"
                )
            ),
            ToolParameter(
                name="source_priority",
                param_type=ParameterType.ARRAY,
                description=(
                    "Lista ordinata di sorgenti da consultare. "
                    "Valori: 'graph', 'normattiva', 'brocardi'. "
                    "Default: ['graph', 'normattiva', 'brocardi']"
                ),
                required=False
            ),
            ToolParameter(
                name="require_official",
                param_type=ParameterType.BOOLEAN,
                description=(
                    "Se True, usa solo fonti ufficiali (Normattiva). "
                    "Esclude Brocardi dalla cascata."
                ),
                required=False,
                default=False
            )
        ]

    async def execute(
        self,
        query: str,
        source_priority: Optional[List[str]] = None,
        require_official: bool = False,
    ) -> ToolResult:
        """
        Esegue la ricerca a cascata sulle fonti esterne.

        Args:
            query: Identificativo norma (es. "art. 1453 c.c.")
            source_priority: Ordine sorgenti ["graph", "normattiva", "brocardi"]
            require_official: Se True, solo Normattiva

        Returns:
            ToolResult con:
            - text: Testo della norma
            - urn: URN normalizzato
            - source: Sorgente usata ("graph" | "normattiva" | "brocardi")
            - fallback_used: True se non prima scelta
        """
        if source_priority is None:
            source_priority = ["graph", "normattiva", "brocardi"]

        if require_official:
            source_priority = [s for s in source_priority if s in ["graph", "normattiva"]]

        log.info(
            f"external_source - query='{query}', priority={source_priority}"
        )

        first_source = source_priority[0] if source_priority else None

        for idx, source in enumerate(source_priority):
            try:
                result = None

                if source == "graph":
                    result = await self._search_graph(query)
                elif source == "normattiva":
                    result = await self._fetch_normattiva(query)
                elif source == "brocardi":
                    if not require_official:
                        result = await self._fetch_brocardi(query)
                else:
                    log.warning(f"Sorgente sconosciuta: {source}")
                    continue

                if result:
                    fallback_used = (idx > 0)
                    log.info(
                        f"external_source completed - "
                        f"query='{query}', source={source}, fallback={fallback_used}"
                    )

                    return ToolResult.ok(
                        data={
                            "text": result["text"],
                            "urn": result["urn"],
                            "source": source,
                            "fallback_used": fallback_used,
                            "metadata": result.get("metadata", {}),
                        },
                        tool_name=self.name,
                        query=query,
                        source=source
                    )

            except Exception as e:
                log.warning(f"Errore con sorgente {source}: {e}")
                continue

        log.error(f"external_source failed - query='{query}' non trovata")
        return ToolResult.fail(
            error=f"Fonte non trovata per query '{query}' in nessuna sorgente",
            tool_name=self.name
        )

    async def _search_graph(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Cerca nel grafo locale FalkorDB.

        Args:
            query: Identificativo norma

        Returns:
            Dict con text, urn, metadata oppure None
        """
        if self.graph_db is None:
            return None

        # Parse query per estrarre URN
        urn = self._parse_urn_from_query(query)

        # Se abbiamo un URN, cerca direttamente
        if urn:
            cypher = """
            MATCH (a:Norma {URN: $urn})
            RETURN a.testo_vigente AS text, a.URN AS urn,
                   a.estremi AS estremi, a.numero_articolo AS numero
            """
            params = {"urn": urn}
        else:
            # Cerca per estremi o numero articolo
            cypher = """
            MATCH (a:Norma)
            WHERE a.estremi CONTAINS $query
               OR a.numero_articolo = $query
               OR toLower(a.testo_vigente) CONTAINS toLower($query)
            RETURN a.testo_vigente AS text, a.URN AS urn,
                   a.estremi AS estremi, a.numero_articolo AS numero
            LIMIT 1
            """
            params = {"query": query}

        try:
            result = await self.graph_db.query(cypher, params)

            if result and len(result) > 0:
                row = result[0]
                return {
                    "text": row.get("text", ""),
                    "urn": row.get("urn", ""),
                    "metadata": {
                        "estremi": row.get("estremi"),
                        "numero": row.get("numero"),
                        "source": "graph"
                    },
                }
        except Exception as e:
            log.debug(f"Graph search failed: {e}")

        return None

    async def _fetch_normattiva(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Recupera da Normattiva.

        Args:
            query: Identificativo norma

        Returns:
            Dict con text, urn, metadata oppure None
        """
        # Lazy init scraper
        if self._normattiva_scraper is None:
            try:
                from merlt.clients import NormattivaScraper
                self._normattiva_scraper = NormattivaScraper()
            except ImportError:
                log.warning("NormattivaScraper non disponibile")
                return None

        # Parse query per estrarre tipo atto e articolo
        parsed = self._parse_normattiva_query(query)
        if not parsed:
            return None

        try:
            from merlt.clients import Norma, NormaVisitata

            norma = Norma(
                tipo_atto=parsed["tipo_atto"],
                data=parsed.get("data_atto"),
                numero_atto=parsed.get("numero_atto")
            )

            norma_visitata = NormaVisitata(
                norma=norma,
                numero_articolo=parsed["articolo"]
            )

            text, urn = await self._normattiva_scraper.get_document(norma_visitata)

            if text:
                return {
                    "text": text,
                    "urn": urn,
                    "metadata": {
                        "tipo_atto": parsed["tipo_atto"],
                        "articolo": parsed["articolo"],
                        "source": "normattiva"
                    },
                }

        except Exception as e:
            log.debug(f"Normattiva fetch failed: {e}")

        return None

    async def _fetch_brocardi(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Recupera da Brocardi.

        Args:
            query: Identificativo norma

        Returns:
            Dict con text, urn, metadata oppure None
        """
        # Lazy init scraper
        if self._brocardi_scraper is None:
            try:
                from merlt.clients import BrocardiScraper
                self._brocardi_scraper = BrocardiScraper()
            except ImportError:
                log.warning("BrocardiScraper non disponibile")
                return None

        try:
            result = await self._brocardi_scraper.search(query)

            if result and result.get("text"):
                return {
                    "text": result["text"],
                    "urn": result.get("urn", ""),
                    "metadata": {
                        "spiegazione": result.get("spiegazione", ""),
                        "massime": result.get("massime", []),
                        "source": "brocardi"
                    },
                }

        except Exception as e:
            log.debug(f"Brocardi fetch failed: {e}")

        return None

    def _parse_urn_from_query(self, query: str) -> Optional[str]:
        """
        Estrae URN da query.

        Args:
            query: Query utente

        Returns:
            URN normalizzato oppure None
        """
        # Se query è già un URN, ritornalo
        if query.startswith("urn:"):
            return query

        query_lower = query.lower().strip()

        # Pattern codice civile: "art. 1453 c.c." → URN
        if "c.c." in query_lower or "codice civile" in query_lower:
            match = re.search(r'art(?:\.|icolo)?\s*(\d+)', query_lower)
            if match:
                num_art = match.group(1)
                return f"urn:nir:stato:regio.decreto:1942-03-16;262~art{num_art}"

        # Pattern codice penale: "art. 52 c.p." → URN
        if "c.p." in query_lower or "codice penale" in query_lower:
            match = re.search(r'art(?:\.|icolo)?\s*(\d+)', query_lower)
            if match:
                num_art = match.group(1)
                return f"urn:nir:stato:regio.decreto:1930-10-19;1398~art{num_art}"

        return None

    def _parse_normattiva_query(self, query: str) -> Optional[Dict[str, str]]:
        """
        Parse query per Normattiva.

        Args:
            query: Query utente

        Returns:
            Dict con tipo_atto e articolo oppure None
        """
        query_lower = query.lower().strip()

        # Codice civile
        if "c.c." in query_lower or "codice civile" in query_lower:
            match = re.search(r'art(?:\.|icolo)?\s*(\d+)', query_lower)
            if match:
                return {
                    "tipo_atto": "codice civile",
                    "articolo": match.group(1),
                }

        # Codice penale
        if "c.p." in query_lower or "codice penale" in query_lower:
            match = re.search(r'art(?:\.|icolo)?\s*(\d+)', query_lower)
            if match:
                return {
                    "tipo_atto": "codice penale",
                    "articolo": match.group(1),
                }

        # Costituzione
        if "cost." in query_lower or "costituzione" in query_lower:
            match = re.search(r'art(?:\.|icolo)?\s*(\d+)', query_lower)
            if match:
                return {
                    "tipo_atto": "costituzione",
                    "articolo": match.group(1),
                }

        return None
