"""
Document Parser Service
=======================

Parses user-uploaded documents to extract:
- Legal entities (concepts, principles, definitions)
- Semantic relations
- Amendments (multivigenza) for legislative texts

Supports:
- PDF (via pdfplumber)
- TXT (plain text)
- DOCX (via python-docx)

Integration:
- Creates PendingEntity, PendingRelation, PendingAmendment
- Uses LLM for extraction
- Uses MultivigenzaPipeline for amendment parsing

Usage:
    from merlt.pipeline.document_parser import DocumentParserService
    from merlt.storage.enrichment import get_db_session

    parser = DocumentParserService()

    async with get_db_session() as session:
        result = await parser.parse_document(
            document_path="/path/to/manuale_torrente.pdf",
            file_type="pdf",
            document_type="manuale",
            legal_domain="civile",
            user_id="user123",
            session=session,
        )

        print(f"Extracted {result.entities_count} entities")
"""

import os
import re
import structlog
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

# Staging candidates are ephemeral (Slice 2c #3): purged after promotion or TTL.
STAGING_TTL_HOURS = int(os.getenv("MERLT_STAGING_TTL_HOURS", "48"))

from merlt.storage.enrichment.models import (
    PendingEntity,
    PendingRelation,
    PendingAmendment,
    ExtractionCandidate,
)
from merlt.storage.enrichment import EntityDeduplicator
from merlt.pipeline.enrichment.models import EntityType, RelationType
from merlt.pipeline.multivigenza import parse_estremi, parse_disposizione

log = structlog.get_logger()


@dataclass
class ParseResult:
    """Result of document parsing."""

    entities_count: int = 0
    relations_count: int = 0
    amendments_count: int = 0
    errors: List[str] = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


