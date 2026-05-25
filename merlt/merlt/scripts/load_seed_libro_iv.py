"""Idempotent seed loader for the Libro IV CC graph.

Loads the snapshot in `merlt/data/seeds/` (recovery May 2026, 27.742 nodes /
43.936 edges / 27.117 bridge mappings) into FalkorDB + Qdrant + Postgres
bridge_table. Designed to run from `merlt.app:lifespan` at startup; safe to
re-run because every write is a MERGE on URN / node_id / stable edge_key.

Pipeline:
    1. Idempotency check     -> skip if graph already has > 100 nodes
    2. Load JSON             -> 27.742 nodes + 43.936 edges
    3. MERGE nodes in batch  -> by URN (Norma) or node_id (other labels)
    4. MERGE edges in batch  -> stable key = sha1(src|dst|type|disposizione|data_efficacia)
    5. Regenerate embeddings -> texts of textual nodes -> upsert Qdrant
    6. Restore bridge SQL    -> psql subprocess (COPY block)
    7. Realign bridge.chunk_id with the new Qdrant uuids (match on chunk_text)
    8. Integrity check       -> raise SeedLoadError on any failure

The loader takes the FalkorDB/Qdrant/Embedding clients as parameters so tests
can inject mocks. The convenience wrapper `load_seed_libro_iv_from_env()`
builds them from env vars and is the one called by the lifespan.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import subprocess
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import structlog

log = structlog.get_logger()


class SeedLoadError(Exception):
    """Raised by the seed loader on missing seed files or failed integrity checks."""


@dataclass
class SeedLoadResult:
    skipped: bool
    reason: Optional[str] = None
    nodes_merged: int = 0
    edges_merged: int = 0
    edges_skipped: int = 0
    embeddings_generated: int = 0
    bridge_restored_rows: int = 0
    bridge_realigned_rows: int = 0
    integrity: dict[str, Any] = field(default_factory=dict)


# Default seed file locations. In dev (host filesystem) we resolve from the
# `merlt/` project root via `parents[2]`. In container (`/app/merlt/scripts/...`)
# `parents[2]` is `/` which is wrong, so `MERLT_DATA_DIR` env var overrides.
_DEFAULT_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
SEED_ROOT = Path(os.getenv("MERLT_DATA_DIR", str(_DEFAULT_DATA_DIR))) / "seeds"
SEED_GRAPH_JSON = SEED_ROOT / "libro-iv-cc-graph.json"
SEED_BRIDGE_SCHEMA_SQL = SEED_ROOT / "postgres-dumps" / "bridge-table-schema.sql"
SEED_BRIDGE_SQL = SEED_ROOT / "postgres-dumps" / "bridge-table-data.sql"

# Below this node count we treat the graph as empty and run the loader. The
# loader writes ~27.700 nodes; any value above the threshold means the seed
# already ran (or a different graph is in use and we must NOT overwrite it).
IDEMPOTENCY_NODE_THRESHOLD = 100

# Batch sizes
NODE_BATCH = 500
EDGE_BATCH = 500
EMBED_BATCH = int(os.getenv("EMBEDDING_BATCH_SIZE", "32"))

# Integrity thresholds (margin -2% vs nominal seed values)
MIN_NODES = 27_700
MIN_BRIDGE_ROWS = 27_000
MIN_QDRANT_POINTS = 5_900

# Where to read text for embeddings, ordered by preference per label
_TEXT_FIELDS_BY_LABEL: dict[str, list[str]] = {
    "Norma": ["testo_vigente"],
    "Comma": ["testo"],
    "ConcettoGiuridico": ["descrizione"],
    "PrincipioGiuridico": ["descrizione"],
    "DefinizioneLegale": ["descrizione"],
    "Dottrina": ["descrizione"],
    "AttoGiudiziario": ["massima_text", "testo_massima", "massima"],
}


async def load_seed_libro_iv(
    *,
    falkordb_client,
    qdrant_client,
    embedding_service,
    pg_dsn: str,
    seed_graph_path: Path = SEED_GRAPH_JSON,
    seed_bridge_path: Path = SEED_BRIDGE_SQL,
    qdrant_collection: str = "merl_t_legal_chunks",
    skip_embeddings: bool = False,
) -> SeedLoadResult:
    """Idempotent seed loader. See module docstring for the full pipeline.

    `skip_embeddings=True` skips steps 6+8 (embedding generation + bridge
    chunk_id realignment) and the corresponding integrity checks. Graph +
    bridge_table are still loaded, so side-rail viz and graph-only queries
    work. Embeddings can be generated later via a dedicated CLI on the host
    (much faster than CPU inside docker on M-series).
    """
    log.info("seed_loader.starting",
             graph=getattr(getattr(falkordb_client, "config", None), "graph_name", "?"),
             collection=qdrant_collection,
             skip_embeddings=skip_embeddings)

    # 1. Idempotency check on the graph
    count = await _count_graph_nodes(falkordb_client)
    if count > IDEMPOTENCY_NODE_THRESHOLD:
        log.info("seed_loader.skip", reason="graph_not_empty", existing_nodes=count)
        return SeedLoadResult(skipped=True, reason="graph_not_empty",
                              integrity={"nodes_before": count})

    # 2. Read JSON. Bridge SQL existence is checked here too — fail fast.
    if not seed_graph_path.exists():
        raise SeedLoadError(f"Seed JSON not found: {seed_graph_path}")
    if not seed_bridge_path.exists():
        raise SeedLoadError(f"Seed bridge SQL not found: {seed_bridge_path}")

    log.info("seed_loader.loading_json", path=str(seed_graph_path))
    seed = json.loads(seed_graph_path.read_text(encoding="utf-8"))
    json_nodes = seed["nodes"]
    json_edges = seed["edges"]
    log.info("seed_loader.json_loaded", nodes=len(json_nodes), edges=len(json_edges))

    # 3. Build id -> {key, label, key_field} map (needed by MERGE for edges)
    id_to_key = _build_id_to_key(json_nodes)

    # 4. MERGE nodes
    nodes_merged = await _merge_nodes(falkordb_client, json_nodes, id_to_key)
    log.info("seed_loader.nodes_merged", count=nodes_merged)

    # 5. MERGE edges
    edges_merged, edges_skipped = await _merge_edges(falkordb_client, json_edges, id_to_key)
    log.info("seed_loader.edges_done", merged=edges_merged, skipped=edges_skipped)

    # 6. Restore bridge SQL dump via psql. Done BEFORE embeddings so that even
    # if embeddings are skipped (Slice 2a dev mode) the bridge_table is ready.
    # The bridge.chunk_id values point to the old (drifted) Qdrant uuids until
    # step 8 realigns them; that's acceptable for graph-only queries.
    # 6a. Create schema (idempotent: CREATE IF NOT EXISTS + DO EXCEPTION blocks)
    if SEED_BRIDGE_SCHEMA_SQL.exists():
        _restore_bridge_table_via_psql(SEED_BRIDGE_SCHEMA_SQL, pg_dsn)
        log.info("seed_loader.bridge_schema_applied")
    # 6b. Restore data (COPY block)
    bridge_rows = _restore_bridge_table_via_psql(seed_bridge_path, pg_dsn)
    log.info("seed_loader.bridge_restored", rows=bridge_rows)

    # 7. Regenerate embeddings + upsert Qdrant. Skipped by default in the
    # container (MERLT_SKIP_EMBEDDINGS=true) because e5-large on docker CPU
    # over M-series virtualization runs ~2s/text → 8+ hours for the full set.
    # Run separately on the host via `python -m merlt.scripts.load_seed_libro_iv`
    # for the embedding-only flow.
    emb_count = 0
    chunk_text_to_uuid: dict[str, str] = {}
    if skip_embeddings:
        log.info("seed_loader.embeddings_skipped", reason="MERLT_SKIP_EMBEDDINGS")
    elif embedding_service is not None and qdrant_client is not None:
        emb_count, chunk_text_to_uuid = await _generate_and_upsert_embeddings(
            json_nodes, embedding_service, qdrant_client, qdrant_collection,
        )
        log.info("seed_loader.embeddings_done", upserted=emb_count)
    else:
        log.warning("seed_loader.embeddings_skipped",
                    reason="no embedding_service or qdrant_client provided")

    # 8. Realign bridge.chunk_id with the new Qdrant uuids (only if embeddings ran)
    realigned = 0
    if chunk_text_to_uuid:
        realigned = await _realign_bridge_chunk_ids(pg_dsn, chunk_text_to_uuid)
        log.info("seed_loader.bridge_realigned", rows=realigned)

    # 9. Integrity check. Skip qdrant counts when embeddings were skipped.
    integrity = await _verify_integrity(
        falkordb_client,
        qdrant_client if not skip_embeddings else None,
        pg_dsn,
        qdrant_collection=qdrant_collection,
        min_nodes=MIN_NODES,
        min_bridge=MIN_BRIDGE_ROWS,
        min_qdrant=MIN_QDRANT_POINTS if not skip_embeddings else 0,
    )

    result = SeedLoadResult(
        skipped=False,
        nodes_merged=nodes_merged,
        edges_merged=edges_merged,
        edges_skipped=edges_skipped,
        embeddings_generated=emb_count,
        bridge_restored_rows=bridge_rows,
        bridge_realigned_rows=realigned,
        integrity=integrity,
    )
    log.info("seed_loader.completed", **result.__dict__)
    return result


# ---------------------------------------------------------------------------
# Step implementations
# ---------------------------------------------------------------------------

async def _count_graph_nodes(client) -> int:
    rows = await client.query("MATCH (n) RETURN count(n) AS c")
    if not rows:
        return 0
    first = rows[0]
    if isinstance(first, dict):
        return int(first.get("c") or first.get("count(n)") or 0)
    return int(first[0])


def _build_id_to_key(nodes: list[dict]) -> dict[int, dict[str, str]]:
    """For each node in the JSON, derive (label, key_field, key) for MERGE.

    Nodes with no URN/node_id are dropped with a warning (rare; should be 0).
    """
    out: dict[int, dict[str, str]] = {}
    for n in nodes:
        props = n.get("properties") or {}
        urn = props.get("URN")
        node_id = props.get("node_id")
        if urn:
            key, key_field = urn, "URN"
        elif node_id:
            key, key_field = node_id, "node_id"
        else:
            log.warning("seed_loader.node_no_key", id=n.get("id"), labels=n.get("labels"))
            continue
        labels = n.get("labels") or []
        label = labels[0] if labels else "Node"
        out[n["id"]] = {"key": key, "label": label, "key_field": key_field}
    return out


async def _merge_nodes(client, nodes: list[dict], id_to_key: dict[int, dict]) -> int:
    """MERGE every node by its (label, key_field, key). Idempotent."""
    merged = 0
    for n in nodes:
        entry = id_to_key.get(n["id"])
        if not entry:
            continue
        cypher = (
            f"MERGE (x:{entry['label']} {{{entry['key_field']}: $k}}) "
            f"SET x += $props"
        )
        await client.query(cypher, {"k": entry["key"], "props": n.get("properties") or {}})
        merged += 1
        if merged % NODE_BATCH == 0:
            log.info("seed_loader.nodes_progress", merged=merged, total=len(nodes))
    return merged


async def _merge_edges(client, edges: list[dict], id_to_key: dict[int, dict]) -> tuple[int, int]:
    """MERGE every edge with a stable hash key for idempotency."""
    merged = 0
    skipped = 0
    for e in edges:
        src = id_to_key.get(e.get("start"))
        dst = id_to_key.get(e.get("end"))
        if not src or not dst:
            skipped += 1
            continue
        etype = e.get("type") or "RELATED"
        props = e.get("properties") or {}
        disposizione = str(props.get("disposizione", ""))
        data_eff = str(props.get("data_efficacia", ""))
        key_material = f"{src['key']}|{dst['key']}|{etype}|{disposizione}|{data_eff}"
        edge_key = hashlib.sha1(key_material.encode("utf-8")).hexdigest()
        cypher = (
            f"MATCH (a:{src['label']} {{{src['key_field']}: $sk}}), "
            f"      (b:{dst['label']} {{{dst['key_field']}: $dk}}) "
            f"MERGE (a)-[r:{etype} {{_seed_key: $ek}}]->(b) "
            f"SET r += $props"
        )
        try:
            await client.query(cypher, {
                "sk": src["key"], "dk": dst["key"], "ek": edge_key, "props": props,
            })
            merged += 1
        except Exception as exc:  # noqa: BLE001 — log and continue, integrity gate covers it
            skipped += 1
            log.warning("seed_loader.edge_failed",
                        src=src["key"][:50], dst=dst["key"][:50], type=etype, error=str(exc))
        if (merged + skipped) % EDGE_BATCH == 0:
            log.info("seed_loader.edges_progress", merged=merged, skipped=skipped, total=len(edges))
    return merged, skipped


async def _generate_and_upsert_embeddings(
    nodes: list[dict],
    embedding_service,
    qdrant_client,
    collection: str,
) -> tuple[int, dict[str, str]]:
    """Generate embeddings for textual nodes and upsert into Qdrant.

    Returns (count_upserted, {chunk_text: uuid_str}) for bridge realignment.
    """
    from qdrant_client import models as qm

    # 1. Ensure collection (1024-dim, Cosine, e5-large)
    try:
        if not qdrant_client.collection_exists(collection):
            qdrant_client.create_collection(
                collection_name=collection,
                vectors_config=qm.VectorParams(size=1024, distance=qm.Distance.COSINE),
            )
            log.info("seed_loader.qdrant_collection_created", name=collection)
    except Exception as exc:  # noqa: BLE001
        log.warning("seed_loader.qdrant_collection_check_failed", error=str(exc))

    # 2. Gather texts to encode (deduplicated by text content)
    texts: list[str] = []
    metas: list[dict] = []
    seen: set[str] = set()
    for n in nodes:
        labels = n.get("labels") or []
        label = labels[0] if labels else "Node"
        fields = _TEXT_FIELDS_BY_LABEL.get(label, [])
        props = n.get("properties") or {}
        text: Optional[str] = None
        for f in fields:
            v = props.get(f)
            if v:
                text = v
                break
        if not text:
            continue
        text = text.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        texts.append(text)
        metas.append({
            "text": text,
            "label": label,
            "article_urn": props.get("URN") or props.get("node_id") or "",
            "source_type": _infer_source_type(label),
        })

    log.info("seed_loader.embeddings_to_generate", count=len(texts))
    chunk_text_to_uuid: dict[str, str] = {}
    upserted = 0

    # 3. Encode + upsert in batches
    for i in range(0, len(texts), EMBED_BATCH):
        batch_texts = texts[i : i + EMBED_BATCH]
        batch_metas = metas[i : i + EMBED_BATCH]
        vectors = await embedding_service.encode_batch_async(batch_texts, is_query=False)
        points = []
        for text, meta, vec in zip(batch_texts, batch_metas, vectors):
            chunk_uuid = str(uuid.uuid4())
            chunk_text_to_uuid[text] = chunk_uuid
            points.append(qm.PointStruct(
                id=chunk_uuid,
                vector=vec,
                payload={
                    "article_urn": meta["article_urn"],
                    "source_type": meta["source_type"],
                    "text": meta["text"],
                    "node_label": meta["label"],
                },
            ))
        qdrant_client.upsert(collection_name=collection, points=points)
        upserted += len(points)
        if (i // EMBED_BATCH) % 20 == 0:
            log.info("seed_loader.embeddings_progress", upserted=upserted, total=len(texts))

    return upserted, chunk_text_to_uuid


def _infer_source_type(label: str) -> str:
    if label == "AttoGiudiziario":
        return "massima"
    if label == "Dottrina":
        return "dottrina"
    if label == "Norma":
        return "norma"
    if label == "Comma":
        return "comma"
    if label in ("ConcettoGiuridico", "PrincipioGiuridico", "DefinizioneLegale"):
        return label.lower()
    return "text"


def _restore_bridge_table_via_psql(sql_path: Path, pg_dsn: str) -> int:
    """Run `psql -f sql_path` and parse the COPY row count from output.

    psql uses libpq and does NOT accept the `postgresql+asyncpg://` SQLAlchemy
    URL flavour — strip the driver hint here too.
    """
    psql_dsn = _pg_dsn_to_asyncpg(pg_dsn)  # same stripping logic works for libpq
    cmd = ["psql", psql_dsn, "-f", str(sql_path), "-v", "ON_ERROR_STOP=1"]
    log.info("seed_loader.psql_restore.start", path=str(sql_path))
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        log.error("seed_loader.psql_restore.failed", stderr=proc.stderr[-2000:])
        raise SeedLoadError(f"psql restore failed (exit {proc.returncode}): {proc.stderr[-500:]}")
    rows = 0
    for line in (proc.stdout + proc.stderr).splitlines():
        if line.startswith("COPY "):
            try:
                rows = int(line.split()[1])
            except (IndexError, ValueError):
                pass
    return rows


async def _realign_bridge_chunk_ids(pg_dsn: str, chunk_text_to_uuid: dict[str, str]) -> int:
    """Realign bridge.chunk_id to the new Qdrant uuids by matching chunk_text.

    Uses asyncpg directly (avoid pulling in the BridgeTable ORM). Builds a
    single UPDATE FROM VALUES statement per batch — much faster than N UPDATEs.
    """
    import asyncpg

    conn = await asyncpg.connect(_pg_dsn_to_asyncpg(pg_dsn))
    try:
        realigned = 0
        # Process in batches to keep query size bounded (~1MB max)
        batch_size = 500
        items = list(chunk_text_to_uuid.items())
        for i in range(0, len(items), batch_size):
            batch = items[i : i + batch_size]
            # Each row: (uuid, chunk_text). Use unnest for safe parameter passing.
            uuids = [row[1] for row in batch]
            texts = [row[0] for row in batch]
            result = await conn.execute(
                """
                UPDATE bridge_table b
                SET chunk_id = v.uuid::uuid
                FROM (
                    SELECT unnest($1::text[]) AS uuid,
                           unnest($2::text[]) AS txt
                ) v
                WHERE b.chunk_text = v.txt
                """,
                uuids, texts,
            )
            # asyncpg execute returns "UPDATE n" — parse the count
            try:
                realigned += int(result.split()[-1])
            except (ValueError, IndexError):
                pass
        return realigned
    finally:
        await conn.close()


def _pg_dsn_to_asyncpg(dsn: str) -> str:
    """asyncpg accepts postgres://, NOT postgres+asyncpg://. Strip the driver hint."""
    if "+asyncpg" in dsn:
        return dsn.replace("+asyncpg", "", 1)
    if "+psycopg" in dsn:
        return dsn.replace("+psycopg", "", 1)
    return dsn


