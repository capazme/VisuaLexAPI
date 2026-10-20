import asyncio
import json
import os
import time
import hashlib
from pathlib import Path
from typing import Any, Optional

from .config import PERSISTENT_CACHE_DIR, PERSISTENT_CACHE_TTL


class PersistentCache:
    """
    Simple filesystem-backed cache that stores JSON-serializable payloads.
    It is intentionally lightweight to keep dependencies minimal.
    """

    def __init__(self, namespace: str, ttl: int = PERSISTENT_CACHE_TTL) -> None:
        self.namespace = namespace
        self.ttl = ttl
        self.directory = Path(PERSISTENT_CACHE_DIR) / namespace
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path_for_key(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self.directory / f"{digest}.json"

    async def get(self, key: str) -> Optional[Any]:
        return await asyncio.to_thread(self._read_from_disk, key)

    async def set(self, key: str, value: Any) -> None:
        await asyncio.to_thread(self._write_to_disk, key, value)

    async def delete(self, key: str) -> None:
        path = self._path_for_key(key)
        try:
            await asyncio.to_thread(path.unlink, True)
        except OSError:
            pass

    def _read_from_disk(self, key: str) -> Optional[Any]:
        path = self._path_for_key(key)
        if not path.exists():
            return None

        try:
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (json.JSONDecodeError, OSError):
            try:
                path.unlink()
            except OSError:
                pass
            return None

        timestamp = payload.get("timestamp")
        if timestamp is None or (time.time() - timestamp) > self.ttl:
            try:
                path.unlink()
            except OSError:
                pass
            return None
        # The file's modification time is when it was last read or written, for `prune`; the
        # entry's age, which the TTL measures, is the timestamp inside it.
        try:
            os.utime(path)
        except OSError:
            pass
        return payload.get("data")

    def _write_to_disk(self, key: str, value: Any) -> None:
        path = self._path_for_key(key)
        payload = {"timestamp": time.time(), "data": value}
        with path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle)

    def sweep_expired(self) -> int:
        """Delete every entry older than the TTL, or that cannot be read as
        `{"timestamp": …}`, and return how many went. `get` deletes an expired entry only
        when its key is read again, so without a sweep a key nobody asks for stays on disk.

        Synchronous: it reads every file, so call it through `asyncio.to_thread`. An entry
        caught while it is being written reads as unreadable and goes: a cache miss later,
        nothing worse.
        """
        now = time.time()
        removed = 0
        for path in self.directory.glob("*.json"):
            try:
                with path.open("r", encoding="utf-8") as handle:
                    payload = json.load(handle)
                timestamp = payload.get("timestamp") if isinstance(payload, dict) else None
                expired = (not isinstance(timestamp, (int, float))
                           or now - timestamp > self.ttl)
            except (ValueError, OSError):  # not JSON, not UTF-8, unreadable
                expired = True
            if expired:
                try:
                    path.unlink()
                except OSError:  # gone already, or not ours to delete
                    continue
                removed += 1
        return removed

    def prune(self, max_idle: float, max_bytes: int) -> tuple[int, int, int]:
        """Delete the entries not read nor written for `max_idle` seconds, then the least
        recently used ones until the namespace holds at most `max_bytes`; return how many
        went, the bytes they held and the bytes kept. Only this namespace's `*.json` files.

        Synchronous: it stats every file, so call it through `asyncio.to_thread`. An entry
        deleted while it is read or written is a cache miss later, nothing worse.
        """
        now = time.time()
        entries = []
        for path in self.directory.glob("*.json"):
            try:
                stat = path.stat()
            except OSError:  # gone already
                continue
            entries.append((stat.st_mtime, stat.st_size, path))
        entries.sort(key=lambda entry: entry[0])  # least recently used first
        kept = sum(size for _, size, _ in entries)
        removed = freed = 0
        for used_at, size, path in entries:
            if now - used_at <= max_idle and kept <= max_bytes:
                break
            try:
                path.unlink()
            except OSError:  # gone already, or not ours to delete
                continue
            removed += 1
            freed += size
            kept -= size
        return removed, freed, kept
