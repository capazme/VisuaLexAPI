"""
Document Upload & Parsing Router
=================================

FastAPI router for user document management:
- Upload PDF/TXT documents (e.g., Manuale Torrente)
- Parse documents to extract entities, relations, amendments
- Manual amendment submission

Endpoints:
- POST /documents/upload - Upload file
- POST /documents/{doc_id}/parse - Extract content
- GET /documents/{doc_id} - Get document info
- GET /documents - List user documents
- POST /amendments/submit - Manual amendment entry
- GET /amendments - List pending amendments

Integration:
- Uses PostgreSQL (user_documents, pending_amendments)
- Uses MultivigenzaPipeline for amendment parsing
- Uses LLM for entity/relation extraction from docs
"""

import os
import hashlib
import structlog
from pathlib import Path
from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey
from merlt.storage.enrichment import (
    get_db_session_dependency,
    UserDocument,
    PendingAmendment,
)
from merlt.api.models.document_models import (
    AmendmentSubmissionRequest,
    AmendmentSubmissionResponse,
    DocumentInfo,
    DocumentListResponse,
    DocumentParseRequest,
    DocumentParseResponse,
    DocumentUploadResponse,
    PendingAmendmentInfo,
)

log = structlog.get_logger()

router = APIRouter(prefix="/documents", tags=["documents"])
amendments_router = APIRouter(prefix="/amendments", tags=["amendments"])

# Storage configuration
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads/user_documents"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

MAX_FILE_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "50"))
ALLOWED_EXTENSIONS = {".pdf", ".txt", ".docx"}


# ====================================================
# DOCUMENT UPLOAD
# ====================================================
@router.post(
    "/upload",
    response_model=DocumentUploadResponse,
    summary="Upload user document",
    description="""
Upload a document for enrichment extraction.

Supported formats:
- PDF (legal manuals, commentaries)
- TXT (plain text)
- DOCX (Word documents)

Use cases:
- Upload "Manuale Torrente" to extract doctrine
- Upload legislative text to extract amendments
- Upload legal commentary for interpretations

Returns document ID for later parsing.
    """,
)
async def upload_document(
    file: UploadFile = File(..., description="Document file to upload"),
    document_type: Optional[str] = Form(None, description="Type: 'dottrina', 'manuale', 'sentenza', 'altro'"),
    legal_domain: Optional[str] = Form(None, description="Legal domain: 'civile', 'penale', etc."),
    title: Optional[str] = Form(None, description="Document title"),
    author: Optional[str] = Form(None, description="Author name"),
    publication_year: Optional[int] = Form(None, description="Publication year"),
    user_id: str = Form(..., description="Uploader user ID"),
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DocumentUploadResponse:
    """Upload document for later parsing."""
    log.info("API: upload_document", filename=file.filename, user_id=user_id)

    # Validate file extension
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type {file_ext} not allowed. Allowed: {ALLOWED_EXTENSIONS}",
        )

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Validate file size
    if file_size > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File too large ({file_size / 1024 / 1024:.1f}MB). Max: {MAX_FILE_SIZE_MB}MB",
        )

    # Calculate file hash (SHA-256) for deduplication
    file_hash = hashlib.sha256(content).hexdigest()

    # Check for duplicate
    stmt = select(UserDocument).where(UserDocument.file_hash == file_hash)
    result = await session.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        log.warning("Duplicate document detected", file_hash=file_hash, existing_id=existing.id)
        return DocumentUploadResponse(
            success=True,
            document_id=existing.id,
            message="Document already exists (duplicate detected)",
            duplicate=True,
        )

    # Generate unique filename
    unique_filename = f"{uuid4().hex}{file_ext}"
    storage_path = UPLOAD_DIR / unique_filename

    # Save file to disk
    with open(storage_path, "wb") as f:
        f.write(content)

    # Create database record
    doc = UserDocument(
        filename=unique_filename,
        original_filename=file.filename,
        file_type=file_ext.lstrip("."),
        file_size_bytes=file_size,
        file_hash=file_hash,
        storage_path=str(storage_path),
        document_type=document_type,
        legal_domain=legal_domain,
        title=title,
        author=author,
        publication_year=publication_year,
        uploaded_by=user_id,
        processing_status="uploaded",
    )

    session.add(doc)
    await session.commit()
    await session.refresh(doc)

    log.info("Document uploaded", document_id=doc.id, filename=unique_filename, size_mb=file_size / 1024 / 1024)

    return DocumentUploadResponse(
        success=True,
        document_id=doc.id,
        message=f"Document uploaded successfully ({file_size / 1024:.1f} KB)",
    )


