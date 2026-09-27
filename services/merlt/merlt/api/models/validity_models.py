"""
Validity API Models
====================

Pydantic models condivisi tra validity_router e trace_router
per le verifiche di vigenza temporale delle norme.
"""

from typing import Optional, List

from pydantic import BaseModel, Field


class ValidityResultResponse(BaseModel):
    """Risultato verifica vigenza per singola norma."""
    urn: str
    status: str
    is_valid: bool
    warning_level: str
    warning_message: Optional[str] = None
    last_modified: Optional[str] = None
    modification_count: int = 0
    abrogating_norm: Optional[dict] = None
    replacing_norm: Optional[dict] = None
    recent_modifications: List[dict] = Field(default_factory=list)
    checked_at: str


class ValiditySummaryBrief(BaseModel):
    """Summary breve per batch check."""
    total: int
    valid: int
    warnings: int
    critical: int
    unknown: int = 0
    message: Optional[str] = None


class ValidityCheckResponse(BaseModel):
    """Response per endpoint /api/validity/check."""
    results: List[ValidityResultResponse]
    summary: ValiditySummaryBrief
    as_of_date: Optional[str] = None
    checked_at: str


class ValiditySummaryResponse(BaseModel):
    """Summary vigenza per un trace (endpoint /api/traces/{id}/validity)."""
    trace_id: str
    as_of_date: Optional[str] = None
    total_sources: int
    valid_count: int
    warning_count: int
    critical_count: int
    unknown_count: int = 0
    results: List[ValidityResultResponse]
    summary_message: Optional[str] = None
