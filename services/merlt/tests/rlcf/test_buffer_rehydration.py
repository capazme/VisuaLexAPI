"""Rebuilding the RLCF replay buffer from persisted feedback.

Fake (QAFeedback, QATrace) rows stand in for the database. The rehydrated
experiences must be exactly what the live wiring (_wire_feedback_to_training)
puts in the buffer, de-duplicated on feedback_id, and rehydration must not run
when the buffer file already provided experiences.
"""

from __future__ import annotations

import importlib
from types import SimpleNamespace

import pytest
from sqlalchemy.dialects import postgresql

from merlt.rlcf import buffer_rehydration
from merlt.rlcf.buffer_rehydration import (
    build_rehydration_query,
    infer_feedback_type,
    rehydrate_buffer,
    rehydrate_from_rows,
)
from merlt.rlcf.execution_trace import ExecutionTrace
from merlt.rlcf.multilevel_feedback import MultilevelFeedback
from merlt.rlcf.training_scheduler import SchedulerConfig, TrainingScheduler

_FEEDBACK_COLUMNS = (
    "inline_rating",
    "retrieval_score",
    "reasoning_score",
    "synthesis_score",
    "detailed_comment",
    "source_id",
    "source_relevance",
    "follow_up_query",
    "refined_trace_id",
    "preferred_expert",
    "user_authority",
)


def _feedback(feedback_id: int, trace_id: str = "trace_a", status: str = "approved", **columns):
    values = {name: None for name in _FEEDBACK_COLUMNS}
    values.update(columns)
    return SimpleNamespace(id=feedback_id, trace_id=trace_id, user_id="jurist-1", status=status, **values)


def _trace(trace_id: str = "trace_a", with_execution_trace: bool = True):
    full_trace = {"stages": {}}
    if with_execution_trace:
        full_trace["execution_trace"] = {
            "query_id": trace_id,
            "actions": [
                {
                    "action_type": "expert_selection",
                    "parameters": {"expert_type": "literal", "weight": 0.6},
                    "log_prob": -0.5,
                    "metadata": {"source": "neural_gating"},
                }
            ],
            "metadata": {"synthesis_result": {"mode": "convergent"}},
        }
    return SimpleNamespace(trace_id=trace_id, full_trace=full_trace, synthesis_mode="convergent")


# One row per channel, shaped like the router's writers.
CHANNEL_ROWS = {
    "inline": dict(inline_rating=5),
    "detailed": dict(retrieval_score=0.8, reasoning_score=0.6, synthesis_score=0.4, detailed_comment="ok"),
    "source": dict(source_id="urn:nir:stato:codice.civile:1942;art1453", source_relevance=4, user_authority=0.7),
    "preference": dict(preferred_expert="systemic", detailed_comment="meglio", user_authority=0.8),
    "relation": dict(source_id="relation:DISCIPLINA", user_authority=0.6),
    "router": dict(inline_rating=1, detailed_comment="[router][unchanged]", user_authority=0.9),
    "refine": dict(follow_up_query="Puoi spiegare meglio?", refined_trace_id="trace_b"),
}


def _scheduler(tmp_path, name: str = "buf.json") -> TrainingScheduler:
    return TrainingScheduler(
        SchedulerConfig(
            buffer_persistence_path=str(tmp_path / name),
            buffer_save_every_n=1000,
            buffer_save_interval_seconds=3600.0,
        )
    )


def _experiences(scheduler: TrainingScheduler) -> list:
    tree = scheduler.buffer.tree
    return [e for e in tree.data[: tree.n_entries] if e is not None]


def _comparable(experience) -> tuple:
    feedback_data = {k: v for k, v in experience.feedback_data.items() if k != "timestamp"}
    return experience.trace_data, feedback_data, experience.reward, experience.metadata


# ---------------------------------------------------------------------------
# channel inference
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("channel, columns", list(CHANNEL_ROWS.items()))
def test_infer_feedback_type_matches_the_writer(channel, columns):
    assert infer_feedback_type(_feedback(1, **columns)) == channel


def test_infer_feedback_type_unknown_row():
    assert infer_feedback_type(_feedback(1, detailed_comment="solo un commento")) is None


# ---------------------------------------------------------------------------
# parity with the live wiring
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("channel, columns", list(CHANNEL_ROWS.items()))
def test_rehydrated_experience_equals_the_live_one(channel, columns, tmp_path, monkeypatch):
    experts_router = importlib.import_module("merlt.api.experts_router")
    feedback, trace = _feedback(7, **columns), _trace()

    live = _scheduler(tmp_path, "live.json")
    monkeypatch.setattr(experts_router, "get_scheduler", lambda: live)
    experts_router._wire_feedback_to_training(trace, feedback, channel)

    replayed = _scheduler(tmp_path, "replayed.json")
    result = rehydrate_from_rows(replayed, [(feedback, trace)])

    assert result.added == 1
    [live_exp], [replayed_exp] = _experiences(live), _experiences(replayed)
    assert _comparable(replayed_exp) == _comparable(live_exp)
    assert replayed_exp.metadata == {"feedback_type": channel, "feedback_id": 7, "trace_id": "trace_a"}
    # What the training epoch does with a sampled experience.
    ExecutionTrace.from_dict(replayed_exp.trace_data)
    MultilevelFeedback.from_dict(replayed_exp.feedback_data)


