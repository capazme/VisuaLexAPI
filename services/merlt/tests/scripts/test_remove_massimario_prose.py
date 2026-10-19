# services/merlt/tests/scripts/test_remove_massimario_prose.py
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from merlt.scripts.remove_massimario_prose import remove_prose


def fakes():
    qdrant = MagicMock(count=MagicMock(return_value=SimpleNamespace(count=12)))
    bridge = MagicMock(count_by_source=AsyncMock(return_value=30), delete_by_source=AsyncMock(return_value=30))
    return qdrant, bridge


async def test_dry_run_counts_only():
    qdrant, bridge = fakes()
    assert await remove_prose(apply=False, qdrant=qdrant, bridge=bridge, collection="c") == {
        "points": 12, "bridge_rows": 30, "applied": False,
    }
    qdrant.delete.assert_not_called()
    bridge.delete_by_source.assert_not_awaited()


async def test_apply_deletes_exactly_the_prose():
    qdrant, bridge = fakes()
    await remove_prose(apply=True, qdrant=qdrant, bridge=bridge, collection="c")
    selector = qdrant.delete.call_args.kwargs["points_selector"]
    conditions = {(c.key, c.match.value) for c in selector.filter.must}
    assert conditions == {("source_type", "rassegna"), ("fonte", "Ufficio del Massimario")}
    bridge.delete_by_source.assert_awaited_once_with("massimario")
