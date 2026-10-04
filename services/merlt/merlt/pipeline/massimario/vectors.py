# services/merlt/merlt/pipeline/massimario/vectors.py
"""Embed a slice of Massimario chunks, then write their points and bridge rows together.

Points first, bridge rows second: the reader joins the bridge to the points, so
it never meets a row whose point is missing. Points are upserts on stable ids and
a chunk's bridge rows are replaced as a whole, so a slice can be re-run, even
after a parser fix that drops a link.
"""
from __future__ import annotations

import asyncio
import os

import structlog

from .volume import SOURCE

log = structlog.get_logger()


def build_qdrant_client():
    from qdrant_client import QdrantClient

    url = os.getenv("QDRANT_URL")
    if url:
        return QdrantClient(url=url)
    return QdrantClient(host=os.getenv("QDRANT_HOST", "localhost"), port=int(os.getenv("QDRANT_PORT", "6333")))


def _ensure_collection(qdrant, collection: str) -> None:
    from qdrant_client import models as qm

    if not qdrant.collection_exists(collection):
        qdrant.create_collection(
            collection_name=collection,
            vectors_config=qm.VectorParams(size=1024, distance=qm.Distance.COSINE),
        )


async def index_chunks(chunks: list[dict], *, embeddings, qdrant, bridge, collection: str) -> int:
    from qdrant_client import models as qm

    if not chunks:
        return 0
    vectors = await embeddings.encode_batch_async([c["vector_text"] for c in chunks], is_query=False)
    # vectors may be computed on more than one machine: every payload names its model
    # (graph structure spec, 5.4)
    model = getattr(embeddings, "model_name", None)
    extra = {"embedding_model": model} if isinstance(model, str) else {}
    points = [qm.PointStruct(id=c["point_id"], vector=v, payload={**c["payload"], **extra})
              for c, v in zip(chunks, vectors)]
    await asyncio.to_thread(_ensure_collection, qdrant, collection)
    await asyncio.to_thread(qdrant.upsert, collection_name=collection, points=points)
    rows = [{**row, "chunk_id": c["point_id"], "source": SOURCE} for c in chunks for row in c["bridge"]]
    await bridge.replace_mappings_for_chunks([c["point_id"] for c in chunks], rows, source=SOURCE)
    log.info("massimario.indexed", points=len(points), bridge_rows=len(rows))
    return len(points)