def test_rewards_follow_the_channel_contract(tmp_path):
    scheduler = _scheduler(tmp_path)
    rows = [(_feedback(i, **columns), _trace()) for i, columns in enumerate(CHANNEL_ROWS.values(), start=1)]
    rehydrate_from_rows(scheduler, rows)

    rewards = {e.metadata["feedback_type"]: e.reward for e in _experiences(scheduler)}
    assert rewards == pytest.approx(
        {
            "inline": 1.0,  # (5 - 1) / 4
            "detailed": 0.3 * 0.8 + 0.4 * 0.6 + 0.3 * 0.4,
            "source": 0.75,  # (4 - 1) / 4
            "preference": 0.7,
            "relation": 0.7,
            "router": 0.0,  # rating 1
            "refine": 0.3,
        }
    )
    by_type = {e.metadata["feedback_type"]: e.feedback_data["metadata"] for e in _experiences(scheduler)}
    assert by_type["preference"]["preferred_expert"] == "systemic"
    assert by_type["relation"]["preferred_relation"] == "DISCIPLINA"
    assert by_type["preference"]["authority"] == 0.8


# ---------------------------------------------------------------------------
# filtering and de-duplication
# ---------------------------------------------------------------------------

def test_rows_that_cannot_train_are_skipped(tmp_path):
    scheduler = _scheduler(tmp_path)
    rows = [
        (_feedback(1, inline_rating=5), _trace(with_execution_trace=False)),
        (_feedback(2, inline_rating=5, status="quarantined"), _trace()),
        (_feedback(3, inline_rating=5, status="flagged"), _trace()),
        (_feedback(4, detailed_comment="nessun canale"), _trace()),
        (_feedback(5, inline_rating=5), _trace()),
    ]
    result = rehydrate_from_rows(scheduler, rows)

    assert result.added == 1
    assert result.skipped_no_execution_trace == 1
    assert result.skipped_status == 2
    assert result.skipped_unknown_type == 1
    assert scheduler.buffered_feedback_ids() == {5}


def test_rehydration_deduplicates_on_feedback_id(tmp_path):
    scheduler = _scheduler(tmp_path)
    row = (_feedback(9, inline_rating=5), _trace())

    assert rehydrate_from_rows(scheduler, [row, row]).added == 1
    assert rehydrate_from_rows(scheduler, [row]).added == 0
    assert len(scheduler.buffer) == 1


def test_rehydration_saves_the_buffer_file(tmp_path):
    scheduler = _scheduler(tmp_path)
    rehydrate_from_rows(scheduler, [(_feedback(1, inline_rating=5), _trace())])

    reloaded = _scheduler(tmp_path)
    assert reloaded.buffered_feedback_ids() == {1}


# ---------------------------------------------------------------------------
# rehydrate_buffer(): only on an empty buffer, bounded, oldest first
# ---------------------------------------------------------------------------

class _FakeSession:
    """Answers build_rehydration_query pages from rows kept newest first."""

    def __init__(self, rows_newest_first):
        self.rows = rows_newest_first
        self.queries = 0

    async def execute(self, stmt):
        self.queries += 1
        compiled = stmt.compile(dialect=postgresql.dialect())
        before_id = next(
            (v for k, v in compiled.params.items() if k.startswith("id_") and isinstance(v, int)),
            None,
        )
        limit = next(v for k, v in compiled.params.items() if k.startswith("param_"))
        page = [r for r in self.rows if before_id is None or r[0].id < before_id][:limit]
        return SimpleNamespace(all=lambda: page)


def _db_rows(ids):
    return [(_feedback(i, inline_rating=5), _trace()) for i in sorted(ids, reverse=True)]


async def test_rehydrate_buffer_fills_an_empty_buffer_oldest_first(tmp_path, monkeypatch):
    monkeypatch.setattr(buffer_rehydration, "REHYDRATION_PAGE_SIZE", 2)
    scheduler = _scheduler(tmp_path)
    session = _FakeSession(_db_rows(range(1, 6)))

    result = await rehydrate_buffer(scheduler, session=session, limit=4)

    assert result.added == 4
    assert session.queries == 2
    # The 4 most recent feedback rows, added in the order they were given.
    assert [e.metadata["feedback_id"] for e in _experiences(scheduler)] == [2, 3, 4, 5]


async def test_rehydrate_buffer_is_skipped_when_the_file_loaded_experiences(tmp_path):
    first = _scheduler(tmp_path)
    first.add_experiences_bulk([({"query_id": "t", "actions": []}, {"metadata": {}}, 0.5, {"feedback_id": 1})])

    scheduler = _scheduler(tmp_path)  # loads the file
    assert len(scheduler.buffer) == 1
    session = _FakeSession(_db_rows(range(1, 4)))

    result = await rehydrate_buffer(scheduler, session=session)

    assert result.skipped_reason == "buffer_not_empty"
    assert session.queries == 0
    assert len(scheduler.buffer) == 1


def test_rehydration_query_compiles_for_postgres():
    sql = str(build_rehydration_query(50, before_id=10).compile(dialect=postgresql.dialect()))
    assert "JOIN qa_traces" in sql
    assert "qa_traces.full_trace ?" in sql  # has the execution_trace key
    assert "NOT IN" in sql  # moderated feedback excluded
    assert "qa_feedback.id <" in sql
    assert "ORDER BY qa_feedback.id DESC" in sql