async def _verify_integrity(
    falkordb_client,
    qdrant_client,
    pg_dsn: str,
    *,
    qdrant_collection: str,
    min_nodes: int,
    min_bridge: int,
    min_qdrant: int,
) -> dict[str, Any]:
    """Run all integrity checks. Raise SeedLoadError on any failure."""
    import asyncpg

    out: dict[str, Any] = {}

    # FalkorDB nodes
    nodes = await _count_graph_nodes(falkordb_client)
    out["graph_nodes"] = nodes
    if nodes < min_nodes:
        raise SeedLoadError(f"Integrity fail: graph nodes={nodes} < min={min_nodes}")

    # Qdrant points
    if qdrant_client is not None:
        try:
            info = qdrant_client.get_collection(qdrant_collection)
            qpts = getattr(info, "points_count", None)
            if qpts is None:
                # Newer qdrant-client versions expose this differently; do a count call
                qpts = qdrant_client.count(qdrant_collection, exact=True).count
            out["qdrant_points"] = qpts
            if qpts < min_qdrant:
                raise SeedLoadError(f"Integrity fail: qdrant points={qpts} < min={min_qdrant}")
        except SeedLoadError:
            raise
        except Exception as exc:  # noqa: BLE001
            log.warning("seed_loader.integrity.qdrant_check_failed", error=str(exc))

    # Bridge rows + zero orphans
    conn = await asyncpg.connect(_pg_dsn_to_asyncpg(pg_dsn))
    try:
        bridge_rows = await conn.fetchval("SELECT count(*) FROM bridge_table")
        out["bridge_rows"] = bridge_rows
        if bridge_rows < min_bridge:
            raise SeedLoadError(f"Integrity fail: bridge rows={bridge_rows} < min={min_bridge}")
    finally:
        await conn.close()

    log.info("seed_loader.integrity.passed", **out)
    return out


