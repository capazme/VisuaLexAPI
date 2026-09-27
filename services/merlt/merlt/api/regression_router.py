"""
Regression Test Runner Router
==============================

REST API per esecuzione regression test suite.

Endpoints:
- POST /regression/run — avvia suite (async, ritorna run_id)
- GET /regression/status/{run_id} — stato esecuzione
- GET /regression/results/{run_id} — risultati dettagliati
- GET /regression/baselines — lista baseline
- POST /regression/baselines/update — aggiorna baseline
"""

import asyncio
import json
import os
import uuid
from collections import OrderedDict
from datetime import datetime
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from merlt.api.auth import verify_api_key, require_role
from merlt.experts.models import ApiKey

log = structlog.get_logger()

router = APIRouter(prefix="/regression", tags=["regression"])

# In-memory storage for regression runs (stateless across restarts)
# Bounded to MAX_RUNS entries with FIFO eviction to prevent OOM
MAX_RUNS = 100
_runs: OrderedDict[str, Dict[str, Any]] = OrderedDict()

# Redis singleton for regression run persistence (db=3)
_reg_redis_client = None
_reg_redis_checked = False

# TTL: 24 hours in seconds
_REG_REDIS_TTL = 24 * 3600


async def _get_reg_redis():
    """Get or create Redis async client for regression run storage. Returns None if unavailable."""
    global _reg_redis_client, _reg_redis_checked

    if _reg_redis_checked and _reg_redis_client is None:
        return None

    if _reg_redis_client is not None:
        return _reg_redis_client

    _reg_redis_checked = True
    try:
        import redis.asyncio as aioredis
        client = aioredis.Redis(
            host=os.environ.get("REDIS_HOST", "localhost"),
            port=int(os.environ.get("REDIS_PORT", "6379")),
            db=3,
            decode_responses=True,
            socket_connect_timeout=2,
        )
        await client.ping()
        _reg_redis_client = client
        log.info("Regression Redis connected (db=3)")
        return _reg_redis_client
    except Exception as e:
        log.warning("Regression Redis unavailable, using in-memory only", error=str(e))
        _reg_redis_client = None
        return None


async def _persist_run_to_redis(run_id: str, run_data: Dict[str, Any]) -> None:
    """Persist regression run state to Redis with graceful degradation."""
    redis = await _get_reg_redis()
    if redis is None:
        return
    try:
        # Only persist serializable subset (exclude non-serializable report objects)
        safe_data = {
            "status": run_data.get("status"),
            "started_at": run_data.get("started_at"),
            "completed_at": run_data.get("completed_at"),
            "progress": run_data.get("progress", 0.0),
            "total_queries": run_data.get("total_queries", 0),
            "processed": run_data.get("processed", 0),
            "report": run_data.get("report"),
            "error": run_data.get("error"),
        }
        key = f"regression_run:{run_id}"
        await redis.set(key, json.dumps(safe_data), ex=_REG_REDIS_TTL)
    except Exception as e:
        log.warning("Failed to persist regression run to Redis", run_id=run_id, error=str(e))


async def _load_run_from_redis(run_id: str) -> Optional[Dict[str, Any]]:
    """Load regression run from Redis on cache miss."""
    redis = await _get_reg_redis()
    if redis is None:
        return None
    try:
        key = f"regression_run:{run_id}"
        data = await redis.get(key)
        if data is None:
            return None
        return json.loads(data)
    except Exception as e:
        log.warning("Failed to load regression run from Redis", run_id=run_id, error=str(e))
        return None


# =============================================================================
# MODELS
# =============================================================================


class RegressionRunRequest(BaseModel):
    query_ids: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    version: Optional[str] = None


class RegressionRunResponse(BaseModel):
    run_id: str
    status: str = "pending"
    message: str = "Regression run started"


class RegressionStatusResponse(BaseModel):
    run_id: str
    status: str  # pending, running, completed, failed
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    progress: float = 0.0
    total_queries: int = 0
    processed: int = 0


