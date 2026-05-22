"""
Principle Lookup Tool
=====================

Tool per cercare principi giuridici nel knowledge graph.

Utilizza la relazione ESPRIME_PRINCIPIO per trovare:
- Principi costituzionali (es. uguaglianza, legalità)
- Principi generali (es. buona fede, correttezza)
- Principi europei (es. proporzionalità, sussidiarietà)

Riferimento normativo: Art. 12, II c.c. - "principi generali dell'ordinamento"

Esempio:
    >>> from merlt.tools import PrincipleLookupTool
    >>>
    >>> tool = PrincipleLookupTool(graph_db=falkordb)
    >>> result = await tool(query="buona fede")
    >>> for principle in result.data["principles"]:
    ...     print(f"{principle['nome']}: {principle['fondamento']}")
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


@dataclass
class LegalPrinciple:
    """
    Singolo principio giuridico trovato.

    Attributes:
        nome: Nome del principio (es. "buona fede")
        description: Descrizione del principio
        level: Livello ("costituzionale" | "generale" | "europeo")
        fondamento: Norma fondamento (es. "Art. 1375 c.c.")
        norme_attuative: Lista di norme che attuano il principio
        norme_urns: URN delle norme attuative
        confidence: Confidence del match [0-1]
    """
    nome: str
    description: Optional[str]
    level: str
    fondamento: str
    norme_attuative: List[str]
    norme_urns: List[str]
    confidence: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "nome": self.nome,
            "description": self.description,
            "level": self.level,
            "fondamento": self.fondamento,
            "norme_attuative": self.norme_attuative,
            "norme_urns": self.norme_urns,
            "confidence": self.confidence
        }


class PrincipleLookupTool(BaseTool):
    """
    Tool per cercare principi giuridici nel knowledge graph.

    Cerca principi attraverso:
    1. Relazione ESPRIME_PRINCIPIO (740 relazioni nel grafo)
    2. Match fuzzy su nomi di PrincipioGiuridico
    3. Ricerca nel testo di norme che menzionano "principio"

    Particolarmente utile per:
    - Expert PrinciplesExpert: trovare principi applicabili al caso
    - Expert SystemicExpert: capire struttura principi dell'ordinamento
    - Expert LiteralExpert: fondamento normativo dei principi

    Esempio:
        >>> tool = PrincipleLookupTool(graph_db=falkordb_client)
        >>> result = await tool(
        ...     query="proporzionalità",
        ...     principle_level=["europeo", "costituzionale"],
        ...     top_k=5
        ... )
        >>> print(f"Trovati {result.data['total']} principi")
    """

    name = "principle_lookup"
    description = (
        "Cerca principi giuridici nell'ordinamento. "
        "Trova principi costituzionali, generali ed europei con fondamento normativo. "
        "Utile per interpretazione teleologica e sistematica. "
        "Riferimento: Art. 12, II c.c. - principi generali dell'ordinamento."
    )

    def __init__(
        self,
        graph_db: Any = None,
        max_results: int = 10
    ):
        """
        Inizializza PrincipleLookupTool.

        Args:
            graph_db: FalkorDBClient per query al grafo
            max_results: Numero massimo di principi da restituire
        """
        super().__init__()
        self.graph_db = graph_db
        self.max_results = max_results

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="query",
                param_type=ParameterType.STRING,
                description=(
                    "Principio giuridico da cercare. "
                    "Es: 'buona fede', 'proporzionalità', 'legalità', "
                    "'correttezza', 'uguaglianza', 'sussidiarietà'"
                )
            ),
            ToolParameter(
                name="principle_level",
                param_type=ParameterType.ARRAY,
                description=(
                    "Filtra per livello di principio. "
                    "Valori possibili: ['costituzionale', 'generale', 'europeo']. "
                    "Default: tutti i livelli."
                ),
                required=False
            ),
            ToolParameter(
                name="top_k",
                param_type=ParameterType.INTEGER,
                description="Numero massimo di principi da restituire",
                required=False,
                default=5
            )
        ]

    async def execute(
        self,
        query: str,
        principle_level: Optional[List[str]] = None,
        top_k: int = 5
    ) -> ToolResult:
        """
        Cerca principi giuridici per la query specificata.

        Args:
            query: Principio da cercare
            principle_level: Filtro per livello principio
            top_k: Numero massimo risultati

        Returns:
            ToolResult con lista di principi trovati
        """
        log.debug(
            f"principle_lookup - query='{query}', "
            f"levels={principle_level}, top_k={top_k}"
        )

        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        try:
            principles = []

            # Strategy 1: Look for ESPRIME_PRINCIPIO relationships
            graph_principles = await self._find_principles_via_relation(
                query, principle_level, top_k
            )
            principles.extend(graph_principles)

            # Strategy 2: Look for PrincipioGiuridico nodes with matching name
            if len(principles) < top_k:
                direct_principles = await self._find_principle_nodes(
                    query, principle_level, top_k - len(principles)
                )
                principles.extend(direct_principles)

            # Strategy 3: Fuzzy search in article text mentioning principles
            if len(principles) < top_k:
                text_principles = await self._find_principles_in_text(
                    query, top_k - len(principles)
                )
                principles.extend(text_principles)

            # Deduplicate by nome
            seen_names = set()
            unique_principles = []
            for p in principles:
                if p["nome"] not in seen_names:
                    seen_names.add(p["nome"])
                    unique_principles.append(p)

            # Sort by confidence
            unique_principles.sort(key=lambda x: x["confidence"], reverse=True)
            unique_principles = unique_principles[:top_k]

            log.info(
                f"principle_lookup completed - "
                f"query='{query}', found={len(unique_principles)}"
            )

            return ToolResult.ok(
                data={
                    "query": query,
                    "principles": unique_principles,
                    "total": len(unique_principles),
                    "principle_level": principle_level or ["all"],
                },
                tool_name=self.name,
                query=query,
                principles_found=len(unique_principles)
            )

        except Exception as e:
            log.error(f"principle_lookup failed: {e}")
            return ToolResult.fail(
                error=f"Errore nella ricerca principi: {str(e)}",
                tool_name=self.name
            )

    async def _find_principles_via_relation(
        self,
        query: str,
        principle_level: Optional[List[str]],
        limit: int
    ) -> List[Dict[str, Any]]:
        """
        Cerca principi tramite relazione ESPRIME_PRINCIPIO.

        Pattern: (Norma)-[:ESPRIME_PRINCIPIO]->(PrincipioGiuridico)
        """
        # Build level filter
        level_filter = ""
        if principle_level:
            level_conditions = " OR ".join([
                f"p.livello = '{level}'" for level in principle_level
            ])
            level_filter = f"AND ({level_conditions})"

        cypher = f"""
            MATCH (n:Norma)-[:ESPRIME_PRINCIPIO]->(p:PrincipioGiuridico)
            WHERE (toLower(p.nome) CONTAINS toLower($query)
                   OR toLower(p.descrizione) CONTAINS toLower($query))
                {level_filter}
            WITH p, collect(DISTINCT n.estremi) as norme_attuative,
                 collect(DISTINCT n.URN) as norme_urns
            RETURN
                p.nome as nome,
                p.descrizione as description,
                p.livello as level,
                norme_attuative[0] as fondamento,
                norme_attuative,
                norme_urns
            LIMIT {limit}
        """

        try:
            results = await self.graph_db.query(cypher, {"query": query})

            return [
                LegalPrinciple(
                    nome=r.get("nome", ""),
                    description=r.get("description"),
                    level=r.get("level", "generale"),
                    fondamento=r.get("fondamento", ""),
                    norme_attuative=r.get("norme_attuative", []),
                    norme_urns=r.get("norme_urns", []),
                    confidence=1.0  # Direct ESPRIME_PRINCIPIO relation
                ).to_dict()
                for r in results
                if r.get("nome")
            ]
        except Exception as e:
            log.debug(f"ESPRIME_PRINCIPIO query failed: {e}")
            return []

    async def _find_principle_nodes(
        self,
        query: str,
        principle_level: Optional[List[str]],
        limit: int
    ) -> List[Dict[str, Any]]:
        """
        Cerca nodi PrincipioGiuridico con match diretto.
        """
        # Build level filter
        level_filter = ""
        if principle_level:
            level_conditions = " OR ".join([
                f"p.livello = '{level}'" for level in principle_level
            ])
            level_filter = f"AND ({level_conditions})"

        cypher = f"""
            MATCH (p:PrincipioGiuridico)
            WHERE (toLower(p.nome) CONTAINS toLower($query)
                   OR toLower(p.descrizione) CONTAINS toLower($query))
                {level_filter}
            OPTIONAL MATCH (n:Norma)-[:ESPRIME_PRINCIPIO]->(p)
            WITH p, collect(DISTINCT n.estremi) as norme_attuative,
                 collect(DISTINCT n.URN) as norme_urns
            RETURN
                p.nome as nome,
                p.descrizione as description,
                p.livello as level,
                p.fondamento_normativo as fondamento,
                norme_attuative,
                norme_urns
            LIMIT {limit}
        """

        try:
            results = await self.graph_db.query(cypher, {"query": query})

            return [
                LegalPrinciple(
                    nome=r.get("nome", ""),
                    description=r.get("description"),
                    level=r.get("level", "generale"),
                    fondamento=r.get("fondamento", r.get("norme_attuative", [""])[0] if r.get("norme_attuative") else ""),
                    norme_attuative=r.get("norme_attuative", []),
                    norme_urns=r.get("norme_urns", []),
                    confidence=0.9  # Direct principle node match
                ).to_dict()
                for r in results
                if r.get("nome")
            ]
        except Exception as e:
            log.debug(f"PrincipioGiuridico query failed: {e}")
            return []

    async def _find_principles_in_text(
        self,
        query: str,
        limit: int
    ) -> List[Dict[str, Any]]:
        """
        Cerca principi nel testo delle norme.

        Pattern di menzione comuni:
        - "principio di"
        - "principio della"
        - "in base al principio"
        - "secondo il principio"
        """
        cypher = f"""
            MATCH (n:Norma)
            WHERE n.testo_vigente IS NOT NULL
              AND toLower(n.testo_vigente) CONTAINS toLower($query)
              AND (
                  toLower(n.testo_vigente) CONTAINS 'principio'
                  OR toLower(n.testo_vigente) CONTAINS 'generale'
              )
            RETURN
                n.URN as source_urn,
                n.estremi as source_estremi,
                n.testo_vigente as text
            LIMIT {limit}
        """

        try:
            results = await self.graph_db.query(cypher, {"query": query})

            principles = []
            for r in results:
                text = r.get("text", "")
                # Extract principle name from text (simple heuristic)
                principle_name = query  # Default to query
                if "principio" in text.lower():
                    # Try to extract "principio di X" or "principio della X"
                    for pattern in ["principio di ", "principio della ", "principio del "]:
                        idx = text.lower().find(pattern)
                        if idx != -1:
                            start = idx + len(pattern)
                            end = text.find(" ", start + len(query))
                            if end == -1:
                                end = start + 50
                            principle_name = text[start:end].strip()
                            break

                principles.append(
                    LegalPrinciple(
                        nome=principle_name,
                        description=text[:500],  # Truncate
                        level="generale",  # Default level
                        fondamento=r.get("source_estremi", ""),
                        norme_attuative=[r.get("source_estremi", "")],
                        norme_urns=[r.get("source_urn", "")],
                        confidence=0.6  # Text-based inference (less precise)
                    ).to_dict()
                )

            return principles
        except Exception as e:
            log.debug(f"Text search query failed: {e}")
            return []
