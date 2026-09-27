"""Shared config helpers for the RQ ingest task and worker entrypoint."""

import os

from merlt.core.legal_knowledge_graph import MerltConfig

RQ_QUEUE_NAME = "merlt_ingest"


def rq_redis_url() -> str:
    return os.getenv("RQ_REDIS_URL", "redis://localhost:6379/1")


def merlt_config_from_env() -> MerltConfig:
    # MerltConfig has hardcoded dev defaults (port 6380, rlcf_dev) that break inside
    # the docker network, so every field is sourced from the container env explicitly.
    return MerltConfig(
        falkordb_host=os.getenv("FALKORDB_HOST", "localhost"),
        falkordb_port=int(os.getenv("FALKORDB_PORT", "6379")),
        graph_name=os.getenv("FALKORDB_GRAPH_NAME", "merl_t_legal"),
        qdrant_host=os.getenv("QDRANT_HOST", "localhost"),
        qdrant_port=int(os.getenv("QDRANT_PORT", "6333")),
        postgres_host=os.getenv("ENRICHMENT_DB_HOST", "localhost"),
        postgres_port=int(os.getenv("ENRICHMENT_DB_PORT", "5432")),
        postgres_database=os.getenv("ENRICHMENT_DB_NAME", "merlt"),
        postgres_user=os.getenv("ENRICHMENT_DB_USER", "merlt"),
        postgres_password=os.getenv("ENRICHMENT_DB_PASSWORD", "merlt"),
    )