class DocumentParserService:
    """
    Service for parsing user documents.

    Extraction strategies:
    1. Text extraction (PDF/DOCX/TXT)
    2. Chunking by sections/paragraphs
    3. LLM extraction per chunk
    4. Deduplication and linking
    5. Save to pending tables
    """

    def __init__(self, llm_service=None):
        """
        Initialize parser.

        Args:
            llm_service: Optional LLM service (default: OpenRouterService)
        """
        self.llm_service = llm_service
        if not self.llm_service:
            try:
                from merlt.rlcf.ai_service import OpenRouterService

                self.llm_service = OpenRouterService()
            except ImportError:
                log.warning("LLM service not available, extraction will be limited")

    async def parse_document(
        self,
        document_path: str,
        file_type: str,
        document_type: Optional[str],
        legal_domain: Optional[str],
        extract_entities: bool,
        extract_amendments: bool,
        user_id: str,
        session: AsyncSession,
        persist_target: str = "pending",
        document_id: Optional[int] = None,
        extract_relations: bool = False,
    ) -> ParseResult:
        """
        Parse document to extract entities and amendments.

        Args:
            document_path: Path to document file
            file_type: File type ('pdf', 'txt', 'docx')
            document_type: Document type ('dottrina', 'manuale', etc.)
            legal_domain: Legal domain ('civile', 'penale', etc.)
            extract_entities: Whether to extract entities
            extract_amendments: Whether to extract amendments
            user_id: User ID
            session: DB session

        Returns:
            ParseResult with counts
        """
        log.info("Parsing document", path=document_path, type=file_type)

        result = ParseResult()

        # Step 1: Extract text
        try:
            text = await self._extract_text(document_path, file_type)
        except Exception as e:
            error_msg = f"Text extraction failed: {e}"
            log.error(error_msg, exc_info=True)
            result.errors.append(error_msg)
            return result

        if not text or len(text.strip()) < 100:
            result.errors.append("Extracted text too short or empty")
            return result

        log.info(f"Extracted text", length=len(text))

        # Step 2: Chunk text
        chunks = self._chunk_text(text, max_chunk_size=2000)
        log.info(f"Created {len(chunks)} chunks")

        # Step 3: Extract entities (if requested)
        if extract_entities and self.llm_service:
            entities_count = await self._extract_entities_from_chunks(
                chunks=chunks,
                legal_domain=legal_domain,
                user_id=user_id,
                session=session,
                persist_target=persist_target,
                document_id=document_id,
            )
            result.entities_count = entities_count

        # Step 3b: Extract relations (loop-closure B1, if requested)
        if extract_relations and self.llm_service:
            result.relations_count = await self._extract_relations_from_chunks(
                chunks=chunks,
                legal_domain=legal_domain,
                user_id=user_id,
                session=session,
                persist_target=persist_target,
                document_id=document_id,
            )

        # Step 4: Extract amendments (if requested)
        if extract_amendments:
            amendments_count = await self._extract_amendments_from_text(
                text=text,
                legal_domain=legal_domain,
                user_id=user_id,
                session=session,
            )
            result.amendments_count = amendments_count

        log.info("Document parsing complete", **result.__dict__)
        return result

    async def extract_text(self, document_path: str, file_type: str) -> str:
        """
        Public method to extract text from document.

        Args:
            document_path: Path to document file
            file_type: File type ('pdf', 'txt', 'docx')

        Returns:
            Extracted text content
        """
        return await self._extract_text(document_path, file_type)

    async def chunk_text(
        self,
        text: str,
        chunk_size: int = 1000,
        overlap: int = 100
    ) -> list[str]:
        """
        Chunk text into overlapping segments.

        Args:
            text: Text to chunk
            chunk_size: Maximum chunk size in characters
            overlap: Overlap between chunks in characters

        Returns:
            List of text chunks with overlap
        """
        if not text:
            return []

        chunks = []
        start = 0
        text_len = len(text)

        while start < text_len:
            # Calculate end position
            end = min(start + chunk_size, text_len)

            # Extract chunk
            chunk = text[start:end]
            chunks.append(chunk)

            # Move to next chunk with overlap
            if end >= text_len:
                break
            start = end - overlap

        return chunks

    async def _extract_text(self, document_path: str, file_type: str) -> str:
        """
        Extract text from document.

        Args:
            document_path: Path to file
            file_type: File type

        Returns:
            Extracted text
        """
        if file_type == "txt":
            # Plain text
            with open(document_path, "r", encoding="utf-8") as f:
                return f.read()

        elif file_type == "pdf":
            # PDF extraction with pdfplumber
            try:
                import pdfplumber
            except ImportError:
                raise RuntimeError("pdfplumber not installed. Install with: pip install pdfplumber")

            text_parts = []
            with pdfplumber.open(document_path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text_parts.append(page_text)

            return "\n\n".join(text_parts)

        elif file_type == "docx":
            # DOCX extraction with python-docx
            try:
                from docx import Document
            except ImportError:
                raise RuntimeError("python-docx not installed. Install with: pip install python-docx")

            doc = Document(document_path)
            return "\n\n".join([para.text for para in doc.paragraphs if para.text.strip()])

        else:
            raise ValueError(f"Unsupported file type: {file_type}")

    def _chunk_text(self, text: str, max_chunk_size: int = 2000) -> List[str]:
        """
        Chunk text by paragraphs/sections.

        Args:
            text: Full text
            max_chunk_size: Max characters per chunk

        Returns:
            List of text chunks
        """
        # Split by double newlines (paragraphs)
        paragraphs = re.split(r"\n\n+", text)

        chunks = []
        current_chunk = []
        current_size = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            para_size = len(para)

            if current_size + para_size > max_chunk_size and current_chunk:
                # Save current chunk
                chunks.append("\n\n".join(current_chunk))
                current_chunk = [para]
                current_size = para_size
            else:
                current_chunk.append(para)
                current_size += para_size

        # Save last chunk
        if current_chunk:
            chunks.append("\n\n".join(current_chunk))

        return chunks

    async def _extract_entities_from_chunks(
        self,
        chunks: List[str],
        legal_domain: Optional[str],
        user_id: str,
        session: AsyncSession,
        persist_target: str = "pending",
        document_id: Optional[int] = None,
    ) -> int:
        """
        Extract entities from text chunks using LLM.

        persist_target:
          - "pending"  → create PendingEntity (canonical RLCF queue, legacy path)
          - "staging"  → create ExtractionCandidate (Slice 2c review buffer; the
            raw verbatim never enters pending_*).

        Uses the same LLM extractors as enrichment pipeline:
        - ConceptExtractor for concepts
        - PrincipleExtractor for principles
        - DefinitionExtractor for definitions

        Args:
            chunks: List of text chunks
            legal_domain: Legal domain
            user_id: User ID
            session: DB session

        Returns:
            Number of entities extracted
        """
        if not self.llm_service:
            log.warning("LLM service not available, skipping entity extraction")
            return 0

        from merlt.pipeline.enrichment.extractors import create_extractor
        from merlt.pipeline.enrichment.models import EnrichmentContent, EntityType

        log.info(f"Extracting entities from {len(chunks)} chunks using LLM")

        # Create extractors for main entity types
        entity_types = [EntityType.PRINCIPIO, EntityType.CONCETTO, EntityType.DEFINIZIONE]
        extractors = {}

        for entity_type in entity_types:
            try:
                extractors[entity_type] = create_extractor(self.llm_service, entity_type)
            except Exception as e:
                log.warning(f"Failed to create extractor for {entity_type}: {e}")

        if not extractors:
            log.error("No extractors available")
            return 0

        entities_count = 0

        # Process each chunk
        for chunk_idx, chunk in enumerate(chunks):
            if not chunk.strip():
                continue

            log.debug(f"Processing chunk {chunk_idx + 1}/{len(chunks)}")

            # Create EnrichmentContent for this chunk
            content = EnrichmentContent(
                id=f"user_doc:chunk{chunk_idx}:{uuid4().hex[:8]}",
                text=chunk,
                source="user_document",
                content_type="documento",
                article_refs=[],
            )

            # Extract with each entity type
            for entity_type, extractor in extractors.items():
                try:
                    extracted_entities = await extractor.extract(content)

                    for entity_data in extracted_entities:
                        # Convert enum to string for database
                        tipo_str = (
                            entity_data.tipo.value
                            if hasattr(entity_data.tipo, "value")
                            else str(entity_data.tipo)
                        )

                        entity_id = f"{tipo_str}:{uuid4().hex[:8]}"
                        snippet = chunk[:500] if len(chunk) > 500 else chunk

                        if persist_target == "staging":
                            # Slice 2c: land in the review buffer, NOT pending_*.
                            # The verbatim snippet stays here; promotion creates a
                            # fresh PendingEntity from the user's reformulated text.
                            # #4 dedup: flag a likely existing canonical node so the
                            # review UI can warn before promotion.
                            potential_dup = None
                            try:
                                dres = await EntityDeduplicator(session).find_duplicates(
                                    entity_data.nome, tipo_str
                                )
                                if dres.best_match:
                                    potential_dup = dres.best_match.entity_id
                            except Exception as dup_exc:  # dedup is best-effort
                                log.warning("dedup check failed", entity=entity_data.nome, exc=str(dup_exc))
                            row = ExtractionCandidate(
                                document_id=document_id,
                                contributor_id=user_id,
                                candidate_type="entity",
                                entity_text=entity_data.nome,
                                entity_type=tipo_str,
                                article_urn="user_document",
                                descrizione=entity_data.descrizione or "",
                                verbatim_excerpt=snippet,
                                llm_confidence=entity_data.confidence or 0.8,
                                llm_model="google/gemini-2.5-flash",
                                potential_duplicate_of=potential_dup,
                                status="draft",
                                # #3: ephemeral — purged after this TTL if not promoted.
                                expires_at=datetime.now() + timedelta(hours=STAGING_TTL_HOURS),
                            )
                        else:
                            row = PendingEntity(
                                entity_id=entity_id,
                                article_urn="user_document",
                                source_type="user_document",
                                entity_type=tipo_str,
                                entity_text=entity_data.nome,
                                descrizione=entity_data.descrizione or "",
                                ambito=legal_domain or "",
                                fonte="llm_extraction",
                                llm_confidence=entity_data.confidence or 0.8,
                                llm_model="google/gemini-2.5-flash",
                                llm_reasoning=snippet,  # Context snippet
                                contributed_by=user_id,
                                contributor_authority=0.5,
                                validation_status="pending",
                            )

                        session.add(row)
                        entities_count += 1

                        log.debug(
                            f"Extracted entity: {entity_data.nome} ({entity_data.tipo})"
                        )
                        log.info(
                            f"✅ Added to session: {entity_id} - {entity_data.nome}"
                        )

                except Exception as e:
                    log.error(
                        f"❌ Extraction error for {entity_type} in chunk {chunk_idx}: {e}",
                        exc_info=True,
                    )

        # Log extraction results (commit will be done by caller)
        if entities_count > 0:
            log.info(f"✅ Extracted {entities_count} entities - added to session (waiting for commit)")
        else:
            log.warning("⚠️  No entities extracted from document")

        return entities_count

    async def _extract_relations_from_chunks(
        self,
        chunks: List[str],
        legal_domain: Optional[str],
        user_id: str,
        session: AsyncSession,
        persist_target: str = "pending",
        document_id: Optional[int] = None,
    ) -> int:
        """
        Extract semantic relations from text chunks using the LLM (loop-closure B1).

        persist_target:
          - "staging" → ExtractionCandidate(candidate_type="relation") — the
            review buffer; verbatim stays here, never in pending_*.
          - "pending" → PendingRelation (legacy RLCF queue).

        This closes the gap noted in the design: notes could yield entities but
        never relations. Endpoints (source/target) are stored as the concept
        names the LLM found; promotion resolves them to graph nodes.
        """
        if not self.llm_service:
            log.warning("LLM service not available, skipping relation extraction")
            return 0

        from merlt.pipeline.enrichment.extractors.relation import RelationExtractor
        from merlt.pipeline.enrichment.models import EnrichmentContent

        extractor = RelationExtractor(self.llm_service)
        relations_count = 0

        for chunk_idx, chunk in enumerate(chunks):
            if not chunk.strip():
                continue

            content = EnrichmentContent(
                id=f"user_doc:relchunk{chunk_idx}:{uuid4().hex[:8]}",
                text=chunk,
                source="user_document",
                content_type="documento",
                article_refs=[],
            )

            try:
                relations = await extractor.extract(content)
            except Exception as e:
                log.error(f"Relation extraction error in chunk {chunk_idx}: {e}", exc_info=True)
                continue

            snippet = chunk[:500] if len(chunk) > 500 else chunk

            for rel in relations:
                if persist_target == "staging":
                    row = ExtractionCandidate(
                        document_id=document_id,
                        contributor_id=user_id,
                        candidate_type="relation",
                        relation_type=rel.relation_type,
                        source_node_urn=rel.source,
                        target_entity_id=rel.target,
                        article_urn="user_document",
                        descrizione=rel.descrizione or "",
                        verbatim_excerpt=snippet,
                        llm_confidence=rel.confidence,
                        llm_model="google/gemini-2.5-flash",
                        status="draft",
                        expires_at=datetime.now() + timedelta(hours=STAGING_TTL_HOURS),
                    )
                else:
                    row = PendingRelation(
                        relation_id=f"{rel.relation_type}:{uuid4().hex[:8]}",
                        article_urn="user_document",
                        source_type="user_document",
                        relation_type=rel.relation_type,
                        source_node_urn=rel.source,
                        target_entity_id=rel.target,
                        relation_description=rel.descrizione or "",
                        certezza=rel.confidence,
                        fonte="llm_extraction",
                        llm_confidence=rel.confidence,
                        llm_model="google/gemini-2.5-flash",
                        contributed_by=user_id,
                        contributor_authority=0.5,
                        validation_status="pending",
                    )

                session.add(row)
                relations_count += 1

        if relations_count > 0:
            log.info(f"✅ Extracted {relations_count} relations - added to session")
        else:
            log.warning("⚠️  No relations extracted from document")

        return relations_count

    async def _extract_amendments_from_text(
        self,
        text: str,
        legal_domain: Optional[str],
        user_id: str,
        session: AsyncSession,
    ) -> int:
        """
        Extract amendments from legislative text.

        Uses AmendmentExtractorService for extraction.

        Args:
            text: Full document text
            legal_domain: Legal domain
            user_id: User ID
            session: DB session

        Returns:
            Number of amendments extracted
        """
        from merlt.pipeline.amendment_extractor import AmendmentExtractorService

        extractor = AmendmentExtractorService()

        result = await extractor.extract_from_document_text(
            text=text,
            legal_domain=legal_domain,
            user_id=user_id,
            session=session,
            source_document_id=None,  # Will be set by caller if from document
            contributor_authority=0.5,
        )

        if result.errors:
            log.warning(f"Amendment extraction errors: {result.errors}")

        return result.amendments_count


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "DocumentParserService",
    "ParseResult",
]
