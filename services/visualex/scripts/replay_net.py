"""Record the sources' answers once, then serve them back locally: load tests never reach a source.

Every request the collectors send goes through `aiohttp.ClientSession` (the shared
`ThrottledHttpClient`, the decision readers' own, a Normattiva part's session). This module
patches that one door:

- ``install_recorder(folder)`` wraps ``ClientSession._request``: each answer's status, headers,
  body and latency are written to ``folder`` (one ``<digest>.json`` per request, the body in
  ``<digest>.body``). The collectors behave as without it; the body is read once more from
  aiohttp's own buffer.
- ``install_replayer(folder, latency=...)`` replaces ``ClientSession.request`` with a stub that
  answers from ``folder`` after the recorded latency (or a fixed one), and never opens a
  socket. A request that was not recorded answers 404, which the collectors read as "not
  found" — the replay is a closed world. Our own throttle, semaphore, retries, caches and
  parsing run as in production, which is what a load test is for.

Playwright (EUR-Lex's site, the PDF export) is not covered: an EU act is read from CELLAR
first, over HTTP, and that is recorded.

Recorded answers are the sources' content (decision texts carry personal data the source left):
they live in a scratch folder, never in the repository.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any

import aiohttp
from multidict import CIMultiDict, CIMultiDictProxy
from yarl import URL


def request_key(method: str, url: Any, kwargs: dict) -> str:
    """A stable digest of what identifies a request: method, URL, query, form or JSON body."""
    parts = {
        "method": method.upper(),
        "url": str(url),
        "params": _plain(kwargs.get("params")),
        "data": _plain(kwargs.get("data")),
        "json": _plain(kwargs.get("json")),
    }
    raw = json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _plain(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        return hashlib.sha256(bytes(value)).hexdigest()
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in sorted(value.items(), key=lambda kv: str(kv[0]))}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    return str(value)


# ---------------------------------------------------------------------------------------------
# Recording


def install_recorder(folder: Path) -> None:
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    original = aiohttp.ClientSession._request

    async def recording_request(self, method, str_or_url, **kwargs):
        start = time.perf_counter()
        response = await original(self, method, str_or_url, **kwargs)
        try:
            body = await response.read()
        except Exception:  # noqa: BLE001 - the collector meets the same error on its own read
            return response
        latency = time.perf_counter() - start
        key = request_key(method, str_or_url, kwargs)
        meta = {
            "method": method.upper(),
            "url": str(str_or_url),
            "final_url": str(response.url),
            "status": response.status,
            "headers": [[k, v] for k, v in response.headers.items()],
            "latency_s": round(latency, 4),
            "bytes": len(body),
            "recorded_at": time.time(),
        }
        (folder / f"{key}.body").write_bytes(body)
        (folder / f"{key}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
        return response

    aiohttp.ClientSession._request = recording_request


# ---------------------------------------------------------------------------------------------
# Replaying


class ReplayStats:
    """Requests the collectors sent during a replay, per host: what would have reached the sources."""

    def __init__(self) -> None:
        self.sent: dict[str, int] = {}
        self.missing: dict[str, int] = {}

    def add(self, host: str, found: bool) -> None:
        bucket = self.sent if found else self.missing
        bucket[host] = bucket.get(host, 0) + 1

    def snapshot(self) -> dict:
        return {"sent": dict(self.sent), "missing": dict(self.missing)}

    def reset(self) -> None:
        self.sent.clear()
        self.missing.clear()


STATS = ReplayStats()


class _ReplayedResponse:
    """The part of `aiohttp.ClientResponse` the collectors use."""

    def __init__(self, method: str, url: str, status: int, headers: list, body: bytes) -> None:
        self.method = method
        self.url = URL(url)
        self.real_url = self.url
        self.status = status
        self.reason = "OK" if status < 400 else "Replay"
        self.headers = CIMultiDictProxy(CIMultiDict(headers))
        self.history = ()
        self._body = body

    @property
    def content_type(self) -> str:
        return self.headers.get("Content-Type", "application/octet-stream").split(";")[0].strip()

    @property
    def charset(self) -> str | None:
        ctype = self.headers.get("Content-Type", "")
        for part in ctype.split(";")[1:]:
            name, _, value = part.strip().partition("=")
            if name.lower() == "charset":
                return value.strip('"') or None
        return None

    def get_encoding(self) -> str:
        return self.charset or "utf-8"

    async def read(self) -> bytes:
        return self._body

    async def text(self, encoding: str | None = None, errors: str = "strict") -> str:
        return self._body.decode(encoding or self.get_encoding(), errors=errors)

    async def json(self, **_kwargs) -> Any:
        return json.loads(self._body)

    def raise_for_status(self) -> None:
        if self.status >= 400:
            raise aiohttp.ClientResponseError(
                request_info=None, history=(), status=self.status, message=self.reason,  # type: ignore[arg-type]
                headers=self.headers,
            )

    def release(self) -> None:
        return None

    def close(self) -> None:
        return None

    async def wait_for_close(self) -> None:
        return None


class _ReplayContext:
    def __init__(self, coro) -> None:
        self._coro = coro
        self._response: _ReplayedResponse | None = None

    def __await__(self):
        return self._coro.__await__()

    async def __aenter__(self) -> _ReplayedResponse:
        self._response = await self._coro
        return self._response

    async def __aexit__(self, *exc) -> None:
        return None


# Stand-ins for answers never recorded, so a load test can read many distinct articles without
# asking a source for each: an article page of the c.c. not recorded is answered with art.
# 2043's page (same size, same latency). The text it yields is art. 2043's under another
# number: right for timing, never for a text comparison.
TEMPLATES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^https://www\.normattiva\.it/uri-res/N2Ls\?urn:nir:stato:regio\.decreto:1942-03-16;262:2~art\d+[a-z]*$"),
     "https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:regio.decreto:1942-03-16;262:2~art2043"),
]


def install_replayer(folder: Path, latency: str | float = "recorded", templates: bool = False) -> None:
    """Serve every request from `folder`. `latency` is "recorded" (each answer's own wait), a
    number of seconds, or 0. `templates` answers the URLs `TEMPLATES` names with their stand-in."""
    folder = Path(folder)
    index: dict[str, tuple[dict, bytes]] = {}
    for meta_path in folder.glob("*.json"):
        meta = json.loads(meta_path.read_text())
        index[meta_path.stem] = (meta, meta_path.with_suffix(".body").read_bytes())

    async def answer(method: str, url: Any, kwargs: dict) -> _ReplayedResponse:
        key = request_key(method, url, kwargs)
        host = URL(str(url)).host or "?"
        found = index.get(key)
        if found is None and templates and method.upper() == "GET":
            for pattern, stand_in in TEMPLATES:
                if pattern.match(str(url)):
                    found = index.get(request_key("GET", stand_in, {}))
                    break
        STATS.add(host, found is not None)
        if found is None:
            await asyncio.sleep(0.05)
            return _ReplayedResponse(method, str(url), 404, [["Content-Type", "text/plain"]], b"not recorded")
        meta, body = found
        wait = meta["latency_s"] if latency == "recorded" else float(latency)
        if wait:
            await asyncio.sleep(wait)
        headers = [h for h in meta["headers"]
                   if h[0].lower() not in ("content-encoding", "transfer-encoding", "content-length")]
        return _ReplayedResponse(method, meta["final_url"], meta["status"], headers, body)

    def replay_request(self, method, url, **kwargs):
        return _ReplayContext(answer(method, url, kwargs))

    aiohttp.ClientSession.request = replay_request
    aiohttp.ClientSession.get = lambda self, url, **kw: replay_request(self, "GET", url, **kw)
    aiohttp.ClientSession.post = lambda self, url, **kw: replay_request(self, "POST", url, **kw)
