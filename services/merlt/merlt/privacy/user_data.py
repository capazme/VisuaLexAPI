"""A person's data in MERL-T: what is kept under their VisuaLex user id, the
copy they can download, and its erasure.

MERL-T stores the VisuaLex user id in clear (a ``varchar``, never a foreign
key). It is personal data: neither anonymous nor pseudonymous. This module is
the one inventory of where it lives, so that the export and the erasure cannot
drift apart. A new table, column or store that keeps a user id belongs here.

What the erasure does, by kind of data:

- **private** (the person's activity, questions, feedback, profile, authority,
  uploaded documents and their files): deleted;
- **proposals the community has not approved** (entities, relations,
  amendments): deleted, with the votes cast on them;
- **what the community took up** (approved proposals, votes, issue reports, the
  graph nodes and relations written from them, the live sources the person
  vouched for): kept, with the link to the person cut. A column that may be
  null is set to null; one that may not gets a random value per row
  (``erased:<uuid>``), which names nobody and keeps the unique constraints on
  votes. In the graph, ``contributed_by`` becomes empty and the person's entry
  in a live source's ``confirmed_by`` list becomes ``erased:<uuid>``: the list
  must not shrink, or the hygiene sweep would prune a source someone vouched
  for;
- **another person's events that name this one** (a Forum event's
  ``target_author_id``): the key is removed from the payload;
- the RLCF replay buffer, in memory and on disk: the person's experiences are
  removed — theirs by user id, and any built on their questions (by trace id),
  including other people's feedback on them.

The export gives the person their own rows whole. Where they only reviewed,
flagged or resolved someone else's row (``REFERENCE``), it gives the row's id
and dates, never the other person's content.

Left as they are, on purpose: ``audit_log`` (an append-only hash chain whose
``actor_hash`` is a hash of the user id: removing a row breaks the chain);
``api_keys`` (service keys, never a VisuaLex user's); the per-process rate-limit
history of ``enrichment_router`` (minutes, in memory); the application and
access logs, which name user ids in some lines (the container's log rotation
bounds them).

Every step is idempotent: running the erasure again finishes what a failed run
left, so the caller retries until it reports ``complete``.
"""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncContextManager, Callable, Dict, List, Mapping, Optional, Sequence

import structlog
from fastapi.encoders import jsonable_encoder
from sqlalchemy import text

log = structlog.get_logger()

# Stores: the enrichment database and the RLCF database (two engines; the same
# Postgres in the live stack, but the code never assumes it).
ENRICHMENT = "enrichment"
RLCF = "rlcf"

# Actions on a row that names the person.
DELETE = "delete"                     # the row goes
DETACH = "detach"                     # the row stays, the column no longer names the person
DELETE_UNLESS_APPROVED = "delete_unless_approved"  # proposals: approved ones are detached

# A value that names nobody, one per row, for a NOT NULL column being detached.
_ERASED_VALUE = "'erased:' || gen_random_uuid()::text"

# What the export gives for a column.
ROW = "row"              # the person's own row, whole
REFERENCE = "reference"  # someone else's row the person acted on: its id and dates only


@dataclass(frozen=True)
class UserColumn:
    """One column that holds a VisuaLex user id."""

    store: str
    table: str
    column: str
    action: str
    nullable: bool = True
    # Columns left out of the export: internal machinery, not the person's data.
    export_exclude: Sequence[str] = ()
    export_as: str = ROW
    # For REFERENCE: the columns the export gives.
    reference_columns: Sequence[str] = ("id", "created_at")


