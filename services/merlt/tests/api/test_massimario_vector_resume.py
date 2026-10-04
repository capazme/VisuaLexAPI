"""A promoted Massimario batch whose vectors stopped half-way can be promoted again."""
import importlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

# merlt.api re-exports the APIRouter under the module's own name: import the module itself
routes = importlib.import_module("merlt.api.ingestion_mechanical_router")


def batch(status="promoted", source="massimario", vectors=None):
    return SimpleNamespace(
        id="b1", status=status, source=source, expires_at=None, conflict_report={"urn_conflicts": []},
        stats={"vectors": vectors} if vectors is not None else {},
    )


def session_for(b):
    return SimpleNamespace(
        get=AsyncMock(return_value=b),
        execute=AsyncMock(return_value=SimpleNamespace(rowcount=1)),
        commit=AsyncMock(),
        rollback=AsyncMock(),
    )


async def promote(b):
    queue = MagicMock()
    with patch.object(routes, "_get_queue", return_value=queue):
        return await routes.promote_batch_endpoint(
            "b1", routes.PromoteRequest(force=False, reviewed_by="admin"), session=session_for(b), api_key=None,
        ), queue


@pytest.mark.parametrize("vectors", [
    {"done": 300, "total": 1360, "error": "ReadTimeout"},
    {"done": 300, "total": 1360},
    {"done": 0, "total": 1360},
])
async def test_incomplete_vectors_can_be_resumed(vectors):
    response, queue = await promote(batch(vectors=vectors))
    assert response.status == "promoting"
    queue.enqueue.assert_called_once()


@pytest.mark.parametrize("b", [
    batch(vectors={"done": 1360, "total": 1360}),
    batch(source="visualex_tree"),
    batch(status="rejected", vectors={"done": 0, "total": 10}),
])
async def test_other_batches_are_not_promoted_again(b):
    with pytest.raises(HTTPException) as caught:
        await promote(b)
    assert caught.value.status_code == 409
