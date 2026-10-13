"""A person's data in MERL-T: the export finds it, the erasure removes it and
leaves everyone else's alone (``merlt.privacy.user_data``).

The Postgres-backed tests need ``ENRICHMENT_DATABASE_URL`` and
``RLCF_ASYNC_DATABASE_URL`` pointing at a disposable database (CI sets both);
each run uses fresh user ids and removes what it wrote.
"""

from __future__ import annotations

import os
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import merlt.experts.models  # noqa: F401  (registers the RLCF tables)
import merlt.rlcf.persistence  # noqa: F401  (rlcf_feedback, weight_versions)
import merlt.rlcf.models as legacy
import merlt.rlcf.training_scheduler as ts
from merlt.experts.models import QAFeedback, QATrace
from merlt.privacy import user_data as ud
from merlt.privacy.user_data import ENRICHMENT, RLCF, USER_COLUMNS, erase_user_data, export_user_data
from merlt.rlcf.database import Base as RlcfBase
from merlt.rlcf.database import get_async_database_url
from merlt.rlcf.replay_buffer import ExperienceReplayBuffer, PrioritizedReplayBuffer
from merlt.storage.enrichment.database import get_database_url
from merlt.storage.enrichment.models import (
    Base as EnrichmentBase,
    EntityVote,
    ExtractionCandidate,
    MerltUser,
    NERFeedback,
    PendingEntity,
    TrackingEventRecord,
    UserDocument,
    UserDomainAuthority,
)
from merlt.storage.enrichment.schema_additions import ensure_schema_additions

needs_db = pytest.mark.skipif(
    not (os.environ.get("ENRICHMENT_DATABASE_URL") and os.environ.get("RLCF_ASYNC_DATABASE_URL")),
    reason="needs the enrichment and RLCF Postgres",
)


# =============================================================================
# The inventory
# =============================================================================


def test_every_column_of_the_inventory_exists_in_the_models():
    tables = {**EnrichmentBase.metadata.tables, **RlcfBase.metadata.tables}
    for col in USER_COLUMNS:
        assert col.table in tables, col.table
        assert col.column in tables[col.table].c, f"{col.table}.{col.column}"
        assert col.store == (ENRICHMENT if col.table in EnrichmentBase.metadata.tables else RLCF)


def test_a_not_null_column_is_never_detached_to_null():
    tables = {**EnrichmentBase.metadata.tables, **RlcfBase.metadata.tables}
    for col in USER_COLUMNS:
        if col.action != ud.DELETE:
            assert col.nullable == tables[col.table].c[col.column].nullable, f"{col.table}.{col.column}"


def test_every_enrichment_user_column_is_in_the_inventory():
    """A new column that names a person must be added to the inventory."""
    known = {(c.table, c.column) for c in USER_COLUMNS}
    names = {"user_id", "contributed_by", "contributor_id", "uploaded_by", "reported_by",
             "resolved_by", "created_by", "reviewed_by", "flagged_by"}
    # Columns that hold an id of a service or an administrator, never a VisuaLex user's.
    service_only = {("api_keys", "user_id"), ("weight_versions", "created_by")}
    tables = {**EnrichmentBase.metadata.tables, **RlcfBase.metadata.tables}
    for name, table in tables.items():
        for column in table.c:
            if column.name in names and (name, column.name) not in service_only:
                if name in ud._LEGACY_USER_CHILDREN or name in ("feedback", "feedback_ratings"):
                    continue  # integer ids of the legacy users table, erased through it
                assert (name, column.name) in known, f"{name}.{column.name} is not in USER_COLUMNS"


# =============================================================================
# The replay buffer
# =============================================================================


def _feedback(user_id):
    return {"user_id": user_id, "overall_rating": 1.0}


@pytest.mark.parametrize("make", [lambda: ExperienceReplayBuffer(capacity=4),
                                  lambda: PrioritizedReplayBuffer(capacity=4)])
def test_remove_where_drops_only_the_matching_experiences(make):
    buf = make()
    for i, uid in enumerate(["a", "b", "a", "c", "b"]):  # one more than the capacity
        buf.add({"i": i}, _feedback(uid), reward=1.0, metadata={"feedback_id": i})
    assert len(buf) == 4
    removed = buf.remove_where(lambda e: e.feedback_data["user_id"] == "b")
    assert removed == 2
    kept = buf.get_all() if isinstance(buf, ExperienceReplayBuffer) else [
        e for e in buf.tree.data if e is not None
    ]
    assert sorted(e.feedback_data["user_id"] for e in kept) == ["a", "c"]
    assert len(buf) == 2


