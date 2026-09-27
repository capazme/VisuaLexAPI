"""
Citation Export Router
======================

FastAPI endpoints for exporting legal citations from Q&A traces.

Endpoints:
- POST /citations/export: Generate citation export file
- GET /citations/download/{filename}: Download generated file
- POST /citations/format: Format citations inline (no file)
- GET /citations/formats: List available formats

Features:
- 4 export formats: Italian legal, BibTeX, Plain text, JSON
- Export from trace_id or direct sources
- UTF-8 encoding for Italian characters
- ALIS attribution and versioning

Example:
    >>> import httpx
    >>> # Export from trace
    >>> response = httpx.post(
    ...     "http://localhost:8100/api/v1/citations/export",
    ...     json={"trace_id": "trace_abc123", "format": "italian_legal"}
    ... )
    >>> download_url = response.json()["download_url"]
    >>>
    >>> # Download the file
    >>> file_response = httpx.get(f"http://localhost:8100{download_url}")
    >>> print(file_response.text)
"""

import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import structlog
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import FileResponse

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.api.models.citation_models import (
    CitationFormat,
    CitationSource,
    CitationExportRequest,
    CitationExportResponse,
    CitationFormatRequest,
    CitationFormatResponse,
    CitationFormatInfo,
    CitationFormatsListResponse,
)
from merlt.citation.formatter import CitationFormatter
from merlt.storage.trace.trace_service import TraceStorageService, TraceStorageConfig

log = structlog.get_logger()

router = APIRouter(prefix="/citations", tags=["citations"])

# Export directory (configurable via MERLT_EXPORT_DIR env var)
EXPORT_DIR = Path(
    os.environ.get("MERLT_EXPORT_DIR", Path(__file__).resolve().parent.parent.parent / "exports")
) / "citations"
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

# ALIS version for attribution
ALIS_VERSION = "MERL-T v1.0"

# Max length for query summary in exports
MAX_QUERY_SUMMARY_LENGTH = 200


# =============================================================================
# DEPENDENCIES
# =============================================================================


def get_formatter() -> CitationFormatter:
    """Get the citation formatter instance."""
    return CitationFormatter(alis_version=ALIS_VERSION)


async def get_trace_service() -> TraceStorageService:
    """
    Get an initialized TraceStorageService.

    Note: In production, this should be managed as a singleton or via dependency injection.
    """
    service = TraceStorageService(TraceStorageConfig())
    await service.connect()
    return service


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================


def sanitize_filename(query: str, max_length: int = 50) -> str:
    """
    Sanitize a query string for use in a filename.

    Args:
        query: Original query string
        max_length: Maximum length of the sanitized string

    Returns:
        Sanitized string safe for filenames
    """
    # Remove special characters, keep alphanumeric and spaces
    sanitized = re.sub(r'[^\w\s]', '', query.lower())
    # Replace spaces with underscores
    sanitized = re.sub(r'\s+', '_', sanitized.strip())
    # Truncate
    return sanitized[:max_length]


