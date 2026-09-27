"""
Temporal Validity Module
========================

Verifica la vigenza temporale delle norme citate nei trace MERL-T.

Components:
- TemporalValidityService: Verifica vigenza via FalkorDB
- ValidityResult: Risultato per singola norma
- ValiditySummary: Summary aggregato per un trace

Usage:
    from merlt.storage.temporal import TemporalValidityService

    service = TemporalValidityService(graph_db=falkordb_client)
    result = await service.check_validity("urn:nir:stato:codice.penale:1930;art52")
"""

from .validity_service import TemporalValidityService, ValidityResult, ValiditySummary

__all__ = [
    "TemporalValidityService",
    "ValidityResult",
    "ValiditySummary",
]