def test_prioritized_remove_keeps_the_priorities_and_the_order():
    buf = PrioritizedReplayBuffer(capacity=3)
    for i, uid in enumerate(["a", "b", "c", "d"]):  # "a" is overwritten by "d"
        buf.add({"i": i}, _feedback(uid), reward=1.0, td_error=float(i))
    before = {e.feedback_data["user_id"]: buf.tree.tree[s + 2] for s, e in enumerate(buf.tree.data)}
    buf.remove_where(lambda e: e.feedback_data["user_id"] == "c")
    after = {e.feedback_data["user_id"]: buf.tree.tree[s + 2]
             for s, e in enumerate(buf.tree.data) if e is not None}
    assert after == {"b": before["b"], "d": before["d"]}
    # Oldest first: "b" then "d", and the next add goes after them.
    assert [e.feedback_data["user_id"] for e in buf.tree.data if e is not None] == ["b", "d"]
    assert abs(buf.tree.total() - (before["b"] + before["d"])) < 1e-9


# =============================================================================
# The databases
# =============================================================================


@pytest_asyncio.fixture
async def stores(tmp_path, monkeypatch):
    enrichment = create_async_engine(get_database_url(), poolclass=NullPool)
    rlcf = create_async_engine(get_async_database_url(), poolclass=NullPool)
    async with enrichment.begin() as conn:
        await conn.run_sync(EnrichmentBase.metadata.create_all)
    await ensure_schema_additions(enrichment)
    async with rlcf.begin() as conn:
        await conn.run_sync(RlcfBase.metadata.create_all)
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    monkeypatch.setenv("MERLT_RLCF_BUFFER_PATH", "")
    ts.reset_scheduler()

    def factory(engine):
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        @asynccontextmanager
        async def session():
            async with maker() as s:
                try:
                    yield s
                    await s.commit()
                except Exception:
                    await s.rollback()
                    raise

        return session

    sessions = {ENRICHMENT: factory(enrichment), RLCF: factory(rlcf)}
    yield sessions, tmp_path
    ts.reset_scheduler()
    await enrichment.dispose()
    await rlcf.dispose()


class FakeGraph:
    def __init__(self):
        self.calls = []

    async def query(self, cypher, params=None):
        self.calls.append((cypher, params))
        return [{"c": 1}]


async def _seed(sessions, tmp_path, me: str, other: str) -> dict:
    """Rows for ``me`` and for ``other``, who interacts with ``me``."""
    tag = uuid.uuid4().hex[:8]
    upload = tmp_path / f"{tag}.txt"
    upload.write_text("i miei appunti")
    async with sessions[ENRICHMENT]() as s:
        s.add_all([
            TrackingEventRecord(event_type="annotation:created", user_id=me,
                                payload={"user_id": me, "note_text": "la mia nota"}),
            TrackingEventRecord(event_type="forum:like", user_id=other,
                                payload={"user_id": other, "target_author_id": me, "shared_env_id": "e"}),
            NERFeedback(feedback_id=f"ner-{tag}", source_surface="article_xref", user_id=me,
                        feedback_type="confirmation"),
            UserDomainAuthority(user_id=me, legal_domain="civile"),
            MerltUser(user_id=me, display_name="Io"),
            PendingEntity(entity_id=f"pend-{tag}", article_urn="u", entity_type="concetto",
                          entity_text="proposta mia", contributed_by=me),
            PendingEntity(entity_id=f"appr-{tag}", article_urn="u", entity_type="concetto",
                          entity_text="approvata", contributed_by=me, validation_status="approved"),
            PendingEntity(entity_id=f"altr-{tag}", article_urn="u", entity_type="concetto",
                          entity_text="dell'altro", contributed_by=other),
        ])
        await s.flush()
        s.add_all([
            EntityVote(entity_id=f"altr-{tag}", user_id=me, vote_value=1, vote_type="utility"),
            EntityVote(entity_id=f"altr-{tag}", user_id=other, vote_value=1, vote_type="utility"),
        ])
        doc = UserDocument(filename=upload.name, original_filename="appunti.txt", file_type="txt",
                           storage_path=str(upload), uploaded_by=me, file_hash=f"h-{tag}")
        s.add(doc)
        await s.flush()
        s.add(ExtractionCandidate(document_id=doc.id, contributor_id=me, candidate_type="entity"))
    async with sessions[RLCF]() as s:
        trace = QATrace(trace_id=f"trace_{tag}", user_id=me, query="la mia domanda")
        s.add(trace)
        await s.flush()
        s.add(QAFeedback(trace_id=trace.trace_id, user_id=me, inline_rating=5))
        # The other person comments on my answer; and I review their feedback on theirs.
        s.add(QAFeedback(trace_id=trace.trace_id, user_id=other, inline_rating=2,
                         detailed_comment="commento dell'altro sulla mia risposta"))
        theirs = QATrace(trace_id=f"trace_o_{tag}", user_id=other, query="la loro domanda")
        s.add(theirs)
        await s.flush()
        s.add(QAFeedback(trace_id=theirs.trace_id, user_id=other, inline_rating=4,
                         detailed_comment="il loro commento", reviewed_by=me))
        old = legacy.User(username=me)
        s.add(old)
        await s.flush()
        s.add(legacy.Feedback(user_id=old.id, feedback_data={"x": 1}))
    return {"tag": tag, "upload": upload}


