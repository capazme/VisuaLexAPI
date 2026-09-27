"""Central configuration for the E2E + stress harness.

Every knob is env-overridable; nothing here touches the app codebase.
ADMIN_PASSWORD is required for any authenticated flow (validated lazily,
not at import time, so `--preflight-only` partial runs still work).
"""
from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Config:
    # --- base URLs ---
    py_api: str = field(default_factory=lambda: _env("E2E_PY_API", "http://localhost:5000"))
    bff: str = field(default_factory=lambda: _env("E2E_BFF", "http://localhost:3001/api"))
    merlt: str = field(default_factory=lambda: _env("E2E_MERLT", "http://localhost:8000"))
    frontend: str = field(default_factory=lambda: _env("E2E_FRONTEND", "http://localhost:5173"))

    # --- identities ---
    admin_email: str = field(default_factory=lambda: _env("E2E_ADMIN_EMAIL", _env("ADMIN_EMAIL", "admin@visualex.it")))
    admin_password: str = field(default_factory=lambda: _env("E2E_ADMIN_PASSWORD", _env("ADMIN_PASSWORD", "")))
    user_password: str = field(default_factory=lambda: _env("E2E_USER_PASSWORD", "E2ePass1x"))

    # --- secrets (optional; enable extra negative probes) ---
    merlt_internal_secret: str = field(default_factory=lambda: _env("MERLT_INTERNAL_SECRET", ""))

    # --- timeouts (seconds) ---
    default_timeout: float = field(default_factory=lambda: _env_float("E2E_DEFAULT_TIMEOUT", 15.0))
    search_timeout: float = field(default_factory=lambda: _env_float("E2E_SEARCH_TIMEOUT", 60.0))
    qa_timeout: float = field(default_factory=lambda: _env_float("E2E_QA_TIMEOUT", 180.0))
    pdf_timeout: float = field(default_factory=lambda: _env_float("E2E_PDF_TIMEOUT", 90.0))

    # --- polling ---
    poll_interval: float = field(default_factory=lambda: _env_float("E2E_POLL_INTERVAL", 2.0))
    ingest_poll_max: float = field(default_factory=lambda: _env_float("E2E_INGEST_POLL_MAX", 120.0))
    extract_poll_max: float = field(default_factory=lambda: _env_float("E2E_EXTRACT_POLL_MAX", 300.0))
    ner_train_poll_max: float = field(default_factory=lambda: _env_float("E2E_NER_TRAIN_POLL_MAX", 600.0))

    # --- stress defaults (guardrails hardcoded in stress.py) ---
    stress_users: int = field(default_factory=lambda: int(_env("E2E_STRESS_USERS", "10")))
    stress_duration: float = field(default_factory=lambda: _env_float("E2E_STRESS_DURATION", 60.0))

    # --- run identity: namespaces every created entity ---
    run_id: str = field(default_factory=lambda: _env("E2E_RUN_ID", uuid.uuid4().hex[:8]))

    def require_admin_password(self) -> str:
        if not self.admin_password:
            raise SystemExit(
                "E2E_ADMIN_PASSWORD (o ADMIN_PASSWORD) non impostata - "
                "serve la password dell'admin seedato per creare gli utenti di test.\n"
                "Esempio: E2E_ADMIN_PASSWORD='...' python -m e2e.runner"
            )
        return self.admin_password


CONFIG = Config()