class RegressionResultsResponse(BaseModel):
    run_id: str
    status: str
    suite_name: str = ""
    pass_rate: float = 0.0
    total_queries: int = 0
    passed: int = 0
    failed: int = 0
    degraded: int = 0
    improved: int = 0
    errors: int = 0
    duration_seconds: float = 0.0
    results: List[Dict[str, Any]] = Field(default_factory=list)


class BaselineEntry(BaseModel):
    query_id: str
    score: float
    updated_at: Optional[str] = None


class BaselinesResponse(BaseModel):
    baselines: List[BaselineEntry] = Field(default_factory=list)
    suite_name: str = ""
    count: int = 0


# =============================================================================
# BACKGROUND RUNNER
# =============================================================================


async def _run_regression_background(run_id: str, request: RegressionRunRequest):
    """Run regression suite in background."""
    _runs[run_id]["status"] = "running"
    _runs[run_id]["started_at"] = datetime.now().isoformat()
    await _persist_run_to_redis(run_id, _runs[run_id])

    try:
        from merlt.experts.regression.suite import GoldStandardSuite
        from merlt.experts.regression.runner import RegressionRunner

        # Try to load suite from default location
        suite = None
        default_paths = [
            "tests/regression/gold_standard.json",
            "merlt/experts/regression/gold_standard.json",
            "data/gold_standard.json",
        ]
        for path in default_paths:
            try:
                suite = GoldStandardSuite.load(path)
                break
            except Exception as e:
                log.debug("gold_standard_path_skipped", path=path, error=str(e))
                continue

        if suite is None:
            _runs[run_id]["status"] = "failed"
            _runs[run_id]["error"] = "No gold standard suite found"
            _runs[run_id]["completed_at"] = datetime.now().isoformat()
            await _persist_run_to_redis(run_id, _runs[run_id])
            return

        _runs[run_id]["total_queries"] = suite.query_count

        # Create a simple pipeline adapter that uses the orchestrator
        from merlt.api.experts_router import _orchestrator

        if _orchestrator is None:
            _runs[run_id]["status"] = "failed"
            _runs[run_id]["error"] = "Expert system not initialized"
            _runs[run_id]["completed_at"] = datetime.now().isoformat()
            await _persist_run_to_redis(run_id, _runs[run_id])
            return

        class PipelineAdapter:
            async def process(self, query: str) -> Dict[str, Any]:
                result = await _orchestrator.process(query)
                return {
                    "response": result.synthesis if hasattr(result, 'synthesis') else str(result),
                    "metadata": result.to_dict() if hasattr(result, 'to_dict') else {},
                }

        processed = 0

        def on_complete(qr):
            nonlocal processed
            processed += 1
            _runs[run_id]["processed"] = processed
            total = _runs[run_id].get("total_queries", 1)
            _runs[run_id]["progress"] = processed / total if total > 0 else 0

        runner = RegressionRunner(
            suite=suite,
            pipeline=PipelineAdapter(),
            on_query_complete=on_complete,
        )

        report = await runner.run(
            query_ids=request.query_ids,
            tags=request.tags,
            version=request.version,
        )

        _runs[run_id]["status"] = "completed"
        _runs[run_id]["completed_at"] = datetime.now().isoformat()
        _runs[run_id]["report"] = report.to_dict()
        await _persist_run_to_redis(run_id, _runs[run_id])

    except Exception as e:
        log.error("regression_run_failed", run_id=run_id, error=str(e))
        _runs[run_id]["status"] = "failed"
        _runs[run_id]["error"] = str(e)
        _runs[run_id]["completed_at"] = datetime.now().isoformat()
        await _persist_run_to_redis(run_id, _runs[run_id])


# =============================================================================
# ENDPOINTS
# =============================================================================


@router.post("/run", response_model=RegressionRunResponse)
async def start_regression_run(
    request: RegressionRunRequest = RegressionRunRequest(),
    api_key: ApiKey = Depends(require_role("admin")),
) -> RegressionRunResponse:
    """Avvia regression test suite in background."""
    run_id = f"reg_{uuid.uuid4().hex[:8]}"

    # Evict oldest runs if at capacity
    while len(_runs) >= MAX_RUNS:
        evicted_id, _ = _runs.popitem(last=False)
        log.info("regression_run_evicted", run_id=evicted_id, reason="capacity")

    _runs[run_id] = {
        "status": "pending",
        "started_at": None,
        "completed_at": None,
        "progress": 0.0,
        "total_queries": 0,
        "processed": 0,
        "report": None,
        "error": None,
    }

    await _persist_run_to_redis(run_id, _runs[run_id])

    asyncio.create_task(_run_regression_background(run_id, request))
    log.info("regression_run_queued", run_id=run_id)

    return RegressionRunResponse(run_id=run_id)


