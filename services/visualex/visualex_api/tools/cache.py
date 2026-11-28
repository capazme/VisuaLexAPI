import asyncio
import json
import os
import re
import tempfile
import time
import hashlib
from pathlib import Path
from typing import Any, Optional

from .config import PERSISTENT_CACHE_DIR, PERSISTENT_CACHE_TTL

# The head `_write_to_disk` gives every entry: the write time comes first, then the entry's own
# lifetime when it has one (`set(..., ttl=)`), so a sweep reads both from the first bytes instead
# of decoding the whole entry (a Normattiva page is 2.6 MB).
_NUMBER = rb'-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?'
_HEAD = re.compile(rb'\{"timestamp": (' + _NUMBER + rb'), (?:"ttl": (' + _NUMBER + rb'), )?"data": ')
# An entry being written: `<digest>.<random>.tmp` until it is renamed to `<digest>.json`.
_TEMPORARY = ".tmp"
_TEMPORARY_MAX_AGE = 3600


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

    async def set(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Store `value` under `key`. `ttl` gives this entry a lifetime of its own (seconds);
        None keeps the namespace's."""
        await asyncio.to_thread(self._write_to_disk, key, value, ttl)

    async def stamp(self, key: str) -> Optional[float]:
        """The write time of `key`'s entry, from its first bytes, or None when there is no
        entry, it has expired, or its head cannot be read. Only the head is read: an entry
        damaged further on (writes are atomic, so only from outside) still has a stamp, where
        `get` would delete it. The stamp identifies the stored value: an entry written again
        gets a new one. Like `get`, it refreshes the file's modification time, which `prune`
        reads as its last use."""
        return await asyncio.to_thread(self._stamp_on_disk, key)

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
        if timestamp is None or (time.time() - timestamp) > self._lifetime(payload.get("ttl")):
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

    def _stamp_on_disk(self, key: str) -> Optional[float]:
        path = self._path_for_key(key)
        try:
            with path.open("rb") as handle:
                head = _HEAD.match(handle.read(96))
        except OSError:  # no entry
            return None
        if head is None:
            return None
        timestamp = float(head.group(1))
        if time.time() - timestamp > self._lifetime(head.group(2)):
            return None  # `get` deletes it and answers nothing
        try:
            os.utime(path)
        except OSError:
            pass
        return timestamp

    def _lifetime(self, own) -> float:
        """An entry's lifetime: its own when it was stored with one, else the namespace's."""
        try:
            return float(own) if own is not None else self.ttl
        except (TypeError, ValueError):
            return self.ttl

    def _write_to_disk(self, key: str, value: Any, ttl: Optional[int] = None) -> None:
        """Write to a temporary file in the same folder, then rename it over the entry: a
        reader or a sweep sees the old entry or the new one, never one still being written
        (which would read as broken and be deleted). The temporary name does not end in
        `.json`, so no sweep or prune takes it for an entry."""
        path = self._path_for_key(key)
        payload = {"timestamp": time.time(), "data": value}
        if ttl is not None:
            # Before "data", so the head carries it (`_HEAD`); json keeps the insertion order.
            payload = {"timestamp": payload["timestamp"], "ttl": int(ttl), "data": value}
        fd, temporary = tempfile.mkstemp(dir=self.directory, prefix=f"{path.stem}.", suffix=_TEMPORARY)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            os.replace(temporary, path)
        except BaseException:
            try:
                os.unlink(temporary)
            except OSError:
                pass
            raise

    def sweep_expired(self) -> int:
        """Delete every entry older than the TTL, or that cannot be read as
        `{"timestamp": …}`, and return how many went. `get` deletes an expired entry only
        when its key is read again, so without a sweep a key nobody asks for stays on disk."""
        return self.sweep_expired_counted()[0]

    def sweep_expired_counted(self) -> tuple[int, int]:
        """`sweep_expired`, returning how many entries went and the bytes they held.

        Synchronous: it reads every file's head, so call it through `asyncio.to_thread`. An
        entry whose head is the one `_write_to_disk` writes is judged by that head alone: if
        the rest is damaged, `get` deletes it on its next read, or this sweep once it
        expires. Writes are atomic, so an entry is never caught half written; a temporary
        file a crashed write left behind goes once it is an hour old.
        """
        now = time.time()
        removed = freed = 0
        for path in self.directory.glob("*.json"):
            timestamp, own = self._head_of(path)
            if timestamp is None or now - timestamp > self._lifetime(own):
                try:
                    size = path.stat().st_size
                    path.unlink()
                except OSError:  # gone already, or not ours to delete
                    continue
                removed += 1
                freed += size
        for path in self.directory.glob(f"*{_TEMPORARY}"):
            try:
                if now - path.stat().st_mtime > _TEMPORARY_MAX_AGE:
                    path.unlink()
            except OSError:  # renamed into place meanwhile, or gone
                continue
        return removed, freed

    @staticmethod
    def _written_at(path: Path) -> Optional[float]:
        """The entry's write time (`_head_of`)."""
        return PersistentCache._head_of(path)[0]

    @staticmethod
    def _head_of(path: Path) -> tuple[Optional[float], Optional[float]]:
        """The entry's write time and its own lifetime (None: the namespace's), from its head
        when it has the one `_write_to_disk` gives, else from the whole entry decoded. The time
        is None when the entry cannot be read as `{"timestamp": …}`."""
        try:
            with path.open("rb") as handle:
                head = _HEAD.match(handle.read(96))
            if head:
                return float(head.group(1)), (float(head.group(2)) if head.group(2) else None)
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (ValueError, OSError):  # not JSON, not UTF-8, unreadable
            return None, None
        timestamp = payload.get("timestamp") if isinstance(payload, dict) else None
        own = payload.get("ttl") if isinstance(payload, dict) else None
        return (timestamp if isinstance(timestamp, (int, float)) else None,
                own if isinstance(own, (int, float)) else None)

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
