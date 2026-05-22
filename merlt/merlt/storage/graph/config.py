"""
FalkorDB Configuration
======================

Configurazione per FalkorDB client.

Supporta configurazione via environment variables per deploy flessibile.

Usage:
    from merlt.storage.graph import FalkorDBConfig

    # Default (usa env vars o valori default)
    config = FalkorDBConfig()

    # Override esplicito
    config = FalkorDBConfig(host="localhost", port=6380, graph_name="merl_t_prod")

Environment Variables:
    FALKORDB_HOST: Host del server (default: localhost)
    FALKORDB_PORT: Porta del server (default: 6380)
    FALKORDB_GRAPH_NAME: Nome del grafo (default: merl_t_dev)
    FALKORDB_PASSWORD: Password (default: vuota)
    FALKORDB_MAX_CONNECTIONS: Max connessioni pool (default: 10)
    FALKORDB_TIMEOUT_MS: Timeout operazioni in ms (default: 5000)

Convenzione Naming:
    - merl_t_dev: Ambiente sviluppo
    - merl_t_prod: Ambiente produzione
"""

import os
from dataclasses import dataclass, field
from typing import Optional


def _get_env_str(key: str, default: str) -> str:
    """Legge variabile ambiente come stringa."""
    return os.environ.get(key, default)


def _get_env_int(key: str, default: int) -> int:
    """Legge variabile ambiente come intero."""
    return int(os.environ.get(key, default))


@dataclass
class FalkorDBConfig:
    """
    Configurazione connessione FalkorDB.

    Tutti i campi supportano override da environment variables.

    Attributes:
        host: Host del server FalkorDB
        port: Porta del server (6380 per FalkorDB container)
        graph_name: Nome del grafo (usa _dev/_prod per ambienti)
        max_connections: Numero massimo connessioni nel pool
        timeout_ms: Timeout operazioni in millisecondi
        password: Password autenticazione (opzionale)
    """
    host: str = field(default_factory=lambda: _get_env_str("FALKORDB_HOST", "localhost"))
    port: int = field(default_factory=lambda: _get_env_int("FALKORDB_PORT", 6380))
    graph_name: str = field(default_factory=lambda: _get_env_str("FALKORDB_GRAPH_NAME", "merl_t_dev"))
    max_connections: int = field(default_factory=lambda: _get_env_int("FALKORDB_MAX_CONNECTIONS", 10))
    timeout_ms: int = field(default_factory=lambda: _get_env_int("FALKORDB_TIMEOUT_MS", 5000))
    password: Optional[str] = field(default_factory=lambda: _get_env_str("FALKORDB_PASSWORD", "") or None)
