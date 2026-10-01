"""
Definition Lookup Tool
=======================

Tool per cercare definizioni legali nel knowledge graph.

Utilizza la relazione DEFINISCE per trovare:
- Definizioni normative (articoli che definiscono concetti)
- Definizioni giurisprudenziali (sentenze che interpretano termini)
- Definizioni dottrinali (dottrina che elabora concetti)

Esempio:
    >>> from merlt.tools import DefinitionLookupTool
    >>>
    >>> tool = DefinitionLookupTool(graph_db=falkordb)
    >>> result = await tool(term="legittima difesa")
    >>> for defn in result.data["definitions"]:
    ...     print(f"{defn['source_urn']}: {defn['definition_text'][:100]}")
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from merlt.storage.graph.schema import cypher_labels
from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType, bounded_int, label_filter

log = structlog.get_logger()

# The most definitions one call returns; interpolated into the Cypher (`LIMIT N`).
MAX_LIMIT = 50


@dataclass
class DefinitionEntry:
    """
    Singola definizione trovata.

    Attributes:
        term: Termine cercato/trovato
        source_urn: URN della fonte che definisce
        source_type: Tipo di fonte (Norma, AttoGiudiziario, Dottrina)
        source_estremi: Estremi della fonte (es. "Art. 52 c.p.")
        definition_text: Testo della definizione
        context: Contesto aggiuntivo
        confidence: Confidence della definizione [0-1]
    """
    term: str
    source_urn: str
    source_type: str
    source_estremi: str
    definition_text: str
    context: Optional[str] = None
    confidence: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "term": self.term,
            "source_urn": self.source_urn,
            "source_type": self.source_type,
            "source_estremi": self.source_estremi,
            "definition_text": self.definition_text,
            "context": self.context,
            "confidence": self.confidence
        }


class DefinitionLookupTool(BaseTool):
    """
    Tool per cercare definizioni legali nel knowledge graph.

    Cerca definizioni attraverso:
    1. Relazione DEFINISCE (norme che definiscono concetti)
    2. Match fuzzy su nomi di ConcettoGiuridico
    3. Ricerca nel testo di norme contenenti "si intende", "si definisce"

    Particolarmente utile per:
    - Expert LiteralExpert: trovare definizioni normative precise
    - Expert SystemicExpert: capire come un concetto è definito nel sistema
    - Expert PrinciplesExpert: trovare ratio legis delle definizioni

    Esempio:
        >>> tool = DefinitionLookupTool(graph_db=falkordb_client)
        >>> result = await tool(
        ...     term="contratto",
        ...     source_types=["Norma"],
        ...     include_related=True
        ... )
        >>> print(f"Trovate {result.data['total']} definizioni")
    """

    name = "definition_lookup"
    description = (
        "Cerca definizioni legali per un termine giuridico. "
        "Trova come il termine è definito in norme, sentenze e dottrina. "
        "Utile per interpretazione letterale e sistematica."
    )

    def __init__(
        self,
        graph_db: Any = None,
        max_results: int = 10
    ):
        """
        Inizializza DefinitionLookupTool.

        Args:
            graph_db: FalkorDBClient per query al grafo
            max_results: Numero massimo di definizioni da restituire
        """
        super().__init__()
        self.graph_db = graph_db
        self.max_results = max_results

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="term",
                param_type=ParameterType.STRING,
                description=(
                    "Termine giuridico da cercare. "
                    "Es: 'legittima difesa', 'contratto', 'buona fede', "
                    "'responsabilità extracontrattuale'"
                )
            ),
            ToolParameter(
                name="source_types",
                param_type=ParameterType.ARRAY,
                description=(
                    "Filtra per tipo di fonte. "
                    "Es: ['Norma'] per solo definizioni normative, "
                    "['AttoGiudiziario'] per definizioni giurisprudenziali"
                ),
                required=False
            ),
            ToolParameter(
                name="include_related",
                param_type=ParameterType.BOOLEAN,
                description=(
                    "Se True, include anche definizioni di concetti correlati"
                ),
                required=False,
                default=False
            ),
            ToolParameter(
                name="exact_match",
                param_type=ParameterType.BOOLEAN,
                description=(
                    "Se True, cerca solo match esatto del termine. "
                    "Se False, usa match fuzzy (case-insensitive, partial)"
                ),
                required=False,
                default=False
            ),
            ToolParameter(
                name="limit",
                param_type=ParameterType.INTEGER,
                description="Numero massimo di risultati",
                required=False,
                default=10
            )
        ]

    async def execute(
        self,
        term: str,
        source_types: Optional[List[str]] = None,
        include_related: bool = False,
        exact_match: bool = False,
        limit: int = 10
    ) -> ToolResult:
        """
        Cerca definizioni per il termine specificato.

        Args:
            term: Termine da cercare
            source_types: Filtro per tipo fonte
            include_related: Includi concetti correlati
            exact_match: Richiedi match esatto
            limit: Numero massimo risultati

        Returns:
            ToolResult con lista di definizioni trovate
        """
        log.debug(
            f"definition_lookup - term='{term}', "
            f"types={source_types}, exact={exact_match}"
        )

        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        try:
            limit = bounded_int(limit, "limit", 1, MAX_LIMIT)
        except ValueError as e:
            return ToolResult.fail(error=str(e), tool_name=self.name)

        if source_types and not cypher_labels(source_types):
            # The caller filtered on types the graph does not have: nothing can match,
            # and the lookup must not run unfiltered instead.
            return ToolResult.ok(
                data={
                    "term": term,
                    "definitions": [],
                    "total": 0,
                    "source_types": source_types,
                    "include_related": include_related
                },
                tool_name=self.name,
                term=term,
                definitions_found=0
            )

        try:
            definitions = []

            # Strategy 1: Look for DEFINISCE relationships
            graph_defs = await self._find_definitions_via_relation(
                term, source_types, exact_match, limit
            )
            definitions.extend(graph_defs)

            # Strategy 2: Look for ConcettoGiuridico nodes with matching name
            concept_defs = await self._find_concept_definitions(
                term, exact_match, limit - len(definitions)
            )
            definitions.extend(concept_defs)

            # Strategy 3: Search in article text for definition patterns
            if len(definitions) < limit:
                text_defs = await self._find_definitions_in_text(
                    term, source_types, limit - len(definitions)
                )
                definitions.extend(text_defs)

            # Strategy 4: Include related concepts if requested
            if include_related and len(definitions) < limit:
                related_defs = await self._find_related_definitions(
                    term, source_types, limit - len(definitions)
                )
                definitions.extend(related_defs)

            # Deduplicate by source_urn
            seen_urns = set()
            unique_defs = []
            for d in definitions:
                if d["source_urn"] not in seen_urns:
                    seen_urns.add(d["source_urn"])
                    unique_defs.append(d)

            # Sort by confidence
            unique_defs.sort(key=lambda x: x["confidence"], reverse=True)
            unique_defs = unique_defs[:limit]

            log.info(
                f"definition_lookup completed - "
                f"term='{term}', found={len(unique_defs)}"
            )

            return ToolResult.ok(
                data={
                    "term": term,
                    "definitions": unique_defs,
                    "total": len(unique_defs),
                    "source_types": source_types or ["all"],
                    "include_related": include_related
                },
                tool_name=self.name,
                term=term,
                definitions_found=len(unique_defs)
            )

        except Exception as e:
            log.error(f"definition_lookup failed: {e}")
            return ToolResult.fail(
                error=f"Errore nella ricerca definizioni: {str(e)}",
                tool_name=self.name
            )

    async def _find_definitions_via_relation(
        self,
        term: str,
        source_types: Optional[List[str]],
        exact_match: bool,
        limit: int
    ) -> List[Dict[str, Any]]:
        """
        Cerca definizioni tramite relazione DEFINISCE.

        Pattern: (Source)-[:DEFINISCE]->(ConcettoGiuridico)
        """
        # Build match pattern
        if exact_match:
            match_condition = "concept.nome = $term"
        else:
            match_condition = "toLower(concept.nome) CONTAINS toLower($term)"

        # Source type filter: labels of the graph only (any of them), or no query
        labels = cypher_labels(source_types) if source_types else []
        if source_types and not labels:
            return []
        limit = bounded_int(limit, "limit", 0, MAX_LIMIT)
        if limit == 0:
            return []
        source_filter, source_where = label_filter("source", labels)
        if source_where:
            match_condition = f"{match_condition} AND {source_where}"

        cypher = f"""
            MATCH (source{source_filter})-[r:DEFINISCE]->(concept:ConcettoGiuridico)
            WHERE {match_condition}
            RETURN
                concept.nome AS term,
                coalesce(source.URN, source.node_id) AS source_urn,
                labels(source)[0] AS source_type,
                source.estremi AS source_estremi,
                coalesce(concept.definizione, concept.descrizione) AS definition_text,
                coalesce(source.testo, source.testo_vigente) AS context
            LIMIT {limit}
        """

        try:
            results = await self.graph_db.ro_query(cypher, {"term": term})

            return [
                DefinitionEntry(
                    term=r.get("term", term),
                    source_urn=r.get("source_urn", ""),
                    source_type=r.get("source_type", "Unknown"),
                    source_estremi=r.get("source_estremi", ""),
                    definition_text=r.get("definition_text", ""),
                    context=r.get("context", "")[:500] if r.get("context") else None,
                    confidence=1.0  # Direct DEFINISCE relation = highest confidence
                ).to_dict()
                for r in results
                if r.get("source_urn")
            ]
        except Exception as e:
            log.debug(f"DEFINISCE query failed: {e}")
            return []

    async def _find_concept_definitions(
        self,
        term: str,
        exact_match: bool,
        limit: int
    ) -> List[Dict[str, Any]]:
        """
        Cerca ConcettoGiuridico con definizione diretta.
        """
        if exact_match:
            match_condition = "c.nome = $term"
        else:
            match_condition = "toLower(c.nome) CONTAINS toLower($term)"

        limit = bounded_int(limit, "limit", 0, MAX_LIMIT)
        if limit == 0:
            return []

        cypher = f"""
            MATCH (c:ConcettoGiuridico)
            WHERE {match_condition} AND coalesce(c.definizione, c.descrizione) IS NOT NULL
            RETURN
                c.nome AS term,
                coalesce(c.URN, c.node_id) AS source_urn,
                'ConcettoGiuridico' AS source_type,
                c.nome AS source_estremi,
                coalesce(c.definizione, c.descrizione) AS definition_text
            LIMIT {limit}
        """

        try:
            results = await self.graph_db.ro_query(cypher, {"term": term})

            return [
                DefinitionEntry(
                    term=r.get("term", term),
                    source_urn=r.get("source_urn", r.get("term", "")),
                    source_type="ConcettoGiuridico",
                    source_estremi=r.get("source_estremi", ""),
                    definition_text=r.get("definition_text", ""),
                    confidence=0.9  # Concept node definition
                ).to_dict()
                for r in results
                if r.get("definition_text")
            ]
        except Exception as e:
            log.debug(f"ConcettoGiuridico query failed: {e}")
            return []

    async def _find_definitions_in_text(
        self,
        term: str,
        source_types: Optional[List[str]],
        limit: int
    ) -> List[Dict[str, Any]]:
        """
        Cerca definizioni nel testo delle norme.

        Pattern di definizione comuni:
        - "si intende"
        - "si definisce"
        - "è definito"
        - "per X si intende"
        """
        labels = cypher_labels(source_types) if source_types else []
        if source_types and not labels:
            return []
        limit = bounded_int(limit, "limit", 0, MAX_LIMIT)
        if limit == 0:
            return []

        source_filter = ":Norma"  # Default to Norma for text search
        if len(labels) == 1:
            source_filter = f":{labels[0]}"

        # Search for definition patterns containing the term
        cypher = f"""
            MATCH (n{source_filter})
            WHERE coalesce(n.testo, n.testo_vigente) IS NOT NULL
              AND toLower(coalesce(n.testo, n.testo_vigente)) CONTAINS toLower($term)
              AND (
                  toLower(coalesce(n.testo, n.testo_vigente)) CONTAINS 'si intende'
                  OR toLower(coalesce(n.testo, n.testo_vigente)) CONTAINS 'si definisce'
                  OR toLower(coalesce(n.testo, n.testo_vigente)) CONTAINS 'è definito'
                  OR toLower(coalesce(n.testo, n.testo_vigente)) CONTAINS 'ai sensi'
              )
            RETURN
                coalesce(n.URN, n.node_id) AS source_urn,
                labels(n)[0] AS source_type,
                n.estremi AS source_estremi,
                coalesce(n.testo, n.testo_vigente) AS definition_text
            LIMIT {limit}
        """

        try:
            results = await self.graph_db.ro_query(cypher, {"term": term})

            return [
                DefinitionEntry(
                    term=term,
                    source_urn=r.get("source_urn", ""),
                    source_type=r.get("source_type", "Norma"),
                    source_estremi=r.get("source_estremi", ""),
                    definition_text=r.get("definition_text", "")[:1000],  # Truncate
                    confidence=0.7  # Text-based definition (less precise)
                ).to_dict()
                for r in results
                if r.get("source_urn")
            ]
        except Exception as e:
            log.debug(f"Text search query failed: {e}")
            return []

    async def _find_related_definitions(
        self,
        term: str,
        source_types: Optional[List[str]],
        limit: int
    ) -> List[Dict[str, Any]]:
        """
        Cerca definizioni di concetti correlati.

        Trova concetti collegati al termine e restituisce le loro definizioni.
        """
        limit = bounded_int(limit, "limit", 0, MAX_LIMIT)
        if limit == 0:
            return []

        cypher = """
            MATCH (c1:ConcettoGiuridico)
            WHERE toLower(c1.nome) CONTAINS toLower($term)
            MATCH (c1)-[:CORRELATO|SPECIES]-(c2:ConcettoGiuridico)
            WHERE coalesce(c2.definizione, c2.descrizione) IS NOT NULL
            RETURN DISTINCT
                c2.nome AS term,
                coalesce(c2.URN, c2.node_id) AS source_urn,
                'ConcettoGiuridico' AS source_type,
                c2.nome AS source_estremi,
                coalesce(c2.definizione, c2.descrizione) AS definition_text,
                'correlato a ' + c1.nome AS context
            LIMIT $limit
        """

        try:
            results = await self.graph_db.ro_query(cypher, {"term": term, "limit": limit})

            return [
                DefinitionEntry(
                    term=r.get("term", term),
                    source_urn=r.get("source_urn", ""),
                    source_type="ConcettoGiuridico",
                    source_estremi=r.get("source_estremi", ""),
                    definition_text=r.get("definition_text", ""),
                    context=r.get("context"),
                    confidence=0.6  # Related concept (indirect match)
                ).to_dict()
                for r in results
                if r.get("definition_text")
            ]
        except Exception as e:
            log.debug(f"Related concepts query failed: {e}")
            return []
