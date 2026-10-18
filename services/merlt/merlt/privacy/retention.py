"""How long MERL-T keeps a person's data, and the job that enforces it.

The periods are the owner's (18 October 2026: «ok» to both):

- ``tracking_events`` (articles read, highlights and notes, bookmarks,
  citations opened, Forum signals) expire after
  ``MERLT_TRACKING_RETENTION_DAYS`` days (default 365);
- the assistant's questions and answers (``qa_traces``), the judgements on them
  (``qa_feedback``, the Devil's Advocate log of those traces) and the feedback
  on citations (``ner_feedback``) expire after
  ``MERLT_ASSISTANT_RETENTION_DAYS`` days (default 730), and so do the RLCF
  replay buffer's experiences of that age.

Each pass also removes ``note_text`` from stored events: MERL-T never collects
the text of a note (the owner, 18 October 2026, «c»), and events stored before
the server stopped relaying it keep none.

The app's lifespan runs ``run_retention`` every ``MERLT_RETENTION_INTERVAL_HOURS``
hours (default 24), the first time a few minutes after boot, so a stack
restarted often still purges. Each step runs even when another fails.
"""

from __future__ import annotations

import os

import structlog
from sqlalchemy import text

log = structlog.get_logger()

DEFAULT_TRACKING_RETENTION_DAYS = 365
DEFAULT_ASSISTANT_RETENTION_DAYS = 730
DEFAULT_RETENTION_INTERVAL_HOURS = 24.0
FIRST_RUN_DELAY_SECONDS = 300


def _days(variable: str, default: int) -> int:
    """A configured period, at least one day. A value that is not a whole
    number falls back to the default: a typo must never stop the purge."""
    raw = os.getenv(variable, "")
    try:
        days = int(raw) if raw.strip() else default
    except ValueError:
        log.warning("retention period is not a whole number; using the default",
                    variable=variable, default=default)
        days = default
    return max(days, 1)


def tracking_retention_days() -> int:
    return _days("MERLT_TRACKING_RETENTION_DAYS", DEFAULT_TRACKING_RETENTION_DAYS)


def assistant_retention_days() -> int:
    return _days("MERLT_ASSISTANT_RETENTION_DAYS", DEFAULT_ASSISTANT_RETENTION_DAYS)


def retention_interval_hours() -> float:
    raw = os.getenv("MERLT_RETENTION_INTERVAL_HOURS", "")
    try:
        hours = float(raw) if raw.strip() else DEFAULT_RETENTION_INTERVAL_HOURS
    except ValueError:
        hours = DEFAULT_RETENTION_INTERVAL_HOURS
    return hours if hours > 0 else DEFAULT_RETENTION_INTERVAL_HOURS


async def purge_expired_tracking_events(session, days: int) -> int:
    """Delete the events older than ``days`` days. Returns how many."""
    result = await session.execute(
        text("DELETE FROM tracking_events WHERE created_at < NOW() - make_interval(days => :d)"),
        {"d": int(days)},
    )
    return result.rowcount or 0


async def purge_expired_citation_feedback(session, days: int) -> int:
    """Delete the citation feedback older than ``days`` days. Returns how many."""
    result = await session.execute(
        text("DELETE FROM ner_feedback WHERE created_at < NOW() - make_interval(days => :d)"),
        {"d": int(days)},
    )
    return result.rowcount or 0


async def strip_note_text(session) -> int:
    """Remove ``note_text`` from every stored event that still has the key.
    Returns how many events changed."""
    result = await session.execute(
        text(
            "UPDATE tracking_events SET payload = (payload::jsonb - 'note_text')::json "
            "WHERE jsonb_exists(payload::jsonb, 'note_text')"
        )
    )
    return result.rowcount or 0


async def purge_expired_assistant_data(session, days: int) -> int:
    """Delete the questions to the assistant older than ``days`` days, with the
    judgements on them and their Devil's Advocate log, and any judgement of that
    age left on a newer trace. Returns the rows deleted."""
    cutoff = "NOW() - make_interval(days => :d)"
    params = {"d": int(days)}
    log_rows = await session.execute(
        text(
            "DELETE FROM devils_advocate_log WHERE trace_id IN "
            f"(SELECT trace_id FROM qa_traces WHERE created_at < {cutoff})"
        ),
        params,
    )
    feedback = await session.execute(
        text(
            f"DELETE FROM qa_feedback WHERE created_at < {cutoff} OR trace_id IN "
            f"(SELECT trace_id FROM qa_traces WHERE created_at < {cutoff})"
        ),
        params,
    )
    traces = await session.execute(text(f"DELETE FROM qa_traces WHERE created_at < {cutoff}"), params)
    return (log_rows.rowcount or 0) + (feedback.rowcount or 0) + (traces.rowcount or 0)


def drop_expired_experiences(days: int) -> int:
    """Remove the RLCF replay buffer's experiences older than ``days`` days, in
    memory and on disk. Returns how many."""
    from datetime import datetime, timedelta, timezone

    from merlt.rlcf.training_scheduler import get_scheduler

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

    def is_expired(exp) -> bool:
        try:
            stamp = datetime.fromisoformat(exp.timestamp)
        except (TypeError, ValueError):
            return False
        if stamp.tzinfo is not None:
            stamp = stamp.astimezone(timezone.utc).replace(tzinfo=None)
        return stamp < cutoff

    return get_scheduler().drop_experiences(is_expired)


async def run_retention() -> int:
    """One pass over every store with an expiry. Returns the rows deleted."""
    from merlt.rlcf.database import get_async_session
    from merlt.storage.enrichment.database import get_db_session

    tracking_days = tracking_retention_days()
    assistant_days = assistant_retention_days()
    deleted = 0

    async def step(name: str, coro_factory) -> None:
        nonlocal deleted
        try:
            count = await coro_factory()
            deleted += count
            log.info("retention: step done", step=name, rows=count)
        except Exception as e:  # noqa: BLE001
            # The class only: a message can carry the statement's parameters.
            log.warning("retention: step failed", step=name, error=type(e).__name__)

    async def enrichment() -> int:
        async with get_db_session() as session:
            count = await purge_expired_tracking_events(session, tracking_days)
            count += await purge_expired_citation_feedback(session, assistant_days)
            count += await strip_note_text(session)
            return count

    async def assistant() -> int:
        async with get_async_session() as session:
            return await purge_expired_assistant_data(session, assistant_days)

    async def buffer() -> int:
        return drop_expired_experiences(assistant_days)

    await step("enrichment", enrichment)
    await step("assistant", assistant)
    await step("replay_buffer", buffer)
    log.info("retention: pass done", rows=deleted, tracking_days=tracking_days, assistant_days=assistant_days)
    return deleted


__all__ = [
    "assistant_retention_days",
    "drop_expired_experiences",
    "purge_expired_assistant_data",
    "purge_expired_citation_feedback",
    "purge_expired_tracking_events",
    "retention_interval_hours",
    "run_retention",
    "strip_note_text",
    "tracking_retention_days",
]