# Order matters for the erasure: children before the rows they reference.
USER_COLUMNS: List[UserColumn] = [
    # --- enrichment: activity and private data -------------------------------
    UserColumn(ENRICHMENT, "tracking_events", "user_id", DELETE),
    UserColumn(ENRICHMENT, "ner_feedback", "user_id", DELETE),
    UserColumn(ENRICHMENT, "user_domain_authority", "user_id", DELETE),
    UserColumn(ENRICHMENT, "merlt_users", "user_id", DELETE),
    UserColumn(ENRICHMENT, "extraction_candidates", "contributor_id", DELETE),
    # user_documents goes after its candidates; the files on disk go with it.
    UserColumn(ENRICHMENT, "user_documents", "uploaded_by", DELETE,
               export_exclude=("storage_path",)),
    # --- enrichment: what the community took up ------------------------------
    UserColumn(ENRICHMENT, "entity_votes", "user_id", DETACH, nullable=False),
    UserColumn(ENRICHMENT, "relation_votes", "user_id", DETACH, nullable=False),
    UserColumn(ENRICHMENT, "amendment_votes", "user_id", DETACH, nullable=False),
    UserColumn(ENRICHMENT, "entity_issue_votes", "user_id", DETACH, nullable=False),
    UserColumn(ENRICHMENT, "relation_issue_votes", "user_id", DETACH, nullable=False),
    UserColumn(ENRICHMENT, "entity_issue_reports", "reported_by", DETACH, nullable=False),
    UserColumn(ENRICHMENT, "entity_issue_reports", "resolved_by", DETACH, export_as=REFERENCE,
               reference_columns=("issue_id", "resolved_at")),
    UserColumn(ENRICHMENT, "relation_issue_reports", "reported_by", DETACH, nullable=False),
    UserColumn(ENRICHMENT, "relation_issue_reports", "resolved_by", DETACH, export_as=REFERENCE,
               reference_columns=("issue_id", "resolved_at")),
    UserColumn(ENRICHMENT, "pending_entities", "contributed_by", DELETE_UNLESS_APPROVED),
    UserColumn(ENRICHMENT, "pending_relations", "contributed_by", DELETE_UNLESS_APPROVED),
    UserColumn(ENRICHMENT, "pending_amendments", "contributed_by", DELETE_UNLESS_APPROVED,
               nullable=False),
    UserColumn(ENRICHMENT, "merlt_ingestion_batches", "created_by", DETACH, export_as=REFERENCE),
    UserColumn(ENRICHMENT, "merlt_ingestion_batches", "reviewed_by", DETACH, export_as=REFERENCE),
    # --- RLCF: questions to the assistant and their feedback -----------------
    UserColumn(RLCF, "qa_feedback", "user_id", DELETE),
    UserColumn(RLCF, "qa_feedback", "flagged_by", DETACH, export_as=REFERENCE),
    UserColumn(RLCF, "qa_feedback", "reviewed_by", DETACH, export_as=REFERENCE,
               reference_columns=("id", "reviewed_at")),
    # The execution trace is the engine's working, not the person's data.
    UserColumn(RLCF, "qa_traces", "user_id", DELETE, export_exclude=("full_trace",)),
    UserColumn(RLCF, "rlcf_feedback", "user_id", DELETE),
]

# The legacy RLCF ``users`` table names the person by ``username`` and its
# children by the integer ``users.id``.
_LEGACY_USER_CHILDREN = (
    "credentials",
    "bias_reports",
    "devils_advocate_assignments",
    "task_assignments",
)


def _upload_dir() -> Path:
    return Path(os.getenv("UPLOAD_DIR", "./uploads/user_documents"))


async def _table_exists(session, table: str) -> bool:
    result = await session.execute(text("SELECT to_regclass(:t) IS NOT NULL"), {"t": f"public.{table}"})
    return bool(result.scalar())


# A store's session factory; tests pass their own, bound to a disposable database.
Sessions = Mapping[str, Callable[[], AsyncContextManager[Any]]]


def _session_for(store: str, sessions: Optional[Sessions] = None):
    if sessions is not None and store in sessions:
        return sessions[store]()
    if store == ENRICHMENT:
        from merlt.storage.enrichment.database import get_db_session

        return get_db_session()
    from merlt.rlcf.database import get_async_session

    return get_async_session()


def _rows(result) -> List[Dict[str, Any]]:
    return [dict(row) for row in result.mappings().all()]


# =============================================================================
# Export
# =============================================================================


