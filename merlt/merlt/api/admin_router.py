"""Admin runtime-config API — read + live-tune the inference levers.

GET  /admin/config          → snapshot of every tunable param (spec + value).
PUT  /admin/config/{key}    → set one param (validated, applied to the live
                              engine when runtime-tunable). Admin-gated.

Runtime-tunable params (gating threshold, LLM max_tokens, max_experts,
disagreement gate) take effect on the NEXT query with no restart. Params flagged
`requires_restart` (which tools/router/ReAct are wired) store the intent but only
bite after a rebuild — the response echoes that flag so the UI can say so.
"""

from typing import Any, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from merlt.api.auth import verify_api_key
from merlt.config.runtime_config import get_runtime_config

log = structlog.get_logger()

router = APIRouter(prefix="/admin", tags=["Admin"])


class ConfigItem(BaseModel):
    key: str
    kind: str
    value: Any
    default: Any
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    description: str
    requires_restart: bool


class ConfigSnapshot(BaseModel):
    params: List[ConfigItem]


class ConfigUpdate(BaseModel):
    value: Any


@router.get("/config", response_model=ConfigSnapshot)
async def get_config(api_key=Depends(verify_api_key)):
    """Every tunable inference lever with its spec + current value."""
    return ConfigSnapshot(params=get_runtime_config().snapshot())


@router.put("/config/{key}", response_model=ConfigItem)
async def set_config(key: str, body: ConfigUpdate, api_key=Depends(verify_api_key)):
    """Set one runtime lever (validated + clamped + applied live where possible)."""
    try:
        item = get_runtime_config().set(key, body.value)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown config key: {key}")
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=f"invalid value for {key}: {e}")
    log.info(
        "admin config updated",
        key=key,
        value=item["value"],
        requires_restart=item["requires_restart"],
    )
    return ConfigItem(**item)


class ReinitResponse(BaseModel):
    reinitialized: bool
    engine: dict


@router.post("/engine/reinitialize", response_model=ReinitResponse)
async def reinitialize_engine(api_key=Depends(verify_api_key)):
    """Rebuild the Expert System from the CURRENT RuntimeConfig — applies the
    construction-time levers (which tools, ReAct, neural routing) WITHOUT a
    container restart. Builds the new orchestrator first, then atomically swaps
    the global, so there is no window with no engine. Reuses the live ai_service.
    """
    from merlt.api.experts_router import get_orchestrator, initialize_expert_system
    from merlt.api.engine_bootstrap import build_orchestrator, engine_state

    ai_service = None
    try:
        ai_service = getattr(get_orchestrator(), "ai_service", None)
    except Exception:
        ai_service = None
    if ai_service is None:
        from merlt.rlcf.ai_service import OpenRouterService
        ai_service = OpenRouterService()

    new_orch = await build_orchestrator(ai_service)  # build first (no downtime)
    initialize_expert_system(new_orch)               # atomic swap of the global
    state = engine_state(new_orch)
    log.info("engine reinitialized via admin", **state)
    return ReinitResponse(reinitialized=True, engine=state)
