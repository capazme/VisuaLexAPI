"""
Search Tools
=============

Tools per la ricerca semantica e basata su grafo nel knowledge graph giuridico.

Tools disponibili:
- SemanticSearchTool: Ricerca ibrida vettori + grafo
- GraphSearchTool: Ricerca pura su grafo (traversal)

Esempio:
    >>> from merlt.tools import SemanticSearchTool
    >>>
    >>> tool = SemanticSearchTool(retriever=retriever, embeddings=embeddings)
    >>> result = await tool(query="Cos'è la legittima difesa?", top_k=5)
    >>> for item in result.data["results"]:
    ...     print(item["text"][:100])
"""

import structlog
import hashlib
import json
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from merlt.tools.base import BaseTool, ToolResult, ToolParameter, ParameterType

log = structlog.get_logger()


@dataclass
class SearchResultItem:
    """
    Singolo risultato di ricerca.

    Attributes:
        chunk_id: ID del chunk
        text: Testo del chunk
        similarity_score: Score similarità vettoriale [0-1]
        graph_score: Score basato su grafo [0-1]
        final_score: Score combinato [0-1]
        linked_nodes: Nodi grafo collegati
        metadata: Metadati aggiuntivi
    """
    chunk_id: str
    text: str
    similarity_score: float
    graph_score: float
    final_score: float
    linked_nodes: List[Dict[str, Any]]
    metadata: Dict[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        """Converte in dizionario per serializzazione."""
        return {
            "chunk_id": self.chunk_id,
            "text": self.text,
            "similarity_score": self.similarity_score,
            "graph_score": self.graph_score,
            "final_score": self.final_score,
            "linked_nodes": self.linked_nodes,
            "metadata": self.metadata
        }


def _is_tool_error_text(text: str) -> bool:
    """A chunk whose text is a failed tool response (e.g. a provisional node
    sedimented from a ``cite_law`` miss: ``**Errore**: atto '...' non
    riconosciuto``). These are index pollution — never a valid source to cite."""
    t = (text or "").strip().lower()
    if not t:
        return False
    return (
        t.startswith("**errore")
        or t.startswith("errore:")
        or "non riconosciuto" in t
    )


def _readable_source_label(result: Dict[str, Any]) -> str:
    """Human-readable identity for a retrieved source so the FE never shows an
    opaque id (e.g. a provisional ``live:<hash>`` that resolves to nothing).
    Prefers a normative reference (art. N + act), then a case-law / text snippet
    — always something the jurist can recognize to give meaningful feedback."""
    meta = result.get("metadata") or {}
    art = str(meta.get("numero_articolo") or "").strip()
    tipo = str(meta.get("tipo_atto") or "").strip()
    source_type = str(meta.get("source_type") or "").strip().lower()
    text = " ".join(str(result.get("text") or "").split()).strip()

    def _snippet(s: str, n: int = 80) -> str:
        return s[:n] + ("…" if len(s) > n else "")

    if source_type in {"massima", "sentenza", "giurisprudenza"} and text:
        return "Massima — " + _snippet(text, 70)
    if art:
        return f"art. {art} {tipo}".strip()
    if text:
        return _snippet(text)
    return ""


class SemanticSearchTool(BaseTool):
    """
    Tool per ricerca semantica ibrida nel knowledge graph.

    Combina:
    - Ricerca vettoriale (Qdrant) per similarità semantica
    - Struttura grafo (FalkorDB) per contesto giuridico

    Formula: final_score = α * similarity_score + (1-α) * graph_score

    Includes a class-level retrieval cache shared across cloned instances
    to avoid duplicate embedding+search when multiple experts issue
    identical queries in the same pipeline run.

    Esempio:
        >>> from merlt.tools import SemanticSearchTool
        >>> from merlt.storage.retriever import GraphAwareRetriever
        >>> from merlt.storage.vectors import EmbeddingService
        >>>
        >>> tool = SemanticSearchTool(
        ...     retriever=retriever,
        ...     embeddings=EmbeddingService.get_instance()
        ... )
        >>> result = await tool(
        ...     query="Quali sono i termini per la risoluzione del contratto?",
        ...     top_k=10,
        ...     expert_type="LiteralExpert"
        ... )
        >>> print(f"Trovati {len(result.data['results'])} risultati")
    """

    # Class-level cache shared across clones (cleared per pipeline run)
    _shared_cache: Dict[str, "ToolResult"] = {}

    name = "semantic_search"
    description = (
        "Cerca nel knowledge graph giuridico usando ricerca semantica ibrida. "
        "Combina similarità vettoriale con struttura del grafo per risultati "
        "contestualmente rilevanti. Utile per domande su articoli, concetti, "
        "principi giuridici."
    )

    def __init__(
        self,
        retriever: Any = None,
        embeddings: Any = None,
        default_top_k: int = 10,
        default_expert_type: Optional[str] = None
    ):
        """
        Inizializza SemanticSearchTool.

        Args:
            retriever: Istanza di GraphAwareRetriever
            embeddings: Istanza di EmbeddingService
            default_top_k: Numero default di risultati
            default_expert_type: Expert type default (LiteralExpert, SystemicExpert, etc.)
        """
        super().__init__()
        self.retriever = retriever
        self.embeddings = embeddings
        self.default_top_k = default_top_k
        self.default_expert_type = default_expert_type

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="query",
                param_type=ParameterType.STRING,
                description=(
                    "Query di ricerca in linguaggio naturale. "
                    "Es: 'Cos'è la legittima difesa?', "
                    "'Termini per risoluzione contratto'"
                )
            ),
            ToolParameter(
                name="top_k",
                param_type=ParameterType.INTEGER,
                description="Numero massimo di risultati da ritornare",
                required=False,
                default=10
            ),
            ToolParameter(
                name="expert_type",
                param_type=ParameterType.STRING,
                description=(
                    "Tipo di expert per pesatura traversal grafo. "
                    "Influenza quali relazioni sono privilegiate."
                ),
                required=False,
                enum=["LiteralExpert", "SystemicExpert", "PrinciplesExpert", "PrecedentExpert"]
            ),
            ToolParameter(
                name="context_nodes",
                param_type=ParameterType.ARRAY,
                description=(
                    "URN di nodi grafo per contestualizzare la ricerca. "
                    "Es: ['urn:norma:cc:art1453']"
                ),
                required=False
            ),
            ToolParameter(
                name="min_score",
                param_type=ParameterType.FLOAT,
                description="Score minimo per filtrare risultati [0-1]",
                required=False,
                default=0.0
            ),
            ToolParameter(
                name="source_types",
                param_type=ParameterType.ARRAY,
                description=(
                    "Filtra per tipo di fonte. Specializzazione per expert: "
                    "LiteralExpert=['norma'], "
                    "SystemicExpert=['norma'], "
                    "PrinciplesExpert=['ratio','spiegazione'], "
                    "PrecedentExpert=['massima']"
                ),
                required=False
            )
        ]

    async def execute(
        self,
        query: str,
        top_k: int = None,
        expert_type: str = None,
        context_nodes: List[str] = None,
        min_score: float = 0.0,
        source_types: List[str] = None
    ) -> ToolResult:
        """
        Esegue ricerca semantica ibrida.

        Args:
            query: Query in linguaggio naturale
            top_k: Numero risultati (default: 10)
            expert_type: Tipo expert per pesatura grafo
            context_nodes: URN nodi per contesto
            min_score: Score minimo per filtrare
            source_types: Filtro per tipo fonte (es: ['norma'], ['massima'])

        Returns:
            ToolResult con lista di risultati ordinati per final_score
        """
        top_k = top_k or self.default_top_k
        expert_type = expert_type or self.default_expert_type

        log.debug(
            f"semantic_search - query='{query[:50]}...', "
            f"top_k={top_k}, expert={expert_type}, source_types={source_types}"
        )

        # Check class-level cache (keyed on query+source_types+top_k, NOT expert_type)
        cache_key = self._make_cache_key(query, top_k, source_types)
        if cache_key in SemanticSearchTool._shared_cache:
            log.info("semantic_search cache hit", expert=expert_type)
            return SemanticSearchTool._shared_cache[cache_key]

        # Verifica dipendenze
        if self.embeddings is None:
            return ToolResult.fail(
                error="EmbeddingService non configurato",
                tool_name=self.name
            )

        if self.retriever is None:
            return ToolResult.fail(
                error="GraphAwareRetriever non configurato",
                tool_name=self.name
            )

        try:
            # Step 1: Genera embedding della query
            query_embedding = await self._encode_query(query)

            # Step 2: Hybrid retrieval with source_type filtering
            retrieval_results = await self.retriever.retrieve(
                query_embedding=query_embedding,
                context_nodes=context_nodes,
                expert_type=expert_type,
                top_k=top_k,
                source_types=source_types
            )

            # Step 3: Converti e filtra risultati
            results = []
            for r in retrieval_results:
                if r.final_score >= min_score:
                    results.append(SearchResultItem(
                        chunk_id=str(r.chunk_id),
                        text=r.text,
                        similarity_score=r.similarity_score,
                        graph_score=r.graph_score,
                        final_score=r.final_score,
                        linked_nodes=r.linked_nodes,
                        metadata=r.metadata
                    ).to_dict())

            # Drop index-pollution chunks whose body is a failed tool response
            # (e.g. a provisional node sedimented from a cite_law miss) — not
            # citable content, and they must not ground the experts either.
            results = [r for r in results if not _is_tool_error_text(r.get("text", ""))]

            log.info(
                f"semantic_search completed - "
                f"query='{query[:30]}...', "
                f"results={len(results)}, "
                f"top_score={results[0]['final_score']:.3f}" if results else "no results"
            )

            # Extract retrieval metadata for tracing
            retriever_alpha = getattr(
                getattr(self.retriever, 'config', None), 'alpha', 0.7
            )
            over_retrieve_factor = getattr(
                getattr(self.retriever, 'config', None), 'over_retrieve_factor', 3
            )
            top_source_urns = []
            top_source_labels: Dict[str, str] = {}
            seen_urns = set()
            for r in results[:5]:
                urn = (
                    r.get("metadata", {}).get("article_urn", "")
                    or r.get("chunk_id", "")
                )
                if urn and urn not in seen_urns:
                    seen_urns.add(urn)
                    top_source_urns.append(urn)
                    label = _readable_source_label(r)
                    if label:
                        top_source_labels[urn] = label

            tool_result = ToolResult.ok(
                data={
                    "query": query,
                    "results": results,
                    "total": len(results),
                    "expert_type": expert_type,
                    "context_nodes": context_nodes or [],
                    "source_types": source_types or []
                },
                tool_name=self.name,
                query=query,
                top_k=top_k,
                expert_type=expert_type,
                source_types=source_types,
                retrieval_alpha=retriever_alpha,
                total_candidates=top_k * over_retrieve_factor,
                chunks_after_reranking=len(results),
                top_source_urns=top_source_urns,
                top_source_labels=top_source_labels,
            )

            # Store in shared cache
            SemanticSearchTool._shared_cache[cache_key] = tool_result
            return tool_result

        except Exception as e:
            log.error(f"semantic_search failed: {e}")
            return ToolResult.fail(
                error=f"Errore durante la ricerca: {str(e)}",
                tool_name=self.name
            )

    @staticmethod
    def _make_cache_key(
        query: str, top_k: int, source_types: Optional[List[str]]
    ) -> str:
        """Create cache key from retrieval parameters (excludes expert_type)."""
        key_data = json.dumps(
            {"q": query, "k": top_k, "st": sorted(source_types or [])},
            sort_keys=True,
        )
        return hashlib.md5(key_data.encode(), usedforsecurity=False).hexdigest()

    @classmethod
    def clear_cache(cls):
        """Clear the shared retrieval cache. Call at pipeline start."""
        cls._shared_cache.clear()

    async def _encode_query(self, query: str) -> List[float]:
        """
        Genera embedding per la query.

        Utilizza il prefisso "query: " come richiesto da E5.
        """
        # EmbeddingService supporta encode_query() che aggiunge il prefisso
        if hasattr(self.embeddings, 'encode_query'):
            # Sync method - wrap in executor se necessario
            import asyncio
            loop = asyncio.get_event_loop()
            embedding = await loop.run_in_executor(
                None,
                self.embeddings.encode_query,
                query
            )
            return embedding.tolist() if hasattr(embedding, 'tolist') else embedding

        # Fallback: encode generico
        if hasattr(self.embeddings, 'encode'):
            import asyncio
            loop = asyncio.get_event_loop()
            embedding = await loop.run_in_executor(
                None,
                lambda: self.embeddings.encode(f"query: {query}")
            )
            return embedding.tolist() if hasattr(embedding, 'tolist') else embedding

        raise ValueError("EmbeddingService non supporta encode_query o encode")


