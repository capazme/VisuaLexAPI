"""One-time, idempotent backfill of `provenance`/`trust` on seed nodes.

The Libro IV CC seed (loaded by `load_seed_libro_iv.py`, ~27.7k nodes) predates
the Loop β provenance model (task B.1) and therefore carries NO `provenance`
property. Every NEW write surface now stamps `provenance`/`trust`:
    - `community_validated` / 1.0  (storage/graph/entity_writer.py)
    - `lazy_ingest`         / 0.6  (pipeline/ingestion.py)

This script stamps the remaining un-stamped nodes — which can only be the seed
snapshot — as `provenance='seed'`, `trust=1.0` (seed data is the curated Libro IV
graph, so it ranks as high-trust alongside community-validated content).

Idempotency: the MATCH is gated on `n.provenance IS NULL`, so a re-run touches
only nodes that are still un-stamped (zero on the second run). It NEVER changes a
node that already has any provenance, so it can never downgrade `lazy_ingest`
nodes created after the seed load.

Run inside the merlt-api container:
    python -m merlt.scripts.backfill_provenance_seed

Env vars (same as the seed loader):
    FALKORDB_HOST / FALKORDB_PORT / FALKORDB_PASSWORD (optional)
    FALKORDB_GRAPH_NAME or FALKORDB_GRAPH (default: merl_t_legal)
"""

from __future__ import annotations

import asyncio
import json
import os

import structlog

log = structlog.get_logger()


# Seed nodes are the curated Libro IV snapshot → highest trust band.
SEED_PROVENANCE = "seed"
SEED_TRUST = 1.0

# Backfill in bounded batches so a single very large SET doesn't block the graph.
BACKFILL_BATCH = 1000


async def _count_null_provenance(client) -> int:
    """Count nodes still missing a `provenance` property."""
    rows = await client.query(
        "MATCH (n) WHERE n.provenance IS NULL RETURN count(n) AS c"
    )
    if not rows:
        return 0
    first = rows[0]
    if isinstance(first, dict):
        return int(first.get("c") or first.get("count(n)") or 0)
    return int(first[0])


async def backfill_provenance_seed(*, falkordb_client) -> dict:
    """Stamp `provenance='seed', trust=1.0` on every null-provenance node.

    Args:
        falkordb_client: a connected FalkorDBClient.

    Returns:
        Stats dict with `before`, `updated`, and `remaining` counts.
    """
    before = await _count_null_provenance(falkordb_client)
    log.info("backfill_provenance.start", null_provenance_nodes=before)

    updated = 0
    if before > 0:
        # FalkorDB has no native LIMIT-in-SET; loop in batches via WITH/LIMIT.
        # Each pass stamps up to BACKFILL_BATCH still-null nodes; repeat until the
        # null count hits zero. This keeps every individual write bounded and the
        # whole loop idempotent (the WHERE re-filters on every pass).
        # `BACKFILL_BATCH` is a trusted module constant (int) inlined into the
        # query because FalkorDB's Cypher dialect does not support a
        # parameterized LIMIT — no injection surface (not user input).
        batch_query = f"""
            MATCH (n)
            WHERE n.provenance IS NULL
            WITH n LIMIT {int(BACKFILL_BATCH)}
            SET n.provenance = $provenance, n.trust = $trust
            RETURN count(n) AS c
            """
        while True:
            result = await falkordb_client.query(
                batch_query,
                {
                    "provenance": SEED_PROVENANCE,
                    "trust": SEED_TRUST,
                },
            )
            batch_updated = 0
            if result:
                first = result[0]
                if isinstance(first, dict):
                    batch_updated = int(first.get("c") or 0)
                else:
                    batch_updated = int(first[0])
            updated += batch_updated
            log.info("backfill_provenance.batch", batch_updated=batch_updated, total=updated)
            if batch_updated == 0:
                break

    remaining = await _count_null_provenance(falkordb_client)
    stats = {"before": before, "updated": updated, "remaining": remaining}
    log.info("backfill_provenance.done", **stats)
    return stats


async def backfill_provenance_seed_from_env() -> dict:
    """Build the FalkorDB client from env vars and run the backfill.

    Mirrors `load_seed_libro_iv_from_env()` so it connects to the SAME graph.
    """
    from merlt.storage.graph.client import FalkorDBClient
    from merlt.storage.graph.config import FalkorDBConfig

    fcfg = FalkorDBConfig()
    graph_name = (
        os.getenv("FALKORDB_GRAPH_NAME")
        or os.getenv("FALKORDB_GRAPH")
        or "merl_t_legal"
    )
    falkordb_client = FalkorDBClient(fcfg, graph_name=graph_name)
    await falkordb_client.connect()
    try:
        return await backfill_provenance_seed(falkordb_client=falkordb_client)
    finally:
        await falkordb_client.close()


def main() -> None:
    """CLI entrypoint: `python -m merlt.scripts.backfill_provenance_seed`."""

    async def _run():
        stats = await backfill_provenance_seed_from_env()
        print(json.dumps(stats, indent=2, default=str))

    asyncio.run(_run())


if __name__ == "__main__":
    main()
