import asyncio
import json
import os
import re
import time
import hashlib
from pathlib import Path
from typing import Any, Optional

from .config import PERSISTENT_CACHE_DIR, PERSISTENT_CACHE_TTL

# The head `_write_to_disk` gives every entry: the write time comes first, so a sweep reads it
# from the first bytes instead of decoding the whole entry (a Normattiva page is 2.6 MB).
_HEAD = re.compile(rb'\{"timestamp": (-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?), "data": ')


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

        Synchronous: it reads every file's head, so call it through `asyncio.to_thread`. An
        entry whose head is the one `_write_to_disk` writes is judged by that head alone: if
        the rest is damaged (a write cut short), `get` deletes it on its next read, or this
        sweep once it expires. An entry caught before its head reached the disk reads as
        unreadable and goes: a cache miss later, nothing worse.
        """
        now = time.time()
        removed = 0
        for path in self.directory.glob("*.json"):
            timestamp = self._written_at(path)
            if timestamp is None or now - timestamp > self.ttl:
                try:
                    path.unlink()
                except OSError:  # gone already, or not ours to delete
                    continue
                removed += 1
        return removed

    @staticmethod
    def _written_at(path: Path) -> Optional[float]:
        """The entry's write time: from its head when it has the one `_write_to_disk` gives,
        else from the whole entry decoded. None when it cannot be read as `{"timestamp": …}`."""
        try:
            with path.open("rb") as handle:
                head = _HEAD.match(handle.read(64))
            if head:
                return float(head.group(1))
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (ValueError, OSError):  # not JSON, not UTF-8, unreadable
            return None
        timestamp = payload.get("timestamp") if isinstance(payload, dict) else None
        return timestamp if isinstance(timestamp, (int, float)) else None

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