def generate_filename(
    query_summary: Optional[str],
    format: CitationFormat,
    extension: str
) -> str:
    """
    Generate a unique filename for the export.

    Format: citations_{query_slug}_{date}_{uuid}.{ext}

    Args:
        query_summary: Optional query for the slug
        format: Export format
        extension: File extension

    Returns:
        Unique filename
    """
    # Date part
    date_str = datetime.now().strftime("%Y%m%d")

    # UUID part
    unique_id = uuid.uuid4().hex[:8]

    # Query slug
    if query_summary:
        slug = sanitize_filename(query_summary, max_length=30)
        if slug:
            return f"citations_{slug}_{date_str}_{unique_id}.{extension}"

    return f"citations_{format.value}_{date_str}_{unique_id}.{extension}"


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.post("/export", response_model=CitationExportResponse)
async def export_citations(
    request: CitationExportRequest,
    formatter: CitationFormatter = Depends(get_formatter),
    api_key: ApiKey = Depends(verify_api_key),
) -> CitationExportResponse:
    """
    Export citations to a downloadable file.

    Either `trace_id` or `sources` must be provided.

    Args:
        request: Export request with trace_id or sources

    Returns:
        CitationExportResponse with download URL

    Raises:
        HTTPException: 400 if neither trace_id nor sources provided
        HTTPException: 404 if trace not found

    Example:
        >>> POST /api/v1/citations/export
        >>> {"trace_id": "trace_abc123", "format": "italian_legal"}
        {
          "success": true,
          "format": "italian_legal",
          "filename": "citations_risoluzione_20260205_abc12345.txt",
          "download_url": "/api/v1/citations/download/citations_...",
          "citations_count": 5,
          "alis_version": "MERL-T v1.0",
          "generated_at": "2026-02-05T14:30:00"
        }
    """
    log.info("Citation export requested", format=request.format.value, trace_id=request.trace_id)

    # Validate input
    if not request.trace_id and not request.sources:
        raise HTTPException(
            status_code=400,
            detail="Either trace_id or sources must be provided"
        )

    sources = []
    query_summary = None

    # Get sources from trace or request
    if request.trace_id:
        trace_service = None
        try:
            trace_service = await get_trace_service()
            trace_data = await trace_service.get_trace(request.trace_id, consent_level="full")

            if not trace_data:
                raise HTTPException(
                    status_code=404,
                    detail=f"Trace not found: {request.trace_id}"
                )

            # Extract sources from trace
            trace_sources = trace_data.get("sources") or []
            sources = [
                {"article_urn": s.get("article_urn", s.get("urn", "")), **s}
                for s in trace_sources
            ]

            # Get query summary
            if request.include_query_summary:
                query_text = trace_data.get("query", "")
                if query_text and query_text != "[REDACTED]":
                    query_summary = query_text[:MAX_QUERY_SUMMARY_LENGTH]

        except HTTPException:
            raise
        except Exception as e:
            log.error("Error fetching trace", error=str(e), trace_id=request.trace_id)
            raise HTTPException(
                status_code=500,
                detail=f"Error fetching trace: {str(e)}"
            )
        finally:
            if trace_service:
                try:
                    await trace_service.close()
                except Exception as e:
                    log.debug("trace_service_close_failed", error=str(e))

    elif request.sources:
        # Use provided sources
        sources = [s.model_dump() for s in request.sources]

    if not sources:
        raise HTTPException(
            status_code=400,
            detail="No sources found to export"
        )

    # Format citations
    try:
        content = formatter.format_sources(
            sources=sources,
            format=request.format,
            query_summary=query_summary if request.include_query_summary else None,
            include_attribution=request.include_attribution,
        )
    except Exception as e:
        log.error("Error formatting citations", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Error formatting citations: {str(e)}"
        )

    # Generate filename and write file
    extension = formatter.get_file_extension(request.format)
    filename = generate_filename(query_summary, request.format, extension)
    filepath = EXPORT_DIR / filename

    try:
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
    except Exception as e:
        log.error("Error writing export file", error=str(e), filename=filename)
        raise HTTPException(
            status_code=500,
            detail=f"Error writing export file: {str(e)}"
        )

    log.info("Citation export created", filename=filename, citations_count=len(sources))

    return CitationExportResponse(
        success=True,
        format=request.format,
        filename=filename,
        download_url=f"/api/v1/citations/download/{filename}",
        citations_count=len(sources),
        alis_version=ALIS_VERSION,
        generated_at=datetime.now(),
        message=f"Exported {len(sources)} citations in {request.format.value} format",
    )


