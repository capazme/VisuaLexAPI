# services/merlt/merlt/scripts/remove_massimario_prose.py
"""Remove the Massimario's prose from MERL-T's stores in one operation (spec §9).

Deletes the Qdrant points of source_type `rassegna` and fonte `Ufficio del
Massimario`, and the bridge rows of source `massimario`. Decisions, norm stubs
and co-citation edges stay: they are facts. Dry run by default.

    python -m merlt.scripts.remove_massimario_prose            # counts only
    python -m merlt.scripts.remove_massimario_prose --apply    # deletes
"""
from __future__ import annotations

import argparse
import asyncio

from merlt.pipeline.massimario.vectors import build_qdrant_client
from merlt.pipeline.massimario.volume import SOURCE
from merlt.storage.graph.schema import Fonte, SourceType


def _filter():
    from qdrant_client import models as qm

    return qm.Filter(must=[
        qm.FieldCondition(key="source_type", match=qm.MatchValue(value=SourceType.RASSEGNA.value)),
        qm.FieldCondition(key="fonte", match=qm.MatchValue(value=Fonte.MASSIMARIO.value)),
    ])


async def remove_prose(*, apply: bool, qdrant, bridge, collection: str) -> dict:
    from qdrant_client import models as qm

    flt = _filter()
    points = (await asyncio.to_thread(qdrant.count, collection_name=collection, count_filter=flt, exact=True)).count
    rows = await bridge.count_by_source(SOURCE)
    if apply:
        await asyncio.to_thread(qdrant.delete, collection_name=collection, points_selector=qm.FilterSelector(filter=flt))
        await bridge.delete_by_source(SOURCE)
    return {"points": points, "bridge_rows": rows, "applied": apply}


async def _main(apply: bool) -> None:
    from merlt.storage.bridge import BridgeTable, BridgeTableConfig
    from merlt.storage.vectors.collection import default_chunks_collection

    bridge = BridgeTable(BridgeTableConfig.from_enrichment_env())
    await bridge.connect()
    try:
        result = await remove_prose(apply=apply, qdrant=build_qdrant_client(), bridge=bridge,
                                    collection=default_chunks_collection())
    finally:
        await bridge.close()
    verb = "cancellati" if apply else "da cancellare (prova a vuoto; --apply per cancellare)"
    print(f"{result['points']} frammenti e {result['bridge_rows']} collegamenti {verb}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    asyncio.run(_main(parser.parse_args(argv).apply))


if __name__ == "__main__":
    main()
