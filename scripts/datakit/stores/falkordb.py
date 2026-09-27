"""FalkorDB: an RDB snapshot taken over the replication protocol.

The restore is the delicate part. With append-only persistence on and no AOF
on disk, Redis starts EMPTY and ignores dump.rdb — and its next save would
overwrite the snapshot. So the container starts once with append-only off,
loads the snapshot, rewrites it as an AOF (CONFIG SET appendonly yes), and
only then restarts with the normal settings.
"""
from __future__ import annotations

import os
import time
from pathlib import Path

from datakit.sh import image_of, run
from datakit.target import Target

LOAD_ARGS = "--save 60 1 --appendonly no"
TMP = "/tmp/datakit-dump.rdb"


def _cli(container: str, *args: str) -> str:
    return run(["docker", "exec", container, "redis-cli", *args])


def _first_int(output: str) -> int:
    for line in output.splitlines():
        if line.strip().isdigit():
            return int(line.strip())
    raise RuntimeError(f"no count in the FalkorDB answer: {output!r}")


def count(t: Target) -> dict:
    counts = {}
    for graph in [g for g in _cli(t.falkor_container, "GRAPH.LIST").splitlines() if g]:
        counts[graph] = {
            "nodes": _first_int(_cli(t.falkor_container, "GRAPH.RO_QUERY", graph, "MATCH (n) RETURN count(n)")),
            "edges": _first_int(_cli(t.falkor_container, "GRAPH.RO_QUERY", graph, "MATCH ()-[r]->() RETURN count(r)")),
        }
    return counts


def backup(t: Target, out: Path) -> dict:
    folder = out / "falkordb"
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    run(["docker", "exec", t.falkor_container, "redis-cli", "--rdb", TMP])
    run(["docker", "cp", f"{t.falkor_container}:{TMP}", str(folder / "dump.rdb")])
    run(["docker", "exec", t.falkor_container, "rm", "-f", TMP])
    return {"image": image_of(t.falkor_container), "counts": counts}


def _compose(t: Target, *args: str, falkordb_args: str | None = None) -> None:
    env = dict(os.environ, VISUALEX_STACK=t.stack)
    env.pop("FALKORDB_ARGS", None)
    if falkordb_args:
        env["FALKORDB_ARGS"] = falkordb_args
    run(["docker", "compose", "-f", str(t.compose_file), "-p", t.stack, *args], env=env)


def _wait_for_aof(container: str, timeout: float = 900) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        info = _cli(container, "INFO", "persistence")
        if all(flag in info for flag in ("aof_enabled:1", "aof_rewrite_in_progress:0",
                                          "aof_rewrite_scheduled:0", "aof_last_bgrewrite_status:ok")):
            return
        time.sleep(1)
    raise RuntimeError("FalkorDB did not finish writing its AOF")


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    if any(g["nodes"] for g in count(t).values()) and not force:
        raise RuntimeError("falkordb is not empty: pass --force to replace it")
    _compose(t, "stop", "falkordb")
    run(["docker", "run", "--rm", "-v", f"{t.volume_prefix}falkordb_data:/data",
         "-v", f"{(src / 'falkordb').resolve()}:/in:ro", "alpine:3.20",
         "sh", "-c", "rm -rf /data/* && cp /in/dump.rdb /data/dump.rdb"])
    _compose(t, "up", "-d", "--wait", "--force-recreate", "falkordb", falkordb_args=LOAD_ARGS)
    _cli(t.falkor_container, "CONFIG", "SET", "appendonly", "yes")
    _wait_for_aof(t.falkor_container)
    _compose(t, "up", "-d", "--wait", "--force-recreate", "falkordb")