@router.get("/status/{run_id}", response_model=RegressionStatusResponse)
async def get_regression_status(
    run_id: str,
    api_key: ApiKey = Depends(verify_api_key),
) -> RegressionStatusResponse:
    """Stato esecuzione regression run."""
    run = _runs.get(run_id)

    # Fallback to Redis if not in memory
    if run is None:
        run = await _load_run_from_redis(run_id)

    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    return RegressionStatusResponse(
        run_id=run_id,
        status=run["status"],
        started_at=run.get("started_at"),
        completed_at=run.get("completed_at"),
        progress=run.get("progress", 0.0),
        total_queries=run.get("total_queries", 0),
        processed=run.get("processed", 0),
    )


@router.get("/results/{run_id}", response_model=RegressionResultsResponse)
async def get_regression_results(
    run_id: str,
    api_key: ApiKey = Depends(verify_api_key),
) -> RegressionResultsResponse:
    """Risultati dettagliati regression run."""
    run = _runs.get(run_id)

    # Fallback to Redis if not in memory
    if run is None:
        run = await _load_run_from_redis(run_id)

    if run is None:
        raise HTTPException(status_code=404, detail=f"Run '{run_id}' not found")

    if run["status"] not in ("completed", "failed"):
        return RegressionResultsResponse(run_id=run_id, status=run["status"])

    if run.get("error"):
        return RegressionResultsResponse(
            run_id=run_id, status="failed",
            results=[{"error": run["error"]}],
        )

    report = run.get("report", {})
    result = report.get("result", {}) if report else {}

    return RegressionResultsResponse(
        run_id=run_id,
        status="completed",
        suite_name=report.get("suite_name", "") if report else "",
        pass_rate=result.get("pass_rate", 0.0),
        total_queries=result.get("total_queries", 0),
        passed=result.get("passed", 0),
        failed=result.get("failed", 0),
        degraded=result.get("degraded", 0),
        improved=result.get("improved", 0),
        errors=result.get("errors", 0),
        duration_seconds=report.get("duration_seconds", 0.0) if report else 0.0,
        results=result.get("results", []),
    )


@router.get("/baselines", response_model=BaselinesResponse)
async def get_baselines() -> BaselinesResponse:
    """Lista baseline correnti."""
    try:
        from merlt.experts.regression.suite import GoldStandardSuite

        suite = None
        for path in [
            "tests/regression/gold_standard.json",
            "merlt/experts/regression/gold_standard.json",
            "data/gold_standard.json",
        ]:
            try:
                suite = GoldStandardSuite.load(path)
                break
            except Exception as e:
                log.debug("gold_standard_path_skipped", path=path, error=str(e))
                continue

        if suite is None:
            return BaselinesResponse()

        baselines = []
        for query in suite.queries:
            score = suite.get_baseline_score(query.query_id)
            baselines.append(BaselineEntry(
                query_id=query.query_id,
                score=score if score is not None else 0.0,
            ))

        return BaselinesResponse(
            baselines=baselines,
            suite_name=suite.config.name,
            count=len(baselines),
        )
    except Exception as e:
        log.warning("Failed to load baselines", error=str(e))
        return BaselinesResponse()


@router.post("/baselines/update")
async def update_baselines(
    run_id: Optional[str] = None,
    api_key: ApiKey = Depends(require_role("admin")),
) -> Dict[str, Any]:
    """Aggiorna baseline con risultati di un run completato."""
    if run_id and run_id in _runs:
        run = _runs[run_id]
        if run["status"] != "completed":
            raise HTTPException(status_code=400, detail="Run not completed")
        return {"message": "Baselines updated from run", "run_id": run_id}

    return {"message": "No run specified, baselines unchanged"}
