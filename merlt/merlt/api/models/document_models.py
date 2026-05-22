"""
Pydantic Models for Document API
=================================

Request/response models for document upload and parsing endpoints.
"""

from datetime import datetime, date
from typing import List, Optional
from pydantic import BaseModel, Field


# ====================================================
# DOCUMENT UPLOAD
# ====================================================
class DocumentUploadResponse(BaseModel):
    """Response for document upload."""

    success: bool
    document_id: int
    message: str
    duplicate: bool = False


# ====================================================
# DOCUMENT PARSING
# ====================================================
class DocumentParseRequest(BaseModel):
    """Request to parse document."""

    user_id: str = Field(..., description="User ID requesting parse")
    extract_entities: bool = Field(True, description="Extract legal entities")
    extract_amendments: bool = Field(True, description="Extract amendments (multivigenza)")


class DocumentParseResponse(BaseModel):
    """Response for document parsing."""

    success: bool
    document_id: int
    entities_extracted: int = 0
    relations_extracted: int = 0
    amendments_extracted: int = 0
    message: str


# ====================================================
# DOCUMENT INFO
# ====================================================
class DocumentInfo(BaseModel):
    """Document metadata and status."""

    id: int
    filename: str
    file_type: str
    file_size_bytes: int
    document_type: Optional[str] = None
    legal_domain: Optional[str] = None
    title: Optional[str] = None
    author: Optional[str] = None
    publication_year: Optional[int] = None

    # Processing status
    processing_status: str  # 'uploaded' | 'parsing' | 'completed' | 'failed'
    processing_error: Optional[str] = None

    # Extraction results
    entities_extracted: int = 0
    relations_extracted: int = 0
    amendments_extracted: int = 0

    # Metadata
    uploaded_by: str
    created_at: datetime
    processing_completed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DocumentListResponse(BaseModel):
    """Response for listing documents."""

    documents: List[DocumentInfo]
    total: int
    limit: int
    offset: int


# ====================================================
# AMENDMENT SUBMISSION
# ====================================================
class AmendmentSubmissionRequest(BaseModel):
    """Request to manually submit an amendment."""

    # User
    user_id: str = Field(..., description="User ID submitting amendment")
    contributor_authority: Optional[float] = Field(None, description="User's authority (optional)")

    # Target article
    target_article_urn: str = Field(..., description="URN of article being modified")

    # Modifying act
    atto_modificante_urn: Optional[str] = Field(None, description="URN of modifying act (if known)")
    atto_modificante_estremi: str = Field(..., description="Estremi of modifying act (e.g., 'LEGGE 7 agosto 1990, n. 241')")

    # Disposizione (which part of modifying act)
    disposizione: str = Field(..., description="Disposizione (e.g., 'art. 12, comma 1, lettera b')")

    # Amendment type
    tipo_modifica: str = Field(..., description="Type: 'ABROGA' | 'SOSTITUISCE' | 'MODIFICA' | 'INSERISCE'")

    # Dates
    data_pubblicazione_gu: Optional[date] = Field(None, description="Gazzetta Ufficiale publication date")
    data_efficacia: Optional[date] = Field(None, description="Date when amendment takes effect")


class AmendmentSubmissionResponse(BaseModel):
    """Response for amendment submission."""

    success: bool
    amendment_id: str
    message: str


# ====================================================
# PENDING AMENDMENTS
# ====================================================
class PendingAmendmentInfo(BaseModel):
    """Info about pending amendment."""

    id: int
    amendment_id: str
    target_article_urn: str
    atto_modificante_estremi: str
    tipo_modifica: str
    disposizione: str

    # Validation status
    validation_status: str
    approval_score: float
    rejection_score: float
    votes_count: int
    consensus_reached: bool

    # Metadata
    contributed_by: str
    created_at: datetime

    class Config:
        from_attributes = True


# ====================================================
# EXPORTS
# ====================================================
__all__ = [
    "DocumentUploadResponse",
    "DocumentParseRequest",
    "DocumentParseResponse",
    "DocumentInfo",
    "DocumentListResponse",
    "AmendmentSubmissionRequest",
    "AmendmentSubmissionResponse",
    "PendingAmendmentInfo",
]
