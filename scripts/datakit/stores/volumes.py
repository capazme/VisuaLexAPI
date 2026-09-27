"""Docker volumes of files (uploads, model artefacts): one tar per volume."""
from __future__ import annotations

from pathlib import Path

from datakit.sh import run
from datakit.target import Target

HELPER = "alpine:3.20"


def _exists(volume: str) -> bool:
    try:
        run(["docker", "volume", "inspect", volume])
        return True
    except RuntimeError:
        return False


def _files(volume: str) -> int:
    return int(run(["docker", "run", "--rm", "-v", f"{volume}:/v:ro", HELPER,
                    "sh", "-c", "find /v -type f | wc -l"]).strip())


def count(t: Target) -> dict:
    return {v: _files(t.volume_prefix + v) for v in t.volumes if _exists(t.volume_prefix + v)}


def backup(t: Target, out: Path) -> dict:
    folder = (out / "volumes").resolve()
    folder.mkdir(parents=True, exist_ok=True)
    counts = count(t)
    for v in counts:
        run(["docker", "run", "--rm", "-v", f"{t.volume_prefix + v}:/src:ro", "-v", f"{folder}:/out", HELPER,
             "tar", "czf", f"/out/{v}.tgz", "-C", "/src", "."])
    return {"counts": counts}


def restore(t: Target, src: Path, entry: dict, force: bool) -> None:
    folder = (src / "volumes").resolve()
    for v in entry["counts"]:
        volume = t.volume_prefix + v
        if not _exists(volume):
            # Labelled like Compose's own, so Compose adopts it without warnings.
            run(["docker", "volume", "create", "--label", f"com.docker.compose.project={t.stack}",
                 "--label", f"com.docker.compose.volume={v}", volume])
        elif _files(volume) and not force:
            raise RuntimeError(f"volume {volume} is not empty: pass --force to replace it")
        run(["docker", "run", "--rm", "-v", f"{volume}:/dst", "-v", f"{folder}:/in:ro", HELPER,
             "sh", "-c", f"find /dst -mindepth 1 -delete && tar xzf /in/{v}.tgz -C /dst"])