async def export_user_data(user_id: str, sessions: Optional[Sessions] = None) -> Dict[str, Any]:
    """Every row that names the person, table by table, as JSON-ready dicts.

    A table missing from this database is skipped. The graph and the replay
    buffer hold copies of rows exported here, so they add nothing.
    """
    tables: Dict[str, List[Dict[str, Any]]] = {}
    for store in (ENRICHMENT, RLCF):
        async with _session_for(store, sessions) as session:
            for col in (c for c in USER_COLUMNS if c.store == store):
                if not await _table_exists(session, col.table):
                    continue
                columns = "*" if col.export_as == ROW else ", ".join(col.reference_columns)
                result = await session.execute(
                    text(f"SELECT {columns} FROM {col.table} WHERE {col.column} = :u"), {"u": user_id}
                )
                rows = _rows(result)
                for row in rows:
                    for excluded in col.export_exclude:
                        row.pop(excluded, None)
                if rows:
                    key = col.table if col.column in ("user_id", "uploaded_by") else f"{col.table}.{col.column}"
                    tables.setdefault(key, []).extend(rows)
            if store == RLCF and await _table_exists(session, "users"):
                result = await session.execute(
                    text("SELECT * FROM users WHERE username = :u"), {"u": user_id}
                )
                rows = _rows(result)
                if rows:
                    tables["users"] = rows
    return {"user_id": user_id, "tables": jsonable_encoder(tables)}


# =============================================================================
# Erasure
# =============================================================================


async def _erase_column(session, col: UserColumn, user_id: str) -> Dict[str, int]:
    """Apply one column's action. Returns {"deleted": n} or {"detached": n}."""
    detach_value = "NULL" if col.nullable else _ERASED_VALUE
    if col.action == DELETE:
        result = await session.execute(
            text(f"DELETE FROM {col.table} WHERE {col.column} = :u"), {"u": user_id}
        )
        return {"deleted": result.rowcount or 0}
    if col.action == DETACH:
        result = await session.execute(
            text(f"UPDATE {col.table} SET {col.column} = {detach_value} WHERE {col.column} = :u"),
            {"u": user_id},
        )
        return {"detached": result.rowcount or 0}
    # DELETE_UNLESS_APPROVED: a proposal the community approved stays, unnamed.
    deleted = await session.execute(
        text(
            f"DELETE FROM {col.table} WHERE {col.column} = :u "
            "AND validation_status IS DISTINCT FROM 'approved'"
        ),
        {"u": user_id},
    )
    detached = await session.execute(
        text(f"UPDATE {col.table} SET {col.column} = {detach_value} WHERE {col.column} = :u"),
        {"u": user_id},
    )
    return {"deleted": deleted.rowcount or 0, "detached": detached.rowcount or 0}


async def _erase_enrichment(
    user_id: str, counts: Dict[str, Dict[str, int]], sessions: Optional[Sessions]
) -> None:
    """The enrichment database, and the person's uploaded files. The files are
    deleted inside the transaction, before its commit: a file that cannot be
    deleted rolls the rows back, so a retry finds them and tries again."""
    files: List[str] = []
    async with _session_for(ENRICHMENT, sessions) as session:
        if await _table_exists(session, "user_documents"):
            result = await session.execute(
                text("SELECT storage_path FROM user_documents WHERE uploaded_by = :u"), {"u": user_id}
            )
            files = [row[0] for row in result.all() if row[0]]
        for col in (c for c in USER_COLUMNS if c.store == ENRICHMENT):
            if not await _table_exists(session, col.table):
                continue
            counts[f"{col.table}.{col.column}"] = await _erase_column(session, col, user_id)
        # Another person's Forum event that names this one: drop the key.
        if await _table_exists(session, "tracking_events"):
            result = await session.execute(
                text(
                    "UPDATE tracking_events "
                    "SET payload = (payload::jsonb - 'target_author_id')::json "
                    "WHERE payload->>'target_author_id' = :u"
                ),
                {"u": user_id},
            )
            counts["tracking_events.payload.target_author_id"] = {"detached": result.rowcount or 0}
        _erase_files(files, counts)


