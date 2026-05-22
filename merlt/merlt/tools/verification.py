"""
Verification Tool
==================

Tool per la verifica dell'esistenza di fonti nel knowledge graph.

Critico per:
- Prevenire hallucination degli LLM (citazione fonti inesistenti)
- Validare legal_basis prima di restituire risposte
- Garantire grounding delle interpretazioni

Esempio:
    >>> from merlt.tools import VerificationTool
    >>>
    >>> tool = VerificationTool(graph_db=falkordb, bridge=bridge_table)
    >>> result = await tool(source_ids=["urn:norma:cc:art1453", "fake_source"])
    >>> print(result.data["unverified"])  # ["fake_source"]
"""

import structlog
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


@dataclass
class VerificationResult:
    """
    Risultato verifica per una singola fonte.

    Attributes:
        source_id: ID della fonte (URN o chunk_id)
        exists_in_graph: Se esiste nel knowledge graph (FalkorDB)
        chunk_count: Numero di chunks collegati (Bridge Table)
        node_type: Tipo del nodo se trovato (Norma, ConcettoGiuridico, etc.)
        verified: True se esiste nel grafo E ha almeno un chunk
        confidence: Score di confidenza verifica [0-1]
    """
    source_id: str
    exists_in_graph: bool
    chunk_count: int
    node_type: Optional[str] = None
    verified: bool = False
    confidence: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "source_id": self.source_id,
            "exists_in_graph": self.exists_in_graph,
            "chunk_count": self.chunk_count,
            "node_type": self.node_type,
            "verified": self.verified,
            "confidence": self.confidence
        }


