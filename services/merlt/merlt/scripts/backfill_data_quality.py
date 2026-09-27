"""One-time data-quality backfill (slice3-ux data-quality-plan, "Backfill").

Repairs the two classes of dirty data that leaked into the community surfaces
before the Fase 2 write-side gates (A2 stub enrichment + B2 name gate) landed:

    1. Delete ``pending_entities`` rows whose ``entity_text`` matches the junk
       signatures. Reuses the SAME predicate the write / read gates use
       (:func:`merlt.pipeline.enrichment.quality.is_valid_entity_name`) so the
       backfill can never disagree with the live gate.
    2. Repopulate ``estremi`` / ``numero_articolo`` on existing FalkorDB
       ``Norma`` nodes where they are NULL/empty, deriving the values from the
       node URN. Reuses the SAME A2 derivation
       (:func:`merlt.utils.urn_labels.derive_article_fields_from_urn`) so a
       backfilled stub is identical to one written by ``entity_writer`` on the
       ``ON CREATE`` branch.

Design guarantees:
    - **Idempotent.** Re-running deletes nothing (junk already gone) and updates
      nothing (stubs already populated). Both steps are gated on the same
      "still dirty?" predicate they use to decide the fix.
    - **Rich nodes untouched.** The FalkorDB ``SET`` is guarded per-field with
      ``WHERE (n.estremi IS NULL OR n.estremi = '') ...`` so a node that already
      carries an ``estremi``/``numero_articolo`` is never overwritten, and nodes
      whose URN has no ``~art`` segment (act/document-level) are skipped
      entirely (the derivation returns ``(None, None)``).
    - **``--dry-run``** only counts — no DELETE, no SET is issued.
    - **Structured logging** reports how many rows would be / were deleted and
      how many nodes would be / were updated.

Connection setup mirrors ``load_seed_libro_iv.py``:
    - FalkorDB via :class:`merlt.storage.graph.client.FalkorDBClient` +
      ``FALKORDB_*`` env (graph name from ``FALKORDB_GRAPH_NAME`` /
      ``FALKORDB_GRAPH``, default ``merl_t_legal``).
    - Postgres via ``init_db()`` + ``get_db_session()`` from
      ``merlt.storage.enrichment.database`` (the RLCF / enrichment DB). The RQ
      worker has no FastAPI lifespan, and neither does this CLI, so we call
      ``init_db()`` explicitly (idempotent — guarded on ``_engine is not None``).

Run (post-rebuild, inside the merlt-api container):

    docker compose -f docker-compose.merlt.yml exec merlt-api \\
        python -m merlt.scripts.backfill_data_quality

Dry-run first to see the counts without mutating anything:

    docker compose -f docker-compose.merlt.yml exec merlt-api \\
        python -m merlt.scripts.backfill_data_quality --dry-run
"""

from __future__ import annotations

import argparse
import asyncio
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import structlog
from sqlalchemy import delete, select

from merlt.pipeline.enrichment.quality import is_valid_entity_name
from merlt.utils.urn_labels import derive_article_fields_from_urn

log = structlog.get_logger()


@dataclass
class BackfillResult:
    dry_run: bool
    # Step 1 — pending_entities junk cleanup
    pending_scanned: int = 0
    pending_junk: int = 0
    pending_deleted: int = 0
    # Step 2 — FalkorDB Norma stub enrichment
    nodes_scanned: int = 0
    nodes_needing_fill: int = 0
    nodes_updated: int = 0
    nodes_no_article_segment: int = 0
    examples: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Step 1 — delete junk pending_entities (Postgres / enrichment DB)
# ---------------------------------------------------------------------------

