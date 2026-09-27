"""The backup folder's manifest: file hashes and store counts."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

FORMAT = 1
MANIFEST = "manifest.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def index_files(root: Path) -> dict[str, dict[str, Any]]:
    """Every file under root except the manifest: relative path -> hash and size."""
    files: dict[str, dict[str, Any]] = {}
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix()
        if rel != MANIFEST:
            files[rel] = {"sha256": sha256_file(path), "bytes": path.stat().st_size}
    return files


def verify_files(root: Path, manifest: dict[str, Any]) -> list[str]:
    """What differs between the folder and its manifest; empty means intact."""
    listed = manifest.get("files", {})
    present = index_files(root)
    problems = []
    for rel, meta in listed.items():
        if rel not in present:
            problems.append(f"missing: {rel}")
        elif present[rel]["sha256"] != meta["sha256"]:
            problems.append(f"sha256 mismatch: {rel}")
    problems += [f"not in manifest: {rel}" for rel in present if rel not in listed]
    return problems


def compare_counts(expected: Any, actual: Any, path: str = "") -> list[str]:
    """Differences between two nested count trees (dicts of ints)."""
    if isinstance(expected, dict) and isinstance(actual, dict):
        problems = []
        for key in sorted(set(expected) | set(actual)):
            where = f"{path}/{key}" if path else str(key)
            if key not in actual:
                problems.append(f"{where}: missing after restore")
            elif key not in expected:
                problems.append(f"{where}: not in the backup")
            else:
                problems += compare_counts(expected[key], actual[key], where)
        return problems
    return [] if expected == actual else [f"{path}: expected {expected}, found {actual}"]


def write(root: Path, manifest: dict[str, Any]) -> None:
    (root / MANIFEST).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def read(root: Path) -> dict[str, Any]:
    manifest = json.loads((root / MANIFEST).read_text())
    if manifest.get("format") != FORMAT:
        raise ValueError(f"unsupported manifest format: {manifest.get('format')}")
    return manifest
