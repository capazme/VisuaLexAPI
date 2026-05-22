"""
MERL-T Configuration
====================

Environment-specific configuration for MERL-T deployments.

Usage:
    from merlt.config import get_environment_config, TEST_ENV, PROD_ENV

    config = get_environment_config(TEST_ENV)
    print(config.falkordb_graph)  # 'merl_t_test'
"""

from .environments import (
    Environment,
    get_environment_config,
    TEST_ENV,
    PROD_ENV,
)

__all__ = [
    "Environment",
    "get_environment_config",
    "TEST_ENV",
    "PROD_ENV",
]