# ====================================================
# DOCUMENT PARSING
# ====================================================
@router.post(
    "/{document_id}/parse",
    response_model=DocumentParseResponse,
    summary="Parse document to extract entities/amendments",
    description="""
Parse uploaded document using LLM to extract:
- Legal entities (concepts, principles, definitions)
- Semantic relations
- Amendments (multivigenza) if legislative text

Parsing strategy:
1. Extract text from PDF/DOCX
2. Chunk by sections/paragraphs
3. LLM extraction per chunk
4. Deduplication and linking
5. Create pending entities/amendments for validation

Returns extraction statistics.
    """,
)
async def parse_document(
    document_id: int,
    request: DocumentParseRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DocumentParseResponse:
    """Parse document to extract entities and amendments."""
    log.info("API: parse_document", document_id=document_id, user_id=request.user_id)

    # Get document
    stmt = select(UserDocument).where(UserDocument.id == document_id)
    result = await session.execute(stmt)
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    # Check if already parsed
    if doc.processing_status == "completed":
        return DocumentParseResponse(
            success=True,
            document_id=document_id,
            entities_extracted=doc.entities_extracted,
            relations_extracted=doc.relations_extracted,
            amendments_extracted=doc.amendments_extracted,
            message="Document already parsed",
        )

    # Update status to parsing
    doc.processing_status = "parsing"
    doc.processing_started_at = datetime.now()
    await session.commit()

    try:
        # Import parsing service
        from merlt.pipeline.document_parser import DocumentParserService

        parser = DocumentParserService()

        # Parse document
        parse_result = await parser.parse_document(
            document_path=doc.storage_path,
            file_type=doc.file_type,
            document_type=doc.document_type,
            legal_domain=doc.legal_domain,
            extract_entities=request.extract_entities,
            extract_amendments=request.extract_amendments,
            user_id=request.user_id,
            session=session,
        )

        # Update document with results
        doc.entities_extracted = parse_result.entities_count
        doc.relations_extracted = parse_result.relations_count
        doc.amendments_extracted = parse_result.amendments_count
        doc.processing_status = "completed"
        doc.processing_completed_at = datetime.now()

        log.info(
            f"🔄 Committing {parse_result.entities_count} entities + document update",
            document_id=document_id,
        )

        try:
            await session.commit()
            log.info("✅ FINAL COMMIT SUCCESS - All data saved to database")
        except Exception as e:
            log.error(f"❌ FINAL COMMIT FAILED: {e}", exc_info=True)
            raise

        log.info(
            "Document parsed successfully",
            document_id=document_id,
            entities=parse_result.entities_count,
            relations=parse_result.relations_count,
            amendments=parse_result.amendments_count,
        )

        return DocumentParseResponse(
            success=True,
            document_id=document_id,
            entities_extracted=parse_result.entities_count,
            relations_extracted=parse_result.relations_count,
            amendments_extracted=parse_result.amendments_count,
            message="Document parsed successfully",
        )

    except Exception as e:
        # Update status to failed
        doc.processing_status = "failed"
        doc.processing_error = str(e)
        await session.commit()

        log.error("Document parsing failed", document_id=document_id, error=str(e), exc_info=True)

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Parsing failed: {str(e)}",
        )