async def _cleanup_pending_entities(result: BackfillResult) -> None:
    """Delete ``pending_entities`` rows failing the shared name gate.

    Uses the ORM model so the exact table/columns match the write path, and
    relies on the ``entity_votes`` FK ``ON DELETE CASCADE`` (see
    ``models.EntityVote.entity_id``) to remove dependent votes. Junk detection
    is fully delegated to :func:`is_valid_entity_name` — no local heuristics.
    """
    # Imported lazily so the module import stays cheap and the Postgres deps are
    # only pulled when the script actually runs.
    from merlt.storage.enrichment.database import get_db_session, init_db
    from merlt.storage.enrichment.models import PendingEntity

    await init_db()  # idempotent (guarded on _engine is not None)

    junk_ids: list[str] = []
    junk_examples: list[str] = []

    async with get_db_session() as session:
        rows = (
            await session.execute(
                select(
                    PendingEntity.entity_id,
                    PendingEntity.entity_text,
                    PendingEntity.entity_type,
                )
            )
        ).all()

        result.pending_scanned = len(rows)

        for entity_id, entity_text, entity_type in rows:
            if not is_valid_entity_name(entity_text, entity_type):
                junk_ids.append(entity_id)
                if len(junk_examples) < 10:
                    preview = (str(entity_text) or "").strip().replace("\n", " ")
                    junk_examples.append(preview[:80])

        result.pending_junk = len(junk_ids)
        result.examples["pending_junk_samples"] = junk_examples

        if result.dry_run:
            log.info(
                "backfill.pending.dry_run",
                scanned=result.pending_scanned,
                junk=result.pending_junk,
                samples=junk_examples,
            )
            return

        if not junk_ids:
            log.info("backfill.pending.nothing_to_delete", scanned=result.pending_scanned)
            return

        # Delete in bounded batches (entity_votes cascade at the DB level).
        batch = 500
        deleted = 0
        for i in range(0, len(junk_ids), batch):
            chunk = junk_ids[i : i + batch]
            res = await session.execute(
                delete(PendingEntity).where(PendingEntity.entity_id.in_(chunk))
            )
            deleted += res.rowcount or 0
        # get_db_session commits on context exit.

        result.pending_deleted = deleted
        log.info(
            "backfill.pending.deleted",
            scanned=result.pending_scanned,
            junk=result.pending_junk,
            deleted=deleted,
        )


# ---------------------------------------------------------------------------
# Step 2 — repopulate estremi/numero_articolo on Norma stubs (FalkorDB)
# ---------------------------------------------------------------------------

def _is_empty(value: Any) -> bool:
    """A property is 'empty' when NULL or a blank/whitespace string."""
    return value is None or (isinstance(value, str) and not value.strip())


