"""
Constitutional Basis Tool
=========================

Tool per trovare la base costituzionale di una norma seguendo la gerarchia kelseniana.

Gerarchia delle fonti:
    Costituzione → Leggi costituzionali → Leggi ordinarie → Decreti legge → Regolamenti

Diritto UE:
    Trattati UE → Regolamenti UE → Direttive UE → Leggi nazionali di recepimento

Relazioni:
    - ATTUA: norma inferiore attua norma superiore
    - ESPRIME_PRINCIPIO: norma esprime principio costituzionale
    - DERIVA: derivazione generale
    - RECEPISCE: recepimento direttiva UE

Esempio:
    >>> from merlt.tools import ConstitutionalBasisTool
    >>>
    >>> tool = ConstitutionalBasisTool(graph_db=falkordb)
    >>> result = await tool(
    ...     article_urn="urn:norma:cc:art1453",
    ...     include_eu_law=True,
    ...     max_depth=3
    ... )
    >>> # Returns: base costituzionale + eventuale base UE
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


@dataclass
class ConstitutionalBasis:
    """
    Base costituzionale di una norma.

    Attributes:
        norm: URN della norma costituzionale
        norm_estremi: Riferimento completo (es. "Art. 3 Cost.")
        principle: Principio espresso dalla norma
        relation_path: Path di URN dalla norma di partenza alla costituzione
        strength: Tipo di collegamento ("diretta" | "indiretta")
    """
    norm: str
    norm_estremi: str
    principle: Optional[str]
    relation_path: List[str]
    strength: str  # "diretta" | "indiretta"

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "norm": self.norm,
            "norm_estremi": self.norm_estremi,
            "principle": self.principle,
            "relation_path": self.relation_path,
            "strength": self.strength
        }


@dataclass
class EUBasis:
    """
    Base nel diritto europeo.

    Attributes:
        norm: URN della norma UE
        norm_estremi: Riferimento completo
        principle: Principio espresso
        distance: Distanza nel grafo (1 = diretta, >1 = indiretta)
    """
    norm: str
    norm_estremi: str
    principle: Optional[str]
    distance: int

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "norm": self.norm,
            "norm_estremi": self.norm_estremi,
            "principle": self.principle,
            "distance": self.distance
        }


class ConstitutionalBasisTool(BaseTool):
    """
    Tool per trovare la base costituzionale di una norma.

    Risale la gerarchia delle fonti secondo la piramide kelseniana per trovare
    i principi costituzionali (e opzionalmente europei) su cui si fonda una norma.

    Utile per:
    - Expert PrinciplesExpert: identificare principi costituzionali applicabili
    - Expert SystemicExpert: comprendere posizione gerarchica
    - Analisi costituzionalità: verificare conformità a costituzione

    Esempio:
        >>> tool = ConstitutionalBasisTool(graph_db=falkordb_client)
        >>> result = await tool(
        ...     article_urn="urn:norma:cc:art2043",
        ...     include_eu_law=False,
        ...     max_depth=3
        ... )
        >>> for basis in result.data["constitutional_basis"]:
        ...     print(f"{basis['norm_estremi']}: {basis['principle']}")
        ...     print(f"  Collegamento {basis['strength']}")
    """

    name = "constitutional_basis"
    description = (
        "Trova la base costituzionale di una norma risalendo la gerarchia delle fonti. "
        "Identifica i principi costituzionali (e opzionalmente europei) che fondano "
        "la norma specificata. Utile per analisi di costituzionalità e interpretazione sistematica."
    )

    def __init__(
        self,
        graph_db: Any = None,
        max_depth: int = 3
    ):
        """
        Inizializza ConstitutionalBasisTool.

        Args:
            graph_db: FalkorDBClient per query al grafo
            max_depth: Profondità massima di risalita nella gerarchia (default: 3)
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
                    "URN o estremi della norma di partenza. "
                    "Es: 'urn:norma:cc:art1453', 'Art. 1453 c.c.'"
                )
            ),
            ToolParameter(
                name="include_eu_law",
                param_type=ParameterType.BOOLEAN,
                description="Se True, include anche la base nel diritto europeo",
                required=False,
                default=True
            ),
            ToolParameter(
                name="max_depth",
                param_type=ParameterType.INTEGER,
                description="Profondità massima di risalita (default: 3)",
                required=False,
                default=3
            )
        ]

    async def execute(
        self,
        article_urn: str,
        include_eu_law: bool = True,
        max_depth: int = 3
    ) -> ToolResult:
        """
        Trova la base costituzionale della norma specificata.

        Args:
            article_urn: URN o identificativo della norma
            include_eu_law: Include base europea
            max_depth: Profondità massima di ricerca

        Returns:
            ToolResult con base costituzionale e (opzionalmente) base UE
        """
        log.debug(
            f"constitutional_basis - article={article_urn}, "
            f"include_eu={include_eu_law}, max_depth={max_depth}"
        )

        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        try:
            # Find the starting node
            start_info = await self._find_article(article_urn)
            if not start_info:
                return ToolResult.fail(
                    error=f"Norma non trovata: {article_urn}",
                    tool_name=self.name
                )

            # Find constitutional basis
            constitutional_basis = await self._find_constitutional_basis(
                start_info["urn"],
                max_depth
            )

            # Optionally find EU basis
            eu_basis = []
            if include_eu_law:
                eu_basis = await self._find_eu_basis(
                    start_info["urn"],
                    max_depth
                )

            log.info(
                f"constitutional_basis completed - "
                f"article={article_urn}, "
                f"found {len(constitutional_basis)} constitutional + "
                f"{len(eu_basis)} EU bases"
            )

            return ToolResult.ok(
                data={
                    "article": start_info,
                    "constitutional_basis": [b.to_dict() for b in constitutional_basis],
                    "eu_basis": [b.to_dict() for b in eu_basis] if include_eu_law else None,
                    "total_constitutional": len(constitutional_basis),
                    "total_eu": len(eu_basis) if include_eu_law else 0
                },
                tool_name=self.name,
                article_urn=article_urn,
                constitutional_found=len(constitutional_basis),
                eu_found=len(eu_basis) if include_eu_law else 0
            )

        except Exception as e:
            log.error(f"constitutional_basis failed: {e}")
            return ToolResult.fail(
                error=f"Errore nella ricerca della base costituzionale: {str(e)}",
                tool_name=self.name
            )

    async def _find_article(self, identifier: str) -> Optional[Dict[str, Any]]:
        """
        Trova la norma di partenza nel grafo.

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
            RETURN
                n.URN AS urn,
                labels(n)[0] AS tipo,
                n.estremi AS estremi,
                n.rubrica AS rubrica
            LIMIT 1
        """

        try:
            results = await self.graph_db.query(cypher, {"id": identifier})
            if results:
                return {
                    "urn": results[0].get("urn", ""),
                    "tipo": results[0].get("tipo", "Unknown"),
                    "estremi": results[0].get("estremi", identifier),
                    "rubrica": results[0].get("rubrica")
                }
            return None
        except Exception as e:
            log.debug(f"Article search failed: {e}")
            return None

    async def _find_constitutional_basis(
        self,
        urn: str,
        max_depth: int
    ) -> List[ConstitutionalBasis]:
        """
        Trova la base costituzionale risalendo la gerarchia delle fonti.

        Segue relazioni: ATTUA, ESPRIME_PRINCIPIO, DERIVA
        Cerca nodi: tipo_atto='costituzione', estremi CONTAINS 'Cost.', URN CONTAINS 'costituzione'
        """
        cypher = f"""
            MATCH path = (start:Norma {{URN: $urn}})-[:ATTUA|ESPRIME_PRINCIPIO|DERIVA*1..{max_depth}]->(cost:Norma)
            WHERE cost.tipo_atto = 'costituzione'
               OR cost.estremi CONTAINS 'Cost.'
               OR cost.URN CONTAINS 'costituzione'
            RETURN
                cost.URN as norm_urn,
                cost.estremi as norm_estremi,
                cost.rubrica as principle,
                [n in nodes(path) | n.URN] as relation_path,
                length(path) as distance,
                CASE WHEN length(path) = 1 THEN 'diretta' ELSE 'indiretta' END as strength
            ORDER BY distance ASC
            LIMIT 10
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})

            bases = []
            for r in results:
                basis = ConstitutionalBasis(
                    norm=r.get("norm_urn", ""),
                    norm_estremi=r.get("norm_estremi", ""),
                    principle=r.get("principle"),
                    relation_path=r.get("relation_path", []),
                    strength=r.get("strength", "indiretta")
                )
                bases.append(basis)

            return bases

        except Exception as e:
            log.debug(f"Constitutional basis query failed: {e}")
            return []

    async def _find_eu_basis(
        self,
        urn: str,
        max_depth: int
    ) -> List[EUBasis]:
        """
        Trova la base nel diritto europeo.

        Segue relazioni: ATTUA, RECEPISCE, DERIVA
        Cerca nodi: tipo_atto IN [regolamento_ue, direttiva_ue, trattato], URN CONTAINS 'eurlex'
        """
        cypher = f"""
            MATCH path = (start:Norma {{URN: $urn}})-[:ATTUA|RECEPISCE|DERIVA*1..{max_depth}]->(eu)
            WHERE eu.tipo_atto IN ['regolamento_ue', 'direttiva_ue', 'trattato']
               OR eu.URN CONTAINS 'eurlex'
            RETURN
                eu.URN as norm_urn,
                eu.estremi as norm_estremi,
                eu.rubrica as principle,
                length(path) as distance
            ORDER BY distance ASC
            LIMIT 5
        """

        try:
            results = await self.graph_db.query(cypher, {"urn": urn})

            bases = []
            for r in results:
                basis = EUBasis(
                    norm=r.get("norm_urn", ""),
                    norm_estremi=r.get("norm_estremi", ""),
                    principle=r.get("principle"),
                    distance=r.get("distance", 0)
                )
                bases.append(basis)

            return bases

        except Exception as e:
            log.debug(f"EU basis query failed: {e}")
            return []
