# services/merlt/tests/storage/test_bridge_upsert.py
from merlt.storage.bridge.bridge_table import BridgeTable, BridgeTableConfig


class RecordingSession:
    def __init__(self, log):
        self.log = log

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, statement, params=None):
        self.log.append((str(statement), params))
        return type("R", (), {"rowcount": 3, "scalar": lambda self: 7})()

    async def commit(self):
        self.log.append(("commit", None))


def bridge(log):
    b = BridgeTable(BridgeTableConfig())
    b._connected = True
    b._session_maker = lambda: RecordingSession(log)
    return b


async def test_upsert_is_on_conflict_update():
    log = []
    n = await bridge(log).upsert_mappings_batch([
        {"chunk_id": "6f1c2b9e-0000-5000-8000-000000000001", "graph_node_urn": "u", "node_type": "Norma",
         "relation_type": "CITA_NORMA", "confidence": 1.0, "source": "massimario", "metadata": {"anno": 2024}},
    ])
    sql, params = log[0]
    assert n == 1
    assert "ON CONFLICT (chunk_id, graph_node_urn) DO UPDATE" in sql
    assert params["metadata"] == '{"anno": 2024}' and params["source"] == "massimario"


async def test_count_and_delete_by_source():
    log = []
    b = bridge(log)
    assert await b.count_by_source("massimario") == 7
    assert await b.delete_by_source("massimario") == 3
    assert all(p == {"source": "massimario"} for _, p in log if p)


def test_config_from_enrichment_env(monkeypatch):
    monkeypatch.setenv("ENRICHMENT_DB_HOST", "postgres")
    monkeypatch.setenv("ENRICHMENT_DB_NAME", "merlt")
    config = BridgeTableConfig.from_enrichment_env()
    assert (config.host, config.database) == ("postgres", "merlt")


async def test_replacing_a_chunks_rows_deletes_what_a_rerun_no_longer_writes():
    log = []
    n = await bridge(log).replace_mappings_for_chunks(
        ["6f1c2b9e-0000-5000-8000-000000000001"],
        [{"chunk_id": "6f1c2b9e-0000-5000-8000-000000000001", "graph_node_urn": "u", "node_type": "Norma",
          "source": "massimario"}],
        source="massimario",
    )
    statements = [sql for sql, _ in log]
    assert n == 1
    assert statements[0].strip().startswith("DELETE FROM bridge_table WHERE source = :source AND chunk_id = ANY")
    assert "ON CONFLICT (chunk_id, graph_node_urn) DO UPDATE" in statements[1]
    assert statements[-1] == "commit" and statements.count("commit") == 1  # one transaction
