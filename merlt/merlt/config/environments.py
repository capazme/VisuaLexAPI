"""
Environment Configurations
===========================

Defines TEST and PROD environment configurations for MERL-T.

Each environment specifies connection parameters for:
- FalkorDB (Knowledge Graph)
- Qdrant (Vector Search)
- PostgreSQL (Bridge Table / RLCF)
"""

from dataclasses import dataclass


@dataclass
class Environment:
    """Environment-specific configuration."""

    name: str

    # FalkorDB
    falkordb_host: str = "localhost"
    falkordb_port: int = 6380
    falkordb_graph: str = "merl_t"

    # Qdrant
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_collection: str = "merl_t_chunks"

    # PostgreSQL
    postgres_host: str = "localhost"
    postgres_port: int = 5433
    postgres_database: str = "rlcf_dev"
    postgres_user: str = "dev"
    postgres_password: str = "devpassword"


TEST_ENV = Environment(
    name="test",
    falkordb_graph="merl_t_test",
    qdrant_collection="merl_t_test_chunks",
    postgres_database="rlcf_dev",
)

PROD_ENV = Environment(
    name="prod",
    falkordb_graph="merl_t_prod",
    qdrant_collection="merl_t_prod_chunks",
    postgres_database="rlcf_prod",
)


def get_environment_config(env: Environment) -> Environment:
    """Get environment configuration.

    Args:
        env: Environment instance (TEST_ENV or PROD_ENV)

    Returns:
        The environment configuration (passed through for now,
        could be extended with env var overrides in the future).
    """
    return env
