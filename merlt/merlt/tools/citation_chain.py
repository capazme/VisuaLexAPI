"""
Citation Chain Tool
===================

Tool per tracciare catene di citazioni giurisprudenziali e rilevare overruling.

Permette di:
1. Trovare precedenti citati da una sentenza (citing)
2. Trovare sentenze che citano un precedente (cited_by)
3. Identificare leading cases (più citati)
4. Rilevare eventi di overruling

Relazioni:
    - cita: sentenza → precedente citato
    - conferma: sentenza → precedente confermato
    - supera: sentenza → precedente superato (overruling)

Esempio:
    >>> from merlt.tools import CitationChainTool
    >>>
    >>> tool = CitationChainTool(graph_db=falkordb)
    >>> result = await tool(
    ...     case_urn="urn:giurisprudenza:cass:2024:12345",
    ...     direction="both",
    ...     detect_overruling=True
    ... )
    >>> # Returns: citation chain, leading cases, overruling events
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum
from datetime import datetime

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


class CitationDirection(str, Enum):
    """Direzione di ricerca delle citazioni."""
    CITING = "citing"        # Citazioni uscenti (questa sentenza cita...)
    CITED_BY = "cited_by"    # Citazioni entranti (questa sentenza è citata da...)
    BOTH = "both"            # Entrambe le direzioni


@dataclass
class Citation:
    """
    Una citazione giurisprudenziale.

    Attributes:
        from_case: URN del caso citante
        to_case: URN del caso citato
        to_estremi: Riferimento leggibile del caso citato
        relation: Tipo di relazione ("cita" | "conferma" | "supera")
        depth: Profondità nella catena (1 = diretto, >1 = indiretto)
        year_delta: Differenza anni tra citante e citato
        cited_date: Data del caso citato
    """
    from_case: str
    to_case: str
    to_estremi: str
    relation: str
    depth: int
    year_delta: Optional[int] = None
    cited_date: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "from_case": self.from_case,
            "to_case": self.to_case,
            "to_estremi": self.to_estremi,
            "relation": self.relation,
            "depth": self.depth,
            "year_delta": self.year_delta,
            "cited_date": self.cited_date
        }


@dataclass
class OverrulingEvent:
    """
    Un evento di overruling (superamento di precedente).

    Attributes:
        old_case: URN del precedente superato
        old_estremi: Riferimento leggibile del precedente superato
        new_case: URN della sentenza che supera
        new_estremi: Riferimento leggibile della sentenza che supera
        date: Data dell'overruling
    """
    old_case: str
    old_estremi: str
    new_case: str
    new_estremi: str
    date: str

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "old_case": self.old_case,
            "old_estremi": self.old_estremi,
            "new_case": self.new_case,
            "new_estremi": self.new_estremi,
            "overruling_date": self.date
        }


@dataclass
class LeadingCase:
    """
    Un leading case (precedente molto citato).

    Attributes:
        urn: URN del caso
        estremi: Riferimento leggibile
        citation_count: Numero di citazioni ricevute
    """
    urn: str
    estremi: str
    citation_count: int

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "urn": self.urn,
            "estremi": self.estremi,
            "citation_count": self.citation_count
        }


class CitationChainTool(BaseTool):
    """
    Tool per tracciare catene di citazioni giurisprudenziali.

    Permette di:
    1. Trovare precedenti citati da una sentenza (catena uscente)
    2. Trovare sentenze che citano un precedente (catena entrante)
    3. Identificare leading cases (precedenti più influenti)
    4. Rilevare eventi di overruling (superamento giurisprudenziale)

    Utile per:
    - Expert PrecedentExpert: analizzare autorevolezza e reti di precedenti
    - Expert SystemicExpert: comprendere evoluzione giurisprudenziale
    - Ricerca giuridica: mappare influenza di una sentenza

    Esempio:
        >>> tool = CitationChainTool(graph_db=falkordb_client)
        >>> result = await tool(
        ...     case_urn="urn:giurisprudenza:cass:2024:12345",
        ...     direction="both",
        ...     max_depth=3,
        ...     detect_overruling=True
        ... )
        >>> print(f"Citazioni trovate: {len(result.data['citation_chain'])}")
        >>> print(f"Leading cases: {len(result.data['leading_cases'])}")
        >>> if result.data['overruling_events']:
        ...     print(f"Overruling rilevati: {len(result.data['overruling_events'])}")
    """

    name = "citation_chain"
    description = (
        "Traccia catene di citazioni giurisprudenziali. "
        "Trova precedenti citati da una sentenza, sentenze che citano un precedente, "
        "identifica leading cases e rileva eventi di overruling. "
        "Utile per analizzare autorevolezza e reti di precedenti."
    )

    def __init__(
        self,
        graph_db: Any = None,
        max_depth: int = 3
    ):
        """
        Inizializza CitationChainTool.

        Args:
            graph_db: FalkorDBClient per query al grafo
            max_depth: Profondità massima catena citazioni
        """
        super().__init__()
        self.graph_db = graph_db
        self.max_depth = max_depth

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="case_urn",
                param_type=ParameterType.STRING,
                description=(
                    "URN o estremi del caso giudiziario. "
                    "Es: 'urn:giurisprudenza:cass:2024:12345', 'Cass. 12345/2024'"
                )
            ),
            ToolParameter(
                name="direction",
                param_type=ParameterType.STRING,
                description=(
                    "Direzione ricerca citazioni: "
                    "'citing' (precedenti citati da questo caso), "
                    "'cited_by' (sentenze che citano questo caso), "
                    "'both' (entrambe le direzioni)"
                ),
                required=False,
                enum=["citing", "cited_by", "both"],
                default="both"
            ),
            ToolParameter(
                name="max_depth",
                param_type=ParameterType.INTEGER,
                description="Profondità massima catena citazioni (1-5)",
                required=False,
                default=3
            ),
            ToolParameter(
                name="detect_overruling",
                param_type=ParameterType.BOOLEAN,
                description="Se True, rileva eventi di overruling (relazione 'supera')",
                required=False,
                default=True
            ),
            ToolParameter(
                name="include_leading_cases",
                param_type=ParameterType.BOOLEAN,
                description="Se True, identifica leading cases (più citati)",
                required=False,
                default=True
            )
        ]

    async def execute(
        self,
        case_urn: str,
        direction: str = "both",
        max_depth: int = 3,
        detect_overruling: bool = True,
        include_leading_cases: bool = True
    ) -> ToolResult:
        """
        Traccia catena citazioni per il caso specificato.

        Args:
            case_urn: URN o identificativo del caso
            direction: Direzione ricerca ("citing" | "cited_by" | "both")
            max_depth: Profondità massima catena
            detect_overruling: Rileva eventi di overruling
            include_leading_cases: Identifica leading cases

        Returns:
            ToolResult con citation_chain, leading_cases, overruling_events
        """
        log.debug(
            f"citation_chain - case={case_urn}, "
            f"direction={direction}, max_depth={max_depth}"
        )

        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        # Validate max_depth
        max_depth = min(max(1, max_depth), 5)  # Clamp between 1-5

        try:
            # Find the case node
            case_info = await self._find_case_node(case_urn)
            if not case_info:
                return ToolResult.fail(
                    error=f"Caso giudiziario non trovato: {case_urn}",
                    tool_name=self.name
                )

            # Collect citations based on direction
            citations = []

            if direction in ["citing", "both"]:
                citing = await self._get_citing_chain(
                    case_info["urn"], max_depth
                )
                citations.extend(citing)

            if direction in ["cited_by", "both"]:
                cited_by = await self._get_cited_by_chain(
                    case_info["urn"], max_depth
                )
                citations.extend(cited_by)

            # Detect overruling events if requested
            overruling_events = []
            if detect_overruling:
                overruling_events = await self._detect_overruling(case_info["urn"])

            # Find leading cases if requested
            leading_cases = []
            if include_leading_cases:
                leading_cases = await self._find_leading_cases()

            log.info(
                f"citation_chain completed - "
                f"case={case_urn}, citations={len(citations)}, "
                f"overruling={len(overruling_events)}, leading={len(leading_cases)}"
            )

            return ToolResult.ok(
                data={
                    "case": case_info,
                    "direction": direction,
                    "citation_chain": [c.to_dict() for c in citations],
                    "total_citations": len(citations),
                    "leading_cases": [lc.to_dict() for lc in leading_cases],
                    "overruling_events": [oe.to_dict() for oe in overruling_events],
                    "max_depth": max_depth
                },
                tool_name=self.name,
                case_urn=case_urn,
                citations_found=len(citations),
                overruling_found=len(overruling_events)
            )

        except Exception as e:
            log.error(f"citation_chain failed: {e}")
            return ToolResult.fail(
                error=f"Errore nel tracciamento citazioni: {str(e)}",
                tool_name=self.name
            )

    async def _find_case_node(self, identifier: str) -> Optional[Dict[str, Any]]:
        """
        Trova il nodo caso giudiziario nel grafo.

        Cerca per:
        - URN completo
        - Estremi (es. "Cass. 12345/2024")
        """
        cypher = """
            MATCH (n:AttoGiudiziario)
            WHERE n.URN = $id
               OR n.estremi = $id
               OR n.numero_atto = $id
            RETURN
                n.URN AS urn,
                n.estremi AS estremi,
                n.data_atto AS data,
                n.organo AS organo
            LIMIT 1
        """

        try:
            results = await self.graph_db.query(cypher, {"id": identifier})
            if results:
                return {
                    "urn": results[0].get("urn", ""),
                    "estremi": results[0].get("estremi", identifier),
                    "data": results[0].get("data"),
                    "organo": results[0].get("organo")
                }
            return None
        except Exception as e:
            log.debug(f"Case node search failed: {e}")
            return None

    async def _get_citing_chain(
        self,
        urn: str,
        max_depth: int
    ) -> List[Citation]:
        """
        Ottiene catena citazioni uscenti (citing).

        Trova precedenti citati da questo caso.
        """
        cypher = f"""
            MATCH path = (case:AttoGiudiziario {{URN: $urn}})-[:cita|conferma|supera*1..{max_depth}]->(cited)
            RETURN
                case.URN as from_case,
                cited.URN as to_case,
                cited.estremi as to_estremi,
                cited.data_atto as cited_date,
                [r in relationships(path) | type(r)][-1] as relation,
                length(path) as depth
            ORDER BY depth ASC, cited.data_atto DESC
            LIMIT 50
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})
            citations = []

            for r in results:
                year_delta = None
                cited_date = r.get("cited_date")

                # Calculate year delta if dates available
                if cited_date:
                    try:
                        cited_year = int(cited_date[:4]) if len(cited_date) >= 4 else None
                        case_info = await self._find_case_node(urn)
                        if case_info and case_info.get("data"):
                            case_year = int(case_info["data"][:4])
                            if cited_year:
                                year_delta = case_year - cited_year
                    except (ValueError, TypeError):
                        pass

                citations.append(Citation(
                    from_case=r.get("from_case", ""),
                    to_case=r.get("to_case", ""),
                    to_estremi=r.get("to_estremi", ""),
                    relation=r.get("relation", "cita"),
                    depth=r.get("depth", 1),
                    year_delta=year_delta,
                    cited_date=cited_date
                ))

            return citations
        except Exception as e:
            log.debug(f"Citing chain query failed: {e}")
            return []

    async def _get_cited_by_chain(
        self,
        urn: str,
        max_depth: int
    ) -> List[Citation]:
        """
        Ottiene catena citazioni entranti (cited_by).

        Trova sentenze che citano questo caso.
        """
        cypher = f"""
            MATCH path = (case:AttoGiudiziario {{URN: $urn}})<-[:cita|conferma|supera*1..{max_depth}]-(citing)
            RETURN
                citing.URN as from_case,
                case.URN as to_case,
                citing.estremi as from_estremi,
                citing.data_atto as citing_date,
                [r in relationships(path) | type(r)][0] as relation,
                length(path) as depth
            ORDER BY citing.data_atto DESC
            LIMIT 50
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})
            citations = []

            for r in results:
                year_delta = None
                citing_date = r.get("citing_date")

                # Calculate year delta if dates available
                if citing_date:
                    try:
                        citing_year = int(citing_date[:4]) if len(citing_date) >= 4 else None
                        case_info = await self._find_case_node(urn)
                        if case_info and case_info.get("data"):
                            case_year = int(case_info["data"][:4])
                            if citing_year:
                                year_delta = citing_year - case_year
                    except (ValueError, TypeError):
                        pass

                citations.append(Citation(
                    from_case=r.get("from_case", ""),
                    to_case=r.get("to_case", ""),
                    to_estremi=r.get("from_estremi", ""),
                    relation=r.get("relation", "cita"),
                    depth=r.get("depth", 1),
                    year_delta=year_delta,
                    cited_date=citing_date
                ))

            return citations
        except Exception as e:
            log.debug(f"Cited by chain query failed: {e}")
            return []

    async def _detect_overruling(self, urn: str) -> List[OverrulingEvent]:
        """
        Rileva eventi di overruling.

        Trova relazioni di tipo "supera" coinvolgenti questo caso.
        """
        cypher = """
            MATCH (old:AttoGiudiziario)<-[:supera]-(new:AttoGiudiziario)
            WHERE old.URN = $urn OR new.URN = $urn
            RETURN
                old.URN as old_case,
                old.estremi as old_estremi,
                new.URN as new_case,
                new.estremi as new_estremi,
                new.data_atto as overruling_date
            ORDER BY overruling_date DESC
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})
            events = []

            for r in results:
                events.append(OverrulingEvent(
                    old_case=r.get("old_case", ""),
                    old_estremi=r.get("old_estremi", ""),
                    new_case=r.get("new_case", ""),
                    new_estremi=r.get("new_estremi", ""),
                    date=r.get("overruling_date", "")
                ))

            return events
        except Exception as e:
            log.debug(f"Overruling detection failed: {e}")
            return []

    async def _find_leading_cases(self) -> List[LeadingCase]:
        """
        Trova leading cases (precedenti più citati).

        Ritorna top 10 casi per numero di citazioni ricevute.
        """
        cypher = """
            MATCH (case:AttoGiudiziario)<-[r:cita]-(citing)
            WITH case, count(citing) as citation_count
            ORDER BY citation_count DESC
            RETURN
                case.URN as urn,
                case.estremi as estremi,
                citation_count
            LIMIT 10
        """

        try:
            results = await self.graph_db.query(cypher, {})
            cases = []

            for r in results:
                cases.append(LeadingCase(
                    urn=r.get("urn", ""),
                    estremi=r.get("estremi", ""),
                    citation_count=r.get("citation_count", 0)
                ))

            return cases
        except Exception as e:
            log.debug(f"Leading cases query failed: {e}")
            return []
