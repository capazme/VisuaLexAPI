"""
PII Masking Service
====================

Masks personally identifiable information (PII) in feedback text
before database storage. Targets Italian PII patterns.

Patterns:
- Italian fiscal codes (codice fiscale): 16-char alphanumeric → [CF]
- Email addresses → [EMAIL]
- Dates (dd/mm/yyyy variants) → [DATA]
- Phone numbers (Italian format) → [TELEFONO]

Consent-level-aware:
- anonymous: no text stored at all (caller should skip)
- basic: masked text stored
- full/research: masked text stored (full masking applied)

Example:
    >>> from merlt.rlcf.pii_service import PIIMaskingService
    >>> svc = PIIMaskingService()
    >>> svc.mask_text("Contattare mario.rossi@email.it per info")
    'Contattare [EMAIL] per info'
"""

import re
import structlog
from typing import Optional

log = structlog.get_logger()

# Italian codice fiscale: 6 alpha + 2 digits + 1 alpha + 2 digits + 1 alpha + 3 digits + 1 alpha
CF_PATTERN = re.compile(
    r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b",
    re.IGNORECASE,
)

# Email addresses
EMAIL_PATTERN = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
)

# Dates: dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy (with optional 2-digit year)
DATE_PATTERN = re.compile(
    r"\b\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}\b"
)

# Italian phone numbers: +39, 0039, or local formats
PHONE_PATTERN = re.compile(
    r"(?:\+39|0039)?\s*(?:3[0-9]{2}|0[0-9]{1,3})\s*[\-\.]?\s*\d{3}\s*[\-\.]?\s*\d{3,4}\b"
)


class PIIMaskingService:
    """Masks PII in text for GDPR-compliant feedback storage."""

    def mask_text(self, text: Optional[str]) -> Optional[str]:
        """
        Apply all PII masks to input text.

        Args:
            text: Raw text that may contain PII

        Returns:
            Text with PII patterns replaced by placeholders, or None if input is None
        """
        if not text:
            return text

        masked = text
        replacements = 0

        # Order matters: CF first (most specific), then email, phone, dates
        masked, n = CF_PATTERN.subn("[CF]", masked)
        replacements += n

        masked, n = EMAIL_PATTERN.subn("[EMAIL]", masked)
        replacements += n

        masked, n = PHONE_PATTERN.subn("[TELEFONO]", masked)
        replacements += n

        masked, n = DATE_PATTERN.subn("[DATA]", masked)
        replacements += n

        if replacements > 0:
            log.debug("PII masked", replacements=replacements)

        return masked

    def should_store_text(self, consent_level: str) -> bool:
        """
        Check if text should be stored based on consent level.

        Args:
            consent_level: anonymous, basic, or full

        Returns:
            True if masked text should be stored
        """
        return consent_level != "anonymous"
