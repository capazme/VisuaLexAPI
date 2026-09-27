"""Shared mutable context threaded through the flows.

flow_auth populates the three identities; later flows read/write captured
ids (urn_full, trace_id, jobId, documentId, pendingId, ...) via `captured`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .client import ApiClient
from .config import Config


@dataclass
class Context:
    cfg: Config
    admin: ApiClient
    user_a: ApiClient
    user_b: ApiClient
    captured: dict[str, Any] = field(default_factory=dict)

    def cap(self, key: str, value: Any) -> Any:
        self.captured[key] = value
        return value

    def get(self, key: str, default: Any = None) -> Any:
        return self.captured.get(key, default)