# ====================================================
# DOCUMENT INFO
# ====================================================
@router.get(
    "/{document_id}",
    response_model=DocumentInfo,
    summary="Get document information",
)
async def get_document_info(
    document_id: int,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DocumentInfo:
    """Get document metadata and processing status."""
    stmt = select(UserDocument).where(UserDocument.id == document_id)
    result = await session.execute(stmt)
    doc = result.scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")

    return DocumentInfo(
        id=doc.id,
        filename=doc.original_filename,
        file_type=doc.file_type,
        file_size_bytes=doc.file_size_bytes,
        document_type=doc.document_type,
        legal_domain=doc.legal_domain,
        title=doc.title,
        author=doc.author,
        publication_year=doc.publication_year,
        processing_status=doc.processing_status,
        processing_error=doc.processing_error,
        entities_extracted=doc.entities_extracted,
        relations_extracted=doc.relations_extracted,
        amendments_extracted=doc.amendments_extracted,
        uploaded_by=doc.uploaded_by,
        created_at=doc.created_at,
        processing_completed_at=doc.processing_completed_at,
    )


# ====================================================
# LIST DOCUMENTS
# ====================================================
@router.get(
    "",
    response_model=DocumentListResponse,
    summary="List user documents",
)
async def list_user_documents(
    user_id: str,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> DocumentListResponse:
    """List documents uploaded by user."""
    stmt = (
        select(UserDocument)
        .where(UserDocument.uploaded_by == user_id)
        .order_by(UserDocument.created_at.desc())
        .limit(limit)
        .offset(offset)
    )

    result = await session.execute(stmt)
    docs = result.scalars().all()

    # Convert to DocumentInfo
    documents = [
        DocumentInfo(
            id=doc.id,
            filename=doc.original_filename,
            file_type=doc.file_type,
            file_size_bytes=doc.file_size_bytes,
            document_type=doc.document_type,
            legal_domain=doc.legal_domain,
            title=doc.title,
            author=doc.author,
            publication_year=doc.publication_year,
            processing_status=doc.processing_status,
            processing_error=doc.processing_error,
            entities_extracted=doc.entities_extracted,
            relations_extracted=doc.relations_extracted,
            amendments_extracted=doc.amendments_extracted,
            uploaded_by=doc.uploaded_by,
            created_at=doc.created_at,
            processing_completed_at=doc.processing_completed_at,
        )
        for doc in docs
    ]

    return DocumentListResponse(
        documents=documents,
        total=len(documents),
        limit=limit,
        offset=offset,
    )


# ====================================================
# MANUAL AMENDMENT SUBMISSION
# ====================================================
@amendments_router.post(
    "/submit",
    response_model=AmendmentSubmissionResponse,
    summary="Submit amendment manually",
    description="""
Manually submit an amendment (multivigenza) for validation.

Use case:
- User identifies an amendment not in Normattiva
- User extracts amendment from legal commentary
- User corrects automatic extraction

Requires:
- Target article URN
- Modifying act details (estremi, disposizione)
- Amendment type (ABROGA, SOSTITUISCE, MODIFICA, INSERISCE)
    """,
)
async def submit_amendment(
    request: AmendmentSubmissionRequest,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> AmendmentSubmissionResponse:
    """Submit manual amendment for validation."""
    log.info(
        "API: submit_amendment",
        target_article=request.target_article_urn,
        user_id=request.user_id,
    )

    # Import parsing utilities from multivigenza pipeline
    from merlt.pipeline.multivigenza import parse_estremi, parse_disposizione

    # Parse estremi
    parsed_estremi = parse_estremi(request.atto_modificante_estremi)

    # Parse disposizione
    parsed_disp = parse_disposizione(request.disposizione)

    # Generate amendment ID
    amendment_id = f"amend:{request.target_article_urn.split('~')[-1]}:{uuid4().hex[:8]}"

    # Create pending amendment
    amendment = PendingAmendment(
        amendment_id=amendment_id,
        target_article_urn=request.target_article_urn,
        atto_modificante_urn=request.atto_modificante_urn,
        atto_modificante_estremi=request.atto_modificante_estremi,
        tipo_atto=parsed_estremi.get("tipo_atto"),
        tipo_documento=parsed_estremi.get("tipo_documento"),
        data_atto=parsed_estremi.get("data"),
        numero_atto=parsed_estremi.get("numero"),
        disposizione=request.disposizione,
        numero_articolo_disposizione=parsed_disp.get("numero_articolo"),
        commi_disposizione=parsed_disp.get("commi", []),
        lettere_disposizione=parsed_disp.get("lettere", []),
        numeri_disposizione=parsed_disp.get("numeri", []),
        tipo_modifica=request.tipo_modifica,
        data_pubblicazione_gu=request.data_pubblicazione_gu,
        data_efficacia=request.data_efficacia,
        source_type="manual",
        contributed_by=request.user_id,
        contributor_authority=request.contributor_authority or 0.5,
        validation_status="pending",
    )

    session.add(amendment)
    await session.commit()
    await session.refresh(amendment)

    log.info("Amendment submitted", amendment_id=amendment_id)

    return AmendmentSubmissionResponse(
        success=True,
        amendment_id=amendment_id,
        message="Amendment submitted for community validation",
    )


# ====================================================
# LIST PENDING AMENDMENTS
# ====================================================
@amendments_router.get(
    "",
    summary="List pending amendments",
)
async def list_pending_amendments(
    legal_domain: Optional[str] = None,
    validation_status: Optional[str] = "pending",
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_db_session_dependency),
    api_key: ApiKey = Depends(verify_api_key),
) -> List[PendingAmendmentInfo]:
    """List pending amendments for validation."""
    stmt = select(PendingAmendment).order_by(PendingAmendment.created_at.desc()).limit(limit).offset(offset)

    if validation_status:
        stmt = stmt.where(PendingAmendment.validation_status == validation_status)

    result = await session.execute(stmt)
    amendments = result.scalars().all()

    return [
        PendingAmendmentInfo(
            id=amend.id,
            amendment_id=amend.amendment_id,
            target_article_urn=amend.target_article_urn,
            atto_modificante_estremi=amend.atto_modificante_estremi,
            tipo_modifica=amend.tipo_modifica,
            disposizione=amend.disposizione,
            validation_status=amend.validation_status,
            approval_score=amend.approval_score,
            rejection_score=amend.rejection_score,
            votes_count=amend.votes_count,
            consensus_reached=amend.consensus_reached,
            contributed_by=amend.contributed_by,
            created_at=amend.created_at,
        )
        for amend in amendments
    ]


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "router",
    "amendments_router",
]
