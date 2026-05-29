"""
Ingestion Pipeline v2 - Comma-Level Chunking
=============================================

Extended pipeline that integrates:
- CommaParser: Parse article_text into structured components
- StructuralChunker: Create comma-level chunks with URN extensions
- Bridge Table: Prepare mappings for chunk → graph node linking

IMPORTANT: This module USES but does NOT modify:
- urngenerator.py (used by agent in real-time)
- visualex_client.py (used by agent in real-time)
- visualex_ingestion.py (existing pipeline still works)

Schema: docs/08-iteration/SCHEMA_DEFINITIVO_API_GRAFO.md

Usage:
    pipeline = IngestionPipelineV2(falkordb_client, bridge_table)
    results = await pipeline.ingest_article(visualex_article)
"""

import structlog
import re
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID

from merlt.pipeline.parsing import CommaParser, ArticleStructure, Comma, Lettera, parse_article
from merlt.pipeline.chunking import StructuralChunker, Chunk, chunk_article
from merlt.pipeline.visualex import VisualexArticle, NormaMetadata
from merlt.models import BridgeMapping

from merlt.clients import NormTree, get_article_position

log = structlog.get_logger()


def _canonical_urn(urn: str) -> str:
    """Strip URL wrapper + version marker so graph nodes match the seed format.

    VisuaLex's URNs come as
        "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:costituzione~art1!vig="
    while the Libro IV seed (and the BFF `normalizeGraphUrn` used at read time)
    expect the bare canonical NIR form:
        "urn:nir:stato:costituzione~art1"
    """
    if not urn:
        return urn
    start = urn.find("urn:nir:")
    stripped = urn[start:] if start > 0 else urn
    bang = stripped.find("!")
    return stripped[:bang] if bang != -1 else stripped


