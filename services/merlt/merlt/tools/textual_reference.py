"""
Textual Reference Tool
=======================

Tool per seguire rinvii normativi espliciti nel testo.

Traccia le connessioni testuali tra norme tramite relazioni:
- RINVIA: rinvio normativo esplicito
- richiama: richiamo generico
- modifica: modifica di altra norma

Fondamento: Art. 12, I c.c. - "connessione di esse" a livello testuale

Esempio:
    >>> from merlt.tools import TextualReferenceTool
    >>>
    >>> tool = TextualReferenceTool(graph_db=falkordb)
    >>> result = await tool(article_urn="urn:norma:cc:art1453", max_depth=2)
    >>> for ref in result.data["references"]:
    ...     print(f"{ref['from_urn']} → {ref['to_urn']} ({ref['reference_type']})")
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


@dataclass
class NormReference:
    """
    Rinvio normativo tra due articoli.

    Attributes:
        from_urn: URN della norma di partenza
        to_urn: URN della norma referenziata
        to_estremi: Riferimento leggibile (es. "Art. 1455 c.c.")
        reference_type: Tipo di relazione (RINVIA, richiama, modifica)
        excerpt: Estratto del testo referenziato
        depth: Profondità nella catena (1 = diretto)
    """
    from_urn: str
    to_urn: str
    to_estremi: str
    reference_type: str
    excerpt: Optional[str]
    depth: int

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "from_urn": self.from_urn,
            "to_urn": self.to_urn,
            "to_estremi": self.to_estremi,
            "reference_type": self.reference_type,
            "excerpt": self.excerpt,
            "depth": self.depth
        }


class TextualReferenceTool(BaseTool):
    """
    Tool per seguire rinvii normativi espliciti nel testo.

    Segue le connessioni testuali tra norme attraverso relazioni
    RINVIA, richiama, modifica per tracciare la catena di riferimenti.

    Rileva e gestisce riferimenti circolari per evitare loop infiniti.

    Fondamento giuridico: Art. 12, I c.c. - "connessione di esse"
    (interpretazione letterale che considera i collegamenti testuali)

    Utile per:
    - Expert LiteralExpert: seguire riferimenti espliciti nel testo
    - Expert SystemicExpert: capire connessioni tra norme
    - Analisi normativa: mappare dipendenze tra articoli

    Esempio:
        >>> tool = TextualReferenceTool(graph_db=falkordb_client)
        >>> result = await tool(
        ...     article_urn="urn:norma:cc:art1453",
        ...     max_depth=2,
        ...     reference_types=["RINVIA", "richiama"]
        ... )
        >>> print(f"Trovati {len(result.data['references'])} rinvii")
        >>> if result.data["circular_detected"]:
        ...     print("Attenzione: rilevati riferimenti circolari")
    """

    name = "textual_reference"
    description = (
        "Segue rinvii normativi espliciti tra articoli. "
        "Traccia catene di riferimenti (RINVIA, richiama, modifica) "
        "per capire le connessioni testuali tra norme. "
        "Riferimento: Art. 12, I c.c. - interpretazione letterale."
    )

    def __init__(
        self,
        graph_db: Any = None,
        max_depth: int = 2
    ):
        """
        Inizializza TextualReferenceTool.

        Args:
            graph_db: FalkorDBClient per query al grafo
            max_depth: Profondità massima catena rinvii (default: 2)
        """
        super().__init__()
        self.graph_db = graph_db
        self.max_depth = max_depth

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="article_urn",
                param_type=ParameterType.STRING,
                description=(
                    "URN dell'articolo di partenza. "
                    "Es: 'urn:norma:cc:art1453', 'urn:norma:cp:art52'"
                )
            ),
            ToolParameter(
                name="max_depth",
                param_type=ParameterType.INTEGER,
                description="Profondità massima della catena di rinvii (1-5)",
                required=False,
                default=2
            ),
            ToolParameter(
                name="reference_types",
                param_type=ParameterType.ARRAY,
                description=(
                    "Tipi di relazione da seguire. "
                    "Es: ['RINVIA', 'richiama', 'modifica']"
                ),
                required=False
            )
        ]

    async def execute(
        self,
        article_urn: str,
        max_depth: int = 2,
        reference_types: Optional[List[str]] = None
    ) -> ToolResult:
        """
        Trova tutti i rinvii normativi da un articolo.

        Args:
            article_urn: URN dell'articolo di partenza
            max_depth: Profondità massima catena
            reference_types: Tipi di relazione da seguire

        Returns:
            ToolResult con:
            - references: Lista di NormReference
            - chain_depth: Profondità massima trovata
            - circular_detected: True se ci sono cicli
        """
        log.debug(
            f"textual_reference - urn={article_urn}, "
            f"max_depth={max_depth}, types={reference_types}"
        )

        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        # Validate e clamp max_depth
        max_depth = min(max(1, max_depth), 5)

        # Default reference types
        if reference_types is None:
            reference_types = ["RINVIA", "richiama", "modifica"]

        try:
            # Build Cypher query
            rel_pattern = "|".join(reference_types)

            cypher = f"""
                MATCH path = (start:Norma {{URN: $urn}})-[:{rel_pattern}*1..{max_depth}]->(target:Norma)
                WHERE start <> target
                RETURN
                    start.URN as from_urn,
                    target.URN as to_urn,
                    target.estremi as to_estremi,
                    target.testo_vigente as excerpt,
                    length(path) as depth,
                    [r in relationships(path) | type(r)] as relation_types
                ORDER BY depth ASC
                LIMIT 50
            """

            results = await self.graph_db.query(cypher, {"urn": article_urn})

            if not results:
                return ToolResult.ok(
                    data={
                        "references": [],
                        "chain_depth": 0,
                        "circular_detected": False,
                        "article_urn": article_urn
                    },
                    tool_name=self.name,
                    article_urn=article_urn,
                    references_found=0
                )

            # Process results
            references = []
            max_chain_depth = 0
            seen_urns = set()
            circular_detected = False

            for r in results:
                from_urn = r.get("from_urn", "")
                to_urn = r.get("to_urn", "")
                to_estremi = r.get("to_estremi", "")
                excerpt = r.get("excerpt")
                depth = r.get("depth", 0)
                relation_types_list = r.get("relation_types", [])

                # Rileva cicli
                if to_urn in seen_urns or to_urn == article_urn:
                    circular_detected = True
                    continue

                seen_urns.add(to_urn)

                # Usa primo tipo di relazione del path
                reference_type = (
                    relation_types_list[0] if relation_types_list else "UNKNOWN"
                )

                # Trunca excerpt se troppo lungo
                if excerpt and len(excerpt) > 300:
                    excerpt = excerpt[:297] + "..."

                references.append(NormReference(
                    from_urn=from_urn,
                    to_urn=to_urn,
                    to_estremi=to_estremi,
                    reference_type=reference_type,
                    excerpt=excerpt,
                    depth=depth
                ).to_dict())

                max_chain_depth = max(max_chain_depth, depth)

            log.info(
                f"textual_reference completed - "
                f"urn={article_urn}, found={len(references)}, "
                f"depth={max_chain_depth}, circular={circular_detected}"
            )

            return ToolResult.ok(
                data={
                    "references": references,
                    "chain_depth": max_chain_depth,
                    "circular_detected": circular_detected,
                    "article_urn": article_urn,
                    "total": len(references)
                },
                tool_name=self.name,
                article_urn=article_urn,
                references_found=len(references)
            )

        except Exception as e:
            log.error(f"textual_reference failed: {e}")
            return ToolResult.fail(
                error=f"Errore durante ricerca rinvii: {str(e)}",
                tool_name=self.name
            )
