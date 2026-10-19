"""
Amendment Extractor Service
============================

Integrates MultivigenzaPipeline with live enrichment database.

Extracts amendments (multivigenza) from:
1. Articles (via Normattiva scraper)
2. User-uploaded documents
3. Manual submissions

Saves to pending_amendments for community validation.

Usage:
    from merlt.pipeline.amendment_extractor import AmendmentExtractorService
    from merlt.storage.enrichment import get_db_session
    from merlt.clients import NormaVisitata, Norma

    extractor = AmendmentExtractorService()

    # Extract from article
    norma = Norma(tipo_atto="codice civile", data="1942-03-16", numero_atto="262")
    nv = NormaVisitata(norma=norma, numero_articolo="1453")

    async with get_db_session() as session:
        result = await extractor.extract_from_article(
            norma_visitata=nv,
            user_id="system",
            session=session,
        )
        print(f"Found {result.amendments_count} amendments")
"""

import structlog
from typing import List, Optional
from dataclasses import dataclass
from datetime import datetime, date
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from merlt.clients import NormaVisitata, Modifica, TipoModifica, NormattivaScraper
from merlt.pipeline.multivigenza import (
    MultivigenzaPipeline,
    parse_estremi,
    parse_disposizione,
)
from merlt.storage.enrichment.models import PendingAmendment

log = structlog.get_logger()


def _parse_date_string(date_str: Optional[str]) -> Optional[date]:
    """
    Convert date string (YYYY-MM-DD) to date object.

    Args:
        date_str: Date string in YYYY-MM-DD format

    Returns:
        date object or None if parsing fails
    """
    if not date_str:
        return None

    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, AttributeError):
        log.warning(f"Failed to parse date: {date_str}")
        return None


@dataclass
class AmendmentExtractionResult:
    """Result of amendment extraction."""

    amendments_count: int = 0
    amendment_ids: List[str] = None
    errors: List[str] = None

    def __post_init__(self):
        if self.amendment_ids is None:
            self.amendment_ids = []
        if self.errors is None:
            self.errors = []


