"""
VisualexAPI Ingestion Pipeline
===============================

Ingest legal norms from VisualexAPI and populate:
1. FalkorDB: Legal knowledge graph (structured data)
2. Qdrant: Vector embeddings (text)
3. Bridge Table: Mapping between chunks and graph nodes

No LLM needed for graph construction - VisualexAPI provides structured data.

VisualexAPI Schema:
- act_type: tipo_atto (codice civile, legge, decreto, etc.)
- date: data dell'atto
- act_number: numero_atto
- article: numero_articolo
- brocardi_info: Ratio, Spiegazione, Massime

Graph Structure (conforme a docs/02-methodology/knowledge-graph.md):
- Norma (Codice) -[contiene]-> Norma (Articolo)
- Norma -[definisce]-> Definizione Legale
- Norma -[disciplina]-> Concetto Giuridico
- Atto Giudiziario -[interpreta]-> Norma
- Dottrina -[commenta]-> Norma
"""

import structlog
import asyncio
import re
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import aiohttp

log = structlog.get_logger()


@dataclass
class NormaMetadata:
    """Metadata for a legal norm from VisualexAPI."""
    tipo_atto: str
    data: str
    numero_atto: str
    numero_articolo: str
    versione: Optional[str] = None
    data_versione: Optional[str] = None
    allegato: Optional[str] = None

    def to_urn(self) -> str:
        """
        Generate URN Normattiva usando VisualexAPI urngenerator.

        Format: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:{tipo}:{data};{numero}~art{articolo}
        Example: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262~art1453

        Uses VisualexAPI urngenerator which:
        - Has hardcoded dates for major codes (CC, CP, etc.) - instant
        - Uses LRU cache for repeated queries - fast
        - Falls back to Selenium scraping only when needed - slow but accurate
        """
        from merlt.utils import urngenerator

        # For sync function in async context
        return urngenerator.generate_urn(
            act_type=self.tipo_atto,
            date=self.data,
            act_number=self.numero_atto,
            article=self.numero_articolo,
            version=self.versione,
            version_date=self.data_versione,
            urn_flag=True  # Include full URL
        )

    def to_codice_urn(self) -> str:
        """
        Generate URN for the codice (root norm) without article.

        Example: https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:codice.civile:1942-03-16;262
        """
        from merlt.utils import urngenerator

        return urngenerator.generate_urn(
            act_type=self.tipo_atto,
            date=self.data,
            act_number=self.numero_atto,
            article=None,  # No article for codice root
            version=self.versione,
            version_date=self.data_versione,
            urn_flag=True
        )

    def to_estremi(self) -> str:
        """
        Generate 'estremi' (official identifier) as per schema.

        Example: "Art. 1453 c.c."
        """
        tipo_abbrev = {
            "codice civile": "c.c.",
            "codice penale": "c.p.",
            "codice di procedura civile": "c.p.c.",
            "codice di procedura penale": "c.p.p.",
        }

        tipo_str = tipo_abbrev.get(self.tipo_atto.lower(), self.tipo_atto)
        return f"Art. {self.numero_articolo} {tipo_str}"


@dataclass
class VisualexArticle:
    """Complete article data from VisualexAPI."""
    metadata: NormaMetadata
    article_text: str
    url: str
    brocardi_info: Optional[Dict[str, Any]] = None


