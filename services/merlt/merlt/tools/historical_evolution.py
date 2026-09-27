"""
Historical Evolution Tool
==========================

Tool per ricostruire l'evoluzione storica di una norma.

Utilizza le relazioni temporali (modifica, abroga, sostituisce) per:
- Ricostruire la timeline di modifiche di un articolo
- Determinare lo status corrente (vigente/abrogato/sostituito)
- Applicare il principio "tempus regit actum"

Esempio:
    >>> from merlt.tools import HistoricalEvolutionTool
    >>>
    >>> tool = HistoricalEvolutionTool(graph_db=falkordb)
    >>> result = await tool(article_urn="urn:norma:cc:art14")
    >>> print(result.data["current_status"])  # "vigente"
    >>> for event in result.data["timeline"]:
    ...     print(f"{event['date']}: {event['event']} by {event['by_estremi']}")
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


@dataclass
class HistoricalEvent:
    """
    Singolo evento nella storia di una norma.

    Attributes:
        date: Data dell'evento (formato ISO o atto)
        event: Tipo di evento ("modifica" | "abroga" | "sostituisce")
        by_urn: URN della norma modificante
        by_estremi: Estremi della norma modificante (es. "L. 123/2020")
        description: Descrizione testuale dell'evento
    """
    date: str
    event: str
    by_urn: str
    by_estremi: str
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "date": self.date,
            "event": self.event,
            "by_urn": self.by_urn,
            "by_estremi": self.by_estremi,
            "description": self.description
        }


class HistoricalEvolutionTool(BaseTool):
    """
    Tool per ricostruire l'evoluzione storica di una norma.

    Traccia le modifiche temporali attraverso le relazioni:
    - MODIFICA: modifiche parziali al testo
    - ABROGA: abrogazione della norma
    - SOSTITUISCE: sostituzione completa

    Applica il principio "tempus regit actum" (art. 14 c.c.):
    la norma vigente al momento del fatto è quella applicabile.

    Particolarmente utile per:
    - Expert PrecedentExpert: capire quale versione normativa applicare
    - Expert SystemicExpert: comprendere evoluzione del sistema
    - Expert PrinciplesExpert: tracciare ratio legis nel tempo

    Esempio:
        >>> tool = HistoricalEvolutionTool(graph_db=falkordb_client)
        >>> result = await tool(
        ...     article_urn="urn:norma:cc:art1453",
        ...     include_future=False
        ... )
        >>> print(f"Status: {result.data['current_status']}")
        >>> print(f"Versioni: {result.data['version_count']}")
        >>> for event in result.data['timeline']:
        ...     print(f"{event['date']}: {event['description']}")
    """

    name = "historical_evolution"
    description = (
        "Ricostruisce l'evoluzione storica di una norma. "
        "Trova tutte le modifiche, abrogazioni e sostituzioni nel tempo. "
        "Determina lo status corrente (vigente/abrogato/sostituito). "
        "Utile per applicare 'tempus regit actum' (art. 14 c.c.)."
    )

    def __init__(
        self,
        graph_db: Any = None
    ):
        """
        Inizializza HistoricalEvolutionTool.

        Args:
            graph_db: FalkorDBClient per query al grafo
        """
        super().__init__()
        self.graph_db = graph_db

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="article_urn",
                param_type=ParameterType.STRING,
                description=(
                    "URN della norma di cui ricostruire la storia. "
                    "Es: 'urn:norma:cc:art14', 'urn:norma:cp:art52'"
                )
            ),
            ToolParameter(
                name="include_future",
                param_type=ParameterType.BOOLEAN,
                description=(
                    "Se True, include anche modifiche future (entrata in vigore differita). "
                    "Utile per pianificazione normativa."
                ),
                required=False,
                default=False
            ),
            ToolParameter(
                name="event_types",
                param_type=ParameterType.ARRAY,
                description=(
                    "Filtra per tipo di evento. "
                    "Es: ['modifica'] per solo modifiche, "
                    "['abroga', 'sostituisce'] per solo cessazioni"
                ),
                required=False
            )
        ]

    async def execute(
        self,
        article_urn: str,
        include_future: bool = False,
        event_types: Optional[List[str]] = None
    ) -> ToolResult:
        """
        Ricostruisce la storia della norma specificata.

        Args:
            article_urn: URN della norma
            include_future: Includi eventi futuri
            event_types: Filtra per tipo evento

        Returns:
            ToolResult con timeline e status corrente
        """
        log.debug(
            f"historical_evolution - urn={article_urn}, "
            f"include_future={include_future}"
        )

        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        try:
            # Get historical events
            timeline = await self._get_timeline(
                article_urn, include_future, event_types
            )

            # Get current status
            status = await self._get_current_status(article_urn)

            # Count versions (modifica events)
            version_count = sum(
                1 for evt in timeline if evt["event"] == "modifica"
            ) + 1  # +1 for original version

            log.info(
                f"historical_evolution completed - "
                f"urn={article_urn}, events={len(timeline)}, status={status}"
            )

            return ToolResult.ok(
                data={
                    "article_urn": article_urn,
                    "timeline": timeline,
                    "current_status": status,
                    "version_count": version_count,
                    "total_events": len(timeline),
                    "include_future": include_future
                },
                tool_name=self.name,
                article_urn=article_urn,
                events_found=len(timeline),
                status=status
            )

        except Exception as e:
            log.error(f"historical_evolution failed: {e}")
            return ToolResult.fail(
                error=f"Errore nella ricostruzione storica: {str(e)}",
                tool_name=self.name
            )

    async def _get_timeline(
        self,
        urn: str,
        include_future: bool,
        event_types: Optional[List[str]]
    ) -> List[Dict[str, Any]]:
        """
        Recupera la timeline degli eventi storici.

        Query per trovare tutte le relazioni temporali in entrata.
        """
        # Build event type filter
        rel_types = "modifica|abroga|sostituisce"
        if event_types:
            # Normalize to uppercase for Cypher
            normalized = [e.upper() for e in event_types]
            rel_types = "|".join(normalized)

        # Date filter for future events
        date_filter = ""
        if not include_future:
            # TODO: Filter by data_vigore < today
            # For now, include all events
            pass

        cypher = f"""
            MATCH (norma {{URN: $urn}})<-[r:{rel_types}]-(modificante)
            RETURN
                type(r) AS event_type,
                modificante.URN AS by_urn,
                modificante.estremi AS by_estremi,
                COALESCE(modificante.data_atto, modificante.data_vigore, '') AS event_date,
                COALESCE(r.descrizione, '') AS description
            ORDER BY event_date ASC
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})

            timeline = []
            for r in results:
                event = HistoricalEvent(
                    date=r.get("event_date", "data non disponibile"),
                    event=r.get("event_type", "").lower(),
                    by_urn=r.get("by_urn", ""),
                    by_estremi=r.get("by_estremi", "atto non specificato"),
                    description=r.get("description") or None
                )
                timeline.append(event.to_dict())

            return timeline

        except Exception as e:
            log.debug(f"Timeline query failed: {e}")
            return []

    async def _get_current_status(self, urn: str) -> str:
        """
        Determina lo status corrente della norma.

        Returns:
            "vigente" | "abrogato" | "sostituito"
        """
        cypher = """
            MATCH (norma {URN: $urn})
            OPTIONAL MATCH (norma)<-[:ABROGA]-(abrogante)
            OPTIONAL MATCH (norma)<-[:SOSTITUISCE]-(sostituto)
            RETURN
                COALESCE(norma.vigente, true) AS is_vigente,
                abrogante IS NOT NULL AS is_abrogato,
                sostituto IS NOT NULL AS is_sostituito
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})

            if not results:
                return "unknown"

            r = results[0]
            is_vigente = r.get("is_vigente", True)
            is_abrogato = r.get("is_abrogato", False)
            is_sostituito = r.get("is_sostituito", False)

            # Priority: sostituito > abrogato > vigente
            if is_sostituito:
                return "sostituito"
            if is_abrogato:
                return "abrogato"
            if is_vigente:
                return "vigente"
            return "unknown"

        except Exception as e:
            log.debug(f"Status query failed: {e}")
            return "unknown"