class GraphSearchTool(BaseTool):
    """
    Tool per ricerca diretta nel knowledge graph.

    Esegue traversal del grafo senza componente vettoriale.
    Utile per:
    - Navigare relazioni tra norme
    - Trovare path tra concetti
    - Esplorare gerarchie normative

    Esempio:
        >>> tool = GraphSearchTool(graph_db=falkordb_client)
        >>> result = await tool(
        ...     start_node="urn:norma:cp:art52",
        ...     relation_types=["disciplina", "definisce"],
        ...     max_hops=2
        ... )
    """

    name = "graph_search"
    description = (
        "Cerca nel knowledge graph tramite traversal diretto. "
        "Naviga relazioni tra norme, concetti, principi. "
        "Utile per esplorare la struttura del grafo senza ricerca semantica."
    )

    def __init__(
        self,
        graph_db: Any = None,
        default_max_hops: int = 2
    ):
        """
        Inizializza GraphSearchTool.

        Args:
            graph_db: Client FalkorDB
            default_max_hops: Profondità massima default del traversal
        """
        super().__init__()
        self.graph_db = graph_db
        self.default_max_hops = default_max_hops

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="start_node",
                param_type=ParameterType.STRING,
                description=(
                    "Chiave-nodo di partenza. Usa la chiave completa fornita dalle "
                    "fonti (URL Normattiva completo) oppure un id-nodo reale (es. "
                    "'massima_cassazione_civile_25837_2017'). NON inventare urn."
                )
            ),
            ToolParameter(
                name="relation_types",
                param_type=ParameterType.ARRAY,
                description=(
                    "Tipi di relazione da seguire. "
                    "Es: ['disciplina', 'definisce', 'cita']"
                ),
                required=False
            ),
            ToolParameter(
                name="max_hops",
                param_type=ParameterType.INTEGER,
                description="Profondità massima del traversal",
                required=False,
                default=2
            ),
            ToolParameter(
                name="target_type",
                param_type=ParameterType.STRING,
                description=(
                    "Tipo di nodo target da cercare. "
                    "Es: 'Norma', 'ConcettoGiuridico', 'PrincipioGiuridico'"
                ),
                required=False
            ),
            ToolParameter(
                name="direction",
                param_type=ParameterType.STRING,
                description="Direzione del traversal",
                required=False,
                enum=["outgoing", "incoming", "both"],
                default="outgoing"
            )
        ]

    async def execute(
        self,
        start_node: str,
        relation_types: List[str] = None,
        max_hops: int = None,
        target_type: str = None,
        direction: str = "outgoing"
    ) -> ToolResult:
        """
        Esegue traversal del knowledge graph.

        Args:
            start_node: URN nodo di partenza
            relation_types: Tipi di relazione da seguire (None = tutte)
            max_hops: Profondità massima
            target_type: Filtra per tipo nodo target
            direction: Direzione traversal (outgoing, incoming, both)

        Returns:
            ToolResult con nodi e relazioni trovati
        """
        max_hops = max_hops or self.default_max_hops

        log.debug(
            f"graph_search - start={start_node}, "
            f"relations={relation_types}, max_hops={max_hops}"
        )

        if self.graph_db is None:
            return ToolResult.fail(
                error="FalkorDB client non configurato",
                tool_name=self.name
            )

        try:
            # Costruisci query Cypher
            query, params = self._build_traversal_query(
                start_node=start_node,
                relation_types=relation_types,
                max_hops=max_hops,
                target_type=target_type,
                direction=direction
            )

            # Esegui query (FalkorDBClient usa .query(), non .execute_query())
            result = await self.graph_db.query(query, params)

            # Processa risultati
            nodes = []
            edges = []

            for record in result:
                if "node" in record:
                    nodes.append(self._node_to_dict(record["node"]))
                if "rel" in record:
                    edges.append(self._edge_to_dict(record["rel"]))

            log.info(
                f"graph_search completed - "
                f"start={start_node}, nodes={len(nodes)}, edges={len(edges)}"
            )

            return ToolResult.ok(
                data={
                    "start_node": start_node,
                    "nodes": nodes,
                    "edges": edges,
                    "total_nodes": len(nodes),
                    "total_edges": len(edges)
                },
                tool_name=self.name,
                start_node=start_node,
                max_hops=max_hops
            )

        except Exception as e:
            log.error(f"graph_search failed: {e}")
            return ToolResult.fail(
                error=f"Errore nel traversal: {str(e)}",
                tool_name=self.name
            )

    def _build_traversal_query(
        self,
        start_node: str,
        relation_types: List[str] = None,
        max_hops: int = 2,
        target_type: str = None,
        direction: str = "outgoing"
    ) -> tuple:
        """
        Costruisce query Cypher per il traversal.

        Returns:
            Tuple (query_string, params_dict)
        """
        # Direzione della relazione
        if direction == "outgoing":
            rel_pattern = f"-[r*1..{max_hops}]->"
        elif direction == "incoming":
            rel_pattern = f"<-[r*1..{max_hops}]-"
        else:  # both
            rel_pattern = f"-[r*1..{max_hops}]-"

        # Filtro per tipo relazione
        if relation_types:
            rel_types = "|".join(relation_types)
            rel_pattern = rel_pattern.replace("[r*", f"[r:{rel_types}*")

        # Target type filter
        target_filter = f":{target_type}" if target_type else ""

        query = f"""
        MATCH (start {{URN: $start_urn}})
        MATCH path = (start){rel_pattern}(target{target_filter})
        UNWIND nodes(path) AS node
        UNWIND relationships(path) AS rel
        RETURN DISTINCT node, rel
        LIMIT 100
        """

        params = {"start_urn": start_node}

        return query, params

    def _node_to_dict(self, node: Any) -> Dict[str, Any]:
        """Converte nodo FalkorDB in dizionario."""
        if hasattr(node, 'properties'):
            # Raw FalkorDB Node object
            props = dict(node.properties)
            labels = list(getattr(node, 'labels', []))
        elif isinstance(node, dict):
            # Already serialized by FalkorDBClient._query_sync
            # Structure: {"properties": {...}, "labels": [...], "id": ...}
            props = node.get("properties", node)
            labels = node.get("labels", [])
        else:
            props = {}
            labels = []

        return {
            "urn": props.get("URN", props.get("node_id", "")),
            "type": labels[0] if labels else props.get("_type", "Unknown"),
            "properties": props
        }

    def _edge_to_dict(self, edge: Any) -> Dict[str, Any]:
        """Converte edge FalkorDB in dizionario."""
        if hasattr(edge, 'relation') and not isinstance(edge, dict):
            # Raw FalkorDB Edge object
            edge_type = edge.relation
            props = dict(edge.properties) if hasattr(edge, 'properties') else {}
        elif isinstance(edge, dict):
            # Already serialized by FalkorDBClient._query_sync
            # Structure: {"properties": {...}, "relation": "TIPO", "id": ...}
            edge_type = edge.get("relation", "UNKNOWN")
            props = edge.get("properties", {})
        else:
            edge_type = "UNKNOWN"
            props = {}

        return {
            "type": edge_type,
            "properties": props
        }


