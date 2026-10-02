"""
Hierarchy Navigation Tool
==========================

Tool per navigare la gerarchia normativa nel knowledge graph.

Struttura gerarchica tipica:
    Codice → Libro → Titolo → Capo → Sezione → Articolo

Relazioni:
    - CONTIENE: genitore → figlio (la risalita la percorre a ritroso)
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

from merlt.storage.graph.schema import canonical_urn, node_type_cypher
from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType, bounded_int

log = structlog.get_logger()

# The deepest hierarchy walk: a code has about nine levels (codice, libro, titolo,
# capo, sezione, articolo, comma, lettera, numero). The depth is interpolated into
# the Cypher (`*1..N`), so it is always a clamped integer.
MAX_DEPTH = 10

# The most nodes the descendants or the siblings of a node return; interpolated into the
# Cypher (`LIMIT N`), so always a clamped integer. The descendants of a code's root are
# about 2,800 rows once the graph is migrated, and every row goes to the LLM: the rows are
# ordered by depth, so the cut keeps the nearest levels.
MAX_NODES = 50


def _label(node: Dict[str, Any]) -> str:
    """How a node reads in a path: its estremi, else its rubrica (an ingested titolo or
    capo has a rubrica and no estremi), else its URN. The graph answers null for a
    property a node lacks, so the key is present and `.get(key, default)` is not enough."""
    return node.get("estremi") or node.get("rubrica") or node.get("urn") or "?"


def _tipi(tipo_filter: Optional[List[str]]) -> List[str]:
    """The `tipo` values a filter asks for, as the parameter list of the query: each
    as given and in lower case (a partition's type is lower case)."""
    values = [tipo_filter] if isinstance(tipo_filter, str) else list(tipo_filter or [])
    asked = [v for v in values if isinstance(v, str)]
    return list(dict.fromkeys(name for v in asked for name in (v, v.lower())))


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
        tipo: Tipo strutturale (`tipo_documento` della Norma: codice, libro, titolo, capo, sezione, articolo)
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
                    "Filtra per tipo di nodo: libro, titolo, capo, sezione, articolo "
                    "(le partizioni sono Norma e si distinguono per questo tipo). "
                    "Es: ['capo', 'articolo'] per solo questi livelli"
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
            max_depth = bounded_int(max_depth, "max_depth", 1, MAX_DEPTH)
        except ValueError as e:
            return ToolResult.fail(error=str(e), tool_name=self.name)

        try:
            # Find the starting node
            start_info = await self._find_start_node(start_node)
            if not start_info:
                # Node isn't in the graph (e.g. a norm outside the Libro IV seed).
                # That's an EMPTY result, not an error — mirror graph_search's
                # empty-success so it doesn't surface as a ✗ in "Strumenti usati"
                # on every out-of-seed query.
                log.info(f"hierarchy_navigation - start node not in graph: {start_node}")
                return ToolResult.ok(
                    data={
                        "start_node": None,
                        "direction": direction,
                        "hierarchy": [],
                        "total_nodes": 0,
                        "path": "",
                        "max_depth_reached": 0,
                    },
                    tool_name=self.name,
                    start_node=start_node,
                    direction=direction,
                    nodes_found=0,
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
        identifier = canonical_urn(identifier)  # the graph's key has no version marker
        cypher = f"""
            MATCH (n)
            WHERE n.URN = $id
               OR n.estremi = $id
               OR n.numero_articolo = $id
               OR n.nome = $id
            RETURN
                n.URN AS urn,
                coalesce(n.tipo_documento, {node_type_cypher('n')}) AS tipo,
                n.estremi AS estremi,
                n.rubrica AS rubrica,
                n.numero_articolo AS numero
            LIMIT 1
        """

        try:
            results = await self.graph_db.ro_query(cypher, {"id": identifier})
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

        Relazioni seguite: CONTIENE, a ritroso (child → parent)
        """
        max_depth = bounded_int(max_depth, "max_depth", 1, MAX_DEPTH)
        text_field = ", coalesce(n.testo, n.testo_vigente) AS testo" if include_text else ""
        params: Dict[str, Any] = {"urn": urn}
        tipo_where = ""
        if tipo_filter:
            tipo_where = f"AND coalesce(n.tipo_documento, {node_type_cypher('n')}) IN $tipi"
            params["tipi"] = _tipi(tipo_filter)

        cypher = f"""
            MATCH path = (n)-[:CONTIENE*1..{max_depth}]->(start)
            WHERE start.URN = $urn {tipo_where}
            RETURN
                n.URN AS urn,
                coalesce(n.tipo_documento, {node_type_cypher('n')}) AS tipo,
                n.estremi AS estremi,
                n.rubrica AS rubrica,
                length(path) AS depth
                {text_field}
            ORDER BY depth ASC
        """

        try:
            results = await self.graph_db.ro_query(cypher, params)
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
        tipo_filter: Optional[List[str]],
        limit: int = MAX_NODES
    ) -> List[Dict[str, Any]]:
        """
        Scende la gerarchia verso le foglie.

        Relazioni seguite: CONTIENE (parent → child). At most `limit` nodes (clamped
        to `MAX_NODES`), the nearest levels first.
        """
        max_depth = bounded_int(max_depth, "max_depth", 1, MAX_DEPTH)
        limit = bounded_int(limit, "limit", 1, MAX_NODES)
        text_field = ", coalesce(n.testo, n.testo_vigente) AS testo" if include_text else ""
        params: Dict[str, Any] = {"urn": urn}
        tipo_where = ""
        if tipo_filter:
            tipo_where = f"AND coalesce(n.tipo_documento, {node_type_cypher('n')}) IN $tipi"
            params["tipi"] = _tipi(tipo_filter)

        cypher = f"""
            MATCH path = (start)-[:CONTIENE*1..{max_depth}]->(n)
            WHERE start.URN = $urn {tipo_where}
            RETURN
                n.URN AS urn,
                coalesce(n.tipo_documento, {node_type_cypher('n')}) AS tipo,
                n.estremi AS estremi,
                n.rubrica AS rubrica,
                n.numero_articolo AS order_num,
                length(path) AS depth
                {text_field}
            ORDER BY depth ASC, order_num ASC
            LIMIT {limit}
        """

        try:
            results = await self.graph_db.ro_query(cypher, params)
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
        tipo_filter: Optional[List[str]],
        limit: int = MAX_NODES
    ) -> List[Dict[str, Any]]:
        """
        Trova i nodi fratelli (stesso genitore). At most `limit` (clamped to `MAX_NODES`).
        """
        limit = bounded_int(limit, "limit", 1, MAX_NODES)
        text_field = ", coalesce(sibling.testo, sibling.testo_vigente) AS testo" if include_text else ""
        params: Dict[str, Any] = {"urn": urn}
        tipo_where = ""
        if tipo_filter:
            tipo_where = f"AND coalesce(sibling.tipo_documento, {node_type_cypher('sibling')}) IN $tipi"
            params["tipi"] = _tipi(tipo_filter)

        cypher = f"""
            MATCH (start)
            WHERE start.URN = $urn
            MATCH (parent)-[:CONTIENE]->(start)
            MATCH (parent)-[:CONTIENE]->(sibling)
            WHERE sibling.URN <> $urn {tipo_where}
            RETURN
                sibling.URN AS urn,
                coalesce(sibling.tipo_documento, {node_type_cypher('sibling')}) AS tipo,
                sibling.estremi AS estremi,
                sibling.rubrica AS rubrica,
                sibling.numero_articolo AS order_num
                {text_field}
            ORDER BY order_num ASC
            LIMIT {limit}
        """

        try:
            results = await self.graph_db.ro_query(cypher, params)
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
            path_parts = [_label(n) for n in nodes]
            return " → ".join(path_parts)

        elif direction == "descendants":
            # Tree-like structure for descendants (an article number is text, and may be null)
            nodes = sorted(hierarchy, key=lambda x: (x.get("depth") or 0, str(x.get("order") or "")))
            path_parts = [_label(n) for n in nodes[:10]]
            if len(hierarchy) > 10:
                path_parts.append(f"... (+{len(hierarchy) - 10} altri)")
            return ", ".join(path_parts)

        elif direction == "siblings":
            path_parts = [_label(n) for n in hierarchy[:10]]
            if len(hierarchy) > 10:
                path_parts.append(f"... (+{len(hierarchy) - 10} altri)")
            return " | ".join(path_parts)

        else:  # context
            ancestors = [n for n in hierarchy if n.get("relation") == "ancestor"]
            siblings = [n for n in hierarchy if n.get("relation") == "sibling"]
            descendants = [n for n in hierarchy if n.get("relation") == "descendant"]

            parts = []
            if ancestors:
                path = " → ".join(_label(n) for n in sorted(ancestors, key=lambda x: x.get("depth", 0), reverse=True))
                parts.append(f"Percorso: {path}")
            if siblings:
                sibs = ", ".join(_label(n) for n in siblings[:5])
                parts.append(f"Fratelli: {sibs}")
            if descendants:
                descs = ", ".join(_label(n) for n in descendants[:5])
                parts.append(f"Contenuti: {descs}")

            return " | ".join(parts)
