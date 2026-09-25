"""The one place that names the Qdrant chunks collection.

``QDRANT_COLLECTION`` wins; otherwise ``<FALKORDB_GRAPH_NAME>_chunks`` with the
seeded graph ``merl_t_legal`` as the default, which is what the seed loader,
the provisional writer and the retriever bootstrap populate and read. Several
endpoints used to default to the historical ``merl_t_dev_chunks`` and queried
a collection that does not exist on the live stack.
"""

from __future__ import annotations

import os


def default_chunks_collection() -> str:
    return os.getenv("QDRANT_COLLECTION") or (
        os.getenv("FALKORDB_GRAPH_NAME", "merl_t_legal") + "_chunks"
    )
