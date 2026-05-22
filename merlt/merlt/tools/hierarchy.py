"""
Hierarchy Navigation Tool
==========================

Tool per navigare la gerarchia normativa nel knowledge graph.

Struttura gerarchica tipica:
    Codice → Libro → Titolo → Capo → Sezione → Articolo

Relazioni:
    - CONTIENE: genitore → figlio
    - CONTENUTO_IN: figlio → genitore (inversa)
    - PRECEDE/SEGUE: ordine sequenziale

Esempio:
    >>> from merlt.tools import HierarchyNavigationTool
    >>>
    >>> tool = HierarchyNavigationTool(graph_db=falkordb)
    >>> result = await tool(
    ...     start_node="urn:norma:cc:art1453",
    ...     direction="ancestors"
    ... )
    >>> # Returns: [Art. 1453, Sezione I, Capo XIV, Titolo I, Libro IV, C.C.]
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from enum import Enum

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


class NavigationDirection(str, Enum):
    """Direzione di navigazione nella gerarchia."""
    ANCESTORS = "ancestors"      # Risalire verso la radice
    DESCENDANTS = "descendants"  # Scendere verso le foglie
    SIBLINGS = "siblings"        # Nodi allo stesso livello
    CONTEXT = "context"          # Ancestors + siblings + nearby descendants


@dataclass
class HierarchyNode:
    """
    Nodo nella gerarchia normativa.

    Attributes:
        urn: URN del nodo
        tipo: Tipo strutturale (Codice, Libro, Titolo, Capo, Sezione, Articolo)
        estremi: Riferimento completo (es. "Art. 1453 c.c.")
        rubrica: Titolo/rubrica del nodo
        depth: Profondità nella gerarchia (0 = radice)
        order: Posizione tra i siblings
    """
    urn: str
    tipo: str
    estremi: str
    rubrica: Optional[str] = None
    depth: int = 0
    order: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "urn": self.urn,
            "tipo": self.tipo,
            "estremi": self.estremi,
            "rubrica": self.rubrica,
            "depth": self.depth,
            "order": self.order
        }


class HierarchyNavigationTool(BaseTool):
    """
    Tool per navigare la gerarchia del sistema normativo.

    Permette di:
    1. Risalire la gerarchia (articolo → capo → titolo → libro → codice)
    2. Scendere ai discendenti (libro → titoli → capi → articoli)
    3. Trovare nodi fratelli (articoli nello stesso capo)
    4. Ottenere contesto strutturale completo

    Utile per:
    - Expert SystemicExpert: capire posizione sistematica di una norma
    - Expert LiteralExpert: trovare norme correlate per struttura
    - Navigation: permettere all'utente di esplorare

    Esempio:
        >>> tool = HierarchyNavigationTool(graph_db=falkordb_client)
        >>> result = await tool(
        ...     start_node="urn:norma:cc:art1453",
        ...     direction="ancestors",
        ...     max_depth=5
        ... )
        >>> for node in result.data["hierarchy"]:
        ...     indent = "  " * node["depth"]
        ...     print(f"{indent}{node['estremi']}: {node['rubrica']}")
    """

    name = "hierarchy_navigation"
    description = (
        "Naviga la struttura gerarchica del sistema normativo. "
        "Trova antenati (capo, titolo, libro), discendenti (sotto-articoli), "
        "o fratelli (articoli nello stesso capo). Utile per capire il contesto "
        "sistematico di una norma."
    )

    def __init__(
        self,
        graph_db: Any = None,
        max_depth: int = 5
    ):
        """
        Inizializza HierarchyNavigationTool.

        Args:
            graph_db: FalkorDBClient per query al grafo
            max_depth: Profondità massima di navigazione
        """
        super().__init__()
        self.graph_db = graph_db
        self.max_depth = max_depth

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="start_node",
                param_type=ParameterType.STRING,
                description=(
                    "URN o estremi del nodo di partenza. "
                    "Es: 'urn:norma:cc:art1453', 'Art. 1453 c.c.', '1453'"
                )
            ),
            ToolParameter(
                name="direction",
                param_type=ParameterType.STRING,
                description=(
                    "Direzione di navigazione: "
                    "'ancestors' (verso radice), "
                    "'descendants' (verso foglie), "
                    "'siblings' (stesso livello), "
                    "'context' (tutto intorno)"
                ),
                required=False,
                enum=["ancestors", "descendants", "siblings", "context"],
                default="context"
            ),
            ToolParameter(
                name="max_depth",
                param_type=ParameterType.INTEGER,
                description="Profondità massima di navigazione",
                required=False,
                default=5
            ),
            ToolParameter(
                name="include_text",
                param_type=ParameterType.BOOLEAN,
                description="Se True, include il testo dei nodi trovati",
                required=False,
                default=False
            ),
            ToolParameter(
                name="tipo_filter",
                param_type=ParameterType.ARRAY,
                description=(
                    "Filtra per tipo di nodo. "
                    "Es: ['Articolo', 'Capo'] per solo questi livelli"
                ),
                required=False
            )
        ]

    async def execute(
        self,
        start_node: str,
        direction: str = "context",
        max_depth: int = 5,
        include_text: bool = False,
        tipo_filter: Optional[List[str]] = None
    ) -> ToolResult:
        """
        Naviga la gerarchia a partire dal nodo specificato.

        Args:
            start_node: URN o identificativo del nodo di partenza
            direction: Direzione di navigazione
            max_depth: Profondità massima
            include_text: Includi testo dei nodi
            tipo_filter: Filtra per tipo nodo

        Returns:
            ToolResult con gerarchia navigata
        """
        log.debug(
            f"hierarchy_navigation - start={start_node}, "
            f"direction={direction}, max_depth={max_depth}"
        )

        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        try:
            # Find the starting node
            start_info = await self._find_start_node(start_node)
            if not start_info:
                return ToolResult.fail(
                    error=f"Nodo non trovato: {start_node}",
                    tool_name=self.name
                )

            # Navigate based on direction
            hierarchy = []

            if direction == "ancestors":
                hierarchy = await self._get_ancestors(
                    start_info["urn"], max_depth, include_text, tipo_filter
                )
            elif direction == "descendants":
                hierarchy = await self._get_descendants(
                    start_info["urn"], max_depth, include_text, tipo_filter
                )
            elif direction == "siblings":
                hierarchy = await self._get_siblings(
                    start_info["urn"], include_text, tipo_filter
                )
            else:  # context
                hierarchy = await self._get_context(
                    start_info["urn"], max_depth, include_text, tipo_filter
                )

            # Build path string
            path_str = self._build_path_string(hierarchy, direction)

            log.info(
                f"hierarchy_navigation completed - "
                f"start={start_node}, found={len(hierarchy)} nodes"
            )

            return ToolResult.ok(
                data={
                    "start_node": start_info,
                    "direction": direction,
                    "hierarchy": hierarchy,
                    "total_nodes": len(hierarchy),
                    "path": path_str,
                    "max_depth_reached": max_depth
                },
                tool_name=self.name,
                start_node=start_node,
                direction=direction,
                nodes_found=len(hierarchy)
            )

        except Exception as e:
            log.error(f"hierarchy_navigation failed: {e}")
            return ToolResult.fail(
                error=f"Errore nella navigazione: {str(e)}",
                tool_name=self.name
            )

    async def _find_start_node(self, identifier: str) -> Optional[Dict[str, Any]]:
        """
        Trova il nodo di partenza nel grafo.

        Cerca per:
        - URN completo
        - Estremi (es. "Art. 1453 c.c.")
        - Numero articolo (es. "1453")
        """
        cypher = """
            MATCH (n)
            WHERE n.URN = $id
               OR n.estremi = $id
               OR n.numero_articolo = $id
               OR n.nome = $id
            RETURN
                n.URN AS urn,
                labels(n)[0] AS tipo,
                n.estremi AS estremi,
                n.rubrica AS rubrica,
                n.numero_articolo AS numero
            LIMIT 1
        """

        try:
            results = await self.graph_db.query(cypher, {"id": identifier})
            if results:
                return {
                    "urn": results[0].get("urn", ""),
                    "tipo": results[0].get("tipo", "Unknown"),
                    "estremi": results[0].get("estremi", identifier),
                    "rubrica": results[0].get("rubrica"),
                    "numero": results[0].get("numero")
                }
            return None
        except Exception as e:
            log.debug(f"Start node search failed: {e}")
            return None

    async def _get_ancestors(
        self,
        urn: str,
        max_depth: int,
        include_text: bool,
        tipo_filter: Optional[List[str]]
    ) -> List[Dict[str, Any]]:
        """
        Risale la gerarchia verso la radice.

        Relazioni seguite: CONTENUTO_IN (child → parent)
        """
        text_field = ", n.testo_vigente AS testo" if include_text else ""
        tipo_where = ""
        if tipo_filter:
            tipo_list = "', '".join(tipo_filter)
            tipo_where = f"AND labels(n)[0] IN ['{tipo_list}']"

        cypher = f"""
            MATCH path = (start)-[:CONTENUTO_IN*1..{max_depth}]->(n)
            WHERE start.URN = $urn {tipo_where}
            RETURN
                n.URN AS urn,
                labels(n)[0] AS tipo,
                n.estremi AS estremi,
                n.rubrica AS rubrica,
                length(path) AS depth
                {text_field}
            ORDER BY depth ASC
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})
            return [
                {
                    "urn": r.get("urn", ""),
                    "tipo": r.get("tipo", "Unknown"),
                    "estremi": r.get("estremi", ""),
                    "rubrica": r.get("rubrica"),
                    "depth": r.get("depth", 0),
                    "testo": r.get("testo") if include_text else None
                }
                for r in results
            ]
        except Exception as e:
            log.debug(f"Ancestors query failed: {e}")
            return []

    async def _get_descendants(
        self,
        urn: str,
        max_depth: int,
        include_text: bool,
        tipo_filter: Optional[List[str]]
    ) -> List[Dict[str, Any]]:
        """
        Scende la gerarchia verso le foglie.

        Relazioni seguite: CONTIENE (parent → child)
        """
        text_field = ", n.testo_vigente AS testo" if include_text else ""
        tipo_where = ""
        if tipo_filter:
            tipo_list = "', '".join(tipo_filter)
            tipo_where = f"AND labels(n)[0] IN ['{tipo_list}']"

        cypher = f"""
            MATCH path = (start)-[:CONTIENE*1..{max_depth}]->(n)
            WHERE start.URN = $urn {tipo_where}
            RETURN
                n.URN AS urn,
                labels(n)[0] AS tipo,
                n.estremi AS estremi,
                n.rubrica AS rubrica,
                n.numero_articolo AS order_num,
                length(path) AS depth
                {text_field}
            ORDER BY depth ASC, order_num ASC
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})
            return [
                {
                    "urn": r.get("urn", ""),
                    "tipo": r.get("tipo", "Unknown"),
                    "estremi": r.get("estremi", ""),
                    "rubrica": r.get("rubrica"),
                    "depth": r.get("depth", 0),
                    "order": r.get("order_num"),
                    "testo": r.get("testo") if include_text else None
                }
                for r in results
            ]
        except Exception as e:
            log.debug(f"Descendants query failed: {e}")
            return []

    async def _get_siblings(
        self,
        urn: str,
        include_text: bool,
        tipo_filter: Optional[List[str]]
    ) -> List[Dict[str, Any]]:
        """
        Trova i nodi fratelli (stesso genitore).
        """
        text_field = ", sibling.testo_vigente AS testo" if include_text else ""
        tipo_where = ""
        if tipo_filter:
            tipo_list = "', '".join(tipo_filter)
            tipo_where = f"AND labels(sibling)[0] IN ['{tipo_list}']"

        cypher = f"""
            MATCH (start)-[:CONTENUTO_IN]->(parent)<-[:CONTENUTO_IN]-(sibling)
            WHERE start.URN = $urn AND sibling.URN <> $urn {tipo_where}
            RETURN
                sibling.URN AS urn,
                labels(sibling)[0] AS tipo,
                sibling.estremi AS estremi,
                sibling.rubrica AS rubrica,
                sibling.numero_articolo AS order_num
                {text_field}
            ORDER BY order_num ASC
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})
            return [
                {
                    "urn": r.get("urn", ""),
                    "tipo": r.get("tipo", "Unknown"),
                    "estremi": r.get("estremi", ""),
                    "rubrica": r.get("rubrica"),
                    "depth": 0,  # Same level as start
                    "order": r.get("order_num"),
                    "testo": r.get("testo") if include_text else None
                }
                for r in results
            ]
        except Exception as e:
            log.debug(f"Siblings query failed: {e}")
            return []

    async def _get_context(
        self,
        urn: str,
        max_depth: int,
        include_text: bool,
        tipo_filter: Optional[List[str]]
    ) -> List[Dict[str, Any]]:
        """
        Ottiene contesto completo: ancestors + siblings + some descendants.
        """
        context = []

        # Get ancestors (path to root)
        ancestors = await self._get_ancestors(urn, max_depth, include_text, tipo_filter)
        for a in ancestors:
            a["relation"] = "ancestor"
        context.extend(ancestors)

        # Get siblings
        siblings = await self._get_siblings(urn, include_text, tipo_filter)
        for s in siblings:
            s["relation"] = "sibling"
        context.extend(siblings)

        # Get immediate descendants (1 level only for context)
        descendants = await self._get_descendants(urn, 1, include_text, tipo_filter)
        for d in descendants:
            d["relation"] = "descendant"
        context.extend(descendants)

        return context

    def _build_path_string(
        self,
        hierarchy: List[Dict[str, Any]],
        direction: str
    ) -> str:
        """
        Costruisce una stringa leggibile del percorso.

        Es: "C.C. → Libro IV → Titolo I → Capo XIV → Art. 1453"
        """
        if not hierarchy:
            return ""

        if direction == "ancestors":
            # Reverse order for ancestor path (leaf to root)
            nodes = sorted(hierarchy, key=lambda x: x.get("depth", 0), reverse=True)
            path_parts = [n.get("estremi", n.get("urn", "?")) for n in nodes]
            return " → ".join(path_parts)

        elif direction == "descendants":
            # Tree-like structure for descendants
            nodes = sorted(hierarchy, key=lambda x: (x.get("depth", 0), x.get("order", 0)))
            path_parts = [n.get("estremi", n.get("urn", "?")) for n in nodes[:10]]
            if len(hierarchy) > 10:
                path_parts.append(f"... (+{len(hierarchy) - 10} altri)")
            return ", ".join(path_parts)

        elif direction == "siblings":
            path_parts = [n.get("estremi", n.get("urn", "?")) for n in hierarchy[:10]]
            if len(hierarchy) > 10:
                path_parts.append(f"... (+{len(hierarchy) - 10} altri)")
            return " | ".join(path_parts)

        else:  # context
            ancestors = [n for n in hierarchy if n.get("relation") == "ancestor"]
            siblings = [n for n in hierarchy if n.get("relation") == "sibling"]
            descendants = [n for n in hierarchy if n.get("relation") == "descendant"]

            parts = []
            if ancestors:
                path = " → ".join(n.get("estremi", "?") for n in sorted(ancestors, key=lambda x: x.get("depth", 0), reverse=True))
                parts.append(f"Percorso: {path}")
            if siblings:
                sibs = ", ".join(n.get("estremi", "?") for n in siblings[:5])
                parts.append(f"Fratelli: {sibs}")
            if descendants:
                descs = ", ".join(n.get("estremi", "?") for n in descendants[:5])
                parts.append(f"Contenuti: {descs}")

            return " | ".join(parts)