class VerificationTool(BaseTool):
    """
    Tool per verificare l'esistenza di fonti nel knowledge graph.

    Verifica che i source_ids citati dagli Expert esistano realmente:
    1. Nel knowledge graph (FalkorDB) - esistenza del nodo
    2. Nella Bridge Table - collegamento a chunks testuali

    Una fonte è "verified" solo se:
    - Esiste come nodo nel grafo E
    - Ha almeno un chunk testuale collegato

    Questo previene che gli LLM inventino citazioni inesistenti.

    Esempio:
        >>> tool = VerificationTool(graph_db=falkordb, bridge=bridge_table)
        >>> result = await tool(
        ...     source_ids=["urn:norma:cc:art1453", "urn:norma:cc:art2043"],
        ...     strict_mode=True
        ... )
        >>> if result.data["all_verified"]:
        ...     print("Tutte le fonti sono verificate!")
        >>> else:
        ...     print(f"Fonti non trovate: {result.data['unverified']}")
    """

    name = "verify_sources"
    description = (
        "Verifica che le fonti citate (articoli, sentenze, concetti) esistano "
        "nel knowledge graph. Usa questo tool PRIMA di citare fonti in una "
        "risposta per evitare citazioni di fonti inesistenti."
    )

    def __init__(
        self,
        graph_db: Any = None,
        bridge: Any = None,
        require_chunks: bool = True
    ):
        """
        Inizializza VerificationTool.

        Args:
            graph_db: FalkorDBClient per query al grafo
            bridge: BridgeTable per query chunk-to-node
            require_chunks: Se True, richiede almeno un chunk per verificare
        """
        super().__init__()
        self.graph_db = graph_db
        self.bridge = bridge
        self.require_chunks = require_chunks

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="source_ids",
                param_type=ParameterType.ARRAY,
                description=(
                    "Lista di source IDs da verificare. Possono essere: "
                    "URN di norme (es. '/eli/it/cc/1942/03/16/262/art1453/ita'), "
                    "nomi di concetti (es. 'legittima difesa'), "
                    "o chunk_ids (UUID)."
                )
            ),
            ToolParameter(
                name="strict_mode",
                param_type=ParameterType.BOOLEAN,
                description=(
                    "Se True, richiede esistenza nel grafo E chunks collegati. "
                    "Se False, basta esistenza nel grafo."
                ),
                required=False,
                default=True
            ),
            ToolParameter(
                name="node_types",
                param_type=ParameterType.ARRAY,
                description=(
                    "Filtra per tipi di nodo. "
                    "Es: ['Norma'], ['ConcettoGiuridico', 'PrincipioGiuridico']"
                ),
                required=False
            )
        ]

    async def execute(
        self,
        source_ids: List[str],
        strict_mode: bool = True,
        node_types: Optional[List[str]] = None
    ) -> ToolResult:
        """
        Verifica l'esistenza delle fonti nel knowledge graph.

        Args:
            source_ids: Lista di source IDs da verificare
            strict_mode: Se True, richiede anche chunks collegati
            node_types: Filtra per tipo nodo

        Returns:
            ToolResult con:
            - verification_results: Dict per ogni source_id
            - all_verified: True se tutte le fonti sono verificate
            - verified: Lista di source_id verificati
            - unverified: Lista di source_id non trovati
            - partial: Lista di source_id con solo grafo (no chunks)
        """
        log.debug(
            f"verify_sources - {len(source_ids)} sources, "
            f"strict={strict_mode}, types={node_types}"
        )

        if not source_ids:
            return ToolResult.ok(
                data={
                    "verification_results": {},
                    "all_verified": True,
                    "verified": [],
                    "unverified": [],
                    "partial": [],
                    "total_checked": 0
                },
                tool_name=self.name
            )

        # Verifica dipendenze
        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        if strict_mode and self.bridge is None:
            return ToolResult.fail(
                error="BridgeTable non configurato (richiesto per strict_mode)",
                tool_name=self.name
            )

        try:
            results = {}
            verified = []
            unverified = []
            partial = []

            for source_id in source_ids:
                # Step 1: Check graph existence
                graph_result = await self._check_graph_existence(
                    source_id, node_types
                )

                # Step 2: Check chunk count (if bridge available)
                chunk_count = 0
                if self.bridge and graph_result["exists"]:
                    chunk_count = await self._count_chunks_for_source(source_id)

                # Step 3: Determine verification status
                if strict_mode:
                    is_verified = graph_result["exists"] and chunk_count > 0
                else:
                    is_verified = graph_result["exists"]

                # Calculate confidence
                confidence = self._calculate_confidence(
                    exists=graph_result["exists"],
                    chunk_count=chunk_count,
                    strict_mode=strict_mode
                )

                result = VerificationResult(
                    source_id=source_id,
                    exists_in_graph=graph_result["exists"],
                    chunk_count=chunk_count,
                    node_type=graph_result.get("node_type"),
                    verified=is_verified,
                    confidence=confidence
                )

                results[source_id] = result.to_dict()

                # Categorize
                if is_verified:
                    verified.append(source_id)
                elif graph_result["exists"] and chunk_count == 0:
                    partial.append(source_id)
                else:
                    unverified.append(source_id)

            all_verified = len(unverified) == 0 and len(partial) == 0

            log.info(
                f"verify_sources completed - "
                f"verified={len(verified)}, "
                f"unverified={len(unverified)}, "
                f"partial={len(partial)}"
            )

            return ToolResult.ok(
                data={
                    "verification_results": results,
                    "all_verified": all_verified,
                    "verified": verified,
                    "unverified": unverified,
                    "partial": partial,
                    "total_checked": len(source_ids),
                    "strict_mode": strict_mode
                },
                tool_name=self.name,
                source_count=len(source_ids),
                verified_count=len(verified),
                strict_mode=strict_mode
            )

        except Exception as e:
            log.error(f"verify_sources failed: {e}")
            return ToolResult.fail(
                error=f"Errore durante la verifica: {str(e)}",
                tool_name=self.name
            )

    async def _check_graph_existence(
        self,
        source_id: str,
        node_types: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Verifica se un nodo esiste nel knowledge graph.

        Cerca per:
        - URN completo
        - Estremi
        - Nome (per concetti)
        - numero_articolo (per norme)

        Returns:
            Dict con "exists": bool e "node_type": str opzionale
        """
        # Build node type filter
        type_filter = ""
        if node_types:
            labels = ":".join(node_types)
            type_filter = f":{labels}"

        # Try multiple match strategies
        cypher = f"""
            MATCH (n{type_filter})
            WHERE n.URN = $source_id
               OR n.nome = $source_id
               OR n.estremi = $source_id
               OR n.numero_articolo = $source_id
            RETURN labels(n)[0] AS node_type, n.URN AS urn
            LIMIT 1
        """

        try:
            results = await self.graph_db.query(cypher, {"source_id": source_id})

            if results:
                return {
                    "exists": True,
                    "node_type": results[0].get("node_type"),
                    "urn": results[0].get("urn")
                }

            # Fallback: Try partial URN match for article numbers
            if source_id.startswith("art") or source_id.isdigit():
                cypher_article = """
                    MATCH (n:Norma)
                    WHERE n.numero_articolo = $article_num
                    RETURN labels(n)[0] AS node_type, n.URN AS urn
                    LIMIT 1
                """
                article_num = source_id.replace("art", "").strip()
                results = await self.graph_db.query(
                    cypher_article,
                    {"article_num": article_num}
                )

                if results:
                    return {
                        "exists": True,
                        "node_type": "Norma",
                        "urn": results[0].get("urn")
                    }

            return {"exists": False, "node_type": None}

        except Exception as e:
            log.warning(f"Graph check failed for {source_id}: {e}")
            return {"exists": False, "node_type": None}

    async def _count_chunks_for_source(self, source_id: str) -> int:
        """
        Conta i chunks collegati a una fonte nella Bridge Table.

        Args:
            source_id: URN o identificativo della fonte

        Returns:
            Numero di chunks collegati (0 se non trovato)
        """
        try:
            chunks = await self.bridge.get_chunks_for_node(source_id)
            return len(chunks)
        except Exception as e:
            log.debug(f"Chunk count failed for {source_id}: {e}")
            return 0

    def _calculate_confidence(
        self,
        exists: bool,
        chunk_count: int,
        strict_mode: bool
    ) -> float:
        """
        Calcola confidence score per la verifica.

        Formula:
        - Base: 0.5 se esiste nel grafo
        - +0.3 se ha chunks
        - +0.2 se ha 3+ chunks

        Returns:
            Confidence score [0-1]
        """
        if not exists:
            return 0.0

        confidence = 0.5  # Base: exists in graph

        if chunk_count > 0:
            confidence += 0.3  # Has at least one chunk

        if chunk_count >= 3:
            confidence += 0.2  # Well-grounded (multiple chunks)

        return min(confidence, 1.0)


class SourceVerificationMixin:
    """
    Mixin per aggiungere verifica fonti agli Expert.

    Aggiunge metodo verify_legal_basis() per validare fonti
    prima di restituire la risposta.

    Esempio:
        class LiteralExpert(BaseExpert, SourceVerificationMixin):
            async def analyze(self, context):
                response = await self._analyze_with_llm(context)

                # Verifica fonti prima di restituire
                response = await self.verify_legal_basis(
                    response,
                    context.retrieved_chunks
                )
                return response
    """

    async def verify_legal_basis(
        self,
        response: Any,  # ExpertResponse
        retrieved_chunks: List[Dict[str, Any]],
        remove_unverified: bool = True
    ) -> Any:
        """
        Verifica le fonti in legal_basis contro i chunks recuperati.

        Args:
            response: ExpertResponse da verificare
            retrieved_chunks: Chunks effettivamente recuperati
            remove_unverified: Se True, rimuove fonti non verificate

        Returns:
            ExpertResponse con legal_basis filtrato e confidence aggiustata
        """
        if not hasattr(response, 'legal_basis') or not response.legal_basis:
            return response

        # Build set of valid source IDs from retrieved chunks
        valid_ids = set()
        for chunk in retrieved_chunks:
            valid_ids.add(chunk.get("chunk_id", ""))
            valid_ids.add(chunk.get("urn", ""))
            valid_ids.add(chunk.get("graph_node_urn", ""))
            # Also add article number variants
            if chunk.get("numero_articolo"):
                valid_ids.add(str(chunk["numero_articolo"]))
                valid_ids.add(f"art{chunk['numero_articolo']}")

        # Filter and track removed sources
        verified_sources = []
        removed_sources = []

        for source in response.legal_basis:
            source_id = getattr(source, 'source_id', str(source))

            if source_id in valid_ids:
                verified_sources.append(source)
            else:
                removed_sources.append(source_id)

        # Update response if sources were removed
        if removed_sources:
            if remove_unverified:
                response.legal_basis = verified_sources

            # Adjust confidence based on removed sources
            original_count = len(response.legal_basis) + len(removed_sources)
            penalty = len(removed_sources) / max(original_count, 1)
            response.confidence *= (1 - penalty * 0.3)

            # Add note to limitations
            if hasattr(response, 'limitations'):
                note = f"\n[Verifica: {len(removed_sources)} fonti non grounded rimosse]"
                response.limitations = (response.limitations or "") + note

            log.warning(
                f"Source verification removed {len(removed_sources)} sources",
                removed=removed_sources,
                kept=len(verified_sources)
            )

        return response
