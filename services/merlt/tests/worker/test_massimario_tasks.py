# services/merlt/tests/worker/test_massimario_tasks.py
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from merlt.worker import massimario_tasks


def batch(status="promoted", chunks=250):
    return SimpleNamespace(id="b1", status=status, stats={}, extras={"chunks": [{"point_id": str(i)} for i in range(chunks)]})


def session_for(b):
    @asynccontextmanager
    async def session():
        yield SimpleNamespace(
            execute=AsyncMock(return_value=SimpleNamespace(scalar_one_or_none=lambda: b)),
            commit=AsyncMock(),
        )
    return session


async def run(b, start):
    index = AsyncMock(side_effect=lambda chunks, **kw: len(chunks))
    bridge = MagicMock(connect=AsyncMock(), close=AsyncMock())
    with patch("merlt.storage.enrichment.database.init_db", new=AsyncMock()), \
         patch("merlt.storage.enrichment.database.get_db_session", new=session_for(b)), \
         patch.object(massimario_tasks, "index_chunks", new=index), \
         patch.object(massimario_tasks, "_bridge", return_value=bridge), \
         patch.object(massimario_tasks, "build_qdrant_client", return_value=MagicMock()), \
         patch.object(massimario_tasks, "_embeddings", return_value=MagicMock()), \
         patch.object(massimario_tasks, "enqueue_index_slice") as enqueue:
        result = await massimario_tasks._run_index_slice("b1", start)
    return result, index, enqueue


async def test_a_slice_writes_and_chains_the_next():
    b = batch()
    result, index, enqueue = await run(b, 0)
    assert len(index.await_args.args[0]) == massimario_tasks.SLICE == 100
    assert b.stats["vectors"] == {"done": 100, "total": 250}
    enqueue.assert_called_once_with("b1", 100)


async def test_the_last_slice_stops_the_chain():
    b = batch()
    await run(b, 200)
    assert b.stats["vectors"] == {"done": 250, "total": 250}


async def test_a_batch_not_promoted_is_skipped():
    result, index, enqueue = await run(batch(status="rejected"), 0)
    assert result["status"] == "skipped"
    index.assert_not_awaited()
    enqueue.assert_not_called()
