"""
FalkorDB Client
===============

Async client for FalkorDB graph database.

FalkorDB runs on Redis protocol and supports Cypher queries.
This is a drop-in replacement for Neo4j with 496x better performance.

See docs/03-architecture/04-storage-layer.md for design details.
"""

import structlog
import asyncio
from typing import Dict, List, Any, Optional

from falkordb import FalkorDB, Graph

from merlt.storage.graph.config import FalkorDBConfig

log = structlog.get_logger()


class FalkorDBClient:
    """
    Async client for FalkorDB graph database.

    FalkorDB is Cypher-compatible, so existing Neo4j queries work.

    Example:
        client = FalkorDBClient(config)
        await client.connect()

        # Same Cypher as Neo4j
        results = await client.query('''
            MATCH (n:Norma {URN: $urn})-[r:interpreta]-(a:AttoGiudiziario)
            RETURN n, r, a
        ''', {"urn": "/eli/it/cc/1942/03/16/262/art1453/ita"})

        await client.close()
    """

    def __init__(self, config: Optional[FalkorDBConfig] = None, graph_name: Optional[str] = None):
        """
        Initialize FalkorDB client.

        Args:
            config: FalkorDB configuration (optional, uses defaults if not provided)
            graph_name: Override graph name (optional, useful for testing with separate graphs)
        """
        self.config = config or FalkorDBConfig()

        # Allow graph_name override (useful for test isolation)
        if graph_name:
            self.config.graph_name = graph_name

        self._db: Optional[FalkorDB] = None
        self._graph: Optional[Graph] = None
        self._connected = False

        log.info(
            f"FalkorDBClient initialized - "
            f"host={self.config.host}:{self.config.port}, "
            f"graph={self.config.graph_name}"
        )

    async def connect(self):
        """Establish connection to FalkorDB."""
        if self._connected:
            log.debug("Already connected to FalkorDB")
            return

        # Run in executor since falkordb-py is synchronous
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._connect_sync)

        log.info(f"Connected to FalkorDB at {self.config.host}:{self.config.port}")

    def _connect_sync(self):
        """Synchronous connection (called in executor)."""
        self._db = FalkorDB(
            host=self.config.host,
            port=self.config.port,
            password=self.config.password,
        )
        self._graph = self._db.select_graph(self.config.graph_name)
        self._connected = True

    async def close(self):
        """Close connection."""
        if not self._connected:
            return

        # FalkorDB connection is managed by redis connection pool
        # Just mark as disconnected
        self._connected = False
        self._db = None
        self._graph = None
        log.info("Disconnected from FalkorDB")

    async def query(
        self,
        cypher: str,
        params: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Execute Cypher query.

        Args:
            cypher: Cypher query string
            params: Query parameters

        Returns:
            List of result records as dicts

        Example:
            results = await client.query(
                "MATCH (n:Norma {URN: $urn}) RETURN n.estremi, n.testo_vigente",
                {"urn": "/eli/it/cc/1942/03/16/262/art1453/ita"}
            )
        """
        if not self._connected:
            raise RuntimeError("Not connected to FalkorDB. Call connect() first.")

        # Run query in executor (falkordb-py is synchronous)
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self._query_sync,
            cypher,
            params or {}
        )

    def _query_sync(self, cypher: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Execute query synchronously (called in executor)."""
        try:
            result = self._graph.query(cypher, params)

            # Convert result set to list of dicts
            records = []
            if result.result_set:
                # Get column names from header
                headers = result.header

                for row in result.result_set:
                    record = {}
                    for i, header in enumerate(headers):
                        # Extract column name (format is [[type, alias]])
                        col_name = header[1] if len(header) > 1 else f"col_{i}"
                        value = row[i]

                        # Handle FalkorDB Node/Edge objects
                        if hasattr(value, 'properties'):
                            if hasattr(value, 'relation'):
                                # Edge object: has .relation (str), .src_node, .dest_node
                                record[col_name] = {
                                    "properties": value.properties,
                                    "relation": value.relation,
                                    "id": getattr(value, 'id', None),
                                    "src_node": getattr(value, 'src_node', None),
                                    "dest_node": getattr(value, 'dest_node', None),
                                }
                            else:
                                # Node object: has .labels (list)
                                record[col_name] = {
                                    "properties": value.properties,
                                    "labels": getattr(value, 'labels', []),
                                    "id": getattr(value, 'id', None),
                                }
                        else:
                            # Scalar value
                            record[col_name] = value

                    records.append(record)

            log.debug(
                f"Query executed: {cypher[:100]}... "
                f"(params={list(params.keys())}) -> {len(records)} records"
            )
            return records

        except Exception as e:
            log.error(f"Query failed: {cypher[:100]}... Error: {e}")
            raise

    async def shortest_path(
        self,
        start_node: str,
        end_node: str,
        max_hops: int = 3
    ) -> Optional[List[Dict[str, Any]]]:
        """
        Find shortest path between two nodes.

        Args:
            start_node: Start node URN
            end_node: End node URN
            max_hops: Maximum path length

        Returns:
            Path as list of nodes/edges, or None if no path

        Example:
            path = await client.shortest_path(
                "/eli/it/cc/1942/03/16/262/art1453/ita",
                "/eli/it/cc/1942/03/16/262/art1454/ita",
                max_hops=3
            )
        """
        # FalkorDB has limitations with undirected shortestPath
        # Use a simpler approach: check direct connection or shared neighbors

        # Step 1: Check direct connection (1 hop)
        cypher_direct = """
            MATCH (start) WHERE start.URN = $start_urn OR start.nome = $start_urn
            MATCH (end) WHERE end.URN = $end_urn OR end.nome = $end_urn
            MATCH (start)-[r]->(end)
            RETURN type(r) as rel_type, 1 as distance
            LIMIT 1
        """

        try:
            results = await self.query(cypher_direct, {
                "start_urn": start_node,
                "end_urn": end_node
            })

            if results:
                return {
                    "path": {"edges": [results[0].get("rel_type")]},
                    "length": 1
                }

            # Step 2: Check reverse direct connection
            cypher_reverse = """
                MATCH (start) WHERE start.URN = $start_urn OR start.nome = $start_urn
                MATCH (end) WHERE end.URN = $end_urn OR end.nome = $end_urn
                MATCH (start)<-[r]-(end)
                RETURN type(r) as rel_type, 1 as distance
                LIMIT 1
            """

            results = await self.query(cypher_reverse, {
                "start_urn": start_node,
                "end_urn": end_node
            })

            if results:
                return {
                    "path": {"edges": [results[0].get("rel_type")]},
                    "length": 1
                }

            # Step 3: Check shared neighbor (2 hops)
            if max_hops >= 2:
                cypher_shared = """
                    MATCH (start) WHERE start.URN = $start_urn OR start.nome = $start_urn
                    MATCH (end) WHERE end.URN = $end_urn OR end.nome = $end_urn
                    MATCH (start)-[r1]->(shared)<-[r2]-(end)
                    RETURN type(r1) as r1_type, type(r2) as r2_type, 2 as distance
                    LIMIT 1
                """

                results = await self.query(cypher_shared, {
                    "start_urn": start_node,
                    "end_urn": end_node
                })

                if results:
                    return {
                        "path": {"edges": [results[0].get("r1_type"), results[0].get("r2_type")]},
                        "length": 2
                    }

            return None

        except Exception as e:
            # If nodes not found or no path exists, return None silently
            return None

    async def traverse(
        self,
        start_node: str,
        relation_weights: Dict[str, float],
        max_depth: int = 3,
        limit: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Weighted graph traversal for expert-specific retrieval.

        Args:
            start_node: Starting node URN
            relation_weights: Weight per relation type (from theta_traverse)
            max_depth: Maximum traversal depth
            limit: Maximum results

        Returns:
            List of reachable nodes with path scores

        Example:
            nodes = await client.traverse(
                "/eli/it/cc/1942/03/16/262/art1453/ita",
                {"interpreta": 0.8, "disciplina": 0.6, "contiene": 0.3},
                max_depth=2,
                limit=10
            )
        """
        # Build relation type filter for weighted traversal
        relation_types = "|".join(relation_weights.keys())

        cypher = f"""
            MATCH path = (start:Norma {{URN: $start_urn}})-[r:{relation_types}*1..{max_depth}]-(n)
            WITH n, r, length(path) AS depth
            RETURN DISTINCT n.URN AS urn, n.estremi AS estremi,
                   n.testo_vigente AS testo, depth
            ORDER BY depth ASC
            LIMIT {limit}
        """

        results = await self.query(cypher, {"start_urn": start_node})

        # v2 TODO: Apply relation_weights to compute actual path scores
        # For now, just return results with depth as score
        for result in results:
            result["score"] = 1.0 / (result.get("depth", 1) + 1)

        return results

    async def get_related_nodes_for_article(
        self,
        article_urn: str,
        max_results: int = 20
    ) -> List[Dict[str, Any]]:
        """
        Find all nodes related to an article (both incoming and outgoing).

        Useful for graph enrichment during retrieval:
        - Outgoing: ConcettoGiuridico, EffettoGiuridico disciplined by article
        - Incoming: AttoGiudiziario, Dottrina that interpret/comment the article

        Args:
            article_urn: Full article URN (e.g., "https://www.normattiva.it/...~art1453")
            max_results: Maximum nodes to return

        Returns:
            List of related nodes with relationship info

        Example:
            nodes = await client.get_related_nodes_for_article(
                "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art1453"
            )
        """
        # Extract numero_articolo from URN
        import re
        match = re.search(r'~art(\d+)', article_urn)
        if not match:
            log.warning(f"Could not extract article number from URN: {article_urn}")
            return []

        numero_articolo = match.group(1)

        # Query both outgoing and incoming relationships
        cypher = """
            MATCH (n:Norma {numero_articolo: $numero})
            OPTIONAL MATCH (n)-[r_out]->(m_out)
            WHERE m_out IS NOT NULL
            WITH n, collect(DISTINCT {
                direction: 'outgoing',
                rel_type: type(r_out),
                node_label: labels(m_out)[0],
                node_urn: m_out.URN,
                node_nome: m_out.nome,
                node_estremi: m_out.estremi
            }) AS outgoing
            OPTIONAL MATCH (m_in)-[r_in]->(n)
            WHERE m_in IS NOT NULL
            WITH n, outgoing, collect(DISTINCT {
                direction: 'incoming',
                rel_type: type(r_in),
                node_label: labels(m_in)[0],
                node_urn: m_in.URN,
                node_nome: m_in.nome,
                node_estremi: m_in.estremi
            }) AS incoming
            RETURN outgoing + incoming AS related_nodes
            LIMIT 1
        """

        try:
            results = await self.query(cypher, {"numero": numero_articolo})

            if not results or not results[0].get("related_nodes"):
                log.debug(f"No related nodes for art.{numero_articolo}")
                return []

            related = results[0]["related_nodes"]

            # Filter out null entries and limit
            valid_nodes = [
                node for node in related
                if node.get("rel_type") and node.get("node_label")
            ][:max_results]

            log.debug(f"Found {len(valid_nodes)} related nodes for art.{numero_articolo}")
            return valid_nodes

        except Exception as e:
            log.error(f"Error getting related nodes for {article_urn}: {e}")
            return []

    async def health_check(self) -> bool:
        """
        Check if FalkorDB is healthy and reachable.

        Returns:
            True if healthy, False otherwise
        """
        try:
            if not self._connected:
                await self.connect()

            # Simple query to test connection
            await self.query("RETURN 1")
            return True

        except Exception as e:
            log.error(f"Health check failed: {e}")
            return False
