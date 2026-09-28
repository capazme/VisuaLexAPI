"""Qdrant: one snapshot per collection, through its HTTP API."""
from __future__ import annotations

import json
import urllib.request
from pathlib import Path

from datakit.sh import run
from datakit.target import Target


def _call(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read() or b"{}")


def collections(t: Target) -> list[str]:
    return sorted(c["name"] for c in _call("GET", f"{t.qdrant_url}/collections")["result"]["collections"])


def count(t: Target) -> dict:
    return {c: _call("POST", f"{t.qdrant_url}/collections/{c}/points/count", {"exact": True})["result"]["count"]
            for c in collections(t)}


def backup(t: Target, out: Path) -> dict:
    folder = out / "qdrant"
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    for c in counts:
        name = _call("POST", f"{t.qdrant_url}/collections/{c}/snapshots?wait=true")["result"]["name"]
        urllib.request.urlretrieve(f"{t.qdrant_url}/collections/{c}/snapshots/{name}", folder / f"{c}.snapshot")
        _call("DELETE", f"{t.qdrant_url}/collections/{c}/snapshots/{name}?wait=true")
    return {"version": _call("GET", f"{t.qdrant_url}/").get("version", "unknown"), "counts": counts}


def check(t: Target, entry: dict, force: bool) -> None:
    if force:
        return
    existing = set(collections(t))
    for c in entry["counts"]:
        points = _call("POST", f"{t.qdrant_url}/collections/{c}/points/count", {"exact": True})["result"]["count"] \
            if c in existing else 0
        if points:
            raise RuntimeError(f"qdrant/{c} is not empty: pass --force to replace it")


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    check(t, entry, force)
    for c in entry["counts"]:
        run(["curl", "-sS", "--fail-with-body", "-X", "POST",
             f"{t.qdrant_url}/collections/{c}/snapshots/upload?priority=snapshot&wait=true",
             "-F", f"snapshot=@{src / 'qdrant' / (c + '.snapshot')}"])
