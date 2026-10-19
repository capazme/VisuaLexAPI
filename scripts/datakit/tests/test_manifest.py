import json

import pytest

from datakit import manifest
from datakit.target import Target


def _folder(tmp_path):
    (tmp_path / "postgres").mkdir()
    (tmp_path / "postgres" / "db.dump").write_bytes(b"dump")
    (tmp_path / "falkordb").mkdir()
    (tmp_path / "falkordb" / "dump.rdb").write_bytes(b"rdb")
    return tmp_path


def test_the_index_lists_every_file_but_the_manifest(tmp_path):
    root = _folder(tmp_path)
    (root / "manifest.json").write_text("{}")
    files = manifest.index_files(root)
    assert sorted(files) == ["falkordb/dump.rdb", "postgres/db.dump"]
    assert files["postgres/db.dump"]["bytes"] == 4
    assert len(files["postgres/db.dump"]["sha256"]) == 64


def test_an_intact_folder_verifies(tmp_path):
    root = _folder(tmp_path)
    assert manifest.verify_files(root, {"format": 1, "files": manifest.index_files(root)}) == []


def test_a_changed_or_missing_file_is_reported(tmp_path):
    root = _folder(tmp_path)
    listed = {"format": 1, "files": manifest.index_files(root)}
    (root / "postgres" / "db.dump").write_bytes(b"tampered")
    (root / "falkordb" / "dump.rdb").unlink()
    assert manifest.verify_files(root, listed) == [
        "missing: falkordb/dump.rdb",
        "sha256 mismatch: postgres/db.dump",
    ]


def test_a_file_outside_the_manifest_is_reported(tmp_path):
    root = _folder(tmp_path)
    listed = {"format": 1, "files": manifest.index_files(root)}
    (root / "stray.txt").write_text("x")
    assert manifest.verify_files(root, listed) == ["not in manifest: stray.txt"]


def test_matching_counts_give_no_problem():
    counts = {"merlt": {"users": 3, "votes": 0}}
    assert manifest.compare_counts(counts, json.loads(json.dumps(counts))) == []


def test_count_differences_name_the_place():
    expected = {"merlt": {"users": 3, "votes": 1}, "g": {"nodes": 5}}
    actual = {"merlt": {"users": 2}, "g": {"nodes": 5}, "extra": {}}
    assert manifest.compare_counts(expected, actual) == [
        "extra: not in the backup",
        "merlt/users: expected 3, found 2",
        "merlt/votes: missing after restore",
    ]


def test_a_manifest_of_another_format_is_refused(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps({"format": 99}))
    with pytest.raises(ValueError, match="format"):
        manifest.read(tmp_path)


def test_a_stack_names_its_containers_volumes_and_qdrant_port(monkeypatch):
    monkeypatch.setenv("VISUALEX_QDRANT_PORT", "56343")
    t = Target.for_stack("x")
    assert (t.pg_container, t.falkor_container, t.volume_prefix) == ("x-postgres", "x-falkordb", "x_")
    assert t.qdrant_url == "http://127.0.0.1:56343"
    assert Target.for_stack("x", pg_container="legacy").pg_container == "legacy"


def test_a_backup_folder_is_private_to_its_owner(tmp_path):
    from datakit import cli

    out = cli.new_backup_folder(tmp_path / "nested" / "backup")
    assert out.stat().st_mode & 0o777 == 0o700