async def _cleanup(sessions, tag: str, ids: list[str]):
    async with sessions[ENRICHMENT]() as s:
        for col in (c for c in USER_COLUMNS if c.store == ENRICHMENT):
            await s.execute(text(f"DELETE FROM {col.table} WHERE {col.column} = ANY(:ids)"), {"ids": ids})
        await s.execute(text("DELETE FROM pending_entities WHERE entity_id LIKE :t"), {"t": f"%-{tag}"})
        await s.execute(text("DELETE FROM tracking_events WHERE payload->>'shared_env_id' = 'e' AND user_id = ANY(:ids)"),
                        {"ids": ids})


@needs_db
async def test_export_finds_the_persons_rows(stores):
    sessions, tmp_path = stores
    me, other = f"me-{uuid.uuid4()}", f"other-{uuid.uuid4()}"
    seeded = await _seed(sessions, tmp_path, me, other)
    try:
        data = await export_user_data(me, sessions=sessions)
        tables = data["tables"]
        assert [r["payload"]["note_text"] for r in tables["tracking_events"]] == ["la mia nota"]
        assert len(tables["ner_feedback"]) == 1
        assert tables["merlt_users"][0]["display_name"] == "Io"
        assert {r["entity_text"] for r in tables["pending_entities.contributed_by"]} == {"proposta mia", "approvata"}
        assert tables["qa_traces"][0]["query"] == "la mia domanda"
        assert "full_trace" not in tables["qa_traces"][0]
        assert "storage_path" not in tables["user_documents"][0]
        assert tables["users"][0]["username"] == me
        # Their feedback I reviewed: its id and date, never their comment or their id.
        reviewed = tables["qa_feedback.reviewed_by"]
        assert len(reviewed) == 1 and set(reviewed[0]) == {"id", "reviewed_at"}
        assert "il loro commento" not in str(tables) and other not in str(tables)
        # Nothing of the other person's.
        assert all(r["user_id"] == me for r in tables["tracking_events"])
    finally:
        await erase_user_data(me, graph_client=FakeGraph(), sessions=sessions)
        await erase_user_data(other, graph_client=FakeGraph(), sessions=sessions)
        await _cleanup(sessions, seeded["tag"], [me, other])


@needs_db
async def test_erasure_removes_the_person_and_spares_the_others(stores):
    sessions, tmp_path = stores
    me, other = f"me-{uuid.uuid4()}", f"other-{uuid.uuid4()}"
    seeded = await _seed(sessions, tmp_path, me, other)
    graph = FakeGraph()
    scheduler = ts.get_scheduler()
    scheduler.add_experience({"t": 1}, _feedback(me), 1.0, metadata={"feedback_id": "x"})
    scheduler.add_experience({"t": 2}, _feedback(other), 1.0, metadata={"feedback_id": "y"})
    # Built on my question, without my id: the other person's feedback, the dossier loader.
    scheduler.add_experience({"trace_id": f"trace_{seeded['tag']}"}, _feedback(other), 1.0, metadata={})
    scheduler.add_experience({"t": 3}, _feedback(None), 1.0, metadata={"trace_id": f"trace_{seeded['tag']}"})
    try:
        result = await erase_user_data(me, graph_client=graph, sessions=sessions)
        assert result["complete"] is True, result
        assert result["errors"] == {}

        again = await export_user_data(me, sessions=sessions)
        assert again["tables"] == {}, again["tables"]

        async with sessions[ENRICHMENT]() as s:
            # The other person's Forum event stays, without my id.
            row = (await s.execute(text(
                "SELECT payload FROM tracking_events WHERE user_id = :o"), {"o": other})).scalar_one()
            assert "target_author_id" not in row and row["shared_env_id"] == "e"
            # My approved proposal stays, unnamed; my pending one is gone; theirs is untouched.
            rows = dict((await s.execute(text(
                "SELECT entity_id, contributed_by FROM pending_entities WHERE entity_id LIKE :t"),
                {"t": f"%-{seeded['tag']}"})).all())
            assert rows == {f"appr-{seeded['tag']}": None, f"altr-{seeded['tag']}": other}
            # My vote counts still, under a value that names nobody.
            votes = [r[0] for r in (await s.execute(text(
                "SELECT user_id FROM entity_votes WHERE entity_id = :e"),
                {"e": f"altr-{seeded['tag']}"})).all()]
            assert other in votes and len(votes) == 2
            assert [v for v in votes if v != other][0].startswith("erased:")
        # The uploaded file is gone.
        assert not seeded["upload"].exists()
        # The graph was asked to forget me as contributor, by parameter.
        assert graph.calls and all(params["u"] == me for _, params in graph.calls)
        # The replay buffer forgot my experience and kept theirs.
        left = [e.feedback_data["user_id"] for e in scheduler.buffer.tree.data if e is not None] \
            if hasattr(scheduler.buffer, "tree") else [e.feedback_data["user_id"] for e in scheduler.buffer.get_all()]
        assert left == [other]
        # The other person's own question and feedback stay; their comment on mine went with it.
        async with sessions[RLCF]() as s:
            kept = (await s.execute(text(
                "SELECT detailed_comment, reviewed_by FROM qa_feedback WHERE user_id = :o"), {"o": other})).all()
        assert [tuple(r) for r in kept] == [("il loro commento", None)]

        # A second run finds nothing and is still complete.
        assert (await erase_user_data(me, graph_client=graph, sessions=sessions))["complete"] is True
    finally:
        await erase_user_data(other, graph_client=FakeGraph(), sessions=sessions)
        await _cleanup(sessions, seeded["tag"], [me, other])


