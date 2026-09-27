"""
Circuit Breaker Admin Router
=============================

REST API per gestione circuit breaker del sistema Expert.

Endpoints:
- GET /circuit-breaker/status — stato di tutti i breaker
- GET /circuit-breaker/{expert_type} — stato + stats di un breaker specifico
- PUT /circuit-breaker/{expert_type}/config — aggiorna thresholds
- POST /circuit-breaker/{expert_type}/reset — reset manuale
"""

from typing import Any, Dict, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.circuit_breaker import CircuitBreakerRegistry
from merlt.experts.models import ApiKey

log = structlog.get_logger()

router = APIRouter(prefix="/circuit-breaker", tags=["circuit-breaker"])


# =============================================================================
# MODELS
# =============================================================================


class CircuitBreakerStatusItem(BaseModel):
    name: str
    state: str
    failure_count: int = 0
    success_count: int = 0
    last_failure_time: Optional[str] = None
    last_success_time: Optional[str] = None
    times_opened: int = 0
    total_failures: int = 0
    total_successes: int = 0
    state_changed_at: Optional[str] = None


class CircuitBreakerStatusResponse(BaseModel):
    breakers: Dict[str, CircuitBreakerStatusItem] = Field(default_factory=dict)
    total_count: int = 0
    open_count: int = 0


class CircuitBreakerConfigUpdate(BaseModel):
    failure_threshold: Optional[int] = Field(None, ge=1, le=50)
    recovery_timeout_seconds: Optional[float] = Field(None, ge=5, le=600)


class CircuitBreakerResetResponse(BaseModel):
    name: str
    previous_state: str
    current_state: str = "closed"
    message: str = "Circuit breaker reset successfully"


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.get("/status", response_model=CircuitBreakerStatusResponse)
async def get_all_status(
    api_key: ApiKey = Depends(verify_api_key),
) -> CircuitBreakerStatusResponse:
    """Stato di tutti i circuit breaker registrati."""
    registry = CircuitBreakerRegistry.get_instance()
    all_stats = registry.get_all_stats()
    open_circuits = registry.get_open_circuits()

    breakers = {}
    for name, stats in all_stats.items():
        breakers[name] = CircuitBreakerStatusItem(**stats.to_dict())

    return CircuitBreakerStatusResponse(
        breakers=breakers,
        total_count=len(breakers),
        open_count=len(open_circuits),
    )


@router.get("/{expert_type}", response_model=CircuitBreakerStatusItem)
async def get_breaker_status(
    expert_type: str,
    api_key: ApiKey = Depends(verify_api_key),
) -> CircuitBreakerStatusItem:
    """Stato e stats di un circuit breaker specifico."""
    registry = CircuitBreakerRegistry.get_instance()
    breaker = registry.get(f"{expert_type}_expert")
    if breaker is None:
        # Try without _expert suffix
        breaker = registry.get(expert_type)
    if breaker is None:
        raise HTTPException(status_code=404, detail=f"Circuit breaker '{expert_type}' not found")

    stats = breaker.get_stats()
    return CircuitBreakerStatusItem(**stats.to_dict())


@router.put("/{expert_type}/config")
async def update_breaker_config(
    expert_type: str,
    update: CircuitBreakerConfigUpdate,
    api_key: ApiKey = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Aggiorna configurazione di un circuit breaker."""
    registry = CircuitBreakerRegistry.get_instance()
    breaker = registry.get(f"{expert_type}_expert") or registry.get(expert_type)
    if breaker is None:
        raise HTTPException(status_code=404, detail=f"Circuit breaker '{expert_type}' not found")

    changed = {}
    if update.failure_threshold is not None:
        breaker._config.failure_threshold = update.failure_threshold
        changed["failure_threshold"] = update.failure_threshold
    if update.recovery_timeout_seconds is not None:
        breaker._config.recovery_timeout_seconds = update.recovery_timeout_seconds
        changed["recovery_timeout_seconds"] = update.recovery_timeout_seconds

    log.info("circuit_breaker_config_updated", expert=expert_type, changes=changed)
    return {"expert_type": expert_type, "updated": changed}


@router.post("/{expert_type}/reset", response_model=CircuitBreakerResetResponse)
async def reset_breaker(
    expert_type: str,
    api_key: ApiKey = Depends(require_role("admin")),
) -> CircuitBreakerResetResponse:
    """Reset manuale di un circuit breaker."""
    registry = CircuitBreakerRegistry.get_instance()
    breaker = registry.get(f"{expert_type}_expert") or registry.get(expert_type)
    if breaker is None:
        raise HTTPException(status_code=404, detail=f"Circuit breaker '{expert_type}' not found")

    previous_state = breaker.state.value
    breaker.reset()
    log.info("circuit_breaker_admin_reset", expert=expert_type, previous_state=previous_state)

    return CircuitBreakerResetResponse(
        name=breaker.name,
        previous_state=previous_state,
    )
