"""The dashboard and the trace readers report and reach the databases the deployment uses.

The dashboard health check named `rlcf_dev` whatever the bridge connected to, its architecture node
for PostgreSQL carried a literal `localhost:5433/rlcf_dev` (and must never carry the user or the
password: it is an API response), the knowledge-graph KPIs and the FalkorDB / Redis health checks
did not close what they opened on every path, and the trace readers (`trace_router`,
`citation_router`) built `TraceStorageConfig()` from the dataclass defaults, a development container
that does not exist inside the compose network. Traces are written through the RLCF session
(`RLCF_ASYNC_DATABASE_URL`), so that URL is where the readers must look.

No database, no graph, no Redis: every store is a stand-in.
"""
import importlib
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import quote

import pytest

from merlt.storage.bridge.bridge_table import BridgeTableConfig
from merlt.storage.trace.trace_service import TraceStorageConfig

BRIDGE_CLASS = "merlt.storage.bridge.bridge_table.BridgeTable"
FALKOR_CLASS = "merlt.storage.graph.client.FalkorDBClient"
ENRICHMENT_ENV = {
    "ENRICHMENT_DB_HOST": "postgres", "ENRICHMENT_DB_PORT": "5433", "ENRICHMENT_DB_NAME": "enrich",
    "ENRICHMENT_DB_USER": "the-user", "ENRICHMENT_DB_PASSWORD": "the-secret",
}
RLCF_URL = "postgresql+asyncpg://rlcf-user:rlcf-secret@db-host:6543/rlcf-db"


def _enrichment_environment(monkeypatch):
    for name, value in ENRICHMENT_ENV.items():
        monkeypatch.setenv(name, value)


def _falkor_stand_in(**overrides):
    client = MagicMock()
    client.connect = AsyncMock()
    client.close = AsyncMock()
    client.health_check = AsyncMock(return_value=True)
    client.query = AsyncMock(return_value=[{"c": 1}])
    for name, value in overrides.items():
        setattr(client, name, value)
    return client


# The PostgreSQL entries of the dashboard ------------------------------------------------------------


async def test_the_health_check_names_the_database_the_bridge_connected_to(monkeypatch):
    _enrichment_environment(monkeypatch)
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    with patch(BRIDGE_CLASS, autospec=True) as bridge_class:
        bridge_class.return_value.count.return_value = 3
        health = await dashboard_router._check_postgres_health()
    assert health.details["database"] == "enrich"


async def test_the_architecture_node_reports_the_bridge_host_port_and_database_and_nothing_secret(monkeypatch):
    _enrichment_environment(monkeypatch)
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    with patch.object(dashboard_router, "_get_knowledge_graph_kpis", AsyncMock(side_effect=RuntimeError("no kpis"))):
        details = await dashboard_router.get_node_details("postgresql", api_key=None)
    assert details.config == {"host": "postgres", "port": 5433, "db": "enrich"}
    assert "the-user" not in str(details.model_dump()) and "the-secret" not in str(details.model_dump())


# What the dashboard opens, it closes ------------------------------------------------------------------


@pytest.mark.parametrize("failing_query", [False, True])
async def test_the_knowledge_graph_kpis_close_the_graph_client(failing_query):
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    client = _falkor_stand_in(query=AsyncMock(side_effect=RuntimeError("query failed")) if failing_query else AsyncMock(return_value=[{"c": 1}]))
    with patch(FALKOR_CLASS, return_value=client), \
            patch("qdrant_client.QdrantClient", side_effect=RuntimeError("no vector store")), \
            patch(BRIDGE_CLASS, autospec=True):
        await dashboard_router._get_knowledge_graph_kpis()
    client.close.assert_awaited_once()


@pytest.mark.parametrize("health_check", [
    AsyncMock(return_value=True),
    AsyncMock(return_value=False),
    AsyncMock(side_effect=RuntimeError("the graph went away")),
])
async def test_the_falkordb_health_check_closes_the_client_on_every_branch(health_check):
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    client = _falkor_stand_in(health_check=health_check)
    with patch(FALKOR_CLASS, return_value=client):
        await dashboard_router._check_falkordb_health()
    client.close.assert_awaited_once()


@pytest.mark.parametrize("ping", [AsyncMock(return_value=True), AsyncMock(side_effect=RuntimeError("no redis"))])
async def test_the_redis_health_check_closes_the_client_on_every_branch(ping):
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    client = MagicMock()
    client.ping = ping
    client.info = AsyncMock(return_value={})
    client.close = AsyncMock()
    with patch("redis.asyncio.Redis", return_value=client):
        await dashboard_router._check_redis_health()
    client.close.assert_awaited_once()


# The trace readers ------------------------------------------------------------------------------------


def test_the_trace_database_is_the_one_the_rlcf_session_writes_to(monkeypatch):
    monkeypatch.setenv("RLCF_ASYNC_DATABASE_URL", RLCF_URL)
    config = TraceStorageConfig.from_rlcf_env()
    assert (config.host, config.port, config.database, config.user, config.password) == (
        "db-host", 6543, "rlcf-db", "rlcf-user", "rlcf-secret",
    )
    assert config.get_connection_string() == RLCF_URL