@needs_db
async def test_a_failing_store_makes_the_erasure_incomplete(stores):
    sessions, tmp_path = stores
    me = f"me-{uuid.uuid4()}"

    class DownGraph:
        async def query(self, cypher, params=None):
            raise ConnectionError(f"cannot reach the graph for {params}")

    result = await erase_user_data(me, graph_client=DownGraph(), sessions=sessions)
    assert result["complete"] is False
    # The class only: the message carried the user id.
    assert result["errors"] == {"graph": "ConnectionError"}


@needs_db
async def test_a_buffer_that_cannot_be_saved_makes_the_erasure_incomplete(stores, monkeypatch):
    sessions, tmp_path = stores
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("x")
    monkeypatch.setenv("MERLT_RLCF_BUFFER_PATH", str(blocker / "replay_buffer.json"))
    ts.reset_scheduler()
    result = await erase_user_data(f"me-{uuid.uuid4()}", graph_client=FakeGraph(), sessions=sessions)
    assert result["complete"] is False
    assert result["errors"] == {"rlcf": "RuntimeError"}


async def test_a_file_outside_the_upload_dir_is_never_deleted(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    outside = tmp_path / "elsewhere.txt"
    outside.write_text("x")
    monkeypatch.setenv("UPLOAD_DIR", str(uploads))
    counts: dict = {}
    ud._erase_files([str(outside), str(uploads / ".." / "elsewhere.txt")], counts)
    assert outside.exists()
    assert counts["files.user_documents"] == {"deleted": 0, "refused": 2}


# =============================================================================
# The route
# =============================================================================


def _client(monkeypatch, *, role=None):
    import importlib

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from merlt.api.auth import optional_api_key, verify_api_key
    from merlt.rlcf.database import get_async_session_dep

    router_mod = importlib.import_module("merlt.api.user_data_router")
    calls = []

    async def fake_erase(user_id):
        calls.append(user_id)
        return {"complete": user_id != "down", "counts": {}, "errors": {} if user_id != "down" else {"graph": "X"}}

    monkeypatch.setattr(router_mod, "erase_user_data", fake_erase)
    app = FastAPI()
    app.include_router(router_mod.router, prefix="/api/v1")

    async def no_session():
        yield None

    app.dependency_overrides[get_async_session_dep] = no_session
    if role is None:
        # As in merlt.app: verify_api_key is optional, so only require_role guards.
        app.dependency_overrides[verify_api_key] = optional_api_key
    else:
        app.dependency_overrides[verify_api_key] = lambda: SimpleNamespace(role=role, user_id="svc")
    return TestClient(app), calls


def test_the_route_refuses_a_request_without_a_key(monkeypatch):
    client, calls = _client(monkeypatch)
    assert client.delete("/api/v1/user-data/u1").status_code == 401
    assert client.get("/api/v1/user-data/u1").status_code == 401
    assert calls == []


def test_the_route_refuses_a_key_that_is_not_admin(monkeypatch):
    client, calls = _client(monkeypatch, role="user")
    assert client.delete("/api/v1/user-data/u1").status_code == 403
    assert calls == []


def test_the_route_answers_503_while_a_store_is_not_done(monkeypatch):
    client, calls = _client(monkeypatch, role="admin")
    assert client.delete("/api/v1/user-data/u1").status_code == 200
    down = client.delete("/api/v1/user-data/down")
    assert down.status_code == 503 and down.json()["complete"] is False
    assert calls == ["u1", "down"]