class VisualexClient:
    """
    Client for VisualexAPI.

    VisualexAPI provides structured legal data without requiring LLM extraction.
    """

    def __init__(self, base_url: str = "http://localhost:5100"):
        self.base_url = base_url.rstrip("/")
        self.session: Optional[aiohttp.ClientSession] = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()

    async def fetch_article(
        self,
        act_type: str,
        article: str,
        date: Optional[str] = None,
        act_number: Optional[str] = None,
        version: Optional[str] = None,
        version_date: Optional[str] = None,
    ) -> VisualexArticle:
        """
        Fetch article data from VisualexAPI.

        Args:
            act_type: Type of act (e.g., "codice civile", "legge")
            article: Article number
            date: Date of the act
            act_number: Number of the act
            version: Version of the act
            version_date: Date of the version

        Returns:
            VisualexArticle with text, metadata, and brocardi info
        """
        if not self.session:
            raise RuntimeError("Client not initialized. Use 'async with' context manager.")

        # Build request body for POST
        body = {
            "act_type": act_type,
            "article": article,
        }
        if date:
            body["date"] = date
        if act_number:
            body["act_number"] = act_number
        if version:
            body["version"] = version
        if version_date:
            body["version_date"] = version_date

        # Call API - POST /fetch_all_data
        url = f"{self.base_url}/fetch_all_data"
        async with self.session.post(url, json=body) as response:
            if response.status != 200:
                error_text = await response.text()
                raise ValueError(f"VisualexAPI error: {response.status} - {error_text}")

            data = await response.json()

        # Parse response - VisuaLex returns array of results
        if isinstance(data, list):
            if not data:
                raise ValueError("VisualexAPI returned empty results")
            data = data[0]  # Get first result

        if "error" in data:
            raise ValueError(f"VisualexAPI error: {data['error']}")

        # Parse norma_data
        norma_data = data["norma_data"]
        metadata = NormaMetadata(
            tipo_atto=norma_data["norma"]["tipo_atto"],
            data=norma_data["norma"]["data"],
            numero_atto=norma_data["norma"]["numero_atto"],
            numero_articolo=norma_data["numero_articolo"],
            versione=norma_data.get("versione"),
            data_versione=norma_data.get("data_versione"),
            allegato=norma_data.get("allegato"),
        )

        return VisualexArticle(
            metadata=metadata,
            article_text=data["article_text"],
            url=data["url"],
            brocardi_info=data.get("brocardi_info"),
        )