async def test_the_trace_routers_lazy_service_is_built_from_the_rlcf_database(monkeypatch):
    monkeypatch.setenv("RLCF_ASYNC_DATABASE_URL", RLCF_URL)
    trace_router = importlib.import_module("merlt.api.trace_router")
    monkeypatch.setattr(trace_router, "_trace_service", None)
    with patch("merlt.api.trace_router.TraceStorageService", autospec=True) as service_class:
        service = await trace_router.get_trace_service()
    (config,), _ = service_class.call_args
    assert config == TraceStorageConfig.from_rlcf_env()
    assert service is service_class.return_value
    service.connect.assert_awaited_once()


async def test_the_citation_routers_service_is_built_from_the_rlcf_database(monkeypatch):
    monkeypatch.setenv("RLCF_ASYNC_DATABASE_URL", RLCF_URL)
    citation_router = importlib.import_module("merlt.api.citation_router")
    with patch("merlt.api.citation_router.TraceStorageService", autospec=True) as service_class:
        await citation_router.get_trace_service()
    (config,), _ = service_class.call_args
    assert config == TraceStorageConfig.from_rlcf_env()


# Qdrant -----------------------------------------------------------------------------------------------


def _qdrant_stand_in(**overrides):
    client = MagicMock()
    client.get_collections.return_value = MagicMock(collections=["a", "b"])
    for name, value in overrides.items():
        setattr(client, name, value)
    return client


async def test_the_qdrant_health_check_reaches_the_host_and_port_the_deployment_sets(monkeypatch):
    monkeypatch.delenv("QDRANT_URL", raising=False)
    monkeypatch.setenv("QDRANT_HOST", "qdrant")
    monkeypatch.setenv("QDRANT_PORT", "6333")
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    client = _qdrant_stand_in()
    with patch("qdrant_client.QdrantClient", return_value=client) as client_class:
        health = await dashboard_router._check_qdrant_health()
    assert client_class.call_args.kwargs == {"host": "qdrant", "port": 6333}
    assert health.status.value == "online" and health.details["collections_count"] == 2
    client.close.assert_called_once()


async def test_an_explicit_qdrant_url_still_wins(monkeypatch):
    monkeypatch.setenv("QDRANT_URL", "http://elsewhere:7000")
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    with patch("qdrant_client.QdrantClient", return_value=_qdrant_stand_in()) as client_class:
        await dashboard_router._check_qdrant_health()
    assert client_class.call_args.kwargs == {"url": "http://elsewhere:7000"}


async def test_the_qdrant_health_check_closes_the_client_when_the_call_raises(monkeypatch):
    monkeypatch.delenv("QDRANT_URL", raising=False)
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    client = _qdrant_stand_in(get_collections=MagicMock(side_effect=RuntimeError("no qdrant")))
    with patch("qdrant_client.QdrantClient", return_value=client):
        health = await dashboard_router._check_qdrant_health()
    assert health.status.value == "offline"
    client.close.assert_called_once()


# Credentials in connection strings --------------------------------------------------------------------

AWKWARD_PASSWORD = "p@ss/w:rd%40#x"
AWKWARD_USER = "us@er:n/m#e"


@pytest.mark.parametrize("config_class", [TraceStorageConfig, BridgeTableConfig])
def test_a_connection_string_escapes_its_credentials(config_class):
    from sqlalchemy.engine import make_url

    config = config_class(host="db-host", port=6543, database="the-db", user=AWKWARD_USER, password=AWKWARD_PASSWORD)
    url = make_url(config.get_connection_string())
    assert url.drivername == "postgresql+asyncpg"
    assert (url.username, url.password, url.host, url.port, url.database) == (
        AWKWARD_USER, AWKWARD_PASSWORD, "db-host", 6543, "the-db",
    )


@pytest.mark.parametrize("config_class", [TraceStorageConfig, BridgeTableConfig])
def test_a_plain_connection_string_reads_as_before(config_class):
    config = config_class(host="h", port=5432, database="d", user="u", password="pw")
    assert config.get_connection_string() == "postgresql+asyncpg://u:pw@h:5432/d"


def test_the_trace_database_survives_an_escaped_password_in_the_rlcf_url(monkeypatch):
    monkeypatch.setenv(
        "RLCF_ASYNC_DATABASE_URL",
        f"postgresql+asyncpg://u:{quote(AWKWARD_PASSWORD, safe='')}@db-host:6543/rlcf-db",
    )
    config = TraceStorageConfig.from_rlcf_env()
    assert config.password == AWKWARD_PASSWORD
    assert TraceStorageConfig.from_rlcf_env().get_connection_string().count("@") == 1


async def test_the_knowledge_graph_kpis_close_the_qdrant_client(monkeypatch):
    monkeypatch.delenv("QDRANT_URL", raising=False)
    dashboard_router = importlib.import_module("merlt.api.dashboard_router")
    client = _qdrant_stand_in(get_collection=MagicMock(side_effect=RuntimeError("no collection")))
    with patch(FALKOR_CLASS, side_effect=RuntimeError("no graph")), \
            patch("qdrant_client.QdrantClient", return_value=client), \
            patch(BRIDGE_CLASS, autospec=True):
        await dashboard_router._get_knowledge_graph_kpis()
    client.close.assert_called_once()
