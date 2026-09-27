"""GET /api/v1/rlcf/policies/history reads the versions the training writes.

The endpoint used to call ``RLCFPersistence().list_checkpoints`` (a method
that never existed, on a model without ``gating_weights``), swallow the
AttributeError at debug level and answer ``{history: [], epochs: []}`` for
ever. It now lists ``weight_versions`` for the scheduler's experiment through
``WeightStore.list_versions`` and projects each row with the same
``_config_to_status`` that ``/policies/weights`` uses.

The projection and the router are exercised with fake rows (pure python); the
store listing runs against the RLCF Postgres when ``RLCF_ASYNC_DATABASE_URL``
is set (CI sets it), and is skipped otherwise.
"""

from __future__ import annotations

import importlib
import os
import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from merlt.weights.config import GatingWeights, LearnableWeight, ToolGatingWeights, WeightConfig
from merlt.weights.store import WeightStore

rr = importlib.import_module("merlt.api.rlcf_router")

API_KEY = SimpleNamespace(user_id="admin", role="admin")


def _config(literal: float, systemic: float, tool: float | None = None) -> WeightConfig:
    cfg = WeightConfig(
        gating=GatingWeights(
            expert_priors={
                "LiteralExpert": LearnableWeight(default=literal),
                "SystemicExpert": LearnableWeight(default=systemic),
            }
        )
    )
    if tool is not None:
        cfg.tool_gating = ToolGatingWeights(tool_priors={"search_norms": LearnableWeight(default=tool)})
    return cfg


def _row(config_json, created_at, row_id=None):
    return SimpleNamespace(
        id=row_id or str(uuid.uuid4()),
        config_json=config_json,
        created_at=created_at,
        is_active=False,
    )


# ---------------------------------------------------------------------------
# projection shared by /policies/weights and /policies/history
# ---------------------------------------------------------------------------

def test_config_to_status_uses_the_short_expert_names_and_tool_priors():
    status = rr._config_to_status(_config(0.4, 0.2, tool=0.7), "2026-01-01T00:00:00")

    assert status is not None
    assert status.gating == {"literal": 0.4, "systemic": 0.2}
    assert status.tool_gating == {"search_norms": 0.7}
    assert status.traversal == rr._TRAVERSAL_SUMMARY
    assert status.timestamp == "2026-01-01T00:00:00"


def test_config_without_priors_projects_to_none():
    # WeightConfig() itself carries the uniform 0.25 priors: only an EMPTY
    # priors map (or no config at all) means "nothing learned".
    assert rr._config_to_status(WeightConfig(gating=GatingWeights(expert_priors={})), None) is None
    assert rr._config_to_status(None, None) is None


def test_experiment_id_falls_back_to_the_scheduler_default(monkeypatch):
    monkeypatch.setattr(rr, "_get_scheduler", lambda: None)
    assert rr._resolve_experiment_id() == rr.DEFAULT_EXPERIMENT_ID

    monkeypatch.setattr(
        rr, "_get_scheduler", lambda: SimpleNamespace(config=SimpleNamespace(experiment_id="exp-9"))
    )
    assert rr._resolve_experiment_id() == "exp-9"


# ---------------------------------------------------------------------------
# the endpoint over fake rows
# ---------------------------------------------------------------------------

async def test_history_is_empty_without_a_database(monkeypatch):
    monkeypatch.delenv("RLCF_DATABASE_URL", raising=False)
    listed = AsyncMock()
    monkeypatch.setattr(WeightStore, "list_versions", listed)

    out = await rr.get_policy_history(limit=50, api_key=API_KEY)

    assert out.history == [] and out.epochs == []
    listed.assert_not_awaited()


async def test_history_returns_versions_in_chronological_order(monkeypatch):
    monkeypatch.setenv("RLCF_DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(rr, "_get_scheduler", lambda: None)
    store = WeightStore(database_url="postgresql://unused")
    t0 = datetime(2026, 1, 1, 12, 0, 0)
    rows_newest_first = [
        _row(store._config_to_dict(_config(0.5, 0.1)), t0 + timedelta(hours=1)),
        _row(store._config_to_dict(_config(0.3, 0.3)), t0),
    ]
    listed = AsyncMock(return_value=rows_newest_first)
    monkeypatch.setattr(WeightStore, "list_versions", listed)

    out = await rr.get_policy_history(limit=7, api_key=API_KEY)

    listed.assert_awaited_once_with(experiment_id=rr.DEFAULT_EXPERIMENT_ID, limit=7)
    assert out.epochs == [1, 2]
    assert [h.gating["literal"] for h in out.history] == [0.3, 0.5]
    assert out.history[0].timestamp == t0.isoformat()


async def test_one_unreadable_row_does_not_empty_the_history(monkeypatch):
    monkeypatch.setenv("RLCF_DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(rr, "_get_scheduler", lambda: None)
    store = WeightStore(database_url="postgresql://unused")
    rows = [
        _row(store._config_to_dict(_config(0.6, 0.2)), datetime(2026, 1, 3)),
        _row({"gating": {"expert_priors": "not-a-mapping"}}, datetime(2026, 1, 2)),
        _row(None, datetime(2026, 1, 1)),
    ]
    monkeypatch.setattr(WeightStore, "list_versions", AsyncMock(return_value=rows))

    out = await rr.get_policy_history(limit=50, api_key=API_KEY)

    assert out.epochs == [1]
    assert out.history[0].gating == {"literal": 0.6, "systemic": 0.2}


async def test_a_store_failure_is_logged_and_answers_empty(monkeypatch):
    monkeypatch.setenv("RLCF_DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(rr, "_get_scheduler", lambda: None)
    monkeypatch.setattr(WeightStore, "list_versions", AsyncMock(side_effect=RuntimeError("db down")))

    out = await rr.get_policy_history(limit=50, api_key=API_KEY)

    assert out.history == [] and out.epochs == []


# ---------------------------------------------------------------------------
# the store listing against the RLCF database
# ---------------------------------------------------------------------------

@pytest.mark.skipif(
    not os.environ.get("RLCF_ASYNC_DATABASE_URL"),
    reason="needs the RLCF Postgres (RLCF_ASYNC_DATABASE_URL)",
)
async def test_list_versions_returns_every_saved_version_newest_first():
    from merlt.rlcf import database as rlcf_db

    await rlcf_db.init_async_db()  # creates weight_versions on a fresh database
    store = WeightStore(database_url=os.environ["RLCF_ASYNC_DATABASE_URL"])
    experiment_id = f"exp-history-{uuid.uuid4().hex[:8]}"

    first = await store.save_weights(_config(0.3, 0.3), experiment_id=experiment_id)
    second = await store.save_weights(_config(0.5, 0.1), experiment_id=experiment_id)

    rows = await store.list_versions(experiment_id=experiment_id, limit=10)

    assert [r.id for r in rows] == [second, first]
    assert [r.is_active for r in rows] == [True, False]
    assert store.parse_config(rows[1].config_json).gating.expert_priors["LiteralExpert"].default == 0.3
    # ORM rows from different sessions compare by identity: compare ids.
    assert [r.id for r in await store.list_versions(experiment_id=experiment_id, limit=1)] == [second]
    assert await store.list_versions(experiment_id="exp-nobody", limit=10) == []