async def _erase_rlcf(
    user_id: str, counts: Dict[str, Dict[str, int]], sessions: Optional[Sessions]
) -> None:
    """The RLCF database, and the replay buffer. The buffer is cleaned inside the
    transaction, before its commit: when that fails, the rows roll back and a
    retry still has the feedback and trace ids the buffer is matched by."""
    feedback_ids: List[str] = []
    async with _session_for(RLCF, sessions) as session:
        trace_ids: List[str] = []
        if await _table_exists(session, "qa_traces"):
            result = await session.execute(
                text("SELECT trace_id FROM qa_traces WHERE user_id = :u"), {"u": user_id}
            )
            trace_ids = [row[0] for row in result.all()]
        if await _table_exists(session, "qa_feedback"):
            result = await session.execute(
                text(
                    "SELECT id FROM qa_feedback WHERE user_id = :u "
                    "OR trace_id IN (SELECT trace_id FROM qa_traces WHERE user_id = :u)"
                ),
                {"u": user_id},
            )
            feedback_ids = [str(row[0]) for row in result.all()]
        # The Devil's Advocate log names no one, but holds feedback on the person's traces.
        if trace_ids and await _table_exists(session, "devils_advocate_log"):
            result = await session.execute(
                text("DELETE FROM devils_advocate_log WHERE trace_id = ANY(:ids)"), {"ids": trace_ids}
            )
            counts["devils_advocate_log.trace_id"] = {"deleted": result.rowcount or 0}
        for col in (c for c in USER_COLUMNS if c.store == RLCF):
            if not await _table_exists(session, col.table):
                continue
            counts[f"{col.table}.{col.column}"] = await _erase_column(session, col, user_id)
        if await _table_exists(session, "users"):
            result = await session.execute(
                text("SELECT id FROM users WHERE username = :u"), {"u": user_id}
            )
            legacy_ids = [row[0] for row in result.all()]
            if legacy_ids:
                deleted = 0
                if await _table_exists(session, "feedback_ratings"):
                    ratings_on_own = (
                        " OR feedback_id IN (SELECT id FROM feedback WHERE user_id = ANY(:ids))"
                        if await _table_exists(session, "feedback")
                        else ""
                    )
                    r = await session.execute(
                        text(f"DELETE FROM feedback_ratings WHERE user_id = ANY(:ids){ratings_on_own}"),
                        {"ids": legacy_ids},
                    )
                    deleted += r.rowcount or 0
                for child in ("feedback", *_LEGACY_USER_CHILDREN):
                    if await _table_exists(session, child):
                        r = await session.execute(
                            text(f"DELETE FROM {child} WHERE user_id = ANY(:ids)"), {"ids": legacy_ids}
                        )
                        deleted += r.rowcount or 0
                r = await session.execute(text("DELETE FROM users WHERE id = ANY(:ids)"), {"ids": legacy_ids})
                counts["users.username"] = {"deleted": (r.rowcount or 0) + deleted}
        _erase_replay_buffer(user_id, feedback_ids, trace_ids, counts)


def _erase_files(paths: Sequence[str], counts: Dict[str, Dict[str, int]]) -> None:
    """Delete the person's uploaded files. Only paths inside UPLOAD_DIR: a row
    never makes this delete anything else."""
    root = _upload_dir().resolve()
    deleted = 0
    refused = 0
    for raw in paths:
        path = Path(raw).resolve()
        if root not in path.parents:
            # Counted, not fatal: a moved UPLOAD_DIR would otherwise fail every retry.
            log.warning("user_data: refusing to delete a file outside UPLOAD_DIR")
            refused += 1
            continue
        try:
            path.unlink()
            deleted += 1
        except FileNotFoundError:
            pass
    counts["files.user_documents"] = {"deleted": deleted, "refused": refused}


