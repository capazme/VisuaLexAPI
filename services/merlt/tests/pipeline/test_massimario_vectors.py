# services/merlt/tests/pipeline/test_massimario_vectors.py
from unittest.mock import AsyncMock, MagicMock

from merlt.pipeline.massimario.vectors import index_chunks

CHUNKS = [
    {"point_id": "6f1c2b9e-0000-5000-8000-000000000001", "vector_text": "uno", "payload": {"text": "uno"},
     "bridge": [{"graph_node_urn": "u", "node_type": "Norma", "relation_type": "CITA_NORMA",
                 "confidence": 1.0, "metadata": {"anno": 2024, "piece": 0}}]},
    {"point_id": "6f1c2b9e-0000-5000-8000-000000000002", "vector_text": "due", "payload": {"text": "due"},
     "bridge": []},
]


def fakes():
    embeddings = MagicMock(encode_batch_async=AsyncMock(return_value=[[0.1, 0.2], [0.3, 0.4]]))
    qdrant = MagicMock(collection_exists=MagicMock(return_value=True))
    bridge = MagicMock(upsert_mappings_batch=AsyncMock(return_value=1), add_mappings_batch=AsyncMock())
    return embeddings, qdrant, bridge


async def test_points_then_bridge_rows():
    embeddings, qdrant, bridge = fakes()
    n = await index_chunks(CHUNKS, embeddings=embeddings, qdrant=qdrant, bridge=bridge, collection="c")
    assert n == 2
    embeddings.encode_batch_async.assert_awaited_once_with(["uno", "due"], is_query=False)
    points = qdrant.upsert.call_args.kwargs["points"]
    assert [p.id for p in points] == [c["point_id"] for c in CHUNKS]
    assert points[0].payload == {"text": "uno"}
    (rows,) = bridge.upsert_mappings_batch.await_args.args
    assert rows == [{**CHUNKS[0]["bridge"][0], "chunk_id": CHUNKS[0]["point_id"], "source": "massimario"}]


async def test_reindexing_is_an_upsert():
    embeddings, qdrant, bridge = fakes()
    for _ in range(2):
        await index_chunks(CHUNKS, embeddings=embeddings, qdrant=qdrant, bridge=bridge, collection="c")
    first, second = (c.kwargs["points"] for c in qdrant.upsert.call_args_list)
    assert [p.id for p in first] == [p.id for p in second]
    bridge.add_mappings_batch.assert_not_awaited()


async def test_the_payload_names_the_embedding_model():
    embeddings, qdrant, bridge = fakes()
    embeddings.model_name = "intfloat/multilingual-e5-large"
    await index_chunks(CHUNKS, embeddings=embeddings, qdrant=qdrant, bridge=bridge, collection="c")
    points = qdrant.upsert.call_args.kwargs["points"]
    assert points[0].payload == {"text": "uno", "embedding_model": "intfloat/multilingual-e5-large"}
