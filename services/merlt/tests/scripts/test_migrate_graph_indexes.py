"""Qdrant payload indexes are created once."""
from unittest.mock import MagicMock

from qdrant_client import models

from merlt.scripts import migrate_graph_vocabulary as mig


def test_payload_indexes_are_created_only_when_missing():
    client = MagicMock()
    client.get_collection.return_value.payload_schema = {"article_urn": object()}
    assert mig.ensure_payload_indexes(client, "chunks", apply=True) == ["source_type"]
    client.create_payload_index.assert_called_once()
    assert client.create_payload_index.call_args.kwargs["field_name"] == "source_type"
    assert client.create_payload_index.call_args.kwargs["field_schema"] == models.PayloadSchemaType.KEYWORD


def test_a_dry_run_creates_no_payload_index():
    client = MagicMock()
    client.get_collection.return_value.payload_schema = {}
    assert mig.ensure_payload_indexes(client, "chunks", apply=False) == ["article_urn", "source_type"]
    client.create_payload_index.assert_not_called()
