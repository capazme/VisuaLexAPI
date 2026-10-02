"""
Historical Evolution Tool
==========================

Tool per ricostruire l'evoluzione storica di una norma.

Utilizza le relazioni temporali (MODIFICA, ABROGA, SOSTITUISCE) per:
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
from datetime import date
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from merlt.storage.graph.schema import Rel, canonical_urn, cypher_rel_names
from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()

# The date an amendment takes effect: on the edge, where multivigenza and the seed write it
# (`data_efficacia`); the amending act's own date only as a fallback, which no writer sets
# today. The dates are ISO strings, so they compare as text; the first ten characters are
# compared, so a date that carries a time still reads as a day. An undated event is ''.
_EVENT_DATE = "coalesce(r.data_efficacia, modificante.data_atto, modificante.data_vigore, '')"


@dataclass
class HistoricalEvent:
    """
    Singolo evento nella storia di una norma.

    Attributes:
        date: Data dell'evento (formato ISO o atto)
        event: Tipo di evento ("modifica" | "abroga" | "sostituisce" | "inserisce")
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
    - INSERISCE: inserimento di un comma o di una lettera (una modifica a tutti gli effetti)

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
        "Trova tutte le modifiche, gli inserimenti, le abrogazioni e le sostituzioni nel tempo. "
        "Determina lo status corrente (vigente/abrogato/sostituito). "
        "Utile per applicare 'tempus regit actum' (art. 14 c.c.). "
        "Per impostazione predefinita esclude le modifiche che entrano in vigore dopo oggi: "
        "se il risultato non ne elenca, non significa che non ce ne siano. "
        "Per vederle chiedi include_future=True."
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
                    "Se True, include anche le modifiche che entrano in vigore dopo oggi "
                    "(entrata in vigore differita). Con False (il default) sono escluse: "
                    "usalo per sapere se una modifica e' gia' in arrivo."
                ),
                required=False,
                default=False
            ),
            ToolParameter(
                name="event_types",
                param_type=ParameterType.ARRAY,
                description=(
                    "Filtra per tipo di evento. "
                    "Es: ['MODIFICA'] per solo modifiche, "
                    "['ABROGA', 'SOSTITUISCE'] per solo cessazioni"
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
            # What the timeline left out because it takes effect after today: metadata, so
            # the data keeps its shape.
            future_omitted = 0 if include_future else await self._count_future(article_urn, event_types)

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
                status=status,
                future_omitted=future_omitted
            )

        except Exception as e:
            log.error(f"historical_evolution failed: {e}")
            return ToolResult.fail(
                error=f"Errore nella ricostruzione storica: {str(e)}",
                tool_name=self.name
            )

    @staticmethod
    def _event_rel_types(event_types: Optional[List[str]]) -> str:
        """The graph's names (the schema's) of the events asked for, whatever case the
        caller used, joined for a relation pattern. A name the graph does not have is
        dropped; '' when none is left, and the caller then queries nothing: a filter is
        never run unfiltered. By default every amendment: an inserted comma or letter
        (INSERISCE) is one too."""
        names = cypher_rel_names(
            event_types or [Rel.MODIFICA.value, Rel.ABROGA.value, Rel.SOSTITUISCE.value, Rel.INSERISCE.value]
        )
        return "|".join(names)

    async def _count_future(self, urn: str, event_types: Optional[List[str]]) -> int:
        """How many of the events asked for take effect after today. A count the caller
        reports, never a reason to fail: on a query error it is 0."""
        rel_types = self._event_rel_types(event_types)
        if not rel_types:
            return 0
        cypher = f"""
            MATCH (norma {{URN: $urn}})<-[r:{rel_types}]-(modificante)
            WITH {_EVENT_DATE} AS event_date
            WHERE event_date <> '' AND left(event_date, 10) > $today
            RETURN count(*) AS future
        """
        try:
            rows = await self.graph_db.ro_query(cypher, {"urn": canonical_urn(urn), "today": date.today().isoformat()})
        except Exception as e:
            log.warning("historical_evolution future count failed", error_type=type(e).__name__, error=str(e))
            return 0
        return int(rows[0].get("future") or 0) if rows else 0

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
        urn = canonical_urn(urn)  # the graph's key has no version marker

        rel_types = self._event_rel_types(event_types)
        if not rel_types:
            return []

        # An event is dated by `_EVENT_DATE`. Without `include_future` an event dated after
        # today is left out and an undated one is kept (it is not known to be in the
        # future). Today is a parameter, never Cypher text.
        params: Dict[str, Any] = {"urn": urn}
        date_filter = ""
        if not include_future:
            date_filter = "WHERE event_date = '' OR left(event_date, 10) <= $today"
            params["today"] = date.today().isoformat()

        cypher = f"""
            MATCH (norma {{URN: $urn}})<-[r:{rel_types}]-(modificante)
            WITH
                type(r) AS event_type,
                modificante.URN AS by_urn,
                modificante.estremi AS by_estremi,
                {_EVENT_DATE} AS event_date,
                COALESCE(r.descrizione, '') AS description
            {date_filter}
            RETURN event_type, by_urn, by_estremi, event_date, description
            ORDER BY event_date ASC
        """

        try:
            results = await self.graph_db.ro_query(cypher, params)

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
        urn = canonical_urn(urn)  # the graph's key has no version marker

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
            results = await self.graph_db.ro_query(cypher, {"urn": urn})

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
