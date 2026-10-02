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
# An event is in the future when it takes effect after today (a parameter, never Cypher text).
# An undated one is not: nothing says it is.
_IS_FUTURE = "(event_date <> '' AND left(event_date, 10) > $today)"


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
        future: True se l'evento entra in vigore dopo oggi (mai per un evento senza data)
    """
    date: str
    event: str
    by_urn: str
    by_estremi: str
    description: Optional[str] = None
    future: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "date": self.date,
            "event": self.event,
            "by_urn": self.by_urn,
            "by_estremi": self.by_estremi,
            "description": self.description,
            "future": self.future,
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
        "Mostra anche le modifiche che entrano in vigore dopo oggi, segnate con future=true. "
        "Un'abrogazione o una sostituzione non ancora in vigore non cambia lo status di oggi: "
        "e' elencata in 'pending' (tipo e data). "
        "Passa include_future=false per vedere solo cio' che e' in vigore oggi."
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
                    "Con True (il default) la storia include anche le modifiche che entrano "
                    "in vigore dopo oggi, segnate con future=true. Con False sono escluse e "
                    "la storia mostra solo cio' che e' in vigore oggi."
                ),
                required=False,
                default=True
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
        include_future: bool = True,
        event_types: Optional[List[str]] = None
    ) -> ToolResult:
        """
        Ricostruisce la storia della norma specificata.

        Args:
            article_urn: URN della norma
            include_future: Includi gli eventi futuri, segnati `future` (default True)
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
            # Get historical events, each flagged `future`; without include_future the
            # future ones are left out, and how many is said in the metadata.
            events = await self._read_timeline(article_urn, event_types)
            timeline = events if include_future else [evt for evt in events if not evt["future"]]
            future_omitted = len(events) - len(timeline)

            # The status today, and the abrogations or replacements still to take effect
            status, pending = await self._get_status(article_urn)

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
                    "pending": pending,
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

    async def _get_timeline(
        self,
        urn: str,
        include_future: bool,
        event_types: Optional[List[str]]
    ) -> List[Dict[str, Any]]:
        """
        Recupera la timeline degli eventi storici, ciascuno segnato `future`.

        Senza `include_future` gli eventi che entrano in vigore dopo oggi sono esclusi;
        un evento senza data resta (non si sa che sia futuro).
        """
        events = await self._read_timeline(urn, event_types)
        return events if include_future else [evt for evt in events if not evt["future"]]

    async def _read_timeline(self, urn: str, event_types: Optional[List[str]]) -> List[Dict[str, Any]]:
        """Every event the graph has for the norm, flagged `future` by the query."""
        urn = canonical_urn(urn)  # the graph's key has no version marker

        rel_types = self._event_rel_types(event_types)
        if not rel_types:
            return []

        # An event is dated by `_EVENT_DATE` and flagged by `_IS_FUTURE`, against today as
        # a parameter.
        cypher = f"""
            MATCH (norma {{URN: $urn}})<-[r:{rel_types}]-(modificante)
            WITH
                type(r) AS event_type,
                modificante.URN AS by_urn,
                modificante.estremi AS by_estremi,
                {_EVENT_DATE} AS event_date,
                COALESCE(r.descrizione, '') AS description
            RETURN event_type, by_urn, by_estremi, event_date, description, {_IS_FUTURE} AS future
            ORDER BY event_date ASC
        """

        try:
            results = await self.graph_db.ro_query(cypher, {"urn": urn, "today": date.today().isoformat()})

            timeline = []
            for r in results:
                event = HistoricalEvent(
                    date=r.get("event_date", "data non disponibile"),
                    event=r.get("event_type", "").lower(),
                    by_urn=r.get("by_urn", ""),
                    by_estremi=r.get("by_estremi", "atto non specificato"),
                    description=r.get("description") or None,
                    future=bool(r.get("future")),
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
            "vigente" | "abrogato" | "sostituito" | "unknown"
        """
        status, _ = await self._get_status(urn)
        return status

    async def _get_status(self, urn: str) -> tuple[str, List[Dict[str, Any]]]:
        """
        Lo status di oggi e i cambiamenti di status ancora da entrare in vigore.

        An ABROGA or SOSTITUISCE edge counts from the day it takes effect (`_EVENT_DATE`):
        one dated after today leaves the norm as it is today and is listed in `pending`
        (type, date, the act). An undated one counts now: nothing says it is in the future.

        Returns:
            ("vigente" | "abrogato" | "sostituito" | "unknown", pending)
        """
        urn = canonical_urn(urn)  # the graph's key has no version marker

        cypher = f"""
            MATCH (norma {{URN: $urn}})
            OPTIONAL MATCH (norma)<-[r:{Rel.ABROGA.value}|{Rel.SOSTITUISCE.value}]-(modificante)
            WITH norma, r, modificante, {_EVENT_DATE} AS event_date
            RETURN
                COALESCE(norma.vigente, true) AS is_vigente,
                CASE WHEN r IS NULL THEN null ELSE type(r) END AS end_type,
                event_date,
                (r IS NOT NULL AND {_IS_FUTURE}) AS future,
                modificante.URN AS by_urn,
                modificante.estremi AS by_estremi
        """

        try:
            results = await self.graph_db.ro_query(cypher, {"urn": urn, "today": date.today().isoformat()})
        except Exception as e:
            log.debug(f"Status query failed: {e}")
            return "unknown", []

        if not results:
            return "unknown", []

        in_force: set[str] = set()
        pending: List[Dict[str, Any]] = []
        for r in results:
            end_type = r.get("end_type")
            if not end_type:
                continue
            if r.get("future"):
                pending.append({
                    "type": end_type.lower(),
                    "date": r.get("event_date") or "",
                    "by_urn": r.get("by_urn"),
                    "by_estremi": r.get("by_estremi"),
                })
            else:
                in_force.add(end_type)
        pending.sort(key=lambda change: (change["date"], change["type"]))

        # Priority: sostituito > abrogato > vigente
        if Rel.SOSTITUISCE.value in in_force:
            return "sostituito", pending
        if Rel.ABROGA.value in in_force:
            return "abrogato", pending
        if results[0].get("is_vigente", True):
            return "vigente", pending
        return "unknown", pending