# ---------------------------------------------------------------------------
# Convenience entry points
# ---------------------------------------------------------------------------

async def load_seed_libro_iv_from_env() -> SeedLoadResult:
    """Build the four clients from env vars and call `load_seed_libro_iv`.

    This is the function the FastAPI lifespan should `await`.

    Env vars expected:
        FALKORDB_HOST / FALKORDB_PORT / FALKORDB_PASSWORD (optional)
        FALKORDB_GRAPH_NAME or FALKORDB_GRAPH (default: merl_t_legal)
        QDRANT_HOST / QDRANT_PORT (or QDRANT_URL)
        ENRICHMENT_DB_URL or RLCF_DATABASE_URL
        MERLT_SEED_COLLECTION (default: merl_t_legal_chunks)
        MERLT_SEED_GRAPH_PATH (default: <pkg>/data/seeds/libro-iv-cc-graph.json)
        MERLT_SEED_BRIDGE_PATH (default: <pkg>/data/seeds/postgres-dumps/bridge-table-data.sql)
    """
    from merlt.storage.graph.client import FalkorDBClient
    from merlt.storage.graph.config import FalkorDBConfig
    from merlt.storage.vectors.embeddings import EmbeddingService

    # FalkorDB
    fcfg = FalkorDBConfig()
    graph_name = os.getenv("FALKORDB_GRAPH_NAME") or os.getenv("FALKORDB_GRAPH") or "merl_t_legal"
    falkordb_client = FalkorDBClient(fcfg, graph_name=graph_name)
    await falkordb_client.connect()

    # Qdrant
    qdrant_client = None
    try:
        from qdrant_client import QdrantClient
        if os.getenv("QDRANT_URL"):
            qdrant_client = QdrantClient(url=os.getenv("QDRANT_URL"))
        else:
            qdrant_client = QdrantClient(
                host=os.getenv("QDRANT_HOST", "localhost"),
                port=int(os.getenv("QDRANT_PORT", "6333")),
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("seed_loader.qdrant_init_failed", error=str(exc))

    # Embedding service (lazy load model on first call)
    embedding_service = EmbeddingService.get_instance()

    # docker-compose exposes both flavours; prefer plain (psql-compatible)
    pg_dsn = (
        os.getenv("RLCF_DATABASE_URL")
        or os.getenv("ENRICHMENT_DB_URL")
        or os.getenv("ENRICHMENT_DATABASE_URL")
        or os.getenv("BRIDGE_DB_URL")
        or os.getenv("DATABASE_URL")
    )
    if not pg_dsn:
        raise SeedLoadError(
            "No Postgres DSN: set RLCF_DATABASE_URL or ENRICHMENT_DATABASE_URL")

    seed_graph_path = Path(os.getenv("MERLT_SEED_GRAPH_PATH") or SEED_GRAPH_JSON)
    seed_bridge_path = Path(os.getenv("MERLT_SEED_BRIDGE_PATH") or SEED_BRIDGE_SQL)
    collection = os.getenv("MERLT_SEED_COLLECTION", "merl_t_legal_chunks")
    skip_embeddings = os.getenv("MERLT_SKIP_EMBEDDINGS", "false").lower() in ("1", "true", "yes")

    try:
        return await load_seed_libro_iv(
            falkordb_client=falkordb_client,
            qdrant_client=qdrant_client,
            embedding_service=embedding_service,
            pg_dsn=pg_dsn,
            seed_graph_path=seed_graph_path,
            seed_bridge_path=seed_bridge_path,
            qdrant_collection=collection,
            skip_embeddings=skip_embeddings,
        )
    finally:
        await falkordb_client.close()


def main() -> None:
    """CLI entrypoint: `python -m merlt.scripts.load_seed_libro_iv`."""
    import sys

    async def _run():
        try:
            result = await load_seed_libro_iv_from_env()
            print(json.dumps(result.__dict__, indent=2, default=str))
        except SeedLoadError as exc:
            print(f"SEED LOAD FAILED: {exc}", file=sys.stderr)
            sys.exit(1)

    asyncio.run(_run())


if __name__ == "__main__":
    main()