@router.get("/download/{filename}")
async def download_citation_file(
    filename: str,
    api_key: ApiKey = Depends(verify_api_key),
):
    """
    Download a generated citation export file.

    Args:
        filename: Name of the file to download

    Returns:
        FileResponse with the file content

    Raises:
        HTTPException: 404 if file not found
        HTTPException: 400 if filename contains path traversal

    Example:
        >>> GET /api/v1/citations/download/citations_risoluzione_20260205_abc12345.txt
        # Returns file content
    """
    # Security: prevent path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(
            status_code=400,
            detail="Invalid filename"
        )

    filepath = EXPORT_DIR / filename

    if not filepath.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {filename}"
        )

    # Determine media type
    if filename.endswith(".json"):
        media_type = "application/json; charset=utf-8"
    elif filename.endswith(".bib"):
        media_type = "application/x-bibtex"
    elif filename.endswith(".txt"):
        media_type = "text/plain; charset=utf-8"
    else:
        media_type = "application/octet-stream"

    log.info("Citation file downloaded", filename=filename)

    return FileResponse(
        path=filepath,
        filename=filename,
        media_type=media_type,
    )


@router.post("/format", response_model=CitationFormatResponse)
async def format_citations_inline(
    request: CitationFormatRequest,
    formatter: CitationFormatter = Depends(get_formatter),
    api_key: ApiKey = Depends(verify_api_key),
) -> CitationFormatResponse:
    """
    Format citations inline without generating a file.

    Returns the formatted content directly in the response.

    Args:
        request: Format request with sources

    Returns:
        CitationFormatResponse with formatted content

    Example:
        >>> POST /api/v1/citations/format
        >>> {
        ...   "sources": [{"article_urn": "urn:nir:stato:codice.civile:1942;art1453"}],
        ...   "format": "italian_legal"
        ... }
        {
          "success": true,
          "format": "italian_legal",
          "content": "FONTI GIURIDICHE\\n===============\\n...",
          "citations_count": 1
        }
    """
    log.info("Citation inline format requested", format=request.format.value)

    sources = [s.model_dump() for s in request.sources]

    try:
        content = formatter.format_sources(
            sources=sources,
            format=request.format,
            query_summary=request.query_summary,
            include_attribution=request.include_attribution,
        )
    except Exception as e:
        log.error("Error formatting citations", error=str(e))
        raise HTTPException(
            status_code=500,
            detail=f"Error formatting citations: {str(e)}"
        )

    return CitationFormatResponse(
        success=True,
        format=request.format,
        content=content,
        citations_count=len(sources),
        alis_version=ALIS_VERSION,
    )


@router.get("/formats", response_model=CitationFormatsListResponse)
async def list_citation_formats(
    api_key: ApiKey = Depends(verify_api_key),
) -> CitationFormatsListResponse:
    """
    List all available citation export formats.

    Returns:
        CitationFormatsListResponse with format details

    Example:
        >>> GET /api/v1/citations/formats
        {
          "formats": [
            {
              "name": "italian_legal",
              "description": "Standard Italian legal citation style",
              "extension": "txt",
              "media_type": "text/plain; charset=utf-8"
            },
            ...
          ],
          "default_format": "italian_legal"
        }
    """
    formats = [
        CitationFormatInfo(
            name="italian_legal",
            description="Standard Italian legal citation style (Art. 1453 c.c.)",
            extension="txt",
            media_type="text/plain; charset=utf-8",
        ),
        CitationFormatInfo(
            name="bibtex",
            description="BibTeX format for academic papers and LaTeX documents",
            extension="bib",
            media_type="application/x-bibtex",
        ),
        CitationFormatInfo(
            name="plain_text",
            description="Simple numbered list of citations",
            extension="txt",
            media_type="text/plain; charset=utf-8",
        ),
        CitationFormatInfo(
            name="json",
            description="Structured JSON with full metadata and parsed URN components",
            extension="json",
            media_type="application/json; charset=utf-8",
        ),
    ]

    return CitationFormatsListResponse(
        formats=formats,
        default_format="italian_legal",
    )


# =============================================================================
# EXPORTS
# =============================================================================


__all__ = ["router"]