async def _erase_graph(user_id: str, counts: Dict[str, Dict[str, int]], graph_client=None) -> None:
    """Approved community entities and relations keep their content; the graph
    stops naming who proposed them (the writer stores an empty string when there
    is no contributor, and so does this)."""
    from merlt.pipeline.provisional_writer import _get_graph_client

    def count(rows) -> int:
        return int((rows[0].get("c") if rows else 0) or 0)

    gc = await _get_graph_client(graph_client)
    nodes = await gc.query(
        "MATCH (n) WHERE n.contributed_by = $u "
        "SET n.contributed_by = '', n.contributor_authority = 0.0 RETURN count(n) AS c",
        {"u": user_id},
    )
    rels = await gc.query(
        "MATCH ()-[r]->() WHERE r.contributed_by = $u SET r.contributed_by = '' RETURN count(r) AS c",
        {"u": user_id},
    )
    counts["graph.contributed_by"] = {"detached": count(nodes) + count(rels)}
    # A live source the person vouched for (confirm-source): their entry becomes a
    # value that names nobody. The list keeps its length: the hygiene sweep spares
    # a source with a non-empty confirmed_by (pipeline/hygiene.py).
    vouched = await gc.query(
        "MATCH (n) WHERE $u IN coalesce(n.confirmed_by, []) "
        "SET n.confirmed_by = [x IN n.confirmed_by WHERE x <> $u] + [$erased] RETURN count(n) AS c",
        {"u": user_id, "erased": f"erased:{uuid.uuid4()}"},
    )
    counts["graph.confirmed_by"] = {"detached": count(vouched)}


def _erase_replay_buffer(
    user_id: str,
    feedback_ids: Sequence[str],
    trace_ids: Sequence[str],
    counts: Dict[str, Dict[str, int]],
) -> None:
    """The person's experiences: theirs by user id, and every one built on their
    questions (by trace id: other people's feedback on them, the dossier
    training loader's experiences, which carry no user id). Raises when the
    buffer file cannot be saved, so the erasure is reported incomplete."""
    from merlt.rlcf.training_scheduler import get_scheduler

    feedbacks = set(feedback_ids)
    traces = set(trace_ids)

    def is_theirs(exp) -> bool:
        feedback = exp.feedback_data if isinstance(exp.feedback_data, dict) else {}
        trace = exp.trace_data if isinstance(exp.trace_data, dict) else {}
        metadata = exp.metadata if isinstance(exp.metadata, dict) else {}
        if feedback.get("user_id") == user_id:
            return True
        if str(metadata.get("feedback_id")) in feedbacks:
            return True
        candidates = (metadata.get("trace_id"), trace.get("trace_id"), trace.get("query_id"), feedback.get("query_id"))
        return any(c is not None and str(c) in traces for c in candidates)

    counts["replay_buffer"] = {"deleted": get_scheduler().drop_experiences(is_theirs)}


def _failure(e: Exception) -> str:
    """What a failed step reports: the exception's class only. Its message can
    carry the SQL parameters, the person's id among them, and the answer and
    the logs must not."""
    return type(e).__name__


async def erase_user_data(
    user_id: str, graph_client=None, sessions: Optional[Sessions] = None
) -> Dict[str, Any]:
    """Erase the person's data from every store. Each store is attempted even
    when another fails; ``complete`` is true only when all of them succeeded.
    """
    counts: Dict[str, Dict[str, int]] = {}
    errors: Dict[str, str] = {}

    try:
        await _erase_enrichment(user_id, counts, sessions)
    except Exception as e:  # noqa: BLE001
        errors[ENRICHMENT] = _failure(e)
    try:
        await _erase_rlcf(user_id, counts, sessions)
    except Exception as e:  # noqa: BLE001
        errors[RLCF] = _failure(e)
    try:
        await _erase_graph(user_id, counts, graph_client)
    except Exception as e:  # noqa: BLE001
        errors["graph"] = _failure(e)

    complete = not errors
    log.info("user_data: erasure", complete=complete, stores_failed=sorted(errors))
    return {"complete": complete, "counts": counts, "errors": errors}


__all__ = ["USER_COLUMNS", "UserColumn", "export_user_data", "erase_user_data"]