class AmendmentExtractorService:
    """
    Service for extracting amendments and saving to database.

    Integrates MultivigenzaPipeline with pending_amendments table.
    """

    def __init__(
        self,
        scraper: Optional[NormattivaScraper] = None,
    ):
        """
        Initialize extractor.

        Args:
            scraper: Optional NormattivaScraper instance
        """
        self.scraper = scraper or NormattivaScraper()
        self.pipeline = MultivigenzaPipeline(
            falkordb_client=None,  # We're not writing to graph yet
            scraper=self.scraper,
            dry_run=True,  # Only extract, don't write
        )

    async def extract_from_article(
        self,
        norma_visitata: NormaVisitata,
        user_id: str,
        session: AsyncSession,
        contributor_authority: float = 0.5,
    ) -> AmendmentExtractionResult:
        """
        Extract amendments for an article using MultivigenzaPipeline.

        Args:
            norma_visitata: Article reference
            user_id: User ID (or 'system' for automatic extraction)
            session: DB session
            contributor_authority: Authority of contributor

        Returns:
            AmendmentExtractionResult with counts
        """
        log.info("Extracting amendments from article", article_urn=norma_visitata.urn)

        result = AmendmentExtractionResult()

        try:
            # Use MultivigenzaPipeline to get amendment history
            multivigenza_result = await self.pipeline.ingest_with_history(
                normavisitata=norma_visitata,
                fetch_all_versions=False,  # Don't fetch versions, just amendments
                create_modifying_acts=False,  # Don't create graph nodes
            )

            if not multivigenza_result.storia or not multivigenza_result.storia.modifiche:
                log.info("No amendments found for article")
                return result

            # Convert Modifica to PendingAmendment
            for modifica in multivigenza_result.storia.modifiche:
                try:
                    amendment_id = await self._create_pending_amendment(
                        modifica=modifica,
                        target_article_urn=norma_visitata.urn,
                        user_id=user_id,
                        contributor_authority=contributor_authority,
                        source_type="normattiva_scraper",
                        session=session,
                    )

                    result.amendment_ids.append(amendment_id)
                    result.amendments_count += 1

                except Exception as e:
                    error_msg = f"Failed to create amendment: {e}"
                    log.error(error_msg, exc_info=True)
                    result.errors.append(error_msg)

            log.info(f"Extracted {result.amendments_count} amendments from Normattiva")

        except Exception as e:
            error_msg = f"Amendment extraction failed: {e}"
            log.error(error_msg, exc_info=True)
            result.errors.append(error_msg)

        return result

    async def _create_pending_amendment(
        self,
        modifica: Modifica,
        target_article_urn: str,
        user_id: str,
        contributor_authority: float,
        source_type: str,
        session: AsyncSession,
        source_document_id: Optional[int] = None,
    ) -> str:
        """
        Create PendingAmendment from Modifica.

        Args:
            modifica: Modifica object from MultivigenzaPipeline
            target_article_urn: URN of target article
            user_id: Contributor user ID
            contributor_authority: Contributor's authority
            source_type: Source type ('normattiva_scraper' | 'user_document' | 'manual')
            session: DB session
            source_document_id: Optional source document ID

        Returns:
            Amendment ID
        """
        # Parse estremi
        parsed_estremi = parse_estremi(modifica.atto_modificante_estremi)

        # Parse disposizione
        parsed_disp = parse_disposizione(modifica.disposizione)

        # Generate amendment ID
        amendment_id = f"amend:{target_article_urn.split('~')[-1]}:{uuid4().hex[:8]}"

        # Map TipoModifica to string
        tipo_modifica_str = modifica.tipo_modifica.value if isinstance(modifica.tipo_modifica, TipoModifica) else modifica.tipo_modifica

        # Create PendingAmendment
        amendment = PendingAmendment(
            amendment_id=amendment_id,
            target_article_urn=target_article_urn,
            atto_modificante_urn=modifica.atto_modificante_urn,
            atto_modificante_estremi=modifica.atto_modificante_estremi,
            tipo_atto=parsed_estremi.get("tipo_atto"),
            tipo_documento=parsed_estremi.get("tipo_documento"),
            data_atto=_parse_date_string(parsed_estremi.get("data")),
            numero_atto=parsed_estremi.get("numero"),
            disposizione=modifica.disposizione,
            numero_articolo_disposizione=parsed_disp.get("numero_articolo"),
            commi_disposizione=parsed_disp.get("commi", []),
            lettere_disposizione=parsed_disp.get("lettere", []),
            numeri_disposizione=parsed_disp.get("numeri", []),
            tipo_modifica=tipo_modifica_str,
            data_pubblicazione_gu=_parse_date_string(modifica.data_pubblicazione_gu) if isinstance(modifica.data_pubblicazione_gu, str) else modifica.data_pubblicazione_gu,
            data_efficacia=_parse_date_string(modifica.data_efficacia) if isinstance(modifica.data_efficacia, str) else modifica.data_efficacia,
            source_type=source_type,
            source_document_id=source_document_id,
            contributed_by=user_id,
            contributor_authority=contributor_authority,
            validation_status="pending",
            # For Normattiva-sourced amendments, we can approve automatically
            # (high confidence) or still require validation
            # For Phase 1, we'll mark as pending for community review
        )

        session.add(amendment)
        await session.flush()  # Get ID without committing

        log.debug("Created pending amendment", amendment_id=amendment_id, tipo=tipo_modifica_str)

        return amendment_id

    async def extract_from_document_text(
        self,
        text: str,
        legal_domain: Optional[str],
        user_id: str,
        session: AsyncSession,
        source_document_id: Optional[int] = None,
        contributor_authority: float = 0.5,
    ) -> AmendmentExtractionResult:
        """
        Extract amendments from free text (user document).

        Uses regex patterns to identify amendment references.

        Args:
            text: Document text
            legal_domain: Legal domain
            user_id: User ID
            session: DB session
            source_document_id: Source document ID
            contributor_authority: Contributor's authority

        Returns:
            AmendmentExtractionResult
        """
        log.info("Extracting amendments from text", length=len(text))

        result = AmendmentExtractionResult()

        # Regex pattern for amendment references
        # Matches various formats:
        # 1. Compact: "Art. 1453 c.c., come modificato dalla L. 7 agosto 1990, n. 241"
        # 2. Extended: "L'articolo 1453 del Codice Civile è stato modificato dal D.Lgs. 30 giugno 2003, n. 196"
        # 3. Generic: "L'articolo 1453 è stato modificato dalla L. 25 marzo 2010, n. 42"

        # This is a simplified implementation for Phase 1
        # Full NLP-based extraction will be in Phase 2

        import re

        # Pattern 1: Compact form "art. X c.c., come modificato dalla/dal..."
        pattern1 = r"art\.?\s*(\d+(?:-\w+)?)\s+c\.c\.,?\s+come\s+(modificato|sostituito|abrogato)\s+dall?[ae]?\s+([\w\s,\.]+n\.\s*\d+)"

        # Pattern 2: Extended form "L'articolo X del Codice Civile è stato modificato dal..."
        pattern2 = r"articolo\s+(\d+(?:-\w+)?)\s+del\s+Codice\s+Civile\s+è\s+stato\s+(modificato|sostituito|abrogato)\s+dal\s+([\w\s,\.]+n\.\s*\d+)"

        # Pattern 3: Generic form "L'articolo X è stato modificato dalla/dal..."
        pattern3 = r"articolo\s+(\d+(?:-\w+)?)\s+è\s+stato\s+(modificato|sostituito|abrogato)\s+dall?[ae]?\s+([\w\s,\.]+n\.\s*\d+)"

        all_matches = []
        all_matches.extend(re.finditer(pattern1, text, re.IGNORECASE))
        all_matches.extend(re.finditer(pattern2, text, re.IGNORECASE))
        all_matches.extend(re.finditer(pattern3, text, re.IGNORECASE))

        matches = all_matches

        for match in matches:
            article_num = match.group(1)
            modif_type = match.group(2)  # modificato, sostituito, abrogato
            atto_ref = match.group(3)  # "L. 7 agosto 1990, n. 241"

            # Map Italian verbs to TipoModifica
            tipo_map = {
                "modificato": "MODIFICA",
                "sostituito": "SOSTITUISCE",
                "abrogato": "ABROGA",
            }

            tipo_modifica = tipo_map.get(modif_type.lower(), "MODIFICA")

            # Generate target URN (simplified - assumes codice civile)
            target_urn = f"urn:nir:stato:regio.decreto:1942-03-16;262~art{article_num}"

            # Parse atto reference
            parsed_estremi = parse_estremi(atto_ref)

            # Create amendment
            amendment_id = f"amend:art{article_num}:{uuid4().hex[:8]}"

            amendment = PendingAmendment(
                amendment_id=amendment_id,
                target_article_urn=target_urn,
                atto_modificante_urn=None,  # Unknown from text
                atto_modificante_estremi=atto_ref,
                tipo_atto=parsed_estremi.get("tipo_atto"),
                tipo_documento=parsed_estremi.get("tipo_documento"),
                data_atto=_parse_date_string(parsed_estremi.get("data")),
                numero_atto=parsed_estremi.get("numero"),
                disposizione="",  # Unknown from text
                tipo_modifica=tipo_modifica,
                source_type="user_document",
                source_document_id=source_document_id,
                contributed_by=user_id,
                contributor_authority=contributor_authority,
                validation_status="pending",
                llm_confidence=0.6,  # Regex-based, medium confidence
            )

            session.add(amendment)
            result.amendment_ids.append(amendment_id)
            result.amendments_count += 1

            if result.amendments_count >= 50:  # Safety limit
                break

        log.info(f"Extracted {result.amendments_count} amendments from text")
        return result


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "AmendmentExtractorService",
    "AmendmentExtractionResult",
]