async def _enrich_norma_stubs(result: BackfillResult) -> None:
    """Fill ``estremi``/``numero_articolo`` on Norma nodes missing either.

    Only nodes whose URN yields a valid article number are touched; the derived
    values are written back with a per-field guard so an already-populated field
    is never overwritten (matches the ``ON CREATE SET`` semantics of A2).
    """
    from merlt.storage.graph.client import FalkorDBClient
    from merlt.storage.graph.config import FalkorDBConfig

    fcfg = FalkorDBConfig()
    graph_name = (
        os.getenv("FALKORDB_GRAPH_NAME")
        or os.getenv("FALKORDB_GRAPH")
        or "merl_t_legal"
    )
    client = FalkorDBClient(fcfg, graph_name=graph_name)
    await client.connect()
    try:
        # Candidate nodes: a Norma with URN whose estremi OR numero_articolo is
        # missing. Fetch id + both fields so we decide per-field in Python and
        # reuse the shared derivation (rather than re-implementing the regex in
        # Cypher).
        rows = await client.query(
            """
            MATCH (n:Norma)
            WHERE n.URN IS NOT NULL
              AND (
                n.estremi IS NULL OR n.estremi = '' OR
                n.numero_articolo IS NULL OR n.numero_articolo = ''
              )
            RETURN n.URN AS urn, n.estremi AS estremi, n.numero_articolo AS numero_articolo
            """
        )

        result.nodes_scanned = len(rows)

        # Build the list of (urn, numero, estremi) actually fixable.
        to_update: list[tuple[str, Optional[str], Optional[str]]] = []
        no_segment = 0
        fill_examples: list[str] = []

        for row in rows:
            urn = row.get("urn")
            if not urn:
                continue
            numero, estremi = derive_article_fields_from_urn(urn)
            if numero is None:
                # Act/document-level URN with no ~art segment — cannot derive,
                # leave untouched (never invent bogus data).
                no_segment += 1
                continue
            # Only set the fields that are actually empty (guard preserves rich
            # values). At least one is empty (WHERE clause guaranteed it).
            set_numero = numero if _is_empty(row.get("numero_articolo")) else None
            set_estremi = estremi if _is_empty(row.get("estremi")) else None
            if set_numero is None and set_estremi is None:
                continue
            to_update.append((urn, set_numero, set_estremi))
            if len(fill_examples) < 10:
                fill_examples.append(f"{urn[-40:]} -> {estremi}")

        result.nodes_no_article_segment = no_segment
        result.nodes_needing_fill = len(to_update)
        result.examples["stub_fill_samples"] = fill_examples

        if result.dry_run:
            log.info(
                "backfill.norma.dry_run",
                scanned=result.nodes_scanned,
                needing_fill=result.nodes_needing_fill,
                no_article_segment=no_segment,
                samples=fill_examples,
            )
            return

        if not to_update:
            log.info(
                "backfill.norma.nothing_to_fill",
                scanned=result.nodes_scanned,
                no_article_segment=no_segment,
            )
            return

        # Apply per-node. Each SET is guarded so a concurrent/rich value is not
        # clobbered (defensive re-check of the IS NULL/empty condition in Cypher
        # too). Uses coalesce to write only when currently empty.
        updated = 0
        for urn, set_numero, set_estremi in to_update:
            await client.query(
                """
                MATCH (n:Norma {URN: $urn})
                SET n.numero_articolo = CASE
                        WHEN ($numero IS NOT NULL AND
                              (n.numero_articolo IS NULL OR n.numero_articolo = ''))
                        THEN $numero ELSE n.numero_articolo END,
                    n.estremi = CASE
                        WHEN ($estremi IS NOT NULL AND
                              (n.estremi IS NULL OR n.estremi = ''))
                        THEN $estremi ELSE n.estremi END
                """,
                {"urn": urn, "numero": set_numero, "estremi": set_estremi},
            )
            updated += 1
            if updated % 500 == 0:
                log.info("backfill.norma.progress", updated=updated, total=len(to_update))

        result.nodes_updated = updated
        log.info(
            "backfill.norma.updated",
            scanned=result.nodes_scanned,
            needing_fill=result.nodes_needing_fill,
            updated=updated,
            no_article_segment=no_segment,
        )
    finally:
        await client.close()


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

async def run_backfill(dry_run: bool) -> BackfillResult:
    """Run both backfill steps and return the aggregated counts."""
    result = BackfillResult(dry_run=dry_run)
    log.info("backfill.starting", dry_run=dry_run)

    await _cleanup_pending_entities(result)
    await _enrich_norma_stubs(result)

    log.info(
        "backfill.completed",
        dry_run=dry_run,
        pending_scanned=result.pending_scanned,
        pending_junk=result.pending_junk,
        pending_deleted=result.pending_deleted,
        nodes_scanned=result.nodes_scanned,
        nodes_needing_fill=result.nodes_needing_fill,
        nodes_updated=result.nodes_updated,
        nodes_no_article_segment=result.nodes_no_article_segment,
    )
    return result


def main() -> None:
    """CLI entrypoint: ``python -m merlt.scripts.backfill_data_quality``."""
    parser = argparse.ArgumentParser(
        description="One-time MERL-T data-quality backfill "
        "(delete junk pending_entities + repopulate empty Norma stubs).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only count what would change; issue no DELETE / SET.",
    )
    args = parser.parse_args()

    asyncio.run(run_backfill(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
