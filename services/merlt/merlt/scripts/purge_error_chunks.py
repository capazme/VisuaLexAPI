"""Purge index-pollution chunks from the Qdrant collection.

Provisional retrievals used to sediment FAILED tool responses (e.g. a
``cite_law`` miss: ``**Errore**: atto '...' non riconosciuto``) as chunks. These
carry no citable content and surfaced as unreadable "Fonte provvisoria" sources.
The ingestion guard (``pipeline.provisional_writer._looks_like_tool_error``) now
stops NEW ones; this script removes the ones already in the index.

Idempotent + safe: scrolls the whole collection, deletes only points whose
payload ``text`` matches the tool-error shape, in batches. Re-runnable.

    docker exec visualex-merlt-api python -m merlt.scripts.purge_error_chunks
    # dry run (count only, no delete):
    docker exec visualex-merlt-api python -m merlt.scripts.purge_error_chunks --dry-run
"""

import os
import sys

from qdrant_client import QdrantClient


def _looks_like_tool_error(text: str) -> bool:
    """Mirror of ``tools.search._is_tool_error_text`` /
    ``pipeline.provisional_writer._looks_like_tool_error``."""
    t = (text or "").strip().lower()
    if not t:
        return False
    return (
        t.startswith("**errore")
        or t.startswith("errore:")
        or "non riconosciuto" in t
    )


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    collection = (
        os.getenv("QDRANT_COLLECTION")
        or os.getenv("MERLT_SEED_COLLECTION")
        or "merl_t_legal_chunks"
    )
    client = QdrantClient(
        host=os.getenv("QDRANT_HOST", "localhost"),
        port=int(os.getenv("QDRANT_PORT", "6333")),
    )

    total = client.count(collection).count
    print(f"collection={collection} total_points={total} dry_run={dry_run}")

    garbage_ids: list = []
    offset = None
    scanned = 0
    while True:
        points, offset = client.scroll(
            collection_name=collection,
            limit=512,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        scanned += len(points)
        for p in points:
            if _looks_like_tool_error((p.payload or {}).get("text", "")):
                garbage_ids.append(p.id)
        if offset is None:
            break

    print(f"scanned={scanned} garbage_found={len(garbage_ids)}")
    if garbage_ids and not dry_run:
        for i in range(0, len(garbage_ids), 256):
            client.delete(collection_name=collection, points_selector=garbage_ids[i : i + 256])
        remaining = client.count(collection).count
        print(f"deleted={len(garbage_ids)} remaining_points={remaining}")
    elif garbage_ids:
        print("dry-run: nothing deleted")
    else:
        print("nothing to purge")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
