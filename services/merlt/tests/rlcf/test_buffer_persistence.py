"""RLCF replay buffer persistence (TrainingScheduler).

The buffer file must live on a writable, durable path (MERLT_RLCF_BUFFER_PATH,
default under checkpoints/), be written by add_experience() with a debounce,
atomically, and never raise when the path is unusable.
"""

from __future__ import annotations

import asyncio
import json
import time

from merlt.rlcf.training_scheduler import (
    DEFAULT_BUFFER_PERSISTENCE_PATH,
    SchedulerConfig,
    TrainingScheduler,
)


def _trace(n: int = 0) -> dict:
    return {"query_id": f"trace_{n}", "actions": [], "metadata": {}}


def _feedback(n: int = 0) -> dict:
    return {"query_id": f"trace_{n}", "metadata": {}}


def _scheduler(path, **overrides) -> TrainingScheduler:
    config = SchedulerConfig(
        buffer_persistence_path=str(path) if path is not None else None,
        buffer_save_every_n=overrides.pop("every_n", 1000),
        buffer_save_interval_seconds=overrides.pop("interval", 3600.0),
        **overrides,
    )
    return TrainingScheduler(config)


def _add(scheduler: TrainingScheduler, n: int) -> str:
    return scheduler.add_experience(
        trace=_trace(n), feedback=_feedback(n), reward=0.5, metadata={"feedback_id": n}
    )


def _saved_ids(path) -> list:
    data = json.loads(path.read_text())
    return sorted(e["metadata"]["feedback_id"] for e in data["experiences"])


# ---------------------------------------------------------------------------
# path configuration
# ---------------------------------------------------------------------------

def test_path_defaults_under_checkpoints(monkeypatch):
    monkeypatch.delenv("MERLT_RLCF_BUFFER_PATH", raising=False)
    assert SchedulerConfig().buffer_persistence_path == DEFAULT_BUFFER_PERSISTENCE_PATH
    assert DEFAULT_BUFFER_PERSISTENCE_PATH.startswith("checkpoints/")


def test_path_comes_from_env(monkeypatch, tmp_path):
    target = tmp_path / "buf.json"
    monkeypatch.setenv("MERLT_RLCF_BUFFER_PATH", str(target))
    assert SchedulerConfig().buffer_persistence_path == str(target)


def test_empty_env_disables_persistence(monkeypatch):
    monkeypatch.setenv("MERLT_RLCF_BUFFER_PATH", "  ")
    assert SchedulerConfig().buffer_persistence_path is None


# ---------------------------------------------------------------------------
# saving
# ---------------------------------------------------------------------------

def test_saved_buffer_survives_a_new_scheduler(tmp_path):
    path = tmp_path / "rlcf" / "replay_buffer.json"
    first = _scheduler(path, every_n=2)
    _add(first, 1)
    _add(first, 2)
    assert path.exists()

    second = _scheduler(path)
    assert len(second.buffer) == 2
    assert second.buffered_feedback_ids() == {1, 2}


def test_saves_are_debounced_by_count(tmp_path):
    path = tmp_path / "buf.json"
    scheduler = _scheduler(path, every_n=3)
    _add(scheduler, 1)
    _add(scheduler, 2)
    assert not path.exists()
    _add(scheduler, 3)
    assert _saved_ids(path) == [1, 2, 3]


def test_saves_are_debounced_by_time(tmp_path):
    path = tmp_path / "buf.json"
    scheduler = _scheduler(path, every_n=1000, interval=0.0)
    _add(scheduler, 1)
    assert _saved_ids(path) == [1]


def test_a_quiet_period_is_flushed_by_the_timer(tmp_path):
    path = tmp_path / "buf.json"

    async def scenario():
        scheduler = _scheduler(path, every_n=1000, interval=0.3)
        _add(scheduler, 1)
        assert not path.exists()  # not due yet: the timer is armed instead
        deadline = time.monotonic() + 5
        while not path.exists() and time.monotonic() < deadline:
            await asyncio.sleep(0.05)

    asyncio.run(scenario())
    assert _saved_ids(path) == [1]


def test_flush_buffer_writes_only_pending_changes(tmp_path):
    path = tmp_path / "buf.json"
    scheduler = _scheduler(path)
    assert scheduler.flush_buffer() is False
    _add(scheduler, 1)
    assert scheduler.flush_buffer() is True
    assert _saved_ids(path) == [1]
    assert scheduler.flush_buffer() is False


def test_save_is_atomic_and_leaves_no_temp_file(tmp_path):
    path = tmp_path / "buf.json"
    scheduler = _scheduler(path, every_n=1)
    _add(scheduler, 1)
    _add(scheduler, 2)
    assert [p.name for p in tmp_path.iterdir()] == ["buf.json"]
    assert _saved_ids(path) == [1, 2]


def test_unusable_path_does_not_raise(tmp_path):
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x")
    scheduler = _scheduler(blocker / "buf.json", every_n=1)

    assert _add(scheduler, 1)  # the experience is still buffered
    assert len(scheduler.buffer) == 1
    assert scheduler._try_save_buffer() is False
    assert [p.name for p in tmp_path.iterdir()] == ["not-a-dir"]


def test_persistence_disabled_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    scheduler = _scheduler(None, every_n=1)
    _add(scheduler, 1)
    assert scheduler.flush_buffer() is False
    assert list(tmp_path.iterdir()) == []


# ---------------------------------------------------------------------------
# bulk add
# ---------------------------------------------------------------------------

def test_bulk_add_deduplicates_on_feedback_id_and_saves_once(tmp_path):
    path = tmp_path / "buf.json"
    scheduler = _scheduler(path)
    _add(scheduler, 1)

    items = [(_trace(n), _feedback(n), 0.5, {"feedback_id": n}) for n in (1, 2, 2, 3)]
    assert scheduler.add_experiences_bulk(items) == 2
    assert scheduler.buffered_feedback_ids() == {1, 2, 3}
    assert _saved_ids(path) == [1, 2, 3]

    assert scheduler.add_experiences_bulk(items) == 0
    assert len(scheduler.buffer) == 3