class VisualexIngestionPipeline:
    """
    Ingestion pipeline for VisualexAPI data.

    Flow:
    1. Fetch article from VisualexAPI
    2. Create graph nodes and relations in FalkorDB
    3. Create vector embeddings in Qdrant
    4. Create bridge table entries

    No LLM needed for graph construction!
    """

    def __init__(
        self,
        visualex_client: VisualexClient,
        falkordb_client=None,  # IGraphDB
        qdrant_client=None,    # IVectorDB
        bridge_table=None,     # IBridgeTable
        embedding_service=None,
    ):
        self.visualex = visualex_client
        self.falkordb = falkordb_client
        self.qdrant = qdrant_client
        self.bridge_table = bridge_table
        self.embedding_service = embedding_service

        log.info("VisualexIngestionPipeline initialized")

    async def ingest_article(self, article: VisualexArticle) -> Dict[str, Any]:
        """
        Ingest a single article into the knowledge base.

        Args:
            article: Article data from VisualexAPI

        Returns:
            Dict with ingestion results (nodes created, embeddings stored, etc.)
        """
        log.info(f"Ingesting article: {article.metadata.to_urn()}")

        results = {
            "urn": article.metadata.to_urn(),
            "nodes_created": [],
            "relations_created": [],
            "embeddings_stored": False,
            "bridge_entries": 0,
        }

        # Step 1: Create graph nodes and relations
        if self.falkordb:
            await self._create_graph_structure(article, results)

        # Step 2: Create vector embeddings
        if self.qdrant and self.embedding_service:
            await self._create_embeddings(article, results)

        # Step 3: Create bridge table entries
        if self.bridge_table:
            await self._create_bridge_entries(article, results)

        log.info(f"Ingestion complete: {results}")
        return results

    async def _create_graph_structure(
        self,
        article: VisualexArticle,
        results: Dict[str, Any]
    ) -> None:
        """
        Create graph nodes and relations conforme a knowledge-graph.md schema.

        Node types: Norma, Definizione Legale, Concetto Giuridico, Atto Giudiziario, Dottrina
        Relation types: contiene, definisce, disciplina, interpreta, commenta
        """
        meta = article.metadata
        urn = meta.to_urn()
        codice_urn = meta.to_codice_urn()
        estremi = meta.to_estremi()

        # Create Norma for Codice (root document) - Node Type A
        await self.falkordb.query(
            """
            MERGE (codice:Norma {URN: $codice_urn})
            ON CREATE SET
                codice.node_id = $codice_urn,
                codice.estremi = $codice_estremi,
                codice.titolo = $titolo,
                codice.tipo_documento = 'codice',
                codice.data_pubblicazione = $data,
                codice.stato = 'vigente',
                codice.efficacia = 'permanente',
                codice.ambito_territoriale = 'nazionale'
            """,
            {
                "codice_urn": codice_urn,
                "codice_estremi": meta.tipo_atto.title(),
                "titolo": meta.tipo_atto.title(),
                "data": meta.data,
            }
        )
        results["nodes_created"].append(f"Norma(codice):{codice_urn}")

        # Create Norma for Articolo (individual article) - Node Type A
        await self.falkordb.query(
            """
            MERGE (art:Norma {URN: $urn})
            ON CREATE SET
                art.node_id = $urn,
                art.estremi = $estremi,
                art.titolo = $estremi,
                art.tipo_documento = 'articolo',
                art.testo_vigente = $testo,
                art.testo_originale = $testo,
                art.data_pubblicazione = $data,
                art.versione = $versione,
                art.data_versione = $data_versione,
                art.stato = 'vigente',
                art.fonte = $url,
                art.ambito_territoriale = 'nazionale'
            """,
            {
                "urn": urn,
                "estremi": estremi,
                "testo": article.article_text,
                "data": meta.data,
                "versione": meta.versione or "originale",
                "data_versione": meta.data_versione or meta.data,
                "url": article.url,
            }
        )
        results["nodes_created"].append(f"Norma(articolo):{urn}")

        # Create 'contiene' relation (§3.2.1) - Structural relation
        await self.falkordb.query(
            """
            MATCH (codice:Norma {URN: $codice_urn})
            MATCH (art:Norma {URN: $art_urn})
            MERGE (codice)-[r:contiene]->(art)
            ON CREATE SET
                r.data_decorrenza = $data,
                r.certezza = 'esplicita',
                r.fonte_relazione = 'VisualexAPI'
            """,
            {
                "codice_urn": codice_urn,
                "art_urn": urn,
                "data": meta.data,
            }
        )
        results["relations_created"].append(f"contiene:{codice_urn}->{urn}")

        # Create Brocardi nodes if available
        if article.brocardi_info:
            await self._create_brocardi_nodes(article, urn, results)

    async def _create_brocardi_nodes(
        self,
        article: VisualexArticle,
        article_urn: str,
        results: Dict[str, Any]
    ) -> None:
        """
        Create nodes for Brocardi information conforme a knowledge-graph.md schema.

        Mapping:
        - Ratio → Concetto Giuridico (Node Type B) con relation 'disciplina' (§3.4.15)
        - Spiegazione → Dottrina (Node Type E) con relation 'commenta' (§3.6.26)
        - Massime → Atto Giudiziario (Node Type D) con relation 'interpreta' (§3.6.25)
        """
        brocardi = article.brocardi_info
        estremi = article.metadata.to_estremi()

        # Ratio → Concetto Giuridico
        if brocardi.get("Ratio"):
            # Extract concept name from article (e.g., "Risoluzione per inadempimento")
            concept_name = f"Ratio {estremi}"
            concept_id = f"concetto_{article_urn}"

            # Create Concetto Giuridico (Node Type B)
            await self.falkordb.query(
                """
                MERGE (c:ConcettoGiuridico {node_id: $concept_id})
                ON CREATE SET
                    c.nome = $nome,
                    c.definizione = $definizione,
                    c.ambito_di_applicazione = 'Diritto civile',
                    c.fonte = 'Brocardi.it'
                """,
                {
                    "concept_id": concept_id,
                    "nome": concept_name,
                    "definizione": brocardi["Ratio"],
                }
            )
            results["nodes_created"].append(f"ConcettoGiuridico:{concept_id}")

            # Create 'disciplina' relation (§3.4.15)
            await self.falkordb.query(
                """
                MATCH (art:Norma {URN: $art_urn})
                MATCH (c:ConcettoGiuridico {node_id: $concept_id})
                MERGE (art)-[r:disciplina]->(c)
                ON CREATE SET
                    r.certezza = 'inferita',
                    r.fonte_relazione = 'Brocardi.it'
                """,
                {"art_urn": article_urn, "concept_id": concept_id}
            )
            results["relations_created"].append(f"disciplina:{article_urn}->{concept_id}")

        # Spiegazione → Dottrina
        if brocardi.get("Spiegazione"):
            dottrina_id = f"dottrina_{article_urn}"

            # Create Dottrina (Node Type E)
            await self.falkordb.query(
                """
                MERGE (d:Dottrina {node_id: $dottrina_id})
                ON CREATE SET
                    d.titolo = $titolo,
                    d.autore = 'Brocardi.it',
                    d.descrizione = $descrizione,
                    d.data_pubblicazione = '2024-01-01',
                    d.fonte = 'Brocardi.it'
                """,
                {
                    "dottrina_id": dottrina_id,
                    "titolo": f"Commento a {estremi}",
                    "descrizione": brocardi["Spiegazione"],
                }
            )
            results["nodes_created"].append(f"Dottrina:{dottrina_id}")

            # Create 'commenta' relation (§3.6.26)
            await self.falkordb.query(
                """
                MATCH (d:Dottrina {node_id: $dottrina_id})
                MATCH (art:Norma {URN: $art_urn})
                MERGE (d)-[r:commenta]->(art)
                ON CREATE SET
                    r.certezza = 'esplicita',
                    r.fonte_relazione = 'Brocardi.it'
                """,
                {"dottrina_id": dottrina_id, "art_urn": article_urn}
            )
            results["relations_created"].append(f"commenta:{dottrina_id}->{article_urn}")

        # Massime → Atto Giudiziario
        if brocardi.get("Massime"):
            # v2 TODO: Parse multiple massime (can be a list of decisions)
            # For now, create a single Atto Giudiziario node

            atto_id = f"atto_giud_{article_urn}"
            massime_text = brocardi["Massime"]

            # Try to extract court info (e.g., "Cass. civ. n. 12345/2020")
            # Simplified for now
            organo_emittente = "Corte di Cassazione"
            estremi_atto = f"Massime su {estremi}"

            # Create Atto Giudiziario (Node Type D)
            await self.falkordb.query(
                """
                MERGE (a:AttoGiudiziario {node_id: $atto_id})
                ON CREATE SET
                    a.estremi = $estremi_atto,
                    a.descrizione = $descrizione,
                    a.organo_emittente = $organo_emittente,
                    a.tipologia = 'sentenza',
                    a.materia = 'Diritto civile',
                    a.fonte = 'Brocardi.it'
                """,
                {
                    "atto_id": atto_id,
                    "estremi_atto": estremi_atto,
                    "descrizione": massime_text,
                    "organo_emittente": organo_emittente,
                }
            )
            results["nodes_created"].append(f"AttoGiudiziario:{atto_id}")

            # Create 'interpreta' relation (§3.6.25)
            await self.falkordb.query(
                """
                MATCH (a:AttoGiudiziario {node_id: $atto_id})
                MATCH (art:Norma {URN: $art_urn})
                MERGE (a)-[r:interpreta]->(art)
                ON CREATE SET
                    r.tipo_interpretazione = 'giurisprudenziale',
                    r.certezza = 'esplicita',
                    r.fonte_relazione = 'Brocardi.it'
                """,
                {"atto_id": atto_id, "art_urn": article_urn}
            )
            results["relations_created"].append(f"interpreta:{atto_id}->{article_urn}")

    async def _create_embeddings(
        self,
        article: VisualexArticle,
        results: Dict[str, Any]
    ) -> None:
        """Create vector embeddings in Qdrant."""
        # v2 PLACEHOLDER: Implement embedding creation
        log.warning("Embedding creation not implemented yet")
        results["embeddings_stored"] = False

    async def _create_bridge_entries(
        self,
        article: VisualexArticle,
        results: Dict[str, Any]
    ) -> None:
        """Create bridge table entries linking chunks to graph nodes."""
        # v2 PLACEHOLDER: Implement bridge table entries
        log.warning("Bridge table creation not implemented yet")
        results["bridge_entries"] = 0


async def ingest_codice_civile_articles(
    article_numbers: List[str],
    visualex_url: str = "http://localhost:8080"
) -> List[Dict[str, Any]]:
    """
    Ingest multiple articles from Codice Civile.

    Example:
        results = await ingest_codice_civile_articles(
            article_numbers=["1453", "1454", "1455"]
        )
    """
    results = []

    async with VisualexClient(base_url=visualex_url) as client:
        pipeline = VisualexIngestionPipeline(
            visualex_client=client,
            # v2 TODO: Inject real clients
            falkordb_client=None,
            qdrant_client=None,
            bridge_table=None,
            embedding_service=None,
        )

        for article_num in article_numbers:
            try:
                # Fetch from VisualexAPI
                article = await client.fetch_article(
                    act_type="codice civile",
                    article=article_num
                )

                # Ingest into knowledge base
                result = await pipeline.ingest_article(article)
                results.append(result)

            except Exception as e:
                log.error(f"Failed to ingest article {article_num}: {e}")
                results.append({
                    "urn": f"art_{article_num}_cc",
                    "error": str(e)
                })

    return results
