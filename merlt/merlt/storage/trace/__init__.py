"""
Trace Storage Module
====================

Persistent storage for MERL-T pipeline traces with consent-aware filtering.

Components:
- TraceStorageService: CRUD operations for qa_traces
- TraceStorageConfig: Connection configuration

Features:
- Consent-based data filtering (anonymous, basic, full)
- Query-type filtering and pagination
- Archival and GDPR deletion support
- Source resolution via bridge_table

Usage:
    from merlt.storage.trace import TraceStorageService, TraceStorageConfig

    service = TraceStorageService(TraceStorageConfig())
    await service.connect()

    # Save trace
    trace_id = await service.save_trace(trace)

    # Get with consent filtering
    trace = await service.get_trace(trace_id, consent_level="basic")

    # List with filters
    traces = await service.list_traces(
        user_id="user123",
        query_type="definitional",
        limit=20
    )

    await service.close()
"""

from .trace_service import TraceStorageService, TraceStorageConfig

__all__ = [
    "TraceStorageService",
    "TraceStorageConfig",
]