class ArticleFetchTool(BaseTool):
    """
    Tool per recuperare testo articoli da Normattiva (API esterna).

    Utile quando l'articolo non è presente nel grafo locale.
    Gli expert possono usare questo tool per ottenere il testo ufficiale
    di qualsiasi articolo del sistema normativo italiano.

    Esempio:
        >>> tool = ArticleFetchTool()
        >>> result = await tool(
        ...     tipo_atto="codice civile",
        ...     numero_articolo="1453"
        ... )
        >>> print(result.data["text"][:200])
    """

    name = "article_fetch"
    description = (
        "Recupera il testo ufficiale di un articolo da Normattiva. "
        "Usa questo tool quando hai bisogno del testo di un articolo "
        "che non è presente nel database locale."
    )

    def __init__(self, scraper: Any = None):
        """
        Inizializza ArticleFetchTool.

        Args:
            scraper: NormattivaScraper opzionale. Se None, ne crea uno nuovo.
        """
        super().__init__()
        self._scraper = scraper
        self._scraper_initialized = False

    async def _get_scraper(self):
        """Lazy initialization del scraper."""
        if self._scraper is None:
            from merlt.clients import NormattivaScraper
            self._scraper = NormattivaScraper()
        return self._scraper

    @property
    def parameters(self) -> List[ToolParameter]:
        """Parametri del tool."""
        return [
            ToolParameter(
                name="tipo_atto",
                param_type=ParameterType.STRING,
                description=(
                    "Tipo di atto normativo. "
                    "Es: 'codice civile', 'codice penale', 'costituzione', "
                    "'decreto legislativo', 'legge'"
                )
            ),
            ToolParameter(
                name="numero_articolo",
                param_type=ParameterType.STRING,
                description=(
                    "Numero dell'articolo da recuperare. "
                    "Es: '1453', '52', '2043'"
                )
            ),
            ToolParameter(
                name="data_atto",
                param_type=ParameterType.STRING,
                description=(
                    "Data dell'atto per decreti/leggi (formato: YYYY-MM-DD). "
                    "Non necessario per codici."
                ),
                required=False
            ),
            ToolParameter(
                name="numero_atto",
                param_type=ParameterType.STRING,
                description=(
                    "Numero dell'atto per decreti/leggi. "
                    "Non necessario per codici."
                ),
                required=False
            )
        ]

    async def execute(
        self,
        tipo_atto: str,
        numero_articolo: str,
        data_atto: str = None,
        numero_atto: str = None
    ) -> ToolResult:
        """
        Recupera il testo di un articolo da Normattiva.

        Args:
            tipo_atto: Tipo di atto (codice civile, legge, etc.)
            numero_articolo: Numero dell'articolo
            data_atto: Data dell'atto (per decreti/leggi)
            numero_atto: Numero dell'atto (per decreti/leggi)

        Returns:
            ToolResult con testo dell'articolo e URN
        """
        log.debug(
            f"article_fetch - tipo={tipo_atto}, art={numero_articolo}"
        )

        try:
            from merlt.clients import Norma, NormaVisitata

            # Crea oggetto Norma
            norma = Norma(
                tipo_atto=tipo_atto,
                data=data_atto,
                numero_atto=numero_atto
            )

            # Crea NormaVisitata con articolo specifico
            norma_visitata = NormaVisitata(
                norma=norma,
                numero_articolo=numero_articolo
            )

            # Recupera documento
            scraper = await self._get_scraper()
            text, urn = await scraper.get_document(norma_visitata)

            log.info(
                f"article_fetch completed - "
                f"tipo={tipo_atto}, art={numero_articolo}, urn={urn[:50]}..."
            )

            return ToolResult.ok(
                data={
                    "text": text,
                    "urn": urn,
                    "tipo_atto": tipo_atto,
                    "numero_articolo": numero_articolo,
                    "source": "normattiva"
                },
                tool_name=self.name,
                tipo_atto=tipo_atto,
                numero_articolo=numero_articolo
            )

        except Exception as e:
            log.error(f"article_fetch failed: {e}")
            return ToolResult.fail(
                error=f"Impossibile recuperare articolo: {str(e)}",
                tool_name=self.name
            )
