"""How long MERL-T keeps a person's activity events, and the job that enforces it.

``tracking_events`` (articles read, highlights and notes, bookmarks, citations
opened, Forum signals) expire after ``MERLT_TRACKING_RETENTION_DAYS`` days
(default 365: the period proposed to the owner, who decides it). The app's
lifespan runs ``purge_expired_tracking_events`` every
``MERLT_RETENTION_INTERVAL_HOURS`` hours (default 24), the first time a few
minutes after boot, so a stack restarted often still purges.
"""

from __future__ import annotations

import os

import structlog
from sqlalchemy import text

log = structlog.get_logger()

DEFAULT_TRACKING_RETENTION_DAYS = 365
DEFAULT_RETENTION_INTERVAL_HOURS = 24.0
FIRST_RUN_DELAY_SECONDS = 300


def tracking_retention_days() -> int:
    """The configured period, at least one day. A value that is not a whole
    number falls back to the default: a typo must never stop the purge."""
    raw = os.getenv("MERLT_TRACKING_RETENTION_DAYS", "")
    try:
        days = int(raw) if raw.strip() else DEFAULT_TRACKING_RETENTION_DAYS
    except ValueError:
        log.warning("MERLT_TRACKING_RETENTION_DAYS is not a whole number; using the default",
                    default=DEFAULT_TRACKING_RETENTION_DAYS)
        days = DEFAULT_TRACKING_RETENTION_DAYS
    return max(days, 1)


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


async def run_retention() -> int:
    """One pass over every store with an expiry. Returns the rows deleted."""
    from merlt.storage.enrichment.database import get_db_session

    days = tracking_retention_days()
    async with get_db_session() as session:
        deleted = await purge_expired_tracking_events(session, days)
    log.info("retention: tracking events purged", deleted=deleted, retention_days=days)
    return deleted


__all__ = [
    "purge_expired_tracking_events",
    "retention_interval_hours",
    "run_retention",
    "tracking_retention_days",
]