def _extract_number_from_urn(urn: str, level: str) -> Optional[int]:
    """
    Estrae il numero dal suffisso dell'URN per un dato livello gerarchico.

    Args:
        urn: URN completo (es. "https://...~libro2~tit1")
        level: Livello da estrarre ('libro', 'parte', 'titolo', 'capo', 'sezione')

    Returns:
        Il numero come intero, o None se non trovato.

    Note:
        Per 'parte', prova sia ~parte(N) che ~libro(N) perché alcuni atti
        (es. Costituzione) usano 'libro' nell'URN per strutture logicamente 'parte'.

    Examples:
        >>> _extract_number_from_urn("https://...~libro2~tit1", "libro")
        2
        >>> _extract_number_from_urn("https://...~libro2~tit1", "titolo")
        1
        >>> _extract_number_from_urn("https://...~parte1", "parte")
        1
        >>> _extract_number_from_urn("https://...costituzione~libro1", "parte")
        1  # Fallback: ~libro quando cercando ~parte
    """
    if not urn:
        return None

    # Mapping level -> pattern(s) suffix
    # Some levels have multiple patterns (e.g., 'parte' may use ~libro in URN)
    patterns = {
        'libro': [r'~libro(\d+)'],
        'parte': [r'~parte(\d+)', r'~libro(\d+)'],  # Fallback: Costituzione uses ~libro
        'titolo': [r'~tit(\d+)'],
        'capo': [r'~capo(\d+)'],
        'sezione': [r'~sez(\d+)'],
    }

    level_patterns = patterns.get(level)
    if not level_patterns:
        return None

    # Try each pattern in order, return first match
    for pattern in level_patterns:
        match = re.search(pattern, urn, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


@dataclass
class HierarchyURNs:
    """
    URNs for the hierarchical structure of a norm.

    Structure: Codice → Libro → Titolo → Capo → Sezione → Articolo

    Each level may be None if not present in the breadcrumb.
    """
    libro: Optional[str] = None
    titolo: Optional[str] = None
    capo: Optional[str] = None
    sezione: Optional[str] = None

    def closest_parent(self, codice_urn: str) -> str:
        """Return the closest available parent URN."""
        return self.sezione or self.capo or self.titolo or self.libro or codice_urn


@dataclass
class IngestionResult:
    """
    Result of ingesting a single article.

    Attributes:
        article_urn: URN of the ingested article
        article_url: External URL (for frontend linking)
        chunks: List of created chunks
        bridge_mappings: Prepared Bridge Table mappings
        nodes_created: List of graph nodes created
        relations_created: List of graph relations created
        brocardi_enriched: Whether Brocardi data was available
    """
    article_urn: str
    article_url: str
    chunks: List[Chunk]
    bridge_mappings: List[BridgeMapping]
    nodes_created: List[str]
    relations_created: List[str]
    brocardi_enriched: bool = False

    def summary(self) -> Dict[str, Any]:
        """Return summary for logging."""
        return {
            "article_urn": self.article_urn,
            "chunks": len(self.chunks),
            "bridge_mappings": len(self.bridge_mappings),
            "nodes": len(self.nodes_created),
            "relations": len(self.relations_created),
            "brocardi": self.brocardi_enriched,
        }


class IngestionPipelineV2:
    """
    Extended ingestion pipeline with comma-level chunking.

    This pipeline:
    1. Parses article_text into commas (CommaParser)
    2. Creates chunks per comma (StructuralChunker)
    3. Creates graph nodes with full schema properties
    4. Prepares Bridge Table mappings

    Does NOT handle:
    - Embedding generation (separate batch process)
    - Qdrant insertion (separate batch process)
    - Bridge Table insertion (caller's responsibility)

    Usage:
        pipeline = IngestionPipelineV2(falkordb_client)
        result = await pipeline.ingest_article(article)

        # Caller handles bridge insertions
        for mapping in result.bridge_mappings:
            await bridge_table.add_mapping(...)
    """

    def __init__(
        self,
        falkordb_client=None,
        comma_parser: Optional[CommaParser] = None,
        chunker: Optional[StructuralChunker] = None,
    ):
        """
        Initialize pipeline.

        Args:
            falkordb_client: FalkorDB client for graph operations
            comma_parser: Optional custom parser (default: CommaParser())
            chunker: Optional custom chunker (default: StructuralChunker())
        """
        self.falkordb = falkordb_client
        self.parser = comma_parser or CommaParser()
        self.chunker = chunker or StructuralChunker()

        log.info("IngestionPipelineV2 initialized")

    async def ingest_article(
        self,
        article: VisualexArticle,
        create_graph_nodes: bool = True,
        norm_tree: Optional[NormTree] = None,
    ) -> IngestionResult:
        """
        Ingest a single article with comma-level chunking.

        Args:
            article: VisualexArticle from API
            create_graph_nodes: Whether to create graph nodes (default True)
            norm_tree: Optional NormTree for hierarchy extraction when Brocardi not available

        Returns:
            IngestionResult with chunks, mappings, and graph info
        """
        # Normalizzazione: estrai brocardi_info dai metadati se non presenti a livello root
        if not article.brocardi_info and article.metadata and "brocardi_info" in article.metadata:
            article.brocardi_info = article.metadata["brocardi_info"]
            log.info("Injected brocardi_info from metadata")

        meta = article.metadata

        # Get URNs from existing urngenerator, then CANONICALIZE for the graph:
        # VisuaLex's `meta.to_urn()` returns the URL-wrapped form
        # ("https://www.normattiva.it/uri-res/N2Ls?urn:nir:…!vig="), but the
        # Libro IV seed (and the BFF `normalizeGraphUrn` used by check-article
        # / subgraph) index the bare canonical NIR form. Without this strip the
        # nodes are unreachable from the read path → 0-records → infinite
        # lazy-ingest loop. The full URL stays in `article.url` for display.
        article_urn = _canonical_urn(meta.to_urn())
        article_url = article.url
        codice_urn = _canonical_urn(meta.to_codice_urn())

        log.info(f"Ingesting article: {article_urn}")

        # Step 1: Parse article text into commas
        article_structure = self.parser.parse(article.article_text)

        # Step 2: Get position for hierarchy
        brocardi_position = None
        if article.brocardi_info and isinstance(article.brocardi_info, dict):
            brocardi_position = article.brocardi_info.get("Position") or article.brocardi_info.get("position")

        # Fallback to treextractor if Brocardi not available
        if not brocardi_position and norm_tree:
            brocardi_position = get_article_position(norm_tree, meta.numero_articolo)

        # Step 3: Create chunks (one per comma)
        chunks = self.chunker.chunk_article(
            article_structure=article_structure,
            article_urn=article_urn,
            article_url=article_url,
            brocardi_position=brocardi_position,
        )

        # Step 4: Prepare bridge mappings
        bridge_mappings = self._prepare_bridge_mappings(
            chunks=chunks,
            article_urn=article_urn,
            codice_urn=codice_urn,
            brocardi_position=brocardi_position,
        )

        # Initialize result
        result = IngestionResult(
            article_urn=article_urn,
            article_url=article_url,
            chunks=chunks,
            bridge_mappings=bridge_mappings,
            nodes_created=[],
            relations_created=[],
            brocardi_enriched=bool(article.brocardi_info),
        )

        # Step 5: Create graph nodes
        if create_graph_nodes and self.falkordb:
            await self._create_graph_structure(
                article=article,
                article_structure=article_structure,
                result=result,
            )

        log.info(f"Ingestion complete: {result.summary()}")
        return result

    def _prepare_bridge_mappings(
        self,
        chunks: List[Chunk],
        article_urn: str,
        codice_urn: str,
        brocardi_position: Optional[str],
    ) -> List[BridgeMapping]:
        """
        Prepare Bridge Table mappings for all chunks.

        Mapping types:
        - PRIMARY: chunk → parent article (confidence 1.0)
        - HIERARCHIC: chunk → libro/titolo (confidence 0.95)
        - CONCEPT: chunk → extracted concepts (confidence varies)
        - REFERENCE: chunk → referenced articles (confidence 0.75)
        """
        mappings = []

        # Extract hierarchy URNs from position if available
        hierarchy = self._extract_hierarchy_urns(codice_urn, brocardi_position)

        for chunk in chunks:
            # PRIMARY: chunk → article (always 1.0)
            mappings.append(BridgeMapping(
                chunk_id=chunk.chunk_id,
                graph_node_urn=article_urn,
                mapping_type="PRIMARY",
                confidence=1.0,
                chunk_text=chunk.text[:2000] if chunk.text else None,  # Primi 2000 char
                metadata={"comma_numero": chunk.metadata.comma_numero},
            ))

            # HIERARCHIC mappings for each level (if available)
            # Confidence decreases with distance from article
            hierarchy_levels = [
                (hierarchy.libro, 0.90),
                (hierarchy.titolo, 0.92),
                (hierarchy.capo, 0.94),
                (hierarchy.sezione, 0.96),
            ]
            for urn, confidence in hierarchy_levels:
                if urn:
                    mappings.append(BridgeMapping(
                        chunk_id=chunk.chunk_id,
                        graph_node_urn=urn,
                        mapping_type="HIERARCHIC",
                        confidence=confidence,
                        chunk_text=chunk.text[:2000] if chunk.text else None,
                    ))

        return mappings

    def _extract_hierarchy_urns(
        self,
        codice_urn: str,
        brocardi_position: Optional[str],
    ) -> HierarchyURNs:
        """
        Extract libro, titolo, capo, sezione URNs from Brocardi position.

        Uses StructuralChunker._parse_position() for consistent parsing.

        Example:
            Position: "Libro IV - Delle obbligazioni, Titolo II - ..., Capo XIV - ..., Sezione I - ..."
            codice_urn: "https://...;262:2"

            Returns HierarchyURNs with:
                libro: "https://...;262:2~libro4"
                titolo: "https://...;262:2~libro4~tit2"
                capo: "https://...;262:2~libro4~tit2~capo14"
                sezione: "https://...;262:2~libro4~tit2~capo14~sez1"
        """
        result = HierarchyURNs()

        if not brocardi_position:
            return result

        # Use chunker's parser for consistent extraction
        libro_roman, titolo_roman, capo_roman, sezione_roman = self.chunker._parse_position(brocardi_position)

        # Build URNs hierarchically
        if libro_roman:
            libro_num = self._roman_to_arabic(libro_roman)
            result.libro = f"{codice_urn}~libro{libro_num}"

            if titolo_roman:
                titolo_num = self._roman_to_arabic(titolo_roman)
                result.titolo = f"{result.libro}~tit{titolo_num}"

                if capo_roman:
                    capo_num = self._roman_to_arabic(capo_roman)
                    result.capo = f"{result.titolo}~capo{capo_num}"

                    if sezione_roman:
                        sezione_num = self._roman_to_arabic(sezione_roman)
                        result.sezione = f"{result.capo}~sez{sezione_num}"

        return result

    def _roman_to_arabic(self, roman: str) -> int:
        """
        Convert Roman numeral or Italian ordinal word to Arabic number.

        Supporta:
        - Numeri romani: I, II, III, IV, V, ..., XIV, ...
        - Parole ordinali: primo, secondo, terzo, ... cinquantesimo (usate dal Codice Penale)

        Usa il modulo merlt.sources.utils.ordinals per la mappatura completa.
        """
        from merlt.utils.ordinals import to_arabic
        result = to_arabic(roman)
        return result if result is not None else 0

    async def _create_graph_structure(
        self,
        article: VisualexArticle,
        article_structure: ArticleStructure,
        result: IngestionResult,
    ) -> None:
        """
        Create graph nodes and relations per schema definitivo.

        Schema: docs/08-iteration/SCHEMA_DEFINITIVO_API_GRAFO.md
        """
        meta = article.metadata
        article_urn = result.article_urn
        codice_urn = meta.to_codice_urn()

        # Timestamp for all graph operations (FalkorDB doesn't have datetime())
        self._timestamp = datetime.now(timezone.utc).isoformat()

        # Create Norma (codice) - root document
        await self._create_norma_codice(meta, codice_urn, result)

        # Create hierarchy nodes (libro, titolo) if Brocardi available
        if article.brocardi_info and isinstance(article.brocardi_info, dict):
            await self._create_hierarchy_nodes(
                codice_urn=codice_urn,
                brocardi_position=article.brocardi_info.get("Position"),
                result=result,
            )

        # Create Norma (articolo) with full properties
        await self._create_norma_articolo(
            article=article,
            article_structure=article_structure,
            result=result,
        )

        # Create Comma and Lettera nodes
        await self._create_comma_nodes(
            article_structure=article_structure,
            article_urn=result.article_urn,
            result=result,
        )

        # Create Brocardi enrichment nodes
        if article.brocardi_info and isinstance(article.brocardi_info, dict):
            await self._create_brocardi_enrichment(
                article=article,
                article_urn=article_urn,
                result=result,
            )

    async def _create_norma_codice(
        self,
        meta: NormaMetadata,
        codice_urn: str,
        result: IngestionResult,
    ) -> None:
        """Create Norma node for codice (root document)."""
        await self.falkordb.query(
            """
            MERGE (codice:Norma {URN: $urn})
            ON CREATE SET
                codice.node_id = $urn,
                codice.url = $url,
                codice.tipo_documento = 'codice',
                codice.titolo = $titolo,
                codice.autorita_emanante = $autorita,
                codice.data_pubblicazione = $data,
                codice.vigenza = 'vigente',
                codice.efficacia = 'permanente',
                codice.ambito_territoriale = 'nazionale',
                codice.fonte = 'VisualexAPI',
                codice.created_at = $timestamp
            """,
            {
                "urn": codice_urn,
                "url": codice_urn,  # Codice URL = URN
                "titolo": meta.tipo_atto.title(),
                "autorita": "Regio Decreto" if "regio" in codice_urn.lower() else "Parlamento",
                "data": meta.data,
                "timestamp": self._timestamp,
            }
        )
        result.nodes_created.append(f"Norma(codice):{codice_urn}")

    async def _create_hierarchy_nodes(
        self,
        codice_urn: str,
        brocardi_position: Optional[str],
        result: IngestionResult,
    ) -> None:
        """
        Create Norma nodes for libro/parte, titolo, capo, sezione.

        Hierarchy:
        - Codici: Codice → Libro → Titolo → Capo → Sezione → Articolo
        - Costituzione: Costituzione → Parte → Titolo → Articolo
        """
        if not brocardi_position:
            return

        hierarchy = self._extract_hierarchy_urns(codice_urn, brocardi_position)

        # Extract titles from position - cerca sia 'libro' che 'parte'
        titles = {
            level: self._extract_hierarchy_title(brocardi_position, level)
            for level in ('libro', 'parte', 'titolo', 'capo', 'sezione')
        }
        # Usa 'libro' se presente, altrimenti 'parte' (Costituzione)
        libro_title = titles['libro'] or titles['parte']

        # Create Libro/Parte node
        # Determina se e' un Libro (Codici) o Parte (Costituzione)
        is_parte = 'parte' in brocardi_position.lower() and 'libro' not in brocardi_position.lower()
        tipo_doc = 'parte' if is_parte else 'libro'

        if hierarchy.libro:
            libro_numero = _extract_number_from_urn(hierarchy.libro, tipo_doc)  # 'libro' o 'parte'
            # Usa numero_libro o numero_parte in base al tipo
            numero_field = "numero_parte" if tipo_doc == "parte" else "numero_libro"
            await self.falkordb.query(
                f"""
                MERGE (libro:Norma {{URN: $urn}})
                ON CREATE SET
                    libro.node_id = $urn,
                    libro.tipo_documento = $tipo_doc,
                    libro.{numero_field} = $numero,
                    libro.titolo = $titolo,
                    libro.rubrica = $titolo,
                    libro.vigenza = 'vigente',
                    libro.fonte = 'Brocardi',
                    libro.created_at = $timestamp,
                    libro.updated_at = $timestamp
                """,
                {"urn": hierarchy.libro, "tipo_doc": tipo_doc, "numero": libro_numero, "titolo": libro_title or "", "timestamp": self._timestamp}
            )
            result.nodes_created.append(f"Norma({tipo_doc}):{hierarchy.libro}")

            # Relation: codice -[contiene]-> libro
            await self.falkordb.query(
                """
                MATCH (codice:Norma {URN: $codice_urn})
                MATCH (libro:Norma {URN: $libro_urn})
                MERGE (codice)-[r:contiene]->(libro)
                ON CREATE SET r.certezza = 1.0, r.tipo = 'esplicita'
                """,
                {"codice_urn": codice_urn, "libro_urn": hierarchy.libro}
            )
            result.relations_created.append(f"contiene:{codice_urn}->{hierarchy.libro}")

        # Create Titolo node
        if hierarchy.titolo and hierarchy.libro:
            titolo_numero = _extract_number_from_urn(hierarchy.titolo, 'titolo')
            await self.falkordb.query(
                """
                MERGE (titolo:Norma {URN: $urn})
                ON CREATE SET
                    titolo.node_id = $urn,
                    titolo.tipo_documento = 'titolo',
                    titolo.numero_titolo = $numero,
                    titolo.titolo = $titolo,
                    titolo.rubrica = $titolo,
                    titolo.vigenza = 'vigente',
                    titolo.fonte = 'Brocardi',
                    titolo.created_at = $timestamp,
                    titolo.updated_at = $timestamp
                """,
                {"urn": hierarchy.titolo, "numero": titolo_numero, "titolo": titles['titolo'] or "", "timestamp": self._timestamp}
            )
            result.nodes_created.append(f"Norma(titolo):{hierarchy.titolo}")

            # Relation: libro -[contiene]-> titolo
            await self.falkordb.query(
                """
                MATCH (libro:Norma {URN: $libro_urn})
                MATCH (titolo:Norma {URN: $titolo_urn})
                MERGE (libro)-[r:contiene]->(titolo)
                ON CREATE SET r.certezza = 1.0, r.tipo = 'esplicita'
                """,
                {"libro_urn": hierarchy.libro, "titolo_urn": hierarchy.titolo}
            )
            result.relations_created.append(f"contiene:{hierarchy.libro}->{hierarchy.titolo}")

        # Create Capo node
        if hierarchy.capo and hierarchy.titolo:
            capo_numero = _extract_number_from_urn(hierarchy.capo, 'capo')
            await self.falkordb.query(
                """
                MERGE (capo:Norma {URN: $urn})
                ON CREATE SET
                    capo.node_id = $urn,
                    capo.tipo_documento = 'capo',
                    capo.numero_capo = $numero,
                    capo.titolo = $titolo,
                    capo.rubrica = $titolo,
                    capo.vigenza = 'vigente',
                    capo.fonte = 'Brocardi',
                    capo.created_at = $timestamp,
                    capo.updated_at = $timestamp
                """,
                {"urn": hierarchy.capo, "numero": capo_numero, "titolo": titles['capo'] or "", "timestamp": self._timestamp}
            )
            result.nodes_created.append(f"Norma(capo):{hierarchy.capo}")

            # Relation: titolo -[contiene]-> capo
            await self.falkordb.query(
                """
                MATCH (titolo:Norma {URN: $titolo_urn})
                MATCH (capo:Norma {URN: $capo_urn})
                MERGE (titolo)-[r:contiene]->(capo)
                ON CREATE SET r.certezza = 1.0, r.tipo = 'esplicita'
                """,
                {"titolo_urn": hierarchy.titolo, "capo_urn": hierarchy.capo}
            )
            result.relations_created.append(f"contiene:{hierarchy.titolo}->{hierarchy.capo}")

        # Create Sezione node
        if hierarchy.sezione and hierarchy.capo:
            sezione_numero = _extract_number_from_urn(hierarchy.sezione, 'sezione')
            await self.falkordb.query(
                """
                MERGE (sezione:Norma {URN: $urn})
                ON CREATE SET
                    sezione.node_id = $urn,
                    sezione.tipo_documento = 'sezione',
                    sezione.numero_sezione = $numero,
                    sezione.titolo = $titolo,
                    sezione.rubrica = $titolo,
                    sezione.vigenza = 'vigente',
                    sezione.fonte = 'Brocardi',
                    sezione.created_at = $timestamp,
                    sezione.updated_at = $timestamp
                """,
                {"urn": hierarchy.sezione, "numero": sezione_numero, "titolo": titles['sezione'] or "", "timestamp": self._timestamp}
            )
            result.nodes_created.append(f"Norma(sezione):{hierarchy.sezione}")

            # Relation: capo -[contiene]-> sezione
            await self.falkordb.query(
                """
                MATCH (capo:Norma {URN: $capo_urn})
                MATCH (sezione:Norma {URN: $sezione_urn})
                MERGE (capo)-[r:contiene]->(sezione)
                ON CREATE SET r.certezza = 1.0, r.tipo = 'esplicita'
                """,
                {"capo_urn": hierarchy.capo, "sezione_urn": hierarchy.sezione}
            )
            result.relations_created.append(f"contiene:{hierarchy.capo}->{hierarchy.sezione}")

    def _extract_hierarchy_title(self, position: str, level: str) -> Optional[str]:
        """
        Extract title for a hierarchy level from Brocardi position.

        Supporta sia Codici (Libro) che Costituzione (Parte).

        Args:
            position: Brocardi position string
            level: One of 'libro', 'parte', 'titolo', 'capo', 'sezione'

        Returns:
            The title text after the Roman numeral, or None if not found.

        Example:
            position = "Libro IV - Delle obbligazioni, Titolo II - Dei contratti"
            _extract_hierarchy_title(position, 'libro') -> "Delle obbligazioni"

            position = "Parte II - Ordinamento della repubblica, Titolo V - Le regioni"
            _extract_hierarchy_title(position, 'parte') -> "Ordinamento della repubblica"
        """
        # Match pattern: "Libro IV - Delle obbligazioni" captures "Delle obbligazioni"
        # Or "Parte II - Ordinamento..." captures "Ordinamento..."
        # Or "Libro primo - Dei reati..." captures "Dei reati..." (CP usa parole)
        from merlt.utils.ordinals import ROMAN_OR_ORDINAL_PATTERN
        pattern = rf'{level}\s+{ROMAN_OR_ORDINAL_PATTERN}\s*[-–]\s*([^,>]+)'
        match = re.search(pattern, position, re.IGNORECASE)
        return match.group(1).strip() if match else None

    async def _create_norma_articolo(
        self,
        article: VisualexArticle,
        article_structure: ArticleStructure,
        result: IngestionResult,
    ) -> None:
        """Create Norma node for articolo with full 21 properties."""
        meta = article.metadata

        # Estrai metadati ricchi se presenti.
        # `article.metadata` può essere il NormaMetadata dataclass (caso comune
        # via VisuaLex) o un dict legacy con chiave nested 'norma_metadata'.
        # Il dataclass NON ha .get() → trattalo come fonte vuota; i campi `meta.*`
        # dataclass coprono comunque autorità/data/titolo nei fallback sotto.
        norma_meta = article.metadata if isinstance(article.metadata, dict) else {}
        autorita = norma_meta.get("autorita") or ("Regio Decreto" if "regio" in result.article_urn.lower() else "Parlamento")
        data_pubb = norma_meta.get("data") or meta.data
        titolo_atto = norma_meta.get("titolo") or meta.to_estremi()

        await self.falkordb.query(
            """
            MERGE (art:Norma {URN: $urn})
            ON CREATE SET
                art.node_id = $urn,
                art.url = $url,
                art.tipo_documento = 'articolo',
                art.estremi = $estremi,
                art.numero_articolo = $numero_articolo,
                art.rubrica = $rubrica,
                art.testo_vigente = $testo,
                art.titolo = $titolo_atto,
                art.fonte = 'VisualexAPI',
                art.autorita_emanante = $autorita,
                art.data_pubblicazione = $data,
                art.vigenza = 'vigente',
                art.stato = 'vigente',
                art.efficacia = 'permanente',
                art.ambito_territoriale = 'nazionale',
                art.created_at = $timestamp,
                art.updated_at = $timestamp
            ON MATCH SET
                art.node_id = $urn,
                art.url = $url,
                art.tipo_documento = 'articolo',
                art.estremi = $estremi,
                art.numero_articolo = $numero_articolo,
                art.rubrica = $rubrica,
                art.testo_vigente = $testo,
                art.titolo = $titolo_atto,
                art.fonte = 'VisualexAPI',
                art.autorita_emanante = $autorita,
                art.data_pubblicazione = $data,
                art.vigenza = 'vigente',
                art.stato = 'vigente',
                art.efficacia = 'permanente',
                art.ambito_territoriale = 'nazionale',
                art.is_stub = null,
                art.stub_source = null,
                art.updated_at = $timestamp
            """,
            {
                "urn": result.article_urn,
                "url": result.article_url,
                "estremi": meta.to_estremi(),
                "numero_articolo": article_structure.numero_articolo,
                "rubrica": article_structure.rubrica or "",
                "testo": article.article_text,
                "titolo_atto": titolo_atto,
                "autorita": autorita,
                "data": data_pubb,
                "timestamp": self._timestamp,
            }
        )
        result.nodes_created.append(f"Norma(articolo):{result.article_urn}")

        # Relation: closest_parent -[contiene]-> articolo
        # Find closest parent (sezione > capo > titolo > libro > codice)
        codice_urn = meta.to_codice_urn()
        brocardi_pos = None
        if article.brocardi_info and isinstance(article.brocardi_info, dict):
            brocardi_pos = article.brocardi_info.get("Position")
        hierarchy = self._extract_hierarchy_urns(codice_urn, brocardi_pos)

        parent_urn = hierarchy.closest_parent(codice_urn)
        await self.falkordb.query(
            """
            MATCH (parent:Norma {URN: $parent_urn})
            MATCH (art:Norma {URN: $art_urn})
            MERGE (parent)-[r:contiene]->(art)
            ON CREATE SET r.certezza = 1.0, r.tipo = 'esplicita'
            """,
            {"parent_urn": parent_urn, "art_urn": result.article_urn}
        )
        result.relations_created.append(f"contiene:{parent_urn}->{result.article_urn}")

    async def _create_comma_nodes(
        self,
        article_structure: ArticleStructure,
        article_urn: str,
        result: IngestionResult,
    ) -> None:
        """
        Create Comma and Lettera nodes for an article.

        Graph structure:
            (Articolo)-[:contiene]->(Comma)-[:contiene]->(Lettera)

        URN format (NIR-like):
            Comma:   {article_urn}-com{N}
            Lettera: {article_urn}-com{N}-let{X}

        Example:
            urn:nir:stato:costituzione:1947-12-27~art117-com2
            urn:nir:stato:costituzione:1947-12-27~art117-com2-leta
        """
        for comma in article_structure.commas:
            comma_urn = f"{article_urn}-com{comma.numero}"

            # Create Comma node
            await self.falkordb.query(
                """
                MERGE (c:Comma {URN: $urn})
                ON CREATE SET
                    c.node_id = $urn,
                    c.numero = $numero,
                    c.testo = $testo,
                    c.token_count = $tokens,
                    c.created_at = $timestamp
                """,
                {
                    "urn": comma_urn,
                    "numero": comma.numero,
                    "testo": comma.testo,
                    "tokens": comma.token_count,
                    "timestamp": self._timestamp,
                }
            )
            result.nodes_created.append(f"Comma:{comma_urn}")

            # Relation: Articolo -[contiene]-> Comma
            await self.falkordb.query(
                """
                MATCH (art:Norma {URN: $art_urn})
                MATCH (c:Comma {URN: $comma_urn})
                MERGE (art)-[r:contiene]->(c)
                ON CREATE SET r.certezza = 1.0, r.tipo = 'esplicita'
                """,
                {"art_urn": article_urn, "comma_urn": comma_urn}
            )
            result.relations_created.append(f"contiene:{article_urn}->{comma_urn}")

            # Create Lettera nodes (if present)
            for lettera in comma.lettere:
                lettera_urn = f"{comma_urn}-let{lettera.lettera}"

                await self.falkordb.query(
                    """
                    MERGE (l:Lettera {URN: $urn})
                    ON CREATE SET
                        l.node_id = $urn,
                        l.lettera = $lettera,
                        l.testo = $testo,
                        l.token_count = $tokens,
                        l.created_at = $timestamp
                    """,
                    {
                        "urn": lettera_urn,
                        "lettera": lettera.lettera,
                        "testo": lettera.testo,
                        "tokens": lettera.token_count,
                        "timestamp": self._timestamp,
                    }
                )
                result.nodes_created.append(f"Lettera:{lettera_urn}")

                # Relation: Comma -[contiene]-> Lettera
                await self.falkordb.query(
                    """
                    MATCH (c:Comma {URN: $comma_urn})
                    MATCH (l:Lettera {URN: $lettera_urn})
                    MERGE (c)-[r:contiene]->(l)
                    ON CREATE SET r.certezza = 1.0, r.tipo = 'esplicita'
                    """,
                    {"comma_urn": comma_urn, "lettera_urn": lettera_urn}
                )
                result.relations_created.append(f"contiene:{comma_urn}->{lettera_urn}")

        log.info(
            f"Created {len(article_structure.commas)} comma nodes with "
            f"{sum(len(c.lettere) for c in article_structure.commas)} lettere"
        )

    async def _create_brocardi_enrichment(
        self,
        article: VisualexArticle,
        article_urn: str,
        result: IngestionResult,
    ) -> None:
        """Create Dottrina and AttoGiudiziario nodes from Brocardi."""
        brocardi = article.brocardi_info
        estremi = article.metadata.to_estremi()

        # Ratio → Dottrina (tipo: ratio)
        if brocardi.get("Ratio"):
            dottrina_id = f"dottrina_brocardi_{article_urn.split('~')[-1]}_ratio"
            await self.falkordb.query(
                """
                MERGE (d:Dottrina {node_id: $id})
                ON CREATE SET
                    d.titolo = $titolo,
                    d.descrizione = $descrizione,
                    d.tipo_dottrina = 'ratio',
                    d.fonte = 'Brocardi.it',
                    d.autore = 'Brocardi.it',
                    d.confidence = 0.9,
                    d.created_at = $timestamp
                """,
                {
                    "id": dottrina_id,
                    "titolo": f"Ratio {estremi}",
                    "descrizione": brocardi["Ratio"],
                    "timestamp": self._timestamp,
                }
            )
            result.nodes_created.append(f"Dottrina:{dottrina_id}")

            # Relation: Dottrina -[commenta]-> Norma
            await self.falkordb.query(
                """
                MATCH (d:Dottrina {node_id: $d_id})
                MATCH (art:Norma {URN: $art_urn})
                MERGE (d)-[r:commenta]->(art)
                ON CREATE SET r.certezza = 0.9, r.tipo = 'esplicita', r.fonte = 'Brocardi.it'
                """,
                {"d_id": dottrina_id, "art_urn": article_urn}
            )
            result.relations_created.append(f"commenta:{dottrina_id}->{article_urn}")

        # Spiegazione → Dottrina (tipo: spiegazione)
        if brocardi.get("Spiegazione"):
            dottrina_id = f"dottrina_brocardi_{article_urn.split('~')[-1]}_spiegazione"
            await self.falkordb.query(
                """
                MERGE (d:Dottrina {node_id: $id})
                ON CREATE SET
                    d.titolo = $titolo,
                    d.descrizione = $descrizione,
                    d.tipo_dottrina = 'spiegazione',
                    d.fonte = 'Brocardi.it',
                    d.autore = 'Brocardi.it',
                    d.confidence = 0.9,
                    d.created_at = $timestamp
                """,
                {
                    "id": dottrina_id,
                    "titolo": f"Spiegazione {estremi}",
                    "descrizione": brocardi["Spiegazione"],
                    "timestamp": self._timestamp,
                }
            )
            result.nodes_created.append(f"Dottrina:{dottrina_id}")

            await self.falkordb.query(
                """
                MATCH (d:Dottrina {node_id: $d_id})
                MATCH (art:Norma {URN: $art_urn})
                MERGE (d)-[r:commenta]->(art)
                ON CREATE SET r.certezza = 0.9, r.tipo = 'esplicita', r.fonte = 'Brocardi.it'
                """,
                {"d_id": dottrina_id, "art_urn": article_urn}
            )
            result.relations_created.append(f"commenta:{dottrina_id}->{article_urn}")

        # Relazioni di accompagnamento → Dottrina (tipo: relazione_accompagnamento)
        # Gestisce: RelazioneCostituzione (Ruini 1947), Relazioni Guardasigilli (CC 1942), etc.
        await self._create_relazioni_accompagnamento(brocardi, article_urn, estremi, result)

        # Massime → AttoGiudiziario (multiple)
        massime = brocardi.get("Massime", [])
        if isinstance(massime, list):
            for i, massima in enumerate(massime):
                # Handle various formats from BrocardiScraper
                if isinstance(massima, str):
                    # Old format: plain string
                    massima = {"estratto": massima, "corte": "Cassazione", "numero": f"unknown_{i}"}
                elif isinstance(massima, dict):
                    # New format from _parse_massima: {autorita, numero, anno, massima}
                    if "massima" in massima and "estratto" not in massima:
                        massima = self._normalize_massima(massima, i)
                else:
                    continue  # Skip invalid entries
                await self._create_atto_giudiziario(
                    massima=massima,
                    article_urn=article_urn,
                    index=i,
                    result=result,
                )

    async def _create_relazioni_accompagnamento(
        self,
        brocardi: Dict[str, Any],
        article_urn: str,
        estremi: str,
        result: IngestionResult,
    ) -> None:
        """
        Crea nodi Dottrina per le Relazioni di accompagnamento storiche.

        Gestisce:
        - RelazioneCostituzione: Relazione al Progetto della Costituzione (Ruini, 1947)
        - Relazioni: Relazione del Guardasigilli al Codice Civile (1942) e simili
        """
        # 1. Relazione al Progetto della Costituzione (direttamente nell'HTML)
        if brocardi.get("RelazioneCostituzione"):
            rel = brocardi["RelazioneCostituzione"]
            dottrina_id = f"dottrina_relazione_{article_urn.split('~')[-1]}_costituzione"
            await self.falkordb.query(
                """
                MERGE (d:Dottrina {node_id: $id})
                ON CREATE SET
                    d.titolo = $titolo,
                    d.descrizione = $descrizione,
                    d.tipo_dottrina = 'relazione_accompagnamento',
                    d.sottotipo = 'relazione_costituzione',
                    d.fonte = 'Brocardi.it',
                    d.autore = $autore,
                    d.anno = $anno,
                    d.confidence = 0.95,
                    d.created_at = $timestamp
                """,
                {
                    "id": dottrina_id,
                    "titolo": rel.get("titolo", "Relazione al Progetto della Costituzione"),
                    "descrizione": rel.get("testo", ""),
                    "autore": rel.get("autore", "Meuccio Ruini"),
                    "anno": rel.get("anno", 1947),
                    "timestamp": self._timestamp,
                }
            )
            result.nodes_created.append(f"Dottrina:{dottrina_id}")
            log.info(f"Created Dottrina RelazioneCostituzione for {estremi}")

            await self.falkordb.query(
                """
                MATCH (d:Dottrina {node_id: $d_id})
                MATCH (art:Norma {URN: $art_urn})
                MERGE (d)-[r:commenta]->(art)
                ON CREATE SET r.certezza = 0.95, r.tipo = 'storica', r.fonte = 'Brocardi.it'
                """,
                {"d_id": dottrina_id, "art_urn": article_urn}
            )
            result.relations_created.append(f"commenta:{dottrina_id}->{article_urn}")

        # 2. Relazioni Guardasigilli e simili (caricate via AJAX per Codici)
        relazioni = brocardi.get("Relazioni", [])
        if isinstance(relazioni, list):
            for i, rel in enumerate(relazioni):
                if not isinstance(rel, dict) or not rel.get("testo"):
                    continue

                dottrina_id = f"dottrina_relazione_{article_urn.split('~')[-1]}_{i}"
                titolo = rel.get("titolo", "Relazione di accompagnamento")

                # Determina sottotipo dal titolo
                sottotipo = "relazione_generica"
                if "Guardasigilli" in titolo or "Codice Civile" in titolo:
                    sottotipo = "relazione_guardasigilli"
                elif "Costituzione" in titolo:
                    sottotipo = "relazione_costituzione"

                await self.falkordb.query(
                    """
                    MERGE (d:Dottrina {node_id: $id})
                    ON CREATE SET
                        d.titolo = $titolo,
                        d.descrizione = $descrizione,
                        d.tipo_dottrina = 'relazione_accompagnamento',
                        d.sottotipo = $sottotipo,
                        d.fonte = 'Brocardi.it',
                        d.autore = $autore,
                        d.anno = $anno,
                        d.confidence = 0.9,
                        d.created_at = $timestamp
                    """,
                    {
                        "id": dottrina_id,
                        "titolo": titolo,
                        "descrizione": rel.get("testo", ""),
                        "sottotipo": sottotipo,
                        "autore": rel.get("autore", ""),
                        "anno": rel.get("anno"),
                        "timestamp": self._timestamp,
                    }
                )
                result.nodes_created.append(f"Dottrina:{dottrina_id}")
                log.info(f"Created Dottrina Relazione for {estremi}: {titolo}")

                await self.falkordb.query(
                    """
                    MATCH (d:Dottrina {node_id: $d_id})
                    MATCH (art:Norma {URN: $art_urn})
                    MERGE (d)-[r:commenta]->(art)
                    ON CREATE SET r.certezza = 0.9, r.tipo = 'storica', r.fonte = 'Brocardi.it'
                    """,
                    {"d_id": dottrina_id, "art_urn": article_urn}
                )
                result.relations_created.append(f"commenta:{dottrina_id}->{article_urn}")

    def _normalize_massima(self, massima: Dict[str, Any], index: int) -> Dict[str, Any]:
        """
        Normalize massima from new BrocardiScraper format to pipeline format.

        New format (from _parse_massima):
            {'autorita': 'Cass. civ.', 'numero': '36918', 'anno': '2021', 'massima': 'text...'}

        Pipeline format:
            {'corte': 'Cassazione', 'numero': '36918/2021', 'estratto': 'text...'}
        """
        autorita = massima.get("autorita", "Cassazione") or "Cassazione"
        numero = massima.get("numero") or f"unknown_{index}"
        anno = massima.get("anno") or ""
        testo = massima.get("massima") or ""

        # Normalize autorita to corte
        # Supporta tutte le autorità giudiziarie italiane ed europee
        corte = autorita if autorita else "Cassazione"  # Mantieni l'originale se presente

        if autorita:
            autorita_lower = autorita.lower()

            # Corte Costituzionale (priorità alta - prima di Cassazione)
            if "cost" in autorita_lower or "costituzionale" in autorita_lower:
                corte = "Corte Costituzionale"

            # Cassazione (varie sezioni)
            elif "cass" in autorita_lower or autorita_lower.startswith("c."):
                if "sez" in autorita_lower and "un" in autorita_lower:
                    corte = "Cassazione Sezioni Unite"
                elif "civ" in autorita_lower:
                    corte = "Cassazione civile"
                elif "pen" in autorita_lower:
                    corte = "Cassazione penale"
                elif "lav" in autorita_lower:
                    corte = "Cassazione lavoro"
                else:
                    corte = "Cassazione"

            # Giustizia Amministrativa
            elif "tar" in autorita_lower:
                corte = autorita  # Mantieni "TAR Lazio", "TAR Lombardia", etc.
            elif "cons" in autorita_lower and "st" in autorita_lower:
                corte = "Consiglio di Stato"

            # Corte dei Conti
            elif "conti" in autorita_lower:
                corte = "Corte dei Conti"

            # Corti ordinarie
            elif "app" in autorita_lower:
                corte = "Corte d'Appello"
            elif "trib" in autorita_lower:
                corte = "Tribunale"

            # Corti europee
            elif "cgue" in autorita_lower or "giustizia" in autorita_lower and "ue" in autorita_lower:
                corte = "CGUE"
            elif "cedu" in autorita_lower:
                corte = "CEDU"

        # Combine numero/anno in expected format
        if anno:
            numero_full = f"{numero}/{anno}"
        else:
            numero_full = numero

        return {
            "corte": corte,
            "numero": numero_full,
            "estratto": testo,
        }

    async def _create_atto_giudiziario(
        self,
        massima: Dict[str, Any],
        article_urn: str,
        index: int,
        result: IngestionResult,
    ) -> None:
        """Create AttoGiudiziario node from a single massima."""
        corte = massima.get("corte", "Cassazione") or "Cassazione"
        numero = massima.get("numero") or f"unknown_{index}"
        estratto = massima.get("estratto", "") or ""

        # Parse numero for year
        anno = ""
        numero_sentenza = numero
        if "/" in numero:
            parts = numero.split("/")
            numero_sentenza = parts[0]
            anno = parts[1] if len(parts) > 1 else ""

        atto_id = f"massima_{corte.lower().replace(' ', '_')}_{numero.replace('/', '_')}"

        await self.falkordb.query(
            """
            MERGE (a:AttoGiudiziario {node_id: $id})
            ON CREATE SET
                a.estremi = $estremi,
                a.organo_emittente = $organo,
                a.numero_sentenza = $numero,
                a.anno = $anno,
                a.massima = $massima,
                a.tipo_atto = 'sentenza',
                a.fonte = 'Brocardi.it',
                a.confidence = 0.9,
                a.created_at = $timestamp
            """,
            {
                "id": atto_id,
                "estremi": f"{corte} {numero}",
                "organo": corte,
                "numero": numero_sentenza,
                "anno": anno,
                "massima": estratto,
                "timestamp": self._timestamp,
            }
        )
        result.nodes_created.append(f"AttoGiudiziario:{atto_id}")

        # Relation: AttoGiudiziario -[interpreta]-> Norma
        await self.falkordb.query(
            """
            MATCH (a:AttoGiudiziario {node_id: $a_id})
            MATCH (art:Norma {URN: $art_urn})
            MERGE (a)-[r:interpreta]->(art)
            ON CREATE SET
                r.certezza = 0.9,
                r.tipo_interpretazione = 'giurisprudenziale',
                r.fonte = 'Brocardi.it'
            """,
            {"a_id": atto_id, "art_urn": article_urn}
        )
        result.relations_created.append(f"interpreta:{atto_id}->{article_urn}")


# Convenience function
async def ingest_article_v2(
    article: VisualexArticle,
    falkordb_client=None,
    create_graph: bool = True,
    norm_tree: Optional[NormTree] = None,
) -> IngestionResult:
    """
    Convenience function to ingest an article with v2 pipeline.

    Args:
        article: VisualexArticle from API
        falkordb_client: Optional FalkorDB client
        create_graph: Whether to create graph nodes
        norm_tree: Optional NormTree for hierarchy extraction when Brocardi not available

    Returns:
        IngestionResult with chunks and mappings
    """
    pipeline = IngestionPipelineV2(falkordb_client=falkordb_client)
    return await pipeline.ingest_article(
        article, create_graph_nodes=create_graph, norm_tree=norm_tree
    )


__all__ = [
    "IngestionPipelineV2",
    "IngestionResult",
    "BridgeMapping",
    "ingest_article_v2",
    # Re-export for convenience
    "NormTree",
    "get_article_position",
]
