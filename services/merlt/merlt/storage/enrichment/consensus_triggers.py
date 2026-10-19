"""RLCF enrichment consensus triggers (loop-closure A2).

The vote → consensus → graph-promotion path expects PostgreSQL triggers
(`update_entity_consensus` / `update_relation_consensus` / `update_amendment_consensus`)
that recompute the authority-weighted `net_score` and flip `consensus_reached` /
`consensus_type` whenever a row lands in `entity_votes` / `relation_votes` /
`amendment_votes`. Those triggers live in migrations 001+002, but
`create_tables()` only runs `Base.metadata.create_all` (tables, no triggers) —
so on a DB bootstrapped that way the triggers are MISSING and votes never reach
consensus. This module installs them idempotently at startup.

Threshold logic (unchanged from migration 002): authority-weighted
`net_score = Σ(approve·authority) − Σ(reject·authority)`; `>= +2.0` → approved,
`<= -2.0` → rejected, otherwise pending.
"""

from __future__ import annotations

import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from merlt.storage.enrichment import database as _db

log = structlog.get_logger()


def _consensus_function(table: str, votes_table: str, fk_column: str, func_name: str) -> str:
    """Build a CREATE OR REPLACE FUNCTION that recomputes net-score consensus."""
    return f"""
CREATE OR REPLACE FUNCTION {func_name}()
RETURNS TRIGGER AS $$
DECLARE
    total_approval FLOAT;
    total_rejection FLOAT;
    vote_count INT;
    net_score_val FLOAT;
    consensus_threshold FLOAT := 2.0;
BEGIN
    SELECT
        COALESCE(SUM(CASE WHEN vote_value = 1 THEN voter_authority ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN vote_value = -1 THEN voter_authority ELSE 0 END), 0),
        COUNT(*)
    INTO total_approval, total_rejection, vote_count
    FROM {votes_table}
    WHERE {fk_column} = NEW.{fk_column}
      AND vote_type = 'accuracy';

    net_score_val := total_approval - total_rejection;

    UPDATE {table}
    SET
        approval_score = total_approval,
        rejection_score = total_rejection,
        net_score = net_score_val,
        votes_count = vote_count,
        consensus_reached = (net_score_val >= consensus_threshold OR net_score_val <= -consensus_threshold),
        consensus_type = CASE
            WHEN net_score_val >= consensus_threshold THEN 'approved'
            WHEN net_score_val <= -consensus_threshold THEN 'rejected'
            ELSE NULL
        END,
        validation_status = CASE
            WHEN net_score_val <= -consensus_threshold THEN 'rejected'
            WHEN net_score_val >= consensus_threshold THEN 'approved'
            ELSE validation_status
        END,
        updated_at = NOW()
    WHERE {fk_column} = NEW.{fk_column};

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
""".strip()


def _consensus_trigger(trigger_name: str, votes_table: str, func_name: str) -> str:
    """Build an idempotent CREATE OR REPLACE TRIGGER (PostgreSQL 14+)."""
    return (
        f"CREATE OR REPLACE TRIGGER {trigger_name} "
        f"AFTER INSERT OR UPDATE ON {votes_table} "
        f"FOR EACH ROW EXECUTE FUNCTION {func_name}();"
    )


# Each statement is executed separately (asyncpg/SQLAlchemy = one statement per execute).
_STATEMENTS: list[str] = [
    _consensus_function("pending_entities", "entity_votes", "entity_id", "update_entity_consensus"),
    _consensus_function("pending_relations", "relation_votes", "relation_id", "update_relation_consensus"),
    _consensus_function("pending_amendments", "amendment_votes", "amendment_id", "update_amendment_consensus"),
    _consensus_trigger("trigger_entity_vote_consensus", "entity_votes", "update_entity_consensus"),
    _consensus_trigger("trigger_relation_vote_consensus", "relation_votes", "update_relation_consensus"),
    _consensus_trigger("trigger_amendment_vote_consensus", "amendment_votes", "update_amendment_consensus"),
]


async def ensure_consensus_triggers(engine: AsyncEngine | None = None) -> None:
    """Install (idempotently) the net-score consensus functions and triggers.

    Safe to call on every boot: functions use CREATE OR REPLACE, triggers use
    CREATE OR REPLACE TRIGGER. Uses the global enrichment engine unless one is
    passed (tests pass a loop-local engine).
    """
    eng = engine or _db._engine
    if eng is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")

    async with eng.begin() as conn:
        for stmt in _STATEMENTS:
            await conn.execute(text(stmt))

    log.info("Consensus triggers installed", triggers=3, functions=3)
